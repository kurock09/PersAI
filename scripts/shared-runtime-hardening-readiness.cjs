#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  return {
    strict: argv.includes("--strict"),
    valuesFile:
      argv.find((arg) => arg.startsWith("--values="))?.slice("--values=".length) ??
      "infra/helm/values-dev.yaml",
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
  if (value === "") {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "[]") {
    return [];
  }
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
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) {
      continue;
    }

    const listMatch = rawLine.match(/^(\s*)-\s*(.+)$/);
    if (listMatch) {
      const indent = listMatch[1].length;
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      const pathKey = stack.map((entry) => entry.key).join(".");
      if (!arrays.has(pathKey)) {
        arrays.set(pathKey, []);
      }
      arrays.get(pathKey).push(parseScalar(listMatch[2]));
      continue;
    }

    const keyMatch = rawLine.match(/^(\s*)([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!keyMatch) {
      continue;
    }

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

    if (Array.isArray(parsedValue)) {
      arrays.set(pathKey, parsedValue);
    } else {
      scalars.set(pathKey, parsedValue);
    }
  }

  return {
    scalar(pathKey, fallback) {
      return scalars.has(pathKey) ? scalars.get(pathKey) : fallback;
    },
    array(pathKey) {
      return arrays.has(pathKey) ? arrays.get(pathKey).filter(Boolean) : [];
    },
  };
}

function formatList(title, values) {
  console.log(title);
  if (values.length === 0) {
    console.log("- none");
    return;
  }
  for (const value of values) {
    console.log(`- ${value}`);
  }
}

