import assert from "node:assert/strict";
import test from "node:test";

import {
  createResearchEvidenceCollector,
  validateResearchRun,
} from "../src/research-run.ts";
import type { ArxivGateway, ArxivSearch } from "../src/arxiv.ts";
import type {
  Paper,
  ResearchEvidenceRequest,
  ResearchRunArtifact,
} from "../src/types.ts";

function paper(id: string, version = `${id}v1`, category = "cs.AI"): Paper {
  return {
    id,
    version,
    title: `Paper ${version}`,
    summary: `Abstract for ${version}`,
    authors: ["Researcher"],
    categories: [category],
    published: "2026-01-01T00:00:00Z",
    updated: "2026-01-02T00:00:00Z",
    absUrl: `https://arxiv.org/abs/${version}`,
    pdfUrl: `https://arxiv.org/pdf/${version}`,
  };
}

function request(overrides: Partial<ResearchEvidenceRequest> = {}): ResearchEvidenceRequest {
  return {
    problem: "Choose a cache invalidation mechanism",
    searchPlan: {
      categories: [
        { id: "cs.DB", why: "database consistency" },
        { id: "cs.DC", why: "distributed coordination" },
      ],
      terms: ["cache invalidation"],
      expansionTerms: ["cache coherence"],
      sinceYears: 8,
    },
    ...overrides,
  };
}

test("Research Run normalizes, deduplicates, merges categories, and preserves newest version", async () => {
  const gateway: ArxivGateway = {
    async search(input: ArxivSearch) {
      if (input.category === "cs.DB") {
        return [paper("2601.00001", "2601.00001v1", "cs.DB"), paper("2601.00002")];
      }
      return [
        paper("2601.00001", "2601.00001v2", "cs.DC"),
        paper("2601.00003", "2601.00003v1", "cs.DC"),
      ];
    },
  };

  const result = await createResearchEvidenceCollector(gateway)(request());

  assert.equal(result.coverage.status, "ready");
  assert.deepEqual(result.papers.map((item) => item.id), [
    "2601.00001",
    "2601.00002",
    "2601.00003",
  ]);
  assert.equal(result.papers[0].version, "2601.00001v2");
  assert.deepEqual(result.papers[0].categories, ["cs.DB", "cs.DC"]);
  assert.equal(result.expansionUsed, false);
});

test("Research Run performs one caller-authored expansion when coverage is thin", async () => {
  const calls: ArxivSearch[] = [];
  const gateway: ArxivGateway = {
    async search(input) {
      calls.push(input);
      if (input.terms[0] === "cache invalidation") {
        return input.category === "cs.DB" ? [paper("2601.00001")] : [];
      }
      return input.category === "cs.DB"
        ? [paper("2601.00002")]
        : [paper("2601.00003", "2601.00003v1", "cs.DC")];
    },
  };

  const result = await createResearchEvidenceCollector(gateway)(request());

  assert.equal(result.expansionUsed, true);
  assert.equal(calls.length, 4);
  assert.equal(result.attempts.filter((attempt) => attempt.phase === "expansion").length, 2);
  assert.equal(result.coverage.status, "ready");
});

