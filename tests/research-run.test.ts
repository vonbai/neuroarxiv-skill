import assert from "node:assert/strict";
import test from "node:test";

import { createArxivGateway, type ArxivGateway, type ArxivSearch } from "../src/arxiv.ts";
import { createResearchEvidenceCollector, validateResearchRun } from "../src/research-run.ts";
import type {
  Paper,
  ResearchEvidenceRequest,
  ResearchRunArtifact,
} from "../src/types.ts";

function succeeded(papers: Paper[]) {
  return {
    status: "succeeded" as const,
    papers,
    requests: [{ sequence: 1, status: "succeeded" as const }],
  };
}

function failed(message: string) {
  const failure = { kind: "transport" as const, message, retryable: true };
  return {
    status: "failed" as const,
    failure,
    requests: [{ sequence: 1, status: "failed" as const, failure }],
  };
}

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
        return succeeded([
          paper("2601.00001", "2601.00001v1", "cs.DB"),
          paper("2601.00002"),
        ]);
      }
      return succeeded([
        paper("2601.00001", "2601.00001v2", "cs.DC"),
        paper("2601.00003", "2601.00003v1", "cs.DC"),
      ]);
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
  assert.deepEqual(result.termination, { reason: "initial-budget-satisfied" });
});

test("Research Run performs one caller-authored expansion when coverage is thin", async () => {
  const calls: ArxivSearch[] = [];
  const gateway: ArxivGateway = {
    async search(input) {
      calls.push(input);
      if (input.terms[0] === "cache invalidation") {
        return succeeded(input.category === "cs.DB" ? [paper("2601.00001")] : []);
      }
      return succeeded(
        input.category === "cs.DB"
          ? [paper("2601.00002")]
          : [paper("2601.00003", "2601.00003v1", "cs.DC")],
      );
    },
  };

  const result = await createResearchEvidenceCollector(gateway)(request());

  assert.equal(calls.length, 4);
  assert.equal(result.attempts.filter((attempt) => attempt.phase === "expansion").length, 2);
  assert.equal(result.coverage.status, "ready");
  assert.deepEqual(result.termination, { reason: "search-plan-exhausted" });
});

test("Research Run accepts an omitted or empty expansion plan", async () => {
  const calls: ArxivSearch[] = [];
  const gateway: ArxivGateway = {
    async search(input) {
      calls.push(input);
      return succeeded([
        paper("2601.00001", "2601.00001v1", input.category),
        paper("2601.00002", "2601.00002v1", input.category),
        paper("2601.00003", "2601.00003v1", input.category),
      ]);
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
  assert.deepEqual(result.termination, { reason: "initial-budget-satisfied" });
});

test("Research Run caps retained Papers at the default budget", async () => {
  const gateway: ArxivGateway = {
    async search(input) {
      return succeeded(
        Array.from({ length: 10 }, (_, index) =>
          paper(
            `2601.${input.category === "cs.DB" ? "1" : "2"}${String(index).padStart(4, "0")}`,
            undefined,
            input.category,
          ),
        ),
      );
    },
  };

  const result = await createResearchEvidenceCollector(gateway)(request());
  assert.equal(result.papers.length, 12);
  assert.equal(result.budget.maxPapers, 12);
});

test("Research Run treats an explicit small Paper budget as satisfied before expansion", async () => {
  const calls: ArxivSearch[] = [];
  const gateway: ArxivGateway = {
    async search(input) {
      calls.push(input);
      return succeeded([
        paper(
          "2601.00001",
          input.category === "cs.DB" ? "2601.00001v1" : "2601.00001v2",
          input.category,
        ),
      ]);
    },
  };

  const result = await createResearchEvidenceCollector(gateway)(
    request({ budget: { maxPapers: 1 } }),
  );

  assert.equal(calls.length, 2);
  assert.equal(result.attempts.some((attempt) => attempt.phase === "expansion"), false);
  assert.equal(result.papers[0].version, "2601.00001v2");
  assert.deepEqual(result.papers[0].categories, ["cs.DB", "cs.DC"]);
  assert.deepEqual(result.termination, { reason: "initial-budget-satisfied" });
});

test("Research Run declares unavailable coverage after bounded failures", async () => {
  const gateway: ArxivGateway = {
    async search() {
      return failed("arXiv unavailable");
    },
  };

  const result = await createResearchEvidenceCollector(gateway)(request());
  assert.equal(result.papers.length, 0);
  assert.equal(result.coverage.status, "unavailable");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].status, "failed");
  assert.deepEqual(result.termination, {
    reason: "retrieval-failed",
    phase: "initial",
    category: "cs.DB",
  });
});

