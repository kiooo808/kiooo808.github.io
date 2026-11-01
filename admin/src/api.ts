export class ApiError extends Error {
  constructor(
    public status: number,
    public data: any,
  ) {
    super(data.error || "请求失败。");
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api" + path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const value = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new ApiError(response.status, value);
  return value as T;
}
export const send = (path: string, body: unknown, method = "POST") =>
  api(path, { method, body: JSON.stringify(body) });
export const localKey = "myblog-studio-pending-v1";
export async function signOut() {
  let unsaved;
  try {
    unsaved = JSON.parse(localStorage.getItem(localKey) || "{}");
    if (!unsaved || typeof unsaved !== "object") throw new Error();
  } catch {
    throw new Error("无法读取本机暂存，请先保存或导出当前内容，再退出登录。");
  }
  if (Object.keys(unsaved).length)
    throw new Error(
      "还有本机修改未同步，请先保存并解决冲突，再退出登录。登录过期时可在另一标签页重新登录。",
    );
  await send("/auth/logout", {});
  // Another tab can write a pending draft while logout is in flight. Keep its data.
}
export function pending(id: string, payload?: unknown) {
  const data = JSON.parse(localStorage.getItem(localKey) || "{}");
  if (payload !== undefined) {
    data[id] = payload;
    localStorage.setItem(localKey, JSON.stringify(data));
  }
  return data[id];
}
export function clearPending(id: string) {
  const data = JSON.parse(localStorage.getItem(localKey) || "{}");
  delete data[id];
  localStorage.setItem(localKey, JSON.stringify(data));
}
