import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_FILES, RUNTIME_PACKAGE_JSON } from "./runtime-contract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const target = join(root, "skills", "neuroarxiv", "runtime");

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
writeFileSync(join(target, "package.json"), RUNTIME_PACKAGE_JSON);
for (const file of RUNTIME_FILES) copyFileSync(join(dist, file), join(target, file));

process.stdout.write("Synchronized the generated Skill runtime projection.\n");
