import { getAllArticles } from "../lib/content";

export const prerender = true;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function GET({ site }: { site: URL }) {
  const items = getAllArticles()
    .map((post) => {
      const url = new URL(`posts/${post.slug}.html`, site).href;
      return `<item>
        <title>${escapeXml(post.title)}</title>
        <link>${url}</link>
        <guid>${url}</guid>
        <pubDate>${new Date(`${post.date}T00:00:00+08:00`).toUTCString()}</pubDate>
        <description>${escapeXml(post.summary)}</description>
        ${post.tags.map((tag) => `<category>${escapeXml(tag)}</category>`).join("")}
      </item>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Elysium</title>
    <link>${site.href}</link>
    <description>Evan 的 Unreal Engine、Gameplay 与游戏开发笔记。</description>
    <language>zh-CN</language>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" }
  });
}
