#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  return {
    strict: argv.includes("--strict"),
    valuesFile:
      argv.find((arg) => arg.startsWith("--values="))?.slice("--values=".length) ??
      "infra/helm/values-dev.yaml"
  };
}

function stripInlineComment(value) {
  let result = "";
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if ((char === '"' || char === "'") && value[i - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
      result += char;
      continue;
    }
    if (char === "#" && quote === null) {
      break;
    }
    result += char;
  }
  return result.trim();
}

function parseScalar(rawValue) {
  const value = stripInlineComment(rawValue);
  if (value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseValuesYaml(input) {
  const scalars = new Map();
  const arrays = new Map();
  const stack = [];

  for (const rawLine of input.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;

    const listMatch = rawLine.match(/^(\s*)-\s*(.+)$/);
    if (listMatch) {
      const indent = listMatch[1].length;
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      const pathKey = stack.map((entry) => entry.key).join(".");
      if (!arrays.has(pathKey)) arrays.set(pathKey, []);
      arrays.get(pathKey).push(parseScalar(listMatch[2]));
      continue;
    }

    const keyMatch = rawLine.match(/^(\s*)([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!keyMatch) continue;

    const indent = keyMatch[1].length;
    const key = keyMatch[2];
    const value = keyMatch[3] ?? "";

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const pathKey = [...stack.map((entry) => entry.key), key].join(".");
    const parsedValue = parseScalar(value);

    if (parsedValue === undefined) {
      stack.push({ indent, key });
      continue;
    }

    if (Array.isArray(parsedValue)) arrays.set(pathKey, parsedValue);
    else scalars.set(pathKey, parsedValue);
  }

  return {
    scalar(pathKey, fallback) {
      return scalars.has(pathKey) ? scalars.get(pathKey) : fallback;
    }
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const valuesPath = path.resolve(process.cwd(), options.valuesFile);
  if (!fs.existsSync(valuesPath)) {
    throw new Error(`Values file not found: ${valuesPath}`);
  }

  const parsed = parseValuesYaml(fs.readFileSync(valuesPath, "utf8"));
  const openclawEnabled = parsed.scalar("openclaw.enabled", false) === true;
  const freeRuntimeUrl = String(parsed.scalar("api.env.OPENCLAW_BASE_URL_FREE_SHARED_RESTRICTED", ""));
  const paidSharedRuntimeUrl = String(
    parsed.scalar("api.env.OPENCLAW_BASE_URL_PAID_SHARED_RESTRICTED", "")
  );
  const paidIsolatedRuntimeUrl = String(parsed.scalar("api.env.OPENCLAW_BASE_URL_PAID_ISOLATED", ""));
  const defaultPoolKey = String(
    parsed.scalar("openclaw.runtimePools.defaultPoolKey", "free_shared_restricted")
  );
  const defaultPoolEnabled =
    parsed.scalar(`openclaw.runtimePools.pools.${defaultPoolKey}.enabled`, false) === true;
  const defaultPoolSandboxEnabled =
    parsed.scalar(`openclaw.runtimePools.pools.${defaultPoolKey}_sandbox.enabled`, false) === true;
  const freeEnabled =
    parsed.scalar("openclaw.runtimePools.pools.free_shared_restricted.enabled", false) === true;
  const freeSandboxEnabled =
    parsed.scalar("openclaw.runtimePools.pools.free_shared_restricted_sandbox.enabled", false) === true;
  const paidSharedEnabled =
    parsed.scalar("openclaw.runtimePools.pools.paid_shared_restricted.enabled", false) === true;
  const paidSharedSandboxEnabled =
    parsed.scalar("openclaw.runtimePools.pools.paid_shared_restricted_sandbox.enabled", false) === true;
  const paidIsolatedEnabled =
    parsed.scalar("openclaw.runtimePools.pools.paid_isolated.enabled", false) === true;
  const freeSandboxRuntimeEnabled =
    parsed.scalar("openclaw.runtimePools.pools.free_shared_restricted_sandbox.config.sandboxRuntime.enabled", false) === true;
  const paidSharedSandboxRuntimeEnabled =
    parsed.scalar(
      "openclaw.runtimePools.pools.paid_shared_restricted_sandbox.config.sandboxRuntime.enabled",
      false
    ) === true;
  const sandboxDockerHost = String(parsed.scalar("openclaw.sandboxRuntime.dockerHost", ""));
  const sandboxDindImage = String(parsed.scalar("openclaw.sandboxRuntime.dind.image", ""));

  const blockers = [];
  if (!openclawEnabled) {
    blockers.push("openclaw.enabled must remain true for runtime pool scaffolding.");
  }
  if (!defaultPoolKey) {
    blockers.push("openclaw.runtimePools.defaultPoolKey is required.");
  }
  if (!defaultPoolEnabled && !defaultPoolSandboxEnabled) {
    blockers.push("The configured default runtime pool or its dedicated _sandbox variant must be enabled.");
  }
  if (!freeEnabled && !freeSandboxEnabled) {
    blockers.push("Either free_shared_restricted or free_shared_restricted_sandbox must be enabled.");
  }
  if (!paidSharedEnabled && !paidSharedSandboxEnabled) {
    blockers.push(
      "Either paid_shared_restricted or paid_shared_restricted_sandbox must be enabled for full tiered runtime readiness."
    );
  }
  if (!paidIsolatedEnabled) {
    blockers.push("paid_isolated must be enabled for full tiered runtime readiness.");
  }
  if (
    freeRuntimeUrl !== "http://openclaw-free-shared-restricted:18789" &&
    freeRuntimeUrl !== "http://openclaw-free-shared-restricted-sandbox:18789"
  ) {
    blockers.push(
      "api.env.OPENCLAW_BASE_URL_FREE_SHARED_RESTRICTED must point to http://openclaw-free-shared-restricted:18789 or http://openclaw-free-shared-restricted-sandbox:18789."
    );
  }
  if (
    paidSharedRuntimeUrl !== "http://openclaw-paid-shared-restricted:18789" &&
    paidSharedRuntimeUrl !== "http://openclaw-paid-shared-restricted-sandbox:18789"
  ) {
    blockers.push(
      "api.env.OPENCLAW_BASE_URL_PAID_SHARED_RESTRICTED must point to http://openclaw-paid-shared-restricted:18789 or http://openclaw-paid-shared-restricted-sandbox:18789."
    );
  }
  if (paidIsolatedRuntimeUrl !== "http://openclaw-paid-isolated:18789") {
    blockers.push(
      "api.env.OPENCLAW_BASE_URL_PAID_ISOLATED must point to http://openclaw-paid-isolated:18789."
    );
  }
  if ((freeSandboxEnabled || paidSharedSandboxEnabled) && !sandboxDockerHost) {
    blockers.push("openclaw.sandboxRuntime.dockerHost must be configured for sandbox-capable shared pools.");
  }
  if ((freeSandboxEnabled || paidSharedSandboxEnabled) && !sandboxDindImage) {
    blockers.push("openclaw.sandboxRuntime.dind.image must be configured for sandbox-capable shared pools.");
  }
  if (freeSandboxEnabled && !freeSandboxRuntimeEnabled) {
    blockers.push("free_shared_restricted_sandbox must enable config.sandboxRuntime.enabled=true.");
  }
  if (paidSharedSandboxEnabled && !paidSharedSandboxRuntimeEnabled) {
    blockers.push("paid_shared_restricted_sandbox must enable config.sandboxRuntime.enabled=true.");
  }

  console.log("Runtime pool readiness");
  console.log(`- values file: ${valuesPath}`);
  console.log(`- openclaw.enabled: ${String(openclawEnabled)}`);
  console.log(`- default pool key: ${defaultPoolKey}`);
  console.log(`- free_shared_restricted enabled: ${String(freeEnabled)}`);
  console.log(`- free_shared_restricted_sandbox enabled: ${String(freeSandboxEnabled)}`);
  console.log(`- paid_shared_restricted enabled: ${String(paidSharedEnabled)}`);
  console.log(`- paid_shared_restricted_sandbox enabled: ${String(paidSharedSandboxEnabled)}`);
  console.log(`- paid_isolated enabled: ${String(paidIsolatedEnabled)}`);
  console.log(`- free runtime URL: ${freeRuntimeUrl}`);
  console.log(`- paid shared runtime URL: ${paidSharedRuntimeUrl}`);
  console.log(`- paid isolated runtime URL: ${paidIsolatedRuntimeUrl}`);
  console.log(`- sandbox docker host: ${sandboxDockerHost}`);
  console.log(`- sandbox dind image: ${sandboxDindImage}`);
  console.log("");
  console.log("Current R15e rules:");
  console.log("- All canonical runtime tiers must render as explicit pool services.");
  console.log("- Adapter routing must use explicit per-tier service URLs only.");
  console.log("- Shared sandbox pools require a real Docker-backed backend, not only sandbox config flags.");

  if (blockers.length > 0) {
    console.log("");
    console.log("Current rollout blockers:");
    for (const blocker of blockers) {
      console.log(`- ${blocker}`);
    }
    if (options.strict) {
      process.exitCode = 1;
    }
    return;
  }

  console.log("");
  console.log("No readiness blockers detected for the current runtime pool scaffolding.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
