import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RUNTIME_SANDBOX_POLICY } from "@persai/runtime-contract";
import {
  buildScriptExecutionShellCommand,
  buildScriptResultMarker,
  computeScriptInputHash,
  parseScriptExecutionResultJson,
  reconcileScriptSandboxPolicy,
  resolveEffectiveScriptOutputBytes,
  splitScriptExecutionStdout,
  type SandboxScriptLimits
} from "../src/script-execution-support";

const RESULT_MARKER = buildScriptResultMarker("test-invocation");

// ---------------------------------------------------------------------------
// reconcileScriptSandboxPolicy
// ---------------------------------------------------------------------------

test("reconcileScriptSandboxPolicy takes the stricter (minimum) of each reconciled dimension", () => {
  const limits: SandboxScriptLimits = {
    timeoutMs: 5_000,
    maxMemoryMb: 64,
    maxCpuMillicores: 500,
    maxOutputBytes: 4_096
  };
  const reconciled = reconcileScriptSandboxPolicy(DEFAULT_RUNTIME_SANDBOX_POLICY, limits);
  assert.equal(reconciled.maxProcessRuntimeMs, 5_000);
  assert.equal(reconciled.maxCpuMsPerJob, 5_000);
  assert.equal(reconciled.maxMemoryBytesPerJob, 64 * 1024 * 1024);
});

test("reconcileScriptSandboxPolicy does not loosen limits when the assistant policy is already stricter", () => {
  const limits: SandboxScriptLimits = {
    timeoutMs: 600_000, // far looser than the assistant's own 15s default.
    maxMemoryMb: 8_192,
    maxCpuMillicores: 4_000,
    maxOutputBytes: 1_048_576
  };
  const reconciled = reconcileScriptSandboxPolicy(DEFAULT_RUNTIME_SANDBOX_POLICY, limits);
  assert.equal(reconciled.maxProcessRuntimeMs, DEFAULT_RUNTIME_SANDBOX_POLICY.maxProcessRuntimeMs);
  assert.equal(reconciled.maxCpuMsPerJob, DEFAULT_RUNTIME_SANDBOX_POLICY.maxCpuMsPerJob);
  assert.equal(
    reconciled.maxMemoryBytesPerJob,
    DEFAULT_RUNTIME_SANDBOX_POLICY.maxMemoryBytesPerJob
  );
});

test("reconcileScriptSandboxPolicy leaves every other policy field untouched", () => {
  const limits: SandboxScriptLimits = {
    timeoutMs: 1_000,
    maxMemoryMb: 32,
    maxCpuMillicores: 250,
    maxOutputBytes: 1_024
  };
  const reconciled = reconcileScriptSandboxPolicy(
    { ...DEFAULT_RUNTIME_SANDBOX_POLICY, sandboxJobsPerDay: 7 },
    limits
  );
  assert.equal(reconciled.sandboxJobsPerDay, 7);
  assert.equal(reconciled.enabled, DEFAULT_RUNTIME_SANDBOX_POLICY.enabled);
});

test("resolveEffectiveScriptOutputBytes uses the strictest Script/stdout/single-file cap", () => {
  const markerBytes = Buffer.byteLength(`\n${RESULT_MARKER}\n`, "utf8");
  assert.equal(
    resolveEffectiveScriptOutputBytes(
      { ...DEFAULT_RUNTIME_SANDBOX_POLICY, maxStdoutBytes: 900, maxSingleFileWriteBytes: 700 },
      {
        timeoutMs: 1_000,
        maxMemoryMb: 32,
        maxCpuMillicores: 250,
        maxOutputBytes: 800
      },
      RESULT_MARKER
    ),
    Math.min(700, 900 - markerBytes - 1)
  );
});

// ---------------------------------------------------------------------------
// computeScriptInputHash
// ---------------------------------------------------------------------------