test("Research Run accepts an omitted or empty expansion plan", async () => {
  const calls: ArxivSearch[] = [];
  const gateway: ArxivGateway = {
    async search(input) {
      calls.push(input);
      return [
        paper("2601.00001", "2601.00001v1", input.category),
        paper("2601.00002", "2601.00002v1", input.category),
        paper("2601.00003", "2601.00003v1", input.category),
      ];
    },
  };

  const result = await createResearchEvidenceCollector(gateway)(
    request({
      searchPlan: {
        categories: [{ id: "cs.DB", why: "database consistency" }],
        terms: ["cache invalidation"],
        expansionTerms: [],
      },
    }),
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(result.searchPlan.expansionTerms, []);
  assert.equal(result.expansionUsed, false);
});

test("Research Run caps retained Papers at the default budget", async () => {
  const gateway: ArxivGateway = {
    async search(input) {
      return Array.from({ length: 10 }, (_, index) =>
        paper(
          `2601.${input.category === "cs.DB" ? "1" : "2"}${String(index).padStart(4, "0")}`,
          undefined,
          input.category,
        ),
      );
    },
  };

  const result = await createResearchEvidenceCollector(gateway)(request());
  assert.equal(result.papers.length, 12);
  assert.equal(result.budget.maxPapers, 12);
});

test("Research Run declares unavailable coverage after bounded failures", async () => {
  const gateway: ArxivGateway = {
    async search() {
      throw new Error("arXiv unavailable");
    },
  };

  const result = await createResearchEvidenceCollector(gateway)(request());
  assert.equal(result.papers.length, 0);
  assert.equal(result.coverage.status, "unavailable");
  assert.equal(result.attempts.length, 4);
  assert.ok(result.attempts.every((attempt) => attempt.failure === "arXiv unavailable"));
});

test("Research Run accepts valid categories outside the old curated list", async () => {
  const gateway: ArxivGateway = { async search() { return []; } };
  const result = await createResearchEvidenceCollector(gateway)(
    request({
      searchPlan: {
        categories: [{ id: "quant-ph", why: "quantum systems" }],
        terms: ["dynamical decoupling"],
        sinceYears: 0,
      },
    }),
  );
  assert.equal(result.searchPlan.categories[0].id, "quant-ph");
  assert.equal(result.searchPlan.sinceYears, 0);
});

async function completeArtifact(): Promise<ResearchRunArtifact> {
  const gateway: ArxivGateway = {
    async search(input) {
      return [
        paper("2601.00001", "2601.00001v2", input.category),
        paper("2601.00002", "2601.00002v1", input.category),
        paper("2601.00003", "2601.00003v1", input.category),
      ];
    },
  };
  const researchEvidence = await createResearchEvidenceCollector(gateway)(
    request({ searchPlan: { categories: [{ id: "cs.DB", why: "storage" }], terms: ["cache invalidation"] } }),
  );
  return {
    status: "complete",
    problem: researchEvidence.problem,
    researchEvidence,
    findings: [
      {
        paperVersion: "2601.00001v2",
        evidenceDepth: "full-text",
        isolationStatus: "isolated",
        approach: "Lease-based invalidation",
        borrow: "Use bounded leases for cache entries.",
        limitation: "Clock skew weakens the expiry guarantee.",
        relevanceNote: "Directly addresses invalidation.",
      },
      {
        paperVersion: "2601.00002v1",
        evidenceDepth: "abstract",
        isolationStatus: "isolated",
        approach: "Version vectors",
        borrow: "Track writer versions.",
        limitation: "Metadata grows with writers.",
        relevanceNote: "Supports concurrent writers.",
      },
      {
        paperVersion: "2601.00003v1",
        evidenceDepth: "abstract",
        isolationStatus: "isolated",
        approach: "Epoch fencing",
        borrow: "Fence stale writers with monotonic epochs.",
        limitation: "Epoch allocation adds coordination overhead.",
        relevanceNote: "Protects invalidation from delayed writers.",
      },
    ],
    excludedPapers: [],
    angles: [
      { label: "bounded leases", paperVersions: ["2601.00001v2", "2601.00003v1"] },
      { label: "causal versions", paperVersions: ["2601.00002v1"] },
    ],
    recommendedPath: {
      angle: "bounded leases",
      sketch: "Use bounded leases with explicit invalidation.",
      firstStep: "Measure acceptable staleness.",
      loadBearingRisk: "Clock skew can extend stale reads.",
      citations: [
        { source: "paper", paperVersion: "2601.00001v2", role: "primary mechanism" },
      ],
    },
    alternates: [{ angle: "causal versions", tradeOff: "Stronger causality, higher metadata cost." }],
    pitfalls: [{ paperVersion: "2601.00002v1", risk: "Do not ignore writer-set growth." }],
    openThreads: ["What clock-skew bound holds in production?"],
    documentationEvidence: { status: "not-needed", reason: "No concrete dependency selected." },
  };
}

test("Research Run validation accepts one intact Recommended Path", async () => {
  const validation = validateResearchRun(await completeArtifact());
  assert.deepEqual(validation, { valid: true, errors: [] });
});

test("Research Run validation rejects unknown citations without synthesizing metadata", async () => {
  const artifact = await completeArtifact();
  artifact.recommendedPath!.citations[0].paperVersion = "9999.99999v1";
  const validation = validateResearchRun(artifact);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("unknown Paper version 9999.99999v1")));
});

