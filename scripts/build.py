#!/usr/bin/env python3
"""Build article pages from Markdown files in content/posts."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import mimetypes
import re
import shutil
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRS = [ROOT / "content" / "posts", ROOT / "posts"]
POSTS_DIR = ROOT / "posts"
IMAGE_DIR = ROOT / "assets" / "post-images"
IMAGE_MANIFEST = IMAGE_DIR / "manifest.json"
POST_MANIFEST = POSTS_DIR / ".generated-posts.json"
ARTICLE_SOURCE = ROOT / "content" / "articles.md"
VIDEO_SOURCE = ROOT / "content" / "videos.md"
HOME_START = "<!-- AUTO_POSTS_START -->"
HOME_END = "<!-- AUTO_POSTS_END -->"
HOME_VIDEOS_START = "<!-- AUTO_VIDEOS_START -->"
HOME_VIDEOS_END = "<!-- AUTO_VIDEOS_END -->"
ARCHIVE_START = "<!-- AUTO_POSTS_START -->"
ARCHIVE_END = "<!-- AUTO_POSTS_END -->"
STYLE_VERSION = "29"
HOME_POST_TAG = "GAS"


@dataclass
class Post:
    source: Path
    slug: str
    title: str
    published: str
    tag: str
    order: int | None
    summary: str
    lead: str
    body: str
    read_minutes: int

    @property
    def display_date(self) -> str:
        return self.published.replace("-", ".")


@dataclass
class Video:
    bvid: str
    title: str
    summary: str
    featured: bool = False

    @property
    def element_id(self) -> str:
        return f"video-{slugify(self.bvid).lower()}"

    @property
    def embed_url(self) -> str:
        return (
            "https://player.bilibili.com/player.html?"
            f"bvid={html.escape(self.bvid)}&amp;p=1&amp;poster=1&amp;autoplay=0"
        )


class ImageCache:
    def __init__(self, refresh_remote: bool = False) -> None:
        self.refresh_remote = refresh_remote
        IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        if IMAGE_MANIFEST.exists():
            self.data = json.loads(IMAGE_MANIFEST.read_text(encoding="utf-8"))
        else:
            self.data = {"images": {}}

    def cache(self, source: str, post_source: Path) -> str:
        parsed = urlparse(source)
        if parsed.scheme in {"http", "https"}:
            return self._cache_remote(source)
        if parsed.scheme or source.startswith("#"):
            return source
        return self._cache_local(source, post_source)

    def _cache_remote(self, source: str) -> str:
        key = f"remote:{source}"
        cached = self.data["images"].get(key)
        if cached and not self.refresh_remote:
            output = ROOT / cached["output"]
            if output.exists():
                return f"../{output.relative_to(ROOT).as_posix()}"

        request = Request(source, headers={"User-Agent": "ElysiumMarkdownBuilder/1.0"})
        with urlopen(request, timeout=20) as response:
            payload = response.read()
            content_type = response.headers.get_content_type()
        extension = self._extension(Path(urlparse(source).path).suffix, content_type)
        return self._write_cached(key, payload, extension, source)

    def _cache_local(self, source: str, post_source: Path) -> str:
        source_path = (post_source.parent / unquote(source)).resolve()
        try:
            source_path.relative_to(ROOT)
        except ValueError as error:
            raise ValueError(f"Image path must stay inside the site directory: {source}") from error
        if not source_path.is_file():
            raise FileNotFoundError(f"Image referenced by {post_source.name} does not exist: {source}")
        payload = source_path.read_bytes()
        key = f"local:{source_path.relative_to(ROOT).as_posix()}"
        return self._write_cached(key, payload, source_path.suffix, source)

    def _write_cached(self, key: str, payload: bytes, extension: str, source: str) -> str:
        digest = hashlib.sha256(payload).hexdigest()
        safe_extension = self._extension(extension, "")
        output = IMAGE_DIR / f"{digest[:24]}{safe_extension}"
        if not output.exists():
            output.write_bytes(payload)
        self.data["images"][key] = {
            "source": source,
            "sha256": digest,
            "output": output.relative_to(ROOT).as_posix(),
        }
        return f"../{output.relative_to(ROOT).as_posix()}"

    @staticmethod
    def _extension(extension: str, content_type: str) -> str:
        extension = extension.lower()
        if re.fullmatch(r"\.[a-z0-9]{1,5}", extension):
            return extension
        guessed = mimetypes.guess_extension(content_type) if content_type else None
        return guessed or ".img"

    def save(self) -> None:
        IMAGE_MANIFEST.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


def parse_front_matter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    _, front_matter, body = text.split("---\n", 2)
    metadata: dict[str, str] = {}
    for raw_line in front_matter.splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        if ":" not in raw_line:
            raise ValueError(f"Invalid front matter line: {raw_line}")
        key, value = raw_line.split(":", 1)
        metadata[key.strip()] = value.strip().strip("\"'")
    return metadata, body.strip()


def render_inline(text: str, image_cache: ImageCache, source: Path) -> str:
    token_pattern = re.compile(
        r"(!?\[[^\]]*]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)"
    )
    rendered: list[str] = []
    cursor = 0
    for match in token_pattern.finditer(text):
        rendered.append(html.escape(text[cursor : match.start()]))
        token = match.group(0)
        if token.startswith("!["):
            alt, image_source = re.match(r"!\[([^\]]*)]\(([^)]+)\)", token).groups()
            cached_source = image_cache.cache(image_source.strip(), source)
            rendered.append(
                f'<img class="article-inline-image" src="{html.escape(cached_source)}" '
                f'alt="{html.escape(alt)}" loading="lazy" decoding="async">'
            )
        elif token.startswith("["):
            label, href = re.match(r"\[([^\]]*)]\(([^)]+)\)", token).groups()
            rendered.append(
                f'<a href="{html.escape(href.strip())}">{html.escape(label)}</a>'
            )
        elif token.startswith("`"):
            rendered.append(f"<code>{html.escape(token[1:-1])}</code>")
        elif token.startswith("**"):
            rendered.append(f"<strong>{html.escape(token[2:-2])}</strong>")
        else:
            rendered.append(f"<em>{html.escape(token[1:-1])}</em>")
        cursor = match.end()
    rendered.append(html.escape(text[cursor:]))
    return "".join(rendered)


def render_markdown(text: str, image_cache: ImageCache, source: Path) -> str:
    output: list[str] = []
    paragraph: list[str] = []
    quote: list[str] = []
    list_type: str | None = None
    in_code = False
    code_language = ""
    code_lines: list[str] = []

    def flush_paragraph() -> None:
        if paragraph:
            output.append(f"<p>{render_inline(' '.join(paragraph), image_cache, source)}</p>")
            paragraph.clear()

    def flush_quote() -> None:
        if quote:
            output.append(
                f"<blockquote>{render_inline(' '.join(quote), image_cache, source)}</blockquote>"
            )
            quote.clear()

    def close_list() -> None:
        nonlocal list_type
        if list_type:
            output.append(f"</{list_type}>")
            list_type = None

    for raw_line in [*text.splitlines(), ""]:
        line = raw_line.rstrip()
        if line.startswith("```"):
            flush_paragraph()
            flush_quote()
            close_list()
            if in_code:
                language_class = (
                    f' class="language-{html.escape(code_language)}"' if code_language else ""
                )
                output.append(
                    f"<pre><code{language_class}>{html.escape(chr(10).join(code_lines))}</code></pre>"
                )
                code_lines.clear()
                in_code = False
            else:
                code_language = line[3:].strip()
                in_code = True
            continue
        if in_code:
            code_lines.append(raw_line)
            continue
        if not line.strip():
            flush_paragraph()
            flush_quote()
            close_list()
            continue
        heading = re.match(r"^(#{1,3})\s+(.+)$", line)
        if heading:
            flush_paragraph()
            flush_quote()
            close_list()
            level = len(heading.group(1))
            output.append(
                f"<h{level}>{render_inline(heading.group(2), image_cache, source)}</h{level}>"
            )
            continue
        image = re.fullmatch(r"!\[([^\]]*)]\(([^)]+)\)", line.strip())
        if image:
            flush_paragraph()
            flush_quote()
            close_list()
            alt, image_source = image.groups()
            cached_source = image_cache.cache(image_source.strip(), source)
            caption = f"<figcaption>{html.escape(alt)}</figcaption>" if alt else ""
            output.append(
                '<figure class="article-image">'
                f'<img src="{html.escape(cached_source)}" alt="{html.escape(alt)}" '
                'loading="lazy" decoding="async">'
                f"{caption}</figure>"
            )
            continue
        if line.startswith("> "):
            flush_paragraph()
            close_list()
            quote.append(line[2:])
            continue
        unordered = re.match(r"^[-*]\s+(.+)$", line)
        ordered = re.match(r"^\d+\.\s+(.+)$", line)
        if unordered or ordered:
            flush_paragraph()
            flush_quote()
            wanted_type = "ul" if unordered else "ol"
            if list_type != wanted_type:
                close_list()
                list_type = wanted_type
                output.append(f"<{list_type}>")
            item = (unordered or ordered).group(1)
            output.append(f"<li>{render_inline(item, image_cache, source)}</li>")
            continue
        paragraph.append(line.strip())
    return "\n      ".join(output)


def first_paragraph(markdown: str) -> str:
    for block in markdown.split("\n\n"):
        text = " ".join(line.strip() for line in block.splitlines())
        if not text:
            continue
        if (
            text.startswith(("#", ">", "```", "!["))
            or re.match(r"^[-*]\s+", text)
            or re.match(r"^\d+\.\s+", text)
        ):
            continue
        if text:
            return re.sub(r"[`*_]", "", text)
    return ""


def first_heading(markdown: str) -> str:
    for line in markdown.splitlines():
        match = re.match(r"^#\s+(.+)$", line.strip())
        if match:
            return re.sub(r"[`*_]", "", match.group(1)).strip()
    return ""


def remove_leading_title(markdown: str, title: str) -> str:
    lines = markdown.splitlines()
    for index, line in enumerate(lines):
        if not line.strip():
            continue
        match = re.match(r"^#\s+(.+)$", line.strip())
        if match and re.sub(r"[`*_]", "", match.group(1)).strip() == title:
            return "\n".join(lines[index + 1 :]).strip()
        return markdown
    return markdown


def slugify(value: str) -> str:
    value = value.strip().replace("\\", "-").replace("/", "-")
    value = re.sub(r"\s+", "-", value)
    value = re.sub(r'[<>:"|?*]+', "-", value)
    value = value.strip(".-")
    return value or "post"


def estimate_read_minutes(markdown: str) -> int:
    plain_text = re.sub(r"[#>*_`\[\]()]|https?://\S+", " ", markdown)
    cjk_count = len(re.findall(r"[\u3400-\u9fff]", plain_text))
    word_count = len(re.findall(r"[A-Za-z0-9]+", plain_text))
    return max(1, round((cjk_count + word_count) / 360))


def parse_order(metadata: dict[str, str], source: Path) -> int | None:
    raw_order = (metadata.get("顺序") or metadata.get("order") or "").strip()
    if not raw_order:
        return None
    if not re.fullmatch(r"\d+", raw_order):
        raise ValueError(f"{source.name} has an invalid order/顺序: {raw_order}")
    return int(raw_order)


def sort_by_date(posts: list[Post]) -> list[Post]:
    return sorted(posts, key=lambda post: (post.published, post.slug), reverse=True)


def sort_by_order(posts: list[Post]) -> list[Post]:
    ordered = sorted(
        [post for post in posts if post.order is not None],
        key=lambda post: (post.order, post.published, post.slug),
    )
    unordered = sort_by_date([post for post in posts if post.order is None])
    return ordered + unordered


def tag_filter_value(tag: str) -> str:
    return slugify(tag).lower()


def posts_with_tag(posts: list[Post], tag: str) -> list[Post]:
    return [post for post in posts if post.tag.casefold() == tag.casefold()]


def tag_options(posts: list[Post]) -> list[str]:
    tags: dict[str, str] = {}
    for post in sort_by_date(posts):
        tags.setdefault(post.tag.casefold(), post.tag)
    return list(tags.values())


def parse_bvid(value: str) -> str:
    match = re.search(r"BV[0-9A-Za-z]+", value)
    if not match:
        raise ValueError(f"Video entry needs a Bilibili BV id or URL: {value}")
    return match.group(0)


def split_markdown_table_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def normalize_article_key(value: str) -> str:
    return value.strip().replace("\\", "/").casefold()


def article_source_keys(source: Path) -> set[str]:
    relative = source.relative_to(ROOT).as_posix()
    return {
        normalize_article_key(relative),
        normalize_article_key(source.name),
        normalize_article_key(source.stem),
    }


def load_article_metadata() -> dict[str, dict[str, str]]:
    if not ARTICLE_SOURCE.exists():
        return {}

    rows = [
        line.strip()
        for line in ARTICLE_SOURCE.read_text(encoding="utf-8").splitlines()
        if line.strip().startswith("|") and line.strip().endswith("|")
    ]
    if len(rows) < 3:
        return {}

    headers = [header.strip().casefold() for header in split_markdown_table_row(rows[0])]
    aliases = {
        "file": {"file", "path", "source", "文章", "文件", "源文件"},
        "title": {"title", "标题", "標題"},
        "date": {"date", "published", "日期", "发布时间"},
        "tag": {"tag", "tags", "标签", "標籤"},
        "summary": {"summary", "摘要", "简介", "簡介"},
        "lead": {"lead", "导语", "導語"},
        "order": {"order", "顺序", "排序"},
        "slug": {"slug", "链接名"},
        "draft": {"draft", "草稿"},
    }

    def column(name: str) -> int | None:
        for index, header_name in enumerate(headers):
            if header_name in aliases[name]:
                return index
        return None

    file_column = column("file")
    if file_column is None:
        raise ValueError(f"{ARTICLE_SOURCE.relative_to(ROOT)} needs a file column")

    columns = {
        name: column(name)
        for name in ("title", "date", "tag", "summary", "lead", "order", "slug", "draft")
    }
    metadata_by_key: dict[str, dict[str, str]] = {}
    for raw_row in rows[2:]:
        cells = split_markdown_table_row(raw_row)
        if file_column >= len(cells) or not cells[file_column].strip():
            continue
        file_value = cells[file_column].strip()
        metadata: dict[str, str] = {}
        for name, index in columns.items():
            if index is not None and index < len(cells) and cells[index].strip():
                metadata[name] = cells[index].strip()
        keys = {
            normalize_article_key(file_value),
            normalize_article_key(Path(file_value).name),
            normalize_article_key(Path(file_value).stem),
        }
        for key in keys:
            existing = metadata_by_key.get(key)
            if existing is not None and existing != metadata:
                raise ValueError(f"Duplicate article metadata key in {ARTICLE_SOURCE.name}: {file_value}")
            metadata_by_key[key] = metadata
    return metadata_by_key


def load_videos() -> list[Video]:
    if not VIDEO_SOURCE.exists():
        return []
    rows = [
        line.strip()
        for line in VIDEO_SOURCE.read_text(encoding="utf-8").splitlines()
        if line.strip().startswith("|") and line.strip().endswith("|")
    ]
    if len(rows) < 3:
        return []

    headers = [header.strip().lower() for header in split_markdown_table_row(rows[0])]
    aliases = {
        "bvid": {"bvid", "bv", "url", "link", "链接", "视频链接"},
        "title": {"title", "标题"},
        "summary": {"summary", "简介", "描述"},
        "featured": {"featured", "home", "首页", "首页展示"},
    }

    def column(name: str) -> int | None:
        for index, header_name in enumerate(headers):
            if header_name in aliases[name]:
                return index
        return None

    bvid_column = column("bvid")
    if bvid_column is None:
        raise ValueError(f"{VIDEO_SOURCE.relative_to(ROOT)} needs a bvid column")
    title_column = column("title")
    summary_column = column("summary")
    featured_column = column("featured")

    videos: list[Video] = []
    for raw_row in rows[2:]:
        cells = split_markdown_table_row(raw_row)
        if bvid_column >= len(cells) or not cells[bvid_column].strip():
            continue
        bvid = parse_bvid(cells[bvid_column])
        title = (
            cells[title_column].strip()
            if title_column is not None and title_column < len(cells) and cells[title_column].strip()
            else f"Bilibili Video {bvid}"
        )
        summary = (
            cells[summary_column].strip()
            if summary_column is not None
            and summary_column < len(cells)
            and cells[summary_column].strip()
            else "点击播放这个 Bilibili 视频。"
        )
        featured = (
            featured_column is not None
            and featured_column < len(cells)
            and cells[featured_column].strip().lower() in {"1", "true", "yes", "y", "home", "首页"}
        )
        videos.append(Video(bvid=bvid, title=title, summary=summary, featured=featured))
    return videos


def load_posts(image_cache: ImageCache) -> list[Post]:
    posts: list[Post] = []
    seen_slugs: set[str] = set()
    article_metadata = load_article_metadata()
    sources = [
        source
        for source_dir in SOURCE_DIRS
        if source_dir.exists()
        for source in source_dir.glob("*.md")
    ]
    for source in sorted(sources):
        if source.name.startswith("_"):
            continue
        front_matter, markdown = parse_front_matter(source.read_text(encoding="utf-8"))
        metadata = dict(front_matter)
        for key in article_source_keys(source):
            if key in article_metadata:
                metadata.update(article_metadata[key])
                break
        if metadata.get("draft", "").lower() in {"1", "true", "yes"}:
            continue
        title = metadata.get("title", "").strip() or first_heading(markdown)
        if not title:
            raise ValueError(f"{source.name} needs a title in front matter or a first-level heading")
        markdown = remove_leading_title(markdown, title)
        slug = slugify(metadata.get("slug", "") or source.stem)
        if slug in seen_slugs:
            raise ValueError(f"Duplicate article slug: {slug}")
        seen_slugs.add(slug)
        published = metadata.get("date", date.fromtimestamp(source.stat().st_mtime).isoformat())
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", published):
            raise ValueError(f"{source.name} has an invalid date: {published}")
        summary = metadata.get("summary") or metadata.get("lead") or first_paragraph(markdown)
        lead = metadata.get("lead", "")
        tag = (metadata.get("tag", "NOTE").strip() or "NOTE")
        posts.append(
            Post(
                source=source,
                slug=slug,
                title=title,
                published=published,
                tag=tag,
                order=parse_order(metadata, source),
                summary=summary,
                lead=lead,
                body=render_markdown(markdown, image_cache, source),
                read_minutes=estimate_read_minutes(markdown),
            )
        )
    return sort_by_date(posts)


def header(prefix: str, description: str, title: str) -> str:
    return f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="{html.escape(description)}"><title>{html.escape(title)} | 楽園（Elysium）</title><link rel="stylesheet" href="{prefix}styles.css?v={STYLE_VERSION}">
    <script src="{prefix}site.js?v={STYLE_VERSION}" defer></script>
  </head>
  <body>
    <header class="site-header"><nav class="nav site-shell" aria-label="主导航"><a class="brand" href="{prefix}index.html"><span class="brand-mark">E</span>楽園 <span class="brand-sub">// ELYSIUM</span></a><div class="nav-links"><a href="{prefix}articles.html" aria-current="page">NOTE</a><a href="{prefix}videos.html">VEDIO</a><a href="https://github.com/Pudding-Evan" rel="noopener">GITHUB</a></div></nav></header>"""


