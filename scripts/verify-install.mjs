import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SKILLS_CLI_VERSION } from "./install-contract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceSkill = join(root, "skills", "neuroarxiv");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const sourceSmoke = spawnSync(
  process.execPath,
  [join(sourceSkill, "scripts", "search.mjs"), "--help"],
  { encoding: "utf8" },
);
if (
  sourceSmoke.status !== 0 ||
  !sourceSmoke.stdout.includes("caller-selected arXiv categories and reasons") ||
  !sourceSmoke.stdout.includes("atomically publish JSON instead")
) {
  throw new Error(sourceSmoke.stderr || "self-contained Skill helper failed its smoke check");
}
const validationSmoke = spawnSync(
  process.execPath,
  [join(sourceSkill, "scripts", "validate.mjs"), "--help"],
  { encoding: "utf8" },
);
if (validationSmoke.status !== 0 || !validationSmoke.stdout.includes("research-run.json")) {
  throw new Error(validationSmoke.stderr || "self-contained validation helper failed its smoke check");
}

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 20)) {
  process.stdout.write(
    "Self-contained Skill helper passed; standard lifecycle requires Node 22.20+ and was skipped.\n",
  );
  process.exit(0);
}

const testRoot = mkdtempSync(join(tmpdir(), "neuroarxiv-skills-lifecycle-"));
const canonical = join(testRoot, ".agents", "skills", "neuroarxiv");
const claudeLink = join(testRoot, ".claude", "skills", "neuroarxiv");
const sentinel = join(testRoot, ".agents", "skills", "keep-me", "SKILL.md");

function run(args) {
  const commandEnvironment = {
    ...process.env,
    HOME: testRoot,
    USERPROFILE: testRoot,
    npm_config_cache: join(testRoot, ".npm-cache"),
  };
  for (const inheritedOption of ["npm_config_package", "npm_config_call", "npm_command"]) {
    delete commandEnvironment[inheritedOption];
  }
  const result = spawnSync(
    npm,
    ["exec", "--yes", `--package=skills@${SKILLS_CLI_VERSION}`, "--", "skills", ...args],
    {
      cwd: testRoot,
      encoding: "utf8",
      env: commandEnvironment,
    },
  );
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
  return result;
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function fileManifest(directory, base = directory) {
  const files = new Map();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, contents] of fileManifest(entryPath, base)) files.set(name, contents);
    } else if (entry.isFile()) {
      files.set(relative(base, entryPath), readFileSync(entryPath));
    } else {
      throw new Error(`unexpected non-file entry in Skill bundle: ${entryPath}`);
    }
  }
  return files;
}

function assertInstalledBundle() {
  const sourceFiles = fileManifest(sourceSkill);
  const installedFiles = fileManifest(canonical);
  if (
    JSON.stringify([...installedFiles.keys()].sort()) !==
    JSON.stringify([...sourceFiles.keys()].sort())
  ) {
    throw new Error("installed Skill manifest does not match the source bundle");
  }
  for (const [name, contents] of sourceFiles) {
    if (!contents.equals(installedFiles.get(name))) {
      throw new Error(`installed Skill file differs from source: ${name}`);
    }
  }
  if (realpathSync(claudeLink) !== realpathSync(canonical)) {
    throw new Error("Claude Code symlink does not resolve to the canonical Skill");
  }
}

try {
  mkdirSync(dirname(sentinel), { recursive: true });
  writeFileSync(sentinel, "---\nname: keep-me\ndescription: installation sentinel\n---\n");

  run([
    "add",
    root,
    "--skill",
    "neuroarxiv",
    "--global",
    "--agent",
    "codex",
    "--agent",
    "claude-code",
    "--yes",
  ]);

  if (!existsSync(join(canonical, "SKILL.md"))) {
    throw new Error("standard installer did not create the canonical Skill");
  }
  if (!lstatSync(claudeLink).isSymbolicLink()) {
    throw new Error("Claude Code install is not a symlink to the canonical Skill");
  }
  assertInstalledBundle();

  run(["update", "--global", "neuroarxiv", "--yes"]);
  if (!existsSync(join(canonical, "SKILL.md")) || !lstatSync(claudeLink).isSymbolicLink()) {
    throw new Error("standard updater did not preserve the canonical Skill and Agent symlink");
  }
  assertInstalledBundle();

  const installedSmoke = spawnSync(
    process.execPath,
    [join(canonical, "scripts", "search.mjs"), "--help"],
    { encoding: "utf8" },
  );
  if (
    installedSmoke.status !== 0 ||
    !installedSmoke.stdout.includes("caller-selected arXiv categories and reasons") ||
    !installedSmoke.stdout.includes("atomically publish JSON instead")
  ) {
    throw new Error(installedSmoke.stderr || "installed search wrapper failed its smoke check");
  }
  const installedValidationSmoke = spawnSync(
    process.execPath,
    [join(canonical, "scripts", "validate.mjs"), "--help"],
    { encoding: "utf8" },
  );
  if (
    installedValidationSmoke.status !== 0 ||
    !installedValidationSmoke.stdout.includes("research-run.json")
  ) {
    throw new Error(
      installedValidationSmoke.stderr || "installed validation wrapper failed its smoke check",
    );
  }
  const budgetFlagSmoke = spawnSync(
    process.execPath,
    [
      join(canonical, "scripts", "search.mjs"),
      "Budget propagation smoke",
      "--categories",
      "cs.DC",
      "--terms",
      "retry suppression",
      "--max-full-text-papers",
      "21",
      "--json",
    ],
    { encoding: "utf8" },
  );
  if (
    budgetFlagSmoke.status === 0 ||
    !budgetFlagSmoke.stderr.includes("budget.maxFullTextPapers")
  ) {
    throw new Error("installed search wrapper did not propagate the full-text budget flag");
  }

  run(["remove", "--global", "neuroarxiv", "--yes"]);

  if (pathExists(canonical) || pathExists(claudeLink)) {
    throw new Error("standard uninstaller left the Skill or an Agent symlink behind");
  }
  if (!existsSync(sentinel)) {
    throw new Error("standard lifecycle changed an unrelated Skill");
  }

  const lockPath = join(testRoot, ".agents", ".skill-lock.json");
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    if (Object.hasOwn(lock.skills ?? {}, "neuroarxiv")) {
      throw new Error("standard uninstaller left a stale lock entry");
    }
  }

  process.stdout.write(
    "Standard global install, update, Claude symlink, helper smoke, and uninstall all passed.\n",
  );
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
