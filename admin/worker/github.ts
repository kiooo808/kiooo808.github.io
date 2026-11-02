import { Env, HttpError } from "./types";
import { b64 } from "./auth";
import {
  Base,
  HOME_PATH,
  LIFECYCLE_PATH,
  allowedPath,
} from "../shared/content";
const encoder = new TextEncoder();
export function privateKeyBytes(pem: string) {
  const text = pem.replaceAll("\\n", "\n");
  if (text.length > 20000 || !/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(text))
    throw new HttpError(
      503,
      "应用私钥格式不正确，请使用 MyBlog GitHub App 下载的 PEM 文件。",
    );
  const bytes = Uint8Array.from(
    atob(text.replace(/-----[^-]+-----|\s/g, "")),
    (x) => x.charCodeAt(0),
  );
  if (!text.includes("BEGIN RSA PRIVATE KEY")) return bytes;
  const length = (n: number) =>
    n < 128 ? [n] : n < 256 ? [129, n] : [130, n >> 8, n & 255];
  const octet = [4, ...length(bytes.length), ...bytes];
  const payload = [
    2,
    1,
    0,
    48,
    13,
    6,
    9,
    42,
    134,
    72,
    134,
    247,
    13,
    1,
    1,
    1,
    5,
    0,
    ...octet,
  ];
  return new Uint8Array([48, ...length(payload.length), ...payload]);
}
let cached: { key: string; token: string; until: number } | undefined;
async function installationToken(env: Env) {
  const key = env.GITHUB_APP_ID + ":" + env.GITHUB_INSTALLATION_ID;
  if (cached?.key === key && cached.until > Date.now()) return cached.token;
  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_PRIVATE_KEY ||
    !env.GITHUB_INSTALLATION_ID
  )
    throw new HttpError(503, "GitHub 发布服务尚未配置。");
  const seconds = Math.floor(Date.now() / 1000);
  const message =
    b64(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))) +
    "." +
    b64(
      encoder.encode(
        JSON.stringify({
          iat: seconds - 30,
          exp: seconds + 540,
          iss: env.GITHUB_APP_ID,
        }),
      ),
    );
  const bytes = privateKeyBytes(env.GITHUB_PRIVATE_KEY);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const jwt =
    message +
    "." +
    b64(
      new Uint8Array(
        await crypto.subtle.sign(
          "RSASSA-PKCS1-v1_5",
          privateKey,
          encoder.encode(message),
        ),
      ),
    );
  const res = await fetch(
    `https://api.github.com/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`,
    {
      method: "POST",
      headers: headers(jwt),
      body: JSON.stringify({
        repositories: [env.REPOSITORY.split("/")[1]],
        permissions: {
          contents: "write",
          pull_requests: "write",
          actions: "write",
          checks: "read",
        },
      }),
    },
  );
  if (!res.ok)
    throw new HttpError(502, "无法取得 GitHub 授权，请检查 App 安装与权限。");
  const data = (await res.json()) as { token: string };
  cached = { key, token: data.token, until: Date.now() + 50 * 60000 };
  return data.token;
}
function headers(token: string) {
  return {
    Authorization: "Bearer " + token,
    "User-Agent": "MyBlog-Studio",
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
const immutableReads = new Map<string, any>();
export async function gh<T = any>(
  env: Env,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const cacheable =
    method === "GET" &&
    (/^\/contents\/.*[?&]ref=[0-9a-f]{40}(?:&|$)/.test(path) ||
      /^\/git\/trees\/[0-9a-f]{40}/.test(path));
  const cacheKey = env.REPOSITORY + path;
  if (cacheable && immutableReads.has(cacheKey))
    return structuredClone(immutableReads.get(cacheKey));
  const response = await fetch(
    `https://api.github.com/repos/${env.REPOSITORY}${path}`,
    {
      method,
      headers: headers(await installationToken(env)),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  if (!response.ok) {
    if (response.status === 404)
      throw new HttpError(404, "仓库文件或发布记录不存在。");
    if (response.status === 409 || response.status === 422)
      throw new HttpError(409, "仓库已变化或存在冲突，请刷新后重试。");
    throw new HttpError(
      502,
      `GitHub 请求失败（${response.status}），请稍后重试。`,
    );
  }
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (cacheable && text.length < 400000) {
    if (immutableReads.size >= 64)
      immutableReads.delete(immutableReads.keys().next().value!);
    immutableReads.set(cacheKey, parsed);
  }
  return parsed as T;
}
export async function readFile(
  env: Env,
  path: string,
  ref = "main",
): Promise<Base> {
  if (!allowedPath(path) && path !== LIFECYCLE_PATH)
    throw new HttpError(400, "这个文件不属于内容管理范围。");
  const value = await gh(
    env,
    `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
  );
  if (value.type !== "file") throw new HttpError(400, "无法读取内容文件。");
  const source = new TextDecoder().decode(
    await contentBytes(env, value, 2 * 1024 * 1024),
  );
  return { path, sha: value.sha, source };
}
export async function readAll(env: Env) {
  const ref = await gh(env, "/git/ref/heads/main");
  const tree = await gh(env, `/git/trees/${ref.object.sha}?recursive=1`);
  if (tree.truncated)
    throw new HttpError(502, "仓库目录过大，暂不能完整读取。");
  const paths = tree.tree.filter(
    (entry: any) => entry.type === "blob" && allowedPath(entry.path),
  );
  const results: Base[] = [];
  for (let i = 0; i < paths.length; i += 8)
    results.push(
      ...(await Promise.all(
        paths
          .slice(i, i + 8)
          .map((p: any) => readFile(env, p.path, ref.object.sha)),
      )),
    );
  return results;
}
export async function commitFiles(
  env: Env,
  base: string,
  branch: string,
  files: {
    path: string;
    source?: string;
    bytes?: ArrayBuffer;
    remove?: boolean;
  }[],
  message: string,
) {
  const old = await gh(env, `/git/commits/${base}`);
  const tree = [];
  for (const file of files) {
    if (file.remove) {
      tree.push({ path: file.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    let content = file.source,
      encoding = "utf-8";
    if (file.bytes) {
      const bytes = new Uint8Array(file.bytes);
      let str = "";
      for (let i = 0; i < bytes.length; i += 8192)
        str += String.fromCharCode(...bytes.subarray(i, i + 8192));
      content = btoa(str);
      encoding = "base64";
    }
    const blob = await gh(env, "/git/blobs", "POST", { content, encoding });
    tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const next = await gh(env, "/git/trees", "POST", {
    base_tree: old.tree.sha,
    tree,
  });
  const commit = await gh(env, "/git/commits", "POST", {
    message,
    tree: next.sha,
    parents: [base],
  });
  // Never force-update: the deterministic branch can be reused after an interrupted request.
  try {
    await gh(env, "/git/refs", "POST", {
      ref: "refs/heads/" + branch,
      sha: commit.sha,
    });
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 409) throw error;
    const existing = await gh(env, "/git/ref/heads/" + branch);
    return existing.object.sha as string;
  }
  return commit.sha as string;
}
export async function canonicalUrls(env: Env): Promise<Record<string, string>> {
  try {
    const result = await fetch(env.SITE_URL + "/content-manifest.json", {
      headers: { "Cache-Control": "no-cache" },
    });
    if (result.ok)
      return ((await result.json()) as { posts: Record<string, string> }).posts;
  } catch {
    /* No deployed manifest yet; new articles still have explicit permalinks. */
  }
  return {};
}
export function legacyUrl(base: Base, meta: any) {
  if (meta.permalink) return "/" + String(meta.permalink).replace(/^\//, "");
  return (
    "/" +
    String(meta.date).slice(0, 10).replaceAll("-", "/") +
    "/" +
    base.path.replace(/^source\/_posts\//, "").replace(/\.md$/, "") +
    "/"
  );
}

export async function contentBytes(
  env: Env,
  file: any,
  limit = 10 * 1024 * 1024,
) {
  if (file.size > limit) throw new HttpError(400, "文件过大，暂不能自动处理。");
  const blob =
    file.encoding === "base64" ? file : await gh(env, `/git/blobs/${file.sha}`);
  if (blob.encoding !== "base64")
    throw new HttpError(502, "文件编码不可读取。");
  const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, "")), (c) =>
    c.charCodeAt(0),
  );
  if (bytes.byteLength > limit)
    throw new HttpError(400, "文件过大，暂不能自动处理。");
  return bytes;
}
