import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_FILES, RUNTIME_PACKAGE_JSON } from "./runtime-contract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const runtime = join(root, "skills", "neuroarxiv", "runtime");
const errors = [];
const expectedFiles = [...RUNTIME_FILES, "package.json"].sort();
const actualFiles = existsSync(runtime) ? readdirSync(runtime).sort() : [];
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  errors.push(
    `runtime file set must be exactly: ${expectedFiles.join(", ")}; found: ${actualFiles.join(", ")}`,
  );
}

for (const file of RUNTIME_FILES) {
  const source = join(dist, file);
  const projection = join(runtime, file);
  if (!existsSync(projection)) {
    errors.push(`missing generated runtime file: ${file}`);
  } else if (readFileSync(source, "utf8") !== readFileSync(projection, "utf8")) {
    errors.push(`stale generated runtime file: ${file}`);
  }
}

const packageJson = join(runtime, "package.json");
if (!existsSync(packageJson) || readFileSync(packageJson, "utf8") !== RUNTIME_PACKAGE_JSON) {
  errors.push("runtime/package.json must declare the isolated ESM scope");
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.stderr.write("Run npm run sync:skill-runtime and commit the projection.\n");
  process.exit(1);
}

process.stdout.write("Generated Skill runtime matches the TypeScript source.\n");
