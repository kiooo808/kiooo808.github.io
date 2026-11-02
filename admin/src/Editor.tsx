import { useEffect, useRef, useState } from "react";
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { specialMarkup } from "../shared/content";
export function MarkdownEditor({
  value,
  onChange,
  upload,
}: {
  value: string;
  onChange: (value: string) => void;
  upload: (file: File) => Promise<string>;
}) {
  const [mode, setMode] = useState(specialMarkup(value) ? "source" : "visual");
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null),
    change = useRef(onChange),
    uploadRef = useRef(upload),
    valueRef = useRef(value);
  change.current = onChange;
  uploadRef.current = upload;
  valueRef.current = value;
  useEffect(() => {
    if (mode !== "visual" || !root.current) return;
    let cancelled = false,
      ready = false;
    let userTouched = false;
    const touched = () => {
      userTouched = true;
    };
    const surface = root.current;
    surface.addEventListener("beforeinput", touched, true);
    surface.addEventListener("paste", touched, true);
    surface.addEventListener("drop", touched, true);
    surface.addEventListener("pointerdown", touched, true);
    const editor = new Crepe({
      root: root.current,
      defaultValue: valueRef.current,
      features: { [CrepeFeature.AI]: false, [CrepeFeature.Latex]: false },
      featureConfigs: {
        [CrepeFeature.ImageBlock]: {
          onUpload: (file) => uploadRef.current(file),
          inlineOnUpload: (file) => uploadRef.current(file),
          blockOnUpload: (file) => uploadRef.current(file),
        },
      },
    });
    editor.on((listener) =>
      listener.markdownUpdated((_ctx, text) => {
        if (ready && !cancelled && userTouched && text !== valueRef.current)
          change.current(text);
      }),
    );
    const created = editor
      .create()
      .then(() => {
        ready = true;
        const input = root.current?.querySelector(".ProseMirror");
        input?.setAttribute("aria-label", "文章正文");
        input?.setAttribute("role", "textbox");
        input?.setAttribute("aria-multiline", "true");
        if (cancelled) return editor.destroy();
      })
      .catch(() => setError("可视化编辑器加载失败，请使用 Markdown 编辑。"));
    return () => {
      cancelled = true;
      for (const event of ["beforeinput", "paste", "drop", "pointerdown"])
        surface.removeEventListener(event, touched, true);
      if (ready) void editor.destroy();
      else void created;
    };
  }, [mode, generation]);
  function toggle(next: string) {
    if (next === "visual" && specialMarkup(value)) {
      setError(
        "正文含特殊 HTML 或嵌入代码，请保留 Markdown 源码编辑，避免格式丢失。",
      );
      return;
    }
    setError("");
    setGeneration((g) => g + 1);
    setMode(next);
  }
  return (
    <section className="body-editor">
      <div className="editor-tabs">
        <button
          type="button"
          className={mode === "visual" ? "selected" : ""}
          onClick={() => toggle("visual")}
        >
          可视化
        </button>
        <button
          type="button"
          className={mode === "source" ? "selected" : ""}
          onClick={() => toggle("source")}
        >
          Markdown
        </button>
        <span>正文</span>
      </div>
      {error && <p className="warning">{error}</p>}
      {mode === "visual" ? (
        <div ref={root} className="milkdown-host" />
      ) : (
        <textarea
          className="source-editor"
          aria-label="Markdown 正文"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </section>
  );
}
