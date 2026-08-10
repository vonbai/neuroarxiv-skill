#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { printSearchHelp, searchEvidence } from "./search-command.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_FILES = [
  "arxiv.js",
  "research-run.js",
  "search-command.js",
  "search-cli.js",
];

function installSkill(argv: string[]): void {
  const source = join(PACKAGE_ROOT, "skills", "neuroarxiv");
  const runtime = join(PACKAGE_ROOT, "dist");
  if (!existsSync(join(source, "SKILL.md"))) {
    throw new Error(`bundled Skill not found at ${source}`);
  }
  for (const file of RUNTIME_FILES) {
    if (!existsSync(join(runtime, file))) {
      throw new Error("deterministic runtime is incomplete; run npm run build before installing");
    }
  }

  const destinationIndex = argv.indexOf("--destination");
  const targetDir =
    destinationIndex >= 0
      ? argv[destinationIndex + 1]
      : join(homedir(), ".claude", "skills", "neuroarxiv");
  if (!targetDir) throw new Error("--destination requires an explicit Skill directory");

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  cpSync(source, targetDir, { recursive: true });
  const runtimeTarget = join(targetDir, "runtime");
  mkdirSync(runtimeTarget, { recursive: true });
  writeFileSync(join(runtimeTarget, "package.json"), '{"type":"module","private":true}\n');
  for (const file of RUNTIME_FILES) {
    copyFileSync(join(runtime, file), join(runtimeTarget, file));
  }

  console.log(`✓ Installed the complete neuroarxiv Skill to ${targetDir}`);
  console.log("  Start a new Agent session and invoke neuroarxiv with one Build Problem.");
}

function printHelp(): void {
  console.log(`neuroarxiv — academic prior art for one open build decision

USAGE
  neuroarxiv install [--destination PATH]
  neuroarxiv search "<problem>" --categories A,B --terms "term one,term two"

COMMANDS
  install    install the complete Skill bundle (default: ~/.claude/skills/neuroarxiv)
  search     collect bounded, normalized arXiv Research Evidence

Run neuroarxiv search --help for Search Plan flags.
`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "install") {
    installSkill(process.argv.slice(3));
    return;
  }
  if (command === "search") {
    await searchEvidence(process.argv.slice(3));
    return;
  }
  if (command === "-h" || command === "--help" || command === undefined) {
    printHelp();
    return;
  }
  if (command === "search-help") {
    printSearchHelp();
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
