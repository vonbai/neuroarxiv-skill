import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const testRoot = mkdtempSync(join(tmpdir(), "neuroarxiv-install-"));
const destination = join(testRoot, "neuroarxiv");

try {
  const install = spawnSync(
    process.execPath,
    ["dist/cli.js", "install", "--destination", destination],
    { encoding: "utf8" },
  );
  if (install.status !== 0) throw new Error(install.stderr || "Skill installation failed");

  const expected = [
    "SKILL.md",
    "agents/openai.yaml",
    "references/arxiv-categories.md",
    "scripts/search.mjs",
    "runtime/arxiv.js",
    "runtime/research-run.js",
    "runtime/search-cli.js",
    "runtime/search-command.js",
  ];
  for (const file of expected) {
    if (!existsSync(join(destination, file))) throw new Error(`installed bundle is missing ${file}`);
  }
  const runtimeFiles = readdirSync(join(destination, "runtime")).sort();
  const expectedRuntime = ["arxiv.js", "research-run.js", "search-cli.js", "search-command.js"];
  if (JSON.stringify(runtimeFiles) !== JSON.stringify(expectedRuntime)) {
    throw new Error(`installed runtime is wider than expected: ${runtimeFiles.join(", ")}`);
  }

  const smoke = spawnSync(
    process.execPath,
    [join(destination, "scripts", "search.mjs"), "--help"],
    { encoding: "utf8" },
  );
  if (smoke.status !== 0 || !smoke.stdout.includes("caller-selected arXiv category ids")) {
    throw new Error(smoke.stderr || "installed search wrapper failed its smoke check");
  }
  process.stdout.write("Installed Skill bundle is complete and isolated.\n");
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
