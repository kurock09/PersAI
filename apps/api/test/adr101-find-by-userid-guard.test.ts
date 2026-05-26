import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const allowed = new Set([
  "modules/workspace-management/domain/assistant.repository.ts",
  "modules/workspace-management/infrastructure/persistence/prisma-assistant.repository.ts"
]);

function listTypeScriptFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  return entries.flatMap((entry) => {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return listTypeScriptFiles(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });
}

const offenders = listTypeScriptFiles(sourceRoot)
  .filter((path) => readFileSync(path, "utf8").includes("findByUserId"))
  .map((path) => relative(sourceRoot, path).split(sep).join("/"))
  .filter((path) => !allowed.has(path));

assert.deepEqual(
  offenders,
  [],
  "ADR-101 Slice 8 forbids active source callers of AssistantRepository.findByUserId"
);
