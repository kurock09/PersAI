import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

// Orval can fail mid-write on Windows when a scanner still holds the target file.
// Retry only when captured output proves a transient replacement/open error.
export const MAX_ORVAL_ATTEMPTS = 5;
export const ORVAL_RETRY_DELAY_MS = 250;
export const ORVAL_CONFIG_RELATIVE_PATH = "./orval.config.cjs";

/**
 * @param {string} stdout
 * @param {string} stderr
 * @returns {boolean}
 */
export function isRetryableOrvalOutput(stdout, stderr) {
  const combined = `${stdout}\n${stderr}`;
  if (/\bEACCES\b|access denied/i.test(combined)) {
    return false;
  }
  if (/UNKNOWN:[^\n]*\bopen\b/i.test(combined)) {
    return true;
  }
  if (/\bEBUSY\b/.test(combined)) {
    return true;
  }
  if (/\bEPERM\b/.test(combined)) {
    return true;
  }
  return false;
}

/**
 * @param {string} moduleUrl
 * @returns {string}
 */
export function resolveOrvalCliPath(moduleUrl = import.meta.url) {
  const require = createRequire(moduleUrl);
  const entry = require.resolve("orval");
  let dir = path.dirname(entry);
  for (;;) {
    const candidate = path.join(dir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf8"));
      if (pkg.name === "orval") {
        const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.orval;
        if (typeof bin !== "string" || bin.length === 0) {
          throw new Error(`orval package at ${candidate} is missing a bin entry`);
        }
        return path.resolve(dir, bin);
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        // keep walking
      } else if (
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        String(error.message).includes("missing a bin entry")
      ) {
        throw error;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Unable to resolve orval package root from ${entry}`);
    }
    dir = parent;
  }
}

/**
 * @param {{
 *   cliPath: string;
 *   configPath?: string;
 *   cwd: string;
 *   env?: NodeJS.ProcessEnv;
 *   execPath?: string;
 * }} options
 * @returns {Promise<{ status: number; stdout: string; stderr: string }>}
 */
export function runOrvalOnce(options) {
  const {
    cliPath,
    configPath = ORVAL_CONFIG_RELATIVE_PATH,
    cwd,
    env = process.env,
    execPath = process.execPath
  } = options;

  return new Promise((resolve) => {
    const child = spawn(execPath, [cliPath, "--config", configPath], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      resolve({
        status: 1,
        stdout,
        stderr: stderr.length > 0 ? `${stderr}\n${message}` : message
      });
    });
    child.on("close", (code) => {
      resolve({
        status: typeof code === "number" ? code : 1,
        stdout,
        stderr
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{
 *   cliPath?: string;
 *   cwd?: string;
 *   maxAttempts?: number;
 *   delayMs?: number;
 *   runOnce?: typeof runOrvalOnce;
 *   writeStdout?: (text: string) => void;
 *   writeStderr?: (text: string) => void;
 * }} [options]
 * @returns {Promise<number>}
 */
export async function runOrvalWithRetries(options = {}) {
  const cwd = options.cwd ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cliPath = options.cliPath ?? resolveOrvalCliPath();
  const maxAttempts = options.maxAttempts ?? MAX_ORVAL_ATTEMPTS;
  const delayMs = options.delayMs ?? ORVAL_RETRY_DELAY_MS;
  const runOnce = options.runOnce ?? runOrvalOnce;
  const writeStdout = options.writeStdout ?? ((text) => process.stdout.write(text));
  const writeStderr = options.writeStderr ?? ((text) => process.stderr.write(text));

  let lastResult = { status: 1, stdout: "", stderr: "" };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await runOnce({ cliPath, cwd });
    if (lastResult.status === 0) {
      if (lastResult.stdout.length > 0) writeStdout(lastResult.stdout);
      if (lastResult.stderr.length > 0) writeStderr(lastResult.stderr);
      return 0;
    }

    const retryable = isRetryableOrvalOutput(lastResult.stdout, lastResult.stderr);
    if (!retryable || attempt === maxAttempts) {
      if (lastResult.stdout.length > 0) writeStdout(lastResult.stdout);
      if (lastResult.stderr.length > 0) writeStderr(lastResult.stderr);
      return lastResult.status;
    }

    await sleep(delayMs);
  }

  if (lastResult.stdout.length > 0) writeStdout(lastResult.stdout);
  if (lastResult.stderr.length > 0) writeStderr(lastResult.stderr);
  return lastResult.status;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const status = await runOrvalWithRetries();
  process.exit(status);
}
