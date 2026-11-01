"use strict";
const { execFileSync } = require("node:child_process");

async function waitForPages(
  { repository, head, revision, site, token, attempts = 40 },
  {
    fetch = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    let live;
    try {
      const response = await fetch(`${site}/revision.json?deploy=${revision}`, {
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) live = await response.json();
    } catch {
      /* A transient CDN/network delay is not a successful deployment. */
    }
    if (live?.commit === revision) return;
    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/runs?head_sha=${head}&per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "MyBlog-deployment",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Cannot inspect GitHub Pages status (HTTP ${response.status}).`,
      );
    const data = await response.json();
    const run = data.workflow_runs.find(
      (run) => run.head_sha === head && ["pages-build-deployment", "pages build and deployment"].includes(run.name),
    );
    if (run?.status === "completed" && run.conclusion !== "success")
      throw new Error(
        `GitHub Pages failed: ${run.html_url}. The live site still has the previous revision.`,
      );
    if (attempt + 1 < attempts) await sleep(15000);
  }
  throw new Error(
    "Timed out waiting for the checked revision to be live on GitHub Pages.",
  );
}

module.exports = { waitForPages };
if (require.main === module) {
  const head = execFileSync(
    "git",
    ["ls-remote", "origin", "refs/heads/gh-pages"],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\s/)[0];
  if (!head || !process.env.GITHUB_SHA || !process.env.GITHUB_TOKEN)
    throw new Error("Missing deployment identity.");
  waitForPages({
    repository: process.env.GITHUB_REPOSITORY,
    head,
    revision: process.env.GITHUB_SHA,
    site: process.env.SITE_URL,
    token: process.env.GITHUB_TOKEN,
  })
    .then(() => console.log("GitHub Pages is serving the checked revision."))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
