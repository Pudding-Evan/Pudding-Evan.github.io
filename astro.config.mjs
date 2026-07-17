import { defineConfig } from "astro/config";
import remarkPostAssets from "./scripts/remark-post-assets.mjs";

export default defineConfig({
  site: "https://pudding-evan.github.io",
  build: {
    format: "file"
  },
  markdown: {
    remarkPlugins: [remarkPostAssets]
  }
});