def footer(prefix: str) -> str:
    return f"""    <footer class="site-footer"><div class="footer-inner site-shell"><span>© 2026 楽園 // ELYSIUM</span><div class="footer-links"><a href="{prefix}articles.html">NOTE</a><a href="{prefix}videos.html">VEDIO</a><a href="https://github.com/Pudding-Evan" rel="noopener">GITHUB</a></div></div></footer>
  </body>
</html>
"""


def article_page(post: Post) -> str:
    lead = f'\n      <p class="article-lead">{html.escape(post.lead)}</p>' if post.lead else ""
    tag_value = html.escape(tag_filter_value(post.tag))
    return f"""{header("../", post.summary, post.title)}
    <main class="article site-shell">
      <a class="text-link article-back" href="../articles.html">BACK TO ARTICLES</a>
      <div class="meta"><a class="meta-tag" href="../articles.html?tag={tag_value}">{html.escape(post.tag)}</a><span>{post.display_date}</span><span>{post.read_minutes} MIN READ</span></div>
      <h1>{html.escape(post.title)}</h1>{lead}
      {post.body}
    </main>
{footer("../")}"""


def replace_generated_area(page: Path, start: str, end: str, generated: str) -> None:
    text = page.read_text(encoding="utf-8")
    pattern = re.compile(rf"{re.escape(start)}.*?{re.escape(end)}", re.DOTALL)
    replacement = f"{start}\n{generated}\n            {end}"
    if not pattern.search(text):
        raise ValueError(f"Missing generated content markers in {page.name}")
    page.write_text(pattern.sub(replacement, text), encoding="utf-8")


