# MyBlog 内容工作台

独立于 Hexo 阅读网站的单人后台。手机和电脑使用同一个 Worker 地址登录；正式网站继续由 GitHub Actions 发布到原 `gh-pages` 分支。后台源代码在 `admin/`，不会进入 Hexo 的 `public/`。

## 本地试用

要求 Node 24。仓库根目录先构建网站，再运行：

```sh
npm ci --prefix admin
npm run build --prefix admin
npm run seed --prefix admin
npm run dev --prefix admin
```

打开 `http://127.0.0.1:8787/`。本地登录不依赖 GitHub，草稿和附件实际写入 `.wrangler/state`；正式发布明确拒绝执行。`seed` 只刷新已发布内容镜像，不删除草稿。本地演示仅监听回环地址，不应向公网或局域网开放。

## 正式部署准备

需要 Cloudflare 账户及 R2 已开通。先合并并部署包含本次后台、校验流程和公开内容清单的站点源码，再开放后台正式发布。不要用旧部署流程替换本次 `verify.yml`。

1. 在 `admin/` 执行 `npx wrangler login`，由站点所有者在官方页面完成登录。
2. 执行 `npx wrangler d1 create myblog-studio`，把返回的 ID 填入 `wrangler.jsonc` 中 **production** 的 `database_id`，不要修改本地 ID。
3. 执行 `npx wrangler r2 bucket create myblog-studio-private`。保持 R2 开发公共地址和自定义公共域名关闭。
4. 确定后台域名，例如 `https://myblog-studio.<账户子域>.workers.dev`；在 Cloudflare 管理台确认账户子域，也可使用自己绑定的域名。
5. 创建一个仅供自己使用的 GitHub App：主页填后台地址，回调填 `<后台地址>/api/auth/callback`；关闭 Webhook，启用用户访问令牌过期；Repository permissions 设置 Contents: Read and write、Pull requests: Read and write、Actions: Read and write、Checks: Read-only，Metadata 为默认只读。只安装到 `kiooo808/kiooo808.github.io`。App 设置要允许用户授权；生产发布令牌由安装身份签发。
6. 通过 `npx wrangler secret put <名称> --env production` **交互输入**下列值，不要把密钥提交到仓库、写进前端或粘贴到聊天中：

| 名称 | 内容 |
| --- | --- |
| `PUBLIC_ORIGIN` | 后台 HTTPS 根地址，不带末尾 `/` |
| `OWNER_ID` | GitHub 所有者不可变的数字 ID，可从 `https://api.github.com/users/kiooo808` 查看 |
| `GITHUB_APP_ID` | App ID |
| `GITHUB_INSTALLATION_ID` | App 安装到仓库时的安装 ID |
| `GITHUB_CLIENT_ID` | App Client ID |
| `GITHUB_CLIENT_SECRET` | App Client Secret |
| `GITHUB_PRIVATE_KEY` | App 下载的完整 PEM 私钥，支持 PKCS#1 和 PKCS#8，保留换行 |

`OWNER_LOGIN` 与仓库名已在 production 配置中固定。GitHub 下载的 `BEGIN RSA PRIVATE KEY` 可直接使用，后台会在服务端转换为 WebCrypto 所需格式，无需另存一份转换后的密钥。私钥不要进入仓库。所有必需配置齐全后，后台才显示登录入口可用。

7. 执行 `npx wrangler d1 migrations apply DB --remote --env production`，然后执行 `npm run deploy`。部署脚本会核对正式数据库 ID、所需 secret 名称、构建和测试，并阻止将演示配置部署到线上。
8. 登录后先发布一篇明确标为测试用途的文章。检查记录须依次经历排队、检查、部署、上线核对，最终显示“已上线”。验证图片/PDF、手机编辑，以及一次更新后的“恢复上一版为草稿”。测试内容需要通过普通内容更新流程处理，不要重写仓库历史。

后台实际 Cloudflare 开通、登录与 GitHub App 授权必须由所有者完成；没有配置的部署不应被报告为已上线。费用取决于账户套餐和用量，本项目没有自动开通付费套餐。

## 使用与维护

- [编辑、发布、删除与恢复](../docs/studio.md)
- [网站内容维护](../docs/content.md)
- [部署、备份与历史重置](../docs/operations.md)
