import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = join(root, "skills", "neuroarxiv");
const skillPath = join(skillDir, "SKILL.md");
const errors = [];

function requireCondition(condition, message) {
  if (!condition) errors.push(message);
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
requireCondition(existsSync(join(skillDir, "agents", "openai.yaml")), "missing Agent metadata");

const metadata = readFileSync(join(skillDir, "agents", "openai.yaml"), "utf8");
requireCondition(/display_name: "NeuroArxiv"/.test(metadata), "Agent display name is stale");
requireCondition(/default_prompt: "Use \$neuroarxiv /.test(metadata), "default prompt must invoke $neuroarxiv");

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
requireCondition(!packageJson.dependencies, "production dependencies must stay empty");
requireCondition(packageJson.name === "neuroarxiv-skill", "package identity is stale");

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
process.stdout.write("Skill structure and package contract are valid.\n");
