import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, "../.."),
  admin = path.join(root, "admin");
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
}
const files = walk(path.join(root, "source/_posts"))
  .filter((f) => f.endsWith(".md"))
  .concat(path.join(root, "source/_data/personal.yml"));
let manifest = { posts: {} };
try {
  manifest = JSON.parse(
    fs.readFileSync(path.join(root, "public/content-manifest.json"), "utf8"),
  );
} catch {}
const sql = files
  .map((file) => {
    const content = fs.readFileSync(file, "utf8"),
      name = path.relative(root, file).replaceAll("\\", "/");
    const bytes = Buffer.from(content);
    const sha = createHash("sha1")
      .update("blob " + bytes.length + "\0")
      .update(bytes)
      .digest("hex");
    return `INSERT OR REPLACE INTO demo_content(path,content,sha,url) VALUES(${quote(name)},${quote(content)},${quote(sha)},${manifest.posts[name] ? quote(manifest.posts[name]) : "NULL"});`;
  })
  .join("\n");
fs.writeFileSync(path.join(admin, ".local-seed.sql"), sql);
fs.writeFileSync(path.join(admin, ".dev.vars"), 'LOCAL_DEMO="true"\n');
const wrangler = path.join(admin, "node_modules/wrangler/bin/wrangler.js");
execFileSync(
  process.execPath,
  [wrangler, "d1", "migrations", "apply", "DB", "--local"],
  { cwd: admin, stdio: "inherit" },
);
execFileSync(
  process.execPath,
  [wrangler, "d1", "execute", "DB", "--local", "--file", ".local-seed.sql"],
  { cwd: admin, stdio: "inherit" },
);
console.log(
  "Seeded published content only; private drafts were not changed. Demo is restricted to localhost.",
);
