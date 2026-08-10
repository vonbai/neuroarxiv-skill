#!/usr/bin/env node
// CLI surface for neuroarxiv.
//
// Usage:
//   neuroarxiv "how should I cache LLM completions across requests?"
//   neuroarxiv "..." --categories cs.DB,cs.DC --papers 5 --json > result.json
//   neuroarxiv install    (drop the skill into ~/.claude/skills/neuroarxiv)

import { readFileSync, statSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./engine.js";
import { collectResearchEvidence } from "./research-run.js";
import { renderText } from "./render.js";
import type {
  ResearchEvidenceRequest,
  RunEvent,
  RunOptions,
  SearchCategory,
} from "./types.js";

// Package root is one level up from dist/cli.js (or src/cli.ts under tsx).
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function installSkill(): void {
  const source = join(PACKAGE_ROOT, "skills", "neuroarxiv", "SKILL.md");
  if (!existsSync(source)) {
    console.error(`Error: couldn't find the bundled SKILL.md at ${source}`);
    console.error("This usually means the package wasn't installed with its skills/ directory intact.");
    process.exit(1);
  }

  const targetDir = join(homedir(), ".claude", "skills", "neuroarxiv");
  const target = join(targetDir, "SKILL.md");
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, target);

  console.log(`✓ Installed the neuroarxiv skill to ${target}`);
  console.log(`  Restart Claude Code (or start a new session) and run /neuroarxiv "<problem>".`);
}

type Flags = {
  problem: string;
  context?: string;
  categories?: string[];
  papers?: number;
  concurrency?: number;
  sinceYears?: number;
  json: boolean;
  quiet: boolean;
  model?: string;
  criticModel?: string;
};

type SearchFlags = {
  problem: string;
  categories: SearchCategory[];
  terms: string[];
  expansionTerms: string[];
  maxPapers?: number;
  papersPerCategory?: number;
  sinceYears?: number;
  json: boolean;
};

function positiveInt(raw: string, flag: string, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
    console.error(`Error: ${flag} must be a positive integer, got "${raw}"`);
    process.exit(1);
  }
  if (n > max) {
    console.error(`Error: ${flag} must be at most ${max}, got ${n}`);
    process.exit(1);
  }
  return n;
}

function nonNegativeInt(raw: string, flag: string, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    console.error(`Error: ${flag} must be a non-negative integer, got "${raw}"`);
    process.exit(1);
  }
  if (n > max) {
    console.error(`Error: ${flag} must be at most ${max}, got ${n}`);
    process.exit(1);
  }
  return n;
}

function commaList(raw: string): string[] {
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function parseSearch(argv: string[]): SearchFlags {
  const flags: SearchFlags = {
    problem: "",
    categories: [],
    terms: [],
    expansionTerms: [],
    json: false,
  };
  const problem: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--categories":
        flags.categories = commaList(argv[++i]).map((id) => ({
          id,
          why: "caller-selected",
        }));
        break;
      case "--terms":
        flags.terms = commaList(argv[++i]);
        break;
      case "--expand-terms":
        flags.expansionTerms = commaList(argv[++i]);
        break;
      case "--max-papers":
        flags.maxPapers = positiveInt(argv[++i], "--max-papers", 100);
        break;
      case "--papers-per-category":
        flags.papersPerCategory = positiveInt(
          argv[++i],
          "--papers-per-category",
          25,
        );
        break;
      case "--since-years":
        flags.sinceYears = nonNegativeInt(argv[++i], "--since-years", 100);
        break;
      case "--json":
        flags.json = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        problem.push(arg);
    }
  }
  flags.problem = problem.join(" ").trim();
  if (!flags.problem || flags.categories.length === 0 || flags.terms.length === 0) {
    console.error(
      "Error: search requires a problem, --categories, and --terms from a caller-authored Search Plan",
    );
    process.exit(1);
  }
  return flags;
}

async function searchEvidence(argv: string[]): Promise<void> {
  const flags = parseSearch(argv);
  const request: ResearchEvidenceRequest = {
    problem: flags.problem,
    searchPlan: {
      categories: flags.categories,
      terms: flags.terms,
      expansionTerms: flags.expansionTerms,
      sinceYears: flags.sinceYears,
    },
    budget: {
      maxPapers: flags.maxPapers,
      papersPerCategory: flags.papersPerCategory,
    },
  };
  const result = await collectResearchEvidence(request);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `Research Evidence: ${result.coverage.status}`,
      result.coverage.reason,
      ...result.papers.map(
        (paper) => `- [${paper.version}] ${paper.title} — ${paper.absUrl}`,
      ),
    ].join("\n") + "\n",
  );
}

