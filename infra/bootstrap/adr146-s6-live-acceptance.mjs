#!/usr/bin/env node
/**
 * ADR-146 S5 acceptance preparation only.
 *
 * Runs bounded, operator-supplied S6 probes. It never creates fixtures, mutates
 * cloud/Kubernetes state, changes assistant mode, deploys, or claims acceptance.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UUIDISH_NAME = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const REQUIRED_FLAGS = [
  "fullPublicPod",
  "restrictedPod",
  "sshHost",
  "sshPort",
  "tcpHost",
  "tcpPort",
  "udpHost",
  "udpPort",
  "restrictedAllowUrl",
  "restrictedDenyUrl",
  "redirectUrl",
  "redirectTargetHost",
  "privateDnsHost",
  "privateDnsIp",
  "privateDnsPort",
  "browserSmokeSpec",
  "webSearchSmokeSpec",
  "cleanupSpec"
];
const VALUE_FLAGS = new Set([
  "namespace",
  ...REQUIRED_FLAGS.map((key) => key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`))
]);

function flagNameToKey(flag) {
  return flag.replace(/^--/, "").replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

export function parseArgs(argv) {
  const parsed = { namespace: "persai-dev", execute: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--execute") parsed.execute = true;
    else if (flag === "--help" || flag === "-h") parsed.help = true;
    else if (flag.startsWith("--")) {
      if (!VALUE_FLAGS.has(flag.slice(2))) throw new Error(`unknown argument: ${flag}`);
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
      parsed[flagNameToKey(flag)] = value;
    } else {
      throw new Error(`unexpected positional argument: ${flag}`);
    }
  }
  return parsed;
}

function parsePort(value, field) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${field} must be an integer in [1, 65535]`);
  }
  return port;
}

function parseSafeUrl(value, field) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute URL`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${field} must use http or https`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${field} must not contain credentials, query, or fragment`);
  }
  return url;
}

function ipv4ToInt(ip) {
  return ip.split(".").reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0;
}

function inCidr(ip, base, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export function isDeniedPrivateIpv4(ip) {
  if (net.isIP(ip) !== 4) return false;
  return [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15]
  ].some(([base, prefix]) => inCidr(ip, base, prefix));
}

function validatePublicFixtureHost(host, field) {
  if (!host || /\s|[/@?#]/.test(host) || host === "localhost") {
    throw new Error(`${field} must be a bare operator-owned public host`);
  }
  if (net.isIP(host) === 4 && isDeniedPrivateIpv4(host)) {
    throw new Error(`${field} must not be private/special-use`);
  }
}

export function loadCommandSpec(filePath, label, root = repoRoot) {
  const absolute = path.resolve(root, filePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} spec must remain inside repository root`);
  }
  const parsed = JSON.parse(readFileSync(absolute, "utf8"));
  if (
    !Array.isArray(parsed.argv) ||
    parsed.argv.length < 1 ||
    parsed.argv.length > 32 ||
    parsed.argv.some((arg) => typeof arg !== "string" || arg.length < 1 || arg.length > 2048)
  ) {
    throw new Error(`${label} spec argv must contain 1..32 bounded non-empty strings`);
  }
  if (parsed.argv.some((arg) => arg.includes("REPLACE_WITH_"))) {
    throw new Error(`${label} spec still contains a fail-closed replacement marker`);
  }
  if (
    typeof parsed.expectedStdout !== "string" ||
    !/^[A-Z0-9_]{4,80}$/.test(parsed.expectedStdout)
  ) {
    throw new Error(`${label} spec expectedStdout must be an exact uppercase sentinel`);
  }
  const timeoutMs = Number(parsed.timeoutMs);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new Error(`${label} spec timeoutMs must be in [1000, 300000]`);
  }
  return { argv: parsed.argv, expectedStdout: parsed.expectedStdout, timeoutMs };
}

export function validateArgs(args, root = repoRoot) {
  for (const key of REQUIRED_FLAGS) {
    if (args[key] === undefined)
      throw new Error(`missing required --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  }
  for (const [field, value] of [
    ["namespace", args.namespace],
    ["fullPublicPod", args.fullPublicPod],
    ["restrictedPod", args.restrictedPod]
  ]) {
    if (!UUIDISH_NAME.test(value)) throw new Error(`${field} is not a valid Kubernetes name`);
  }
  if (args.fullPublicPod === args.restrictedPod) {
    throw new Error("full-public and restricted pods must be different");
  }
  validatePublicFixtureHost(args.sshHost, "sshHost");
  validatePublicFixtureHost(args.tcpHost, "tcpHost");
  validatePublicFixtureHost(args.udpHost, "udpHost");
  args.sshPort = parsePort(args.sshPort, "sshPort");
  args.tcpPort = parsePort(args.tcpPort, "tcpPort");
  args.udpPort = parsePort(args.udpPort, "udpPort");
  args.privateDnsPort = parsePort(args.privateDnsPort, "privateDnsPort");
  args.restrictedAllowUrl = parseSafeUrl(args.restrictedAllowUrl, "restrictedAllowUrl").href;
  const restrictedDenyUrl = parseSafeUrl(args.restrictedDenyUrl, "restrictedDenyUrl");
  if (restrictedDenyUrl.protocol !== "https:") {
    throw new Error("restrictedDenyUrl must use https so CONNECT 403 is observable");
  }
  args.restrictedDenyUrl = restrictedDenyUrl.href;
  args.redirectUrl = parseSafeUrl(args.redirectUrl, "redirectUrl").href;
  if (!args.redirectTargetHost || /\s|[/@?#]/.test(args.redirectTargetHost)) {
    throw new Error("redirectTargetHost must be a bare denied host");
  }
  if (!args.privateDnsHost || /\s|[/@?#]/.test(args.privateDnsHost)) {
    throw new Error("privateDnsHost must be a bare fixture hostname");
  }
  if (!isDeniedPrivateIpv4(args.privateDnsIp)) {
    throw new Error("privateDnsIp must be an IPv4 private/special-use denied destination");
  }
  if (
    args.redirectTargetHost !== args.privateDnsHost &&
    args.redirectTargetHost !== args.privateDnsIp
  ) {
    throw new Error("redirectTargetHost must equal privateDnsHost or privateDnsIp");
  }
  args.browserSmokeSpec = loadCommandSpec(args.browserSmokeSpec, "browser", root);
  args.webSearchSmokeSpec = loadCommandSpec(args.webSearchSmokeSpec, "web-search", root);
  args.cleanupSpec = loadCommandSpec(args.cleanupSpec, "cleanup", root);
  return args;
}

function defaultRun(argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    timeout: options.timeoutMs ?? 30_000,
    env: process.env
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function requireSuccess(result, check) {
  if (result.status !== 0) {
    throw new Error(
      `${check} failed status=${String(result.status)}: ${result.stderr || result.stdout}`
    );
  }
}

function kubectlExec(args, pod, argv, run, timeoutMs = 30_000) {
  return run(["kubectl", "-n", args.namespace, "exec", pod, "--", ...argv], { timeoutMs });
}

function readPod(args, pod, run) {
  const result = run(["kubectl", "-n", args.namespace, "get", "pod", pod, "-o", "json"], {
    timeoutMs: 30_000
  });
  requireSuccess(result, `read pod ${pod}`);
  return JSON.parse(result.stdout);
}

function assertPodContour(args, run) {
  const full = readPod(args, args.fullPublicPod, run);
  const restricted = readPod(args, args.restrictedPod, run);
  const fullMode = full.metadata?.labels?.["persai.io/sandbox-egress"];
  const restrictedMode = restricted.metadata?.labels?.["persai.io/sandbox-egress"];
  const fullAssistant = full.metadata?.annotations?.["persai.io/assistant-id"];
  const restrictedAssistant = restricted.metadata?.annotations?.["persai.io/assistant-id"];
  if (full.status?.phase !== "Running" || fullMode !== "full-public" || !fullAssistant) {
    throw new Error("full-public probe pod is not Running with canonical mode/assistant identity");
  }
  if (
    restricted.status?.phase !== "Running" ||
    restrictedMode !== "restricted" ||
    !restrictedAssistant ||
    restrictedAssistant === fullAssistant
  ) {
    throw new Error("restricted comparison pod must be Running for a different assistant");
  }
  return { fullAssistant, restrictedAssistant };
}

const TCP_PROBE = String.raw`
import socket,sys
kind,host,port,token=sys.argv[1],sys.argv[2],int(sys.argv[3]),sys.argv[4]
s=socket.create_connection((host,port),8); s.settimeout(8)
if kind=="ssh":
  data=s.recv(128)
  assert data.startswith(b"SSH-"), repr(data)
else:
  s.sendall(token.encode()); data=s.recv(4096)
  assert data==token.encode(), repr(data)
s.close(); print("PASS")
`;

const UDP_PROBE = String.raw`
import socket,sys
host,port,token=sys.argv[1],int(sys.argv[2]),sys.argv[3]
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(8)
s.sendto(token.encode(),(host,port)); data,_=s.recvfrom(4096)
assert data==token.encode(),repr(data)
s.close(); print("PASS")
`;

const DENIED_TCP_PROBE = String.raw`
import errno,socket,sys
host,port=sys.argv[1],int(sys.argv[2])
s=socket.socket(); s.settimeout(5)
try:
  s.connect((host,port))
except socket.timeout:
  print("PASS"); sys.exit(0)
except OSError as exc:
  if exc.errno in (errno.ENETUNREACH,errno.EHOSTUNREACH,errno.ETIMEDOUT):
    print("PASS"); sys.exit(0)
  raise
raise RuntimeError("destination was reachable")
`;

function runCommandSpec(spec, label, run) {
  const result = run(spec.argv, { timeoutMs: spec.timeoutMs });
  requireSuccess(result, label);
  if (result.stdout.trim() !== spec.expectedStdout) {
    throw new Error(`${label} stdout must equal ${spec.expectedStdout}`);
  }
}

export function executeAcceptance(args, dependencies = {}) {
  const run = dependencies.run ?? defaultRun;
  const nonce = `ADR146_${Date.now().toString(36).toUpperCase()}`;
  let primaryError;
  let cleanupError;
  try {
    const identities = assertPodContour(args, run);
    console.log(
      `PASS pod-contour fullAssistant=${identities.fullAssistant} restrictedAssistant=${identities.restrictedAssistant}`
    );

    for (const [check, host, port, kind] of [
      ["full-public-ssh", args.sshHost, args.sshPort, "ssh"],
      ["full-public-custom-tcp", args.tcpHost, args.tcpPort, "echo"]
    ]) {
      const result = kubectlExec(
        args,
        args.fullPublicPod,
        ["python3", "-c", TCP_PROBE, kind, host, String(port), nonce],
        run
      );
      requireSuccess(result, check);
      console.log(`PASS ${check}`);
    }
    const udp = kubectlExec(
      args,
      args.fullPublicPod,
      ["python3", "-c", UDP_PROBE, args.udpHost, String(args.udpPort), nonce],
      run
    );
    requireSuccess(udp, "full-public-custom-udp");
    console.log("PASS full-public-custom-udp");

    const allow = kubectlExec(
      args,
      args.restrictedPod,
      ["curl", "--fail", "--silent", "--show-error", "--max-time", "10", args.restrictedAllowUrl],
      run
    );
    requireSuccess(allow, "restricted-proxy-allow");
    const deny = kubectlExec(
      args,
      args.restrictedPod,
      [
        "curl",
        "--silent",
        "--output",
        "/dev/null",
        "--max-time",
        "10",
        "--write-out",
        "%{http_connect}",
        args.restrictedDenyUrl
      ],
      run
    );
    requireSuccess(deny, "restricted-proxy-deny");
    if (deny.stdout.trim() !== "403")
      throw new Error("restricted proxy denial must be CONNECT 403");
    const bypass = kubectlExec(
      args,
      args.restrictedPod,
      [
        "env",
        "-u",
        "HTTP_PROXY",
        "-u",
        "HTTPS_PROXY",
        "-u",
        "ALL_PROXY",
        "-u",
        "http_proxy",
        "-u",
        "https_proxy",
        "-u",
        "all_proxy",
        "curl",
        "--silent",
        "--output",
        "/dev/null",
        "--max-time",
        "5",
        args.restrictedAllowUrl
      ],
      run
    );
    if (bypass.status !== 28) {
      throw new Error(
        `restricted direct bypass must time out (curl 28), got ${String(bypass.status)}`
      );
    }
    console.log("PASS restricted-proxy-and-direct-bypass");

    const redirectHead = kubectlExec(
      args,
      args.fullPublicPod,
      [
        "curl",
        "--silent",
        "--show-error",
        "--dump-header",
        "-",
        "--output",
        "/dev/null",
        "--max-redirs",
        "0",
        args.redirectUrl
      ],
      run
    );
    requireSuccess(redirectHead, "redirect-fixture-shape");
    const location = redirectHead.stdout.match(/^location:\s*(\S+)\s*$/im)?.[1];
    if (!location || new URL(location).hostname !== args.redirectTargetHost) {
      throw new Error("redirect fixture Location does not match redirectTargetHost");
    }
    const redirectFollow = kubectlExec(
      args,
      args.fullPublicPod,
      [
        "curl",
        "--location",
        "--silent",
        "--output",
        "/dev/null",
        "--max-time",
        "5",
        args.redirectUrl
      ],
      run
    );
    if (redirectFollow.status !== 28) {
      throw new Error(
        `redirect to denied destination must time out (curl 28), got ${String(redirectFollow.status)}`
      );
    }
    console.log("PASS redirect-private-denial");

    const dns = kubectlExec(
      args,
      args.fullPublicPod,
      ["getent", "ahostsv4", args.privateDnsHost],
      run
    );
    requireSuccess(dns, "private-dns-resolution");
    const resolvedIps = dns.stdout.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
    if (
      !resolvedIps.includes(args.privateDnsIp) ||
      resolvedIps.some((ip) => !isDeniedPrivateIpv4(ip))
    ) {
      throw new Error("private DNS fixture must resolve only to denied private/special-use IPv4");
    }
    const deniedDnsConnect = kubectlExec(
      args,
      args.fullPublicPod,
      ["python3", "-c", DENIED_TCP_PROBE, args.privateDnsHost, String(args.privateDnsPort)],
      run
    );
    requireSuccess(deniedDnsConnect, "private-dns-connect-denial");
    console.log("PASS dns-private-resolution-denial");

    const second = kubectlExec(
      args,
      args.restrictedPod,
      ["python3", "-c", 'print("SECOND_ASSISTANT_UNCHANGED_OK")'],
      run
    );
    requireSuccess(second, "second-assistant-smoke");
    if (second.stdout.trim() !== "SECOND_ASSISTANT_UNCHANGED_OK") {
      throw new Error("second assistant sentinel mismatch");
    }
    assertPodContour(args, run);
    console.log("PASS unaffected-second-assistant");

    runCommandSpec(args.browserSmokeSpec, "unchanged-browser-smoke", run);
    console.log("PASS unchanged-browser-smoke");
    runCommandSpec(args.webSearchSmokeSpec, "unchanged-web-search-smoke", run);
    console.log("PASS unchanged-web-search-smoke");
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      runCommandSpec(args.cleanupSpec, "operator-fixture-cleanup", run);
      console.log("PASS operator-fixture-cleanup");
    } catch (error) {
      cleanupError = error;
    }
  }
  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      "acceptance probe and cleanup both failed"
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  console.log(
    "RESULT PASS ADR-146 S6 acceptance probes (operator must record evidence; no closure claim)"
  );
}

function usage() {
  return `Usage:
  node infra/bootstrap/adr146-s6-live-acceptance.mjs [required flags] [--execute]

Required operator-owned fixtures (no defaults):
  --full-public-pod POD --restricted-pod POD
  --ssh-host HOST --ssh-port PORT
  --tcp-host HOST --tcp-port PORT
  --udp-host HOST --udp-port PORT
  --restricted-allow-url URL --restricted-deny-url URL
  --redirect-url URL --redirect-target-host HOST
  --private-dns-host HOST --private-dns-ip DENIED_IPV4 --private-dns-port PORT
  --browser-smoke-spec REPO_JSON --web-search-smoke-spec REPO_JSON
  --cleanup-spec REPO_JSON

Dry-run validates every input/spec and prints no live success claim. --execute
runs bounded probes with per-operation deadlines and always runs cleanup-spec.
`;
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) return process.stdout.write(usage());
  const args = validateArgs(parsed);
  if (!args.execute) {
    console.log("DRY-RUN PASS: inputs/specs valid; no probes or cleanup executed.");
    return;
  }
  executeAcceptance(args);
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
