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
let comparison = "ahead";
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
  if (url.hostname === "kiooo808.github.io")
    return url.pathname === "/content-manifest.json"
      ? json({ posts: { [publicPath]: "/2026/04/01/existing/" } })
      : json({ commit: live });
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
      content: Buffer.from(
        JSON.stringify({
          commit: deploy === "failure" ? "older-artifact" : main,
        }),
      ).toString("base64"),
    });
  if (p === "/actions/runs")
    return json({
      workflow_runs: [
        {
          id: 3,
          name: "pages build and deployment",
          head_sha: "pages-head",
          status: pages === "pending" ? "in_progress" : "completed",
          conclusion: pages,
        },
      ],
    });
  if (p.startsWith("/compare/"))
    return comparison === "missing"
      ? json({}, 404)
      : json({ status: comparison });
  if (p.startsWith("/git/blobs/") && request.method === "GET") {
    const file = [...files.values()].find((f) => f.sha === p.split("/").pop());
    return file
      ? json({
          encoding: "base64",
          content: Buffer.from(file.source).toString("base64"),
          size: Buffer.byteLength(file.source),
        })
      : json({}, 404);
  }
  if (p.startsWith("/contents/")) {
    const key = decodeURIComponent(p.slice(10)),
      file = files.get(key);
    return file
      ? json({
          type: "file",
          encoding: file.source.length > 1000000 ? "none" : "base64",
          size: Buffer.byteLength(file.source),
          sha: file.sha,
          content:
            file.source.length > 1000000
              ? ""
              : Buffer.from(file.source).toString("base64"),
        })
      : json({}, 404);
  }
  if (p.startsWith("/git/trees/") && request.method === "GET")
    return json({
      truncated: false,
      tree: [...files].map(([path, file]) => ({
        path,
        type: "blob",
        sha: file.sha,
      })),
    });
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
    assert.equal(data.merge_method, "squash");
    pr.merged = true;
    pr.state = "closed";
    pr.merge_commit_sha = "merge-" + ++n;
    main = pr.merge_commit_sha;
    for (const entry of trees.get(commits.get(pr.head.sha)!) || []) {
      if (entry.sha === null) files.delete(entry.path);
      else
        files.set(entry.path, {
          source: blobs.get(entry.sha)!,
          sha: entry.sha,
        });
    }
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
  if (
    ["/actions/runs/3/rerun-failed-jobs", "/actions/runs/3/rerun"].includes(p)
  ) {
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
      contents: `import worker from './worker/index.ts';import {processQueue} from './worker/publish.ts';export default {...worker,async fetch(req,env,ctx){if(new URL(req.url).pathname==='/__test/tick'){await processQueue(env);return new Response('ok');}return worker.fetch(req,{...env,PUBLISH_PAUSED:req.headers.get("X-Test-Pause") || "false"},ctx);}}`,
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
  await db.exec(readFileSync("migrations/0002_management.sql", "utf8"));
});
after(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  for (const table of [
    "trash",
    "media_links",
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
  comparison = "ahead";
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

test("a replaced upstream workflow retries the matching cancelled Pages artifact", async () => {
  const d = await create();
  const p = (await (
    await request("/publications", "POST", { draftId: d.id, version: 1 })
  ).json()) as any;
  await waitFor(p.id, "checking");
  await tick();
  deploy = "cancelled";
  pages = "cancelled";
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
  assert.ok(requests.includes("POST /actions/runs/3/rerun"));
  assert.ok(!requests.includes("POST /actions/runs/2/rerun-failed-jobs"));
  live = main;
  for (let i = 0; i < 30 && (await job(p.id)).status !== "published"; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal((await job(p.id)).status, "published");
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

test("maintenance blocks publications but allows saving drafts", async () => {
  const paused = { "X-Test-Pause": "true" };
  const saved = await request(
    "/drafts",
    "POST",
    { payload: { ...newArticle(), title: "Maintenance draft" } },
    paused,
  );
  assert.equal(saved.status, 201);
  const draft = (await saved.json()) as any;
  const response = await request(
    "/publications",
    "POST",
    { draftId: draft.id, version: 1 },
    paused,
  );
  assert.equal(response.status, 503);
  assert.match(((await response.json()) as any).error, /草稿仍可保存/);
  assert.equal(requests.length, 0);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS total FROM publications").first())
      .total,
    0,
  );
});

for (const history of ["diverged", "missing"]) {
  for (const failedAfterMerge of [false, true]) {
    test(`old ${failedAfterMerge ? "deployment" : "check"} retry rejects ${history} history without writes`, async () => {
      const draft = await create();
      if (!failedAfterMerge) check = "failure";
      const first = (await (
        await request("/publications", "POST", {
          draftId: draft.id,
          version: 1,
        })
      ).json()) as any;
      await waitFor(first.id, "checking");
      await tick();
      if (failedAfterMerge) {
        deploy = "failure";
        await tick();
      }
      assert.equal((await job(first.id)).status, "failed");
      comparison = history;
      const start = requests.length;
      const response = await request("/publications", "POST", {
        draftId: draft.id,
        version: 1,
        retry: true,
      });
      assert.equal(response.status, 409);
      assert.match(((await response.json()) as any).error, /保存草稿为新版本/);
      assert.ok(requests.slice(start).every((r) => r.startsWith("GET ")));
      assert.equal((await job(first.id)).status, "failed");
      assert.equal(
        (await db.prepare("SELECT COUNT(*) AS total FROM publications").first())
          .total,
        1,
      );
    });
  }
}

const HOME = "source/_data/personal.yml";
function homeFixture() {
  return "# personal comments\ndescription: Intro\nprojects:\n  - slug: original\n    title: Original\n    description: First\n    url: https://example.com\n    category: work\n    stack: [TypeScript]\n    custom: preserved\nrecent_focus:\n  - title: Focus\n    description: Original focus\n    tags: [learning]\ntopics: []\n";
}
async function manage(path: string, data?: any) {
  return request("/manage" + path, data === undefined ? "GET" : "POST", data);
}
async function publishedSummary() {
  const data = (await (await manage("")).json()) as any;
  return data.items.find((x: any) => x.key === "post:" + publicPath);
}
async function startDelete(key: string, mode = "trash") {
  const preview = (await (
    await manage("/delete-preview", { key })
  ).json()) as any;
  const response = await manage("/delete", { key, token: preview.token, mode });
  assert.ok(
    response.status === 200 || response.status === 202,
    JSON.stringify(await response.clone().json()),
  );
  return response.json() as Promise<any>;
}
async function finishJob(id: string) {
  await waitFor(id, "checking");
  await tick();
  await tick();
  live = main;
  await tick();
  assert.equal((await job(id)).status, "published");
}

test("management returns one summary per content and loads published bodies only on demand", async () => {
  const summary = await publishedSummary();
  assert.equal(summary.state, "已发布");
  assert.equal(summary.body, undefined);
  assert.equal(summary.payload, undefined);
  const opened = (await (
    await manage("/open", { key: summary.key })
  ).json()) as any;
  const modified = await request("/drafts/" + opened.id, "PUT", {
    version: 1,
    payload: { ...opened.payload, body: "Device edit" },
  });
  assert.equal(modified.status, 200);
  const list = (await (await manage("")).json()) as any;
  assert.equal(list.items.filter((x: any) => x.key === summary.key).length, 1);
  assert.equal(list.items[0].state, "修改待发布");
  const peek = (await (
    await manage("/open", { key: summary.key, choice: "published" })
  ).json()) as any;
  assert.equal(peek.content.body, "Old body\n");
  const continued = (await (
    await manage("/open", { key: summary.key })
  ).json()) as any;
  assert.equal(continued.payload.body, "Device edit");
});

test("unchanged saves do not increment draft versions or append history", async () => {
  const draft = await create();
  const response = await request("/drafts/" + draft.id, "PUT", {
    version: 1,
    payload: draft.payload,
  });
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as any).version, 1);
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM versions WHERE draft_id=?")
        .bind(draft.id)
        .first()
    ).n,
    1,
  );
  assert.equal(
    (
      await request("/drafts/" + draft.id, "PUT", {
        version: 0,
        payload: draft.payload,
      })
    ).status,
    409,
  );
});

test("private trash restores original identity and permanent deletion purges all draft history", async () => {
  const draft = await create(),
    key = "post:source/_posts/blog/" + draft.id + ".md";
  await startDelete(key);
  assert.equal((await request("/drafts/" + draft.id)).status, 404);
  const list = (await (await manage("")).json()) as any;
  assert.equal(list.items.find((x: any) => x.key === key).state, "回收站");
  const restored = (await (await manage("/restore", { key })).json()) as any;
  assert.equal(restored.id, draft.id);
  assert.equal(restored.payload.body, "Private draft");
  await startDelete(key, "purge");
  assert.equal(
    await db.prepare("SELECT id FROM drafts WHERE id=?").bind(draft.id).first(),
    null,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM versions WHERE draft_id=?")
        .bind(draft.id)
        .first()
    ).n,
    0,
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM trash").first()).n,
    0,
  );
});