function hasSecretRef(parsed, prefix, key) {
  return (
    typeof parsed.scalar(`${prefix}.${key}.secretName`, undefined) === "string" &&
    typeof parsed.scalar(`${prefix}.${key}.secretKey`, undefined) === "string"
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const valuesPath = path.resolve(process.cwd(), options.valuesFile);
  if (!fs.existsSync(valuesPath)) {
    throw new Error(`Values file not found: ${valuesPath}`);
  }

  const parsed = parseValuesYaml(fs.readFileSync(valuesPath, "utf8"));

  const requiredDeniedTools = [
    "gateway",
    "nodes",
    "canvas",
    "agents_list",
    "session_status",
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "sessions_spawn",
    "sessions_yield",
    "subagents",
  ];

  const deniedTools = parsed.array("openclaw.tools.deny");
  const missingDeniedTools = requiredDeniedTools.filter((tool) => !deniedTools.includes(tool));

  const apiInternalServiceEnabled = parsed.scalar("api.internalService.enabled", false) === true;
  const apiInternalPort = String(parsed.scalar("api.internalService.port", ""));
  const apiInternalEnvPort = String(parsed.scalar("api.env.API_INTERNAL_PORT", ""));
  const expectedInternalBaseUrl = apiInternalPort ? `http://api-internal:${apiInternalPort}` : "";

  const sandboxMode = parsed.scalar("openclaw.agentDefaults.sandbox.mode", "");
  const sandboxScope = parsed.scalar("openclaw.agentDefaults.sandbox.scope", "");
  const sandboxWorkspaceAccess = parsed.scalar("openclaw.agentDefaults.sandbox.workspaceAccess", "");
  const sandboxNetwork = parsed.scalar("openclaw.agentDefaults.sandbox.docker.network", "");
  const sandboxReadOnlyRoot = parsed.scalar(
    "openclaw.agentDefaults.sandbox.docker.readOnlyRoot",
    false,
  );
  const sandboxCapDrop = parsed.array("openclaw.agentDefaults.sandbox.docker.capDrop");
  const sandboxPidsLimit = parsed.scalar("openclaw.agentDefaults.sandbox.docker.pidsLimit", "");
  const sandboxMemory = parsed.scalar("openclaw.agentDefaults.sandbox.docker.memory", "");
  const sandboxCpus = parsed.scalar("openclaw.agentDefaults.sandbox.docker.cpus", "");

  const openclawBaseUrl = parsed.scalar("openclaw.env.PERSAI_API_BASE_URL", "");
  const secretResolverBaseUrl = parsed.scalar("openclaw.persaiSecretResolver.baseUrl", "");

  const networkPolicyEnabled = parsed.scalar("networkPolicy.enabled", false) === true;
  const ingressEnabled = parsed.scalar("ingress.enabled", false) === true;
  const openclawEnabled = parsed.scalar("openclaw.enabled", false) === true;
  const telegramWebhookEnabled = parsed.scalar("openclaw.telegramWebhook.enabled", false) === true;
  const apiPublicCidrs = parsed.array("networkPolicy.apiIngress.publicIpBlocks");
  const trustedOpenclawIngressCidrs = parsed.array(
    "networkPolicy.openclawIngress.trustedIngressIpBlocks",
  );
  const telegramCidrs = parsed.array("networkPolicy.openclawIngress.telegramWebhookIpBlocks");
  const openclawIngressCidrs = [...trustedOpenclawIngressCidrs, ...telegramCidrs];

  const configBlockers = [];
  if (missingDeniedTools.length > 0) {
    configBlockers.push(
      `openclaw.tools.deny is missing required shared-runtime denied tools: ${missingDeniedTools.join(", ")}.`,
    );
  }
  if (!apiInternalServiceEnabled) {
    configBlockers.push("api.internalService.enabled must be true for shared-runtime hardening.");
  }
  if (!apiInternalPort || apiInternalPort !== apiInternalEnvPort) {
    configBlockers.push(
      "API internal port split is incomplete: api.internalService.port and api.env.API_INTERNAL_PORT must both be set and match.",
    );
  }
  if (!expectedInternalBaseUrl || openclawBaseUrl !== expectedInternalBaseUrl) {
    configBlockers.push(
      "openclaw.env.PERSAI_API_BASE_URL must point to the internal API service (http://api-internal:<port>).",
    );
  }
  if (!expectedInternalBaseUrl || secretResolverBaseUrl !== expectedInternalBaseUrl) {
    configBlockers.push(
      "openclaw.persaiSecretResolver.baseUrl must point to the internal API service (http://api-internal:<port>).",
    );
  }
  if (!hasSecretRef(parsed, "api.secretEnv", "OPENCLAW_GATEWAY_TOKEN")) {
    configBlockers.push("api.secretEnv.OPENCLAW_GATEWAY_TOKEN is required.");
  }
  if (!hasSecretRef(parsed, "api.secretEnv", "PERSAI_INTERNAL_API_TOKEN")) {
    configBlockers.push("api.secretEnv.PERSAI_INTERNAL_API_TOKEN is required.");
  }
  if (!hasSecretRef(parsed, "openclaw.secretEnv", "OPENCLAW_GATEWAY_TOKEN")) {
    configBlockers.push("openclaw.secretEnv.OPENCLAW_GATEWAY_TOKEN is required.");
  }
  if (!hasSecretRef(parsed, "openclaw.secretEnv", "PERSAI_INTERNAL_API_TOKEN")) {
    configBlockers.push("openclaw.secretEnv.PERSAI_INTERNAL_API_TOKEN is required.");
  }
  if (sandboxMode !== "off") {
    configBlockers.push('openclaw.agentDefaults.sandbox.mode must stay "off" until canary-ready sandbox rollout.');
  }
  if (sandboxScope !== "agent") {
    configBlockers.push('openclaw.agentDefaults.sandbox.scope must be "agent".');
  }
  if (sandboxWorkspaceAccess !== "rw") {
    configBlockers.push('openclaw.agentDefaults.sandbox.workspaceAccess must currently be "rw" in the prepared baseline.');
  }
  if (sandboxNetwork !== "none") {
    configBlockers.push('openclaw.agentDefaults.sandbox.docker.network must be "none".');
  }
  if (sandboxReadOnlyRoot !== true) {
    configBlockers.push("openclaw.agentDefaults.sandbox.docker.readOnlyRoot must be true.");
  }
  if (!sandboxCapDrop.includes("ALL")) {
    configBlockers.push('openclaw.agentDefaults.sandbox.docker.capDrop must include "ALL".');
  }
  if (String(sandboxPidsLimit) !== "256") {
    configBlockers.push("openclaw.agentDefaults.sandbox.docker.pidsLimit must stay at the prepared baseline (256).");
  }
  if (String(sandboxMemory) !== "1g") {
    configBlockers.push('openclaw.agentDefaults.sandbox.docker.memory must stay at the prepared baseline ("1g").');
  }
  if (String(sandboxCpus) !== "1") {
    configBlockers.push("openclaw.agentDefaults.sandbox.docker.cpus must stay at the prepared baseline (1).");
  }
  if (!networkPolicyEnabled) {
    configBlockers.push("networkPolicy.enabled must be true for the shared-runtime hardening baseline.");
  }

  const rolloutBlockers = [];
  if (networkPolicyEnabled && ingressEnabled && apiPublicCidrs.length === 0) {
    rolloutBlockers.push(
      "API ingress NetworkPolicy is still gated: networkPolicy.apiIngress.publicIpBlocks is empty while ingress.enabled=true.",
    );
  }
  if (
    networkPolicyEnabled &&
    openclawEnabled &&
    telegramWebhookEnabled &&
    openclawIngressCidrs.length === 0
  ) {
    rolloutBlockers.push(
      "OpenClaw ingress NetworkPolicy is still gated: both networkPolicy.openclawIngress.trustedIngressIpBlocks and telegramWebhookIpBlocks are empty while openclaw.telegramWebhook.enabled=true.",
    );
  }

  console.log("Shared runtime hardening readiness");
  console.log(`- values file: ${valuesPath}`);
  console.log(`- api internal service enabled: ${String(apiInternalServiceEnabled)}`);
  console.log(`- expected internal base URL: ${expectedInternalBaseUrl || "<missing>"}`);
  console.log(`- openclaw env base URL: ${String(openclawBaseUrl || "<missing>")}`);
  console.log(`- secret resolver base URL: ${String(secretResolverBaseUrl || "<missing>")}`);
  console.log(`- sandbox mode: ${String(sandboxMode || "<missing>")}`);
  console.log(`- networkPolicy.enabled: ${String(networkPolicyEnabled)}`);
  console.log("");
  formatList("Required shared-runtime denied tools present:", requiredDeniedTools.filter((tool) => deniedTools.includes(tool)));
  console.log("");
  formatList("Missing required denied tools:", missingDeniedTools);
  console.log("");
  formatList("Configured API public CIDRs:", apiPublicCidrs);
  console.log("");
  formatList("Configured OpenClaw trusted ingress CIDRs:", trustedOpenclawIngressCidrs);
  console.log("");
  formatList("Configured Telegram sender CIDRs:", telegramCidrs);

  if (configBlockers.length > 0) {
    console.log("");
    formatList("Config blockers:", configBlockers);
  }

  if (rolloutBlockers.length > 0) {
    console.log("");
    formatList("Rollout blockers:", rolloutBlockers);
  }

  if (configBlockers.length === 0 && rolloutBlockers.length === 0) {
    console.log("");
    console.log("Shared-runtime hardening baseline is ready for the targeted rollout smoke checks.");
  }

  if (options.strict && (configBlockers.length > 0 || rolloutBlockers.length > 0)) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
