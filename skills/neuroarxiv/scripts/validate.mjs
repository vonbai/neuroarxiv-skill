#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { validateResearchRun } from "../runtime/research-run.js";

const input = process.argv[2];
if (input === "-h" || input === "--help") {
  process.stdout.write("Usage: node scripts/validate.mjs <research-run.json>\n");
  process.exit(0);
}
if (!input) {
  process.stderr.write("validate requires one Research Run JSON file\n");
  process.exit(1);
}

try {
  const artifact = JSON.parse(readFileSync(input, "utf8"));
  const validation = validateResearchRun(artifact);
  process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
  process.exit(validation.valid ? 0 : 1);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