def home_rows(posts: list[Post]) -> str:
    books = ["book_1_trim.png", "book_2_trim.png", "book_3_trim.png"]
    book_classes = ["book-spine-red", "book-spine-blue", "book-spine-green"]
    rows = []
    for index, post in enumerate(posts[:5]):
        book_index = index % len(books)
        rows.append(
            f'            <a class="book-spine {book_classes[book_index]}" '
            f'href="posts/{post.slug}.html"><img src="assets/{books[book_index]}" alt="">'
            f'<time class="book-date" datetime="{post.published}">{post.display_date}</time>'
            f"<h3>{html.escape(post.title)}</h3></a>"
        )
    return "\n".join(rows)


def archive_rows(posts: list[Post]) -> str:
    tags = tag_options(posts)
    tag_links = [
        '<a href="articles.html" data-tag-filter="all" aria-pressed="true">All</a>'
    ]
    for tag in tags:
        tag_links.append(
            f'<a href="articles.html?tag={html.escape(tag_filter_value(tag))}" '
            f'data-tag-filter="{html.escape(tag_filter_value(tag))}" aria-pressed="false">'
            f"{html.escape(tag)}</a>"
        )
    rows = []
    for post in sort_by_date(posts):
        rows.append(
            f'          <a class="note-row" data-tag="{html.escape(tag_filter_value(post.tag))}" '
            f'href="posts/{post.slug}.html">'
            f'<time class="archive-date" datetime="{post.published}">{post.display_date}</time>'
            f"<div><h2>{html.escape(post.title)}</h2></div></a>"
        )
    tag_links_html = "\n          ".join(tag_links)
    rows_html = "\n".join(rows)
    return (
        '        <nav class="tag-filter" aria-label="按 Tag 筛选文章">\n'
        f"          {tag_links_html}\n"
        "        </nav>\n"
        '        <div class="note-list">\n'
        f"{rows_html}\n"
        "        </div>\n"
        '        <p class="archive-empty" data-archive-empty hidden>这个 Tag 下面还没有文章。</p>'
    )


