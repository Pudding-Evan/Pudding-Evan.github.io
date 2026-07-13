import { getAllArticles } from "../lib/content";

export const prerender = true;

export function GET({ site }: { site: URL }) {
  const pages = ["", "articles.html", "videos.html"];
  const urls = [
    ...pages.map((path) => new URL(path, site).href),
    ...getAllArticles().map((post) => new URL(`posts/${post.slug}.html`, site).href)
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls.map((url) => `<url><loc>${url}</loc></url>`).join("\n  ")}
</urlset>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" }
  });
}
