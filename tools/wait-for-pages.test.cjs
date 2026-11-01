"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { waitForPages } = require("./wait-for-pages.cjs");
const options = {
  repository: "owner/site",
  head: "artifact-head",
  revision: "source-revision",
  site: "https://site.test",
  token: "fake",
  attempts: 2,
};
const response = (value) => Response.json(value);

test("deployment holds the lock until the exact checked revision is live", async () => {
  let reads = 0,
    waits = 0;
  await waitForPages(options, {
    fetch: async (url) =>
      url.startsWith(options.site)
        ? response({ commit: ++reads === 2 ? options.revision : "old" })
        : response({
            workflow_runs: [
              {
                name: "pages build and deployment",
                head_sha: options.head,
                status: "completed",
                conclusion: "success",
              },
            ],
          }),
    sleep: async () => {
      waits++;
    },
  });
  assert.equal(reads, 2);
  assert.equal(waits, 1);
});
test("a downstream Pages failure fails deployment even when the artifact push succeeded", async () => {
  await assert.rejects(
    waitForPages(options, {
      fetch: async (url) =>
        url.startsWith(options.site)
          ? response({ commit: "old" })
          : response({
              workflow_runs: [
                {
                  name: "pages build and deployment",
                  head_sha: options.head,
                  status: "completed",
                  conclusion: "failure",
                  html_url: "https://github.com/owner/site/actions/runs/1",
                },
              ],
            }),
      sleep: async () => {},
    }),
    /GitHub Pages failed/,
  );
});
test("another artifact head cannot fail this deployment and a stale site cannot count as success", async () => {
  await assert.rejects(
    waitForPages(options, {
      fetch: async (url) =>
        url.startsWith(options.site)
          ? response({ commit: "old" })
          : response({
              workflow_runs: [
                {
                  name: "pages build and deployment",
                  head_sha: "unrelated",
                  status: "completed",
                  conclusion: "failure",
                },
              ],
            }),
      sleep: async () => {},
    }),
    /Timed out/,
  );
});
test("a confirmed stale blocker is recovered and the same Pages artifact is retried once", async () => {
  let reads = 0,
    recoveries = 0,
    retries = 0;
  await waitForPages(options, {
    fetch: async (url, init = {}) => {
      if (url.startsWith(options.site))
        return response({ commit: ++reads === 2 ? options.revision : "old" });
      if (init.method === "POST") {
        retries++;
        assert.ok(url.endsWith("/actions/runs/7/rerun-failed-jobs"));
        return new Response(null, { status: 201 });
      }
      return response({
        workflow_runs: [
          {
            id: 7,
            name: "pages build and deployment",
            head_sha: options.head,
            status: "completed",
            conclusion: retries ? "success" : "failure",
          },
        ],
      });
    },
    recover: async () => {
      recoveries++;
      return "previous-artifact";
    },
    sleep: async () => {},
  });
  assert.equal(recoveries, 1);
  assert.equal(retries, 1);
});
test("recovery does not loop if Pages fails again", async () => {
  let recoveries = 0,
    retries = 0;
  await assert.rejects(
    waitForPages(options, {
      fetch: async (url, init = {}) => {
        if (url.startsWith(options.site)) return response({ commit: "old" });
        if (init.method === "POST") {
          retries++;
          return new Response(null, { status: 201 });
        }
        return response({
          workflow_runs: [
            {
              id: 7,
              name: "pages build and deployment",
              head_sha: options.head,
              status: "completed",
              conclusion: "failure",
            },
          ],
        });
      },
      recover: async () => {
        recoveries++;
        return "previous-artifact";
      },
      sleep: async () => {},
    }),
    /GitHub Pages failed/,
  );
  assert.equal(recoveries, 1);
  assert.equal(retries, 1);
});
test("a visible revision does not release the lock while Pages is still running", async () => {
  let runs = 0,
    waits = 0;
  await waitForPages(options, {
    fetch: async (url) =>
      url.startsWith(options.site)
        ? response({ commit: options.revision })
        : response({
            workflow_runs: [
              {
                name: "pages build and deployment",
                head_sha: options.head,
                status: ++runs === 1 ? "in_progress" : "completed",
                conclusion: runs === 1 ? null : "success",
              },
            ],
          }),
    sleep: async () => {
      waits++;
    },
  });
  assert.equal(runs, 2);
  assert.equal(waits, 1);
});