def video_card(video: Video, indent: str = "        ") -> str:
    return (
        f'{indent}<article class="switch-player" id="{html.escape(video.element_id)}">\n'
        f'{indent}  <div class="switch-player-body"><div class="switch-player-copy">'
        f"<h3>{html.escape(video.title)}</h3></div>"
        f'<div class="switch-screen"><iframe src="{video.embed_url}" title="{html.escape(video.title)}" '
        'allow="autoplay; fullscreen; picture-in-picture" '
        'referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div></div>\n'
        f"{indent}</article>"
    )


def home_video_rows(videos: list[Video]) -> str:
    if not videos:
        return '            <p class="empty-state">暂时还没有视频。</p>'
    featured = [video for video in videos if video.featured]
    return "\n".join(video_card(video, "            ") for video in (featured or videos)[:2])


def videos_page(videos: list[Video]) -> str:
    body = "\n".join(video_card(video) for video in videos)
    if not body:
        body = '        <p class="empty-state">暂时还没有视频。</p>'
    return f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="楽園（Elysium）的 Vedio 内容。"><title>Vedio | 楽園（Elysium）</title><link rel="stylesheet" href="styles.css?v={STYLE_VERSION}"><script src="site.js?v={STYLE_VERSION}" defer></script>
  </head>
  <body>
    <header class="site-header"><nav class="nav site-shell" aria-label="主导航"><a class="brand" href="index.html"><span class="brand-mark">E</span>楽園 <span class="brand-sub">// ELYSIUM</span></a><div class="nav-links"><a href="articles.html">NOTE</a><a href="videos.html" aria-current="page">VEDIO</a><a href="https://github.com/Pudding-Evan" rel="noopener">GITHUB</a></div></nav></header>
    <main class="site-shell">
      <section class="page-intro"><p class="eyebrow">02 / Vedio</p><h1 class="pixel-title">Vedio</h1><p>视频托管在 Bilibili，并直接嵌入本站播放。以后只需要维护 <code>content/videos.md</code> 里的 BV 号、标题和简介。</p></section>
      <section class="switch-player-list archive-list" aria-label="视频列表">
{body}
      </section>
    </main>
    <footer class="site-footer"><div class="footer-inner site-shell"><span>© 2026 楽園 // ELYSIUM</span><div class="footer-links"><a href="articles.html">NOTE</a><a href="videos.html">VEDIO</a><a href="https://github.com/Pudding-Evan" rel="noopener">GITHUB</a></div></div></footer>
  </body>
