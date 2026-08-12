import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_FILES } from "./runtime-contract.mjs";
import { SKILLS_CLI_VERSION } from "./install-contract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = join(root, "skills", "neuroarxiv");
const skillPath = join(skillDir, "SKILL.md");
const errors = [];

function requireCondition(condition, message) {
  if (!condition) errors.push(message);
}

function numberedStep(number) {
  const match = new RegExp(`^## ${number}\\.[^\\n]*\\n`, "m").exec(skill);
  requireCondition(Boolean(match), `SKILL.md is missing ordered journey step ${number}`);
  if (!match) return "";
  const remainder = skill.slice(match.index + match[0].length);
  const nextHeading = remainder.search(/^## \d+\./m);
  return nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
}

const skill = readFileSync(skillPath, "utf8");
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
requireCondition(Boolean(frontmatter), "SKILL.md must have YAML frontmatter");
if (frontmatter) {
  const keys = [...frontmatter[1].matchAll(/^([a-z-]+):/gm)].map((match) => match[1]);
  requireCondition(keys.length === 2, "SKILL.md frontmatter must contain exactly two keys");
  requireCondition(keys.includes("name") && keys.includes("description"), "frontmatter requires name and description");
  requireCondition(/^name: neuroarxiv$/m.test(frontmatter[1]), "Skill name must match its folder");
}
requireCondition(skill.split("\n").length <= 500, "SKILL.md must stay below 500 lines");

for (const match of skill.matchAll(/\]\((references\/[^)]+)\)/g)) {
  requireCondition(existsSync(join(skillDir, match[1])), `missing Skill reference: ${match[1]}`);
}
requireCondition(existsSync(join(skillDir, "scripts", "search.mjs")), "missing deterministic search wrapper");
requireCondition(existsSync(join(skillDir, "scripts", "validate.mjs")), "missing deterministic validation wrapper");
requireCondition(existsSync(join(skillDir, "agents", "openai.yaml")), "missing Agent metadata");
requireCondition(
  skill.includes('--output "$evidence_file"') &&
    skill.includes("continue that same handle") &&
    /Evidence Artifact is the single source of\s+truth/.test(skill) &&
    skill.includes("one wall-clock deadline") &&
    skill.includes('research-evidence-empty') &&
    skill.includes('research-evidence-unavailable') &&
    !skill.includes("--json"),
  "Skill must preserve the single-owner Evidence Artifact journey",
);

const eligibilityStep = numberedStep(1);
requireCondition(
  /Proceed immediately when the user explicitly invokes/.test(eligibilityStep) &&
    /only when all three conditions hold/.test(eligibilityStep) &&
    /Otherwise continue the user's task without starting/.test(eligibilityStep),
  "Research Eligibility must preserve explicit entry and bounded implicit entry",
);

const framingStep = numberedStep(2);
const collectionStep = numberedStep(4);
requireCondition(
  /Apply an explicit caller override as written/.test(framingStep) &&
    collectionStep.includes("--max-papers <count>") &&
    collectionStep.includes("--max-full-text-papers <count>"),
  "the journey must propagate every explicit Paper budget",
);
requireCondition(
  /`ready` or `thin`: continue/.test(collectionStep) &&
    /`empty`: stop with/.test(collectionStep) &&
    /`unavailable`: stop with/.test(collectionStep) &&
    /never rerun\s+an Evidence Artifact whose coverage is `unavailable`/.test(collectionStep),
  "the journey must route every Research Evidence coverage state",
);

const readingStep = numberedStep(5);
requireCondition(
  readingStep.includes('"isolationStatus": "isolated"') &&
    readingStep.includes('`isolationStatus: "recovered"`') &&
    readingStep.includes("`readingFailures`") &&
    readingStep.includes('"kind": "isolation-broken"') &&
    /exactly one trustworthy\s+Finding, reasoned Exclusion, or traceable Reading Failure/.test(
      readingStep,
    ),
  "the journey must close every isolated-reading disposition",
);

const reportStep = numberedStep(8);
requireCondition(
  /For Complete or Thin Coverage/.test(reportStep) &&
    /For an Incomplete Research Run/.test(reportStep) &&
    reportStep.includes("incompleteReason.reentryCondition") &&
    /Omit empty recommendation, angle, alternate, and pitfall sections/.test(reportStep),
  "the journey must close complete, thin, and incomplete reporting",
);

const artifactReference = readFileSync(
  join(skillDir, "references", "research-run-artifact.md"),
  "utf8",
);
requireCondition(
  artifactReference.includes('"readingFailures"') &&
    artifactReference.includes('"reentryCondition"'),
  "the Artifact contract must own Reading Failures and re-entry",
);
for (const file of [...RUNTIME_FILES, "package.json"]) {
  requireCondition(existsSync(join(skillDir, "runtime", file)), `missing Skill runtime file: ${file}`);
}

const metadata = readFileSync(join(skillDir, "agents", "openai.yaml"), "utf8");
requireCondition(/display_name: "NeuroArxiv"/.test(metadata), "Agent display name is stale");
requireCondition(/default_prompt: "Use \$neuroarxiv /.test(metadata), "default prompt must invoke $neuroarxiv");

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
requireCondition(!packageJson.dependencies, "production dependencies must stay empty");
requireCondition(packageJson.name === "neuroarxiv-skill", "package identity is stale");
requireCondition(
  readFileSync(join(root, "src", "arxiv.ts"), "utf8").includes(
    `neuroarxiv-skill/${packageJson.version}`,
  ),
  "arXiv User-Agent must match the package version",
);

const readme = readFileSync(join(root, "README.md"), "utf8");
requireCondition(!readme.includes("--json"), "README must preserve one Evidence Artifact result path");
requireCondition(
  readme.includes(`npx skills@${SKILLS_CLI_VERSION} add vonbai/neuroarxiv-skill`),
  "README install command must use the verified Skills CLI version",
);
requireCondition(
  readme.includes(`npx skills@${SKILLS_CLI_VERSION} update neuroarxiv --global --yes`),
  "README update command must use the verified Skills CLI version",
);
requireCondition(
  readme.includes(`npx skills@${SKILLS_CLI_VERSION} remove neuroarxiv --global --yes`),
  "README removal command must use the verified Skills CLI version",
);

const productionFiles = [
  "src/arxiv.ts",
  "src/cli.ts",
  "src/index.ts",
  "src/research-run.ts",
  "src/search-cli.ts",
  "src/search-command.ts",
  "src/types.ts",
];
const forbidden = /@anthropic-ai|claude-agent-sdk|callLLM|criticModel|p-limit|from ["']zod["']/i;
for (const file of productionFiles) {
  requireCondition(!forbidden.test(readFileSync(join(root, file), "utf8")), `${file} contains a forbidden legacy dependency`);
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exit(1);
}
process.stdout.write("Skill structure, journey conformance, and package contract are valid.\n");
