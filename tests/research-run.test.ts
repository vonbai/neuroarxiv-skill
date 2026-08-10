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
    ],
    angles: [
      { label: "bounded leases", paperVersions: ["2601.00001v2"] },
      { label: "causal versions", paperVersions: ["2601.00002v1"] },
    ],
    recommendedPath: {
      angle: "bounded leases",
      sketch: "Use bounded leases with explicit invalidation.",
      firstStep: "Measure acceptable staleness.",
      loadBearingRisk: "Clock skew can extend stale reads.",
      citations: [{ paperVersion: "2601.00001v2", role: "primary mechanism" }],
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
