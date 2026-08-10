import { collectResearchEvidence } from "./research-run.js";
import type { ResearchEvidenceRequest, SearchCategory } from "./types.js";

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

function fail(message: string): never {
  throw new Error(message);
}

function boundedInteger(raw: string | undefined, flag: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${flag} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

function commaList(raw: string | undefined, flag: string): string[] {
  if (raw === undefined) fail(`${flag} requires a comma-separated value`);
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

export function printSearchHelp(): void {
  console.log(`neuroarxiv search — collect bounded arXiv Research Evidence

USAGE
  neuroarxiv search "<problem>" --categories A,B --terms "term one,term two"

FLAGS
  --categories A,B           caller-selected arXiv category ids
  --terms A,B                caller-selected mechanism terms
  --expand-terms A,B         one caller-selected bounded expansion
  --max-papers N             retained Paper budget (default 12)
  --papers-per-category N    requested per category (default 4)
  --since-years N            submitted-date window (default 8, 0 = no filter)
  --json                     emit Research Evidence as JSON
  -h, --help
`);
}

function parseSearch(argv: string[]): SearchFlags | null {
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
        flags.categories = commaList(argv[++i], "--categories").map((id) => ({
          id,
          why: "caller-selected",
        }));
        break;
      case "--terms":
        flags.terms = commaList(argv[++i], "--terms");
        break;
      case "--expand-terms":
        flags.expansionTerms = commaList(argv[++i], "--expand-terms");
        break;
      case "--max-papers":
        flags.maxPapers = boundedInteger(argv[++i], "--max-papers", 1, 100);
        break;
      case "--papers-per-category":
        flags.papersPerCategory = boundedInteger(
          argv[++i],
          "--papers-per-category",
          1,
          25,
        );
        break;
      case "--since-years":
        flags.sinceYears = boundedInteger(argv[++i], "--since-years", 0, 100);
        break;
      case "--json":
        flags.json = true;
        break;
      case "-h":
      case "--help":
        printSearchHelp();
        return null;
      default:
        if (arg.startsWith("--")) fail(`unknown search flag: ${arg}`);
        problem.push(arg);
    }
  }
  flags.problem = problem.join(" ").trim();
  if (!flags.problem || flags.categories.length === 0 || flags.terms.length === 0) {
    fail("search requires a problem, --categories, and --terms from a caller-authored Search Plan");
  }
  return flags;
}

export async function searchEvidence(argv: string[]): Promise<void> {
  const flags = parseSearch(argv);
  if (!flags) return;
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
