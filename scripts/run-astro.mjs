import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const command = process.argv[2] ?? "dev";
const root = process.cwd();
const astroBinCandidates = [
  path.join(root, "node_modules", "astro", "bin", "astro.mjs"),
  path.join(root, "node_modules", "astro", "astro.js")
];
const astroBin = astroBinCandidates.find((candidate) => existsSync(candidate));

if (!astroBin) {
  throw new Error("Cannot find the Astro CLI entrypoint. Run npm install first.");
}

const child = spawn(process.execPath, [astroBin, command, ...process.argv.slice(3)], {
  cwd: root,
  env: {
    ...process.env,
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
