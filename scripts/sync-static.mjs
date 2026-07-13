import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");

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
