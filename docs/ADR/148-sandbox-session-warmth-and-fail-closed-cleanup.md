# ADR-148: Sandbox Session Warmth and Fail-Closed Cleanup

## Status

Implemented locally 2026-07-14 against clean baseline `5f6a7cb9` on isolated
branch `sandbox-session-warmth-repair`. Deploy and live acceptance are still
required. ADR-146 remains closed; ADR-148 only supersedes ADR-146 Slice 3's
over-broad "retire every bound pod at terminal handling" behavior.

## Date

2026-07-14

## Problem

Session-scoped sandbox pods were being retired after every `shell` / `exec` /
`document.*` job, even when the pod was healthy and the session remained active.
That regression broke the intended 15-minute warm-session behavior, forced full
rehydration on every command, and made runtime package installs effectively
non-persistent.

The same regression also removed the only cleanup proof that remained after the
unsafe writable `/tmp` PGID-marker design was deleted: by retiring the whole pod,
the system avoided proving that descendant processes were gone. ADR-148 must
restore warm reuse without weakening fail-closed cleanup.

## Decision

### 1. Healthy session pods stay alive

- Session-scoped jobs keep reusing the same exact pod UID after completed,
  failed, or blocked terminal handling when cleanup can prove the pod is clean.
- Sessionless jobs remain disposable and still retire their exact bound pod at
  terminal handling.
- Existing recycle paths remain authoritative: idle TTL, mode mismatch,
  contamination, generation drift, explicit reconcile, and infrastructure
  failure still delete the exact stale UID.

### 2. Cleanup becomes control-plane-owned and fail-closed

- Each Running exec pod records a baseline process set in a pod annotation owned
  by the control plane.
- After every model job, and only after workspace/output persistence succeeds,
  the control plane runs a cleanup exec in the pod.
- Cleanup preserves the pod's base process set and its own exec ancestry, sends
  `TERM`, waits briefly, then sends `KILL` to any residual non-baseline
  processes, including daemonized descendants.
- Cleanup succeeds only when no non-baseline processes remain.
- If cleanup proof fails for any reason, the exact bound pod UID is retired
  before lease release.
- Lease release still happens only after terminal persistence plus either:
  - successful session cleanup; or
  - successful exact-UID retirement.

Writable model-controlled process markers do not return.

### 3. Runtime package state lives inside the canonical session root

For session jobs, the runtime environment now points to the current canonical
session root:

- `HOME=/workspace/assistants/<assistantId>/sessions/<sessionId>`
- `PYTHONUSERBASE=<sessionRoot>/.local`
- `NPM_CONFIG_PREFIX=<sessionRoot>/.npm-global`
- `PATH=<sessionRoot>/.npm-global/bin:<sessionRoot>/.local/bin:/opt/venv/bin:$PATH`

Both direct exec and login-shell paths use the same environment. No compatibility
aliases under fixed `/workspace/.local` or `/workspace/.npm-global` are kept.

### 4. Dependency growth has its own bounded contour

Ordinary user-produced workspace growth keeps the existing strict per-job policy
limits.

Dependency trees under the active session root get a separate bounded contour:

- `maxAddedFilesPerJob = 20_000`
- `maxAddedDirectoriesPerJob = 4_000`
- `maxAddedBytesPerJob = 512 MiB`

Only active session dependency paths are counted in that contour:

- `<sessionRoot>/.local/**`
- `<sessionRoot>/.npm-global/**`
- `<sessionRoot>/node_modules/**`
- nested `node_modules/**` under the current session root

Previously restored dependency files are part of the baseline and are not
recounted as freshly created on later jobs.

### 5. Redundant session-prefix hydration is removed

The old "recover cwd from storage plane" path could rehydrate the same canonical
session prefix after the initial session/bootstrap hydrate. ADR-148 removes that
redundant on-demand recovery path so one cold start does not pull the same
session subtree twice.

### 6. Cold-start probe warnings become honest

`stdinless_probe_failed` warnings are retained only for unexpected probe
failures. Expected marker-miss checks at cold start are no longer logged as
warnings.

## Consequences

### Positive

- Warm sessions actually remain warm for the configured idle TTL.
- `pip install --user ...` and npm global tools persist across commands and after
  legitimate pod recreation.
- Normal dependency installs no longer poison later commands by tripping the
  ordinary user-file quota.
- Cleanup proof is stronger than "always delete the pod", because safe reuse now
  requires explicit descendant termination and post-clean verification.

### Negative / residual

- Cleanup now depends on `/proc` visibility and the pod process table staying
  inspectable inside the gVisor exec environment.
- When cleanup proof fails, the system retires the whole pod fail-closed and
  loses warmth for that session until the next hydrate.
- Live pin `9e26f145` initially still lost warmth on every job because cleanup
  treated its own `$(target_pids)` subshell as a leftover (`remaining_pids=<n>`)
  and because space-only `IFS` failed to parse tab-separated gVisor
  `/proc/*/status`. The 2026-07-15 repair collects targets in-shell, parses
  status with default IFS, and ignores threads/zombies/cleanup-shell children.
- Full confidence still requires redeploy of that repair plus live acceptance
  against a real cluster and real package-install workloads.

## Verification required

Local focused regression evidence must cover:

1. completed session job keeps the exact pod UID reusable;
2. failed/blocked session job also reuses when cleanup proves clean;
3. cleanup failure retires the exact pod UID before lease release;
4. sessionless jobs still retire;
5. runtime environment points pip/npm into the canonical session root;
6. dependency contour permits realistic installs but rejects abusive growth;
7. duplicate cold-start hydration of the same session prefix is absent;
8. expected cold-start marker misses do not emit `stdinless_probe_failed`.

Repository-level verification remains the AGENTS gate plus deploy/live acceptance.
