#!/usr/bin/env node
/**
 * ADR-146 / ADR-126: sandbox-egress-proxy Squid ConfigMap contract + optional
 * `squid -k parse` against the pinned ubuntu/squid image.
 *
 * Normal tests assert the rendered Helm contract and, when Docker already has
 * the pinned image locally, run parse without pulling. Use --require-parse
 * (and optional --pull) for an operator/CI gate that must execute parse.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const PINNED_SQUID_IMAGE = "ubuntu/squid:6.6-24.04_edge";

/** Exact production logformat after the ADR-146 GnuTLS/no-SSL-Bump repair. */
export const EXPECTED_LOGFORMAT_LINE =
  "logformat persai_egress %ts.%03tu %>a %Ss/%03>Hs %<st %rm %ru tool=shell";

const REQUIRED_LOGFORMAT_TOKENS = [
  "%ts.%03tu",
  "%>a",
  "%Ss/%03>Hs",
  "%<st",
  "%rm",
  "%ru",
  "tool=shell"
];

const FORBIDDEN_LOGFORMAT_FRAGMENTS = ["%ssl::", "sni"];

export function extractSquidConfFromHelmYaml(yaml) {
  const lines = yaml.split(/\r?\n/);
  const out = [];
  let inConf = false;
  for (const line of lines) {
    if (/^\s+squid\.conf:\s*\|/.test(line)) {
      inConf = true;
      continue;
    }
    if (!inConf) continue;
    if (line.startsWith("---") || /^[A-Za-z]/.test(line) || /^  [A-Za-z]/.test(line)) {
      break;
    }
    if (line.startsWith("    ")) {
      out.push(line.slice(4));
    } else if (line.trim() === "") {
      out.push("");
    } else {
      break;
    }
  }
  if (out.length === 0) {
    throw new Error("squid.conf block missing from Helm render");
  }
  return `${out.join("\n").replace(/\s+$/, "")}\n`;
}

export function extractEgressProxyImageFromHelmYaml(yaml) {
  const match = yaml.match(
    /kind:\s*Deployment[\s\S]*?name:\s*sandbox-egress-proxy[\s\S]*?image:\s*"([^"]+)"/
  );
  if (!match) {
    throw new Error("sandbox-egress-proxy Deployment image missing from Helm render");
  }
  return match[1];
}

/**
 * Pod-template checksum of the exact squid.conf helper body. Required because
 * subPath ConfigMap mounts do not propagate updates without Pod recreate.
 */
export function extractSquidConfChecksumFromHelmYaml(yaml) {
  const match = yaml.match(/checksum\/squid-conf:\s*([0-9a-f]{64})\b/);
  if (!match) {
    throw new Error(
      "Deployment pod template missing checksum/squid-conf annotation (64-char sha256)"
    );
  }
  return match[1];
}

export function assertPersaiEgressLogformatContract(squidConf) {
  const logformatLines = squidConf
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("logformat persai_egress"));
  if (logformatLines.length !== 1) {
    throw new Error(
      `expected exactly one logformat persai_egress line, found ${logformatLines.length}`
    );
  }
  const line = logformatLines[0];
  if (line !== EXPECTED_LOGFORMAT_LINE) {
    throw new Error(
      `logformat mismatch:\n  expected: ${EXPECTED_LOGFORMAT_LINE}\n  actual:   ${line}`
    );
  }
  for (const token of REQUIRED_LOGFORMAT_TOKENS) {
    if (!line.includes(token)) {
      throw new Error(`logformat missing required token/fragment: ${token}`);
    }
  }
  // tool=shell must remain static literal text (not a Squid %code).
  if (!/\stool=shell$/.test(line)) {
    throw new Error("logformat must end with static literal tool=shell");
  }
  for (const frag of FORBIDDEN_LOGFORMAT_FRAGMENTS) {
    if (line.toLowerCase().includes(frag.toLowerCase())) {
      throw new Error(`logformat must not include unsupported fragment: ${frag}`);
    }
  }
  if (!squidConf.includes("access_log stdio:/dev/stdout persai_egress")) {
    throw new Error("access_log must use format persai_egress");
  }
  return line;
}

export function renderSandboxEgressProxyYaml({
  valuesFiles = ["infra/helm/values.yaml", "infra/helm/values-dev.yaml"],
  set = [],
  setJson = [],
  cwd = repoRoot
} = {}) {
  const args = ["template", "persai-dev", "infra/helm"];
  for (const file of valuesFiles) {
    args.push("-f", file);
  }
  for (const entry of set) {
    args.push("--set", entry);
  }
  for (const entry of setJson) {
    args.push("--set-json", entry);
  }
  args.push("-s", "templates/sandbox-egress-proxy.yaml");
  const rendered = spawnSync("helm", args, {
    cwd,
    encoding: "utf8",
    shell: false
  });
  if (rendered.status !== 0) {
    throw new Error(`helm template failed: ${rendered.stderr || rendered.stdout}`);
  }
  return rendered.stdout;
}

