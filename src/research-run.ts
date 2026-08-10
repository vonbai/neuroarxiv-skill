import { createArxivGateway, mergePaper, type ArxivGateway } from "./arxiv.js";
import { looksLikeCategoryId } from "./categories.js";
import type {
  Paper,
  ResearchBudget,
  ResearchEvidenceRequest,
  ResearchEvidenceResult,
  SearchAttempt,
  SearchCategory,
} from "./types.js";

const DEFAULT_BUDGET: Required<ResearchBudget> = {
  maxPapers: 12,
  papersPerCategory: 4,
  maxExpansions: 1,
};
const READY_PAPER_COUNT = 3;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function uniqueStrings(values: string[], name: string, max: number): string[] {
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (normalized.length === 0) throw new Error(`${name} must not be empty`);
  if (normalized.length > max) throw new Error(`${name} must contain at most ${max} values`);
  return normalized;
}

function normalizeCategories(categories: SearchCategory[]): SearchCategory[] {
  const byId = new Map<string, SearchCategory>();
  for (const category of categories) {
    const id = category.id.trim();
    if (!looksLikeCategoryId(id)) throw new Error(`invalid arXiv category: ${id}`);
    if (!byId.has(id)) {
      byId.set(id, { id, why: category.why.trim() || "caller-selected" });
    }
  }
  if (byId.size === 0) throw new Error("searchPlan.categories must not be empty");
  if (byId.size > 8) throw new Error("searchPlan.categories must contain at most 8 values");
  return [...byId.values()];
}

function mergeBatches(batches: Paper[][], maxPapers: number): Paper[] {
  const byId = new Map<string, Paper>();
  const maxBatchSize = Math.max(0, ...batches.map((batch) => batch.length));
  for (let rank = 0; rank < maxBatchSize && byId.size < maxPapers; rank += 1) {
    for (const batch of batches) {
      const paper = batch[rank];
      if (!paper) continue;
      const existing = byId.get(paper.id);
      byId.set(paper.id, existing ? mergePaper(existing, paper) : paper);
      if (byId.size >= maxPapers) break;
    }
  }
  return [...byId.values()];
}

function coverageFor(papers: Paper[], failedAttempts: number) {
  if (papers.length === 0) {
    return {
      status: "unavailable" as const,
      reason:
        failedAttempts > 0
          ? "No Research Evidence was retrieved after bounded recovery; one or more arXiv requests failed."
          : "No Research Evidence matched the caller-authored Search Plan after bounded retrieval.",
    };
  }
  if (papers.length < READY_PAPER_COUNT) {
    return {
      status: "thin" as const,
      reason: `Only ${papers.length} Paper${papers.length === 1 ? "" : "s"} was retrieved; the caller Agent must keep the recommendation bounded.`,
    };
  }
  return {
    status: "ready" as const,
    reason:
      failedAttempts > 0
        ? `${papers.length} Papers were retrieved, with partial category failures declared in the attempts.`
        : `${papers.length} Papers were retrieved within the Research Run budget.`,
  };
}

export function createResearchEvidenceCollector(gateway: ArxivGateway = createArxivGateway()) {
  return async function collect(
    request: ResearchEvidenceRequest,
  ): Promise<ResearchEvidenceResult> {
    const problem = request.problem.trim();
    if (!problem) throw new Error("problem must not be empty");

    const categories = normalizeCategories(request.searchPlan.categories);
    const terms = uniqueStrings(request.searchPlan.terms, "searchPlan.terms", 12);
    const expansionTerms = request.searchPlan.expansionTerms
      ? uniqueStrings(request.searchPlan.expansionTerms, "searchPlan.expansionTerms", 12)
      : [];
    const sinceYears = boundedInteger(
      request.searchPlan.sinceYears,
      8,
      "searchPlan.sinceYears",
      0,
      100,
    );
    const budget: Required<ResearchBudget> = {
      maxPapers: boundedInteger(
        request.budget?.maxPapers,
        DEFAULT_BUDGET.maxPapers,
        "budget.maxPapers",
        1,
        100,
      ),
      papersPerCategory: boundedInteger(
        request.budget?.papersPerCategory,
        DEFAULT_BUDGET.papersPerCategory,
        "budget.papersPerCategory",
        1,
        25,
      ),
      maxExpansions: boundedInteger(
        request.budget?.maxExpansions,
        DEFAULT_BUDGET.maxExpansions,
        "budget.maxExpansions",
        0,
        1,
      ) as 0 | 1,
    };

    const attempts: SearchAttempt[] = [];
    const initialBatches: Paper[][] = [];
    for (const category of categories) {
      try {
        const papers = await gateway.search({
          category: category.id,
          terms,
          maxResults: budget.papersPerCategory,
          sinceYears,
        });
        initialBatches.push(papers);
        attempts.push({
          phase: "initial",
          category: category.id,
          terms,
          paperCount: papers.length,
        });
      } catch (error) {
        initialBatches.push([]);
        attempts.push({
          phase: "initial",
          category: category.id,
          terms,
          paperCount: 0,
          failure: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let papers = mergeBatches(initialBatches, budget.maxPapers);
    const shouldExpand =
      papers.length < READY_PAPER_COUNT &&
      budget.maxExpansions === 1 &&
      expansionTerms.length > 0;
    if (shouldExpand) {
      const expansionBatches: Paper[][] = [];
      for (const category of categories) {
        try {
          const expanded = await gateway.search({
            category: category.id,
            terms: expansionTerms,
            maxResults: budget.papersPerCategory,
            sinceYears,
          });
          expansionBatches.push(expanded);
          attempts.push({
            phase: "expansion",
            category: category.id,
            terms: expansionTerms,
            paperCount: expanded.length,
          });
        } catch (error) {
          expansionBatches.push([]);
          attempts.push({
            phase: "expansion",
            category: category.id,
            terms: expansionTerms,
            paperCount: 0,
            failure: error instanceof Error ? error.message : String(error),
          });
        }
      }
      papers = mergeBatches([...initialBatches, ...expansionBatches], budget.maxPapers);
    }

    const failedAttempts = attempts.filter((attempt) => attempt.failure).length;
    return {
      problem,
      searchPlan: { categories, terms, expansionTerms, sinceYears },
      budget,
      papers,
      attempts,
      expansionUsed: shouldExpand,
      coverage: coverageFor(papers, failedAttempts),
    };
  };
}

const defaultCollector = createResearchEvidenceCollector();

export function collectResearchEvidence(
  request: ResearchEvidenceRequest,
): Promise<ResearchEvidenceResult> {
  return defaultCollector(request);
}
