"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../..");
const yaml = createRequire(path.join(root, "admin/package.json"))("yaml");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "myblog-management-"));
const copy = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
for (const file of copy) {
  const from = path.join(root, file);
  if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
  const to = path.resolve(work, file);
  assert(to.startsWith(work + path.sep));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
fs.symlinkSync(
  path.join(root, "node_modules"),
  path.join(work, "node_modules"),
  process.platform === "win32" ? "junction" : "dir",
);
try {
  const post = "source/_posts/blog/management-fixture.md",
    url = "/management-fixture/",
    key = "post:" + post;
  const source =
    "---\ntitle: Management fixture\ndate: 2026-01-01 12:00:00\nsection: blog\npermalink: management-fixture/\n---\n\nFixture body only.\n";
  const registry = path.join(work, "source/_data/content-lifecycle.json");
  const existingRegistry = fs.existsSync(registry)
    ? JSON.parse(fs.readFileSync(registry, "utf8"))
    : {};
  const homeFile = path.join(work, "source/_data/personal.yml");
  const home = yaml.parseDocument(fs.readFileSync(homeFile, "utf8"));
  home
    .get("projects", true)
    .add({
      slug: "management-fixture",
      title: "Project fixture",
      description: "Project description",
      body: "# Project details\n\nFixture **body**.",
      url: "https://example.com",
      category: "fixture",
      stack: ["Fixture"],
    });
  fs.writeFileSync(homeFile, home.toString());
  fs.mkdirSync(path.dirname(path.join(work, post)), { recursive: true });
  fs.writeFileSync(path.join(work, post), source);
  const legacyFile = path.join(work, "tools/fixtures/legacy-urls.json");
  const legacy = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
  legacy.push("management-fixture/index.html");
  fs.writeFileSync(legacyFile, JSON.stringify(legacy));
  function run(phase) {
    try {
      const cli = require.resolve("hexo-cli/bin/hexo");
      execFileSync(process.execPath, [cli, "clean"], {
        cwd: work,
        stdio: "pipe",
      });
      execFileSync(process.execPath, [cli, "generate", "--bail"], {
        cwd: work,
        stdio: "pipe",
      });
      execFileSync(
        process.execPath,
        [path.join(work, "tools/checks/check-site.cjs")],
        { cwd: work, stdio: "pipe" },
      );
    } catch (e) {
      throw new Error(
        phase +
          ": " +
          (e.stdout?.toString() || "") +
          (e.stderr?.toString() || e.message),
      );
    }
    console.log("Management site: " + phase + " passed");
  }
  run("published content and project");
  assert(
    fs
      .readFileSync(
        path.join(work, "public/projects/management-fixture/index.html"),
        "utf8",
      )
      .includes("<strong>body</strong>"),
  );
  assert(
    fs
      .readFileSync(
        path.join(work, "public/projects/management-fixture/index.html"),
        "utf8",
      )
      .includes("访问项目"),
  );
  fs.unlinkSync(path.join(work, post));
  fs.writeFileSync(
    registry,
    JSON.stringify({ ...existingRegistry, [key]: { url, mode: "trash", retired: [] } }),
  );
  run("withdrawn notice");
  let html = fs.readFileSync(
    path.join(work, "public/management-fixture/index.html"),
    "utf8",
  );
  assert(html.includes("内容已撤下"));
  assert(!html.includes("Fixture body only"));
  assert(
    !fs
      .readFileSync(path.join(work, "public/local-search.xml"), "utf8")
      .includes("Management fixture"),
  );
  fs.writeFileSync(
    registry,
    JSON.stringify({ ...existingRegistry, [key]: { url, mode: "purge", retired: [] } }),
  );
  run("permanent deletion");
  assert(
    !fs.existsSync(path.join(work, "public/management-fixture/index.html")),
  );
  fs.writeFileSync(path.join(work, post), source);
  fs.writeFileSync(registry, JSON.stringify(existingRegistry));
  run("restored original address");
  assert(
    fs
      .readFileSync(
        path.join(work, "public/management-fixture/index.html"),
        "utf8",
      )
      .includes("Fixture body only"),
  );
} finally {
  // The temporary copy contains only repository files and fixtures; never remove its node_modules target.
  fs.unlinkSync(path.join(work, "node_modules"));
  assert(
    path
      .resolve(work)
      .startsWith(path.resolve(os.tmpdir()) + path.sep + "myblog-management-"),
  );
  fs.rmSync(work, { recursive: true, force: true });
}
