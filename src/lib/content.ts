import fs from "node:fs";
import path from "node:path";

type MarkdownModule = {
  frontmatter?: Record<string, unknown>;
  Content: AstroComponentFactory;
  rawContent?: () => string;
  getHeadings?: () => MarkdownHeading[];
};

export type MarkdownHeading = {
  depth: number;
  slug: string;
  text: string;
};

export type Article = {
  slug: string;
  sourceName: string;
  title: string;
  date: string;
  tag: string;
  summary: string;
  order?: number;
  readMinutes: number;
  headings: MarkdownHeading[];
  Content: AstroComponentFactory;
};

export type Video = {
  bvid: string;
  title: string;
  summary: string;
  featured: boolean;
  elementId: string;
  embedUrl: string;
};

const root = process.cwd();
const articleSource = path.join(root, "content", "articles.md");
const videoSource = path.join(root, "content", "videos.md");

const postModules = import.meta.glob("../../posts/*/*/*.md", {
  eager: true
}) as Record<string, MarkdownModule>;

const categoryLabels: Record<string, string> = {
  dev: "Dev",
  gameplay: "Gameplay",
  gas: "GAS",
  net: "Net"
};

function splitMarkdownTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function parseMarkdownTable(file: string): Record<string, string>[] {
  if (!fs.existsSync(file)) return [];

  const rows = fs
    .readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));

  if (rows.length < 3) return [];

  const headers = splitMarkdownTableRow(rows[0]).map((header) => header.toLowerCase());
  return rows.slice(2).map((row) => {
    const cells = splitMarkdownTableRow(row);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}

function articleMetadata(): Map<string, Record<string, string>> {
  const metadata = new Map<string, Record<string, string>>();

  for (const row of parseMarkdownTable(articleSource)) {
    const file = row.file || row.path || row.source;
    if (!file) continue;

    const normalized = normalizeKey(file);
    const base = normalizeKey(path.posix.basename(normalized));
    const stem = base.replace(/\.md$/i, "");
    metadata.set(normalized, row);
    metadata.set(normalizeKey(`posts/${normalized}`), row);
    metadata.set(base, row);
    metadata.set(stem, row);
  }

  return metadata;
}

function postSourceInfo(modulePath: string): {
  category: string;
  fileStem: string;
  sourceName: string;
} {
  const normalized = modulePath.replace(/\\/g, "/");
  const sourceName = normalized.replace(/^.*?posts\//, "");
  const parts = sourceName.split("/");
  const category = parts[0] || "Dev";
  const fileStem = path.posix.basename(sourceName).replace(/\.md$/i, "");

  return {
    category,
    fileStem,
    sourceName
  };
}

function categoryTag(category: string): string {
  return categoryLabels[category.toLowerCase()] ?? category;
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .replace(/[\\/]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/[<>:"|?*]+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "") || "post"
  );
}

function displayDate(value: string): string {
  return value.replaceAll("-", ".");
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstParagraph(markdown: string): string {
  for (const block of markdown.split(/\n\s*\n/)) {
    const text = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .join(" ")
      .trim();
    if (!text || /^#|^>|^```|^!\[|^[-*]\s+|^\d+\.\s+/.test(text)) continue;
    return text.replace(/[`*_]/g, "");
  }
  return "";
}

function estimateReadMinutes(markdown: string): number {
  const plain = markdown.replace(/[#>*_`[\]()]|https?:\/\/\S+/g, " ");
  const cjkCount = [...plain.matchAll(/[\u3400-\u9fff]/g)].length;
  const wordCount = [...plain.matchAll(/[A-Za-z0-9]+/g)].length;
  return Math.max(1, Math.round((cjkCount + wordCount) / 360));
}

function sortByDate(posts: Article[]): Article[] {
  return [...posts].sort((a, b) => `${b.date}-${b.slug}`.localeCompare(`${a.date}-${a.slug}`));
}

function sortByOrder(posts: Article[]): Article[] {
  const ordered = posts
    .filter((post) => post.order !== undefined)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.date.localeCompare(b.date));
  const unordered = sortByDate(posts.filter((post) => post.order === undefined));
  return [...ordered, ...unordered];
}

export function tagFilterValue(tag: string): string {
  return slugify(tag).toLowerCase();
}

export function getAllArticles(): Article[] {
  const metadata = articleMetadata();

  const posts = Object.entries(postModules)
    .map(([modulePath, mod]) => {
      const { category, fileStem, sourceName } = postSourceInfo(modulePath);
      const row =
        metadata.get(normalizeKey(`posts/${sourceName}`)) ||
        metadata.get(normalizeKey(sourceName)) ||
        metadata.get(normalizeKey(fileStem)) ||
        {};
      const frontmatter = mod.frontmatter ?? {};
      const raw = mod.rawContent?.() ?? "";
      const title = fileStem;
      const date = row.date || textValue(frontmatter.date) || "2026-01-01";
      const tag = categoryTag(category);
      const summary = row.summary || textValue(frontmatter.summary) || firstParagraph(raw);
      const orderValue = row["顺序"] || row.order || textValue(frontmatter.order);
      const order = /^\d+$/.test(orderValue) ? Number(orderValue) : undefined;
      const headings = (mod.getHeadings?.() ?? []).filter((heading) => heading.depth >= 2 && heading.depth <= 3);
      const slug = `${slugify(category)}/${slugify(textValue(frontmatter.slug) || fileStem)}`;

      return {
        slug,
        sourceName,
        title,
        date,
        tag,
        summary,
        order,
        readMinutes: estimateReadMinutes(raw),
        headings,
        Content: mod.Content
      };
    })
    .filter((post) => !post.sourceName.split("/").some((part) => part.startsWith("_")));

  return sortByDate(posts);
}

export function getHomeArticles(tag = "GAS"): Article[] {
  return sortByOrder(getAllArticles().filter((post) => post.tag.toLowerCase() === tag.toLowerCase()));
}

function parseBvid(value: string): string {
  return value.match(/BV[0-9A-Za-z]+/)?.[0] ?? value.trim();
}

export function getVideos(): Video[] {
  return parseMarkdownTable(videoSource)
    .map((row) => {
      const bvid = parseBvid(row.bvid || row.bv || row.url || row.link || "");
      if (!bvid) return null;
      const title = row.title || `Bilibili Video ${bvid}`;
      const summary = row.summary || "";
      const featured = /^(1|true|yes|y|home|首页)$/i.test(row.featured || "");
      const elementId = `video-${slugify(bvid).toLowerCase()}`;

      return {
        bvid,
        title,
        summary,
        featured,
        elementId,
        embedUrl: `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(
          bvid
        )}&p=1&poster=1&autoplay=0`
      };
    })
    .filter(Boolean) as Video[];
}

export function getFeaturedVideos(limit = 2): Video[] {
  const videos = getVideos();
  const featured = videos.filter((video) => video.featured);
  return (featured.length ? featured : videos).slice(0, limit);
}

export { displayDate };
