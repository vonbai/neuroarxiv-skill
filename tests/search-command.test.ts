import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSearchCommand, parseSearch } from "../src/search-command.ts";
import type { ResearchEvidenceResult } from "../src/types.ts";

const EVIDENCE: ResearchEvidenceResult = {
  problem: "Suppress duplicate execution after retries",
  searchPlan: {
    categories: [{ id: "cs.DC", why: "distributed coordination" }],
    terms: ["retry suppression"],
    expansionTerms: [],
    sinceYears: 8,
  },
  budget: {
    maxPapers: 12,
    maxFullTextPapers: 3,
  },
  papers: [],
  attempts: [],
  coverage: { status: "empty" },
  termination: { reason: "search-plan-exhausted" },
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("search CLI preserves category reasons and every explicit Paper budget", () => {
  const flags = parseSearch([
    "Suppress duplicate execution after retries",
    "--categories",
    "cs.DC=distributed coordination,cs.DB=durable deduplication",
    "--terms",
    "retry suppression,idempotent execution",
    "--max-full-text-papers",
    "5",
    "--max-papers",
    "7",
    "--output",
    "/tmp/neuroarxiv-search-flags.json",
  ]);

  assert.deepEqual(flags?.categories, [
    { id: "cs.DC", why: "distributed coordination" },
    { id: "cs.DB", why: "durable deduplication" },
  ]);
  assert.equal(flags?.maxFullTextPapers, 5);
  assert.equal(flags?.maxPapers, 7);
});

test("search CLI passes every explicit Paper budget through the Research Run seam", async () => {
  const directory = await mkdtemp(join(tmpdir(), "neuroarxiv-search-budget-"));
  const output = join(directory, "research-evidence.json");
  let observedRequest: Parameters<NonNullable<Parameters<typeof createSearchCommand>[0]["collect"]>>[0] | undefined;
  const command = createSearchCommand({
    collect: async (request) => {
      observedRequest = request;
      return EVIDENCE;
    },
    stderr: () => undefined,
  });

  try {
    await command([
      EVIDENCE.problem,
      "--categories",
      "cs.DC=distributed coordination",
      "--terms",
      "retry suppression",
      "--max-papers",
      "7",
      "--max-full-text-papers",
      "5",
      "--output",
      output,
    ]);

    assert.deepEqual(observedRequest?.budget, { maxPapers: 7, maxFullTextPapers: 5 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("search CLI accepts plain category ids", () => {
  const flags = parseSearch([
    "Choose a retry mechanism",
    "--categories",
    "cs.DC",
    "--terms",
    "retry semantics",
    "--output",
    "/tmp/neuroarxiv-plain-category.json",
  ]);

  assert.deepEqual(flags?.categories, [{ id: "cs.DC", why: "caller-selected" }]);
});

test("search CLI has exactly one result path and requires an Evidence Artifact", () => {
  assert.throws(
    () =>
      parseSearch([
        "Choose a retry mechanism",
        "--categories",
        "cs.DC",
        "--terms",
        "retry semantics",
      ]),
    /--output requires a fresh file path/i,
  );
  assert.throws(
    () =>
      parseSearch([
        "Choose a retry mechanism",
        "--categories",
        "cs.DC",
        "--terms",
        "retry semantics",
        "--json",
      ]),
    /unknown search flag: --json/i,
  );
});

test("search CLI gives one running process ownership and atomically publishes one Evidence Artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "neuroarxiv-search-command-"));
  const output = join(directory, "research-evidence.json");
  const pending = `${output}.pending`;
  let finishCollection: ((result: ResearchEvidenceResult) => void) | undefined;
  let markCollectionStarted: (() => void) | undefined;
  const collectionStarted = new Promise<void>((resolve) => {
    markCollectionStarted = resolve;
  });
  let collections = 0;
  const stderr: string[] = [];
  const command = createSearchCommand({
    collect: async () => {
      collections += 1;
      markCollectionStarted?.();
      return new Promise((resolve) => {
        finishCollection = resolve;
      });
    },
    stderr: (message) => stderr.push(message),
  });
  const argv = [
    EVIDENCE.problem,
    "--categories",
    "cs.DC=distributed coordination",
    "--terms",
    "retry suppression",
    "--output",
    output,
  ];

  try {
    const running = command(argv);
    await collectionStarted;

    assert.equal(collections, 1);
    assert.equal(await pathExists(output), false, "final artifact must remain absent while retrieval runs");
    assert.equal(await pathExists(pending), true, "the active Research Run must own the output path");
    assert.match(stderr.join(""), /wait for this process to exit/i);
    await assert.rejects(command(argv), /already owned/i);
    assert.equal(collections, 1, "an accidental rerun must fail before another retrieval starts");

    assert.ok(finishCollection);
    finishCollection(EVIDENCE);
    await running;

    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), EVIDENCE);
    assert.equal(await pathExists(pending), false);
    await assert.rejects(command(argv), /already exists/i);
    assert.equal(collections, 1, "a completed Evidence Artifact must not be overwritten or recollected");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("search CLI releases ownership after a handled failure so bounded recovery can reuse the path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "neuroarxiv-search-recovery-"));
  const output = join(directory, "research-evidence.json");
  const argv = [
    EVIDENCE.problem,
    "--categories",
    "cs.DC=distributed coordination",
    "--terms",
    "retry suppression",
    "--output",
    output,
  ];
  const silent = () => undefined;

  try {
    const failing = createSearchCommand({
      collect: async () => {
        throw new Error("fixture interruption");
      },
      stderr: silent,
    });
    await assert.rejects(failing(argv), /fixture interruption/);
    assert.equal(await pathExists(output), false);
    assert.equal(await pathExists(`${output}.pending`), false);

    const recovered = createSearchCommand({
      collect: async () => EVIDENCE,
      stderr: silent,
    });
    await recovered(argv);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), EVIDENCE);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
