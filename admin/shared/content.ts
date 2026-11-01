import { parseDocument, parse } from "yaml";
export type Section = "blog" | "knowledge" | "diary";
export type Base = { path: string; sha: string; source: string; url?: string };
export type Article = {
  kind: "post";
  title: string;
  body: string;
  section: Section;
  date: string;
  categories: unknown[];
  tags: string[];
  description: string;
  permalink?: string;
  importSource?: string;
  base?: Base;
};
export type Home = {
  kind: "home";
  title: string;
  data: Record<string, any>;
  base: Base;
};
export type Content = Article | Home;
export const HOME_PATH = "source/_data/personal.yml";
export const labels = { blog: "博客", knowledge: "知识库", diary: "日记" };
export function allowedPath(path: string) {
  return (
    !path.includes("..") &&
    !/[\\\u0000-\u001f]/.test(path) &&
    (path === HOME_PATH || /^source\/_posts\/(?!\/).+\.md$/.test(path))
  );
}
export function splitArticle(source: string) {
  const m = source
    .replace(/^\uFEFF/, "")
    .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!m) throw new Error("Markdown 开头需要完整的 --- 文章信息区。");
  const doc = parseDocument(m[1]);
  if (doc.errors.length)
    throw new Error("文章信息格式有误：" + doc.errors[0].message);
  return { doc, meta: doc.toJS() || {}, body: m[2].replace(/^\r?\n/, "") };
}
export function sectionOf(meta: Record<string, any>): Section {
  if (["blog", "knowledge", "diary"].includes(meta.section))
    return meta.section;
  const cats = JSON.stringify(meta.categories || []);
  return cats.includes("日记")
    ? "diary"
    : /学校课程|证书考试|读书笔记/.test(cats)
      ? "knowledge"
      : "blog";
}
export function readContent(base: Base): Content {
  if (base.path === HOME_PATH)
    return { kind: "home", title: "首页内容", data: parse(base.source), base };
  const { meta, body } = splitArticle(base.source);
  return {
    kind: "post",
    title: String(meta.title || ""),
    body,
    section: sectionOf(meta),
    date: String(meta.date || ""),
    categories: Array.isArray(meta.categories)
      ? meta.categories
      : meta.categories
        ? [meta.categories]
        : [],
    tags: Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [],
    description: String(meta.description || ""),
    permalink: meta.permalink,
    base,
  };
}
export function newArticle(section: Section = "blog"): Article {
  const date = new Date().toLocaleString("sv-SE", {
    timeZone: "Asia/Shanghai",
  });
  return {
    kind: "post",
    title: "",
    body: "",
    section,
    date,
    categories: [labels[section]],
    tags: [],
    description: "",
  };
}
export function importMarkdown(source: string, filename: string): Article {
  if (!source.replace(/^\uFEFF/, "").startsWith("---"))
    return {
      ...newArticle(),
      title: filename.replace(/\.(?:md|markdown)$/i, ""),
      body: source,
    };
  const value = readContent({
    path: "source/_posts/import.md",
    sha: "",
    source,
  }) as Article;
  value.importSource = source;
  delete value.base;
  return value;
}
export function validateContent(value: Content) {
  if (!value || !["post", "home"].includes(value.kind))
    throw new Error("内容类型不正确。");
  if (value.base && !allowedPath(value.base.path))
    throw new Error("不允许修改这个文件。");
  if (value.kind === "post") {
    if (!value.title.trim() || value.title.length > 200)
      throw new Error("请填写 1–200 字的标题。");
    if (!["blog", "knowledge", "diary"].includes(value.section))
      throw new Error("请选择内容分区。");
    if (
      !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/.test(value.date) ||
      !Number.isFinite(
        Date.parse(
          value.date.replace(" ", "T") +
            (/Z|[+-]\d\d:\d\d$/.test(value.date) ? "" : "+08:00"),
        ),
      )
    )
      throw new Error("日期格式不正确。");
    if (value.body.length > 1_000_000)
      throw new Error("文章正文过大，请拆分后保存。");
    if (!Array.isArray(value.categories) || !Array.isArray(value.tags))
      throw new Error("分类和标签格式不正确。");
    if (value.base) {
      const old = readContent(value.base) as Article;
      if (value.date !== old.date || value.permalink !== old.permalink)
        throw new Error("已发布文章的发布日期和固定地址不能修改。");
    }
  } else {
    if (value.base.path !== HOME_PATH) throw new Error("首页来源不正确。");
    for (const key of ["projects", "topics", "recent_focus"])
      if (!Array.isArray(value.data[key]))
        throw new Error("首页列表不完整：" + key);
    for (const item of value.data.recent_focus)
      if (
        !item.title?.trim() ||
        !item.description?.trim() ||
        !Array.isArray(item.tags)
      )
        throw new Error("请补齐关注标题、描述和标签。");
    const slugs = new Set();
    for (const p of value.data.projects) {
      if (
        !p.title?.trim() ||
        !p.description?.trim() ||
        !p.category?.trim() ||
        !Array.isArray(p.stack) ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) ||
        slugs.has(p.slug)
      )
        throw new Error("项目需要完整信息和唯一英文短名。");
      if (!/^(?:\/(?!\/)|https:\/\/)/.test(p.url))
        throw new Error("项目链接需以 / 或 https:// 开头。");
      slugs.add(p.slug);
    }
  }
}
export function serializeContent(
  value: Content,
  id: string,
): { path: string; source: string; url: string } {
  validateContent(value);
  if (value.kind === "home") {
    const doc = parseDocument(value.base.source);
    for (const key of ["description", "projects", "recent_focus"])
      doc.set(key, value.data[key]);
    doc.set(
      "focus_updated",
      value.data.focus_updated ||
        new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
    );
    return { path: HOME_PATH, source: doc.toString(), url: "/" };
  }
  const doc = articleDocument(value);
  if (!value.base)
    doc.set(
      "permalink",
      value.date.slice(0, 10).replaceAll("-", "/") + "/" + id + "/",
    );
  const path = value.base?.path || `source/_posts/${value.section}/${id}.md`;
  return {
    path,
    source: "---\n" + doc.toString() + "---\n\n" + value.body + "\n",
    url: value.base?.url || "/" + String(doc.get("permalink")),
  };
}
export function specialMarkup(body: string) {
  return /<\/?[a-z][\s\S]*?>|\{%/.test(body);
}
function articleDocument(value: Article) {
  const source = value.base?.source || value.importSource;
  const doc = source ? splitArticle(source).doc : parseDocument("");
  const original = source
    ? (readContent({
        path: "source/_posts/import.md",
        sha: "",
        source,
      }) as Article)
    : undefined;
  for (const key of [
    "title",
    "date",
    "section",
    "categories",
    "tags",
    "description",
  ] as const)
    if (
      !original ||
      JSON.stringify(original[key]) !== JSON.stringify(value[key])
    )
      doc.set(key, value[key]);
  return doc;
}
export function exportMarkdown(value: Article) {
  return "---\n" + articleDocument(value).toString() + "---\n\n" + value.body;
}