export function loadPinnedSquidImageFromValuesDev(cwd = repoRoot) {
  const text = readFileSync(path.join(cwd, "infra/helm/values-dev.yaml"), "utf8");
  const match = text.match(/egressProxy:[\s\S]*?image:\s*"([^"]+)"/);
  if (!match) {
    throw new Error("sandbox.egressProxy.image missing from values-dev.yaml");
  }
  return match[1];
}

export function dockerImagePresent(image) {
  const result = spawnSync("docker", ["image", "inspect", image], {
    encoding: "utf8",
    shell: false
  });
  return result.status === 0;
}

export function dockerAvailable() {
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
    shell: false
  });
  return result.status === 0 && Boolean(result.stdout?.trim());
}

export function pullSquidImage(image = PINNED_SQUID_IMAGE) {
  const result = spawnSync("docker", ["pull", image], {
    encoding: "utf8",
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`docker pull ${image} failed: ${result.stderr || result.stdout}`);
  }
}

/**
 * Run `squid -k parse` against conf text using the pinned image.
 * @returns {{ ok: true, output: string } | { skipped: true, reason: string }}
 */
export function parseSquidConfWithPinnedImage(
  squidConf,
  { image = PINNED_SQUID_IMAGE, pull = false, requireParse = false } = {}
) {
  if (!dockerAvailable()) {
    if (requireParse) {
      throw new Error("docker is required for squid -k parse but is unavailable");
    }
    return { skipped: true, reason: "docker unavailable" };
  }
  if (pull) {
    pullSquidImage(image);
  } else if (!dockerImagePresent(image)) {
    if (requireParse) {
      throw new Error(
        `pinned image ${image} is not present locally; pass --pull or pre-load it (tests do not network-pull by default)`
      );
    }
    return { skipped: true, reason: `image not present locally: ${image}` };
  }

  const dir = mkdtempSync(path.join(tmpdir(), "persai-squid-parse-"));
  try {
    writeFileSync(path.join(dir, "squid.conf"), squidConf, "utf8");
    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${dir}:/etc/squid:ro`,
        "--entrypoint",
        "squid",
        image,
        "-k",
        "parse",
        "-f",
        "/etc/squid/squid.conf"
      ],
      { encoding: "utf8", shell: false }
    );
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    if (result.status !== 0) {
      throw new Error(`squid -k parse failed (exit ${result.status}):\n${output}`);
    }
    if (/Unsupported %code/i.test(output) || /FATAL: Bungled/i.test(output)) {
      throw new Error(`squid -k parse reported fatal config error:\n${output}`);
    }
    return { ok: true, output };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function runRenderedContractAndOptionalParse({
  pull = false,
  requireParse = false,
  cwd = repoRoot
} = {}) {
  const pinnedFromValues = loadPinnedSquidImageFromValuesDev(cwd);
  if (pinnedFromValues !== PINNED_SQUID_IMAGE) {
    throw new Error(
      `values-dev egressProxy.image drifted: expected ${PINNED_SQUID_IMAGE}, got ${pinnedFromValues}`
    );
  }
  const yaml = renderSandboxEgressProxyYaml({ cwd });
  const image = extractEgressProxyImageFromHelmYaml(yaml);
  if (image !== PINNED_SQUID_IMAGE) {
    throw new Error(
      `rendered Deployment image drifted: expected ${PINNED_SQUID_IMAGE}, got ${image}`
    );
  }
  const squidConfChecksum = extractSquidConfChecksumFromHelmYaml(yaml);
  const squidConf = extractSquidConfFromHelmYaml(yaml);
  assertPersaiEgressLogformatContract(squidConf);
  const parseResult = parseSquidConfWithPinnedImage(squidConf, {
    image: PINNED_SQUID_IMAGE,
    pull,
    requireParse
  });
  return { squidConf, squidConfChecksum, image, parseResult };
}

function printUsage() {
  console.log(`Usage:
  node infra/helm/scripts/sandbox-egress-proxy-squid-conf.mjs [--require-parse] [--pull]

Validates rendered sandbox-egress-proxy squid.conf contract.
Optional: run squid -k parse via local Docker against ${PINNED_SQUID_IMAGE}.
Normal automation must not network-pull; pass --pull only when explicitly requested.`);
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }
  const requireParse = argv.includes("--require-parse");
  const pull = argv.includes("--pull");
  const { parseResult } = runRenderedContractAndOptionalParse({ requireParse, pull });
  console.log("sandbox-egress-proxy squid.conf contract: OK");
  console.log(`logformat: ${EXPECTED_LOGFORMAT_LINE}`);
  if (parseResult.skipped) {
    console.log(`squid -k parse: SKIPPED (${parseResult.reason})`);
  } else {
    console.log(`squid -k parse: OK (${PINNED_SQUID_IMAGE})`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
