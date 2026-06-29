import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const postsDir = path.join(root, "posts");
const articleIndex = path.join(root, "content", "articles.md");
const columns = ["file", "date", "tags", "summary", "order"];

function toPosix(value) {
  return value.replace(/\\/g, "/");
}

function normalizeKey(value) {
  return toPosix(value).trim().toLowerCase();
}

function markdownStem(file) {
  return path.posix.basename(toPosix(file)).replace(/\.md$/i, "");
}

function splitMarkdownTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").trim();
}

function parseListValue(value) {
  if (Array.isArray(value)) return value.flatMap((item) => parseListValue(item));
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  const inlineList = trimmed.match(/^\[(.*)\]$/)?.[1] ?? trimmed;
  return inlineList
    .split(/[,，|/]+/)
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function stringifyValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

async function readExistingIndex() {
  try {
    const content = await readFile(articleIndex, "utf-8");
    const rows = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|") && line.endsWith("|"));

    if (rows.length < 3) return [];

    const headers = splitMarkdownTableRow(rows[0]).map((header) => header.toLowerCase());
    return rows.slice(2).map((row, index) => {
      const cells = splitMarkdownTableRow(row);
      const data = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]));
      return {
        file: data.file || data.path || data.source || "",
        date: data.date || "",
        tags: data.tags || data.tag || "",
        summary: data.summary || "",
        order: data.order || data["顺序"] || "",
        index
      };
    });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};

  const result = {};
  let activeListKey = "";

  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (activeListKey && trimmed.startsWith("- ")) {
      result[activeListKey].push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ""));
      continue;
    }

    activeListKey = "";
    const separator = trimmed.indexOf(":");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (["date", "summary", "order"].includes(key)) {
      result[key] = value;
    }

    if (["tags", "tag"].includes(key)) {
      result.tags = rawValue ? parseListValue(rawValue) : [];
      activeListKey = rawValue ? "" : "tags";
    }
  }

  return result;
}

async function findMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith("_")) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findMarkdownFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function buildLookup(existingRows) {
  const byPath = new Map();
  const byTitle = new Map();

  for (const row of existingRows) {
    if (!row.file) continue;

    byPath.set(normalizeKey(row.file), row);
    byPath.set(normalizeKey(`posts/${row.file}`), row);

    const title = normalizeKey(markdownStem(row.file));
    if (!byTitle.has(title)) {
      byTitle.set(title, row);
    }
  }

  return { byPath, byTitle };
}

function rowValue(frontmatter, previous, key) {
  const value = key === "tags" ? frontmatter.tags : frontmatter[key];
  return stringifyValue(value ?? previous?.[key] ?? "");
}

async function main() {
  const existingRows = await readExistingIndex();
  const { byPath, byTitle } = buildLookup(existingRows);
  const markdownFiles = await findMarkdownFiles(postsDir);

  const rows = [];
  for (const file of markdownFiles) {
    const relativeToPosts = toPosix(path.relative(postsDir, file));
    const relativeToRoot = toPosix(path.relative(root, file));
    const title = markdownStem(relativeToPosts);
    const markdown = await readFile(file, "utf-8");
    const frontmatter = parseFrontmatter(markdown);
    const previous =
      byPath.get(normalizeKey(relativeToPosts)) ||
      byPath.get(normalizeKey(relativeToRoot)) ||
      byTitle.get(normalizeKey(title));

    rows.push({
      file: relativeToPosts,
      date: rowValue(frontmatter, previous, "date"),
      tags: rowValue(frontmatter, previous, "tags"),
      summary: rowValue(frontmatter, previous, "summary"),
      order: rowValue(frontmatter, previous, "order"),
      index: previous?.index ?? Number.POSITIVE_INFINITY
    });
  }

  rows.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return a.file.localeCompare(b.file, "zh-Hans-CN");
  });

  const lines = [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((column) => escapeCell(row[column])).join(" | ")} |`)
  ];

  await writeFile(articleIndex, `${lines.join("\n")}\n`, "utf-8");
  console.log(`Updated content/articles.md with ${rows.length} article${rows.length === 1 ? "" : "s"}.`);
}

await main();