# Elysium

个人静态站点，使用 Astro 构建。文章源文件保存在 Markdown 中，页面由 Astro 在构建时生成到 `dist/`。

## 开发

首次安装依赖：

```powershell
npm install
```

启动本地预览：

```powershell
npm run dev
```

生成静态站点：

```powershell
npm run build
```

构建产物会输出到 `dist/`。GitHub Pages workflow 也使用同一套 `npm ci` + `npm run build` 流程发布。

## 文章结构

文章按分类放在 `posts/` 下。分类由第一层文件夹决定，文章页面会自动把分类名作为 Tag。

```text
posts/
  GAS/
    GAS设计解析一：ASC与Attribute/
      GAS设计解析一：ASC与Attribute.md
      images/

  Net/
    UE网络笔记一：网络总览/
      UE网络笔记一：网络总览.md
      images/

  Dev/
    正在写的文章/
      正在写的文章.md
      images/
```

推荐每篇文章都使用一个独立目录：

```text
posts/{分类}/{文章标题}/{文章标题}.md
posts/{分类}/{文章标题}/images/*
```

`Dev` 是工作目录。新文章可以先放在 `posts/Dev/文章名/` 中，写完后把整个文章目录移动到 `GAS`、`Net` 或其他分类下，Tag 会自动跟着文件夹变化。

## 添加文章

正文推荐以一级标题开始：

```md
# 我的新文章

正文从这里开始。

## 小标题

支持段落、列表、链接、引用、代码块、表格和图片。
```

文章的日期、摘要和系列排序维护在 `content/articles.md`：

```md
| file | date | summary | order |
| --- | --- | --- | --- |
| Dev/我的新文章/我的新文章.md | 2026-06-13 | 显示在文章列表中的一句话摘要。 | 1 |
```

`order` 是可选字段，适合系列文章排序；没有顺序的文章会按日期从新到旧排列。Tag 不需要在这里手动维护。文章列表和首页显示的标题来自 Markdown 文件名，不来自正文一级标题。

移动文章目录后，可以刷新文章索引：

```powershell
npm run sync-articles
```

如果文章 Markdown 顶部写了 frontmatter，脚本会用其中的 `date`、`summary`、`order` 覆盖索引里的对应字段：

```md
---
date: 2026-06-13
summary: 施工中。
order: 1
---
```

## 添加图片

图片放在文章目录内的 `images/` 中，然后在 Markdown 里使用相对路径：

```md
![示意图](./images/example.png)
```

Astro 会在构建时处理这些图片，并把最终静态资源写入 `dist/_astro/`。

## 添加视频

视频列表维护在 `content/videos.md`：

```md
| bvid | title | summary | featured |
| --- | --- | --- | --- |
| BV1ZSVG6eEpH | 视频标题 | 简介 | true |
```

`featured: true` 的视频会显示在首页，最多显示前 2 个；如果没有任何视频标记为 `true`，首页默认显示列表前 2 个。

## 项目结构

- `src/pages/`：Astro 页面入口
- `src/layouts/`：页面布局
- `src/lib/content.ts`：读取文章和视频数据
- `posts/`：Markdown 文章源文件与文章原图
- `content/articles.md`：文章日期、摘要和排序
- `content/videos.md`：视频元数据
- `assets/`：站点静态视觉资源
- `styles.css`：全站样式
- `site.js`：前端交互脚本
- `scripts/run-astro.mjs`：启动 Astro CLI
- `scripts/sync-static.mjs`：构建前把静态资源同步到 Astro 的 `public/`
- `dist/`：Astro 构建产物，不提交
