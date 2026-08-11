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
    const expansionTerms = request.searchPlan.expansionTerms?.length
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

function requireText(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || !value.trim()) errors.push(`${path} must not be empty`);
}

function validateCitation(
  citation: EvidenceCitation,
  path: string,
  paperVersions: Set<string>,
  findingVersions: Set<string>,
  documentationEvidence: ResearchRunArtifact["documentationEvidence"],
  errors: string[],
): void {
  requireText(citation.role, `${path}.role`, errors);
  if (citation.source === "paper") {
    if (!paperVersions.has(citation.paperVersion)) {
      errors.push(`${path} references unknown Paper version ${citation.paperVersion}`);
    } else if (!findingVersions.has(citation.paperVersion)) {
      errors.push(`${path} references a Paper without a Prior-Art Finding`);
    }
    return;
  }
  if (citation.source !== "documentation") {
    errors.push(`${path}.source must be paper or documentation`);
    return;
  }

  requireText(citation.sourceIdentity, `${path}.sourceIdentity`, errors);
  if (documentationEvidence.status !== "used") {
    errors.push(`${path} references Documentation Evidence not recorded as used`);
  } else if (citation.sourceIdentity !== documentationEvidence.sourceIdentity) {
    errors.push(`${path} does not match the recorded Documentation Evidence source`);
  }
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

type JsonObject = Record<string, unknown>;

function expectObject(value: unknown, path: string, errors: string[]): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  return value as JsonObject;
}

function expectArray(value: unknown, path: string, errors: string[]): unknown[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return null;
  }
  return value;
}

function expectString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string") errors.push(`${path} must be a string`);
}

function expectBoolean(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "boolean") errors.push(`${path} must be a boolean`);
}

function expectInteger(
  value: unknown,
  path: string,
  errors: string[],
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    errors.push(`${path} must be an integer between ${min} and ${max}`);
  }
}

