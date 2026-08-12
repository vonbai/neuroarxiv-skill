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
};
const READY_PAPER_COUNT = 3;
const PAPERS_PER_CATEGORY = 4;

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

function coverageFor(
  papers: Paper[],
  termination: ResearchEvidenceResult["termination"],
): ResearchEvidenceResult["coverage"] {
  if (papers.length === 0) {
    return {
      status: termination.reason === "retrieval-failed" ? "unavailable" : "empty",
    };
  }
  if (papers.length < READY_PAPER_COUNT) {
    return { status: "thin" };
  }
  return { status: "ready" };
}

export function createResearchEvidenceCollector(gateway: ArxivGateway) {
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
      maxFullTextPapers: boundedInteger(
        request.budget?.maxFullTextPapers,
        DEFAULT_BUDGET.maxFullTextPapers,
        "budget.maxFullTextPapers",
        0,
        20,
      ),
    };

    const attempts: SearchAttempt[] = [];
    const batches: Paper[][] = [];

    async function collectPhase(
      phase: SearchAttempt["phase"],
      phaseTerms: string[],
    ): Promise<Extract<ResearchEvidenceResult["termination"], { reason: "retrieval-failed" }> | null> {
      for (const category of categories) {
        const outcome = await gateway.search({
          category: category.id,
          terms: phaseTerms,
          maxResults: PAPERS_PER_CATEGORY,
          sinceYears,
        });
        if (outcome.status === "succeeded") {
          batches.push(outcome.papers);
          attempts.push({
            phase,
            category: category.id,
            terms: phaseTerms,
            status: "succeeded",
            paperCount: outcome.papers.length,
            requests: outcome.requests,
          });
          continue;
        }
        attempts.push({
          phase,
          category: category.id,
          terms: phaseTerms,
          status: "failed",
          paperCount: 0,
          requests: outcome.requests,
          failure: outcome.failure,
        });
        return { reason: "retrieval-failed", phase, category: category.id };
      }
      return null;
    }

    let termination: ResearchEvidenceResult["termination"];
    const initialFailure = await collectPhase("initial", terms);
    let papers = mergeBatches(batches, budget.maxPapers);
    if (initialFailure) {
      termination = initialFailure;
    } else if (papers.length >= Math.min(READY_PAPER_COUNT, budget.maxPapers)) {
      termination = { reason: "initial-budget-satisfied" };
    } else if (expansionTerms.length > 0) {
      const expansionFailure = await collectPhase("expansion", expansionTerms);
      papers = mergeBatches(batches, budget.maxPapers);
      termination = expansionFailure ?? { reason: "search-plan-exhausted" };
    } else {
      termination = { reason: "search-plan-exhausted" };
    }

    return {
      problem,
      searchPlan: { categories, terms, expansionTerms, sinceYears },
      budget,
      papers,
      attempts,
      coverage: coverageFor(papers, termination),
      termination,
    };
  };
}

