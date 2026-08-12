import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(root, "skills", "neuroarxiv", "SKILL.md"), "utf8");
const receipt = JSON.parse(
  readFileSync(join(root, "evals", "agent-journey-v0.5.json"), "utf8"),
);
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const errors = [];

function requireCondition(condition, message) {
  if (!condition) errors.push(message);
}

function caseById(id) {
  return Array.isArray(receipt.cases)
    ? receipt.cases.find((candidate) => candidate?.id === id)
    : undefined;
}

const skillSha256 = createHash("sha256").update(skill).digest("hex");
requireCondition(receipt.receiptVersion === 1, "forward-eval receiptVersion must be 1");
requireCondition(
  receipt.packageVersion === packageJson.version,
  "forward-eval receipt must match the package version",
);
requireCondition(
  receipt.skillSha256 === skillSha256,
  "forward-eval receipt is stale for the current SKILL.md snapshot",
);
requireCondition(
  typeof receipt.evaluatedAt === "string" && !Number.isNaN(Date.parse(receipt.evaluatedAt)),
  "forward-eval receipt requires a valid evaluatedAt timestamp",
);
requireCondition(
  receipt.evaluator === "fresh-isolated-agent",
  "forward-eval receipt must come from a fresh isolated Agent",
);
requireCondition(
  Array.isArray(receipt.cases) && receipt.cases.length === 3,
  "forward-eval receipt must contain exactly three journey cases",
);

const explicitEntry = caseById("explicit-entry");
requireCondition(
  explicitEntry?.observedOutcome === "started" && Boolean(explicitEntry.evidence),
  "explicit invocation must be observed starting the Research Run",
);

const implicitTrivial = caseById("implicit-trivial");
requireCondition(
  implicitTrivial?.observedOutcome === "inactive" && Boolean(implicitTrivial.evidence),
  "a trivial fixed-mechanism task must be observed staying inactive",
);

const contamination = caseById("persistent-contamination");
const disposition = contamination?.evidence?.paperDisposition?.toLowerCase();
requireCondition(
  contamination?.observedOutcome === "incomplete-isolation-broken" &&
    contamination.evidence?.boundedRecoveryCount === 1 &&
    disposition?.includes("readingfailures") &&
    disposition.includes("isolation-broken") &&
    contamination.evidence?.recommendedPath === null &&
    contamination.evidence?.reentryRequired === true,
  "persistent sibling contamination must be observed closing as a traceable Reading Failure",
);

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exit(1);
}

process.stdout.write("Snapshot-bound Agent journey forward evaluation is valid.\n");
