#!/usr/bin/env node

import { printSearchHelp, searchEvidence } from "./search-command.js";

function printHelp(): void {
  console.log(`neuroarxiv — academic prior art for one open build decision

USAGE
  neuroarxiv search "<problem>" --categories A,B --terms "term one,term two"

COMMANDS
  search     collect bounded, normalized arXiv Research Evidence

Install the Skill with the standard skills CLI documented in README.md.
Run neuroarxiv search --help for Search Plan flags.
`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
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
