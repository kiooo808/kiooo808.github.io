"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { recoverStalePages } = require("./recover-stale-pages.cjs");
const old = "a".repeat(40),
  newer = "b".repeat(40),
  source = "c".repeat(40);
const options = {
  repository: "owner/site",
  site: "https://site.test",
  token: "fake",
};
function service({ status = "", matches = true, running = false } = {}) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push([url, init.method || "GET"]);
    if (url.startsWith(options.site)) {
      assert.ok(!init.headers?.Authorization);
      return Response.json({ commit: source });
    }
    if (url.includes("/actions/runs?"))
      return Response.json({
        workflow_runs: [
          {
            name: "pages build and deployment",
            head_sha: newer,
            status: "in_progress",
            conclusion: null,
          },
          {
            name: "pages build and deployment",
            head_sha: old,
            status: running ? "in_progress" : "completed",
            conclusion: running ? null : "success",
          },
        ],
      });
    if (url.includes("/contents/revision.json?"))
      return Response.json({
        encoding: "base64",
        content: Buffer.from(
          JSON.stringify({ commit: matches ? source : newer }),
        ).toString("base64"),
      });
    if (url.endsWith("/cancel")) return new Response(null, { status: 204 });
    if (url.endsWith("/pages/deployments/" + old))
      return Response.json({ status });
    throw new Error("Unexpected request " + url);
  };
  return { fetch, requests };
}
test("recover only a stale completed deployment whose source is already live", async () => {
  const s = service();
  assert.equal(await recoverStalePages(options, s), old);
  assert.deepEqual(
    s.requests.filter((x) => x[1] === "POST"),
    [
      [
        `https://api.github.com/repos/owner/site/pages/deployments/${old}/cancel`,
        "POST",
      ],
    ],
  );
});
test("a normally completed Pages deployment is left alone", async () => {
  const s = service({ status: "succeed" });
  assert.equal(await recoverStalePages(options, s), null);
  assert.equal(s.requests.filter((x) => x[1] === "POST").length, 0);
});
test("running deployments and unrelated artifacts cannot be cancelled", async () => {
  for (const setup of [{ running: true }, { matches: false }]) {
    const s = service(setup);
    assert.equal(await recoverStalePages(options, s), null);
    assert.equal(s.requests.filter((x) => x[1] === "POST").length, 0);
  }
});
test("completed workflows with a stuck pending Pages status can be recovered", async () => {
  const s = service({ status: "deployment_in_progress" });
  assert.equal(await recoverStalePages(options, s), old);
});
test("unreadable Pages status cannot authorize cancellation", async () => {
  const s = service();
  const fetch = async (url, init) => url.endsWith('/pages/deployments/'+old)
    ? Response.json({}) : s.fetch(url,init);
  await assert.rejects(recoverStalePages(options,{fetch}),/refusing cancellation/);
  assert.equal(s.requests.filter(x=>x[1]==='POST').length,0);
});
