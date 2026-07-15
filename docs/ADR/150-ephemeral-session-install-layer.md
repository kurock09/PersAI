# ADR-150: Ephemeral Session Install Layer

## Status

**Closed 2026-07-16 — founder-accepted.** Implementation pushed as `314ee37a`
(handoff `25a910eb`). Session install-layer is warm-pod ephemeral only;
session-anchored pull/push excludes + path-aware purge; no GCS/Files/`files.*`
persistence of `.local` / `.npm-global` / `node_modules`. Supersedes ADR-148’s
storage-plane persistence of install trees only. ADR-148 warmth/env/quota remain
in force. Do not reopen ADR-146, ADR-148, or ADR-150 for new scope.

## Date

2026-07-15

## Problem

ADR-148 correctly moved `HOME` / `PYTHONUSERBASE` / `NPM_CONFIG_PREFIX` under the
canonical session root and widened per-job dependency quotas so realistic
package installs do not poison ordinary file limits.

It left those trees on the same produced-file path as work artifacts:

- after every `shell` / `exec` job, the control plane walks the whole session
  root and mirrors changed descendants to GCS;
- cold session hydrate downloads every object under the session prefix;
- runtime upserts every mirrored path into `workspace_file_metadata`;
- Files UI / `files.list` / `files.search` surface those rows as assistant files.

A single `pip install` of a common stack can create thousands of objects. Cold
hydrate then takes minutes, the Files gallery fills with package noise, and
micro-description jobs chase install trees. That is not product storage truth:
installs are execution state, not user work product.

Popular packages already belong in the immutable exec image (`/opt/venv` and
curated system tools). Session-time installs must stay warm-pod-local only.

## Decision

### 1. Install-layer is ephemeral (warm pod only)

Under the active session root, these trees are **install-layer**:

- `<sessionRoot>/.local/**` (`PYTHONUSERBASE`)
- `<sessionRoot>/.npm-global/**` (`NPM_CONFIG_PREFIX`)
- `<sessionRoot>/node_modules/**` and nested `node_modules/**`

Contract:

- They may exist and be used inside a **warm** session pod for the idle TTL.
- They are **not** mirrored to GCS as produced files.
- They are **not** included in session `workspace.tar` snapshots.
- Full `/workspace` pod↔control-plane tar pull/push excludes only
  `assistants/*/sessions/*/{.local,.npm-global,node_modules}` (session-anchored);
  assistant `shared/.../node_modules` is preserved. Path-aware purge after pull
  removes nested session install residue without touching shared trees.
- They are **not** hydrated from GCS on cold start or on-demand prefix hydrate.
- They are **not** upserted into `workspace_file_metadata`.
- They are **not** shown in Files gallery, `files.list`, `files.search`,
  `grep`, or `glob`.
- `files.write` refuses install-layer paths before any GCS upload.
- When the warm pod dies, the install-layer dies with it. The next cold start
  gets work artifacts only; rare extras must be reinstalled in-pod if still
  needed.

Shared path truth lives in `@persai/runtime-contract` as
`isSessionInstallLayerPath`. Sandbox quota classification continues to treat the
same trees as the dependency contour (ADR-148 §4) so in-pod growth stays
bounded without counting as ordinary user-file growth.

### 2. Persist only work artifacts

Session/GCS/Files persistence remains for ordinary session descendants and
shared widen paths that are **not** install-layer: scripts, data, documents,
model-authored outputs, user uploads.

### 3. Curated popular packages stay in the exec image

Default popular Python/document/data packages remain preinstalled in
`apps/sandbox/exec-image` (`/opt/venv`). Expanding that curated set is the
supported way to make common imports fast without session GCS persistence.
Runtime `pip install --user` / npm prefix installs remain allowed for rare
extras inside the warm pod only.

### 4. Legacy GCS / manifest residue

Existing install-layer objects or manifest rows (from before this ADR) are
**read-filtered**: hydrate skips them; list/search/gallery/upsert refuse them.
No mandatory bulk GCS purge is required for correctness of the product
contract. Optional operator cleanup of orphan blobs is out of scope.

## Consequences

### Positive

- Cold start no longer object-hydrates thousands of package files.
- Files UI and model `files.*` stay about work product.
- Warm sessions still reuse in-pod installs across jobs within TTL.
- Dependency quota contour still protects the pod from runaway installs.

### Negative / residual

- After pod recycle, session-time extras must be reinstalled (or added to the
  curated image).
- Pre-ADR-150 GCS install blobs may remain until ordinary GC / operator purge;
  they are inert for hydrate and UI.

## Verification

- Contract unit tests for `isSessionInstallLayerPath` (including nested
  `…/node_modules` directories).
- Sandbox: produced-file scan skips install directories; hydrate filters keys;
  session snapshot + pull/push tar exclude install basenames; restore overlay
  purges legacy install trees; mirror helper refuses install paths.
- API: gallery / list / search / grep / glob / upsert skip or refuse
  install-layer paths.
- Runtime: produced-file sync skip; `files.write` refuses before GCS upload.
- AGENTS verification gate for touched packages.
