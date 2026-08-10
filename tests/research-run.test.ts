import assert from "node:assert/strict";
import test from "node:test";

import { createResearchEvidenceCollector } from "../src/research-run.ts";
import type { ArxivGateway, ArxivSearch } from "../src/arxiv.ts";
import type { Paper, ResearchEvidenceRequest } from "../src/types.ts";

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
