import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const command = process.argv[2] ?? "dev";
const root = process.cwd();
const astroBinCandidates = [
  path.join(root, "node_modules", "astro", "bin", "astro.mjs"),
  path.join(root, "node_modules", "astro", "astro.js")
];
const astroBin = astroBinCandidates.find((candidate) => existsSync(candidate));
const viteNetUseShim = path.join(root, "scripts", "vite-net-use-shim.mjs");
const nodeOptions = [
  process.env.NODE_OPTIONS,
  existsSync(viteNetUseShim) ? `--import=${pathToFileURL(viteNetUseShim).href}` : ""
]
  .filter(Boolean)
  .join(" ");

if (!astroBin) {
  throw new Error("Cannot find the Astro CLI entrypoint. Run npm install first.");
}

const child = spawn(process.execPath, [astroBin, command, ...process.argv.slice(3)], {
  cwd: root,
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    ASTRO_TELEMETRY_DISABLED: "1"
  },
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
