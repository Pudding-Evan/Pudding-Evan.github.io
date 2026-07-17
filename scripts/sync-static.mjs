import { copyFile, cp, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");
const postsDir = path.join(root, "posts");

async function copyPostAssets(sourceDir, targetDir) {
  if (!existsSync(sourceDir)) return;

  await rm(targetDir, { recursive: true, force: true });

  async function copyEntries(currentSource, currentTarget) {
    const entries = await readdir(currentSource, { withFileTypes: true });

    for (const entry of entries) {
      const source = path.join(currentSource, entry.name);
      const target = path.join(currentTarget, entry.name);

      if (entry.isDirectory()) {
        await copyEntries(source, target);
        continue;
      }

      if (!entry.isFile() || entry.name.toLowerCase().endsWith(".md")) continue;

      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }
  }

  await copyEntries(sourceDir, targetDir);
}

await mkdir(publicDir, { recursive: true });

const copies = [
  ["assets", "assets"],
  ["styles.css", "styles.css"],
  ["interface.css", "interface.css"],
  ["site.js", "site.js"],
  ["sw.js", "sw.js"],
  ["favicon.svg", "favicon.svg"],
  [".nojekyll", ".nojekyll"]
];

for (const [from, to] of copies) {
  const source = path.join(root, from);
  if (!existsSync(source)) continue;

  const target = path.join(publicDir, to);
  await rm(target, { recursive: true, force: true });
  if (from.includes(".")) {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  } else {
    await cp(source, target, { recursive: true, force: true });
  }
}

await copyPostAssets(postsDir, path.join(publicDir, "posts"));