test("Research Run validation rejects a path when isolation remains broken", async () => {
  const artifact = await completeArtifact();
  artifact.findings[0].isolationStatus = "broken";
  const validation = validateResearchRun(artifact);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("broken isolation")));
});

test("Research Run validation forbids a recommendation on an incomplete run", async () => {
  const artifact = await completeArtifact();
  artifact.status = "incomplete";
  const validation = validateResearchRun(artifact);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("cannot contain a Recommended Path")));
});

test("Research Run validation rejects Thin Coverage presented as Complete", async () => {
  const artifact = await completeArtifact();
  artifact.researchEvidence.papers = artifact.researchEvidence.papers.slice(0, 2);
  artifact.researchEvidence.coverage = {
    status: "thin",
    reason: "Only two Papers were retrieved.",
  };
  artifact.excludedPapers = [];

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("Complete Research Run requires ready")));
});

test("Research Run validation requires every retained Paper to be accounted for", async () => {
  const artifact = await completeArtifact();
  artifact.findings = artifact.findings.slice(0, 2);
  artifact.angles[0].paperVersions = ["2601.00001v2"];

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes("2601.00003v1 has no finding or exclusion")),
  );
});

test("Research Run validation accepts Thin Coverage after reasoned exclusions", async () => {
  const artifact = await completeArtifact();
  artifact.status = "thin";
  artifact.findings = artifact.findings.slice(0, 2);
  artifact.excludedPapers = [
    {
      paperVersion: "2601.00003v1",
      reason: "The retrieved mechanism does not apply to the selected consistency boundary.",
    },
  ];
  artifact.angles[0].paperVersions = ["2601.00001v2"];

  const validation = validateResearchRun(artifact);

  assert.deepEqual(validation, { valid: true, errors: [] });
});

test("Research Run validation reports a missing exclusions collection", async () => {
  const artifact = await completeArtifact();
  delete (artifact as Partial<ResearchRunArtifact>).excludedPapers;

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("excludedPapers must be an array"));
});

test("Research Run validation accepts traceable Documentation Evidence", async () => {
  const artifact = await completeArtifact();
  artifact.documentationEvidence = {
    status: "used",
    reason: "The path depends on the current cache API.",
    sourceIdentity: "Example Cache 4.2 documentation",
  };
  artifact.recommendedPath!.citations.push({
    source: "documentation",
    sourceIdentity: "Example Cache 4.2 documentation",
    role: "current dependency interface",
  });

  const validation = validateResearchRun(artifact);

  assert.deepEqual(validation, { valid: true, errors: [] });
});

test("Research Run validation rejects untracked Documentation Evidence", async () => {
  const artifact = await completeArtifact();
  artifact.recommendedPath!.citations.push({
    source: "documentation",
    sourceIdentity: "Unrecorded documentation",
    role: "current dependency interface",
  });

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("not recorded as used")));
});

test("Research Run JSON validation rejects invalid contract enums", async () => {
  const artifact = (await completeArtifact()) as unknown as Record<string, unknown>;
  artifact.status = "bogus";
  const findings = artifact.findings as Array<Record<string, unknown>>;
  findings[0].evidenceDepth = "invented-depth";
  findings[0].isolationStatus = "contaminated";
  const documentation = artifact.documentationEvidence as Record<string, unknown>;
  documentation.status = "invented-status";

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.startsWith("status must be one of")));
  assert.ok(validation.errors.some((error) => error.includes("evidenceDepth must be one of")));
  assert.ok(validation.errors.some((error) => error.includes("isolationStatus must be one of")));
  assert.ok(validation.errors.some((error) => error.includes("documentationEvidence.status")));
});

test("Research Run JSON validation reports malformed structure instead of throwing", () => {
  const validation = validateResearchRun({ status: "complete" });

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("researchEvidence must be an object"));
  assert.ok(validation.errors.includes("findings must be an array"));
});