test("delete confirmation rejects stale drafts without losing newer text", async () => {
  const draft = await create(),
    key = "post:source/_posts/blog/" + draft.id + ".md";
  const preview = (await (
    await manage("/delete-preview", { key })
  ).json()) as any;
  await request("/drafts/" + draft.id, "PUT", {
    version: 1,
    payload: { ...draft.payload, body: "newer" },
  });
  assert.equal(
    (await manage("/delete", { key, token: preview.token, mode: "purge" }))
      .status,
    409,
  );
  assert.equal(
    ((await (await request("/drafts/" + draft.id)).json()) as any).payload.body,
    "newer",
  );
});

test("published withdrawal is checked, idempotent and preserves a private recoverable snapshot", async () => {
  const summary = await publishedSummary();
  const preview = (await (
    await manage("/delete-preview", { key: summary.key })
  ).json()) as any;
  const [a, b] = await Promise.all([
    manage("/delete", {
      key: summary.key,
      token: preview.token,
      mode: "trash",
    }),
    manage("/delete", {
      key: summary.key,
      token: preview.token,
      mode: "trash",
    }),
  ]);
  const first = (await a.json()) as any,
    second = (await b.json()) as any;
  assert.equal(first.jobId, second.jobId);
  await waitFor(first.jobId, "checking");
  assert.ok(files.has(publicPath));
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM trash").first()).n,
    0,
  );
  await finishJob(first.jobId);
  assert.equal(files.has(publicPath), false);
  const registry = JSON.parse(
    files.get("source/_data/content-lifecycle.json")!.source,
  );
  assert.equal(registry[summary.key].mode, "trash");
  const archived = await db
    .prepare("SELECT * FROM trash WHERE content_key=?")
    .bind(summary.key)
    .first();
  assert.equal(JSON.parse(archived.payload).body, "Old body\n");
  const restored = (await (
    await manage("/restore", { key: summary.key })
  ).json()) as any;
  const pub = (await (
    await request("/publications", "POST", {
      draftId: restored.id,
      version: restored.version,
    })
  ).json()) as any;
  await finishJob(pub.id);
  assert.equal(files.get(publicPath)!.source, baseSource);
  assert.deepEqual(
    JSON.parse(files.get("source/_data/content-lifecycle.json")!.source),
    {},
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM trash").first()).n,
    0,
  );
});

