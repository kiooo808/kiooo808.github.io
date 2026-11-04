import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  readContent,
  serializeContent,
  splitArticle,
  validateContent,
  allowedPath,
  specialMarkup,
  exportMarkdown,
  importMarkdown,
  Article,
} from "../shared/content";
const posts = path.resolve(import.meta.dirname, "../../source/_posts");
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}
test("all existing Markdown posts retain metadata, bodies and identity when opened and saved", () => {
  const files = walk(posts).filter((file) => file.endsWith(".md"));
  assert.ok(
    files.length > 0,
    "round-trip every current article; the collection may grow",
  );
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const value = readContent({
      path: "source/_posts/" + path.relative(posts, file).replaceAll("\\", "/"),
      sha: "old",
      source,
      url: "/existing/url/",
    }) as Article;
    const next = serializeContent(value, "unused");
    const before = splitArticle(source),
      after = splitArticle(next.source);
    assert.equal(next.path, value.base!.path);
    assert.equal(next.url, "/existing/url/");
    assert.equal(after.body.trim(), before.body.trim());
    for (const key of Object.keys(before.meta))
      assert.deepEqual(after.meta[key], before.meta[key]);
  }
});
test("source-only markup is identified, unknown front matter and comments survive edits", () => {
  const source =
    '---\ntitle: Old\ndate: 2026-04-01 12:00:00\n# do not lose\ncustom: {a: 1}\n---\n\n<iframe src="01.pdf"></iframe>\n';
  const value = readContent({
    path: "source/_posts/a.md",
    source,
    sha: "old",
  }) as Article;
  value.title = "New";
  const saved = serializeContent(value, "id").source;
  assert.ok(saved.includes("# do not lose"));
  assert.deepEqual(splitArticle(saved).meta.custom, { a: 1 });
  assert.ok(specialMarkup(value.body));
  assert.throws(() =>
    validateContent({ ...value, date: "2026-04-02 12:00:00" }),
  );
});
test("content paths reject traversal, executable files and arbitrary config edits", () => {
  for (const p of [
    "source/_posts/../_config.yml",
    "source/_posts/evil.js",
    "_config.yml",
    "source/_posts/\\x.md",
    "source/_posts//x.md",
  ])
    assert.equal(allowedPath(p), false, p);
});
test("homepage updates preserve topics, exclusions, comments and unrelated fields", () => {
  const source = readFileSync(
    path.resolve(import.meta.dirname, "../../source/_data/personal.yml"),
    "utf8",
  );
  const value = readContent({
    path: "source/_data/personal.yml",
    source,
    sha: "old",
  });
  assert.equal(value.kind, "home");
  if (value.kind !== "home") return;
  value.data.recent_focus = [
    { title: "Updated", description: "Updated focus", tags: [] },
  ];
  // New rich projects may have an introduction without an external app link
  // or an automatic article category. Preserve them during legacy round trips.
  value.data.projects.push({
    id: "optional-project",
    slug: "optional-project",
    title: "Project introduction",
    description: "Standalone project details",
    stack: [],
  });
  const next = serializeContent(value, "unused");
  const parsed = readContent({
    path: next.path,
    sha: "new",
    source: next.source,
  });
  assert.equal(parsed.kind, "home");
  if (parsed.kind !== "home") return;
  assert.deepEqual(parsed.data.topics, value.data.topics);
  assert.deepEqual(parsed.data.home_exclude, value.data.home_exclude);
  assert.ok(next.source.includes("# Public topic summaries"));
  assert.equal(parsed.data.recent_focus[0].title, "Updated");
  assert.deepEqual(parsed.data.projects, value.data.projects);
});
test("import and export retain unknown metadata and special body without locking new article date", () => {
  const source =
    '---\ntitle: Imported\ndate: 2026-04-01 10:00:00\ncustom: preserve\ncategories: [学校课程, 电气控制技术]\n---\n\n<iframe src="01.pdf"></iframe>\n';
  const value = readContent({
    path: "source/_posts/import.md",
    sha: "",
    source,
  }) as Article;
  value.importSource = source;
  delete value.base;
  value.date = "2026-11-01 12:00:00";
  const out = splitArticle(exportMarkdown(value));
  assert.equal(out.meta.custom, "preserve");
  assert.equal(out.meta.date, value.date);
  assert.deepEqual(out.meta.categories, ["学校课程", "电气控制技术"]);
  assert.ok(out.body.includes("<iframe"));
  assert.equal(
    splitArticle(serializeContent(value, "stable-id").source).meta.permalink,
    "2026/11/01/stable-id/",
  );
});
test("plain Markdown imports as a draft while broken front matter reports an error", () => {
  const article = importMarkdown("# A note\n\nBody", "notes.md");
  assert.equal(article.title, "notes");
  assert.equal(article.body, "# A note\n\nBody");
  assert.equal(article.base, undefined);
  assert.throws(() => importMarkdown("---\ntitle: broken\n", "bad.md"));
});
