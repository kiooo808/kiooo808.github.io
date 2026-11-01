import { Env, demo, HttpError, json } from "./types";
const enc = new TextEncoder();
export const random = () => crypto.randomUUID() + crypto.randomUUID();
export const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
export async function hash(value: string) {
  return b64(
    new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))),
  );
}
function cookie(request: Request, name: string) {
  return request.headers
    .get("Cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="))
    ?.slice(name.length + 1);
}
function sessionCookie(token: string, url: URL) {
  return `studio_session=${token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=604800${url.protocol === "https:" ? "; Secure" : ""}`;
}
async function session(env: Env, url: URL) {
  const token = random();
  await env.DB.prepare("INSERT INTO sessions(id,expires) VALUES(?,?)")
    .bind(await hash(token), Date.now() + 7 * 86400000)
    .run();
  return jsonSession(token, url);
}
function jsonSession(token: string, url: URL) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": sessionCookie(token, url),
      "Cache-Control": "no-store",
    },
  });
}
export async function requireUser(request: Request, env: Env) {
  const token = cookie(request, "studio_session");
  if (
    !token ||
    !(await env.DB.prepare("SELECT id FROM sessions WHERE id=? AND expires>?")
      .bind(await hash(token), Date.now())
      .first())
  )
    throw new HttpError(401, "请先登录。");
}
export function sameOrigin(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  const expected = env.PUBLIC_ORIGIN || new URL(request.url).origin;
  if (origin !== expected)
    throw new HttpError(403, "请求来源不正确，请刷新后台后重试。");
}
export async function authRoute(request: Request, env: Env, url: URL) {
  if (url.pathname === "/api/auth/demo" && request.method === "POST") {
    if (!demo(env, url)) throw new HttpError(404, "入口不存在。");
    sameOrigin(request, env);
    return session(env, url);
  }
  if (url.pathname === "/api/auth/login") {
    if (
      !env.GITHUB_CLIENT_ID ||
      !env.GITHUB_CLIENT_SECRET ||
      !env.PUBLIC_ORIGIN ||
      !env.OWNER_ID
    )
      throw new HttpError(503, "GitHub 登录尚未配置。");
    const state = random(),
      verifier = random();
    await env.DB.prepare(
      "INSERT INTO oauth_states(id,verifier,expires) VALUES(?,?,?)",
    )
      .bind(await hash(state), verifier, Date.now() + 600000)
      .run();
    const target = new URL("https://github.com/login/oauth/authorize");
    target.search = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: env.PUBLIC_ORIGIN + "/api/auth/callback",
      state,
      code_challenge: await hash(verifier),
      code_challenge_method: "S256",
    }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        Location: target.href,
        "Set-Cookie": `studio_oauth=${state}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        "Cache-Control": "no-store",
      },
    });
  }
  if (url.pathname === "/api/auth/callback") {
    const state = url.searchParams.get("state");
    if (!state || state !== cookie(request, "studio_oauth"))
      throw new HttpError(403, "登录状态无效，请重新登录。");
    const saved = await env.DB.prepare(
      "DELETE FROM oauth_states WHERE id=? AND expires>? RETURNING verifier",
    )
      .bind(await hash(state), Date.now())
      .first<{ verifier: string }>();
    if (!saved || !url.searchParams.get("code"))
      throw new HttpError(403, "登录已过期。");
    const result = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: url.searchParams.get("code"),
        redirect_uri: env.PUBLIC_ORIGIN + "/api/auth/callback",
        code_verifier: saved.verifier,
      }),
    });
    const token = (await result.json()) as { access_token?: string };
    if (!token.access_token) throw new HttpError(403, "GitHub 授权失败。");
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: "Bearer " + token.access_token,
        "User-Agent": "MyBlog-Studio",
        Accept: "application/vnd.github+json",
      },
    });
    const user = (await userResponse.json()) as { id?: number; login?: string };
    if (
      !userResponse.ok ||
      String(user.id) !== env.OWNER_ID ||
      user.login?.toLowerCase() !== env.OWNER_LOGIN.toLowerCase()
    )
      throw new HttpError(403, "此后台只允许站点所有者登录。");
    return session(env, url);
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    sameOrigin(request, env);
    const token = cookie(request, "studio_session");
    if (token)
      await env.DB.prepare("DELETE FROM sessions WHERE id=?")
        .bind(await hash(token))
        .run();
    return new Response(null, {
      status: 204,
      headers: {
        "Set-Cookie":
          "studio_session=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0",
        "Cache-Control": "no-store",
      },
    });
  }
  return json({ error: "入口不存在。" }, 404);
}
