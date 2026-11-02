import { parseDocument, parse } from "yaml";
import {
  stableJSON,
  comparableEntry,
  Content,
  Home,
  HOME_PATH,
  LIFECYCLE_PATH,
  identity,
  selectedEntry,
  entryFromSource,
  entryKey,
  readContent,
  sameContent,
  serializeContent,
} from "../shared/content";
import { Env, HttpError, Publication, now } from "./types";
import { gh, readFile, contentBytes } from "./github";
export type Change = {
  path: string;
  source?: string;
  bytes?: ArrayBuffer;
  remove?: boolean;
};
export async function optionalFile(env: Env, path: string, ref = "main") {
  try {
    return await readFile(env, path, ref);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}
export async function lifecycle(env: Env, ref = "main") {
  const base = await optionalFile(env, LIFECYCLE_PATH, ref);
  return base ? JSON.parse(base.source) : {};
}
export function rebaseEntry(
  value: Home,
  current: any,
  restoring = false,
): Home {
  const original = entryFromSource(value.base, value.scope, value.entryId!);
  const latest = entryFromSource(current, value.scope, value.entryId!);
  if (
    restoring
      ? !!latest
      : stableJSON(comparableEntry(original, value.entryId!)) !==
        stableJSON(comparableEntry(latest, value.entryId!))
  )
    throw new HttpError(409, "同一条目已在仓库中变化，请重新载入后合并修改。");
  const data = parse(current.source),
    item = selectedEntry(value);
  if (value.scope === "intro") data.description = value.data.description;
  else {
    const key = value.scope === "project" ? "projects" : "recent_focus";
    const i = data[key].findIndex(
      (p: any, n: number) => entryKey(p, value.scope!, n) === value.entryId,
    );
    if (i < 0) data[key].push(item);
    else data[key][i] = item;
  }
  return { ...value, base: current, data };
}
export function removeEntry(source: string, value: Home) {
  const doc = parseDocument(source),
    key = value.scope === "project" ? "projects" : "recent_focus";
  const items = doc.toJS()[key] || [],
    list: any = doc.get(key, true);
  const index = items.findIndex(
    (p: any, i: number) =>
      entryKey(p, value.scope!, i) === value.entryId ||
      (!p.id &&
        value.scope === "focus" &&
        p.title === selectedEntry(value)?.title),
  );
  if (index >= 0) list.items.splice(index, 1);
  return doc.toString();
}
const publicUrl = (value: Content) =>
  value.kind === "post"
    ? value.base?.url
    : value.scope === "project"
      ? `/projects/${selectedEntry(value).slug}/`
      : undefined;
export const normalizedUrl = (value: string) =>
  decodeURIComponent(value).replace(/^\/+/, "/");
function routeForAsset(value: Content, path: string) {
  if (path.startsWith("source/images/")) return path.slice(7);
  const dir =
    value.kind === "post" ? value.base!.path.replace(/\.md$/, "/") : "";
  return dir && path.startsWith(dir)
    ? normalizedUrl(value.base!.url!).slice(1) + path.slice(dir.length)
    : "";
}
async function assetBytes(env: Env, path: string, ref: string) {
  const file = await gh(
    env,
    `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
  );
  if (file.type !== "file" || file.size > 10 * 1024 * 1024)
    throw new HttpError(400, "附件过大或不可读取，暂不能自动清理。");
  return (await contentBytes(env, file)).buffer as ArrayBuffer;
}
export async function assetPlan(env: Env, value: Content, ref = "main") {
  if (!value.base) return { remove: [] as any[], keep: [] as string[] };
  if (ref === "main") ref = (await gh(env, "/git/ref/heads/main")).object.sha;
  const tree = await gh(env, `/git/trees/${ref}?recursive=1`);
  if (tree.truncated)
    throw new HttpError(502, "仓库目录不完整，不能安全清理附件。");
  const own = JSON.stringify(value),
    dir = value.kind === "post" ? value.base.path.replace(/\.md$/, "/") : "";
  const candidates = tree.tree.filter(
    (p: any) =>
      p.type === "blob" &&
      /\.(png|jpe?g|gif|webp|pdf)$/i.test(p.path) &&
      ((dir && p.path.startsWith(dir)) ||
        (/^source\/images\/uploads\/[0-9a-f-]{36}\./.test(p.path) &&
          own.includes(p.path.slice(7)))),
  );
  if (!candidates.length) return { remove: [], keep: [] };
  const sources = tree.tree.filter(
    (p: any) =>
      p.type === "blob" &&
      p.path.startsWith("source/") &&
      p.path !== value.base!.path &&
      /\.(md|html|yml|yaml|json|css|js)$/i.test(p.path),
  );
  let other = "";
  for (const file of sources) {
    const raw = await gh(
      env,
      `/contents/${file.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
    );
    if (raw.size > 2000000)
      return {
        remove: [],
        keep: candidates.map((p: any) => p.path + "（存在未扫描的大文件）"),
      };
    let text = new TextDecoder().decode(await contentBytes(env, raw, 2000000));
    if (file.path === HOME_PATH && value.kind === "home")
      text = removeEntry(text, value);
    other += "\n" + text;
  }
  const remove: any[] = [],
    keep: string[] = [];
  for (const candidate of candidates) {
    const route = routeForAsset(value, candidate.path),
      name = candidate.path.split("/").pop();
    if (!route || other.includes(route) || other.includes(name))
      keep.push(candidate.path + "（共享或无法确认独占）");
    else remove.push({ path: candidate.path, route });
  }
  return { remove, keep };
}
export async function prepareDeletion(env: Env, job: Publication, ref: string) {
  const value = JSON.parse(job.payload) as Content,
    key = job.target_key || identity(value, job.draft_id);
  const existing = job.trash_id
    ? await env.DB.prepare("SELECT * FROM trash WHERE id=? AND content_key=?")
        .bind(job.trash_id, key)
        .first<any>()
    : null;
  const registry = await lifecycle(env, ref),
    url = publicUrl(value),
    trashId = existing?.id || job.id;
  let assets: any[] = existing ? JSON.parse(existing.assets) : [],
    keep: string[] = [],
    files: Change[] = [];
  if (!existing) {
    if (value.kind === "home") {
      const latest = await readFile(env, HOME_PATH, ref);
      rebaseEntry(value, latest);
      files.push({
        path: HOME_PATH,
        source: removeEntry(latest.source, value),
      });
    } else {
      const latest = await readFile(env, value.base!.path, ref);
      if (latest.sha !== value.base!.sha)
        throw new HttpError(409, "内容已变化，删除前请重新载入。");
      files.push({ path: value.base!.path, remove: true });
    }
    const plan = await assetPlan(env, value, ref);
    keep = plan.keep;
    assets = [];
    for (const asset of plan.remove) {
      const archive = `trash/${trashId}/${encodeURIComponent(asset.path)}`;
      await env.MEDIA.put(archive, await assetBytes(env, asset.path, ref));
      assets.push({ ...asset, archive });
      files.push({ path: asset.path, remove: true });
    }
  }
  if (url)
    registry[key] = {
      url: normalizedUrl(url),
      mode: job.action,
      retired: assets.map((p) => p.route),
    };
  files.push({
    path: LIFECYCLE_PATH,
    source: JSON.stringify(registry, null, 2) + "\n",
  });
  return {
    files,
    generated: {
      path: LIFECYCLE_PATH,
      source: files[files.length - 1].source!,
      url: url || "/",
    },
    result: { trashId, assets, keep, key },
  };
}
export async function restoreFiles(env: Env, value: Content, ref: string) {
  if (!value.restoreId) return [] as Change[];
  const row = await env.DB.prepare("SELECT * FROM trash WHERE id=?")
    .bind(value.restoreId)
    .first<any>();
  if (!row || row.content_key !== identity(value))
    throw new HttpError(409, "回收站内容不存在或身份不符。");
  const registry = await lifecycle(env, ref);
  delete registry[row.content_key];
  const files: Change[] = [
    { path: LIFECYCLE_PATH, source: JSON.stringify(registry, null, 2) + "\n" },
  ];
  for (const asset of JSON.parse(row.assets)) {
    // Existing same-path resources must not be overwritten on restore.
    try {
      await gh(
        env,
        `/contents/${asset.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
      );
      throw new HttpError(409, "附件地址已被占用，不能覆盖恢复。");
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 404) throw e;
    }
    const object = await env.MEDIA.get(asset.archive);
    if (!object) throw new HttpError(409, "恢复附件缺失，请联系维护。");
    files.push({ path: asset.path, bytes: await object.arrayBuffer() });
  }
  return files;
}
function scrubHome(value: any, target: Content): any {
  if (!value || value.kind !== "home" || target.kind !== "home") return value;
  const copy = structuredClone(value),
    key = target.scope === "project" ? "projects" : "recent_focus";
  if (copy.data?.[key])
    copy.data[key] = copy.data[key].filter(
      (p: any, i: number) =>
        entryKey(p, target.scope!, i) !== target.entryId &&
        !(
          !p.id &&
          target.scope === "focus" &&
          p.title === selectedEntry(target)?.title
        ),
    );
  if (copy.base?.source)
    copy.base.source = removeEntry(copy.base.source, target);
  return copy;
}
export async function purgePrivate(
  env: Env,
  key: string,
  target: Content,
  exceptJob?: string,
) {
  const drafts = (await env.DB.prepare("SELECT * FROM drafts").all<any>())
    .results;
  const ids = drafts
    .filter((d) => identity(JSON.parse(d.payload), d.id) === key)
    .map((d) => d.id);
  const publications = (
    await env.DB.prepare("SELECT * FROM publications").all<any>()
  ).results;
  const otherPayloads: string[] = [];
  for (const draft of drafts.filter((d) => !ids.includes(d.id))) {
    const payload = JSON.stringify(
      scrubHome(JSON.parse(draft.payload), target),
    );
    otherPayloads.push(payload);
    if (payload !== draft.payload)
      await env.DB.prepare("UPDATE drafts SET payload=? WHERE id=?")
        .bind(payload, draft.id)
        .run();
  }
  for (const table of ["versions", "conflicts"]) {
    const rows = (await env.DB.prepare(`SELECT * FROM ${table}`).all<any>())
      .results;
    for (const row of rows) {
      if (ids.includes(row.draft_id)) continue;
      const payload = JSON.stringify(
        scrubHome(JSON.parse(row.payload), target),
      );
      otherPayloads.push(payload);
      if (payload !== row.payload)
        await env.DB.prepare(
          `UPDATE ${table} SET payload=? WHERE draft_id=? AND ${table === "versions" ? "version" : "id"}=?`,
        )
          .bind(
            payload,
            row.draft_id,
            table === "versions" ? row.version : row.id,
          )
          .run();
    }
  }
  for (const pub of publications) {
    if (pub.id === exceptJob) continue;
    if (
      pub.target_key === key ||
      ids.includes(pub.draft_id) ||
      identity(JSON.parse(pub.payload), pub.draft_id) === key
    ) {
      for (const asset of JSON.parse(pub.result || "{}").assets || [])
        await env.MEDIA.delete(asset.archive);
      await env.DB.prepare("DELETE FROM publications WHERE id=?")
        .bind(pub.id)
        .run();
      continue;
    }
    const payload = JSON.stringify(scrubHome(JSON.parse(pub.payload), target));
    otherPayloads.push(payload);
    const before = pub.before_payload
      ? JSON.stringify(scrubHome(JSON.parse(pub.before_payload), target))
      : null;
    if (before) otherPayloads.push(before);
    let result = pub.result;
    if (result && target.kind === "home") {
      const r = JSON.parse(result);
      if (r.generated?.path === HOME_PATH)
        r.generated.source = removeEntry(r.generated.source, target);
      for (const f of r.expected || [])
        if (f.path === HOME_PATH && f.source)
          f.source = removeEntry(f.source, target);
      result = JSON.stringify(r);
    }
    await env.DB.prepare(
      "UPDATE publications SET payload=?,before_payload=?,result=? WHERE id=?",
    )
      .bind(payload, before, result, pub.id)
      .run();
  }
  const trashed = (
    await env.DB.prepare("SELECT * FROM trash WHERE content_key!=?")
      .bind(key)
      .all<any>()
  ).results;
  for (const row of trashed) {
    const payload = JSON.stringify(scrubHome(JSON.parse(row.payload), target));
    otherPayloads.push(payload);
    if (payload !== row.payload)
      await env.DB.prepare("UPDATE trash SET payload=? WHERE id=?")
        .bind(payload, row.id)
        .run();
  }
  for (const id of ids) {
    await env.DB.batch(
      ["versions", "conflicts", "media_links", "drafts"].map((table) =>
        env.DB.prepare(
          `DELETE FROM ${table} WHERE ${table === "drafts" ? "id" : "draft_id"}=?`,
        ).bind(id),
      ),
    );
  }
  const remaining = otherPayloads.join("\n");
  const media = (await env.DB.prepare("SELECT * FROM media").all<any>())
    .results;
  for (const m of media.filter(
    (m) => ids.includes(m.draft_id) || JSON.stringify(target).includes(m.id),
  )) {
    if (remaining.includes(m.id)) continue;
    await env.MEDIA.delete(m.id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM media WHERE id=?").bind(m.id),
      env.DB.prepare("DELETE FROM media_links WHERE media_id=?").bind(m.id),
    ]);
  }
}
export async function finishDeletion(env: Env, job: Publication) {
  const value = JSON.parse(job.payload) as Content,
    result = JSON.parse(job.result || "{}"),
    key = job.target_key!;
  if (job.action === "trash") {
    const currentDrafts = (
      await env.DB.prepare(
        "SELECT id,payload FROM drafts WHERE trashed=0 ORDER BY updated DESC",
      ).all<any>()
    ).results;
    const latest = currentDrafts.find(
      (d) => identity(JSON.parse(d.payload), d.id) === key,
    );
    await env.DB.prepare(
      "INSERT OR IGNORE INTO trash(id,content_key,payload,assets,created,was_published) VALUES(?,?,?,?,?,1)",
    )
      .bind(
        result.trashId,
        key,
        latest?.payload || job.payload,
        JSON.stringify(result.assets || []),
        now(),
      )
      .run();
    const drafts = (
      await env.DB.prepare("SELECT id,payload FROM drafts").all<any>()
    ).results;
    for (const d of drafts)
      if (identity(JSON.parse(d.payload), d.id) === key)
        await env.DB.prepare("UPDATE drafts SET trashed=1 WHERE id=?")
          .bind(d.id)
          .run();
  } else {
    await purgePrivate(env, key, value, job.id);
    for (const a of result.assets || []) await env.MEDIA.delete(a.archive);
    await env.DB.prepare("DELETE FROM trash WHERE content_key=?")
      .bind(key)
      .run();
    await env.DB.prepare(
      "UPDATE publications SET payload=?,before_payload=NULL,result=?,trash_id=NULL WHERE id=?",
    )
      .bind(
        JSON.stringify({ kind: "deleted", title: "已永久删除的内容" }),
        JSON.stringify({ url: publicUrl(value), deleted: true }),
        job.id,
      )
      .run();
  }
  await env.DB.prepare(
    "UPDATE publications SET status='published',error=NULL,updated=? WHERE id=?",
  )
    .bind(now(), job.id)
    .run();
}
export async function finishRestore(env: Env, value: Content) {
  if (!value.restoreId) return;
  const row = await env.DB.prepare("SELECT * FROM trash WHERE id=?")
    .bind(value.restoreId)
    .first<any>();
  if (row)
    for (const asset of JSON.parse(row.assets))
      await env.MEDIA.delete(asset.archive);
  await env.DB.prepare("DELETE FROM trash WHERE id=?")
    .bind(value.restoreId)
    .run();
}

export async function privateMediaPlan(env: Env, key: string, target: Content) {
  const drafts = (
    await env.DB.prepare("SELECT id,payload FROM drafts").all<any>()
  ).results;
  const ids = drafts
    .filter((d) => identity(JSON.parse(d.payload), d.id) === key)
    .map((d) => d.id);
  const other: any[] = drafts
    .filter((d) => !ids.includes(d.id))
    .map((d) => JSON.parse(d.payload));
  for (const table of ["versions", "conflicts"])
    for (const row of (
      await env.DB.prepare(`SELECT draft_id,payload FROM ${table}`).all<any>()
    ).results)
      if (!ids.includes(row.draft_id)) other.push(JSON.parse(row.payload));
  for (const row of (
    await env.DB.prepare("SELECT * FROM publications").all<any>()
  ).results)
    if (
      row.target_key !== key &&
      !ids.includes(row.draft_id) &&
      identity(JSON.parse(row.payload), row.draft_id) !== key
    ) {
      other.push(JSON.parse(row.payload));
      if (row.before_payload) other.push(JSON.parse(row.before_payload));
    }
  for (const row of (
    await env.DB.prepare("SELECT content_key,payload FROM trash").all<any>()
  ).results)
    if (row.content_key !== key) other.push(JSON.parse(row.payload));
  const remaining = other
    .map((value) => JSON.stringify(scrubHome(value, target)))
    .join("\n");
  const media = (
    await env.DB.prepare("SELECT * FROM media").all<any>()
  ).results.filter(
    (m) => ids.includes(m.draft_id) || JSON.stringify(target).includes(m.id),
  );
  return {
    remove: media
      .filter((m) => !remaining.includes(m.id))
      .map((m) => ({ path: `私密副本：${m.name} (${m.id})` })),
    keep: media
      .filter((m) => remaining.includes(m.id))
      .map((m) => `私密副本：${m.name}（其他草稿或版本仍在使用）`),
  };
}
