# MyBlog

基于 Hexo + Fluid 的个人网站，包含项目、知识库、博客和日记。

[访问网站](https://kiooo808.github.io) · [内容工作台](https://myblog-studio.myblog-studio.workers.dev)

## 目录

| 目录 | 用途 |
| --- | --- |
| `source/` | 文章、附件、首页数据与站点资源 |
| `admin/` | 独立部署的内容工作台与 Cloudflare Worker |
| `views/`、`scripts/`、`lib/` | Hexo 模板、生成器与分区逻辑 |
| `tools/` | checks 检查、deploy 部署验证、tests 测试、fixtures 兼容性资料 |
| `docs/` | 内容维护与运维说明 |

## 本地运行

要求 Node.js 24。

```sh
npm ci
npm run build
npm run server
```

## 检查与发布

```sh
npm run verify:site
npm ci --prefix admin
npm run build --prefix admin
npm test --prefix admin
```

内容可在工作台中编辑、保存私密草稿、预览和发布。源码合并到 `main` 后，经 GitHub Actions 检查并发布到 `gh-pages`；不使用本地部署命令。

- [内容维护](docs/content.md)
- [工作台使用与维护](docs/studio.md)
- [部署与维护](docs/operations.md)
- [工作台开发与配置](admin/README.md)
