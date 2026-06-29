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
  tags: string[];
  month: string;
  monthLabel: string;
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

const postModules = import.meta.glob("../../posts/**/*.md", {
  eager: true
}) as Record<string, MarkdownModule>;

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
  const category = parts[0] || "Note";
  const fileStem = path.posix.basename(sourceName).replace(/\.md$/i, "");

  return {
    category,
    fileStem,
    sourceName
  };
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

function displayMonth(value: string): string {
  return value.replace("-", ".");
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return "";
}

function listValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => listValue(item));
  }

  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  const inlineList = trimmed.match(/^\[(.*)\]$/)?.[1] ?? trimmed;
  return inlineList
    .split(/[,，|/]+/)
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
  }

  return unique;
}

function fallbackTags(sourceName: string, category: string): string[] {
  const parts = sourceName.split("/").filter(Boolean);
  if (/^\d{4}-\d{2}$/.test(parts[0] ?? "")) return ["Note"];
  return [category || "Note"];
}

function dateValue(value: unknown): string {
  if (typeof value === "string") return value.trim().slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);

  if (value && typeof value === "object") {
    const iso = (value as { toISOString?: () => string }).toISOString;
    if (typeof iso === "function") {
      try {
        return iso.call(value).slice(0, 10);
      } catch {
        // Fall through to string parsing.
      }
    }
  }

  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function normalizeDate(value: string): string {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "2026-01-01";
}

function monthFromDate(date: string): string {
  return date.match(/^\d{4}-\d{2}/)?.[0] ?? "2026-01";
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
      const title = textValue(frontmatter.title) || fileStem;
      const date = normalizeDate(dateValue(frontmatter.date) || row.date || "2026-01-01");
      const frontmatterTags = uniqueValues([...listValue(frontmatter.tags), ...listValue(frontmatter.tag)]);
      const rowTags = uniqueValues([...listValue(row.tags), ...listValue(row.tag)]);
      const tags = uniqueValues([
        ...(frontmatterTags.length ? frontmatterTags : rowTags),
        ...(!frontmatterTags.length && !rowTags.length ? fallbackTags(sourceName, category) : [])
      ]);
      const tag = tags[0] || "Note";
      const month = monthFromDate(date);
      const summary = textValue(frontmatter.summary) || row.summary || firstParagraph(raw);
      const orderValue = textValue(frontmatter.order) || row["顺序"] || row.order;
      const order = /^\d+$/.test(orderValue) ? Number(orderValue) : undefined;
      const headings = (mod.getHeadings?.() ?? []).filter((heading) => heading.depth >= 2 && heading.depth <= 3);
      const slug = `${slugify(month)}/${slugify(textValue(frontmatter.slug) || fileStem)}`;

      return {
        slug,
        sourceName,
        title,
        date,
        tag,
        tags,
        month,
        monthLabel: displayMonth(month),
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

export function getHomeArticles(tag = "Note"): Article[] {
  const normalizedTag = tag.toLowerCase();
  return sortByDate(getAllArticles().filter((post) => post.tags.some((item) => item.toLowerCase() === normalizedTag)));
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

export { displayDate, displayMonth };