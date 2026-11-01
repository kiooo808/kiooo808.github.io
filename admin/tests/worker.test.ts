import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { newArticle, readContent } from "../shared/content";
let mf: Miniflare,
  db: any,
  files = new Map<string, { source: string; sha: string }>(),
  blobs = new Map<string, string>(),
  trees = new Map<string, any[]>(),
  commits = new Map<string, string>(),
  branches = new Map<string, string>(),
  prs: any[] = [];
let check = "success",
  deploy = "success",
  pages = "success",
  live = "",
  main = "base-main",
  n = 0,
  requests: string[] = [];
let oauthUser = { id: 1, login: "kiooo808" };
const baseSource =
  "---\ntitle: Existing\ndate: 2026-04-01 12:00:00\nsection: blog\n---\n\nOld body\n";
const publicPath = "source/_posts/blog/existing.md";
const json = (x: any, status = 200) =>
  new Response(JSON.stringify(x), {
    status,
    headers: { "Content-Type": "application/json" },
  });
async function remote(request: any) {
  const url = new URL(request.url),
    p = url.pathname.replace("/repos/kiooo808/kiooo808.github.io", "");
  requests.push(request.method + " " + p);
  const data =
    request.method === "GET"
      ? undefined
      : await request.json().catch(() => ({}));
  if (url.hostname === "kiooo808.github.io") return json({ commit: live });
  if (url.hostname === "github.com" && p === "/login/oauth/access_token")
    return json({ access_token: "fake-user-token" });
  if (p === "/user") return json(oauthUser);
  if (url.pathname.includes("/access_tokens"))
    return json({ token: "fake-installation-token" });
  if (p === "/git/ref/heads/main") return json({ object: { sha: main } });
  if (p === "/git/ref/heads/gh-pages")
    return json({ object: { sha: "pages-head" } });
  if (p === "/contents/revision.json")
    return json({
      content: Buffer.from(JSON.stringify({ commit: main })).toString("base64"),
    });
  if (p === "/actions/runs")
    return json({
      workflow_runs: [
        {
          id: 3,
          name: "pages-build-deployment",
          head_sha: "pages-head",
          status: pages === "pending" ? "in_progress" : "completed",
          conclusion: pages,
        },
      ],
    });
  if (p.startsWith("/compare/")) return json({ status: "ahead" });
  if (p.startsWith("/contents/")) {
    const key = decodeURIComponent(p.slice(10)),
      file = files.get(key);
    return file
      ? json({
          type: "file",
          encoding: "base64",
          sha: file.sha,
          content: Buffer.from(file.source).toString("base64"),
        })
      : json({}, 404);
  }
  if (p.startsWith("/git/commits/") && request.method === "GET")
    return json({ tree: { sha: "base-tree" } });
  if (p === "/git/blobs") {
    const sha = "blob-" + ++n;
    blobs.set(
      sha,
      data.encoding === "base64"
        ? Buffer.from(data.content, "base64").toString()
        : data.content,
    );
    return json({ sha });
  }
  if (p === "/git/trees") {
    const sha = "tree-" + ++n;
    trees.set(sha, data.tree);
    return json({ sha });
  }
  if (p === "/git/commits") {
    const sha = "commit-" + ++n;
    commits.set(sha, data.tree);
    return json({ sha });
  }
  if (p === "/git/refs") {
    const branch = data.ref.replace("refs/heads/", "");
    if (branches.has(branch)) return json({}, 422);
    branches.set(branch, data.sha);
    return json({ object: { sha: data.sha } });
  }
  if (p.startsWith("/git/ref/heads/"))
    return json({ object: { sha: branches.get(p.slice(15)) } });
  if (p === "/pulls" && request.method === "GET")
    return json(
      prs.filter(
        (pr) =>
          pr.state === "open" &&
          pr.branch === url.searchParams.get("head")?.split(":")[1],
      ),
    );
  if (p === "/pulls" && request.method === "POST") {
    const pr = {
      number: prs.length + 1,
      state: "open",
      merged: false,
      mergeable: true,
      head: { sha: branches.get(data.head) },
      branch: data.head,
    };
    prs.push(pr);
    return json(pr);
  }
  if (/^\/pulls\/\d+$/.test(p)) return json(prs[Number(p.split("/")[2]) - 1]);
  if (p.endsWith("/merge")) {
    const pr = prs[Number(p.split("/")[2]) - 1];
    assert.equal(data.sha, pr.head.sha);
    pr.merged = true;
    pr.state = "closed";
    pr.merge_commit_sha = "merge-" + ++n;
    main = pr.merge_commit_sha;
    for (const entry of trees.get(commits.get(pr.head.sha)!) || [])
      files.set(entry.path, { source: blobs.get(entry.sha)!, sha: entry.sha });
    return json({ merged: true, sha: main });
  }
  if (p === "/actions/workflows/check.yml/runs")
    return json({
      workflow_runs:
        check === "pending"
          ? []
          : [
              {
                id: 1,
                head_sha: url.searchParams.get("head_sha"),
                status: "completed",
                conclusion: check,
              },
            ],
    });
  if (p === "/actions/workflows/deploy.yml/runs")
    return json({
      workflow_runs: [
        {
          id: 2,
          head_sha: url.searchParams.get("head_sha"),
          status: "completed",
          conclusion: deploy,
        },
      ],
    });
  if (p === "/actions/runs/2/rerun-failed-jobs") {
    deploy = "success";
    return new Response(null, { status: 201 });
  }
  if (p === "/actions/runs/3/rerun-failed-jobs") {
    pages = "success";
    return new Response(null, { status: 201 });
  }
  throw new Error(
    "Unexpected network request " + request.method + " " + url.href,
  );
}
before(async () => {
  const bundle = await build({
    stdin: {
      contents: `import worker from './worker/index.ts';import {processQueue} from './worker/publish.ts';export default {...worker,async fetch(req,env,ctx){if(new URL(req.url).pathname==='/__test/tick'){await processQueue(env);return new Response('ok');}return worker.fetch(req,env,ctx);}}`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
  });
  const keys = await webcrypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pem =
    "-----BEGIN PRIVATE KEY-----\n" +
    Buffer.from(
      await webcrypto.subtle.exportKey("pkcs8", keys.privateKey),
    ).toString("base64") +
    "\n-----END PRIVATE KEY-----";
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-10-01",
      cf: false,
      d1Databases: ["DB"],
      r2Buckets: ["MEDIA"],
      bindings: {
        OWNER_LOGIN: "kiooo808",
        OWNER_ID: "1",
        REPOSITORY: "kiooo808/kiooo808.github.io",
        SITE_URL: "https://kiooo808.github.io",
        PUBLIC_ORIGIN: "https://studio.test",
        GITHUB_APP_ID: "1",
        GITHUB_INSTALLATION_ID: "1",
        GITHUB_PRIVATE_KEY: pem,
        GITHUB_CLIENT_ID: "fake-client",
        GITHUB_CLIENT_SECRET: "fake-secret",
      },
      outboundService: remote,
    }),
  );
  db = await mf.getD1Database("DB");
  await db.exec(readFileSync("migrations/0001_studio.sql", "utf8"));
});
after(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  for (const table of [
    "sessions",
    "oauth_states",
    "drafts",
    "versions",
    "conflicts",
    "media",
    "publications",
    "leases",
  ])
    await db.prepare("DELETE FROM " + table).run();
  await db
    .prepare("INSERT INTO sessions(id,expires) VALUES(?,?)")
    .bind(
      createHash("sha256").update("test-session").digest("base64url"),
      Date.now() + 600000,
    )
    .run();
  files = new Map([[publicPath, { source: baseSource, sha: "original" }]]);
  blobs.clear();
  trees.clear();
  commits.clear();
  branches.clear();
  prs = [];
  main = "base-main";
  check = "success";
  deploy = "success";
  pages = "success";
  live = "";
  requests = [];
  oauthUser = { id: 1, login: "kiooo808" };
});
function request(
  path: string,
  method = "GET",
  data?: any,
  headers: Record<string, string> = {},
) {
  return mf.dispatchFetch("https://studio.test/api" + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: "studio_session=test-session",
      Origin: "https://studio.test",
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
async function create() {
  const payload = {
    ...newArticle(),
    title: "Integration test",
    body: "Private draft",
  };
  return (await request("/drafts", "POST", { payload })).json() as Promise<any>;
}
async function job(id: string) {
  return db.prepare("SELECT * FROM publications WHERE id=?").bind(id).first();
}
async function tick() {
  await mf.dispatchFetch("https://studio.test/__test/tick");
}
async function waitFor(id: string, state: string) {
  for (let i = 0; i < 30; i++) {
    const j = await job(id);
    if (j.status === state) return j;
    if (["failed", "conflict"].includes(j.status))
      throw new Error(JSON.stringify(j));
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("state timeout " + state);
}
test("private endpoints reject unauthenticated requests and cross-origin writes", async () => {
  for (const p of [
    "/drafts",
    "/content",
    "/publications",
    "/media/11111111-1111-1111-1111-111111111111",
  ])
    assert.equal(
      (await mf.dispatchFetch("https://studio.test/api" + p)).status,
      401,
    );
  assert.equal(
    (
      await request(
        "/drafts",
        "POST",
        { payload: newArticle() },
        { Origin: "https://evil.test" },
      )
    ).status,
    403,
  );
  assert.equal((await request("/auth/demo", "POST", {})).status, 404);
});
test("autosave uses optimistic concurrency and preserves both conflict versions", async () => {
  const draft = await create();
  assert.equal(draft.version, 1);
  assert.equal(requests.length, 0);
  const first = { ...draft.payload, title: "Device one" },
    second = { ...draft.payload, title: "Device two" };
  assert.equal(
    (
      await request("/drafts/" + draft.id, "PUT", {
        version: 1,
        payload: first,
      })
    ).status,
    200,
  );
  const conflict = await request("/drafts/" + draft.id, "PUT", {
    version: 1,
    payload: second,
  });
  assert.equal(conflict.status, 409);
  assert.equal(
    ((await conflict.json()) as any).latest.payload.title,
    "Device one",
  );
  const copies = (await (
    await request("/drafts/" + draft.id + "/conflicts")
  ).json()) as any[];
  assert.equal(copies[0].payload.title, "Device two");
  assert.equal(requests.length, 0);
});
test("attachments require auth, validate file magic, and stay private until publication", async () => {
  const d = await create();
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const uploaded = await mf.dispatchFetch(
    "https://studio.test/api/media?draft=" + d.id,
    {
      method: "POST",
      headers: {
        Cookie: "studio_session=test-session",
        Origin: "https://studio.test",
        "Content-Type": "image/png",
        "X-File-Name": "test.png",
      },
      body: bytes,
    },
  );
  assert.equal(uploaded.status, 201);
  const image = (await uploaded.json()) as any;
  assert.equal(
    (await mf.dispatchFetch("https://studio.test" + image.url)).status,
    401,
  );
  const read = await request(image.url.replace("/api", ""));
  assert.equal(read.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(new Uint8Array(await read.arrayBuffer()), bytes);
  const invalid = await mf.dispatchFetch(
    "https://studio.test/api/media?draft=" + d.id,
    {
      method: "POST",
      headers: {
        Cookie: "studio_session=test-session",
        Origin: "https://studio.test",
        "Content-Type": "image/png",
      },
      body: "<script>bad</script>",
    },
  );
  assert.equal(invalid.status, 400);
  assert.equal(requests.length, 0);
});
test("publishing is idempotent, checks exact revision, then waits for live site revision", async () => {
  const draft = await create();
  check = "pending";
  const first = (await (
    await request("/publications", "POST", { draftId: draft.id, version: 1 })
  ).json()) as any;
  const second = (await (
    await request("/publications", "POST", { draftId: draft.id, version: 1 })
  ).json()) as any;
  assert.equal(first.id, second.id);
  await waitFor(first.id, "checking");
  assert.equal(prs.length, 1);
  assert.equal(files.size, 1);
  await tick();
  assert.equal((await job(first.id)).status, "checking");
  check = "success";
  await tick();
  assert.equal((await job(first.id)).status, "deploying");
  await tick();
  assert.equal((await job(first.id)).status, "verifying");
  await tick();
  assert.equal((await job(first.id)).status, "verifying");
  live = main;
  await tick();
  assert.equal((await job(first.id)).status, "published");
  const saved = (await (await request("/drafts/" + draft.id)).json()) as any;
  assert.equal(saved.version, saved.published_version);
  assert.ok(saved.payload.base.path.startsWith("source/_posts/blog/"));
  assert.ok(saved.payload.permalink);
});
test("failed checks do not merge; retried publication uses a new attempt", async () => {
  check = "failure";
  const d = await create();
  const first = (await (
    await request("/publications", "POST", { draftId: d.id, version: 1 })
  ).json()) as any;
  await waitFor(first.id, "checking");
  await tick();
  assert.equal((await job(first.id)).status, "failed");
  assert.equal(main, "base-main");
  check = "pending";
  const retry = (await (
    await request("/publications", "POST", {
      draftId: d.id,
      version: 1,
      retry: true,
    })
  ).json()) as any;
  assert.notEqual(retry.id, first.id);
  await waitFor(retry.id, "checking");
  assert.equal((await job(retry.id)).attempt, 1);
});
test("external edits cause conflict; no overwriting repository files", async () => {
  const payload = readContent({
    path: publicPath,
    sha: "stale",
    source: baseSource,
    url: "/old/url/",
  });
  const d = (await (
    await request("/drafts", "POST", { payload })
  ).json()) as any;
  const p = (await (
    await request("/publications", "POST", { draftId: d.id, version: 1 })
  ).json()) as any;
  for (let i = 0; i < 30 && (await job(p.id)).status === "queued"; i++)
    await new Promise((r) => setTimeout(r, 20));
  assert.equal((await job(p.id)).status, "conflict");
  assert.equal(prs.length, 0);
  assert.equal(files.get(publicPath)!.source, baseSource);
});
test("restore creates a private new draft with previous contents and current base", async () => {
  const payload = readContent({
    path: publicPath,
    sha: "original",
    source: baseSource,
    url: "/old/url/",
  });
  if (payload.kind !== "post") throw Error();
  payload.body = "Updated body";
  const d = (await (
    await request("/drafts", "POST", { payload })
  ).json()) as any;
  const p = (await (
    await request("/publications", "POST", { draftId: d.id, version: 1 })
  ).json()) as any;
  await waitFor(p.id, "checking");
  await tick();
  await tick();
  live = main;
  await tick();
  assert.equal((await job(p.id)).status, "published");
  const restored = (await (
    await request("/publications/" + p.id + "/restore", "POST", {})
  ).json()) as any;
  assert.notEqual(restored.id, d.id);
  assert.equal(restored.payload.body.trim(), "Old body");
  assert.equal(restored.payload.base.sha, files.get(publicPath)!.sha);
  assert.equal(restored.published_version, 0);
});
test("publication snapshots stay immutable while a later edit is saved", async () => {
  check = "pending";
  const d = await create();
  const p = (await (
    await request("/publications", "POST", { draftId: d.id, version: 1 })
  ).json()) as any;
  await waitFor(p.id, "checking");
  const later = {
    ...d.payload,
    body: "A later edit that is not in this publication",
  };
  assert.equal(
    (await request("/drafts/" + d.id, "PUT", { version: 1, payload: later }))
      .status,
    200,
  );
  assert.equal(JSON.parse((await job(p.id)).payload).body, "Private draft");
  check = "success";
  await tick();
  await tick();
  live = main;
  await tick();
  const saved = (await (await request("/drafts/" + d.id)).json()) as any;
  assert.equal(saved.payload.body, later.body);
  assert.notEqual(saved.version, saved.published_version);
  const actual = files.get(saved.payload.base.path)!;
  assert.ok(actual.source.includes("Private draft"));
  assert.ok(!actual.source.includes(later.body));
});
test("private attachment URLs are replaced atomically with published asset paths", async () => {
  const d = await create();
  const bytes = new TextEncoder().encode("%PDF-1.4\nexample");
  const image = (await (
    await mf.dispatchFetch("https://studio.test/api/media?draft=" + d.id, {
      method: "POST",
      headers: {
        Cookie: "studio_session=test-session",
        Origin: "https://studio.test",
        "Content-Type": "application/pdf",
        "X-File-Name": "diagram.pdf",
      },
      body: bytes,
    })
  ).json()) as any;
  const payload = { ...d.payload, body: "[Diagram](" + image.url + ")" };
  await request("/drafts/" + d.id, "PUT", { version: 1, payload });
  const p = (await (
    await request("/publications", "POST", { draftId: d.id, version: 2 })
  ).json()) as any;
  await waitFor(p.id, "checking");
  assert.equal(files.size, 1);
  await tick();
  const published = [...files.values()].find((x) =>
    x.source.includes("[Diagram]"),
  )!;
  assert.ok(published.source.includes("/images/uploads/" + image.id + ".pdf"));
  assert.ok(!published.source.includes("/api/media/"));
  assert.ok(files.has("source/images/uploads/" + image.id + ".pdf"));
});
test("serial queue keeps the second publication private until the first finishes", async () => {
  check = "pending";
  const a = await create(),
    b = await create();
  const p1 = (await (
    await request("/publications", "POST", { draftId: a.id, version: 1 })
  ).json()) as any;
  await waitFor(p1.id, "checking");
  const p2 = (await (
    await request("/publications", "POST", { draftId: b.id, version: 1 })
  ).json()) as any;
  await tick();
  assert.equal((await job(p2.id)).status, "queued");
  assert.equal(prs.length, 1);
});
test("deployment retry reuses merged content instead of creating a second commit", async () => {
  const d = await create();
  const p = (await (
    await request("/publications", "POST", { draftId: d.id, version: 1 })
  ).json()) as any;
  await waitFor(p.id, "checking");
  await tick();
  deploy = "failure";
  await tick();
  assert.equal((await job(p.id)).status, "failed");
  const retry = (await (
    await request("/publications", "POST", {
      draftId: d.id,
      version: 1,
      retry: true,
    })
  ).json()) as any;
  assert.equal(retry.id, p.id);
  await waitFor(p.id, "verifying");
  assert.equal(prs.length, 1);
  live = main;
  await tick();
  assert.equal((await job(p.id)).status, "published");
});
test("downstream Pages failure is reported and retried without another content commit", async () => {
  const d = await create();
  const p = (await (
    await request("/publications", "POST", { draftId: d.id, version: 1 })
  ).json()) as any;
  await waitFor(p.id, "checking");
  await tick();
  await tick();
  pages = "failure";
  await tick();
  assert.equal((await job(p.id)).status, "failed");
  assert.match((await job(p.id)).error, /GitHub Pages/);
  const originalMain = main;
  const retried = (await (
    await request("/publications", "POST", {
      draftId: d.id,
      version: 1,
      retry: true,
    })
  ).json()) as any;
  assert.equal(retried.id, p.id);
  assert.ok(requests.includes("POST /actions/runs/3/rerun-failed-jobs"));
  live = main;
  for (let i = 0; i < 30 && (await job(p.id)).status !== "published"; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 20));
  }
  await waitFor(p.id, "published");
  assert.equal(main, originalMain);
  assert.equal(prs.length, 1);
});

test("OAuth rejects other accounts and issues a secure owner session without exposing tokens", async () => {
  async function login() {
    const start = await request("/auth/login"),
      target = new URL(start.headers.get("Location")!);
    return {
      state: target.searchParams.get("state")!,
      cookie: start.headers.get("Set-Cookie")!.split(";")[0],
    };
  }
  const a = await login();
  oauthUser = { id: 2, login: "other-user" };
  assert.equal(
    (
      await request(
        "/auth/callback?state=" + a.state + "&code=test",
        "GET",
        undefined,
        { Cookie: a.cookie },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/auth/callback?state=" + a.state + "&code=test",
        "GET",
        undefined,
        { Cookie: a.cookie },
      )
    ).status,
    403,
  );
  oauthUser = { id: 1, login: "kiooo808" };
  const b = await login();
  const success = await request(
    "/auth/callback?state=" + b.state + "&code=test",
    "GET",
    undefined,
    { Cookie: b.cookie },
  );
  assert.equal(success.status, 303);
  assert.match(success.headers.get("Set-Cookie")!, /HttpOnly/);
  assert.match(success.headers.get("Set-Cookie")!, /Secure/);
  assert.match(success.headers.get("Set-Cookie")!, /SameSite=Lax/);
  assert.ok(!(await success.text()).includes("fake-user-token"));
});
test("later deployments containing the same content still verify publication", async () => {
  const d = await create();
  const p = (await (
    await request("/publications", "POST", { draftId: d.id, version: 1 })
  ).json()) as any;
  await waitFor(p.id, "checking");
  await tick();
  await tick();
  live = "a".repeat(40);
  await tick();
  assert.equal((await job(p.id)).status, "published");
});
