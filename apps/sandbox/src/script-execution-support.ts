import { createHash } from "node:crypto";
import type { RuntimeSandboxPolicy } from "@persai/runtime-contract";
import { canonicalizeJsonForHash } from "@persai/runtime-contract";

/**
 * ADR-151 — sandbox-local mirrors of the exact same `ScriptManifest`/`ScriptLimits`
 * shapes apps/api's `script-management.types.ts` validates at publish time. The
 * sandbox reads the immutable `ScriptVersion` row directly from its own Postgres
 * connection (never from the runtime), so it needs its own narrow read-side types
 * rather than importing apps/api application code across the process boundary.
 */
export type SandboxScriptManifest = {
  schemaVersion: 1;
  workingDirectory: string | null;
  environment: Record<string, string>;
};

export type SandboxScriptLimits = {
  timeoutMs: number;
  maxMemoryMb: number;
  maxCpuMillicores: number;
  maxOutputBytes: number;
};

export type SandboxScriptVersionArtifact = {
  id: string;
  scriptId: string;
  scriptKey: string;
  version: number;
  contentHash: string | null;
  status: "draft" | "published";
  code: string;
  runtime: string;
  entryCommand: string;
  manifest: SandboxScriptManifest;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  limits: SandboxScriptLimits;
  scriptStatus: "draft" | "published" | "archived";
};

/**
 * ADR-151 — platform-reserved environment keys a Script reads to find its own
 * entry/input/output files and invocation key. Admin-authored
 * `manifest.environment` entries that collide with these names are silently
 * dropped when building the execution shell — the reserved platform values
 * always win.
 */
export const PERSAI_SCRIPT_RESERVED_ENV_KEYS = [
  "PERSAI_SCRIPT_ENTRY_PATH",
  "PERSAI_SCRIPT_INPUT_PATH",
  "PERSAI_SCRIPT_OUTPUT_PATH",
  "PERSAI_SCRIPT_INVOCATION_KEY"
] as const;

/**
 * ADR-151 — a low-collision-probability text marker written to stdout after the
 * Script's own entry command exits, separating the Script's own diagnostic
 * stdout (before the marker) from the structured JSON result file contents
 * (after the marker, if present). This reuses the exec pod's existing stdout
 * capture channel instead of adding a new pod-file-read RPC.
 */
export const PERSAI_SCRIPT_RESULT_BOUNDARY_PREFIX = "___PERSAI_SCRIPT_RESULT_BOUNDARY_";

export function buildScriptResultMarker(scriptInvocationKey: string): string {
  return `${PERSAI_SCRIPT_RESULT_BOUNDARY_PREFIX}${scriptInvocationKey}__`;
}

function scriptShellSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * ADR-151 — reconcile the Script's own published `limits` with the assistant's
 * ordinary `RuntimeSandboxPolicy` by taking the stricter (minimum) of each
 * dimension. `maxCpuMillicores` is deliberately NOT reconciled into
 * `maxCpuMsPerJob` here beyond the timeout floor already shared with
 * `timeoutMs` — there is no live per-process cgroup CPU enforcement on the
 * shared warm session pod today, so CPU stays advisory (recorded in the policy
 * snapshot, not actively enforced). `maxOutputBytes` bounds the structured
 * result specifically and is enforced at parse time, not through the general
 * exec stdout/stderr byte caps.
 */
export function reconcileScriptSandboxPolicy(
  base: RuntimeSandboxPolicy,
  limits: SandboxScriptLimits
): RuntimeSandboxPolicy {
  return {
    ...base,
    maxProcessRuntimeMs: Math.min(base.maxProcessRuntimeMs, limits.timeoutMs),
    maxCpuMsPerJob: Math.min(base.maxCpuMsPerJob, limits.timeoutMs),
    maxMemoryBytesPerJob: Math.min(base.maxMemoryBytesPerJob, limits.maxMemoryMb * 1024 * 1024)
  };
}

/** ADR-151 — canonical SHA-256 hash of the exact validated mapped input object, used to detect a `scriptInvocationKey` collision against a different input on replay. */
export function computeScriptInputHash(input: unknown): string {
  return createHash("sha256").update(canonicalizeJsonForHash(input)).digest("hex");
}

export function computeScriptExecutableContentHash(
  artifact: Pick<
    SandboxScriptVersionArtifact,
    "code" | "manifest" | "inputSchema" | "outputSchema" | "runtime" | "entryCommand" | "limits"
  >
): string {
  return createHash("sha256")
    .update(
      canonicalizeJsonForHash({
        code: artifact.code,
        manifest: artifact.manifest,
        inputSchema: artifact.inputSchema,
        outputSchema: artifact.outputSchema,
        runtime: artifact.runtime,
        entryCommand: artifact.entryCommand,
        limits: artifact.limits
      })
    )
    .digest("hex");
}

export function resolveEffectiveScriptOutputBytes(
  policy: RuntimeSandboxPolicy,
  limits: SandboxScriptLimits,
  marker: string
): number {
  const framingBytes = Buffer.byteLength(`\n${marker}\n`, "utf8");
  const overflowSentinelBytes = 1;
  return Math.max(
    0,
    Math.min(
      limits.maxOutputBytes,
      policy.maxSingleFileWriteBytes,
      policy.maxStdoutBytes - framingBytes - overflowSentinelBytes
    )
  );
}

