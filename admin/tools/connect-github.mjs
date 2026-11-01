// Local-only GitHub App manifest handshake. Secrets go directly from process memory
// to Wrangler stdin, never through browser UI, source files, command arguments or logs.
import http from "node:http";
import { randomBytes, createPrivateKey, createSign } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
const origin = process.argv[2],
  ownerId = process.argv[3];
if (
  !origin ||
  !/^https:\/\/[a-z0-9.-]+$/.test(origin) ||
  !/^\d+$/.test(ownerId || "")
)
  throw Error(
    "Usage: node tools/connect-github.mjs https://studio-host OWNER_NUMERIC_ID",
  );
const local = "http://127.0.0.1:8977",
  state = randomBytes(32).toString("base64url");
const wrangler = path.resolve(
  import.meta.dirname,
  "../node_modules/wrangler/bin/wrangler.js",
);
let app,
  converting = false,
  done = false;
const manifest = {
  name: "MyBlog Studio kiooo808 " + Date.now().toString(36),
  url: origin,
  redirect_url: local + "/callback",
  callback_urls: [origin + "/api/auth/callback"],
  setup_url: local + "/installed?state=" + state,
  hook_attributes: { active: false },
  public: false,
  request_oauth_on_install: false,
  default_permissions: {
    contents: "write",
    pull_requests: "write",
    actions: "write",
    checks: "read",
  },
  default_events: [],
};
const escape = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
function page(res, body, status = 200) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(
    '<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接 MyBlog GitHub App</title><style>body{max-width:680px;margin:8vh auto;padding:25px;font:16px/1.9 system-ui;background:#f6f3fa;color:#332e42}button,a{color:#765b99}button{font:inherit;padding:12px 18px;border:1px solid #cbbbdc;border-radius:9px;background:#fff}</style>' +
      body +
      "</html>",
  );
}
function secret(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [wrangler, "secret", "put", name, "--env", "production"],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    let error = "";
    child.stderr.on("data", (data) => {
      error += data;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(Error("Cloudflare secret update failed for " + name)),
    );
    child.stdin.end(String(value));
  });
}
async function github(url, token, method = "GET") {
  const result = await fetch("https://api.github.com" + url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "User-Agent": "MyBlog-Studio-Setup",
    },
  });
  if (!result.ok)
    throw Error("GitHub setup verification failed (" + result.status + ")");
  return result.json();
}
function jwt() {
  const now = Math.floor(Date.now() / 1000),
    header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
      "base64url",
    ),
    payload = Buffer.from(
      JSON.stringify({ iat: now - 30, exp: now + 540, iss: String(app.id) }),
    ).toString("base64url"),
    message = header + "." + payload;
  return (
    message +
    "." +
    createSign("RSA-SHA256").update(message).sign(app.pem).toString("base64url")
  );
}
const server = http.createServer(async (req, res) => {
  if (req.headers.host !== "127.0.0.1:8977") {
    res.writeHead(403);
    res.end();
    return;
  }
  const url = new URL(req.url, local);
  try {
    if (url.pathname === "/")
      return page(
        res,
        `<h1>连接网站仓库</h1><p>将创建你拥有的 GitHub App，使用 GitHub 官方授权流程。应用仅用于 MyBlog 的内容提交、检查和发布。</p><p>后台地址：${escape(origin)}</p><p>下一步在 GitHub 核对权限，并安装时<strong>只选择 kiooo808.github.io</strong>。密钥会直接保存到你的 Cloudflare 服务，不会显示在网页或聊天中。</p><form action="https://github.com/settings/apps/new?state=${state}" method="post"><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"><button>前往 GitHub 审核应用配置 →</button></form>`,
      );
    if (url.pathname === "/callback") {
      if (
        url.searchParams.get("state") !== state ||
        !url.searchParams.get("code")
      )
        return page(res, "<h1>授权状态不正确，请重新开始。</h1>", 403);
      if (converting) return page(res, "<p>正在保存配置，请勿重复操作。</p>");
      converting = true;
      const result = await fetch(
        "https://api.github.com/app-manifests/" +
          encodeURIComponent(url.searchParams.get("code")) +
          "/conversions",
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "MyBlog-Studio-Setup",
          },
        },
      );
      if (!result.ok)
        throw Error(
          "GitHub App manifest conversion failed (" + result.status + ")",
        );
      app = await result.json();
      if (String(app.owner?.id) !== ownerId)
        throw Error("GitHub App owner does not match the site owner");
      const pem = createPrivateKey(app.pem).export({
        type: "pkcs8",
        format: "pem",
      });
      for (const [name, value] of Object.entries({
        PUBLIC_ORIGIN: origin,
        OWNER_ID: ownerId,
        GITHUB_APP_ID: app.id,
        GITHUB_CLIENT_ID: app.client_id,
        GITHUB_CLIENT_SECRET: app.client_secret,
        GITHUB_PRIVATE_KEY: pem,
      }))
        await secret(name, value);
      console.log(
        "App registered and credentials saved directly to Cloudflare. No secrets were written to files.",
      );
      return page(
        res,
        `<h1>应用已创建</h1><p>密钥已安全保存。下一步仅安装到网站仓库。</p><a href="https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new">前往 GitHub 选择网站仓库并安装 →</a>`,
      );
    }
    if (url.pathname === "/installed") {
      if (
        !app ||
        done ||
        url.searchParams.get("state") !== state ||
        !/^\d+$/.test(url.searchParams.get("installation_id") || "")
      )
        return page(res, "<h1>安装状态无效。</h1>", 403);
      const id = url.searchParams.get("installation_id"),
        installation = await github("/app/installations/" + id, jwt());
      if (
        String(installation.account?.id) !== ownerId ||
        installation.repository_selection !== "selected"
      )
        throw Error("Select only the website repository, not all repositories");
      const token = await github(
        "/app/installations/" + id + "/access_tokens",
        jwt(),
        "POST",
      );
      const repos = await github("/installation/repositories", token.token);
      if (
        repos.repositories?.length !== 1 ||
        repos.repositories[0].full_name !== "kiooo808/kiooo808.github.io"
      )
        throw Error(
          "Installation must include only kiooo808/kiooo808.github.io",
        );
      await secret("GITHUB_INSTALLATION_ID", id);
      done = true;
      console.log(
        "GitHub App installation verified: website repository only. Setup complete.",
      );
      return page(
        res,
        `<h1>连接完成</h1><p>已验证只授权网站仓库。</p><p>回到聊天后可以继续检查并部署后台。</p><a href="${escape(origin)}">打开在线工作台 →</a>`,
      );
    }
    return page(res, "<h1>页面不存在</h1>", 404);
  } catch (error) {
    console.error("Setup failed:", error.message);
    return page(
      res,
      "<h1>配置暂未完成</h1><p>" +
        escape(error.message) +
        "</p><p>请返回聊天继续处理，不要提交或粘贴任何密钥。</p>",
      500,
    );
  }
});
server.listen(8977, "127.0.0.1", () =>
  console.log("GitHub App setup ready at " + local),
);
setTimeout(() => server.close(), 60 * 60 * 1000).unref();
