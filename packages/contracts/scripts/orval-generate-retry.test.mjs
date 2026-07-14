import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_ORVAL_ATTEMPTS,
  ORVAL_CONFIG_RELATIVE_PATH,
  ORVAL_RETRY_DELAY_MS,
  isRetryableOrvalOutput,
  resolveOrvalCliPath,
  runOrvalWithRetries
} from "./orval-generate-retry.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(scriptsDir, "..", "package.json");

describe("orval-generate-retry classifier", () => {
  it("retries UNKNOWN open replacement failures", () => {
    assert.equal(
      isRetryableOrvalOutput(
        "",
        "UNKNOWN: unknown error, open 'C:\\repo\\packages\\contracts\\src\\generated\\step2-client.ts'"
      ),
      true
    );
  });

  it("retries EBUSY and EPERM open failures", () => {
    assert.equal(
      isRetryableOrvalOutput("", "Error: EBUSY: resource busy or locked, open 'x.ts'"),
      true
    );
    assert.equal(isRetryableOrvalOutput("EPERM: operation not permitted, open 'y.ts'", ""), true);
  });

  it("never retries EACCES or access denied", () => {
    assert.equal(
      isRetryableOrvalOutput("", "Error: EACCES: permission denied, open 'x.ts'"),
      false
    );
    assert.equal(isRetryableOrvalOutput("", "access denied while writing generated file"), false);
    assert.equal(
      isRetryableOrvalOutput("", "EBUSY: resource busy\nEACCES: permission denied, open 'x.ts'"),
      false
    );
  });

  it("never retries schema or arbitrary generator failures", () => {
    assert.equal(isRetryableOrvalOutput("", "Error: Schema validation failed at #/paths"), false);
    assert.equal(
      isRetryableOrvalOutput("orval failed with exit code 1", "Unexpected token"),
      false
    );
    assert.equal(isRetryableOrvalOutput("", ""), false);
  });
});

describe("orval-generate-retry runner", () => {
  it("retries only transient open failures then succeeds", async () => {
    let attempts = 0;
    const stdoutChunks = [];
    const stderrChunks = [];
    const status = await runOrvalWithRetries({
      cliPath: "unused",
      cwd: scriptsDir,
      maxAttempts: 3,
      delayMs: 1,
      runOnce: async () => {
        attempts += 1;
        if (attempts < 2) {
          return {
            status: 1,
            stdout: "",
            stderr:
              "UNKNOWN: unknown error, open 'C:\\repo\\packages\\contracts\\src\\generated\\step2-client.ts'"
          };
        }
        return { status: 0, stdout: "ok-out\n", stderr: "ok-err\n" };
      },
      writeStdout: (text) => stdoutChunks.push(text),
      writeStderr: (text) => stderrChunks.push(text)
    });

    assert.equal(status, 0);
    assert.equal(attempts, 2);
    assert.deepEqual(stdoutChunks, ["ok-out\n"]);
    assert.deepEqual(stderrChunks, ["ok-err\n"]);
  });

  it("does not retry non-transient nonzero exits and preserves final output", async () => {
    let attempts = 0;
    const stdoutChunks = [];
    const stderrChunks = [];
    const status = await runOrvalWithRetries({
      cliPath: "unused",
      cwd: scriptsDir,
      maxAttempts: 5,
      delayMs: 1,
      runOnce: async () => {
        attempts += 1;
        return {
          status: 2,
          stdout: "partial\n",
          stderr: "Error: Schema validation failed at #/components/schemas/Foo"
        };
      },
      writeStdout: (text) => stdoutChunks.push(text),
      writeStderr: (text) => stderrChunks.push(text)
    });

    assert.equal(status, 2);
    assert.equal(attempts, 1);
    assert.deepEqual(stdoutChunks, ["partial\n"]);
    assert.deepEqual(stderrChunks, ["Error: Schema validation failed at #/components/schemas/Foo"]);
  });

  it("exhausts bounded retries for persistent UNKNOWN open failures", async () => {
    let attempts = 0;
    const status = await runOrvalWithRetries({
      cliPath: "unused",
      cwd: scriptsDir,
      maxAttempts: 3,
      delayMs: 1,
      runOnce: async () => {
        attempts += 1;
        return {
          status: 1,
          stdout: "",
          stderr: "UNKNOWN: unknown error, open 'step2-client.ts'"
        };
      },
      writeStdout: () => {},
      writeStderr: () => {}
    });

    assert.equal(status, 1);
    assert.equal(attempts, 3);
  });

  it("resolves the repository Orval CLI and keeps package wiring honest", () => {
    const cliPath = resolveOrvalCliPath();
    assert.match(cliPath.replaceAll("\\", "/"), /\/orval\/dist\/bin\/orval\.js$/);
    assert.equal(MAX_ORVAL_ATTEMPTS > 1, true);
    assert.equal(ORVAL_RETRY_DELAY_MS > 0, true);
    assert.equal(ORVAL_CONFIG_RELATIVE_PATH, "./orval.config.cjs");

    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.match(
      packageJson.scripts.generate,
      /node scripts\/orval-generate-retry\.mjs && node scripts\/prettier-write-retry\.mjs src\/generated/
    );
    assert.doesNotMatch(packageJson.scripts.generate, /\borval --config/);
  });
});