const MAX_CONTEXT_BYTES = 10 * 1024 * 1024; // 10 MB

function parse(argv: string[]): Flags {
  const f: Flags = { problem: "", json: false, quiet: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--categories": f.categories = argv[++i].split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--papers": f.papers = positiveInt(argv[++i], "--papers", 10); break;
      case "--concurrency": f.concurrency = positiveInt(argv[++i], "--concurrency", 16); break;
      case "--since-years": f.sinceYears = positiveInt(argv[++i], "--since-years", 100); break;
      case "--context": {
        const path = argv[++i];
        const { size } = statSync(path);
        if (size > MAX_CONTEXT_BYTES) {
          console.error(`Error: context file is ${(size / 1024 / 1024).toFixed(1)} MB (max 10 MB)`);
          process.exit(1);
        }
        f.context = readFileSync(path, "utf8");
        break;
      }
      case "--model": f.model = argv[++i]; break;
      case "--critic-model": f.criticModel = argv[++i]; break;
      case "--json": f.json = true; break;
      case "--quiet": f.quiet = true; break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        rest.push(a);
    }
  }
  f.problem = rest.join(" ").trim();
  return f;
}

function printHelp() {
  console.log(`neuroarxiv — a skill for coding agents

  Before you build something new, read the arXiv first. Fans out isolated
  reads across papers found category-wise via real arXiv search, scores and
  clusters them, then converges on ONE recommended path — cited, with a
  first step and known prior-art pitfalls to avoid — instead of a shortlist.

USAGE
  neuroarxiv install         drop the skill into ~/.claude/skills/neuroarxiv
  neuroarxiv search "<problem>" --categories A,B --terms "term one,term two"
  neuroarxiv "<problem>" [flags]

DETERMINISTIC SEARCH FLAGS
  --categories A,B           caller-selected arXiv category ids
  --terms A,B                caller-selected mechanism terms
  --expand-terms A,B         one caller-selected bounded expansion
  --max-papers N             retained Paper budget (default 12)
  --papers-per-category N    requested per category (default 4)
  --since-years N            submitted-date window (default 8, 0 = no filter)
  --json                     emit Research Evidence as JSON

FLAGS
  --categories A,B      pin arXiv category ids instead of auto-detecting
                         (e.g. cs.DB,cs.DC); skips the category-select pass
  --papers N             papers fetched per category (default 4)
  --concurrency N        max parallel LLM read calls (default 4)
  --since-years N        drop papers older than N years (default 8, 0 = no filter)
  --context PATH         file to inject as context (code, constraints, stack)
  --model NAME           override the SDK model (reader + synthesizer)
  --critic-model NAME    override the model for score + cluster passes only
  --json                 emit RunResult as JSON
  --quiet                suppress progress events
  -h, --help

EXAMPLES
  neuroarxiv "cache LLM completions across requests without staleness"
  neuroarxiv "leader election for a queue with flaky nodes" --papers 6
  neuroarxiv "..." --categories cs.DB,cs.DC --json > out.json
`);
}

async function main() {
  if (process.argv[2] === "install") {
    installSkill();
    return;
  }

  if (process.argv[2] === "search") {
    await searchEvidence(process.argv.slice(3));
    return;
  }

  const flags = parse(process.argv.slice(2));
  if (!flags.problem) { printHelp(); process.exit(1); }

  const onEvent = flags.quiet ? undefined : (e: RunEvent) => {
    switch (e.kind) {
      case "categories:done": process.stderr.write(`  ▸ categories: ${e.categories.join(", ")} | terms: ${e.terms.join(", ")}\n`); break;
      case "fetch:done":      process.stderr.write(`    ${e.count} papers (${e.category})\n`); break;
      case "read:start":      process.stderr.write(`  ◎ reading [${e.paperId}] ${e.title}\n`); break;
      case "score:done":      process.stderr.write(`  scored ${e.total} readings\n`); break;
      case "cluster:done":    process.stderr.write(`  ${e.clusters} clusters\n`); break;
      case "converge:done":   process.stderr.write(`  → path: ${e.chosen ?? "(none)"}\n`); break;
      case "warn":            process.stderr.write(`  ! ${e.message}\n`); break;
    }
  };

  const opts: RunOptions = {
    problem: flags.problem,
    context: flags.context,
    categories: flags.categories,
    papersPerCategory: flags.papers,
    concurrency: flags.concurrency,
    sinceYears: flags.sinceYears,
    model: flags.model,
    criticModel: flags.criticModel,
    onEvent,
  };

  const result = await run(opts);

  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(renderText(result) + "\n");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
