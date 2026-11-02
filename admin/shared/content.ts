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
  restoreId?: string;
};
export type Home = {
  kind: "home";
  title: string;
  data: Record<string, any>;
  base: Base;
  scope?: "project" | "focus" | "intro";
  entryId?: string;
  restoreId?: string;
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
    if (value.scope) {
      const item = selectedEntry(value);
      if (!value.entryId || !item) throw new Error("条目身份不完整。");
      if (value.scope === "intro") return;
      if (!item.title?.trim() || !item.description?.trim())
        throw new Error("请填写标题和简介。");
      if (item.order !== undefined && !Number.isFinite(item.order))
        throw new Error("展示顺序需为数字。");
      if (value.scope === "project") {
        if (
          !Array.isArray(item.stack) ||
          (item.related_posts !== undefined &&
            (!Array.isArray(item.related_posts) ||
              item.related_posts.some(
                (url: any) => typeof url !== "string" || !/^\/(?!\/)/.test(url),
              )))
        )
          throw new Error("技术栈或关联文章地址不正确。");
        if (item.body !== undefined && typeof item.body !== "string")
          throw new Error("项目正文格式不正确。");
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug))
          throw new Error("项目短名仅使用小写英文、数字和连字符。");
        if (item.url && !/^(?:\/(?!\/)|https:\/\/)/.test(item.url))
          throw new Error("访问链接需以 / 或 https:// 开头。");
        if (item.cover && !/^(?:\/(?!\/)|https:\/\/)/.test(item.cover))
          throw new Error("封面链接格式不正确。");
        if ((item.body || "").length > 1000000)
          throw new Error("项目介绍过大。");
        const previous = entryFromSource(
          value.base,
          value.scope,
          value.entryId,
        );
        if (previous && previous.slug !== item.slug)
          throw new Error("已发布项目的短名和地址不能修改。");
      }
      return;
    }
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
  if (value.kind === "home" && value.scope) return serializeEntry(value);
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
  if (value.base) {
    const original = readContent(value.base);
    if (original.kind === "post" && sameContent(original, value))
      return {
        path: value.base.path,
        source: value.base.source,
        url: value.base.url || "/" + String(value.permalink || ""),
      };
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

export const LIFECYCLE_PATH = "source/_data/content-lifecycle.json";
export const entryKey = (item: any, scope: string, index: number) =>
  String(
    item.id ||
      (scope === "project" ? item.slug : `legacy-${index}-${item.title}`),
  );
export function identity(value: Content, draftId = "") {
  return value.kind === "post"
    ? "post:" +
        (value.base?.path || `source/_posts/${value.section}/${draftId}.md`)
    : value.scope
      ? `home:${value.scope}:${value.entryId}`
      : "legacy:home";
}
export function selectedEntry(value: Home): any {
  if (value.scope === "intro")
    return { description: value.data.description || "" };
  return (
    value.data[value.scope === "project" ? "projects" : "recent_focus"] || []
  ).find(
    (item: any, i: number) => entryKey(item, value.scope!, i) === value.entryId,
  );
}
export function entryFromSource(
  base: Base,
  scope: Home["scope"],
  id: string,
): any {
  const data = parse(base.source);
  if (scope === "intro") return { description: data.description || "" };
  return (data[scope === "project" ? "projects" : "recent_focus"] || []).find(
    (item: any, i: number) => entryKey(item, scope!, i) === id,
  );
}
export function entries(base: Base): Home[] {
  const data = parse(base.source);
  const result: Home[] = [
    {
      kind: "home",
      title: "首页简介",
      scope: "intro",
      entryId: "intro",
      base,
      data,
    },
  ];
  for (const scope of ["project", "focus"] as const)
    (data[scope === "project" ? "projects" : "recent_focus"] || []).forEach(
      (item: any, index: number) =>
        result.push({
          kind: "home",
          title: item.title,
          scope,
          entryId: entryKey(item, scope, index),
          base,
          data,
        }),
    );
  return result;
}
export function newEntry(base: Base, scope: "project" | "focus"): Home {
  const id = crypto.randomUUID(),
    data = parse(base.source),
    key = scope === "project" ? "projects" : "recent_focus";
  data[key].push(
    scope === "project"
      ? {
          id,
          title: "",
          slug: "",
          label: "",
          description: "",
          body: "",
          cover: "",
          status: "进行中",
          url: "",
          category: "",
          stack: [],
          related_posts: [],
          order: data[key].length,
        }
      : { id, title: "", description: "", tags: [], order: data[key].length },
  );
  return { kind: "home", title: "", scope, entryId: id, base, data };
}
export function serializeEntry(value: Home) {
  const doc = parseDocument(value.base.source);
  if (value.scope === "intro")
    doc.set("description", value.data.description || "");
  else {
    const key = value.scope === "project" ? "projects" : "recent_focus",
      item = selectedEntry(value);
    const list = doc.get(key, true) as any;
    const current = doc.toJS()[key] || [];
    const index = current.findIndex(
      (p: any, i: number) => entryKey(p, value.scope!, i) === value.entryId,
    );
    if (index < 0) {
      if (
        current.some(
          (p: any) => value.scope === "project" && p.slug === item.slug,
        )
      )
        throw new Error("项目短名已存在。");
      list.add({ ...item, id: value.entryId });
    } else {
      // Change known fields on the existing YAML map to retain comments/unknown keys.
      const node = list.items[index];
      for (const [field, entry] of Object.entries({
        ...item,
        id: value.entryId,
      }))
        node.set(field, entry);
    }
    if (value.scope === "focus")
      doc.set(
        "focus_updated",
        new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }),
      );
  }
  const item = selectedEntry(value);
  return {
    path: HOME_PATH,
    source: doc.toString(),
    url: value.scope === "project" ? `/projects/${item.slug}/` : "/",
  };
}
export function sameContent(a: Content, b: Content) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "home" && b.kind === "home")
    return (
      a.scope === b.scope &&
      a.entryId === b.entryId &&
      stableJSON(
        a.scope ? comparableEntry(selectedEntry(a), a.entryId!) : a.data,
      ) ===
        stableJSON(
          b.scope ? comparableEntry(selectedEntry(b), b.entryId!) : b.data,
        )
    );
  const fields = [
    "title",
    "body",
    "section",
    "date",
    "categories",
    "tags",
    "description",
    "permalink",
  ];
  return fields.every(
    (key) =>
      JSON.stringify((a as any)[key]) === JSON.stringify((b as any)[key]),
  );
}

export function stableJSON(value: any): string | undefined {
  const normalize = (item: any): any =>
    Array.isArray(item)
      ? item.map(normalize)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, normalize(item[key])]),
          )
        : item;
  return JSON.stringify(normalize(value));
}
export function comparableEntry(value: any, id: string) {
  return value ? { ...value, id } : value;
}
