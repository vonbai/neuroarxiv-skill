import { collectResearchEvidence } from "./research-run.js";
function fail(message) {
    throw new Error(message);
}
function integerFlag(raw, flag) {
    const value = Number(raw);
    if (!Number.isInteger(value)) {
        fail(`${flag} must be an integer, got "${raw}"`);
    }
    return value;
}
function commaList(raw, flag) {
    if (raw === undefined)
        fail(`${flag} requires a comma-separated value`);
    return raw.split(",").map((value) => value.trim()).filter(Boolean);
}
function categoryList(raw) {
    return commaList(raw, "--categories").map((entry) => {
        const separator = entry.indexOf("=");
        const id = (separator === -1 ? entry : entry.slice(0, separator)).trim();
        const why = (separator === -1 ? "caller-selected" : entry.slice(separator + 1)).trim();
        return { id, why: why || "caller-selected" };
    });
}
export function printSearchHelp() {
    console.log(`neuroarxiv search — collect bounded arXiv Research Evidence

USAGE
  neuroarxiv search "<problem>" --categories A,B --terms "term one,term two"

FLAGS
  --categories A=reason,B=reason
                             caller-selected arXiv categories and reasons
  --terms A,B                caller-selected mechanism terms
  --expand-terms A,B         one caller-selected bounded expansion
  --max-papers N             retained Paper budget (default 12)
  --max-full-text-papers N   full-text reading budget (default 3)
  --papers-per-category N    requested per category (default 4)
  --since-years N            submitted-date window (default 8, 0 = no filter)
  --json                     emit Research Evidence as JSON
  -h, --help
`);
}
export function parseSearch(argv) {
    const flags = {
        problem: "",
        categories: [],
        terms: [],
        expansionTerms: [],
        json: false,
    };
    const problem = [];
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        switch (arg) {
            case "--categories":
                flags.categories = categoryList(argv[++i]);
                break;
            case "--terms":
                flags.terms = commaList(argv[++i], "--terms");
                break;
            case "--expand-terms":
                flags.expansionTerms = commaList(argv[++i], "--expand-terms");
                break;
            case "--max-papers":
                flags.maxPapers = integerFlag(argv[++i], "--max-papers");
                break;
            case "--max-full-text-papers":
                flags.maxFullTextPapers = integerFlag(argv[++i], "--max-full-text-papers");
                break;
            case "--papers-per-category":
                flags.papersPerCategory = integerFlag(argv[++i], "--papers-per-category");
                break;
            case "--since-years":
                flags.sinceYears = integerFlag(argv[++i], "--since-years");
                break;
            case "--json":
                flags.json = true;
                break;
            case "-h":
            case "--help":
                printSearchHelp();
                return null;
            default:
                if (arg.startsWith("--"))
                    fail(`unknown search flag: ${arg}`);
                problem.push(arg);
        }
    }
    flags.problem = problem.join(" ").trim();
    if (!flags.problem || flags.categories.length === 0 || flags.terms.length === 0) {
        fail("search requires a problem, --categories, and --terms from a caller-authored Search Plan");
    }
    return flags;
}
export async function searchEvidence(argv) {
    const flags = parseSearch(argv);
    if (!flags)
        return;
    const request = {
        problem: flags.problem,
        searchPlan: {
            categories: flags.categories,
            terms: flags.terms,
            ...(flags.expansionTerms.length > 0 ? { expansionTerms: flags.expansionTerms } : {}),
            sinceYears: flags.sinceYears,
        },
        budget: {
            maxPapers: flags.maxPapers,
            maxFullTextPapers: flags.maxFullTextPapers,
            papersPerCategory: flags.papersPerCategory,
        },
    };
    const result = await collectResearchEvidence(request);
    if (flags.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
    }
    process.stdout.write([
        `Research Evidence: ${result.coverage.status}`,
        result.coverage.reason,
        ...result.papers.map((paper) => `- [${paper.version}] ${paper.title} — ${paper.absUrl}`),
    ].join("\n") + "\n");
}
