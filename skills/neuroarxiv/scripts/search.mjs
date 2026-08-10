#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const candidates = [
  new URL("../runtime/search-cli.js", import.meta.url),
  new URL("../../../dist/search-cli.js", import.meta.url),
];
const cli = candidates.map(fileURLToPath).find(existsSync);

if (!cli) {
  process.stderr.write(
    "NeuroArxiv deterministic runtime is missing. Build the package or reinstall the complete Skill bundle.\n",
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
