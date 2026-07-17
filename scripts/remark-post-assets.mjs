import path from "node:path";

const root = process.cwd().replace(/\\/g, "/");
const relativeAssetPattern = /^(?![a-z][a-z0-9+.-]*:|\/|#)(?!\.\.\/)(?:\.\/)?(.+)/i;
const htmlSrcPattern = /\bsrc=(['"])(\.\/(?!\.\.\/)[^'"]+)\1/g;

function articleAssetPrefix(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const relative = path.posix.relative(root, normalized);
  const parts = relative.split("/");
  const postsIndex = parts.indexOf("posts");

  if (postsIndex === -1 || parts.length < postsIndex + 4) return "";

  return parts[postsIndex + 2] || "";
}

function rewriteRelativeAssetUrl(url, prefix) {
  if (!prefix) return url;

  const match = url.match(relativeAssetPattern);
  if (!match) return url;

  const cleanUrl = match[1];
  if (cleanUrl.startsWith(`${prefix}/`)) return url;

  return `./${prefix}/${cleanUrl}`;
}

function visit(node, callback) {
  if (!node || typeof node !== "object") return;
  callback(node);

  if (!Array.isArray(node.children)) return;
  for (const child of node.children) visit(child, callback);
}

export default function remarkPostAssets() {
  return (tree, file) => {
    const sourcePath = file.history?.[0] || file.path || "";
    const prefix = articleAssetPrefix(sourcePath);
    if (!prefix) return;

    visit(tree, (node) => {
      if (node.type === "link" && typeof node.url === "string") {
        node.url = rewriteRelativeAssetUrl(node.url, prefix);
      }

      if (node.type === "html" && typeof node.value === "string") {
        node.value = node.value.replace(htmlSrcPattern, (_whole, quote, src) => {
          return `src=${quote}${rewriteRelativeAssetUrl(src, prefix)}${quote}`;
        });
      }
    });
  };
}
