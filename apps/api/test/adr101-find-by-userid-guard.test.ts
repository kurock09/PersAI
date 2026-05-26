import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const forbiddenPatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: "findByUserId", pattern: /\bfindByUserId\b/ },
  { label: "updateDraft(userId)", pattern: /\bupdateDraft\s*\(\s*userId\b/ },
  { label: "markApplyPending(userId)", pattern: /\bmarkApplyPending\s*\(\s*userId\b/ },
  { label: "markApplyInProgress(userId)", pattern: /\bmarkApplyInProgress\s*\(\s*userId\b/ },
  { label: "markApplySucceeded(userId)", pattern: /\bmarkApplySucceeded\s*\(\s*userId\b/ },
  { label: "markApplyFailed(userId)", pattern: /\bmarkApplyFailed\s*\(\s*userId\b/ },
  { label: "markApplyDegraded(userId)", pattern: /\bmarkApplyDegraded\s*\(\s*userId\b/ }
];

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

const offenders = listTypeScriptFiles(sourceRoot).flatMap((path) => {
  const content = readFileSync(path, "utf8");
  const relativePath = relative(sourceRoot, path).split(sep).join("/");
  return forbiddenPatterns
    .filter(({ pattern }) => pattern.test(content))
    .map(({ label }) => `${relativePath} :: ${label}`);
});

assert.deepEqual(
  offenders,
  [],
  "ADR-101 cleanup forbids returning user-only assistant repository methods or callers in active source."
);
