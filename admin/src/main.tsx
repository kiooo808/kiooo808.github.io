import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  sameContent,
  selectedEntry,
  entryFromSource,
  Content,
  Home,
  Section,
  labels,
  exportMarkdown,
  specialMarkup,
} from "../shared/content";
import { api, send, ApiError, pending, clearPending, signOut } from "./api";
const MarkdownEditor = lazy(() =>
  import("./Editor").then((module) => ({ default: module.MarkdownEditor })),
);
import { ManagePanel } from "./ManagePanel";
import { Preview } from "./Preview";
import "./style.css";
type Draft = {
  id: string;
  payload: Content;
  version: number;
  published_version: number;
  updated: string;
};
const statusNames: Record<string, string> = {
  queued: "排队中",
  checking: "检查中",
  deploying: "部署中",
  verifying: "核对上线结果",
  published: "已上线",
  failed: "失败",
  conflict: "需要处理冲突",
};
function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function App() {
  const [config, setConfig] = useState<any>(),
    [user, setUser] = useState<any>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [jobs, setJobs] = useState<any[]>([]),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<Draft | null>(null),
    [inspect, setInspect] = useState<Content>();
  const [dark, setDark] = useState(
    () => localStorage.getItem("studio-theme") === "dark",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("studio-theme", dark ? "dark" : "light");
  }, [dark]);
  async function refresh() {
    try {
      setJobs(await api<any[]>("/publications"));
    } catch (e) {
      setError("发布记录暂未载入：" + (e as Error).message);
    }
  }
  useEffect(() => {
    void (async () => {
      try {
        setConfig(await api("/config"));
        const me = await api("/me");
        setUser(me);
        await refresh();
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401))
          setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      void api<any[]>("/publications")
        .then(setJobs)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [user]);
  function saved(draft: Draft) {
    setSelected((current) => (current?.id === draft.id ? draft : current));
  }
  async function restore(id: string) {
    try {
      const result = (await send(
        "/publications/" + id + "/restore",
        {},
      )) as Draft;
      saved(result);
      if (result.payload.kind === "home" && !result.payload.scope) {
        setSelected(null);
        setFilter("legacy");
        setError("旧首页版本已保存，请从旧首页草稿选择条目导入。");
      } else {
        setSelected(result);
        setFilter("all");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (loading)
    return (
      <main className="login">
        <p>正在打开内容工作台…</p>
      </main>
    );
  if (!user)
    return (
      <main className="login">
        <span className="brand-mark">k.</span>
        <p className="eyebrow">MYBLOG STUDIO</p>
        <h1>想写点什么？</h1>
        <p>文章、笔记和日常，在这里慢慢整理。</p>
        {config?.demo ? (
          <>
            <p className="demo-note">
              本地演示 ·
              草稿保存在这台电脑的本地数据库，支持实际编辑和预览，不会提交到
              GitHub。
            </p>
            <form method="post" action="/api/auth/demo">
              <button className="primary">进入本地工作台 ↗</button>
            </form>
          </>
        ) : (
          <>
            <p>仅站点所有者可以登录。</p>
            <a className="primary button" href="/api/auth/login">
              使用 GitHub 登录 ↗
            </a>
            {!config?.configured && (
              <p className="warning">
                在线登录尚未配置，请按部署说明设置账户与应用。
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="warning">
            {error}
          </p>
        )}
      </main>
    );
  const isJobs = filter === "jobs";
  return (
    <div className="studio">
      <aside className="sidebar">
        <a className="studio-brand" href="/">
          kiooo808 <span>工作台</span>
        </a>
        <p className="eyebrow">内容与日常</p>
        <nav aria-label="后台导航">
          {[
            ["all", "所有内容", "◈"],
            ["blog", "博客", "↗"],
            ["knowledge", "知识笔记", "▦"],
            ["diary", "日记", "◷"],
            ["project", "项目", "↗"],
            ["focus", "近期关注", "✳"],
            ["intro", "首页简介", "⌂"],
            ["trash", "回收站", "♲"],
            ["legacy", "旧首页草稿", "◫"],
            ["jobs", "发布记录", "✓"],
          ].map(([key, name, icon]) => (
            <button
              key={key}
              className={filter === key ? "current" : ""}
              onClick={() => {
                try {
                  if (selected && pending(selected.id)) {
                    setError("本机还有未同步修改，请先保存，再切换分区。");
                    return;
                  }
                } catch {
                  setError("无法读取本机暂存，请先保存或导出内容。");
                  return;
                }
                setFilter(key);
                setSelected(null);
              }}
            >
              <span aria-hidden="true">{icon}</span>
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a href={config.site} target="_blank" rel="noreferrer">
            查看网站 ↗
          </a>
          <button onClick={() => setDark(!dark)}>
            {dark ? "亮色界面" : "暗色界面"}
          </button>
          <button
            onClick={async () => {
              try {
                await signOut();
                setUser(null);
                setSelected(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            退出登录
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-head">
          <div>
            <p className="eyebrow">PERSONAL SPACE / STUDIO</p>
            <h1>
              {selected
                ? "编辑内容"
                : (
                    {
                      all: "内容管理",
                      project: "项目管理",
                      focus: "近期关注",
                      intro: "首页简介",
                      trash: "回收站",
                      legacy: "旧首页草稿",
                      jobs: "发布记录",
                      blog: "博客",
                      knowledge: "知识笔记",
                      diary: "日记",
                    } as any
                  )[filter]}
            </h1>
          </div>
          <span className="owner">● {user.login}</span>
        </header>
        {config.demo && (
          <div className="demo-banner">
            本地演示{" "}
            <span>
              编辑和保存可用；在线登录、跨设备同步与正式发布需要配置 Cloudflare
              和 GitHub App。
            </span>
          </div>
        )}
        {error && (
          <div role="alert" className="warning">
            {error}
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {selected ? (
          <EditorPane
            key={selected.id}
            draft={selected}
            demo={config.demo}
            onSaved={saved}
            back={() => {
              setSelected(null);
              void refresh();
            }}
            onPublish={() => {
              setFilter("jobs");
              setSelected(null);
              void refresh();
            }}
          />
        ) : isJobs ? (
          <section className="jobs">
            <div className="section-heading">
              <h2>发布记录</h2>
              <button onClick={() => void refresh()}>刷新状态</button>
            </div>
            <p className="muted">检查通过才合并，上线验证完成后显示成功。</p>
            {jobs.length === 0 ? (
              <div className="empty">
                还没有发布记录。预览内容后，可以发起第一次更新。
              </div>
            ) : (
              jobs.map((job) => (
                <article className="job-card" key={job.id}>
                  <div>
                    <span className={"status " + job.status}>
                      {job.status === "published" &&
                      job.action !== "publish" &&
                      job.action
                        ? job.action === "trash"
                          ? "已撤下"
                          : "已永久删除"
                        : statusNames[job.status]}
                    </span>
                    <p className="muted">
                      {
                        (
                          {
                            publish: "发布更新",
                            restore: "恢复发布",
                            trash: "移入回收站",
                            purge: "永久删除当前数据",
                          } as any
                        )[job.operation || "publish"]
                      }
                    </p>
                    <h3>{job.title || "未命名内容"}</h3>
                    <small>
                      {new Date(job.created).toLocaleString("zh-CN")}
                    </small>
                  </div>
                  {job.error && <p className="warning">{job.error}</p>}
                  <div className="row-actions">
                    {job.pr && (
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={`https://github.com/kiooo808/kiooo808.github.io/pull/${job.pr}`}
                      >
                        查看检查 ↗
                      </a>
                    )}
                    {["failed", "conflict"].includes(job.status) && (
                      <button
                        onClick={async () => {
                          try {
                            await send("/publications", {
                              draftId: job.draft_id,
                              version: job.version,
                              retry: true,
                            });
                            void refresh();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        重试
                      </button>
                    )}
                    {job.status === "published" && job.canRestore && (
                      <button onClick={() => void restore(job.id)}>
                        恢复上一版为草稿
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </section>
        ) : (
          <ManagePanel
            key={filter}
            filter={filter}
            revision={jobs
              .filter((j) => j.status === "published")
              .map((j) => j.id + ":" + j.updated)
              .join("|")}
            onSelect={setSelected}
            onPreview={setInspect}
            onError={setError}
            onJob={() => {
              setFilter("jobs");
              void refresh();
            }}
          />
        )}
        {inspect &&
          createPortal(
            <Preview content={inspect} close={() => setInspect(undefined)} />,
            document.body,
          )}
      </main>
    </div>
  );
}
function EditorPane({
  draft,
  demo,
  onSaved,
  back,
  onPublish,
}: {
  draft: Draft;
  demo: boolean;
  onSaved: (d: Draft) => void;
  back: () => void;
  onPublish: () => void;
}) {
  const cached = pending(draft.id) as Draft | undefined;
  const initial = cached || draft;
  const [value, setValue] = useState<Content>(initial.payload),
    [saveState, setSaveState] = useState(
      cached ? "正在恢复本机修改…" : "已保存",
    ),
    [message, setMessage] = useState(""),
    [conflict, setConflict] = useState<any>(),
    [preview, setPreview] = useState(false),
    [previewed, setPreviewed] = useState(""),
    [saving, setSaving] = useState(false),
    [editorKey, setEditorKey] = useState(0),
    [history, setHistory] = useState<any[]>();
  const current = useRef(initial),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    inflight = useRef<Promise<Draft | undefined> | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  async function persist(): Promise<Draft | undefined> {
    clearTimeout(timer.current);
    if (inflight.current) {
      await inflight.current;
      if (pending(draft.id)) return persist();
      return current.current;
    }
    if (!pending(draft.id)) return current.current;
    const snapshot = { ...current.current };
    const operation = (async () => {
      if (mounted.current) {
        setSaving(true);
        setSaveState("保存中…");
      }
      try {
        const result = (await send(
          "/drafts/" + draft.id,
          { payload: snapshot.payload, version: snapshot.version },
          "PUT",
        )) as Draft;
        const changed =
          JSON.stringify(current.current.payload) !==
          JSON.stringify(snapshot.payload);
        current.current = { ...result, payload: current.current.payload };
        onSaved(result);
        if (changed) pending(draft.id, current.current);
        else clearPending(draft.id);
        if (mounted.current)
          setSaveState(
            changed
              ? "有修改待保存"
              : "已保存到" + (demo ? "本地数据库" : "私密草稿"),
          );
        return result;
      } catch (e) {
        if (mounted.current) {
          if (e instanceof ApiError && e.status === 409) {
            setConflict(e.data.latest);
            setSaveState("有版本冲突，两个版本均已保留");
          } else if (e instanceof ApiError && e.status === 401) {
            setSaveState("登录已过期，本机修改已保留");
            setMessage("请在另一标签页重新登录，再回来重试保存。");
          } else setSaveState("离线或保存失败，修改已暂存在本机");
        }
        return undefined;
      } finally {
        if (mounted.current) setSaving(false);
        inflight.current = null;
      }
    })();
    inflight.current = operation;
    return operation;
  }
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    const online = () => void persistRef.current();
    window.addEventListener("online", online);
    if (cached) void persistRef.current();
    return () => window.removeEventListener("online", online);
  }, []);
  function edit(next: Content) {
    if (sameContent(current.current.payload, next)) return;
    current.current = { ...current.current, payload: next };
    setValue(next);
    setPreviewed("");
    try {
      pending(draft.id, current.current);
      setSaveState("等待自动保存…");
    } catch {
      setMessage("本机暂存空间不足，请立即保存或导出。");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void persistRef.current(), 2000);
  }
  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) throw new Error("附件不能超过 10MB。");
    const response = await api("/media?draft=" + draft.id, {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
    return response.url as string;
  }
  async function attach(file: File) {
    try {
      const url = await upload(file);
      const latest = current.current.payload;
      if (latest.kind === "post") {
        const name = file.name.replace(/[\[\]\n]/g, "");
        edit({
          ...latest,
          body:
            latest.body +
            "\n\n" +
            (file.type.startsWith("image/") ? "!" : "") +
            "[" +
            name +
            "](" +
            url +
            ")\n",
        });
        setEditorKey((k) => k + 1);
      }
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function showPreview() {
    setMessage("");
    const saved = await persist();
    if (!saved || pending(draft.id)) {
      setMessage("请先成功保存并解决冲突，再预览发布。");
      return;
    }
    try {
      await send("/preview", {
        id: draft.id,
        payload: current.current.payload,
      });
      setPreview(true);
      setPreviewed(JSON.stringify(current.current.payload));
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function publish() {
    try {
      if (previewed !== JSON.stringify(current.current.payload))
        throw new Error("内容发生变化，请重新预览。");
      await send("/publications", {
        draftId: draft.id,
        version: current.current.version,
      });
      onPublish();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function resolve(useLocal: boolean) {
    if (useLocal) {
      current.current = { ...current.current, version: conflict.version };
      pending(draft.id, current.current);
      setConflict(null);
      await persist();
    } else {
      current.current = conflict;
      setValue(conflict.payload);
      clearPending(draft.id);
      onSaved(conflict);
      setConflict(null);
      setSaveState("已采用服务器版本；本地冲突副本保留在历史记录");
      setEditorKey((k) => k + 1);
    }
  }
  return (
    <section className="editing">
      <div className="edit-toolbar">
        <button
          onClick={async () => {
            if (await persist()) back();
            else setMessage("保存尚未完成，请处理错误或导出本机内容后再离开。");
          }}
        >
          ← 内容列表
        </button>
        <span role="status" className="save-state">
          {saveState}
        </span>
        <div className="row-actions">
          <button disabled={saving} onClick={() => void persist()}>
            保存
          </button>
          <button onClick={() => void showPreview()}>预览</button>
          <button
            className="primary"
            disabled={!previewed || saving || !!conflict}
            onClick={() => void publish()}
          >
            发布 ↗
          </button>
        </div>
      </div>
      {message && (
        <p role="alert" className="warning">
          {message}
        </p>
      )}
      {conflict && (
        <section className="conflict" role="alert">
          <h3>另一台设备也修改了这份内容</h3>
          <div className="conflict-columns">
            <div>
              <h4>本机版本</h4>
              <pre>{JSON.stringify(value, null, 2).slice(0, 2200)}</pre>
            </div>
            <div>
              <h4>服务器版本</h4>
              <pre>
                {JSON.stringify(conflict.payload, null, 2).slice(0, 2200)}
              </pre>
            </div>
          </div>
          <p>两个版本均已保留。选择后仍会检查是否有更新。</p>
          <button onClick={() => void resolve(true)}>保留本机版本并保存</button>
          <button onClick={() => void resolve(false)}>采用服务器版本</button>
        </section>
      )}
      {value.kind === "post" ? (
        <>
          <div className="article-meta">
            <label className="title-field">
              标题
              <input
                placeholder="给这篇内容起个名字"
                aria-label="文章标题"
                value={value.title}
                onChange={(e) => edit({ ...value, title: e.target.value })}
              />
            </label>
            <div className="metadata-grid">
              <label>
                分区
                <select
                  value={value.section}
                  onChange={(e) =>
                    edit({ ...value, section: e.target.value as Section })
                  }
                >
                  {Object.entries(labels).map(([k, n]) => (
                    <option value={k} key={k}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                发布日期
                <input
                  aria-label="发布日期"
                  value={value.date}
                  disabled={!!value.base}
                  onChange={(e) => edit({ ...value, date: e.target.value })}
                />
              </label>
              <label>
                分类（用 / 分隔层级）
                <SeparatedInput
                  value={value.categories.flat().map(String)}
                  separator=" / "
                  pattern={/\//}
                  onChange={(categories) => edit({ ...value, categories })}
                />
              </label>
              <label>
                标签（逗号分隔）
                <SeparatedInput
                  value={value.tags}
                  onChange={(tags) => edit({ ...value, tags })}
                />
              </label>
            </div>
            <label>
              摘要
              <textarea
                rows={2}
                placeholder="一句话介绍这篇内容，可留空"
                value={value.description}
                onChange={(e) =>
                  edit({ ...value, description: e.target.value })
                }
              />
            </label>
          </div>
          {specialMarkup(value.body) && (
            <p className="muted">
              含特殊 HTML 或嵌入内容，已保留源码；排版预览不会执行脚本。
            </p>
          )}
          <Suspense fallback={<p className="muted">正在加载编辑器…</p>}>
            <MarkdownEditor
              key={editorKey}
              value={value.body}
              onChange={(body) => edit({ ...value, body })}
              upload={upload}
            />
          </Suspense>
          <div className="attachment-bar">
            <label className="button file-button">
              ＋ 图片 / PDF
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                onChange={(e) => {
                  if (e.target.files?.[0]) void attach(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <span>单个附件不超过 10MB · 未发布附件仅自己可见</span>
            <button
              onClick={() => {
                try {
                  download(
                    (value.title || "草稿") + ".md",
                    exportMarkdown(value),
                  );
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              导出 Markdown ↓
            </button>
          </div>
        </>
      ) : (
        <HomeEditor value={value} onChange={edit} upload={upload} />
      )}
      <div className="history-bar">
        <button
          onClick={async () => {
            try {
              const [versions, conflicts] = await Promise.all([
                api<any[]>("/drafts/" + draft.id + "/versions"),
                api<any[]>("/drafts/" + draft.id + "/conflicts"),
              ]);
              setHistory([
                ...conflicts.map((x) => ({
                  ...x,
                  label:
                    "冲突副本 " + new Date(x.created).toLocaleString("zh-CN"),
                })),
                ...versions.map((x) => ({
                  ...x,
                  label:
                    "草稿版本 " +
                    x.version +
                    " · " +
                    new Date(x.created).toLocaleString("zh-CN"),
                })),
              ]);
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          查看草稿历史
        </button>
        <span>点击发布后，所选内容和附件将进入公开仓库。</span>
      </div>
      {history && (
        <div className="history-list">
          <button onClick={() => setHistory(undefined)}>收起历史</button>
          {history.map((h, i) => (
            <div key={i}>
              <span>{h.label}</span>
              <button
                onClick={() => {
                  edit(h.payload);
                  setEditorKey((k) => k + 1);
                  setHistory(undefined);
                }}
              >
                载入此版本为当前草稿
              </button>
            </div>
          ))}
        </div>
      )}
      {preview &&
        createPortal(
          <Preview content={value} close={() => setPreview(false)} />,
          document.body,
        )}
    </section>
  );
}
function HomeEditor({
  value,
  onChange,
  upload,
}: {
  value: Home;
  onChange: (v: Content) => void;
  upload: (file: File) => Promise<string>;
}) {
  const [uploadError, setUploadError] = useState("");
  const latest = useRef(value);
  latest.current = value;
  if (!value.scope) return <p>旧首页草稿请从“旧首页草稿”入口查看和导入。</p>;
  if (value.scope === "intro")
    return (
      <label>
        首页简介
        <textarea
          rows={4}
          value={value.data.description || ""}
          onChange={(e) =>
            onChange({
              ...value,
              data: { ...value.data, description: e.target.value },
            })
          }
        />
      </label>
    );
  const key = value.scope === "project" ? "projects" : "recent_focus",
    item = selectedEntry(value),
    project = value.scope === "project";
  function field(name: string, entry: any) {
    const v = latest.current,
      list = [...v.data[key]],
      index = list.findIndex((p: any) => p === selectedEntry(v));
    list[index] = { ...list[index], [name]: entry };
    onChange({
      ...v,
      title: name === "title" ? entry : v.title,
      data: { ...v.data, [key]: list },
    });
  }
  const previous = entryFromSource(value.base, value.scope, value.entryId!);
  return (
    <div className="home-editor">
      {uploadError && (
        <p className="warning" role="alert">
          {uploadError}
        </p>
      )}
      <label>
        标题
        <input
          aria-label={project ? "项目标题" : "关注标题"}
          value={item.title || ""}
          onChange={(e) => field("title", e.target.value)}
        />
      </label>
      <label>
        简介
        <textarea
          rows={3}
          value={item.description || ""}
          onChange={(e) => field("description", e.target.value)}
        />
      </label>
      <div className="metadata-grid">
        <label>
          展示顺序
          <input
            type="number"
            value={item.order || 0}
            onChange={(e) => field("order", Number(e.target.value))}
          />
        </label>
        {project && (
          <>
            <label>
              英文短名（发布后固定）
              <input
                disabled={!!previous && !value.restoreId}
                value={item.slug || ""}
                onChange={(e) => field("slug", e.target.value)}
              />
            </label>
            <label>
              简短分类
              <input
                value={item.label || ""}
                onChange={(e) => field("label", e.target.value)}
              />
            </label>
            <label>
              项目状态
              <select
                value={item.status || "进行中"}
                onChange={(e) => field("status", e.target.value)}
              >
                {["进行中", "已完成", "维护中", "已归档"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              访问链接
              <input
                value={item.url || ""}
                placeholder="https:// 或站内路径，可留空"
                onChange={(e) => field("url", e.target.value)}
              />
            </label>
            <label>
              自动关联文章分类
              <input
                value={item.category || ""}
                onChange={(e) => field("category", e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      <label>
        {project ? "技术栈" : "标签"}
        <SeparatedInput
          value={item[project ? "stack" : "tags"] || []}
          onChange={(entries) => field(project ? "stack" : "tags", entries)}
        />
      </label>
      {project && (
        <>
          <label>
            封面图片地址
            <input
              value={item.cover || ""}
              onChange={(e) => field("cover", e.target.value)}
            />
          </label>
          <label className="button file-button">
            上传封面
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void upload(file)
                    .then((url) => field("cover", url))
                    .catch((e) => setUploadError(e.message));
              }}
            />
          </label>
          <label>
            关联文章地址（每行一个）
            <textarea
              rows={3}
              value={(item.related_posts || []).join("\n")}
              onChange={(e) =>
                field(
                  "related_posts",
                  e.target.value
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean),
                )
              }
            />
          </label>
          <Suspense fallback={<p>正在加载编辑器…</p>}>
            <MarkdownEditor
              value={item.body || ""}
              onChange={(body) => field("body", body)}
              upload={upload}
            />
          </Suspense>
          <label className="button file-button">
            添加图片 / PDF
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void upload(file)
                    .then((url) =>
                      field(
                        "body",
                        (selectedEntry(latest.current).body || "") +
                          "\n\n" +
                          (file.type.startsWith("image/") ? "!" : "") +
                          "[" +
                          file.name.replace(/[\[\]\n]/g, "") +
                          "](" +
                          url +
                          ")\n",
                      ),
                    )
                    .catch((e) => setUploadError(e.message));
              }}
            />
          </label>
        </>
      )}
      <p className="muted">
        只发布当前条目；其他项目和近期关注草稿不会一起上线。
      </p>
    </div>
  );
}
function SeparatedInput({
  value,
  onChange,
  separator = ", ",
  pattern = /[,，]/,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  separator?: string;
  pattern?: RegExp;
}) {
  const joined = value.join(separator),
    [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if(text!==joined) onChange(text.split(pattern).map(s=>s.trim()).filter(Boolean));
      }}
    />
  );
}
createRoot(document.getElementById("root")!).render(<App />);
