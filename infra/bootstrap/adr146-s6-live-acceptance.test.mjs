import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  executeAcceptance,
  isDeniedPrivateIpv4,
  parseArgs,
  validateArgs
} from "./adr146-s6-live-acceptance.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function writeSpec(root, name, sentinel) {
  const file = path.join(root, `${name}.json`);
  writeFileSync(
    file,
    `${JSON.stringify({
      argv: [`operator-${name}`],
      expectedStdout: sentinel,
      timeoutMs: 10_000
    })}\n`
  );
  return path.basename(file);
}

function validArgv(root) {
  return [
    "--full-public-pod",
    "full-pod",
    "--restricted-pod",
    "restricted-pod",
    "--ssh-host",
    "ssh.fixture.operator.example",
    "--ssh-port",
    "2222",
    "--tcp-host",
    "tcp.fixture.operator.example",
    "--tcp-port",
    "4100",
    "--udp-host",
    "udp.fixture.operator.example",
    "--udp-port",
    "4101",
    "--restricted-allow-url",
    "https://allowed.operator.example/",
    "--restricted-deny-url",
    "https://denied.operator.example/",
    "--redirect-url",
    "https://redirect.operator.example/to-private",
    "--redirect-target-host",
    "10.20.30.40",
    "--private-dns-host",
    "rebind.operator.example",
    "--private-dns-ip",
    "10.20.30.40",
    "--private-dns-port",
    "443",
    "--browser-smoke-spec",
    writeSpec(root, "browser", "ADR146_BROWSER_UNCHANGED_OK"),
    "--web-search-smoke-spec",
    writeSpec(root, "web-search", "ADR146_WEB_SEARCH_UNCHANGED_OK"),
    "--cleanup-spec",
    writeSpec(root, "cleanup", "ADR146_FIXTURES_CLEANED"),
    "--execute"
  ];
}

test("validates complete operator-owned acceptance inputs", () => {
  const root = mkdtempSync(path.join(tmpdir(), "adr146-s6-"));
  const result = validateArgs(parseArgs(validArgv(root)), root);
  assert.equal(result.sshPort, 2222);
  assert.equal(result.privateDnsIp, "10.20.30.40");
  assert.equal(result.cleanupSpec.expectedStdout, "ADR146_FIXTURES_CLEANED");
});

test("fails closed on missing fixture inputs, unsafe URLs, and public private IPs", () => {
  const root = mkdtempSync(path.join(tmpdir(), "adr146-s6-"));
  assert.throws(() => validateArgs(parseArgs([]), root), /missing required/);
  assert.throws(() => parseArgs(["--unknown", "value"]), /unknown argument/);

  const unsafeUrl = validArgv(root);
  unsafeUrl[unsafeUrl.indexOf("--redirect-url") + 1] =
    "https://user:secret@redirect.operator.example/path?token=secret";
  assert.throws(() => validateArgs(parseArgs(unsafeUrl), root), /credentials, query, or fragment/);

  const privateSsh = validArgv(root);
  privateSsh[privateSsh.indexOf("--ssh-host") + 1] = "10.0.0.1";
  assert.throws(() => validateArgs(parseArgs(privateSsh), root), /must not be private/);

  const markerSpec = path.join(root, "marker.json");
  writeFileSync(
    markerSpec,
    '{"argv":["REPLACE_WITH_OPERATOR_COMMAND"],"expectedStdout":"ADR146_BROWSER_OK","timeoutMs":10000}\n'
  );
  const replacementMarker = validArgv(root);
  replacementMarker[replacementMarker.indexOf("--browser-smoke-spec") + 1] =
    path.basename(markerSpec);
  assert.throws(() => validateArgs(parseArgs(replacementMarker), root), /replacement marker/);
});

test("recognizes denied private, loopback, link-local, and metadata IPv4", () => {
  for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.31.0.1", "192.168.1.1"]) {
    assert.equal(isDeniedPrivateIpv4(ip), true, ip);
  }
  assert.equal(isDeniedPrivateIpv4("8.8.8.8"), false);
  assert.equal(isDeniedPrivateIpv4("not-an-ip"), false);
});

test("rollback snippets fail fast and clean the temporary token", () => {
  const runbook = readFileSync(path.join(repoRoot, "infra/dev/gke/RUNBOOK.md"), "utf8");
  for (const required of [
    "set -euo pipefail",
    "trap cleanup_sandbox_token EXIT",
    "trap 'exit 130' INT",
    "trap 'exit 143' HUP TERM",
    "curl --fail-with-body",
    '$ErrorActionPreference = "Stop"',
    "try {",
    "finally {",
    "Remove-Item Env:PERSAI_INTERNAL_SANDBOX_TOKEN -ErrorAction SilentlyContinue"
  ]) {
    assert.ok(runbook.includes(required), required);
  }
  assert.equal(runbook.includes("export PERSAI_INTERNAL_API_TOKEN"), false);
});