test("Research Run stops the source after one exhausted query and never expands an outage", async () => {
  let requests = 0;
  const gateway = createArxivGateway({
    requestDelayMs: 0,
    sleep: async () => undefined,
    fetch: async () => {
      requests += 1;
      if (requests === 1) {
        return new Response("busy", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      throw new DOMException("timed out", "AbortError");
    },
  });

  const result = await createResearchEvidenceCollector(gateway)(
    request({
      searchPlan: {
        categories: [
          { id: "cs.SE", why: "software evolution" },
          { id: "cs.HC", why: "human interaction" },
          { id: "cs.IR", why: "retrieval" },
        ],
        terms: ["architecture recovery", "traceability"],
        expansionTerms: ["documentation drift", "change impact analysis"],
      },
    }),
  );

  assert.equal(requests, 2);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].status, "failed");
  assert.deepEqual(result.termination, {
    reason: "retrieval-failed",
    phase: "initial",
    category: "cs.SE",
  });
  assert.deepEqual(result.coverage, { status: "unavailable" });
});

test("Research Run stops the source after one malformed Atom response", async () => {
  let requests = 0;
  const gateway = createArxivGateway({
    requestDelayMs: 0,
    sleep: async () => undefined,
    fetch: async () => {
      requests += 1;
      return new Response("<feed><entry><title>Ghost Paper</title></entry></feed>", {
        status: 200,
      });
    },
  });

  const result = await createResearchEvidenceCollector(gateway)(request());

  assert.equal(requests, 1);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].status, "failed");
  if (result.attempts[0].status === "failed") {
    assert.equal(result.attempts[0].failure.kind, "invalid-response");
  }
  assert.deepEqual(result.termination, {
    reason: "retrieval-failed",
    phase: "initial",
    category: "cs.DB",
  });
});

test("Research Run preserves earlier Papers when a later Search Attempt stops the source", async () => {
  let calls = 0;
  const result = await createResearchEvidenceCollector({
    async search() {
      calls += 1;
      return calls === 1 ? succeeded([paper("2601.00001")]) : failed("upstream timeout");
    },
  })(request());

  assert.equal(calls, 2);
  assert.deepEqual(result.papers.map((item) => item.version), ["2601.00001v1"]);
  assert.deepEqual(result.coverage, { status: "thin" });
  assert.deepEqual(result.termination, {
    reason: "retrieval-failed",
    phase: "initial",
    category: "cs.DC",
  });
  assert.equal(result.attempts.some((attempt) => attempt.phase === "expansion"), false);
});

test("Research Run distinguishes an exhausted successful Search Plan from source unavailability", async () => {
  const result = await createResearchEvidenceCollector({
    async search() {
      return { status: "succeeded", papers: [], requests: [{ sequence: 1, status: "succeeded" }] };
    },
  })(
    request({
      searchPlan: {
        categories: [{ id: "cs.SE", why: "software evolution" }],
        terms: ["traceability recovery"],
      },
    }),
  );

  assert.deepEqual(result.coverage, { status: "empty" });
  assert.deepEqual(result.termination, { reason: "search-plan-exhausted" });
});

test("Research Run accepts valid categories outside the old curated list", async () => {
  const gateway: ArxivGateway = { async search() { return succeeded([]); } };
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
      return succeeded([
        paper("2601.00001", "2601.00001v2", input.category),
        paper("2601.00002", "2601.00002v1", input.category),
        paper("2601.00003", "2601.00003v1", input.category),
      ]);
    },
  };
  const researchEvidence = await createResearchEvidenceCollector(gateway)(
    request({ searchPlan: { categories: [{ id: "cs.DB", why: "storage" }], terms: ["cache invalidation"] } }),
  );
  return {
    status: "complete",
    incompleteReason: null,
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
    readingFailures: [],
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

test("Research Run validation accepts an honest isolation-broken terminal disposition", async () => {
  const artifact = await completeArtifact();
  const failedVersion = artifact.findings[0].paperVersion;
  artifact.status = "incomplete";
  artifact.incompleteReason = {
    kind: "isolation-broken",
    detail: "One clean re-read remained contaminated by sibling Paper context.",
    reentryCondition: "A fresh isolated reading context becomes available.",
  };
  artifact.findings = artifact.findings.slice(1);
  artifact.angles = [];
  artifact.recommendedPath = null;
  artifact.alternates = [];
  artifact.pitfalls = [];
  Object.assign(artifact, {
    readingFailures: [
      {
        paperVersion: failedVersion,
        kind: "isolation-broken",
        detail: "The bounded clean re-read still observed sibling Paper content.",
      },
    ],
  });

  const validation = validateResearchRun(artifact);
  assert.deepEqual(validation, { valid: true, errors: [] });
});

test("Research Run validation forbids a recommendation on an incomplete run", async () => {
  const artifact = await completeArtifact();
  artifact.status = "incomplete";
  artifact.incompleteReason = {
    kind: "evidence-chain-broken",
    detail: "Fixture path is intentionally invalid.",
    reentryCondition: "The load-bearing evidence chain can be reconstructed.",
  };
  const validation = validateResearchRun(artifact);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("cannot contain a Recommended Path")));
});

