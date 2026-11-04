import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, send, pending } from "./api";
import {
  Content,
  newArticle,
  Section,
  importMarkdown,
} from "../shared/content";
type Props = {
  filter: string;
  revision: string;
  onSelect: (draft: any) => void;
  onPreview: (value: Content) => void;
  onJob: () => void;
  onError: (message: string) => void;
};
const names: Record<string, string> = {
  all: "所有内容",
  blog: "博客",
  knowledge: "知识笔记",
  diary: "日记",
  project: "项目",
  focus: "近期关注",
  intro: "首页简介",
  trash: "回收站",
  legacy: "旧首页草稿",
};
export function ManagePanel({
  filter,
  revision,
  onSelect,
  onPreview,
  onJob,
  onError,
}: Props) {
  const [data, setData] = useState<any>({ items: [], legacy: [] }),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [sort, setSort] = useState("updated"),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [deletion, setDeletion] = useState<any>(),
    [mode, setMode] = useState("trash"),
    [legacy, setLegacy] = useState<any>();
  const [localError, setLocalError] = useState("");
  const modalOpen = !!deletion || !!legacy;
  useEffect(() => {
    if (!modalOpen) return;
    const background = document.querySelector<HTMLElement>(".studio"),
      previous = document.activeElement as HTMLElement | null;
    if (background) background.inert = true;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setDeletion(undefined);
        setLegacy(undefined);
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      if (background) background.inert = false;
      document.removeEventListener("keydown", escape);
      if (previous?.isConnected) previous.focus();
    };
  }, [modalOpen, busy]);
  async function refresh() {
    try {
      setData(await api("/manage"));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [revision]);
  async function action(fn: () => Promise<void>) {
    setLocalError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
      setLocalError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rows = data.items
    .filter(
      (item: any) =>
        (filter === "trash"
          ? item.state === "回收站"
          : item.state !== "回收站" &&
            (filter === "all" || item.type === filter)) &&
        (status === "all" || item.state === status) &&
        (!query ||
          (item.title + " " + item.description)
            .toLowerCase()
            .includes(query.toLowerCase())),
    )
    .sort((a: any, b: any) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "order"
          ? a.order - b.order
          : b.updated.localeCompare(a.updated),
    );
  const open = (key: string, choice = "edit") =>
    action(async () => {
      const result = await send("/manage/open", { key, choice });
      if (result.content) onPreview(result.content);
      else onSelect(result);
    });
  const checkPending = (item: any) => {
    if (item.draftId && pending(item.draftId))
      throw new Error("本机还有未同步修改，请先保存或导出，再删除。");
  };
  if (filter === "legacy")
    return (
      <section>
        <h2>旧首页草稿</h2>
        <p className="muted">
          原稿完整保留；选择一项导入为独立草稿，其他改动不会一起发布。
        </p>
        {data.legacy.map((item: any) => (
          <article className="manager-row" key={item.id}>
            <div>
              <h3>{item.title}</h3>
              <small>{item.updated}</small>
            </div>
            <div className="row-actions">
              <button
                onClick={() =>
                  void action(async () =>
                    setLegacy({
                      ...(await send("/manage/legacy", { id: item.id })),
                      id: item.id,
                    }),
                  )
                }
              >
                选择导入条目
              </button>
              <button
                onClick={() =>
                  void action(async () => {
                    const payload = await send("/manage/legacy", {
                      id: item.id,
                      export: true,
                    });
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(payload, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "旧首页草稿.json";
                    a.click();
                    URL.revokeObjectURL(url);
                  })
                }
              >
                导出原稿
              </button>
            </div>
          </article>
        ))}
        {!data.legacy.length && <p className="empty">没有旧首页草稿。</p>}
        {legacy &&
          createPortal(
            <div className="overlay">
              <section
                className="management-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="选择旧草稿条目"
              >
                <h2>选择导入条目</h2>
                {localError && (
                  <p className="warning" role="alert">
                    {localError}
                  </p>
                )}
                {legacy.items.map((entry: any) => (
                  <button
                    key={entry.scope + entry.entryId}
                    onClick={() =>
                      void action(async () => {
                        const draft = await send("/manage/legacy", {
                          id: legacy.id,
                          entryId: entry.entryId,
                          scope: entry.scope,
                        });
                        setLegacy(null);
                        onSelect(draft);
                      })
                    }
                  >
                    {entry.title} · {names[entry.scope]}
                  </button>
                ))}
                <button onClick={() => setLegacy(null)}>取消</button>
              </section>
            </div>,
            document.body,
          )}
      </section>
    );
  return (
    <section className="management">
      <div className="section-heading">
        <h2>{names[filter] || "所有内容"}</h2>
        <div className="row-actions">
          <button disabled={busy} onClick={() => void refresh()}>
            刷新
          </button>
          {!["trash"].includes(filter) && (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const draft = ["project", "focus", "intro"].includes(filter)
                    ? await send("/manage/new", { scope: filter })
                    : await send("/drafts", {
                        payload: newArticle(
                          (["blog", "knowledge", "diary"].includes(filter)
                            ? filter
                            : "blog") as Section,
                        ),
                      });
                  onSelect(draft);
                })
              }
            >
              {filter === "intro" ? "编辑首页简介" : "＋ 新建"}
            </button>
          )}
          {!["trash", "project", "focus", "intro"].includes(filter) && (
            <label className="button file-button">
              导入 Markdown
              <input
                type="file"
                accept=".md,.markdown"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file)
                    void action(async () => {
                      onSelect(
                        await send("/drafts", {
                          payload: importMarkdown(await file.text(), file.name),
                        }),
                      );
                    });
                }}
              />
            </label>
          )}
        </div>
      </div>
      <div className="management-filters">
        <label>
          搜索
          <input
            aria-label="搜索内容"
            placeholder="标题或简介…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          状态
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">全部状态</option>
            {[
              "私密草稿",
              "修改待发布",
              "已发布",
              "排队中",
              "检查中",
              "部署中",
              "核对上线",
              "删除处理中",
              "删除失败",
              "发布失败",
              "回收站",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          排序
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="updated">最近更新</option>
            <option value="title">标题</option>
            <option value="order">展示顺序</option>
          </select>
        </label>
      </div>
      <p className="muted">
        每项内容只显示一次。草稿保持私密，发布或删除上线后才影响网站。
      </p>
      {loading ? (
        <p role="status">正在读取内容…</p>
      ) : rows.length ? (
        rows.map((item: any) => (
          <article className="manager-row" key={item.key}>
            <div className="manager-summary">
              <small>
                {names[item.type] || item.type} ·{" "}
                <span className="status-chip">{item.state}</span>
              </small>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              {item.error && (
                <p role="alert" className="warning">
                  {item.error}
                  <button onClick={onJob}>查看发布记录</button>
                </p>
              )}
              {item.updated && (
                <small>{new Date(item.updated).toLocaleString()}</small>
              )}
            </div>
            <div className="row-actions">
              {item.state === "回收站" ? (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () =>
                        onSelect(
                          await send("/manage/restore", { key: item.key }),
                        ),
                      )
                    }
                  >
                    {item.draftId ? "继续恢复草稿" : "恢复为草稿"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    disabled={busy || (item.busy && !item.canEdit)}
                    onClick={() => void open(item.key)}
                  >
                    {item.hasDraft ? "继续草稿" : "编辑"}
                  </button>
                  {item.published && (
                    <button
                      disabled={busy}
                      onClick={() => void open(item.key, "published")}
                    >
                      查看线上版本
                    </button>
                  )}
                </>
              )}
              {item.type !== "intro" && (
                <button
                  disabled={busy || item.busy}
                  className="danger-text"
                  onClick={() =>
                    void action(async () => {
                      checkPending(item);
                      setMode(item.state === "回收站" ? "purge" : "trash");
                      setDeletion(
                        await send("/manage/delete-preview", { key: item.key }),
                      );
                    })
                  }
                >
                  {item.state === "回收站" ? "永久删除" : "删除"}
                </button>
              )}
            </div>
          </article>
        ))
      ) : (
        <p className="empty">没有符合条件的内容。</p>
      )}
      {deletion &&
        createPortal(
          <div className="overlay">
            <section
              className="management-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="删除内容"
            >
              <h2>删除「{deletion.title}」</h2>
              {localError && (
                <p className="warning" role="alert">
                  {localError}。可取消后重新核对。
                </p>
              )}
              {deletion.url && <p className="muted">地址：{deletion.url}</p>}
              <label>
                删除方式
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="trash">移入回收站 · 旧地址显示撤下提示</option>
                  <option value="purge">
                    永久删除当前数据 · 旧地址返回 404
                  </option>
                </select>
              </label>
              <p>
                {deletion.published
                  ? "检查和部署成功后才会撤下线上内容。"
                  : "此操作只影响私密草稿。"}
              </p>
              <p>
                {mode === "trash"
                  ? "回收站不会自动清空，正文和可恢复附件仅自己可见。"
                  : "将清除该内容的当前文件、私密草稿、版本及可独占清理的附件，不可从回收站恢复。此操作不抹除 GitHub 历史、旧 PR、外部缓存和既有备份。仅保留不含正文的最小操作结果。"}
              </p>
              <h3>附件处理</h3>
              <p>
                随内容处理：{deletion.remove.length} 项；共享或保留：
                {deletion.keep.length} 项
              </p>
              {deletion.remove.map((x: string) => (
                <p className="file-note" key={x}>
                  {x}
                </p>
              ))}
              {deletion.keep.map((x: string) => (
                <p className="file-note muted" key={x}>
                  {x}
                </p>
              ))}
              <p className="muted">
                移入回收站会保留可恢复的私密副本；永久删除才清理独占副本。未能确认归属的历史附件及共享资源保留。
              </p>
              <div className="row-actions">
                <button disabled={busy} onClick={() => setDeletion(null)}>
                  取消
                </button>
                <button
                  disabled={busy}
                  className="danger"
                  onClick={() =>
                    void action(async () => {
                      const result = await send("/manage/delete", {
                        key: deletion.key,
                        token: deletion.token,
                        mode,
                      });
                      setDeletion(null);
                      if (result.jobId) onJob();
                      else await refresh();
                    })
                  }
                >
                  {busy
                    ? "处理中…"
                    : mode === "trash"
                      ? "确认移入回收站"
                      : "确认永久删除"}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </section>
  );
}
