import { createArxivGateway, mergePaper, type ArxivGateway } from "./arxiv.js";
import type {
  ArchitecturalAngle,
  EvidenceCitation,
  Paper,
  PriorArtFinding,
  ResearchBudget,
  ResearchEvidenceRequest,
  ResearchEvidenceResult,
  ResearchRunArtifact,
  ResearchRunValidation,
  SearchAttempt,
  SearchCategory,
} from "./types.js";

const DEFAULT_BUDGET: Required<ResearchBudget> = {
  maxPapers: 12,
  maxFullTextPapers: 3,
  papersPerCategory: 4,
  maxExpansions: 1,
};
const READY_PAPER_COUNT = 3;

function looksLikeCategoryId(id: string): boolean {
  return /^[a-z-]+(\.[A-Za-z-]{2,12})?$/.test(id.trim());
}

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
      maxFullTextPapers: boundedInteger(
        request.budget?.maxFullTextPapers,
        DEFAULT_BUDGET.maxFullTextPapers,
        "budget.maxFullTextPapers",
        0,
        20,
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

function requireText(value: string, path: string, errors: string[]): void {
  if (!value.trim()) errors.push(`${path} must not be empty`);
}

function validateCitation(
  citation: EvidenceCitation,
  path: string,
  paperVersions: Set<string>,
  findingVersions: Set<string>,
  errors: string[],
): void {
  if (!paperVersions.has(citation.paperVersion)) {
    errors.push(`${path} references unknown Paper version ${citation.paperVersion}`);
  } else if (!findingVersions.has(citation.paperVersion)) {
    errors.push(`${path} references a Paper without a Prior-Art Finding`);
  }
  requireText(citation.role, `${path}.role`, errors);
}

function validateFinding(
  finding: PriorArtFinding,
  index: number,
  paperVersions: Set<string>,
  errors: string[],
): void {
  const path = `findings[${index}]`;
  if (!paperVersions.has(finding.paperVersion)) {
    errors.push(`${path} references unknown Paper version ${finding.paperVersion}`);
  }
  if (finding.isolationStatus === "broken") {
    errors.push(`${path} has broken isolation`);
  }
  requireText(finding.approach, `${path}.approach`, errors);
  requireText(finding.borrow, `${path}.borrow`, errors);
  requireText(finding.limitation, `${path}.limitation`, errors);
  requireText(finding.relevanceNote, `${path}.relevanceNote`, errors);
}

function validateAngle(
  angle: ArchitecturalAngle,
  index: number,
  findingVersions: Set<string>,
  errors: string[],
): void {
  const path = `angles[${index}]`;
  requireText(angle.label, `${path}.label`, errors);
  if (angle.paperVersions.length === 0) errors.push(`${path} must contain a finding`);
  for (const version of angle.paperVersions) {
    if (!findingVersions.has(version)) {
      errors.push(`${path} references Paper ${version} without a Prior-Art Finding`);
    }
  }
}

export function validateResearchRun(run: ResearchRunArtifact): ResearchRunValidation {
  const errors: string[] = [];
  requireText(run.problem, "problem", errors);
  if (run.problem.trim() !== run.researchEvidence.problem.trim()) {
    errors.push("problem must match researchEvidence.problem");
  }

  const paperVersions = new Set(run.researchEvidence.papers.map((paper) => paper.version));
  if (paperVersions.size !== run.researchEvidence.papers.length) {
    errors.push("researchEvidence contains duplicate Paper versions");
  }
  if (run.researchEvidence.papers.length > run.researchEvidence.budget.maxPapers) {
    errors.push("researchEvidence exceeds its recorded Paper budget");
  }
  const expansionAttempts = run.researchEvidence.attempts.filter(
    (attempt) => attempt.phase === "expansion",
  );
  if (run.researchEvidence.expansionUsed && expansionAttempts.length === 0) {
    errors.push("expansionUsed requires expansion attempts");
  }
  if (!run.researchEvidence.expansionUsed && expansionAttempts.length > 0) {
    errors.push("expansion attempts require expansionUsed");
  }

  const findingVersions = new Set<string>();
  run.findings.forEach((finding, index) => {
    validateFinding(finding, index, paperVersions, errors);
    if (findingVersions.has(finding.paperVersion)) {
      errors.push(`findings contains duplicate Paper version ${finding.paperVersion}`);
    }
    findingVersions.add(finding.paperVersion);
  });
  const fullTextCount = run.findings.filter(
    (finding) => finding.evidenceDepth === "full-text",
  ).length;
  if (fullTextCount > run.researchEvidence.budget.maxFullTextPapers) {
    errors.push("findings exceeds the recorded full-text budget");
  }

  const angleLabels = new Set<string>();
  run.angles.forEach((angle, index) => {
    validateAngle(angle, index, findingVersions, errors);
    if (angleLabels.has(angle.label)) errors.push(`duplicate Architectural Angle: ${angle.label}`);
    angleLabels.add(angle.label);
  });

  if (run.status === "incomplete") {
    if (run.recommendedPath !== null) {
      errors.push("an incomplete Research Run cannot contain a Recommended Path");
    }
  } else if (run.recommendedPath === null) {
    errors.push(`${run.status} Research Run requires one Recommended Path`);
  }
  if (run.status === "complete" && run.researchEvidence.coverage.status === "unavailable") {
    errors.push("complete Research Run requires available Research Evidence");
  }

  if (run.recommendedPath) {
    if (!angleLabels.has(run.recommendedPath.angle)) {
      errors.push("recommendedPath.angle must name an Architectural Angle");
    }
    requireText(run.recommendedPath.sketch, "recommendedPath.sketch", errors);
    requireText(run.recommendedPath.firstStep, "recommendedPath.firstStep", errors);
    requireText(
      run.recommendedPath.loadBearingRisk,
      "recommendedPath.loadBearingRisk",
      errors,
    );
    if (run.recommendedPath.citations.length === 0) {
      errors.push("recommendedPath requires at least one Evidence Citation");
    }
    run.recommendedPath.citations.forEach((citation, index) =>
      validateCitation(
        citation,
        `recommendedPath.citations[${index}]`,
        paperVersions,
        findingVersions,
        errors,
      ),
    );
  }

  for (const alternate of run.alternates) {
    if (!angleLabels.has(alternate.angle)) {
      errors.push(`Alternate Path references unknown angle ${alternate.angle}`);
    }
    if (alternate.angle === run.recommendedPath?.angle) {
      errors.push("Recommended Path cannot also be an Alternate Path");
    }
    requireText(alternate.tradeOff, `alternate ${alternate.angle}.tradeOff`, errors);
  }
  for (const pitfall of run.pitfalls) {
    if (!findingVersions.has(pitfall.paperVersion)) {
      errors.push(`Prior-Art Pitfall references Paper ${pitfall.paperVersion} without a finding`);
    }
    requireText(pitfall.risk, `pitfall ${pitfall.paperVersion}.risk`, errors);
  }
  if (run.documentationEvidence.status === "used" && !run.documentationEvidence.sourceIdentity) {
    errors.push("used Documentation Evidence requires sourceIdentity");
  }
  requireText(run.documentationEvidence.reason, "documentationEvidence.reason", errors);

  return { valid: errors.length === 0, errors };
}
