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
  papersPerCategory?: number;
  maxExpansions?: 0 | 1;
};

export type ResearchEvidenceRequest = {
  problem: string;
  searchPlan: SearchPlan;
  budget?: ResearchBudget;
};

export type SearchAttempt = {
  phase: "initial" | "expansion";
  category: string;
  terms: string[];
  paperCount: number;
  failure?: string;
};

export type ResearchEvidenceCoverage = {
  status: "ready" | "thin" | "unavailable";
  reason: string;
};

export type ResearchEvidenceResult = {
  problem: string;
  searchPlan: Required<Omit<SearchPlan, "expansionTerms">> & {
    expansionTerms: string[];
  };
  budget: Required<ResearchBudget>;
  papers: Paper[];
  attempts: SearchAttempt[];
  expansionUsed: boolean;
  coverage: ResearchEvidenceCoverage;
};

export type EvidenceDepth = "abstract" | "full-text";

export type PriorArtFinding = {
  paperVersion: string;
  evidenceDepth: EvidenceDepth;
  isolationStatus: "isolated" | "recovered" | "broken";
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

export type ResearchRunArtifact = {
  status: "complete" | "thin" | "incomplete";
  problem: string;
  researchEvidence: ResearchEvidenceResult;
  findings: PriorArtFinding[];
  excludedPapers: ExcludedPaper[];
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
