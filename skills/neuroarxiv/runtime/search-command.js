import { randomUUID } from "node:crypto";
import { access, open, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
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
function pathFlag(raw, flag) {
    if (!raw?.trim())
        fail(`${flag} requires a fresh file path`);
    return raw;
}
function isNodeError(error, code) {
    return error instanceof Error && "code" in error && error.code === code;
}
async function exists(path) {
    try {
        await access(path);
        return true;
    }
    catch (error) {
        if (isNodeError(error, "ENOENT"))
            return false;
        throw error;
    }
}
async function removeIfPresent(path) {
    try {
        await unlink(path);
    }
    catch (error) {
        if (!isNodeError(error, "ENOENT"))
            throw error;
    }
}
async function reserveEvidenceArtifact(requestedPath) {
    const path = resolve(requestedPath);
    const pendingPath = `${path}.pending`;
    let claim;
    try {
        claim = await open(pendingPath, "wx", 0o600);
    }
    catch (error) {
        if (isNodeError(error, "EEXIST")) {
            fail(`Research Evidence artifact is already owned: ${path}. Resume the original process; only remove ${pendingPath} after confirming that process exited.`);
        }
        throw error;
    }
    try {
        try {
            await claim.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
            await claim.sync();
        }
        finally {
            await claim.close();
        }
    }
    catch (error) {
        await removeIfPresent(pendingPath);
        throw error;
    }
    if (await exists(path)) {
        await removeIfPresent(pendingPath);
        fail(`Research Evidence artifact already exists: ${path}. Choose a fresh path for a new Research Run.`);
    }
    return {
        path,
        async publish(result) {
            const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
            const artifact = await open(temporaryPath, "wx", 0o600);
            try {
                try {
                    await artifact.writeFile(`${JSON.stringify(result, null, 2)}\n`);
                    await artifact.sync();
                }
                finally {
                    await artifact.close();
                }
                if (await exists(path)) {
                    fail(`Research Evidence artifact appeared while this Research Run was active: ${path}`);
                }
                await rename(temporaryPath, path);
            }
            catch (error) {
                await removeIfPresent(temporaryPath);
                throw error;
            }
        },
        async release() {
            await removeIfPresent(pendingPath);
        },
    };
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
  --json                     emit Research Evidence as JSON on stdout
  --output FILE              atomically publish JSON instead to one fresh Evidence Artifact
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
            case "--output":
                flags.output = pathFlag(argv[++i], "--output");
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
export function createSearchCommand(overrides = {}) {
    const dependencies = {
        collect: collectResearchEvidence,
        stderr: (message) => process.stderr.write(message),
        stdout: (message) => process.stdout.write(message),
        ...overrides,
    };
    return async function runSearch(argv) {
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
        const artifact = flags.output ? await reserveEvidenceArtifact(flags.output) : undefined;
        try {
            dependencies.stderr(artifact
                ? `[neuroarxiv] Collecting Research Evidence into ${artifact.path}; wait for this process to exit before reading or retrying.\n`
                : "[neuroarxiv] Collecting Research Evidence; wait for this process to exit. Empty stdout means the process is still running.\n");
            const result = await dependencies.collect(request);
            if (artifact) {
                await artifact.publish(result);
                dependencies.stderr(`[neuroarxiv] Research Evidence ready: ${artifact.path}\n`);
                return;
            }
            if (flags.json) {
                dependencies.stdout(`${JSON.stringify(result, null, 2)}\n`);
                return;
            }
            dependencies.stdout([
                `Research Evidence: ${result.coverage.status}`,
                result.coverage.reason,
                ...result.papers.map((paper) => `- [${paper.version}] ${paper.title} — ${paper.absUrl}`),
            ].join("\n") + "\n");
        }
        finally {
            await artifact?.release();
        }
    };
}
export const searchEvidence = createSearchCommand();
