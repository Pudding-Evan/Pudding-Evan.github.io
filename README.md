# Elysium

个人静态站点，使用 Astro 构建。文章源文件保存在 Markdown 中，页面由 Astro 在构建时生成到 `dist/`，仓库里不再提交旧的 `posts/*.html` 生成结果。

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

## 添加文章

文章 Markdown 保存在 `posts/`：

```text
posts/my-new-note.md
```

正文推荐以一级标题开始：

```md
# 我的新文章

正文从这里开始。

## 小标题

支持段落、列表、链接、引用、代码块、表格和图片。
```

文章的标题、日期、Tag、摘要和顺序维护在 `content/articles.md`：

```md
| file | title | date | tag | summary | 顺序 |
| --- | --- | --- | --- | --- | --- |
| my-new-note.md | 我的新文章 | 2026-06-06 | NOTE | 显示在文章列表中的一句话摘要。 | 1 |
```

`顺序` 是可选字段，适合系列文章排序。没有顺序的文章会按日期从新到旧排列。

## 添加图片

文章图片建议放在文章源旁边的 `posts/Image/...` 目录，然后在 Markdown 中使用相对路径：

```md
![示意图](Image/example/image.png)
```

Astro 会在构建时处理这些图片，并把最终静态资源写入 `dist/_astro/`。仓库中不再维护旧的 `assets/post-images` 哈希缓存。

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
- `content/articles.md`：文章元数据
- `content/videos.md`：视频元数据
- `assets/`：站点静态视觉资源
- `styles.css`：全站样式
- `site.js`：前端交互脚本
- `scripts/run-astro.mjs`：禁用遥测并启动 Astro CLI
- `scripts/sync-static.mjs`：构建前把静态资源同步到 Astro 的 `public/`
- `dist/`：Astro 构建产物，不提交
