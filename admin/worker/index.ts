import { Env, HttpError, json, demo, now } from "./types";
import { authRoute, requireUser, sameOrigin } from "./auth";
import {
  Content,
  HOME_PATH,
  readContent,
  serializeContent,
  splitArticle,
  identity,
  sameContent,
} from "../shared/content";
import { readAll, readFile, canonicalUrls, legacyUrl } from "./github";
import { management } from "./management";
import { createPublication, processQueue } from "./publish";
async function limitedBody(request: Request, limit: number) {
  if (Number(request.headers.get("Content-Length")) > limit)
    throw new HttpError(413, "内容或附件过大。");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, "内容或附件超过大小限制。");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
async function body(request: Request) {
  const text = new TextDecoder().decode(await limitedBody(request, 2_000_000));
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "请求格式不正确。");
  }
}
function validDraft(payload: any): asserts payload is Content {
  if (
    !payload ||
    !["post", "home"].includes(payload.kind) ||
    typeof payload.title !== "string" ||
    (payload.kind === "post" && typeof payload.body !== "string")
  )
    throw new HttpError(400, "草稿格式不正确。");
  if (
    payload.kind === "home" &&
    (!payload.data ||
      Array.isArray(payload.data) ||
      typeof payload.data !== "object" ||
      payload.base?.path !== HOME_PATH ||
      (payload.scope && !["project", "focus", "intro"].includes(payload.scope)))
  )
    throw new HttpError(400, "首页条目格式不正确。");
}
async function insertDraft(env: Env, payload: Content) {
  const id = crypto.randomUUID(),
    created = now(),
    data = JSON.stringify(payload);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO drafts(id,kind,payload,version,updated) VALUES(?,?,?,1,?)",
    ).bind(id, payload.kind, data, created),
    env.DB.prepare(
      "INSERT INTO versions(draft_id,version,payload,created) VALUES(?,1,?,?)",
    ).bind(id, data, created),
  ]);
  return { id, payload, version: 1, published_version: 0, updated: created };
}
async function contentList(env: Env, url: URL) {
  const bases = demo(env, url)
    ? (
        await env.DB.prepare("SELECT * FROM demo_content").all<any>()
      ).results.map((row) => ({ ...row, source: row.content }))
    : await readAll(env);
  const urls = demo(env, url) ? {} : await canonicalUrls(env);
  return bases.map((base) => {
    if (base.path !== HOME_PATH)
      base.url =
        base.url ||
        urls[base.path] ||
        legacyUrl(base, splitArticle(base.source).meta);
    return readContent(base);
  });
}
export async function api(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (path === "/api/config")
    return json({
      demo: demo(env, url),
      configured: !!(
        env.GITHUB_CLIENT_ID &&
        env.GITHUB_CLIENT_SECRET &&
        env.OWNER_ID &&
        env.PUBLIC_ORIGIN &&
        env.GITHUB_APP_ID &&
        env.GITHUB_INSTALLATION_ID &&
        env.GITHUB_PRIVATE_KEY
      ),
      owner: env.OWNER_LOGIN,
      site: env.SITE_URL,
    });
  if (path.startsWith("/api/auth/")) return authRoute(request, env, url);
  await requireUser(request, env);
  if (!["GET", "HEAD"].includes(method)) sameOrigin(request, env);
  if (path.startsWith("/api/manage")) {
    if (Number(request.headers.get("Content-Length")) > 2000000)
      throw new HttpError(413, "请求过大。");
    return (await management(
      request,
      env,
      ctx,
      {
        list: () => contentList(env, url),
        insert: (payload) => insertDraft(env, payload),
      },
      method === "GET" ? {} : await body(request),
    ))!;
  }
  if (path === "/api/me")
    return json({ login: env.OWNER_LOGIN, demo: demo(env, url) });
  if (path === "/api/content" && method === "GET")
    return json(await contentList(env, url));
  if (path === "/api/drafts" && method === "GET") {
    const result = await env.DB.prepare(
      "SELECT * FROM drafts WHERE trashed=0 ORDER BY updated DESC",
    ).all<any>();
    return json(
      result.results.map((row) => ({
        ...row,
        payload: JSON.parse(row.payload),
      })),
    );
  }
  if (path === "/api/drafts" && method === "POST") {
    const value = await body(request);
    validDraft(value.payload);
    return json(await insertDraft(env, value.payload), 201);
  }
  const draftMatch = path.match(
    /^\/api\/drafts\/([0-9a-f-]{36})(?:\/(versions|conflicts))?$/,
  );
  if (draftMatch) {
    const id = draftMatch[1];
    if (draftMatch[2]) {
      if (method !== "GET") throw new HttpError(405, "请求方式不支持。");
      const table = draftMatch[2];
      const current = await env.DB.prepare(
        "SELECT payload FROM drafts WHERE id=?",
      )
        .bind(id)
        .first<any>();
      if (!current) throw new HttpError(404, "草稿不存在。");
      const key = identity(JSON.parse(current.payload), id);
      const related = (
        await env.DB.prepare("SELECT id,payload FROM drafts").all<any>()
      ).results
        .filter((d) => identity(JSON.parse(d.payload), d.id) === key)
        .map((d) => d.id);
      if (table === "versions") {
        const result = await env.DB.prepare(
          `SELECT * FROM versions WHERE draft_id IN (${related.map(() => "?").join(",")}) ORDER BY created DESC,version DESC LIMIT 100`,
        )
          .bind(...related)
          .all<any>();
        return json(
          result.results.map((row) => ({
            ...row,
            payload: JSON.parse(row.payload),
          })),
        );
      }
      const result = await env.DB.prepare(
        `SELECT * FROM ${table} WHERE draft_id=? ORDER BY ${table === "versions" ? "version" : "created"} DESC LIMIT 100`,
      )
        .bind(id)
        .all<any>();
      return json(
        result.results.map((row) => ({
          ...row,
          payload: JSON.parse(row.payload),
        })),
      );
    }
    const draft = await env.DB.prepare("SELECT * FROM drafts WHERE id=?")
      .bind(id)
      .first<any>();
    if (!draft || draft.trashed)
      throw new HttpError(404, "草稿不存在或已在回收站中。");
    if (method === "GET")
      return json({ ...draft, payload: JSON.parse(draft.payload) });
    if (method === "PUT") {
      const value = await body(request);
      validDraft(value.payload);
      const key = identity(JSON.parse(draft.payload), id);
      if (identity(value.payload, id) !== key)
        throw new HttpError(400, "不能更改内容身份或文件路径。");
      const deleting = await env.DB.prepare(
        "SELECT id FROM publications WHERE target_key=? AND action!='publish' AND status IN ('queued','checking','deploying','verifying')",
      )
        .bind(key)
        .first();
      if (deleting)
        throw new HttpError(
          409,
          "内容正在删除，不能覆盖保存；请先导出本机未同步内容。",
        );
      if (
        value.version === draft.version &&
        sameContent(JSON.parse(draft.payload), value.payload)
      )
        return json({ ...draft, payload: JSON.parse(draft.payload) });
      const text = JSON.stringify(value.payload),
        next = Number(value.version) + 1,
        updated = now();
      if (!Number.isInteger(next))
        throw new HttpError(400, "草稿版本号不正确。");
      const results = await env.DB.batch([
        env.DB.prepare(
          "UPDATE drafts SET payload=?,version=?,updated=? WHERE id=? AND version=? AND trashed=0",
        ).bind(text, next, updated, id, value.version),
        env.DB.prepare(
          "INSERT OR IGNORE INTO versions(draft_id,version,payload,created) SELECT id,version,payload,updated FROM drafts WHERE id=? AND version=? AND payload=?",
        ).bind(id, next, text),
      ]);
      if (!results[0].meta.changes) {
        const conflictId = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO conflicts(id,draft_id,payload,created) VALUES(?,?,?,?)",
        )
          .bind(conflictId, id, text, updated)
          .run();
        const latest = await env.DB.prepare("SELECT * FROM drafts WHERE id=?")
          .bind(id)
          .first<any>();
        throw new HttpError(
          409,
          "另一台设备已更新这份草稿。两个版本均已保留。",
          {
            conflictId,
            latest: { ...latest, payload: JSON.parse(latest.payload) },
          },
        );
      }
      return json({
        id,
        payload: value.payload,
        version: next,
        updated,
        published_version: draft.published_version,
      });
    }
  }
  if (path === "/api/preview" && method === "POST") {
    const value = await body(request);
    try {
      return json(
        serializeContent(value.payload, value.id || crypto.randomUUID()),
      );
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
  }
  if (path === "/api/media" && method === "POST") {
    if (Number(request.headers.get("Content-Length")) > 10 * 1024 * 1024)
      throw new HttpError(413, "附件不能超过 10MB。");
    const id = crypto.randomUUID(),
      draftId = url.searchParams.get("draft");
    if (
      !draftId ||
      !(await env.DB.prepare("SELECT id FROM drafts WHERE id=? AND trashed=0")
        .bind(draftId)
        .first())
    )
      throw new HttpError(400, "请先保存草稿，再上传附件。");
    const name = decodeURIComponent(
      request.headers.get("X-File-Name") || "attachment",
    )
      .replace(/[\\/\u0000-\u001f]/g, "_")
      .slice(0, 150);
    const type = request.headers.get("Content-Type") || "";
    if (
      ![
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "application/pdf",
      ].includes(type)
    )
      throw new HttpError(400, "仅支持 JPG、PNG、WebP、GIF 图片和 PDF。");
    const data = (await limitedBody(request, 10 * 1024 * 1024))
      .buffer as ArrayBuffer;
    if (!data.byteLength || data.byteLength > 10 * 1024 * 1024)
      throw new HttpError(413, "附件必须大于 0 且不超过 10MB。");
    const bytes = new Uint8Array(data),
      signature = [...bytes.slice(0, 12)];
    const magic =
      type === "application/pdf"
        ? String.fromCharCode(...signature.slice(0, 5)) === "%PDF-"
        : type === "image/png"
          ? signature.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
          : type === "image/jpeg"
            ? signature[0] === 255 &&
              signature[1] === 216 &&
              signature[2] === 255
            : type === "image/gif"
              ? String.fromCharCode(...signature.slice(0, 3)) === "GIF"
              : String.fromCharCode(...signature.slice(0, 4)) === "RIFF" &&
                String.fromCharCode(...signature.slice(8, 12)) === "WEBP";
    if (!magic)
      throw new HttpError(400, "文件内容与类型不符，请选择有效的图片或 PDF。");
    await env.MEDIA.put(id, data, { httpMetadata: { contentType: type } });
    await env.DB.prepare(
      "INSERT INTO media(id,draft_id,name,type,size,created) VALUES(?,?,?,?,?,?)",
    )
      .bind(id, draftId, name, type, data.byteLength, now())
      .run();
    return json({ id, name, type, url: "/api/media/" + id }, 201);
  }
  const mediaMatch = path.match(/^\/api\/media\/([0-9a-f-]{36})$/);
  if (mediaMatch && method === "GET") {
    const row = await env.DB.prepare("SELECT * FROM media WHERE id=?")
      .bind(mediaMatch[1])
      .first<any>();
    const object = row && (await env.MEDIA.get(row.id));
    if (!object) throw new HttpError(404, "附件不存在。");
    return new Response(object.body, {
      headers: {
        "Content-Type": row.type,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${row.type === "application/pdf" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      },
    });
  }
  if (path === "/api/publications" && method === "GET") {
    const jobs = await env.DB.prepare(
      "SELECT * FROM publications ORDER BY created DESC LIMIT 100",
    ).all<any>();
    // Do not expose immutable payloads in status polling.
    return json(
      jobs.results.map(({ payload, before_payload, ...job }) => ({
        ...job,
        title: JSON.parse(payload).title,
        operation: JSON.parse(payload).restoreId
          ? "restore"
          : job.action || "publish",
        canRestore:
          !!before_payload && (!job.action || job.action === "publish"),
      })),
    );
  }
  if (path === "/api/publications" && method === "POST") {
    if (demo(env, url))
      throw new HttpError(
        409,
        "本地演示不会写入 GitHub。编辑、保存与预览可正常使用，正式发布需完成在线配置。",
      );
    const value = await body(request);
    const job = await createPublication(
      env,
      value.draftId,
      Number(value.version),
      !!value.retry,
    );
    ctx.waitUntil(processQueue(env));
    return json({ id: job!.id, status: job!.status }, 202);
  }
  const restoreMatch = path.match(
    /^\/api\/publications\/([0-9a-f-]{36})\/restore$/,
  );
  if (restoreMatch && method === "POST") {
    const job = await env.DB.prepare(
      "SELECT * FROM publications WHERE id=? AND status='published' AND action='publish'",
    )
      .bind(restoreMatch[1])
      .first<any>();
    if (!job?.before_payload)
      throw new HttpError(400, "该记录没有可恢复的上一版内容。");
    const payload = JSON.parse(job.before_payload) as Content;
    const current = await readFile(env, payload.base!.path);
    current.url = payload.base!.url;
    payload.base = current;
    return json(await insertDraft(env, payload), 201);
  }
  throw new HttpError(404, "接口不存在。");
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    try {
      if (new URL(request.url).pathname.startsWith("/api/"))
        return await api(request, env, ctx);
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("X-Frame-Options", "DENY");
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      );
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      if (error instanceof HttpError)
        return json({ error: error.message, ...error.extra }, error.status);
      console.error(
        "Studio request failed",
        error instanceof Error ? error.name : "unknown",
      );
      return json({ error: "服务暂时不可用，请稍后重试。" }, 500);
    }
  },
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires<?").bind(Date.now()),
      env.DB.prepare("DELETE FROM oauth_states WHERE expires<?").bind(
        Date.now(),
      ),
    ]);
    if (env.LOCAL_DEMO !== "true") ctx.waitUntil(processQueue(env));
  },
};
