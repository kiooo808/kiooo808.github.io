# 个人博客

## 个人空间（第一、二阶段）

首页是个人介绍、四个内容入口、真实项目、知识地图和最近 4 条更新。

首页的导航在同一页面内切换项目、知识库、博客、日记、关于和搜索区域；标题及导航保留，内容轻柔淡入。地址中的 `#blog`、`#knowledge` 等用于恢复当前分区，支持刷新与浏览器前进/后退；旧的独立页面地址仍可直接访问。开启减少动态效果时停用切换动画。明暗模式按钮使用「亮色／暗黑」命名。

「近期关注」在 `source/_data/personal.yml` 的 `recent_focus` 中维护，是按近期交流整理的公开主题摘要，更新时间使用 `focus_updated`。网站仅展示这份整理结果；此版本不包含定时同步聊天的服务。

配色默认按访问者设备的当地时间：06:00–17:59 为亮色，18:00–次日 05:59 为暗黑。手动切换在当前标签页的访问期间保留；新的访问默认重新按时间选择。初始化脚本在 Fluid 配色脚本之前运行，避免先亮后暗的闪烁。

| 入口 | 地址 | 内容来源 |
| --- | --- | --- |
| 项目 | `/projects/` | `source/_data/personal.yml` 中的项目；详情自动关联对应分类的更新文章 |
| 知识库 | `/knowledge/` | 学校课程、证书考试、读书笔记；按主题分组，组内从早到晚阅读 |
| 博客 | `/blog/` | 个人写作、应用更新及其他文章；每页 10 篇 |
| 日记 | `/diary/` | 日记分类；按年月显示，每页 10 篇 |

所有旧文章保持文件名、日期和路径不变。旧归档、分类、标签、统计、`/page/2/` 和 EnglishApp 地址继续生成。全部内容仍可通过 `/archives/` 浏览。统计页沿用旧内容，已移出主导航。

### 添加和组织内容

继续在 `source/_posts/` 写 Markdown，不需要移动旧文章。可以在头部显式设置 `section: blog`、`section: knowledge` 或 `section: diary`；未填写时按上表的原分类自动归属。分类和标签仍按 Hexo 原规则工作。

`source/_data/personal.yml` 集中维护简介、知识主题和项目列表。主题的 `category` 要与文章中的分类名称一致；新增其他知识主题前，内容也会出现在知识库的「其他笔记」。项目的 `slug` 使用唯一的英文短名，`url` 填实际工具地址，`category` 用于关联开发记录。

首页自动选择按发布日期倒序的 4 条记录。测试或未完成文章可以设置 `home: false`，仅退出首页推荐，不会取消发布；`home_exclude` 记录已有测试和占位内容的文件路径（相对 `_posts/`）。

站点模板在 `views/`，生成逻辑在 `scripts/personal-site.js`，分区规则在 `lib/content.cjs`。不修改 `node_modules/hexo-theme-fluid/`，升级或重新安装依赖后仍然生效。

### 验证与部署

```sh
npm ci
npm run clean
npm run build
npm run check:site
```

可用 `node tools/check-site.cjs <改版前的 public 目录>` 检查原有 URL 和静态附件是否保留。构建仍使用原有 `npm run build`，部署流程保持 `main` → GitHub Actions → `gh-pages` → GitHub Pages。合并改版分支后自动部署，无需更换 Pages 设置。

后续阶段再增加知识库章节前后导航及 Markdown 导入/发布后台；当前没有登录或仓库写入功能。

## 在 GitHub 上传日记

1. 选择 `main` 分支，进入 `source/_posts/日记/`。
2. 上传以 `.md` 结尾的文件，文件名例如 `26-10-31 日记.md`。
3. 在文档开头添加以下信息，两行 `---` 之间是 YAML 配置，正文放在第二行 `---` 之后：

```markdown
---
title: 26-10-31 日记
date: 2026-10-31 20:00:00
categories:
  - 日记
tags:
  - 日记
description: 今天的日记摘要
---

这里写日记正文。
```

`categories` 中的 `日记` 决定文章是否出现在导航栏的「日记」页面。
`description` 可以省略；如果填写，单行摘要直接写在冒号后面。
多行摘要需要写成以下格式，文字前保留两个空格：

```yaml
description: |
  第一行摘要。
  第二行摘要。
```

提交后，在仓库 **Actions → Deploy Hexo** 中等待发布完成，再刷新网页。
如果文章头部格式有误，构建会停止，并在日志中显示文件路径和具体错误；修正后提交会自动重新发布。

## 本地检查

```sh
npm ci
npm run check:posts
node --test tools/check-posts.test.cjs
npm run clean
npm run build
```
