export type Paper = {
  id: string;
  version: string;
  title: string;
  summary: string;
  authors: string[];
  categories: string[];
  published: string;
  updated: string;
  absUrl: string;
  pdfUrl: string;
};

export type SearchCategory = {
  id: string;
  why: string;
};

export type SearchPlan = {
  categories: SearchCategory[];
  terms: string[];
  expansionTerms?: string[];
  sinceYears?: number;
};

export type ResearchBudget = {
  maxPapers?: number;
  maxFullTextPapers?: number;
};

export type ResearchEvidenceRequest = {
  problem: string;
  searchPlan: SearchPlan;
  budget?: ResearchBudget;
};

export type RetrievalFailureKind =
  | "throttled"
  | "timeout"
  | "transport"
  | "server"
  | "request-rejected"
  | "invalid-response"
  | "deadline-exhausted";

export type RetrievalFailure = {
  kind: RetrievalFailureKind;
  message: string;
  retryable: boolean;
  httpStatus?: number;
  retryAfterMs?: number;
};

export type RetrievalRequestTrace =
  | {
      sequence: number;
      status: "succeeded";
    }
  | {
      sequence: number;
      status: "failed";
      failure: RetrievalFailure;
    };

type SearchAttemptBase = {
  phase: "initial" | "expansion";
  category: string;
  terms: string[];
  paperCount: number;
  requests: RetrievalRequestTrace[];
};

export type SearchAttempt =
  | (SearchAttemptBase & {
      status: "succeeded";
    })
  | (SearchAttemptBase & {
      status: "failed";
      failure: RetrievalFailure;
    });

export type ResearchEvidenceCoverage = {
  status: "ready" | "thin" | "empty" | "unavailable";
};

export type RetrievalTermination =
  | { reason: "initial-budget-satisfied" }
  | { reason: "search-plan-exhausted" }
  | {
      reason: "retrieval-failed";
      phase: "initial" | "expansion";
      category: string;
    };

export type ResearchEvidenceResult = {
  problem: string;
  searchPlan: Required<Omit<SearchPlan, "expansionTerms">> & {
    expansionTerms: string[];
  };
  budget: Required<ResearchBudget>;
  papers: Paper[];
  attempts: SearchAttempt[];
  coverage: ResearchEvidenceCoverage;
  termination: RetrievalTermination;
};

export type EvidenceDepth = "abstract" | "full-text";

export type PriorArtFinding = {
  paperVersion: string;
  evidenceDepth: EvidenceDepth;
  isolationStatus: "isolated" | "recovered";
  approach: string;
  borrow: string;
  limitation: string;
  relevanceNote: string;
};

export type ArchitecturalAngle = {
  label: string;
  paperVersions: string[];
};

export type ResearchEvidenceCitation = {
  source: "paper";
  paperVersion: string;
  role: string;
};

export type DocumentationEvidenceCitation = {
  source: "documentation";
  sourceIdentity: string;
  role: string;
};

export type EvidenceCitation = ResearchEvidenceCitation | DocumentationEvidenceCitation;

export type ExcludedPaper = {
  paperVersion: string;
  reason: string;
};

export type ReadingFailure = {
  paperVersion: string;
  kind: "isolation-broken";
  detail: string;
};

export type RecommendedPath = {
  angle: string;
  sketch: string;
  firstStep: string;
  loadBearingRisk: string;
  citations: EvidenceCitation[];
};

export type AlternatePath = {
  angle: string;
  tradeOff: string;
};

export type PriorArtPitfall = {
  paperVersion: string;
  risk: string;
};

export type DocumentationEvidenceCoverage = {
  status: "used" | "not-needed" | "unavailable";
  reason: string;
  sourceIdentity?: string;
};

export type IncompleteReason = {
  kind:
    | "research-evidence-empty"
    | "research-evidence-unavailable"
    | "isolation-broken"
    | "evidence-chain-broken"
    | "validation-failed";
  detail: string;
  reentryCondition: string;
};

export type ResearchRunArtifact = {
  status: "complete" | "thin" | "incomplete";
  incompleteReason: IncompleteReason | null;
  problem: string;
  researchEvidence: ResearchEvidenceResult;
  findings: PriorArtFinding[];
  excludedPapers: ExcludedPaper[];
  readingFailures: ReadingFailure[];
  angles: ArchitecturalAngle[];
  recommendedPath: RecommendedPath | null;
  alternates: AlternatePath[];
  pitfalls: PriorArtPitfall[];
  openThreads: string[];
  documentationEvidence: DocumentationEvidenceCoverage;
};

export type ResearchRunValidation = {
  valid: boolean;
  errors: string[];
};
