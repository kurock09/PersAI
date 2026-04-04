#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function parseArgs(argv) {
  const result = {
    json: false,
    strict: false,
    repo: path.resolve(__dirname, "..", "..", "openclaw"),
    baseTag: "persai-fork-base",
    patchDoc: "docs/PERSAI-FORK-PATCHES.md",
  };

  for (const arg of argv) {
    if (arg === "--json") {
      result.json = true;
      continue;
    }
    if (arg === "--strict") {
      result.strict = true;
      continue;
    }
    if (arg.startsWith("--repo=")) {
      result.repo = path.resolve(arg.slice("--repo=".length));
      continue;
    }
    if (arg.startsWith("--base-tag=")) {
      result.baseTag = arg.slice("--base-tag=".length).trim();
      continue;
    }
    if (arg.startsWith("--patch-doc=")) {
      result.patchDoc = arg.slice("--patch-doc=".length).trim();
    }
  }

  return result;
}

function runGit(repo, args) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function splitLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function classifyRisk(relPath) {
  const highRiskExact = new Set([
    "src/agents/agent-command.ts",
    "src/agents/command/types.ts",
    "src/gateway/server-http.ts",
    "src/gateway/server-runtime-state.ts",
    "src/media/store.ts",
    "src/agents/openclaw-tools.ts",
    "src/agents/tools/cron-tool.ts",
  ]);
  const highRiskPrefixes = [
    "src/config/",
    "src/secrets/",
    "src/memory/",
    "src/tts/",
  ];
  const lowerRiskPrefixes = [
    "src/gateway/persai-runtime/",
    "src/agents/persai-runtime-context.ts",
    "src/agents/persai-runtime-tool-limits.ts",
    "src/agents/tools/persai-tool-quota-status-tool.ts",
    "src/agents/tools/persai-workspace-attach-tool.ts",
    "src/plugin-sdk/persai-credential.ts",
  ];

  if (highRiskExact.has(relPath)) {
    return "high";
  }
  if (highRiskPrefixes.some((prefix) => relPath.startsWith(prefix))) {
    return "high";
  }
  if (lowerRiskPrefixes.some((prefix) => relPath.startsWith(prefix))) {
    return "lower";
  }
  return "other";
}

function isImplementationFile(relPath) {
  if (
    relPath.endsWith(".test.ts") ||
    relPath.endsWith(".test.js") ||
    relPath.endsWith(".test.mjs") ||
    relPath.endsWith(".spec.ts") ||
    relPath.endsWith(".spec.js")
  ) {
    return false;
  }

  return (
    relPath.startsWith("src/") ||
    relPath.startsWith("extensions/") ||
    relPath === "package.json" ||
    relPath === "tsconfig.json" ||
    relPath.startsWith("scripts/")
  );
}

function referencedInPatchDoc(doc, relPath) {
  return doc.includes(relPath);
}

function stableSort(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(options.repo)) {
    throw new Error(`OpenClaw repo not found at "${options.repo}".`);
  }

  const patchDocPath = path.join(options.repo, options.patchDoc);
  if (!fs.existsSync(patchDocPath)) {
    throw new Error(`Patch document not found at "${patchDocPath}".`);
  }

  runGit(options.repo, ["rev-parse", "--is-inside-work-tree"]);
  runGit(options.repo, ["rev-parse", "--verify", options.baseTag]);

  const patchDoc = fs.readFileSync(patchDocPath, "utf8");
  const changedFiles = splitLines(
    runGit(options.repo, ["diff", "--name-only", `${options.baseTag}..HEAD`]),
  );
  const implementationFiles = stableSort(changedFiles.filter(isImplementationFile));
  const highRiskFiles = stableSort(
    implementationFiles.filter((relPath) => classifyRisk(relPath) === "high"),
  );
  const lowerRiskFiles = stableSort(
    implementationFiles.filter((relPath) => classifyRisk(relPath) === "lower"),
  );
  const undocumentedImplementationFiles = stableSort(
    implementationFiles.filter((relPath) => !referencedInPatchDoc(patchDoc, relPath)),
  );
  const undocumentedHighRiskFiles = stableSort(
    highRiskFiles.filter((relPath) => !referencedInPatchDoc(patchDoc, relPath)),
  );
  const dirtyFiles = splitLines(runGit(options.repo, ["status", "--short"]));

  const criticalHistoryTargets = [
    "src/agents/agent-command.ts",
    "src/agents/command/types.ts",
    "src/gateway/server-http.ts",
    "src/agents/openclaw-tools.ts",
    "src/media/store.ts",
    "src/agents/tools/cron-tool.ts",
    "src/secrets/resolve.ts",
    "src/memory/backend-config.ts",
    "src/memory/manager.ts",
    "src/memory/qmd-manager.ts",
    "src/memory/read-file.ts",
  ];
  const criticalHistory = splitLines(
    runGit(options.repo, [
      "log",
      "--oneline",
      `${options.baseTag}..HEAD`,
      "--",
      ...criticalHistoryTargets,
    ]),
  );

  const result = {
    repo: options.repo,
    baseTag: options.baseTag,
    head: runGit(options.repo, ["rev-parse", "HEAD"]),
    changedFilesCount: changedFiles.length,
    implementationFilesCount: implementationFiles.length,
    highRiskFilesCount: highRiskFiles.length,
    lowerRiskFilesCount: lowerRiskFiles.length,
    changedFiles: stableSort(changedFiles),
    implementationFiles,
    highRiskFiles,
    lowerRiskFiles,
    undocumentedImplementationFiles,
    undocumentedHighRiskFiles,
    dirtyFiles,
    criticalHistory,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("OpenClaw fork audit");
    console.log(`- repo: ${result.repo}`);
    console.log(`- base tag: ${result.baseTag}`);
    console.log(`- head: ${result.head}`);
    console.log(`- changed files: ${result.changedFilesCount}`);
    console.log(`- implementation files: ${result.implementationFilesCount}`);
    console.log(`- high-risk implementation files: ${result.highRiskFilesCount}`);
    console.log(`- lower-risk implementation files: ${result.lowerRiskFilesCount}`);

    if (dirtyFiles.length > 0) {
      console.log("\nWorking tree state:");
      for (const line of dirtyFiles) {
        console.log(`- ${line}`);
      }
    }

    if (highRiskFiles.length > 0) {
      console.log("\nHigh-risk implementation files:");
      for (const relPath of highRiskFiles) {
        console.log(`- ${relPath}`);
      }
    }

    if (undocumentedImplementationFiles.length > 0) {
      console.log("\nImplementation files not referenced in patch doc:");
      for (const relPath of undocumentedImplementationFiles) {
        console.log(`- ${relPath}`);
      }
    } else {
      console.log("\nAll implementation files are referenced in the patch doc.");
    }

    if (undocumentedHighRiskFiles.length > 0) {
      console.log("\nUndocumented high-risk files:");
      for (const relPath of undocumentedHighRiskFiles) {
        console.log(`- ${relPath}`);
      }
    }

    if (criticalHistory.length > 0) {
      console.log("\nRecent history touching critical files since base tag:");
      for (const line of criticalHistory) {
        console.log(`- ${line}`);
      }
    }
  }

  if (options.strict && undocumentedHighRiskFiles.length > 0) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
