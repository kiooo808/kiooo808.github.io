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
  console.log(`Pages recovery: live revision request HTTP ${live.status}.`);
  if (live.status === 404) return null;
  if (!live.ok)
    throw new Error(`Cannot verify live revision (HTTP ${live.status}).`);
  const revision = await live.json();
  if (!/^[0-9a-f]{40}$/.test(revision.commit)) return null;
  console.log(`Pages recovery: current live source ${revision.commit}.`);
  const response = await api("/actions/runs?branch=gh-pages&per_page=100");
  if (!response.ok)
    throw new Error(
      `Cannot inspect completed Pages deployments (HTTP ${response.status}).`,
    );
  const allRuns = (await response.json()).workflow_runs;
  async function reportedBlocker(run) {
    const sha = run.head_sha;
    const failures = allRuns
      .slice(0, allRuns.indexOf(run))
      .filter(
        (r) =>
          names.includes(r.name) &&
          r.status === "completed" &&
          r.conclusion === "failure" &&
          Number.isSafeInteger(r.id),
      )
      .slice(0, 3);
    for (const failure of failures) {
      const result = await api(`/actions/runs/${failure.id}/jobs`);
      if (!result.ok)
        throw new Error(
          `Cannot inspect failed Pages jobs (HTTP ${result.status}).`,
        );
      const job = (await result.json()).jobs.find(
        (j) =>
          j.name === "deploy" &&
          j.status === "completed" &&
          j.conclusion === "failure" &&
          Number.isSafeInteger(j.id),
      );
      if (!job) continue;
      const logs = await api(`/actions/jobs/${job.id}/logs`);
      if (!logs.ok)
        throw new Error(
          `Cannot inspect Pages failure reason (HTTP ${logs.status}).`,
        );
      if ((await logs.text()).includes(`Please cancel ${sha} first`))
        return true;
    }
    return false;
  }
  const runs = allRuns
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
    console.log(
      `Pages recovery: completed artifact ${run.head_sha} reports ${JSON.stringify(status)}.`,
    );
    if (typeof status !== "string")
      throw new Error("Missing previous Pages status; refusing cancellation.");
    const pending = [
      "",
      "deployment_queued",
      "deployment_pending",
      "deployment_in_progress",
      "queued",
      "pending",
      "in_progress",
    ].includes(status);
    if (!pending && !(status === "succeed" && (await reportedBlocker(run))))
      return null;
    // Only a completed successful workflow whose artifact is already live is eligible.
    // A successful status also needs an explicit matching blocker in a newer failed job.
    // Running workflows and unrelated artifacts are never eligible.
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