test("Research Run validation requires one explicit reason for every incomplete outcome", async () => {
  const artifact = await completeArtifact();
  artifact.status = "incomplete";
  artifact.recommendedPath = null;
  artifact.incompleteReason = null;

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("requires incompleteReason")));
});

test("Research Run validation accepts a traceable unavailable terminal outcome", async () => {
  const artifact = await completeArtifact();
  const researchEvidence = await createResearchEvidenceCollector({
    async search() {
      return failed("network unreachable");
    },
  })(request());
  Object.assign(artifact, {
    status: "incomplete",
    incompleteReason: {
      kind: "research-evidence-unavailable",
      detail: "The first Search Attempt exhausted transport recovery.",
      reentryCondition: "arXiv access is restored for a future open decision.",
    },
    researchEvidence,
    findings: [],
    excludedPapers: [],
    angles: [],
    recommendedPath: null,
    alternates: [],
    pitfalls: [],
  } satisfies Partial<ResearchRunArtifact>);

  assert.deepEqual(validateResearchRun(artifact), { valid: true, errors: [] });
});

test("Research Run validation accepts a successful empty Search Plan with one re-entry condition", async () => {
  const artifact = await completeArtifact();
  const researchEvidence = await createResearchEvidenceCollector({
    async search() {
      return succeeded([]);
    },
  })(
    request({
      searchPlan: {
        categories: [{ id: "cs.SE", why: "software evolution" }],
        terms: ["traceability recovery"],
      },
    }),
  );
  Object.assign(artifact, {
    status: "incomplete",
    incompleteReason: {
      kind: "research-evidence-empty",
      detail: "The complete Search Plan returned no Papers.",
      reentryCondition: "A materially narrower mechanism or new terminology becomes relevant.",
    },
    researchEvidence,
    findings: [],
    excludedPapers: [],
    readingFailures: [],
    angles: [],
    recommendedPath: null,
    alternates: [],
    pitfalls: [],
  } satisfies Partial<ResearchRunArtifact>);

  assert.deepEqual(validateResearchRun(artifact), { valid: true, errors: [] });
});

test("Research Run validation requires an actionable re-entry condition", async () => {
  const artifact = await completeArtifact();
  artifact.status = "incomplete";
  artifact.recommendedPath = null;
  artifact.incompleteReason = {
    kind: "evidence-chain-broken",
    detail: "The primary mechanism citation no longer supports the decision.",
    reentryCondition: "",
  };

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("incompleteReason.reentryCondition must not be empty"));
});

test("Research Run validation rejects an empty Search Plan mislabeled as unavailable", async () => {
  const artifact = await completeArtifact();
  const researchEvidence = await createResearchEvidenceCollector({
    async search() {
      return succeeded([]);
    },
  })(
    request({
      searchPlan: {
        categories: [{ id: "cs.SE", why: "software evolution" }],
        terms: ["traceability recovery"],
      },
    }),
  );
  Object.assign(artifact, {
    status: "incomplete",
    incompleteReason: {
      kind: "research-evidence-unavailable",
      detail: "Incorrect fixture classification.",
      reentryCondition: "The fixture classification is corrected.",
    },
    researchEvidence,
    findings: [],
    excludedPapers: [],
    angles: [],
    recommendedPath: null,
    alternates: [],
    pitfalls: [],
  } satisfies Partial<ResearchRunArtifact>);

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("incomplete empty outcome")));
});

test("Research Run validation rejects an unavailable reason attached to usable evidence", async () => {
  const artifact = await completeArtifact();
  artifact.status = "incomplete";
  artifact.recommendedPath = null;
  artifact.incompleteReason = {
    kind: "research-evidence-unavailable",
    detail: "Incorrect fixture classification.",
    reentryCondition: "The fixture classification is corrected.",
  };

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) =>
      error.includes("research-evidence-unavailable requires unavailable"),
    ),
  );
});

test("Research Run validation rejects malformed Paper metadata even when references agree", async () => {
  const artifact = await completeArtifact();
  artifact.researchEvidence.papers[0].summary = "";

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("researchEvidence.papers[0].summary must not be empty"));
});

test("Research Run validation rejects a Paper whose canonical URL contradicts its version", async () => {
  const artifact = await completeArtifact();
  artifact.researchEvidence.papers[0].absUrl = "https://arxiv.org/abs/2601.99999v1";

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes(
      "researchEvidence.papers[0].absUrl must match its exact Paper version",
    ),
  );
});