test("computeScriptInputHash is deterministic and independent of key order", () => {
  const a = computeScriptInputHash({ query: "hi", limit: 10 });
  const b = computeScriptInputHash({ limit: 10, query: "hi" });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("computeScriptInputHash distinguishes different input values", () => {
  const a = computeScriptInputHash({ query: "hi", limit: 10 });
  const b = computeScriptInputHash({ query: "hi", limit: 11 });
  assert.notEqual(a, b);
});

test("computeScriptInputHash treats null input consistently", () => {
  const a = computeScriptInputHash(null);
  const b = computeScriptInputHash(null);
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// buildScriptExecutionShellCommand
// ---------------------------------------------------------------------------

test("buildScriptExecutionShellCommand exports the reserved platform env vars and runs the published entryCommand", () => {
  const script = buildScriptExecutionShellCommand({
    scriptDir: "/tmp/persai-script/job-1",
    entryCommand: "python3 entry",
    invocationKey: "abc123",
    manifestEnvironment: {},
    resultMarker: RESULT_MARKER,
    maxOutputBytes: 1_024
  });
  assert.match(script, /export PERSAI_SCRIPT_ENTRY_PATH='\/tmp\/persai-script\/job-1\/entry'/);
  assert.match(
    script,
    /export PERSAI_SCRIPT_INPUT_PATH='\/tmp\/persai-script\/job-1\/input\.json'/
  );
  assert.match(
    script,
    /export PERSAI_SCRIPT_OUTPUT_PATH='\/tmp\/persai-script\/job-1\/output\.json'/
  );
  assert.match(script, /export PERSAI_SCRIPT_INVOCATION_KEY='abc123'/);
  assert.match(
    script,
    /\(python3 entry\) 1>&2/,
    "ordinary entry stdout is diagnostic stderr; only wrapper framing uses stdout"
  );
  assert.match(script, /trap cleanup_script_dir EXIT HUP INT TERM/);
  assert.match(script, /exit "\$entry_exit"/);
});

test("buildScriptExecutionShellCommand exports admin-authored manifest environment entries", () => {
  const script = buildScriptExecutionShellCommand({
    scriptDir: "/tmp/persai-script/job-2",
    entryCommand: "node entry.js",
    invocationKey: null,
    manifestEnvironment: { API_BASE_URL: "https://example.com" },
    resultMarker: RESULT_MARKER,
    maxOutputBytes: 1_024
  });
  assert.match(script, /export API_BASE_URL='https:\/\/example\.com'/);
});

test("buildScriptExecutionShellCommand silently drops manifest environment entries that collide with reserved platform keys", () => {
  const script = buildScriptExecutionShellCommand({
    scriptDir: "/tmp/persai-script/job-3",
    entryCommand: "bash entry.sh",
    invocationKey: "key-1",
    manifestEnvironment: {
      PERSAI_SCRIPT_INVOCATION_KEY: "attacker-supplied-override",
      PERSAI_SCRIPT_OUTPUT_PATH: "/etc/passwd",
      SAFE_VAR: "kept"
    },
    resultMarker: RESULT_MARKER,
    maxOutputBytes: 1_024
  });
  // The reserved platform value wins; the manifest override never appears.
  assert.ok(!script.includes("attacker-supplied-override"));
  assert.ok(!script.includes("/etc/passwd"));
  assert.match(script, /export PERSAI_SCRIPT_INVOCATION_KEY='key-1'/);
  assert.match(script, /export SAFE_VAR='kept'/);
});

test("buildScriptExecutionShellCommand handles a null invocationKey as an empty string, never as a literal 'null'", () => {
  const script = buildScriptExecutionShellCommand({
    scriptDir: "/tmp/persai-script/job-4",
    entryCommand: "true",
    invocationKey: null,
    manifestEnvironment: {},
    resultMarker: RESULT_MARKER,
    maxOutputBytes: 1_024
  });
  assert.match(script, /export PERSAI_SCRIPT_INVOCATION_KEY=''/);
});

test("buildScriptExecutionShellCommand emits the per-invocation marker and installs cleanup traps", () => {
  const script = buildScriptExecutionShellCommand({
    scriptDir: "/tmp/persai-script/job-5",
    entryCommand: "exit 1",
    invocationKey: "key",
    manifestEnvironment: {},
    resultMarker: RESULT_MARKER,
    maxOutputBytes: 1_024
  });
  assert.ok(script.includes(RESULT_MARKER));
  assert.match(script, /trap cleanup_script_dir EXIT HUP INT TERM/);
});

// ---------------------------------------------------------------------------
// splitScriptExecutionStdout
// ---------------------------------------------------------------------------

test("splitScriptExecutionStdout separates diagnostic stdout from the structured result after the boundary marker", () => {
  const raw = `line one\nline two\n${RESULT_MARKER}\n{"result":"ok"}`;
  const { diagnosticStdout, resultText } = splitScriptExecutionStdout(raw, RESULT_MARKER);
  assert.equal(diagnosticStdout, "line one\nline two");
  assert.equal(resultText, '{"result":"ok"}');
});

test("splitScriptExecutionStdout uses the final per-job marker occurrence", () => {
  const raw = `${RESULT_MARKER}\nspoof\n${RESULT_MARKER}\n{"result":"ok"}`;
  const { diagnosticStdout, resultText } = splitScriptExecutionStdout(raw, RESULT_MARKER);
  assert.equal(diagnosticStdout, `${RESULT_MARKER}\nspoof`);
  assert.equal(resultText, '{"result":"ok"}');
});

test("splitScriptExecutionStdout treats the whole capture as diagnostic-only when the marker never appears (e.g. process killed)", () => {
  const raw = "partial output before being killed";
  const { diagnosticStdout, resultText } = splitScriptExecutionStdout(raw, RESULT_MARKER);
  assert.equal(diagnosticStdout, raw);
  assert.equal(resultText, null);
});

test("splitScriptExecutionStdout returns nulls for null stdout and treats an empty post-marker result as absent", () => {
  const nullCase = splitScriptExecutionStdout(null, RESULT_MARKER);
  assert.deepEqual(nullCase, { diagnosticStdout: null, resultText: null });

  const emptyResult = splitScriptExecutionStdout(`before\n${RESULT_MARKER}\n`, RESULT_MARKER);
  assert.equal(emptyResult.diagnosticStdout, "before");
  assert.equal(emptyResult.resultText, null);
});

// ---------------------------------------------------------------------------
// parseScriptExecutionResultJson
// ---------------------------------------------------------------------------

test("parseScriptExecutionResultJson fails closed with script_output_missing when the Script never wrote a result file", () => {
  const outcome = parseScriptExecutionResultJson(null, 1_024);
  assert.equal(outcome.ok, false);
  assert.equal((outcome as { code: string }).code, "script_output_missing");
});

test("parseScriptExecutionResultJson fails closed with script_output_too_large when the result exceeds maxOutputBytes", () => {
  const oversized = JSON.stringify({ data: "x".repeat(2_000) });
  const outcome = parseScriptExecutionResultJson(oversized, 1_024);
  assert.equal(outcome.ok, false);
  assert.equal((outcome as { code: string }).code, "script_output_too_large");
});

test("parseScriptExecutionResultJson fails closed with script_output_not_json for malformed JSON", () => {
  const outcome = parseScriptExecutionResultJson("not json at all", 1_024);
  assert.equal(outcome.ok, false);
  assert.equal((outcome as { code: string }).code, "script_output_not_json");
});

test("parseScriptExecutionResultJson parses and returns a well-formed, in-bound JSON result", () => {
  const outcome = parseScriptExecutionResultJson('{"result":"ok","count":3}', 1_024);
  assert.equal(outcome.ok, true);
  assert.deepEqual((outcome as { value: unknown }).value, { result: "ok", count: 3 });
});