</html>
"""


def update_static_asset_versions(*pages: Path) -> None:
    for page in pages:
        if not page.exists():
            continue
        text = page.read_text(encoding="utf-8")
        text = re.sub(r'((?:styles|site)\.(?:css|js)\?v=)\d+', rf'\g<1>{STYLE_VERSION}', text)
        page.write_text(text, encoding="utf-8")

def write_posts(posts: list[Post]) -> None:
    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    old_generated: set[str] = set()
    if POST_MANIFEST.exists():
        old_generated = set(json.loads(POST_MANIFEST.read_text(encoding="utf-8"))["posts"])
    current_generated = {f"{post.slug}.html" for post in posts}
    for stale_name in old_generated - current_generated:
        stale_path = POSTS_DIR / stale_name
        if stale_path.is_file():
            stale_path.unlink()
    for post in posts:
        (POSTS_DIR / f"{post.slug}.html").write_text(article_page(post), encoding="utf-8")
    POST_MANIFEST.write_text(
        json.dumps({"posts": sorted(current_generated)}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_videos(videos: list[Video]) -> None:
    (ROOT / "videos.html").write_text(videos_page(videos), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--refresh-images",
        action="store_true",
        help="Download remote article images again instead of reusing cached copies.",
    )
    args = parser.parse_args()
    image_cache = ImageCache(refresh_remote=args.refresh_images)
    posts = load_posts(image_cache)
    videos = load_videos()
    home_posts = sort_by_order(posts_with_tag(posts, HOME_POST_TAG))
    write_posts(posts)
    write_videos(videos)
    replace_generated_area(ROOT / "index.html", HOME_START, HOME_END, home_rows(home_posts))
    replace_generated_area(
        ROOT / "index.html",
        HOME_VIDEOS_START,
        HOME_VIDEOS_END,
        home_video_rows(videos),
    )
    replace_generated_area(ROOT / "articles.html", ARCHIVE_START, ARCHIVE_END, archive_rows(posts))
    update_static_asset_versions(ROOT / "index.html", ROOT / "articles.html", ROOT / "404.html")
    image_cache.save()
    print(f"Built {len(posts)} article(s) and {len(videos)} video(s).")


if __name__ == "__main__":
    main()