test("failed deletion never removes current content or reports a completed trash operation", async () => {
  check = "failure";
  const summary = await publishedSummary(),
    del = await startDelete(summary.key);
  await waitFor(del.jobId, "checking");
  await tick();
  assert.equal((await job(del.jobId)).status, "failed");
  assert.ok(files.has(publicPath));
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM trash").first()).n,
    0,
  );
});

test("restore refuses occupied original addresses instead of overwriting external edits", async () => {
  const summary = await publishedSummary(),
    del = await startDelete(summary.key);
  await finishJob(del.jobId);
  files.set(publicPath, {
    source: baseSource.replace("Old body", "Other author"),
    sha: "external",
  });
  const restored = (await (
    await manage("/restore", { key: summary.key })
  ).json()) as any;
  const pub = (await (
    await request("/publications", "POST", { draftId: restored.id, version: 1 })
  ).json()) as any;
  await waitFor(pub.id, "conflict");
  assert.match(files.get(publicPath)!.source, /Other author/);
});

test("permanent deletion clears private snapshots only after a verified live deletion", async () => {
  const summary = await publishedSummary();
  const draft = (await (
    await manage("/open", { key: summary.key })
  ).json()) as any;
  const del = await startDelete(summary.key, "purge");
  await waitFor(del.jobId, "checking");
  assert.ok(
    await db.prepare("SELECT id FROM drafts WHERE id=?").bind(draft.id).first(),
  );
  await finishJob(del.jobId);
  assert.equal(files.has(publicPath), false);
  assert.equal(
    (await job(del.jobId)).payload,
    '{"kind":"deleted","title":"已永久删除的内容"}',
  );
  assert.equal(
    await db.prepare("SELECT id FROM drafts WHERE id=?").bind(draft.id).first(),
    null,
  );
  for (const table of ["versions", "conflicts", "trash"])
    assert.equal(
      (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,
      0,
    );
  assert.equal(
    JSON.parse(files.get("source/_data/content-lifecycle.json")!.source)[
      summary.key
    ].mode,
    "purge",
  );
});

test("scoped project publishing merges unrelated newer focus content and preserves unknown YAML", async () => {
  files.set(HOME, { source: homeFixture(), sha: "home-first" });
  const created = (await (
    await manage("/new", { scope: "project" })
  ).json()) as any;
  const { selectedEntry } = await import("../shared/content");
  const item = selectedEntry(created.payload);
  Object.assign(item, {
    title: "New project",
    slug: "new-project",
    description: "Independent",
    body: "# Details",
    stack: ["TS"],
  });
  await request("/drafts/" + created.id, "PUT", {
    version: 1,
    payload: created.payload,
  });
  files.set(HOME, {
    source: homeFixture().replace("Original focus", "External focus"),
    sha: "home-other",
  });
  const pub = (await (
    await request("/publications", "POST", { draftId: created.id, version: 2 })
  ).json()) as any;
  await finishJob(pub.id);
  const text = files.get(HOME)!.source;
  assert.match(text, /External focus/);
  assert.match(text, /New project/);
  assert.match(text, /custom: preserved/);
  assert.match(text, /# personal comments/);
});

test("same project edits conflict and legacy homepage drafts cannot publish mixed changes", async () => {
  files.set(HOME, { source: homeFixture(), sha: "home-first" });
  const row = ((await (await manage("")).json()) as any).items.find(
    (x: any) => x.type === "project",
  );
  const draft = (await (await manage("/open", { key: row.key })).json()) as any;
  files.set(HOME, {
    source: homeFixture().replace("title: Original", "title: External"),
    sha: "changed",
  });
  const pub = (await (
    await request("/publications", "POST", { draftId: draft.id, version: 1 })
  ).json()) as any;
  await waitFor(pub.id, "conflict");
  const { readContent } = await import("../shared/content");
  const old = (await (
    await request("/drafts", "POST", {
      payload: readContent({ path: HOME, source: homeFixture(), sha: "old" }),
    })
  ).json()) as any;
  assert.equal(
    (await request("/publications", "POST", { draftId: old.id, version: 1 }))
      .status,
    409,
  );
});

for (const shared of [false, true])
  test(`published attachment ${shared ? "shared retention" : "private archive and restoration"}`, async () => {
    const asset =
        "source/images/uploads/11111111-1111-4111-8111-111111111111.pdf",
      url = "/" + asset.slice(7),
      pdf = "%PDF-1.7\nArchive test\n";
    files.set(publicPath, {
      source: baseSource + `\n[PDF](${url})\n`,
      sha: "with-file",
    });
    files.set(asset, { source: pdf, sha: "pdf" });
    if (shared)
      files.set("source/_posts/blog/shared.md", {
        source:
          baseSource.replace("title: Existing", "title: Shared") +
          `\n[PDF](${url})\n`,
        sha: "shared",
      });
    const row = await publishedSummary(),
      preview = (await (
        await manage("/delete-preview", { key: row.key })
      ).json()) as any;
    assert.equal(preview.remove.length, shared ? 0 : 1);
    assert.equal(preview.keep.length, shared ? 1 : 0);
    const del = await startDelete(row.key);
    await finishJob(del.jobId);
    assert.equal(files.has(asset), shared);
    if (!shared) {
      const trash = await db
        .prepare("SELECT * FROM trash WHERE content_key=?")
        .bind(row.key)
        .first();
      const archive = JSON.parse(trash.assets)[0];
      const bucket = await mf.getR2Bucket("MEDIA");
      assert.equal(await (await bucket.get(archive.archive))!.text(), pdf);
      const assetsResponse = await request("/manage/assets?trash=" + trash.id);
      assert.equal(assetsResponse.status, 200);
      const assets = (await assetsResponse.json()) as any[];
      const archivedResponse = await mf.dispatchFetch(
        "https://studio.test" + assets[0].url,
        { headers: { Cookie: "studio_session=test-session" } },
      );
      assert.equal(
        archivedResponse.headers.get("Cache-Control"),
        "private, no-store",
      );
      assert.equal(await archivedResponse.text(), pdf);
      const restored = (await (
        await manage("/restore", { key: row.key })
      ).json()) as any;
      const pub = (await (
        await request("/publications", "POST", {
          draftId: restored.id,
          version: 1,
        })
      ).json()) as any;
      await finishJob(pub.id);
      assert.equal(files.get(asset)!.source, pdf);
      assert.equal(await bucket.get(archive.archive), null);
    }
  });

test("private permanent deletion removes attachment objects and metadata", async () => {
  const draft = await create(),
    key = "post:source/_posts/blog/" + draft.id + ".md",
    id = "22222222-2222-4222-8222-222222222222";
  const bucket = await mf.getR2Bucket("MEDIA");
  await bucket.put(id, "%PDF-1.7\nprivate");
  await db
    .prepare(
      "INSERT INTO media(id,draft_id,name,type,size,created) VALUES(?,?,?,'application/pdf',16,?)",
    )
    .bind(id, draft.id, "file.pdf", new Date().toISOString())
    .run();
  await startDelete(key, "purge");
  assert.equal(await bucket.get(id), null);
  assert.equal(
    await db.prepare("SELECT id FROM media WHERE id=?").bind(id).first(),
    null,
  );
});

test("management authentication and same-origin rules protect all destructive routes", async () => {
  for (const endpoint of ["", "/delete", "/restore", "/legacy"]) {
    assert.equal(
      (
        await mf.dispatchFetch("https://studio.test/api/manage" + endpoint, {
          method: endpoint ? "POST" : "GET",
          headers: endpoint ? { "Content-Type": "application/json" } : {},
          body: endpoint ? "{}" : undefined,
        })
      ).status,
      401,
    );
  }
  assert.equal(
    (
      await request(
        "/manage/delete",
        "POST",
        { key: "anything", mode: "purge" },
        { Origin: "https://evil.test" },
      )
    ).status,
    403,
  );
});

test("draft identities cannot be changed to another file", async () => {
  const draft = await create();
  assert.equal(
    (
      await request("/drafts/" + draft.id, "PUT", {
        version: 1,
        payload: {
          ...draft.payload,
          base: { path: publicPath, sha: "original", source: baseSource },
        },
      })
    ).status,
    400,
  );
});

test("withdrawal retains the newest unpublished changes for recovery", async () => {
  const row = await publishedSummary(),
    draft = (await (await manage("/open", { key: row.key })).json()) as any;
  await request("/drafts/" + draft.id, "PUT", {
    version: 1,
    payload: { ...draft.payload, body: "Unpublished work" },
  });
  const del = await startDelete(row.key);
  await finishJob(del.jobId);
  const restored = (await (
    await manage("/restore", { key: row.key })
  ).json()) as any;
  assert.equal(restored.payload.body, "Unpublished work");
  const history = (await (
    await request("/drafts/" + restored.id + "/versions")
  ).json()) as any[];
  assert.ok(history.some((v) => v.payload.body === "Unpublished work"));
});

test("large PDF attachments use the blob API and survive private archival", async () => {
  const asset =
      "source/images/uploads/33333333-3333-4333-8333-333333333333.pdf",
    pdf = "%PDF-1.7\n" + "x".repeat(1050000);
  files.set(publicPath, {
    source: baseSource + `\n[PDF](/${asset.slice(7)})\n`,
    sha: "large-post",
  });
  files.set(asset, { source: pdf, sha: "large-pdf" });
  const row = await publishedSummary(),
    del = await startDelete(row.key);
  await finishJob(del.jobId);
  const trash = await db
    .prepare("SELECT * FROM trash WHERE content_key=?")
    .bind(row.key)
    .first();
  const archive = JSON.parse(trash.assets)[0];
  const bucket = await mf.getR2Bucket("MEDIA");
  assert.equal((await bucket.get(archive.archive))!.size, pdf.length);
  assert.ok(requests.includes("GET /git/blobs/large-pdf"));
});

test("permanent project deletion scrubs legacy homepage snapshots while preserving other entries", async () => {
  files.set(HOME, {
    source: homeFixture().replace(
      "    custom: preserved",
      "    custom: preserved\n    body: SECRET_PROJECT_BODY",
    ),
    sha: "home-secret",
  });
  const raw = (await import("../shared/content")).readContent({
    path: HOME,
    source: files.get(HOME)!.source,
    sha: "home-secret",
  });
  const legacy = (await (
    await request("/drafts", "POST", { payload: raw })
  ).json()) as any;
  const row = ((await (await manage("")).json()) as any).items.find(
    (x: any) => x.type === "project",
  );
  const del = await startDelete(row.key, "purge");
  await finishJob(del.jobId);
  const saved = await db
    .prepare("SELECT payload FROM drafts WHERE id=?")
    .bind(legacy.id)
    .first();
  assert.ok(!saved.payload.includes("SECRET_PROJECT_BODY"));
  assert.ok(saved.payload.includes("Original focus"));
  const versions = (
    await db
      .prepare("SELECT payload FROM versions WHERE draft_id=?")
      .bind(legacy.id)
      .all()
  ).results;
  assert.ok(
    versions.every((v: any) => !v.payload.includes("SECRET_PROJECT_BODY")),
  );
});

test("permanent cleanup removes attachment archives left by an earlier failed attempt", async () => {
  const row = await publishedSummary(),
    draft = (await (await manage("/open", { key: row.key })).json()) as any,
    id = crypto.randomUUID(),
    archive = "trash/failed/fixture";
  const bucket = await mf.getR2Bucket("MEDIA");
  await bucket.put(archive, "sensitive attachment");
  await db
    .prepare(
      "INSERT INTO publications(id,draft_id,version,attempt,status,payload,created,updated,result,target_key) VALUES(?,?,1,0,'failed',?,?,?, ?,?)",
    )
    .bind(
      id,
      draft.id,
      JSON.stringify(draft.payload),
      new Date().toISOString(),
      new Date().toISOString(),
      JSON.stringify({ assets: [{ archive }] }),
      row.key,
    )
    .run();
  const del = await startDelete(row.key, "purge");
  await finishJob(del.jobId);
  assert.equal(await bucket.get(archive), null);
});


test("legacy project import keeps its private attachment usable without publishing other home edits",async()=>{
 files.set(HOME,{source:homeFixture(),sha:"home-first"});
 const {readContent,selectedEntry}=await import("../shared/content");
 const value=readContent({path:HOME,sha:"home-first",source:homeFixture()}) as any;
 const old=await (await request("/drafts","POST",{payload:value})).json() as any,id="44444444-4444-4444-8444-444444444444";
 const pdf="%PDF-1.7\nLegacy attachment";const bucket=await mf.getR2Bucket("MEDIA");await bucket.put(id,pdf);
 await db.prepare("INSERT INTO media(id,draft_id,name,type,size,created) VALUES(?,?,?,'application/pdf',?,?)").bind(id,old.id,"old.pdf",pdf.length,new Date().toISOString()).run();
 value.data.projects[0].body=`[old.pdf](/api/media/${id})`;value.data.recent_focus[0].description="PRIVATE_OTHER_EDIT";
 await request("/drafts/"+old.id,"PUT",{version:1,payload:value});
 const imported=await (await manage("/legacy",{id:old.id,scope:"project",entryId:"original"})).json() as any;
 assert.match(selectedEntry(imported.payload).body,/api\/media/);
 const pub=await (await request("/publications","POST",{draftId:imported.id,version:1})).json() as any;await finishJob(pub.id);
 assert.ok(!files.get(HOME)!.source.includes("PRIVATE_OTHER_EDIT"));assert.match(files.get(HOME)!.source,/images\/uploads\/44444444/);
});
