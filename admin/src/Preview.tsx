import { useEffect, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Content } from "../shared/content";
export function Preview({
  content,
  close,
}: {
  content: Content;
  close: () => void;
}) {
  const [dark, setDark] = useState(false),
    [mobile, setMobile] = useState(false),
    [html, setHtml] = useState("");
  useEffect(() => {
    const background = document.querySelector<HTMLElement>(".studio");
    // The modal is portalled outside the inert workspace.
    if (background) background.inert = true;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", key);
    return () => {
      if (background) background.inert = false;
      document.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const blobs: string[] = [];
    async function render() {
      let body =
        content.kind === "post"
          ? await marked.parse(content.body, { breaks: true, gfm: true })
          : "";
      const safe = DOMPurify.sanitize(body, {
        FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "style"],
        FORBID_ATTR: ["style", "srcset"],
      });
      const template = document.createElement("template");
      template.innerHTML = safe;
      for (const img of template.content.querySelectorAll("img")) {
        const src = img.getAttribute("src") || "";
        if (src.startsWith("/api/media/")) {
          const response = await fetch(src);
          if (response.ok) {
            const blob = URL.createObjectURL(await response.blob());
            blobs.push(blob);
            img.src = blob;
          }
        } else if (src.startsWith("/"))
          img.src = "https://kiooo808.github.io" + src;
        else if (!/^https?:|data:image\//.test(src)) img.removeAttribute("src");
        img.setAttribute("referrerpolicy", "no-referrer");
      }
      if (active) setHtml(template.innerHTML);
    }
    void render();
    return () => {
      active = false;
      blobs.forEach(URL.revokeObjectURL);
    };
  }, [content]);
  const bg = dark ? "#221d2b" : "#f8f5fc",
    fg = dark ? "#e8e1f7" : "#302c43",
    line = dark ? "#51425f" : "#e3daed";
  const escape = (s: string) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const cards =
    content.kind === "home"
      ? `<p>${escape(content.data.description || "")}</p><h2>近期关注</h2>` +
        content.data.recent_focus
          .map(
            (p: any) =>
              `<article><h3>${escape(p.title)}</h3><p>${escape(p.description)}</p><small>${escape(p.tags.join(" · "))}</small></article>`,
          )
          .join("") +
        "<h2>项目</h2>" +
        content.data.projects
          .map(
            (p: any) =>
              `<article><small>${escape(p.label || "")}</small><h3>${escape(p.title)}</h3><p>${escape(p.description)}</p></article>`,
          )
          .join("")
      : html;
  const src = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data: https:; style-src 'unsafe-inline';"><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:${bg};color:${fg};font:16px/1.9 system-ui,sans-serif;overflow-wrap:anywhere}h1{font-size:30px;line-height:1.45}h2{margin-top:32px;font-size:22px}h3{font-size:19px}img{max-width:100%;height:auto}pre{overflow:auto;padding:16px;border:1px solid ${line};border-radius:8px}table{border-collapse:collapse;max-width:100%;display:block;overflow:auto}td,th{border:1px solid ${line};padding:8px}a{color:inherit}article{padding:18px 22px;margin:12px 0;border:1px solid ${line};border-radius:16px}small{opacity:.8}blockquote{border-left:3px solid ${line};margin:0;padding-left:16px}</style><h1>${escape(content.title || "未命名文章")}</h1>${content.kind === "post" ? `<small>${escape(content.date)} · ${escape(content.description)}</small>` : ""}${cards}</html>`;
  return (
    <div className="overlay">
      <section
        className="preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="内容排版预览"
      >
        <header>
          <div>
            <h2>内容预览</h2>
            <p>正文与卡片排版预览，完整效果以上线构建为准。</p>
          </div>
          <button onClick={close} autoFocus>
            关闭预览
          </button>
        </header>
        <div className="preview-controls">
          <button onClick={() => setDark(!dark)}>
            {dark ? "切换亮色" : "切换暗色"}
          </button>
          <button onClick={() => setMobile(!mobile)}>
            {mobile ? "桌面宽度" : "手机宽度"}
          </button>
        </div>
        <iframe
          sandbox=""
          title="排版预览"
          className={mobile ? "mobile-preview" : ""}
          srcDoc={src}
        />
      </section>
    </div>
  );
}