function expectEnum(
  value: unknown,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${path} must be one of: ${allowed.join(", ")}`);
  }
}

function expectStringArray(value: unknown, path: string, errors: string[]): void {
  const values = expectArray(value, path, errors);
  values?.forEach((item, index) => expectString(item, `${path}[${index}]`, errors));
}

function validateResearchRunShape(input: unknown, errors: string[]): input is ResearchRunArtifact {
  const run = expectObject(input, "Research Run", errors);
  if (!run) return false;

  expectEnum(run.status, ["complete", "thin", "incomplete"], "status", errors);
  expectString(run.problem, "problem", errors);

  const evidence = expectObject(run.researchEvidence, "researchEvidence", errors);
  if (evidence) {
    expectString(evidence.problem, "researchEvidence.problem", errors);
    const searchPlan = expectObject(evidence.searchPlan, "researchEvidence.searchPlan", errors);
    if (searchPlan) {
      const categories = expectArray(
        searchPlan.categories,
        "researchEvidence.searchPlan.categories",
        errors,
      );
      categories?.forEach((item, index) => {
        const category = expectObject(
          item,
          `researchEvidence.searchPlan.categories[${index}]`,
          errors,
        );
        if (category) {
          expectString(category.id, `researchEvidence.searchPlan.categories[${index}].id`, errors);
          expectString(category.why, `researchEvidence.searchPlan.categories[${index}].why`, errors);
        }
      });
      expectStringArray(searchPlan.terms, "researchEvidence.searchPlan.terms", errors);
      expectStringArray(
        searchPlan.expansionTerms,
        "researchEvidence.searchPlan.expansionTerms",
        errors,
      );
      expectInteger(searchPlan.sinceYears, "researchEvidence.searchPlan.sinceYears", errors, 0, 100);
    }

    const budget = expectObject(evidence.budget, "researchEvidence.budget", errors);
    if (budget) {
      expectInteger(budget.maxPapers, "researchEvidence.budget.maxPapers", errors, 1, 100);
      expectInteger(
        budget.maxFullTextPapers,
        "researchEvidence.budget.maxFullTextPapers",
        errors,
        0,
        20,
      );
      expectInteger(
        budget.papersPerCategory,
        "researchEvidence.budget.papersPerCategory",
        errors,
        1,
        25,
      );
      expectInteger(budget.maxExpansions, "researchEvidence.budget.maxExpansions", errors, 0, 1);
    }

    const papers = expectArray(evidence.papers, "researchEvidence.papers", errors);
    papers?.forEach((item, index) => {
      const paper = expectObject(item, `researchEvidence.papers[${index}]`, errors);
      if (!paper) return;
      for (const field of [
        "id",
        "version",
        "title",
        "summary",
        "published",
        "updated",
        "absUrl",
        "pdfUrl",
      ]) {
        expectString(paper[field], `researchEvidence.papers[${index}].${field}`, errors);
      }
      expectStringArray(paper.authors, `researchEvidence.papers[${index}].authors`, errors);
      expectStringArray(paper.categories, `researchEvidence.papers[${index}].categories`, errors);
    });

    const attempts = expectArray(evidence.attempts, "researchEvidence.attempts", errors);
    attempts?.forEach((item, index) => {
      const attempt = expectObject(item, `researchEvidence.attempts[${index}]`, errors);
      if (!attempt) return;
      expectEnum(
        attempt.phase,
        ["initial", "expansion"],
        `researchEvidence.attempts[${index}].phase`,
        errors,
      );
      expectString(attempt.category, `researchEvidence.attempts[${index}].category`, errors);
      expectStringArray(attempt.terms, `researchEvidence.attempts[${index}].terms`, errors);
      expectInteger(
        attempt.paperCount,
        `researchEvidence.attempts[${index}].paperCount`,
        errors,
        0,
      );
      if (attempt.failure !== undefined) {
        expectString(attempt.failure, `researchEvidence.attempts[${index}].failure`, errors);
      }
    });
    expectBoolean(evidence.expansionUsed, "researchEvidence.expansionUsed", errors);
    const coverage = expectObject(evidence.coverage, "researchEvidence.coverage", errors);
    if (coverage) {
      expectEnum(
        coverage.status,
        ["ready", "thin", "unavailable"],
        "researchEvidence.coverage.status",
        errors,
      );
      expectString(coverage.reason, "researchEvidence.coverage.reason", errors);
    }
  }

  const findings = expectArray(run.findings, "findings", errors);
  findings?.forEach((item, index) => {
    const finding = expectObject(item, `findings[${index}]`, errors);
    if (!finding) return;
    expectString(finding.paperVersion, `findings[${index}].paperVersion`, errors);
    expectEnum(
      finding.evidenceDepth,
      ["abstract", "full-text"],
      `findings[${index}].evidenceDepth`,
      errors,
    );
    expectEnum(
      finding.isolationStatus,
      ["isolated", "recovered", "broken"],
      `findings[${index}].isolationStatus`,
      errors,
    );
    for (const field of ["approach", "borrow", "limitation", "relevanceNote"]) {
      expectString(finding[field], `findings[${index}].${field}`, errors);
    }
  });

  const exclusions = expectArray(run.excludedPapers, "excludedPapers", errors);
  exclusions?.forEach((item, index) => {
    const exclusion = expectObject(item, `excludedPapers[${index}]`, errors);
    if (exclusion) {
      expectString(exclusion.paperVersion, `excludedPapers[${index}].paperVersion`, errors);
      expectString(exclusion.reason, `excludedPapers[${index}].reason`, errors);
    }
  });

  const angles = expectArray(run.angles, "angles", errors);
  angles?.forEach((item, index) => {
    const angle = expectObject(item, `angles[${index}]`, errors);
    if (angle) {
      expectString(angle.label, `angles[${index}].label`, errors);
      expectStringArray(angle.paperVersions, `angles[${index}].paperVersions`, errors);
    }
  });

  if (run.recommendedPath !== null) {
    const path = expectObject(run.recommendedPath, "recommendedPath", errors);
    if (path) {
      for (const field of ["angle", "sketch", "firstStep", "loadBearingRisk"]) {
        expectString(path[field], `recommendedPath.${field}`, errors);
      }
      const citations = expectArray(path.citations, "recommendedPath.citations", errors);
      citations?.forEach((item, index) => {
        const citation = expectObject(item, `recommendedPath.citations[${index}]`, errors);
        if (!citation) return;
        expectEnum(
          citation.source,
          ["paper", "documentation"],
          `recommendedPath.citations[${index}].source`,
          errors,
        );
        expectString(citation.role, `recommendedPath.citations[${index}].role`, errors);
        if (citation.source === "paper") {
          expectString(
            citation.paperVersion,
            `recommendedPath.citations[${index}].paperVersion`,
            errors,
          );
        } else if (citation.source === "documentation") {
          expectString(
            citation.sourceIdentity,
            `recommendedPath.citations[${index}].sourceIdentity`,
            errors,
          );
        }
      });
    }
  }

  const alternates = expectArray(run.alternates, "alternates", errors);
  alternates?.forEach((item, index) => {
    const alternate = expectObject(item, `alternates[${index}]`, errors);
    if (alternate) {
      expectString(alternate.angle, `alternates[${index}].angle`, errors);
      expectString(alternate.tradeOff, `alternates[${index}].tradeOff`, errors);
    }
  });

  const pitfalls = expectArray(run.pitfalls, "pitfalls", errors);
  pitfalls?.forEach((item, index) => {
    const pitfall = expectObject(item, `pitfalls[${index}]`, errors);
    if (pitfall) {
      expectString(pitfall.paperVersion, `pitfalls[${index}].paperVersion`, errors);
      expectString(pitfall.risk, `pitfalls[${index}].risk`, errors);
    }
  });
  expectStringArray(run.openThreads, "openThreads", errors);

  const documentation = expectObject(run.documentationEvidence, "documentationEvidence", errors);
  if (documentation) {
    expectEnum(
      documentation.status,
      ["used", "not-needed", "unavailable"],
      "documentationEvidence.status",
      errors,
    );
    expectString(documentation.reason, "documentationEvidence.reason", errors);
    if (documentation.sourceIdentity !== undefined) {
      expectString(documentation.sourceIdentity, "documentationEvidence.sourceIdentity", errors);
    }
  }

  return errors.length === 0;
}

export function validateResearchRun(input: unknown): ResearchRunValidation {
  const errors: string[] = [];
  if (!validateResearchRunShape(input, errors)) return { valid: false, errors };
  const run = input;
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
  if (run.researchEvidence.expansionUsed && run.researchEvidence.budget.maxExpansions === 0) {
    errors.push("expansionUsed exceeds the recorded expansion budget");
  }
  if (run.researchEvidence.expansionUsed && run.researchEvidence.searchPlan.expansionTerms.length === 0) {
    errors.push("expansionUsed requires caller-authored expansion terms");
  }

  const coverage = run.researchEvidence.coverage.status;
  const paperCount = run.researchEvidence.papers.length;
  if (coverage === "unavailable" && paperCount !== 0) {
    errors.push("unavailable Research Evidence cannot contain Papers");
  }
  if (coverage === "thin" && (paperCount === 0 || paperCount >= READY_PAPER_COUNT)) {
    errors.push(`thin Research Evidence requires 1-${READY_PAPER_COUNT - 1} Papers`);
  }
  if (coverage === "ready" && paperCount < READY_PAPER_COUNT) {
    errors.push(`ready Research Evidence requires at least ${READY_PAPER_COUNT} Papers`);
  }

  const findingVersions = new Set<string>();
  run.findings.forEach((finding, index) => {
    validateFinding(finding, index, paperVersions, errors);
    if (findingVersions.has(finding.paperVersion)) {
      errors.push(`findings contains duplicate Paper version ${finding.paperVersion}`);
    }
    findingVersions.add(finding.paperVersion);
  });
  const excludedVersions = new Set<string>();
  const excludedPapers = Array.isArray(run.excludedPapers) ? run.excludedPapers : [];
  if (!Array.isArray(run.excludedPapers)) {
    errors.push("excludedPapers must be an array");
  }
  excludedPapers.forEach((excluded, index) => {
    const path = `excludedPapers[${index}]`;
    if (!paperVersions.has(excluded.paperVersion)) {
      errors.push(`${path} references unknown Paper version ${excluded.paperVersion}`);
    }
    if (findingVersions.has(excluded.paperVersion)) {
      errors.push(`${path} cannot exclude a Paper that has a Prior-Art Finding`);
    }
    if (excludedVersions.has(excluded.paperVersion)) {
      errors.push(`excludedPapers contains duplicate Paper version ${excluded.paperVersion}`);
    }
    requireText(excluded.reason, `${path}.reason`, errors);
    excludedVersions.add(excluded.paperVersion);
  });
  for (const version of paperVersions) {
    if (!findingVersions.has(version) && !excludedVersions.has(version)) {
      errors.push(`Paper ${version} has no finding or exclusion`);
    }
  }
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
  const usableFindingCount = run.findings.filter(
    (finding) =>
      paperVersions.has(finding.paperVersion) && finding.isolationStatus !== "broken",
  ).length;
  if (
    run.status === "complete" &&
    (coverage !== "ready" || usableFindingCount < READY_PAPER_COUNT)
  ) {
    errors.push(
      `Complete Research Run requires ready Research Evidence and at least ${READY_PAPER_COUNT} usable findings`,
    );
  }
  if (
    run.status === "thin" &&
    (coverage === "unavailable" ||
      usableFindingCount === 0 ||
      usableFindingCount >= READY_PAPER_COUNT)
  ) {
    errors.push(
      `Thin Coverage Research Run requires available Research Evidence and 1-${READY_PAPER_COUNT - 1} usable findings`,
    );
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
        run.documentationEvidence,
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
