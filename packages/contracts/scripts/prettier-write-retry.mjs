import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { format, resolveConfig } from "prettier";

// Windows can transiently report these while replacing a file that a scanner/indexer
// still holds. Access-denied errors are not retried because they normally mean policy.
const RETRYABLE_WRITE_CODES = new Set(["EBUSY", "EPERM", "UNKNOWN"]);
const MAX_WRITE_ATTEMPTS = 20;
const WRITE_RETRY_DELAY_MS = 250;

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

async function writeWithRetry(filePath, content) {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    try {
      await writeFile(filePath, content, "utf8");
      return;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (!RETRYABLE_WRITE_CODES.has(code) || attempt === MAX_WRITE_ATTEMPTS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, WRITE_RETRY_DELAY_MS));
    }
  }
}

const target = process.argv[2];
if (target === undefined) {
  throw new Error("Usage: node prettier-write-retry.mjs <directory>");
}

const files = await collectTypeScriptFiles(path.resolve(process.cwd(), target));
for (const filePath of files) {
  const source = await readFile(filePath, "utf8");
  const config = (await resolveConfig(filePath)) ?? {};
  const formatted = await format(source, {
    ...config,
    filepath: filePath
  });
  if (formatted !== source) {
    await writeWithRetry(filePath, formatted);
  }
}
