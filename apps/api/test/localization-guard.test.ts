import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(API_TEST_DIR, "..", "..", "..");

const GUARDED_ROOTS = [
  join(API_TEST_DIR, "..", "src", "modules", "workspace-management", "application"),
  join(API_TEST_DIR, "..", "src", "modules", "identity-access", "application"),
  join(REPO_ROOT, "apps", "web", "app")
] as const;

const FORBIDDEN_SNIPPETS = [
  'locale: "ru",',
  "longMessage ??",
  "fieldErrors.identifier.message",
  "fieldErrors.password.message",
  "fieldErrors.emailAddress.message",
  "fieldErrors.code.message",
  'error instanceof Error ? error.message : t("profileSaveFailed")',
  'error instanceof Error ? error.message : t("avatarSaveFailed")',
  'error instanceof Error ? error.message : t("passwordSaveFailed")'
] as const;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

function run(): void {
  const offenders: string[] = [];

  for (const root of GUARDED_ROOTS) {
    for (const file of walk(root)) {
      const content = readFileSync(file, "utf8");
      const relative = file.replace(/\\/g, "/");

      if (relative.includes("notifications/templates/billing/")) {
        continue;
      }

      for (const snippet of FORBIDDEN_SNIPPETS) {
        if (content.includes(snippet)) {
          offenders.push(`${relative} contains ${snippet}`);
        }
      }
    }
  }

  assert.equal(offenders.length, 0, `Localization guard failed:\n${offenders.join("\n")}`);
}

run();