test("Research Run validation rejects a failed Search Attempt ending in a successful request", async () => {
  const artifact = await completeArtifact();
  const researchEvidence = await createResearchEvidenceCollector({
    async search() {
      return failed("network unreachable");
    },
  })(request());
  const failedAttempt = researchEvidence.attempts[0];
  if (failedAttempt.status !== "failed") throw new Error("fixture must fail");
  failedAttempt.requests = [{ sequence: 1, status: "succeeded" }];
  Object.assign(artifact, {
    status: "incomplete",
    incompleteReason: {
      kind: "research-evidence-unavailable",
      detail: "The first Search Attempt exhausted transport recovery.",
      reentryCondition: "arXiv access is restored for a future open decision.",
    },
    researchEvidence,
    findings: [],
    excludedPapers: [],
    angles: [],
    recommendedPath: null,
    alternates: [],
    pitfalls: [],
  } satisfies Partial<ResearchRunArtifact>);

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("failed with a successful request")));
});

test("Research Run validation rejects a terminal failure that contradicts its request chain", async () => {
  const artifact = await completeArtifact();
  const researchEvidence = await createResearchEvidenceCollector({
    async search() {
      return failed("network unreachable");
    },
  })(request());
  const failedAttempt = researchEvidence.attempts[0];
  if (failedAttempt.status !== "failed") throw new Error("fixture must fail");
  const terminalRequest = failedAttempt.requests.at(-1);
  if (!terminalRequest || terminalRequest.status !== "failed") {
    throw new Error("fixture must end with a failed request");
  }
  terminalRequest.failure = {
    kind: "transport",
    message: "different terminal failure",
    retryable: true,
  };
  Object.assign(artifact, {
    status: "incomplete",
    incompleteReason: {
      kind: "research-evidence-unavailable",
      detail: "The first Search Attempt exhausted transport recovery.",
      reentryCondition: "arXiv access is restored for a future open decision.",
    },
    researchEvidence,
    findings: [],
    excludedPapers: [],
    readingFailures: [],
    angles: [],
    recommendedPath: null,
    alternates: [],
    pitfalls: [],
  } satisfies Partial<ResearchRunArtifact>);

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("terminal failure does not match")));
});

test("Research Run validation accepts a deadline before any HTTP request", async () => {
  const artifact = await completeArtifact();
  const failure = {
    kind: "deadline-exhausted" as const,
    message: "Research Evidence retrieval deadline exhausted",
    retryable: false,
  };
  const researchEvidence = await createResearchEvidenceCollector({
    async search() {
      return { status: "failed" as const, failure, requests: [] };
    },
  })(request());
  Object.assign(artifact, {
    status: "incomplete",
    incompleteReason: {
      kind: "research-evidence-unavailable",
      detail: "The retrieval deadline expired before a request could start.",
      reentryCondition: "A future open decision has a fresh retrieval window.",
    },
    researchEvidence,
    findings: [],
    excludedPapers: [],
    readingFailures: [],
    angles: [],
    recommendedPath: null,
    alternates: [],
    pitfalls: [],
  } satisfies Partial<ResearchRunArtifact>);

  assert.deepEqual(validateResearchRun(artifact), { valid: true, errors: [] });
});

test("Research Run validation rejects Thin Coverage presented as Complete", async () => {
  const artifact = await completeArtifact();
  artifact.researchEvidence.papers = artifact.researchEvidence.papers.slice(0, 2);
  artifact.researchEvidence.coverage = { status: "thin" };
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
    validation.errors.some((error) =>
      error.includes("2601.00003v1 has no finding, exclusion, or reading failure"),
    ),
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

test("Research Run validation requires the Reading Failure collection", async () => {
  const artifact = await completeArtifact();
  delete (artifact as Partial<ResearchRunArtifact>).readingFailures;

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("readingFailures must be an array"));
});

test("Research Run validation rejects a Reading Failure under the wrong incomplete reason", async () => {
  const artifact = await completeArtifact();
  const failedVersion = artifact.findings[0].paperVersion;
  artifact.status = "incomplete";
  artifact.incompleteReason = {
    kind: "evidence-chain-broken",
    detail: "The evidence chain is incomplete.",
    reentryCondition: "The evidence chain can be reconstructed.",
  };
  artifact.findings = artifact.findings.slice(1);
  artifact.readingFailures = [
    {
      paperVersion: failedVersion,
      kind: "isolation-broken",
      detail: "The bounded clean re-read still observed sibling Paper content.",
    },
  ];
  artifact.angles = [];
  artifact.recommendedPath = null;
  artifact.alternates = [];
  artifact.pitfalls = [];

  const validation = validateResearchRun(artifact);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.includes("Reading Failures require an incomplete isolation-broken outcome"),
  );
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
