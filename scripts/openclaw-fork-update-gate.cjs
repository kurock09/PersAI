#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function parseArgs(argv) {
  return {
    repo:
      argv.find((arg) => arg.startsWith("--repo="))?.slice("--repo=".length) ??
      path.resolve(__dirname, "..", "..", "openclaw"),
  };
}

function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(" ")}`);
  if (process.platform === "win32") {
    const quote = (value) => {
      if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) {
        return value;
      }
      return `"${String(value).replace(/"/g, '\\"')}"`;
    };
    execFileSync("cmd.exe", ["/d", "/s", "/c", [command, ...args].map(quote).join(" ")], {
      cwd,
      stdio: "inherit",
    });
    return;
  }
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.repo)) {
    throw new Error(`OpenClaw repo not found at "${options.repo}".`);
  }

  console.log("OpenClaw fork update gate");
  console.log(`- repo: ${options.repo}`);

  run("git", ["rev-parse", "--is-inside-work-tree"], options.repo);
  run("git", ["rev-parse", "--verify", "persai-fork-base"], options.repo);
  run("node", [path.join(__dirname, "openclaw-fork-audit.cjs"), "--strict", `--repo=${options.repo}`], process.cwd());
  run("node", ["scripts/verify-persai-patches.mjs"], options.repo);
  run("corepack", ["pnpm", "exec", "tsc", "--noEmit"], options.repo);
  run("node", ["scripts/sync-plugin-sdk-exports.mjs", "--check"], options.repo);
  run("node", ["scripts/check-plugin-sdk-subpath-exports.mjs"], options.repo);

  console.log("");
  console.log("Fork update gate passed.");
  console.log("Next: run the targeted runtime smoke checklist before treating the fork update as deploy-ready.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
