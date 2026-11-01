"use strict";
const names = ["pages-build-deployment", "pages build and deployment"];
async function recoverStalePages(
  { repository, site, token },
  { fetch = globalThis.fetch } = {},
) {
  const api = async (path, method = "GET") =>
    fetch(`https://api.github.com/repos/${repository}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "MyBlog-deployment",
      },
      signal: AbortSignal.timeout(15000),
    });
  const live = await fetch(`${site}/revision.json?preflight=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(15000),
  });
  if (!live.ok) return null;
  const revision = await live.json();
  if (!/^[0-9a-f]{40}$/.test(revision.commit)) return null;
  const response = await api("/actions/runs?branch=gh-pages&per_page=100");
  if (!response.ok)
    throw new Error(
      `Cannot inspect completed Pages deployments (HTTP ${response.status}).`,
    );
  const runs = (await response.json()).workflow_runs
    .filter(
      (r) =>
        names.includes(r.name) &&
        r.status === "completed" &&
        r.conclusion === "success" &&
        /^[0-9a-f]{40}$/.test(r.head_sha),
    )
    .slice(0, 5);
  for (const run of runs) {
    const artifact = await api(`/contents/revision.json?ref=${run.head_sha}`);
    if (artifact.status === 404) continue;
    if (!artifact.ok)
      throw new Error(
        `Cannot identify previous artifact (HTTP ${artifact.status}).`,
      );
    const file = await artifact.json();
    if (file.encoding !== "base64")
      throw new Error("Invalid previous revision file.");
    const source = JSON.parse(
      Buffer.from(file.content, "base64").toString("utf8"),
    );
    if (source.commit !== revision.commit) continue;
    const state = await api(`/pages/deployments/${run.head_sha}`);
    if (state.status === 404) return null;
    if (!state.ok)
      throw new Error(
        `Cannot inspect previous Pages status (HTTP ${state.status}).`,
      );
    const status = (await state.json()).status;
    if (typeof status !== "string")
      throw new Error("Missing previous Pages status; refusing cancellation.");
    if (
      ![
        "",
        "deployment_queued",
        "deployment_pending",
        "deployment_in_progress",
        "queued",
        "pending",
        "in_progress",
      ].includes(status)
    )
      return null;
    // Only a completed successful workflow whose artifact is already live is eligible.
    // Never cancel a running workflow, an unrelated artifact, or a normally finished deployment.
    const cancelled = await api(
      `/pages/deployments/${run.head_sha}/cancel`,
      "POST",
    );
    if (cancelled.status !== 204)
      throw new Error(
        `Cannot release stale Pages deployment (HTTP ${cancelled.status}).`,
      );
    return run.head_sha;
  }
  return null;
}
module.exports = { recoverStalePages };
if (require.main === module) {
  if (
    !process.env.GITHUB_TOKEN ||
    !process.env.GITHUB_REPOSITORY ||
    !process.env.SITE_URL
  )
    throw new Error("Missing deployment configuration.");
  recoverStalePages({
    repository: process.env.GITHUB_REPOSITORY,
    site: process.env.SITE_URL,
    token: process.env.GITHUB_TOKEN,
  })
    .then((id) =>
      console.log(
        id
          ? `Released stale completed Pages deployment ${id}.`
          : "No stale completed Pages deployment needs recovery.",
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
