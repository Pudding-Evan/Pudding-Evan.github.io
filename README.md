# 楽園（Elysium）

游戏客户端程序员的个人静态网站，用来展示文章和 Bilibili Vedio。文章由 Markdown 自动生成，可以直接部署到 GitHub Pages。

## 添加或替换文章

文章源文件建议放在 `content/posts/`。为了兼容直接拖文件的习惯，顶层的 `posts/*.md` 也会被扫描；但 `posts/` 同时是生成后的 HTML 输出目录，所以长期维护时更推荐用 `content/posts/`。

```text
content/posts/my-new-note.md
-> posts/my-new-note.html
```

文章正文只需要保留 Markdown 内容，推荐用第一行 `# 标题` 开始：

```md
# 我的新文章

正文从这里开始。

## 小标题

支持段落、列表、链接、引用、代码块和图片。
```

文章的标题、日期、Tag、摘要和顺序统一维护在 `content/articles.md`，格式和 `content/videos.md` 类似：

```md
| file | title | date | tag | summary | 顺序 |
| --- | --- | --- | --- | --- | --- |
| my-new-note.md | 我的新文章 | 2026-05-30 | DEV_NOTE | 显示在文章列表中的一句话摘要。 | 1 |
```

`顺序` 是可选字段，适合 GAS 这种系列文章；设置后首页的同 Tag 文章会按 `1、2、3...` 排列。没有设置 `顺序` 的文章仍按日期从新到旧排列。现在首页展示的是 `GAS` 这个 Tag 下的文章。

你也可以直接复制模板文件开始写：[content/posts/_template.md](content/posts/_template.md)。`_` 开头的模板文件不会被发布；复制成新文件后，在 `content/articles.md` 里补一行字段即可发布。

生成器仍然兼容每篇文章开头的 `---` front matter，但集中表会优先覆盖它。日常维护更推荐只改 `content/articles.md`。

添加或替换 `.md` 文件后，运行：

```powershell
python scripts/build.py
```

也可以直接双击 `build.bat` 一键生成网页。

生成器会自动更新首页最新文章、`articles.html` 归档页和 `posts/` 下的文章详情页。删除 Markdown 后再次构建，对应的已生成文章页也会删除。

## 添加或替换视频

视频源文件在 `content/videos.md`。在表格里新增一行即可，`bvid` 可以写 BV 号，也可以直接粘贴 Bilibili 视频链接。

```md
| bvid | title | summary | featured |
| --- | --- | --- | --- |
| BV1ZSVG6eEpH | 视频标题 | 视频简介。 | true |
```

- `featured: true`：显示在首页视频区域，首页最多显示前 2 个。
- 如果没有任何一行标记 `true`，首页默认显示表格前 2 条。
- 页面只展示视频标题；`summary` 现在作为备用描述字段保留，可以留空。

修改后运行：

```powershell
python scripts/build.py
```

生成器会自动更新首页视频卡片和 `videos.html` 视频列表页。

## 添加图片

本地图片建议放在 `content/posts/images/`，然后在 Markdown 中使用相对路径。如果 Markdown 放在 `posts/`，图片也可以继续按相对路径放在 `posts/Image/...`。

```md
![Profiler 对比图](images/profiler-comparison.png)
```

也可以直接使用远程图片：

```md
![示意图](https://example.com/example.png)
```

构建时，图片会复制或下载到 `assets/post-images/`，并使用内容哈希作为文件名。这样可以复用缓存、避免重复文件，也能防止远程图片失效影响文章。远程图片需要强制重新下载时，运行：

```powershell
python scripts/build.py --refresh-images
```

浏览器端还有一层 Service Worker 图片缓存，用于加快重复访问。

## 本地自动预览

开发时运行：

```powershell
python scripts/serve.py
```

也可以直接双击 `preview.bat`，它会先生成网页，再启动本地预览。

然后访问 `http://127.0.0.1:8000`。修改 `content/` 下的 Markdown 或图片后，页面会自动重新生成；刷新浏览器即可看到结果。

## 自动部署

`.github/workflows/pages.yml` 已配置 GitHub Pages 自动部署。提交并推送 Markdown、图片或脚本后，GitHub Actions 会重新生成并发布站点。

首次使用时，在仓库的 `Settings > Pages` 中将发布来源设为 `GitHub Actions`。

## 内容结构

- `content/posts/`：Markdown 文章源文件
- `content/articles.md`：文章标题、日期、Tag、摘要和顺序表
- `content/posts/images/`：文章原始图片
- `content/videos.md`：Bilibili 视频清单
- `assets/post-images/`：生成后的哈希图片缓存
- `posts/`：生成后的文章详情页
- `scripts/build.py`：Markdown 与图片缓存生成器
- `scripts/serve.py`：本地监听和预览服务器
- `build.bat`：Windows 一键生成网页
- `preview.bat`：Windows 一键预览并监听 Markdown 改动
- `index.html`：首页
- `articles.html`：文章归档
- `videos.html`：Switch 风格的 Bilibili 内嵌播放器
- `styles.css`：全站像素游戏风格样式