/**
 * ADR-151 — build the single `/bin/bash -lc` wrapper script that:
 * 1. exports the reserved platform env vars (never overridable by manifest env);
 * 2. exports admin-authored `manifest.environment` entries (reserved names skipped);
 * 3. runs the published `entryCommand` in a subshell so its own `cd`/`export`/`set`
 *    never escapes into the cleanup/result steps below;
 * 4. emits the boundary marker, then the contents of the output file if the Script
 *    wrote one;
 * 5. removes the entire transient `/tmp` script directory unconditionally; and
 * 6. exits with the entry command's own exit code.
 */
export function buildScriptExecutionShellCommand(input: {
  scriptDir: string;
  entryCommand: string;
  invocationKey: string | null;
  manifestEnvironment: Record<string, string>;
  resultMarker: string;
  maxOutputBytes: number;
}): string {
  const reserved = new Set<string>(PERSAI_SCRIPT_RESERVED_ENV_KEYS);
  const lines: string[] = [
    "set -o pipefail",
    `script_dir=${scriptShellSingleQuote(input.scriptDir)}`,
    'cleanup_script_dir() { rm -rf -- "$script_dir"; }',
    "trap cleanup_script_dir EXIT HUP INT TERM",
    `export PERSAI_SCRIPT_ENTRY_PATH=${scriptShellSingleQuote(`${input.scriptDir}/entry`)}`,
    `export PERSAI_SCRIPT_INPUT_PATH=${scriptShellSingleQuote(`${input.scriptDir}/input.json`)}`,
    `export PERSAI_SCRIPT_OUTPUT_PATH=${scriptShellSingleQuote(`${input.scriptDir}/output.json`)}`,
    `export PERSAI_SCRIPT_INVOCATION_KEY=${scriptShellSingleQuote(input.invocationKey ?? "")}`
  ];
  for (const [key, value] of Object.entries(input.manifestEnvironment)) {
    if (reserved.has(key)) {
      continue;
    }
    lines.push(`export ${key}=${scriptShellSingleQuote(value)}`);
  }
  lines.push(
    `(${input.entryCommand}) 1>&2`,
    "entry_exit=$?",
    `printf '\\n%s\\n' ${scriptShellSingleQuote(input.resultMarker)}`,
    `if [ -f "$PERSAI_SCRIPT_OUTPUT_PATH" ]; then head -c ${String(input.maxOutputBytes + 1)} "$PERSAI_SCRIPT_OUTPUT_PATH"; fi`,
    'exit "$entry_exit"'
  );
  return lines.join("\n");
}

/**
 * ADR-151 — split the raw captured stdout into the Script's own diagnostic
 * output (before the boundary marker) and the structured result text (after
 * it), when the marker is present. Absence of the marker means the wrapper
 * itself never reached the post-entry-command steps (e.g. the process was
 * killed) — the whole capture is treated as diagnostic-only in that case.
 */
export function splitScriptExecutionStdout(
  rawStdout: string | null,
  resultMarker: string
): {
  diagnosticStdout: string | null;
  resultText: string | null;
} {
  if (rawStdout === null) {
    return { diagnosticStdout: null, resultText: null };
  }
  const markerIndex = rawStdout.lastIndexOf(resultMarker);
  if (markerIndex === -1) {
    return { diagnosticStdout: rawStdout.length > 0 ? rawStdout : null, resultText: null };
  }
  const before = rawStdout.slice(0, markerIndex).replace(/\n$/, "");
  const after = rawStdout
    .slice(markerIndex + resultMarker.length)
    .replace(/^\n/, "")
    .trim();
  return {
    diagnosticStdout: before.length > 0 ? before : null,
    resultText: after.length > 0 ? after : null
  };
}

export type ScriptExecutionResultParseOutcome =
  | { ok: true; value: unknown }
  | { ok: false; code: string; message: string };

/**
 * ADR-151 — parse and bound the Script's structured result text. Bounded JSON
 * only: exceeding `maxOutputBytes` or failing to parse are both stable typed
 * failures, never a silent truncation/coercion.
 */
export function parseScriptExecutionResultJson(
  resultText: string | null,
  maxOutputBytes: number
): ScriptExecutionResultParseOutcome {
  if (resultText === null) {
    return {
      ok: false,
      code: "script_output_missing",
      message: "The Script did not write a result to PERSAI_SCRIPT_OUTPUT_PATH."
    };
  }
  if (Buffer.byteLength(resultText, "utf8") > maxOutputBytes) {
    return {
      ok: false,
      code: "script_output_too_large",
      message: `Script result exceeded the ${String(maxOutputBytes)}-byte limit.`
    };
  }
  try {
    return { ok: true, value: JSON.parse(resultText) };
  } catch {
    return {
      ok: false,
      code: "script_output_not_json",
      message: "The Script result at PERSAI_SCRIPT_OUTPUT_PATH was not valid JSON."
    };
  }
}
