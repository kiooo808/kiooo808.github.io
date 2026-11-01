import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
const text = fs.readFileSync(
  new URL("../wrangler.jsonc", import.meta.url),
  "utf8",
);
if (text.includes("REPLACE_WITH_PRODUCTION_D1_ID"))
  throw new Error("先配置正式 D1 数据库 ID；不会部署演示配置。");
if (/LOCAL_DEMO/.test(text))
  throw new Error("LOCAL_DEMO 只能存在于本地 .dev.vars，不能进入线上配置。");
const wrangler = path.resolve(
  import.meta.dirname,
  "../node_modules/wrangler/bin/wrangler.js",
);
const output = execFileSync(
  process.execPath,
  [wrangler, "secret", "list", "--env", "production"],
  { encoding: "utf8" },
);
const keys = new Set(
  JSON.parse(output.slice(output.indexOf("["))).map((item) => item.name),
);
for (const name of [
  "PUBLIC_ORIGIN",
  "OWNER_ID",
  "GITHUB_APP_ID",
  "GITHUB_INSTALLATION_ID",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_PRIVATE_KEY",
])
  if (!keys.has(name)) throw new Error("缺少正式服务配置：" + name);
console.log(
  "Production bindings and secret names checked. Keep R2 public access disabled.",
);
