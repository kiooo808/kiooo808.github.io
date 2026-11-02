import {
  Content,
  Home,
  HOME_PATH,
  entries,
  newEntry,
  identity,
  selectedEntry,
  sameContent,
} from "../shared/content";
import { Env, HttpError, json, now, demo } from "./types";
import { assetPlan, purgePrivate, privateMediaPlan } from "./lifecycle";
import { processQueue } from "./publish";
type Dependencies = {
  list: () => Promise<Content[]>;
  insert: (value: Content) => Promise<any>;
};
const active = "'queued','checking','deploying','verifying'";
async function records(env: Env, deps: Dependencies) {
  const raw = await deps.list(),
    home = raw.find((c) => c.kind === "home") as Home | undefined;
  const published = raw.flatMap<Content>((c) =>
    c.kind === "home" ? entries(c.base) : [c],
  );
  const drafts = (
    await env.DB.prepare(
      "SELECT * FROM drafts WHERE trashed=0 ORDER BY updated DESC",
    ).all<any>()
  ).results.map((d) => ({ ...d, payload: JSON.parse(d.payload) }));
  const trash = (
    await env.DB.prepare("SELECT * FROM trash ORDER BY created DESC").all<any>()
  ).results;
  const jobs = (
    await env.DB.prepare(
      "SELECT * FROM publications ORDER BY created DESC",
    ).all<any>()
  ).results;
  return { home, published, drafts, trash, jobs };
}
function typeOf(c: Content) {
  return c.kind === "post" ? c.section : c.scope || "legacy";
}
function summary(
  key: string,
  c: Content,
  published: Content | undefined,
  draft: any,
) {
  const item = c.kind === "home" && c.scope ? selectedEntry(c) : null;
  return {
    busy: false,
    canEdit: true,
    key,
    title: item?.title || c.title || "未命名内容",
    type: typeOf(c),
    description: item?.description || (c.kind === "post" ? c.description : ""),
    url:
      published?.base?.url ||
      (published?.kind === "home" && published.scope === "project"
        ? `/projects/${selectedEntry(published).slug}/`
        : undefined),
    draftId: draft?.id,
    version: draft?.version,
    updated:
      draft?.updated || item?.updated || (c.kind === "post" ? c.date : ""),
    published: !!published,
    hasDraft: !!draft && (!published || !sameContent(draft.payload, published)),
    state: published
      ? draft && !sameContent(draft.payload, published)
        ? "修改待发布"
        : "已发布"
      : "私密草稿",
    token: JSON.stringify([
      published?.base?.sha || "",
      draft?.id || "",
      draft?.version || 0,
    ]),
    order: item?.order || 0,
  };
}
export async function management(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: Dependencies,
  data: any = {},
): Promise<Response | undefined> {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (!path.startsWith("/api/manage")) return;
  if (path === "/api/manage/assets" && method === "GET") {
    const row = await env.DB.prepare("SELECT assets FROM trash WHERE id=?")
      .bind(url.searchParams.get("trash"))
      .first<any>();
    if (!row) throw new HttpError(404, "回收站附件不存在。");
    const assets = JSON.parse(row.assets);
    const assetPath = url.searchParams.get("path");
    const typeOfAsset = (route: string) =>
      route.endsWith(".pdf")
        ? "application/pdf"
        : /\.jpe?g$/i.test(route)
          ? "image/jpeg"
          : route.endsWith(".webp")
            ? "image/webp"
            : route.endsWith(".gif")
              ? "image/gif"
              : "image/png";
    if (!assetPath)
      return json(
        assets.map((asset: any) => ({
          route: asset.route,
          type: typeOfAsset(asset.route),
          url:
            "/api/manage/assets?trash=" +
            encodeURIComponent(url.searchParams.get("trash")!) +
            "&path=" +
            encodeURIComponent(asset.route),
        })),
      );
    const asset = assets.find((value: any) => value.route === assetPath);
    if (!asset) throw new HttpError(404, "附件不存在。");
    const object = await env.MEDIA.get(asset.archive);
    if (!object) throw new HttpError(404, "附件不存在。");
    const type = typeOfAsset(asset.route);
    return new Response(object.body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(type === "application/pdf"
          ? { "Content-Disposition": "attachment" }
          : {}),
      },
    });
  }
  const state = await records(env, deps),
    map = new Map<string, any>();
  for (const value of state.published)
    map.set(identity(value), { published: value });
  for (const draft of state.drafts) {
    if (draft.payload.kind === "home" && !draft.payload.scope) continue;
    const key = identity(draft.payload, draft.id),
      row = map.get(key) || {};
    if (!row.draft) row.draft = draft;
    map.set(key, row);
  }
  // Main can already contain a deletion while Pages still serves the old site.
  // Keep the in-flight operation visible until its deployment is verified.
  for (const job of state.jobs) {
    if (job.action === "publish" || !job.target_key || map.has(job.target_key) ||
        !["queued", "checking", "deploying", "verifying"].includes(job.status)) continue;
    const value = JSON.parse(job.payload);
    if (value.kind === "post" || value.kind === "home")
      map.set(job.target_key, { published: value });
  }
  const items = [...map].map(([key, row]) => {
    const value = row.draft?.payload || row.published;
    const entry = summary(key, value, row.published, row.draft),
      relatedJobs = state.jobs.filter(
        (j) => j.target_key === key || j.draft_id === row.draft?.id,
      ),
      job = relatedJobs.find((j) => ["queued", "checking", "deploying", "verifying"].includes(j.status)) || relatedJobs[0];
    if (
      job &&
      ["queued", "checking", "deploying", "verifying"].includes(job.status)
    ) {
      entry.state =
        job.action !== "publish"
          ? "删除处理中"
          : (
              {
                queued: "排队中",
                checking: "检查中",
                deploying: "部署中",
                verifying: "核对上线",
              } as any
            )[job.status];
      entry.busy = true;
      entry.canEdit = job.action === "publish";
    } else if (job && ["failed", "conflict"].includes(job.status)) {
      entry.state = job.action !== "publish" ? "删除失败" : "发布失败";
      (entry as any).error = job.error;
    }
    return entry;
  });
  for (const row of state.trash) {
    const value = JSON.parse(row.payload),
      draft = state.drafts.find((d) => d.payload.restoreId === row.id);
    const entry = {
      ...summary(
        row.content_key,
        value,
        row.was_published ? value : undefined,
        draft,
      ),
      state: "回收站",
      token: JSON.stringify([
        row.id,
        row.created,
        draft?.id || "",
        draft?.version || 0,
      ]),
      trashId: row.id,
      updated: row.created,
      published: !!row.was_published,
    };
    const i = items.findIndex((x) => x.key === entry.key);
    if (i >= 0) items[i] = entry;
    else items.push(entry);
  }
  if (path === "/api/manage" && method === "GET")
    return json({
      items: items.sort((a, b) => b.updated.localeCompare(a.updated)),
      legacy: state.drafts
        .filter((d) => d.payload.kind === "home" && !d.payload.scope)
        .map((d) => ({ id: d.id, updated: d.updated, title: "旧首页草稿" })),
    });
  if (path === "/api/manage/new" && method === "POST") {
    if (!state.home || !["project", "focus", "intro"].includes(data.scope))
      throw new HttpError(400, "内容类型不正确。");
    if (data.scope === "intro") {
      const existing = state.drafts.find(
        (d) => d.payload.kind === "home" && d.payload.scope === "intro",
      );
      if (existing) return json(existing);
      return json(await deps.insert(entries(state.home.base)[0]), 201);
    }
    return json(await deps.insert(newEntry(state.home.base, data.scope)), 201);
  }
  if (path === "/api/manage/legacy" && method === "POST") {
    const draft = state.drafts.find(
      (d) => d.id === data.id && d.payload.kind === "home" && !d.payload.scope,
    );
    if (!draft) throw new HttpError(404, "旧草稿不存在。");
    if (data.export) return json(draft.payload);
    const choices = entries(draft.payload.base).filter(
      (x) => x.scope !== "intro",
    );
    const legacy = entries({
      ...draft.payload.base,
      source: (await import("yaml")).stringify(draft.payload.data),
    });
    if (!data.entryId)
      return json({
        items: legacy.map((x) => ({
          entryId: x.entryId,
          scope: x.scope,
          title: x.title,
        })),
      });
    const selected = legacy.find(
      (x) => x.entryId === data.entryId && x.scope === data.scope,
    );
    if (!selected || !state.home) throw new HttpError(400, "请选择条目。");
    // Keep the original public baseline; importing never publishes other draft changes.
    selected.base = draft.payload.base;
    const imported=await deps.insert(selected);
    const reference=selected.scope==="intro"?"":JSON.stringify(selectedEntry(selected));
    for(const match of reference.matchAll(/\/api\/media\/([0-9a-f-]{36})/g)) {
      const owned=await env.DB.prepare("SELECT id FROM media WHERE id=? AND (draft_id=? OR id IN (SELECT media_id FROM media_links WHERE draft_id=?))").bind(match[1],draft.id,draft.id).first();
      if(owned) await env.DB.prepare("INSERT OR IGNORE INTO media_links(draft_id,media_id) VALUES(?,?)").bind(imported.id,match[1]).run();
    }
    return json(imported,201);
  }
  const row = map.get(data.key),
    item = items.find((x) => x.key === data.key),
    trash = state.trash.find((t) => t.content_key === data.key);
  if (path === "/api/manage/open" && method === "POST") {
    if (data.choice === "published") {
      if (!row?.published) throw new HttpError(404, "线上内容不存在。");
      return json({ content: row.published });
    }
    if (row?.draft) return json(row.draft);
    if (!row?.published) throw new HttpError(404, "内容不存在。");
    return json(await deps.insert(row.published), 201);
  }
  if (path === "/api/manage/restore" && method === "POST") {
    if (!trash) throw new HttpError(404, "回收站内容不存在。");
    const existing = state.drafts.find((d) => d.payload.restoreId === trash.id);
    if (existing) return json(existing);
    const payload = JSON.parse(trash.payload) as Content;
    if (!trash.was_published) {
      const old = (
        await env.DB.prepare(
          "SELECT * FROM drafts WHERE trashed=1 ORDER BY updated DESC",
        ).all<any>()
      ).results.find(
        (d) => identity(JSON.parse(d.payload), d.id) === trash.content_key,
      );
      if (!old) throw new HttpError(409, "原草稿缺失，无法恢复。");
      await env.DB.batch([
        env.DB.prepare("UPDATE drafts SET trashed=0 WHERE id=?").bind(old.id),
        env.DB.prepare("DELETE FROM trash WHERE id=?").bind(trash.id),
      ]);
      return json({ ...old, trashed: 0, payload: JSON.parse(old.payload) });
    }
    payload.restoreId = trash.id;
    const draft = await deps.insert(payload);
    for (const m of JSON.stringify(payload).matchAll(
      /\/api\/media\/([0-9a-f-]{36})/g,
    ))
      await env.DB.prepare(
        "INSERT OR IGNORE INTO media_links(draft_id,media_id) VALUES(?,?)",
      )
        .bind(draft.id, m[1])
        .run();
    return json(draft, 201);
  }
  if (path === "/api/manage/delete-preview" && method === "POST") {
    const value =
      row?.published ||
      (trash ? JSON.parse(trash.payload) : row?.draft?.payload);
    if (
      !value ||
      (value.kind === "home" && (!value.scope || value.scope === "intro"))
    )
      throw new HttpError(400, "这项内容不能删除。");
    if (item?.busy)
      throw new HttpError(409, "内容有正在处理的任务，请等待结束。");
    const assets =
      row?.published && !demo(env, url)
        ? await assetPlan(env, value)
        : { remove: trash ? JSON.parse(trash.assets) : [], keep: [] };
    const privateAssets = await privateMediaPlan(env, data.key, value);
    assets.remove.push(...privateAssets.remove);
    assets.keep.push(...privateAssets.keep);
    return json({
      key: data.key,
      title: item?.title || value.title,
      url: item?.url,
      token: item?.token || trash?.id,
      published: !!row?.published || !!trash?.was_published,
      remove: assets.remove.map((x: any) => x.path),
      keep: assets.keep,
    });
  }
  if (path === "/api/manage/delete" && method === "POST") {
    if (!["trash", "purge"].includes(data.mode))
      throw new HttpError(400, "删除方式不正确。");
    const existing = state.jobs.find(
      (j) =>
        j.target_key === data.key &&
        ["queued", "checking", "deploying", "verifying"].includes(j.status),
    );
    if (existing) return json({ jobId: existing.id }, 202);
    if (!item && !trash) throw new HttpError(404, "内容不存在。");
    if (data.token !== (item?.token || trash?.id))
      throw new HttpError(409, "确认期间内容已变化，请重新检查。");
    const value: Content =
      row?.published ||
      (trash ? JSON.parse(trash.payload) : row?.draft?.payload);
    if (value.kind === "home" && (!value.scope || value.scope === "intro"))
      throw new HttpError(400, "首页简介不能删除。");
    const published = !!row?.published || !!trash?.was_published;
    if (!published) {
      const draft =
        row?.draft ||
        (
          await env.DB.prepare(
            "SELECT * FROM drafts WHERE trashed=1",
          ).all<any>()
        ).results.find(
          (d) => identity(JSON.parse(d.payload), d.id) === data.key,
        );
      if (!draft) throw new HttpError(404, "草稿不存在。");
      if (!trash) {
        const lock = await env.DB.prepare(
          "UPDATE drafts SET trashed=1 WHERE id=? AND version=? AND trashed=0",
        )
          .bind(draft.id, draft.version)
          .run();
        if (!lock.meta.changes)
          throw new HttpError(409, "草稿已变化，请刷新。");
      }
      if (data.mode === "trash")
        await env.DB.prepare(
          "INSERT OR IGNORE INTO trash(id,content_key,payload,created,was_published) VALUES(?,?,?,?,0)",
        )
          .bind(crypto.randomUUID(), data.key, JSON.stringify(value), now())
          .run();
      else {
        await purgePrivate(env, data.key, value);
        await env.DB.prepare("DELETE FROM trash WHERE content_key=?")
          .bind(data.key)
          .run();
      }
      return json({ complete: true });
    }
    if (demo(env, url))
      throw new HttpError(
        409,
        "本地演示不撤下真实网站；可用私密测试草稿体验回收站。",
      );
    if (env.PUBLISH_PAUSED === "true")
      throw new HttpError(503, "发布维护中，请稍后操作。");
    if (trash && data.mode === "trash") return json({ complete: true });
    const id = crypto.randomUUID(),
      stamp = now(),
      payload = JSON.stringify(value);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO drafts(id,kind,payload,version,updated,trashed) VALUES(?,?,?,1,?,1)",
      ).bind(id, value.kind, payload, stamp),
      env.DB.prepare(
        "INSERT OR IGNORE INTO publications(id,draft_id,version,status,payload,created,updated,action,target_key,trash_id) VALUES(?,?,1,'queued',?,?,?,?,?,?)",
      ).bind(
        id,
        id,
        payload,
        stamp,
        stamp,
        data.mode,
        data.key,
        trash?.id || null,
      ),
    ]);
    const job = await env.DB.prepare(
      `SELECT id FROM publications WHERE target_key=? AND status IN (${active})`,
    )
      .bind(data.key)
      .first<any>();
    ctx.waitUntil(processQueue(env));
    return json({ jobId: job.id }, 202);
  }
  throw new HttpError(404, "管理接口不存在。");
}
