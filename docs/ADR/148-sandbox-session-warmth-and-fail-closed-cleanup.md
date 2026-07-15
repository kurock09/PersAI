# ADR-148: Sandbox Session Warmth and Fail-Closed Cleanup

## Status

**Closed 2026-07-15 — founder live-accepted.** Warm session TTL holds in
`persai-dev`. Implementation landed as `9e26f145` (warmth + fail-closed
cleanup) plus `2342c2ae` (cleanup false-positive `remaining_pids` repair).
Live sandbox control-plane image includes the repair (`bdd03007` and later).
ADR-146 remains closed; ADR-148 supersedes only ADR-146 Slice 3's over-broad
"retire every bound pod at terminal handling" behavior. Do not reopen for new
scope.

**Supersession (ADR-150, 2026-07-15):** install-layer trees under the session
root (`.local`, `.npm-global`, `node_modules`) remain warm-pod execution state
and keep the ADR-148 dependency-quota contour, but they are **no longer**
persisted or restored via the storage plane. See
`docs/ADR/150-ephemeral-session-install-layer.md`.

## Date

2026-07-14 (opened) / 2026-07-15 (closed)

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
- Cleanup collects leftover PIDs in-shell (never via command substitution that
  would count its own subshell), parses tab-separated gVisor `/proc/*/status`
  with default IFS, and ignores threads, zombies, and cleanup-shell children.
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
- `pip install --user ...` and npm global tools persist across commands **inside
  the warm pod** for the idle TTL (ADR-148 env paths).
- **ADR-150:** those install trees do **not** persist across cold pod
  recreation via GCS; curated packages belong in the exec image.
- Normal dependency installs no longer poison later commands by tripping the
  ordinary user-file quota.
- Cleanup proof is stronger than "always delete the pod", because safe reuse now
  requires explicit descendant termination and post-clean verification.

### Negative / residual

- Cleanup still depends on `/proc` visibility inside the gVisor exec environment.
- Real cleanup-proof failure still retires the exact UID fail-closed (correct
  safety trade for warmth).
- Product follow-ups outside this ADR (Stop/soft-detach side effects, richer
  shell activity UI) remain separate work and must not reopen ADR-148.

## Verification

Local focused regressions covered warm reuse, cleanup-failure retirement,
sessionless retirement, session-root package paths, dependency contour, no
duplicate same-prefix hydrate, and honest cold-start probe logging.

Live acceptance (founder, 2026-07-15): warm TTL holds after the
`2342c2ae` cleanup repair on the deployed sandbox control plane.
