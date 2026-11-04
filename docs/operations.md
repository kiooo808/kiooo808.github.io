# 部署与维护

## 发布路径

`main` → GitHub Actions → `gh-pages` → GitHub Pages。Pages 来源保持 `gh-pages / (root)`。

PR 和 main 使用同一套 `.github/workflows/verify.yml`：工作台构建、后台测试、文章检查、完整站点构建、链接检查和原有 81 个地址检查。通过检查的同一份产物才会发布。`content-manifest.json` 保留后台识别的文章地址，`revision.json` 标记实际上线的源码提交。

源码和工作台发布请求使用 squash 合并，合并后自动删除开发分支。不要重新引入本地部署快捷入口，也不要修改依赖包中的主题文件。

## 后台维护

在 Worker production 环境设置加密变量 `PUBLISH_PAUSED=true` 可暂停新发布与重试，草稿保存、附件和内容读取继续工作。已有活动任务仍会完成；历史维护须确认队列为空后再继续。维护结束删除该变量或设为 `false`。

旧失败任务重试前检查提交是否仍属于当前主分支历史。历史已重置时拒绝重跑旧部署，需编辑并保存草稿生成新版本后重新发布。成功发布记录的恢复功能使用已保存内容和当前文件基线，不依赖旧提交祖先链。

## 历史重置后的本地工作

历史重置是单独安排的一次性维护，日常发布保留正常提交。重置完成时 `main` 和 `gh-pages` 各保留一个无父提交快照，后续更新仍会产生新提交。旧克隆应先保留未提交内容，再重新克隆；不要把旧分支合并回新的 main。

```sh
git clone https://github.com/kiooo808/kiooo808.github.io.git
```

完整历史备份保存在仓库外，不推送公开备份分支。需要恢复时先从 bundle 克隆到独立目录检查，不直接覆盖当前生产分支。历史 PR 和 Actions 记录继续保留，历史重置不代表彻底删除 GitHub 上旧对象。

## 内容撤下与永久删除

删除沿用发布检查及上线核对流程，不直接修改 gh-pages。回收站提示页保留原地址；永久删除的已确认地址允许返回 404，其他旧地址和静态资源继续受兼容性检查保护。

迁移管理功能前须私密备份数据库和 R2；确认发布队列为空，再在 `admin/` 目录执行 `npx wrangler d1 migrations apply DB --remote --env production` 并部署工作台。

## 工具组织与快照维护

`tools/` 按 checks、deploy、tests、fixtures 分类。使用根目录 npm 命令运行检查；Actions 使用 deploy 中的上线验证工具，兼容性地址清单在 fixtures 中。

快照维护先暂停后台新发布和重试，等待队列为空，备份所有 Git 引用、D1 与 R2 并验证恢复。完成检查后，使用明确旧 SHA 的 `--force-with-lease` 更新源码；由 Actions 验证上线，再将同一份部署产物整理为部署分支的单次快照。保留 Pages 来源配置和删除登记；不把旧备份分支推回远端。最后恢复后台发布并核对线上版本与队列。
