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

## 编辑与兼容行为

- 编辑器为 Milkdown/Crepe，正文保存为 Markdown。文章包含原始 HTML、脚本或 Hexo 标签时，默认源码模式并阻止有损切换；预览剥离脚本、表单和 iframe，代码不会在后台执行。
- 保存草稿无需标题完整；预览和发布才检查标题、日期、分区和项目字段。已发布文章的日期、文件位置、固定链接不可改动，未知头部字段及 YAML 注释保留。
- 自动保存采用版本号比较。冲突时 D1 保存双方内容，界面提供选择；失败/离线时正文暂存在当前浏览器，重新联网或重开草稿会重试。有未同步修改或无法读取的暂存时，后台会阻止退出登录，避免清空本机草稿；登录过期时可在另一标签页重新登录，再回到原草稿保存。
- 附件只接受经文件头验证的 PNG/JPG/WebP/GIF/PDF，单文件最多 10MB、单次发布合计最多 20MB。上传归属具体草稿；发布快照只携带其引用的附件，并把私密 URL 替换为正式静态路径。已经公开的附件不会因回滚而变成私密。
- Markdown 导入保留未在表单展示的头部信息；所有旧文章按原分类归属，编辑时可显式设置分区。
- 首页表单更新简介、项目、近期关注和关注日期；知识主题和排除列表不受影响。已有项目地址若被移除，会由站点兼容检查阻止与基线冲突的更改。
- 排版预览支持亮暗和手机宽度，是正文/卡片预览，不是私密整站构建。特殊嵌入内容以上线阅读页面为准。

## 发布运行机制

草稿版本不可变地绑定发布任务。首次点击发布后，该快照进入**公开仓库**的 `studio/<任务ID>` 分支及 PR；此前不会上传草稿或附件到 GitHub。重复点击复用同一任务。

Worker 每分钟推进一个最早的活动任务，数据库租约避免并行执行。检查工作流成功且主分支仍是检查基线时，由 App 以 squash 合并指定提交。部署工作流重新执行同样检查，使用检查产物发布；全局并发组避免旧部署覆盖新部署。后台核对网站 `revision.json` 才确认上线。后续代码部署已包含该次更新时，还会核对提交祖先关系和文章内容。

检查失败不会合并；主分支变化时报告冲突，需刷新已发布内容、合并修改后重新预览发布。部署工作流等待 GitHub Pages 真正提供对应版本后才释放并发锁；产物推送完成不代表部署成功。后台也会识别对应产物的 Pages 下游失败，重试该任务时不会再次提交文章。部署失败可重试同一个合并版本，避免重复提交。任务等待超过 30 分钟显示失败；重试不会把超时误报为成功。

若 GitHub Pages 把已完成的部署继续当作占用，部署前会核对该工作流已成功结束、产物版本与当前线上版本完全一致，且 Pages 状态为空或仍在排队，才取消这一条旧状态。若状态显示成功，还必须从较新失败任务日志中取得明确指向它的占用错误。运行中的任务和其他产物不受影响。发布期间出现这一已确认的占用时，同一 Pages 产物自动重试一次，重复失败即停止。该步骤只使用仓库 Actions 的短期权限，不增加后台 GitHub App 权限；`gh-pages` 使用普通提交保留产物历史。

“恢复上一版”读取该次发布前的内容，结合仓库当前基线创建**新的私密草稿**，预览发布后生成普通新提交。首次发布的新文章没有上一版，暂不提供整篇删除/撤回。

## 验证与数据

```sh
npm run build
npm test
npm audit
```

测试在真实 Workers 模拟运行时、D1 和 R2 中执行，GitHub 和线上站点请求使用受控替身，不会连接真实仓库写入。覆盖文章往返、访问隔离、并发冲突、文件验证、发布幂等、快照隔离、排队、检查失败、重试和恢复。

数据库迁移保存在 `migrations/`。维护前可用 Wrangler 的 D1 导出功能做私密备份，并另外保留私有 R2 附件；数据库导出含草稿，不应提交到源码仓库。发布任务记录保留版本和错误，但 API 不回传仓库令牌；服务日志不输出文章、密钥或 OAuth 令牌。

## API

`/api/auth/login|callback|logout`、本地限定 `/api/auth/demo`；`/api/me`；`/api/content`；`/api/drafts` 与 `/:id`、`/:id/versions`、`/:id/conflicts`；`/api/media` 与 `/:id`；`/api/preview`；`/api/publications` 与 `/:id/restore`。

除公开运行配置和登录入口外均要求 HttpOnly 会话。写请求校验同源。保存提交 `{version,payload}`，冲突返回 409 和服务器版本；发布提交 `{draftId,version,retry?}`，接受后返回 202 与任务 ID。恢复只创建草稿，不立即上线。

## 仓库维护

暂停发布与历史重置后的处理见 [部署与维护](../docs/operations.md)。草稿、版本、附件和发布记录不随 Git 历史重置删除。
