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

function main() {
  const options = parseArgs(process.argv.slice(2));
  const valuesPath = path.resolve(process.cwd(), options.valuesFile);
  if (!fs.existsSync(valuesPath)) {
    throw new Error(`Values file not found: ${valuesPath}`);
  }

  const parsed = parseValuesYaml(fs.readFileSync(valuesPath, "utf8"));
  const networkPolicyEnabled = parsed.scalar("networkPolicy.enabled", false) === true;
  const ingressEnabled = parsed.scalar("ingress.enabled", false) === true;
  const openclawEnabled = parsed.scalar("openclaw.enabled", false) === true;
  const telegramWebhookEnabled = parsed.scalar("openclaw.telegramWebhook.enabled", false) === true;
  const apiPublicCidrs = parsed.array("networkPolicy.apiIngress.publicIpBlocks");
  const apiExtraCidrs = parsed.array("networkPolicy.apiIngress.extraFromIpBlocks");
  const trustedOpenclawIngressCidrs = parsed.array(
    "networkPolicy.openclawIngress.trustedIngressIpBlocks"
  );
  const telegramCidrs = parsed.array("networkPolicy.openclawIngress.telegramWebhookIpBlocks");
  const openclawIngressCidrs = [...trustedOpenclawIngressCidrs, ...telegramCidrs];

  const apiPolicyRenderable =
    networkPolicyEnabled && (!ingressEnabled || apiPublicCidrs.length > 0);
  const openclawPolicyRenderable =
    networkPolicyEnabled &&
    openclawEnabled &&
    (!telegramWebhookEnabled || openclawIngressCidrs.length > 0);

  const blockers = [];
  if (networkPolicyEnabled && ingressEnabled && apiPublicCidrs.length === 0) {
    blockers.push(
      "API ingress NetworkPolicy is still gated: networkPolicy.apiIngress.publicIpBlocks is empty while ingress.enabled=true."
    );
  }
  if (
    networkPolicyEnabled &&
    openclawEnabled &&
    telegramWebhookEnabled &&
    openclawIngressCidrs.length === 0
  ) {
    blockers.push(
      "OpenClaw ingress NetworkPolicy is still gated: both networkPolicy.openclawIngress.trustedIngressIpBlocks and telegramWebhookIpBlocks are empty while openclaw.telegramWebhook.enabled=true."
    );
  }

  console.log("NetworkPolicy readiness");
  console.log(`- values file: ${valuesPath}`);
  console.log(`- networkPolicy.enabled: ${String(networkPolicyEnabled)}`);
  console.log(`- ingress.enabled: ${String(ingressEnabled)}`);
  console.log(`- openclaw.enabled: ${String(openclawEnabled)}`);
  console.log(`- openclaw.telegramWebhook.enabled: ${String(telegramWebhookEnabled)}`);
  console.log(`- api policy renderable now: ${String(apiPolicyRenderable)}`);
  console.log(`- openclaw policy renderable now: ${String(openclawPolicyRenderable)}`);
  console.log("");
  formatList("Configured API public CIDRs:", apiPublicCidrs);
  console.log("");
  formatList("Configured API extra caller CIDRs:", apiExtraCidrs);
  console.log("");
  formatList("Configured OpenClaw trusted ingress CIDRs:", trustedOpenclawIngressCidrs);
  console.log("");
  formatList("Configured Telegram sender CIDRs:", telegramCidrs);
  console.log("");
  console.log("Rollout guidance:");
  console.log(
    "- API publicIpBlocks should contain the trusted pod-visible/public ingress proxy ranges for api.persai.dev in the current GKE path."
  );
  console.log(
    "- OpenClaw trustedIngressIpBlocks should contain the trusted pod-visible ingress/proxy ranges that actually reach the OpenClaw pod."
  );
  console.log(
    "- For GKE Ingress-backed webhook traffic this is usually Google LB/GFE/backend health-check ranges first; Telegram sender CIDRs are supplemental only when they are truly pod-visible."
  );

  if (blockers.length > 0) {
    console.log("");
    formatList("Current rollout blockers:", blockers);
    if (options.strict) {
      process.exitCode = 1;
    }
    return;
  }

  console.log("");
  console.log("No readiness blockers detected for the configured NetworkPolicy gates.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
