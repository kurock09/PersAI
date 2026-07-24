import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const testDir = dirname(fileURLToPath(import.meta.url));
const tsxPackagePath = require.resolve("tsx/package.json");
const tsxCliPath = join(dirname(tsxPackagePath), "dist", "cli.mjs");

const testFiles = readdirSync(testDir)
  .filter(
    (file) =>
      file.endsWith(".test.ts") &&
      !file.includes(".e2e.") &&
      // SQL-backed migration/integration probes need a live Postgres; keep them
      // out of the default no-SQL CI-like gate (same policy as `.e2e.`).
      !file.includes(".integration.")
  )
  .sort();

if (testFiles.length === 0) {
  throw new Error(`No API test files found in ${testDir}.`);
}

for (const file of testFiles) {
  const fullPath = join(testDir, file);
  process.stdout.write(`\n[api test suite] ${file}\n`);
  const result = spawnSync(process.execPath, [tsxCliPath, fullPath], {
    cwd: dirname(testDir),
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
