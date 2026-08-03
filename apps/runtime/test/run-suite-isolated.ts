import { spawnSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const testDir = dirname(fileURLToPath(import.meta.url));
const tsxPackagePath = require.resolve("tsx/package.json");
const tsxCliPath = join(dirname(tsxPackagePath), "dist", "cli.mjs");

const testFiles = globSync("*.test.ts", { cwd: testDir })
  .filter((file) => !file.includes(".e2e.") && !file.includes(".integration."))
  .sort();

if (testFiles.length === 0) {
  throw new Error(`No runtime test files found in ${testDir}.`);
}

for (const file of testFiles) {
  const fullPath = join(testDir, file);
  process.stdout.write(`\n[runtime test suite] ${file}\n`);
  const isNodeTest = /from\s+["']node:test["']/u.test(readFileSync(fullPath, "utf8"));
  const args = isNodeTest
    ? [tsxCliPath, "--test", fullPath]
    : [tsxCliPath, join(testDir, "run-one.ts"), fullPath];
  const result = spawnSync(process.execPath, args, {
    cwd: dirname(testDir),
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
