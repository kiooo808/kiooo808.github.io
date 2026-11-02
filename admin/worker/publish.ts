import {
  Content,
  Home,
  identity,
  entryFromSource,
  selectedEntry,
  splitArticle,
  HOME_PATH,
  LIFECYCLE_PATH,
  readContent,
  serializeContent,
  validateContent,
} from "../shared/content";
import { Env, Publication, HttpError, now } from "./types";
import {
  gh,
  readFile,
  commitFiles,
  canonicalUrls,
  legacyUrl,
  contentBytes,
} from "./github";
import {
  optionalFile,
  lifecycle,
  rebaseEntry,
  prepareDeletion,
  restoreFiles,
  finishDeletion,
  finishRestore,
  Change,
} from "./lifecycle";
export async function updateJob(
  env: Env,
  id: string,
  values: Record<string, unknown>,
) {
  const entries = Object.entries({ ...values, updated: now() });
  await env.DB.prepare(
    `UPDATE publications SET ${entries.map(([key]) => key + "=?").join(",")} WHERE id=?`,
  )
    .bind(...entries.map(([, v]) => v), id)
    .run();
}
async function pagesRun(env: Env, job: Publication) {
  const ref = await gh(env, "/git/ref/heads/gh-pages");
  const file = await gh(
    env,
    `/contents/revision.json?ref=${encodeURIComponent(ref.object.sha)}`,
  );
  const revision = JSON.parse(atob(file.content.replace(/\s/g, "")));
  if (revision.commit !== job.merge_sha) {
    if (!/^[0-9a-f]{40}$/.test(revision.commit)) return;
    const comparison = await gh(
      env,
      `/compare/${job.merge_sha}...${revision.commit}`,
    );
    if (!["ahead", "identical"].includes(comparison.status)) return;
    if (job.result) {
      if (!(await verifyApplied(env, job, revision.commit))) return;
    } else {
      const { generated } = await prepareFiles(
        env,
        JSON.parse(job.payload),
        job.draft_id,
      );
      if (
        (await readFile(env, generated.path, revision.commit)).source !==
        generated.source
      )
        return;
    }
  }
  const runs = await gh(
    env,
    `/actions/runs?head_sha=${encodeURIComponent(ref.object.sha)}&per_page=100`,
  );
  return runs.workflow_runs.find(
    (run: any) =>
      ["pages-build-deployment", "pages build and deployment"].includes(
        run.name,
      ) && run.head_sha === ref.object.sha,
  );
}
async function retryRun(env: Env, run: any) {
  const action = ["cancelled", "skipped"].includes(run.conclusion)
    ? "rerun"
    : "rerun-failed-jobs";
  await gh(env, `/actions/runs/${run.id}/${action}`, "POST");
}
export async function createPublication(
  env: Env,
  id: string,
  version: number,
  retry = false,
) {
  if (env.PUBLISH_PAUSED === "true")
    throw new HttpError(
      503,
      "后台正在维护发布流程，草稿仍可保存，请稍后发布。",
    );
  const draft = await env.DB.prepare("SELECT * FROM drafts WHERE id=?")
    .bind(id)
    .first<any>();
  if (!draft || draft.version !== version)
    throw new HttpError(409, "草稿已更新，请预览最新版本后发布。");
  const content = JSON.parse(draft.payload) as Content;
  if (content.kind === "home" && !content.scope)
    throw new HttpError(
      409,
      "旧首页草稿仅可查看或按条目导入，请使用项目/近期关注独立管理。",
    );
  if (content.kind === "home" && content.scope !== "intro")
    content.title =
      selectedEntry(content)?.title ||
      content.title;
  validateContent(content);
  if (content.kind === "home")
    content.data.focus_updated = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Shanghai",
    });
  let existing = await env.DB.prepare(
    "SELECT * FROM publications WHERE draft_id=? AND version=? ORDER BY attempt DESC LIMIT 1",
  )
    .bind(id, version)
    .first<Publication>();
  if (existing && (!retry || !["failed", "conflict"].includes(existing.status)))
    return existing;
  if (existing && !existing.merge_sha) {
    const active = await env.DB.prepare(
      "SELECT * FROM publications WHERE target_key=? AND status IN ('queued','checking','deploying','verifying')",
    ).bind(existing.target_key || identity(content, id)).first<Publication>();
    if (active) return active;
    // A PR may have been merged outside the queue after its checks failed.
    // Find that exact immutable attempt, even if a later retry failed before
    // creating a PR because the file was already deleted from main.
    const attempts = (await env.DB.prepare(
      "SELECT * FROM publications WHERE draft_id=? AND version=? AND pr IS NOT NULL ORDER BY attempt DESC",
    ).bind(id, version).all<Publication>()).results;
    for (const attempt of attempts) {
      const pr = await gh(env, `/pulls/${attempt.pr}`);
      if (!pr.merged) continue;
      if (pr.head.sha !== attempt.head || !pr.merge_commit_sha ||
          !JSON.parse(attempt.result || "{}").expected?.length)
        throw new HttpError(409, "已合并请求的版本或核对记录不匹配，请重新载入内容。");
      existing = { ...attempt, merge_sha: pr.merge_commit_sha };
      break;
    }
  }
  const previousHead = existing?.merge_sha || existing?.base_head;
  if (existing && previousHead) {
    const staleHistory = () =>
      new HttpError(
        409,
        "仓库历史已变化，不能重试旧发布。请编辑并保存草稿为新版本后重新发布。",
      );
    try {
      const comparison = await gh(
        env,
        `/compare/${encodeURIComponent(previousHead)}...main`,
      );
      if (!["ahead", "identical"].includes(comparison.status))
        throw staleHistory();
    } catch (error) {
      if (error instanceof HttpError && [404, 409].includes(error.status))
        throw staleHistory();
      throw error;
    }
  }
  if (existing?.merge_sha) {
    if (existing.result && !(await verifyApplied(env, existing, existing.merge_sha)))
      throw new HttpError(409, "已合并内容与所选版本不一致，不能继续原任务。");
    await updateJob(env, existing.id, { merge_sha: existing.merge_sha });
    const runs = await gh(
      env,
      `/actions/workflows/deploy.yml/runs?head_sha=${existing.merge_sha}&event=push`,
    );
    const run = runs.workflow_runs.find(
      (r: any) => r.head_sha === existing.merge_sha,
    );
    // A newer checked artifact can already contain this content, even when GitHub
    // replaced its older pending workflow. Retry the matching Pages artifact first.
    const pages = await pagesRun(env, existing);
    if (pages) {
      if (pages?.status === "completed" && pages.conclusion !== "success")
        await retryRun(env, pages);
      await updateJob(env, existing.id, { status: "verifying", error: null });
      return { ...existing, status: "verifying", error: null };
    }
    if (run?.status === "completed" && run.conclusion !== "success")
      await retryRun(env, run);
    await updateJob(env, existing.id, { status: "deploying", error: null });
    return { ...existing, status: "deploying", error: null };
  }
  const jobId = crypto.randomUUID(),
    created = now(),
    attempt = existing ? existing.attempt + 1 : 0;
  // A unique database key makes double-clicks and parallel API calls idempotent.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO publications(id,draft_id,version,attempt,status,payload,created,updated,action,target_key,trash_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      jobId,
      id,
      version,
      attempt,
      "queued",
      JSON.stringify(content),
      created,
      created,
      existing?.action || "publish",
      existing?.target_key || identity(content, id),
      existing?.trash_id || null,
    )
    .run();
  const active = await env.DB.prepare(
    "SELECT * FROM publications WHERE target_key=? AND status IN ('queued','checking','deploying','verifying')",
  )
    .bind(identity(content, id))
    .first<Publication>();
  if (active) return active;
  return await env.DB.prepare(
    "SELECT * FROM publications WHERE draft_id=? AND version=? AND attempt=?",
  )
    .bind(id, version, attempt)
    .first<Publication>();
}
export async function prepareFiles(env: Env, content: Content, id: string) {
  const generated = serializeContent(content, id);
  const references = [
    ...generated.source.matchAll(/\/api\/media\/([0-9a-f-]{36})/g),
  ].map((m) => m[1]);
  const files: Change[] = [];
  let total = 0;
  for (const mediaId of new Set(references)) {
    const media = await env.DB.prepare("SELECT * FROM media WHERE id=?")
      .bind(mediaId)
      .first<any>();
    if (
      !media ||
      (media.draft_id !== id &&
        !(await env.DB.prepare(
          "SELECT 1 FROM media_links WHERE draft_id=? AND media_id=?",
        )
          .bind(id, mediaId)
          .first()))
    )
      throw new HttpError(
        400,
        "文章含有不属于本草稿或不存在的附件，请重新上传。",
      );
    total += media.size;
    if (total > 20 * 1024 * 1024)
      throw new HttpError(400, "单次发布附件合计不能超过 20MB，请分篇发布。");
    const object = await env.MEDIA.get(mediaId);
    if (!object) throw new HttpError(400, "附件读取失败，请重新上传。");
    const ext = media.type === "image/jpeg" ? "jpg" : media.type.split("/")[1];
    const path = `source/images/uploads/${mediaId}.${ext}`;
    files.push({ path, bytes: await object.arrayBuffer() });
    generated.source = generated.source.replaceAll(
      "/api/media/" + mediaId,
      "/" + path.replace(/^source\//, ""),
    );
  }
  files.push({ path: generated.path, source: generated.source });
  return { files, generated };
}
async function complete(env: Env, job: Publication, ref = "main") {
  if (job.action && job.action !== "publish") return finishDeletion(env, job);
  const value = JSON.parse(job.payload) as Content;
  const generated = job.result
    ? JSON.parse(job.result).generated
    : serializeContent(value, job.draft_id);
  const base = await readFile(env, generated.path, ref);
  base.url = generated.url;
  const current = await env.DB.prepare("SELECT * FROM drafts WHERE id=?")
    .bind(job.draft_id)
    .first<any>();
  if (current) {
    const payload = JSON.parse(current.payload) as Content;
    payload.base = base;
    if (payload.kind === "home" && current.version === job.version)
      payload.data = (readContent(base) as Home).data;
    delete payload.restoreId;
    if (payload.kind === "post") {
      const published = readContent(base);
      if (published.kind === "post") {
        payload.date = published.date;
        payload.permalink = published.permalink;
      }
      // Keep new edits, but replace private URLs with the paths now committed to the site.
      if (current.version === job.version)
        payload.body = (readContent(base) as any).body;
    }
    const next = current.version + 1,
      text = JSON.stringify(payload);
    const results = await env.DB.batch([
      env.DB.prepare(
        "UPDATE drafts SET payload=?,version=?,published_version=?,updated=? WHERE id=? AND version=?",
      ).bind(
        text,
        next,
        current.version === job.version ? next : next - 1,
        now(),
        job.draft_id,
        current.version,
      ),
      env.DB.prepare(
        "INSERT OR IGNORE INTO versions(draft_id,version,payload,created) SELECT id,version,payload,updated FROM drafts WHERE id=? AND version=?",
      ).bind(job.draft_id, next),
    ]);
    if (!results[0].meta.changes)
      throw new HttpError(409, "草稿同步冲突，线上已更新，请刷新后台。");
  }
  await finishRestore(env, value);
  await updateJob(env, job.id, { status: "published", error: null });
}
export async function advance(env: Env, job: Publication) {
  const content = JSON.parse(job.payload) as Content;
  if (job.status === "queued") {
    const ref = await gh(env, "/git/ref/heads/main");
    const base = ref.object.sha;
    let before: Content | null = null;
    let appliedContent = content;
    let prepared: any;
    if (job.action && job.action !== "publish") {
      prepared = await prepareDeletion(env, job, base);
    } else {
      if (
        content.kind === "home" &&
        content.scope === "project" &&
        !entryFromSource(content.base, content.scope, content.entryId!) &&
        !content.restoreId
      ) {
        const url = `/projects/${selectedEntry(content).slug}/`;
        if (
          Object.values(await lifecycle(env, base)).some(
            (row: any) => row.url === url && row.mode === "trash",
          )
        )
          throw new HttpError(
            409,
            "该项目地址仍在回收站，请先恢复原项目或选择其他短名。",
          );
      }
      if (content.restoreId) {
        const trash = await env.DB.prepare(
          "SELECT content_key FROM trash WHERE id=?",
        )
          .bind(content.restoreId)
          .first<any>();
        if (!trash || trash.content_key !== identity(content, job.draft_id))
          throw new HttpError(409, "恢复目标已变化。");
      }
      if (content.base) {
        const current = await optionalFile(env, content.base.path, base);
        if (content.kind === "home" && content.scope) {
          if (!current) throw new HttpError(409, "首页数据不存在。");
          appliedContent = rebaseEntry(content, current, !!content.restoreId);
          if (entryFromSource(current, content.scope, content.entryId!))
            before = {
              ...appliedContent,
              data: (readContent(current) as Home).data,
            };
        } else if (content.restoreId) {
          if (current)
            throw new HttpError(409, "原地址已被占用，不能覆盖恢复。");
        } else {
          if (!current || current.sha !== content.base.sha)
            throw new HttpError(
              409,
              "这份内容已在仓库中被修改，请重新载入并合并修改。",
            );
          const urls = await canonicalUrls(env);
          current.url =
            urls?.[current.path] ||
            legacyUrl(current, splitArticle(current.source).meta);
          validateContent({ ...content, base: current });
          appliedContent = { ...content, base: current };
          before = readContent(current);
        }
      }
      prepared = await prepareFiles(env, appliedContent, job.draft_id);
      prepared.files.push(...(await restoreFiles(env, content, base)));
    }
    const files: Change[] = prepared.files;
    const expected = [];
    for (const file of files)
      expected.push(
        file.bytes
          ? {
              path: file.path,
              digest: Array.from(
                new Uint8Array(
                  await crypto.subtle.digest("SHA-256", file.bytes),
                ),
              )
                .map((x) => x.toString(16).padStart(2, "0"))
                .join(""),
            }
          : { path: file.path, source: file.source, remove: file.remove },
      );
    await updateJob(env, job.id, {
      result: JSON.stringify({
        ...prepared.result,
        generated: prepared.generated,
        expected,
      }),
    });
    const branch = "studio/" + job.id;
    const head = await commitFiles(
      env,
      base,
      branch,
      files,
      "content: " + content.title,
    );
    // Resume a deterministic branch/PR after timeouts instead of creating duplicates.
    const old = await gh(
      env,
      `/pulls?state=open&head=${env.REPOSITORY.split("/")[0]}:${branch}&base=main`,
    );
    const pr =
      old[0] ||
      (await gh(env, "/pulls", "POST", {
        title: "内容更新：" + content.title,
        head: branch,
        base: "main",
        body: "由 MyBlog 内容工作台提交。文章和附件一起提交，检查通过后合并。",
      }));
    await updateJob(env, job.id, {
      status: "checking",
      branch,
      head,
      base_head: base,
      pr: pr.number,
      before_payload: before ? JSON.stringify(before) : null,
    });
    return;
  }
  if (job.status === "checking") {
    const pr = await gh(env, `/pulls/${job.pr}`);
    if (pr.merged) {
      await updateJob(env, job.id, {
        status: "deploying",
        merge_sha: pr.merge_commit_sha,
      });
      return;
    }
    if (pr.state !== "open" || pr.head.sha !== job.head)
      throw new HttpError(409, "发布分支已被其他操作改动或关闭，请重新发布。");
    const main = await gh(env, "/git/ref/heads/main");
    if (main.object.sha !== job.base_head)
      throw new HttpError(
        409,
        "检查期间主分支发生更新，请重新检查最新内容后发布。",
      );
    const checks = await gh(
      env,
      `/actions/workflows/check.yml/runs?head_sha=${job.head}&event=pull_request`,
    );
    const run = checks.workflow_runs.find((r: any) => r.head_sha === job.head);
    if (!run || run.status !== "completed") return;
    if (run.conclusion !== "success")
      throw new HttpError(
        400,
        "文章或站点检查未通过。可打开发布请求的检查日志查看原因，修改后重新发布。",
      );
    if (pr.mergeable === false)
      throw new HttpError(409, "内容与主分支冲突，请重新载入内容。");
    const merge = await gh(env, `/pulls/${job.pr}/merge`, "PUT", {
      sha: job.head,
      merge_method: "squash",
    });
    if (!merge.merged)
      throw new HttpError(409, "发布请求尚不能合并，请检查仓库规则。");
    await updateJob(env, job.id, { status: "deploying", merge_sha: merge.sha });
    return;
  }
  if (job.status === "deploying") {
    const result = await gh(
      env,
      `/actions/workflows/deploy.yml/runs?head_sha=${job.merge_sha}&event=push`,
    );
    const run = result.workflow_runs.find(
      (r: any) => r.head_sha === job.merge_sha,
    );
    if (!run || run.status !== "completed") return;
    if (run.conclusion !== "success")
      throw new HttpError(
        502,
        "网站部署失败。内容已保存，可重试部署；当前网站仍显示上一版。",
      );
    await updateJob(env, job.id, { status: "verifying" });
    return;
  }
  if (job.status === "verifying") {
    const response = await fetch(
      env.SITE_URL + "/revision.json?studio=" + job.id,
      { headers: { "Cache-Control": "no-cache" } },
    );
    const revision = response.ok
      ? ((await response.json()) as { commit: string })
      : { commit: "" };
    if (revision.commit === job.merge_sha) {
      await complete(env, job, revision.commit);
      return;
    }
    // A later code-only deployment may already include this publication. Verify ancestry
    // and the actual published file rather than reporting a false timeout.
    if (/^[0-9a-f]{40}$/.test(revision.commit)) {
      const comparison = await gh(
        env,
        `/compare/${job.merge_sha}...${revision.commit}`,
      );
      if (["ahead", "identical"].includes(comparison.status)) {
        if (job.result) {
          if (!(await verifyApplied(env, job, revision.commit)))
            throw new HttpError(
              409,
              "后续更新已修改发布内容，请重新载入核对。",
            );
        } else {
          const { generated } = await prepareFiles(env, content, job.draft_id);
          const actual = await readFile(env, generated.path, revision.commit);
          if (actual.source !== generated.source)
            throw new HttpError(409, "后续更新已修改这份内容，请重新载入。");
        }
        await complete(env, job, revision.commit);
        return;
      }
    }
    const pages = await pagesRun(env, job);
    if (pages?.status === "completed" && pages.conclusion !== "success")
      throw new HttpError(
        502,
        "GitHub Pages 发布失败，网站尚未更新。可重试同一版本，无需再次提交文章。",
      );
  }
}
export async function processQueue(env: Env) {
  const token = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO leases(id,token,expires) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE leases.expires<?",
  )
    .bind("publisher", token, Date.now() + 300000, Date.now())
    .run();
  const lease = await env.DB.prepare("SELECT token FROM leases WHERE id=?")
    .bind("publisher")
    .first<{ token: string }>();
  if (lease?.token !== token) return;
  try {
    const job = await env.DB.prepare(
      "SELECT * FROM publications WHERE status IN ('queued','checking','deploying','verifying') ORDER BY created,id LIMIT 1",
    ).first<Publication>();
    if (!job) return;
    if (Date.now() - Date.parse(job.updated) > 30 * 60000) {
      await updateJob(env, job.id, {
        status: "failed",
        error: "等待检查或部署超时，请检查 GitHub Actions 后重试。",
      });
      return;
    }
    try {
      await advance(env, job);
    } catch (error) {
      await updateJob(env, job.id, {
        status:
          error instanceof HttpError && error.status === 409
            ? "conflict"
            : "failed",
        error:
          error instanceof HttpError
            ? error.message
            : "发布服务暂时不可用，请检查服务日志后重试。",
      });
    }
  } finally {
    await env.DB.prepare("DELETE FROM leases WHERE id=? AND token=?")
      .bind("publisher", token)
      .run();
  }
}

async function verifyApplied(env: Env, job: Publication, ref: string) {
  for (const file of JSON.parse(job.result || "{}").expected || []) {
    try {
      const raw = await gh(
        env,
        `/contents/${file.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
      );
      if (file.remove) return false;
      const bytes = await contentBytes(env, raw);
      if (
        file.source !== undefined &&
        new TextDecoder().decode(bytes) !== file.source
      )
        return false;
      if (
        file.digest &&
        Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
          .map((x) => x.toString(16).padStart(2, "0"))
          .join("") !== file.digest
      )
        return false;
    } catch (e) {
      if (file.remove && e instanceof HttpError && e.status === 404) continue;
      throw e;
    }
  }
  return true;
}