export function collectResearchEvidence(
  request: ResearchEvidenceRequest,
): Promise<ResearchEvidenceResult> {
  return createResearchEvidenceCollector(createArxivGateway())(request);
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

const RETRIEVAL_FAILURE_KINDS = [
  "throttled",
  "timeout",
  "transport",
  "server",
  "request-rejected",
  "invalid-response",
  "deadline-exhausted",
] as const;

function validateRetrievalFailureShape(
  value: unknown,
  path: string,
  errors: string[],
): void {
  const failure = expectObject(value, path, errors);
  if (!failure) return;
  expectEnum(failure.kind, RETRIEVAL_FAILURE_KINDS, `${path}.kind`, errors);
  expectString(failure.message, `${path}.message`, errors);
  if (typeof failure.retryable !== "boolean") errors.push(`${path}.retryable must be a boolean`);
  if (failure.httpStatus !== undefined) {
    expectInteger(failure.httpStatus, `${path}.httpStatus`, errors, 100, 599);
  }
  if (failure.retryAfterMs !== undefined) {
    expectInteger(failure.retryAfterMs, `${path}.retryAfterMs`, errors, 0);
  }
}

function validateResearchRunShape(input: unknown, errors: string[]): input is ResearchRunArtifact {
  const run = expectObject(input, "Research Run", errors);
  if (!run) return false;

  expectEnum(run.status, ["complete", "thin", "incomplete"], "status", errors);
  expectString(run.problem, "problem", errors);
  if (run.incompleteReason !== null) {
    const reason = expectObject(run.incompleteReason, "incompleteReason", errors);
    if (reason) {
      expectEnum(
        reason.kind,
        [
          "research-evidence-empty",
          "research-evidence-unavailable",
          "isolation-broken",
          "evidence-chain-broken",
          "validation-failed",
        ],
        "incompleteReason.kind",
        errors,
      );
      expectString(reason.detail, "incompleteReason.detail", errors);
    }
  }

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
      expectEnum(
        attempt.status,
        ["succeeded", "failed"],
        `researchEvidence.attempts[${index}].status`,
        errors,
      );
      expectInteger(
        attempt.paperCount,
        `researchEvidence.attempts[${index}].paperCount`,
        errors,
        0,
      );
      const requests = expectArray(
        attempt.requests,
        `researchEvidence.attempts[${index}].requests`,
        errors,
      );
      requests?.forEach((item, requestIndex) => {
        const requestPath = `researchEvidence.attempts[${index}].requests[${requestIndex}]`;
        const request = expectObject(item, requestPath, errors);
        if (!request) return;
        expectInteger(request.sequence, `${requestPath}.sequence`, errors, 1);
        expectEnum(request.status, ["succeeded", "failed"], `${requestPath}.status`, errors);
        if (request.status === "failed") {
          validateRetrievalFailureShape(request.failure, `${requestPath}.failure`, errors);
        }
      });
      if (attempt.status === "failed") {
        validateRetrievalFailureShape(
          attempt.failure,
          `researchEvidence.attempts[${index}].failure`,
          errors,
        );
      }
    });
    const coverage = expectObject(evidence.coverage, "researchEvidence.coverage", errors);
    if (coverage) {
      expectEnum(
        coverage.status,
        ["ready", "thin", "empty", "unavailable"],
        "researchEvidence.coverage.status",
        errors,
      );
    }
    const termination = expectObject(
      evidence.termination,
      "researchEvidence.termination",
      errors,
    );
    if (termination) {
      expectEnum(
        termination.reason,
        ["initial-budget-satisfied", "search-plan-exhausted", "retrieval-failed"],
        "researchEvidence.termination.reason",
        errors,
      );
      if (termination.reason === "retrieval-failed") {
        expectEnum(
          termination.phase,
          ["initial", "expansion"],
          "researchEvidence.termination.phase",
          errors,
        );
        expectString(termination.category, "researchEvidence.termination.category", errors);
      }
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
  const coverage = run.researchEvidence.coverage.status;
  const paperCount = run.researchEvidence.papers.length;
  const plannedCategories = run.researchEvidence.searchPlan.categories.map(
    (category) => category.id,
  );
  const attemptKeys = new Set<string>();
  let sawExpansion = false;
  run.researchEvidence.attempts.forEach((attempt, index) => {
    if (!plannedCategories.includes(attempt.category)) {
      errors.push(`researchEvidence.attempts[${index}] uses an unplanned category`);
    }
    const key = `${attempt.phase}:${attempt.category}`;
    if (attemptKeys.has(key)) errors.push(`duplicate Search Attempt ${key}`);
    attemptKeys.add(key);
    if (attempt.phase === "expansion") sawExpansion = true;
    if (attempt.phase === "initial" && sawExpansion) {
      errors.push("initial Search Attempts must precede expansion attempts");
    }
    const expectedTerms =
      attempt.phase === "initial"
        ? run.researchEvidence.searchPlan.terms
        : run.researchEvidence.searchPlan.expansionTerms;
    if (JSON.stringify(attempt.terms) !== JSON.stringify(expectedTerms)) {
      errors.push(`researchEvidence.attempts[${index}] terms do not match its Search Plan phase`);
    }
    attempt.requests.forEach((request, requestIndex) => {
      if (request.sequence !== requestIndex + 1) {
        errors.push(`researchEvidence.attempts[${index}] request sequence is not contiguous`);
      }
    });
  });
  if (
    expansionAttempts.length > 0 &&
    run.researchEvidence.searchPlan.expansionTerms.length === 0
  ) {
    errors.push("expansion attempts require caller-authored expansion terms");
  }
  const firstFailedAttempt = run.researchEvidence.attempts.findIndex(
    (attempt) => attempt.status === "failed",
  );
  if (
    firstFailedAttempt !== -1 &&
    firstFailedAttempt !== run.researchEvidence.attempts.length - 1
  ) {
    errors.push("retrieval must stop after the first failed Search Attempt");
  }
  run.researchEvidence.attempts.forEach((attempt, index) => {
    const lastRequest = attempt.requests.at(-1);
    if (attempt.status === "succeeded") {
      if (!lastRequest || lastRequest.status !== "succeeded") {
        errors.push(`researchEvidence.attempts[${index}] succeeded without a successful request`);
      }
    } else {
      if (attempt.paperCount !== 0) {
        errors.push(`researchEvidence.attempts[${index}] failed with a non-zero Paper count`);
      }
      if (!attempt.failure) {
        errors.push(`researchEvidence.attempts[${index}] failed without a terminal failure`);
      }
    }
  });

  const termination = run.researchEvidence.termination;
  if (termination.reason === "initial-budget-satisfied" && expansionAttempts.length > 0) {
    errors.push("initial budget satisfaction cannot contain expansion attempts");
  }
  const successfulInitialCategories = new Set(
    run.researchEvidence.attempts
      .filter((attempt) => attempt.phase === "initial" && attempt.status === "succeeded")
      .map((attempt) => attempt.category),
  );
  const successfulExpansionCategories = new Set(
    run.researchEvidence.attempts
      .filter((attempt) => attempt.phase === "expansion" && attempt.status === "succeeded")
      .map((attempt) => attempt.category),
  );
  if (
    expansionAttempts.length > 0 &&
    successfulInitialCategories.size !== plannedCategories.length
  ) {
    errors.push("expansion requires a fully successful initial phase");
  }
  if (
    termination.reason !== "retrieval-failed" &&
    successfulInitialCategories.size !== plannedCategories.length
  ) {
    errors.push("completed retrieval requires every planned initial Search Attempt");
  }
  if (
    termination.reason === "initial-budget-satisfied" &&
    paperCount < Math.min(READY_PAPER_COUNT, run.researchEvidence.budget.maxPapers)
  ) {
    errors.push("initial-budget-satisfied termination requires its recorded Paper target");
  }
  if (
    termination.reason === "search-plan-exhausted" &&
    run.researchEvidence.searchPlan.expansionTerms.length > 0 &&
    successfulExpansionCategories.size !== plannedCategories.length
  ) {
    errors.push("exhausted expanded Search Plan requires every planned expansion attempt");
  }
  if (termination.reason === "retrieval-failed") {
    const failed = run.researchEvidence.attempts.at(-1);
    if (
      !failed ||
      failed.status !== "failed" ||
      failed.phase !== termination.phase ||
      failed.category !== termination.category
    ) {
      errors.push("retrieval-failed termination must reference the final failed Search Attempt");
    }
  } else if (firstFailedAttempt !== -1) {
    errors.push("a failed Search Attempt requires retrieval-failed termination");
  }

  if (
    coverage === "unavailable" &&
    (paperCount !== 0 || termination.reason !== "retrieval-failed")
  ) {
    errors.push("unavailable Research Evidence requires zero Papers and failed retrieval");
  }
  if (
    coverage === "empty" &&
    (paperCount !== 0 || termination.reason === "retrieval-failed")
  ) {
    errors.push("empty Research Evidence requires zero Papers and an exhausted successful Search Plan");
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
    if (run.incompleteReason === null) {
      errors.push("an incomplete Research Run requires incompleteReason");
    } else {
      requireText(run.incompleteReason.detail, "incompleteReason.detail", errors);
    }
  } else if (run.recommendedPath === null) {
    errors.push(`${run.status} Research Run requires one Recommended Path`);
  } else if (run.incompleteReason !== null) {
    errors.push(`${run.status} Research Run cannot contain incompleteReason`);
  }
  if (
    coverage === "unavailable" &&
    (run.status !== "incomplete" ||
      run.incompleteReason?.kind !== "research-evidence-unavailable")
  ) {
    errors.push("unavailable Research Evidence requires an incomplete unavailable outcome");
  }
  if (
    coverage === "empty" &&
    (run.status !== "incomplete" || run.incompleteReason?.kind !== "research-evidence-empty")
  ) {
    errors.push("empty Research Evidence requires an incomplete empty outcome");
  }
  if (
    run.incompleteReason?.kind === "research-evidence-unavailable" &&
    coverage !== "unavailable"
  ) {
    errors.push("research-evidence-unavailable requires unavailable Research Evidence");
  }
  if (run.incompleteReason?.kind === "research-evidence-empty" && coverage !== "empty") {
    errors.push("research-evidence-empty requires empty Research Evidence");
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
