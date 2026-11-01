import { Env, HttpError } from "./types";
import { b64 } from "./auth";
import { Base, HOME_PATH, allowedPath } from "../shared/content";
const encoder = new TextEncoder();
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
  const bytes = Uint8Array.from(
    atob(env.GITHUB_PRIVATE_KEY.replace(/-----[^-]+-----|\s/g, "")),
    (x) => x.charCodeAt(0),
  );
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
export async function gh<T = any>(
  env: Env,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
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
  return text ? (JSON.parse(text) as T) : (undefined as T);
}
export async function readFile(
  env: Env,
  path: string,
  ref = "main",
): Promise<Base> {
  if (!allowedPath(path))
    throw new HttpError(400, "这个文件不属于内容管理范围。");
  const value = await gh(
    env,
    `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
  );
  if (value.type !== "file" || value.encoding !== "base64")
    throw new HttpError(400, "无法读取内容文件。");
  const source = new TextDecoder().decode(
    Uint8Array.from(atob(value.content.replace(/\s/g, "")), (x) =>
      x.charCodeAt(0),
    ),
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
  files: { path: string; source?: string; bytes?: ArrayBuffer }[],
  message: string,
) {
  const old = await gh(env, `/git/commits/${base}`);
  const tree = [];
  for (const file of files) {
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
