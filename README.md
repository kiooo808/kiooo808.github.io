# 个人博客

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