test("runs cleanup after an early probe failure", () => {
  const root = mkdtempSync(path.join(tmpdir(), "adr146-s6-"));
  const args = validateArgs(parseArgs(validArgv(root)), root);
  const calls = [];
  const run = (argv) => {
    calls.push(argv);
    if (argv[0] === "operator-cleanup") {
      return { status: 0, stdout: "ADR146_FIXTURES_CLEANED\n", stderr: "" };
    }
    if (argv[0] === "kubectl" && argv.includes("get")) {
      const pod = argv[argv.indexOf("pod") + 1];
      const full = pod === "full-pod";
      return {
        status: 0,
        stdout: JSON.stringify({
          metadata: {
            labels: { "persai.io/sandbox-egress": full ? "full-public" : "restricted" },
            annotations: { "persai.io/assistant-id": full ? "assistant-a" : "assistant-b" }
          },
          status: { phase: "Running" }
        }),
        stderr: ""
      };
    }
    return { status: 9, stdout: "", stderr: "fixture unavailable" };
  };

  assert.throws(() => executeAcceptance(args, { run }), /full-public-ssh failed/);
  assert.equal(calls.at(-1)[0], "operator-cleanup");
});

test("executes the complete bounded acceptance matrix", () => {
  const root = mkdtempSync(path.join(tmpdir(), "adr146-s6-"));
  const args = validateArgs(parseArgs(validArgv(root)), root);
  const calls = [];
  const run = (argv) => {
    calls.push(argv);
    if (argv[0].startsWith("operator-")) {
      const sentinels = {
        "operator-browser": "ADR146_BROWSER_UNCHANGED_OK",
        "operator-web-search": "ADR146_WEB_SEARCH_UNCHANGED_OK",
        "operator-cleanup": "ADR146_FIXTURES_CLEANED"
      };
      return { status: 0, stdout: `${sentinels[argv[0]]}\n`, stderr: "" };
    }
    if (argv[0] === "kubectl" && argv.includes("get")) {
      const pod = argv[argv.indexOf("pod") + 1];
      const full = pod === "full-pod";
      return {
        status: 0,
        stdout: JSON.stringify({
          metadata: {
            labels: { "persai.io/sandbox-egress": full ? "full-public" : "restricted" },
            annotations: { "persai.io/assistant-id": full ? "assistant-a" : "assistant-b" }
          },
          status: { phase: "Running" }
        }),
        stderr: ""
      };
    }
    if (argv.includes("getent")) {
      return { status: 0, stdout: "10.20.30.40 STREAM rebind.operator.example\n", stderr: "" };
    }
    if (argv.includes("--dump-header")) {
      return {
        status: 0,
        stdout: "HTTP/1.1 302 Found\r\nLocation: http://10.20.30.40/\r\n\r\n",
        stderr: ""
      };
    }
    if (argv.includes("--location")) return { status: 28, stdout: "", stderr: "timeout" };
    if (argv.includes("%{http_connect}")) return { status: 0, stdout: "403", stderr: "" };
    if (argv.includes("env")) return { status: 28, stdout: "", stderr: "timeout" };
    if (argv.some((arg) => arg.includes("SECOND_ASSISTANT_UNCHANGED_OK"))) {
      return { status: 0, stdout: "SECOND_ASSISTANT_UNCHANGED_OK\n", stderr: "" };
    }
    return { status: 0, stdout: "PASS\n", stderr: "" };
  };

  executeAcceptance(args, { run });
  assert.ok(calls.some((argv) => argv.includes("ssh.fixture.operator.example")));
  assert.ok(calls.some((argv) => argv.includes("tcp.fixture.operator.example")));
  assert.ok(calls.some((argv) => argv.includes("udp.fixture.operator.example")));
  assert.equal(calls.at(-1)[0], "operator-cleanup");
});

test("reports both probe and cleanup failures", () => {
  const root = mkdtempSync(path.join(tmpdir(), "adr146-s6-"));
  const args = validateArgs(parseArgs(validArgv(root)), root);
  const run = (argv) => {
    if (argv[0] === "kubectl" && argv.includes("get")) {
      const pod = argv[argv.indexOf("pod") + 1];
      const full = pod === "full-pod";
      return {
        status: 0,
        stdout: JSON.stringify({
          metadata: {
            labels: { "persai.io/sandbox-egress": full ? "full-public" : "restricted" },
            annotations: { "persai.io/assistant-id": full ? "assistant-a" : "assistant-b" }
          },
          status: { phase: "Running" }
        }),
        stderr: ""
      };
    }
    return { status: 1, stdout: "", stderr: "failed" };
  };

  assert.throws(
    () => executeAcceptance(args, { run }),
    (error) => error instanceof AggregateError && error.errors.length === 2
  );
});
