# ADR-128 — Single `/workspace/` namespace; retire `/shared/<workspaceId>/`

Status: **Open 2026-06-26 — founder-acked. Continues ADR-126 v3 + ADR-127.**

Date: 2026-06-26
Continues: ADR-126 v3 (closed 2026-06-24) and ADR-127 (closed 2026-06-25). Does not reopen either; closes the structural gap they left unaddressed.

---

## Context

### Audit trigger

2026-06-25 founder live test. User uploaded `PersAI_B2B_FinModel_v3.xlsx` (15121 bytes) into a chat. The full pipeline worked:

- File written to pod at `/shared/<wsid>/input/PersAI_B2B_FinModel_v3.xlsx` (sandbox audit `workspace_file_writeed status=ok bytes=15121`).
- Bytes mirrored to GCS at `fs/workspaces/<wsid>/shared/input/...xlsx`.
- Manifest `workspace_file_metadata` row created with `path=/shared/input/PersAI_B2B_FinModel_v3.xlsx`, full `shortDescription` (model-canonical model-facing path).
- `AssistantChatMessageAttachment.storagePath=/shared/input/PersAI_B2B_FinModel_v3.xlsx`.

Despite the file being correctly placed everywhere, the model made **8 sequential tool calls** trying to read it. First attempt: `read /workspace/PersAI_B2B_FinModel_v3.xlsx → path_not_found` (audit). Then glob, knowledge search, two more files attempts, finally a shell. End state: model gives up, asks user to re-upload.

### Root cause — two namespaces with different semantics

| Path prefix | Storage | Persistent? | GCS sync? | Manifest? | Purpose |
| ----------- | ------- | ----------- | --------- | --------- | ------- |
| `/workspace/` | emptyDir, per-assistant | ❌ ephemeral | ❌ no | ❌ no | model private scratch |
| `/shared/<wsid>/input/` | emptyDir, per-workspace | ✅ (via hydrate from GCS) | ✅ auto | ✅ on upload | user uploads |
| `/shared/<wsid>/outbound/self/` | emptyDir, per-workspace | ✅ (via hydrate from GCS) | ✅ auto | ✅ on outbound registration | model deliveries |

The model is trained/instructed to operate in `/workspace/`. When it needs to read user-uploaded content, it must cross-reference the `## Working Files` block to find the actual `/shared/...` path. In practice the model **defaults to `/workspace/<filename>`** on the first attempt and only consults the Working Files block when that fails. This produces the 4–5 search-attempts pattern observed in production.

### Why symlinks-on-top are a kludge

A symlink overlay (`/workspace/input → /shared/<wsid>/input`, `/workspace/outbound → /shared/<wsid>/outbound`) makes the two namespaces *look* unified to the model but leaves the underlying duality intact:

- `injectWorkspaceIdSegmentIfMissing` (`apps/sandbox/src/workspace-path.ts` lines 263–298) still translates model-canonical `/shared/input/...` ↔ pod-physical `/shared/<wsid>/input/...`.
- `buildSharedRoot`, `isSharedRole`, `WorkspaceMountRole` shared variants, `hydrateSharedMountFromGcs`, `writeSharedInputControlPlane`, `writeSharedOutboundWithCollision`, `removeSharedFileFromHotPods` — all keep `/shared/...` as a first-class concept.
- Manifest `path` column continues to hold `/shared/input/X.xlsx` shape, not `/workspace/input/X.xlsx`.
- Sandbox audit logs continue to print `/shared/<wsid>/...` paths, mismatching what the model and user see (`/workspace/...`).
- Two-and-three-level symlink chains during debugging.

This is the kind of carried tech debt that ADR-126 v3 and ADR-127 closures explicitly aimed to eliminate. Their scope did not formally include the namespace question, but in retrospect it should have — a single path identity demands a single physical namespace, not two namespaces papered over.

### Other consequences of the two-namespace structure

- `/shared/<wsid>/input/` directory mode is set to `0444` at bootstrap (no execute bit), so even the sandbox user cannot `ls` the directory it owns. `files.list /shared/input` returns EACCES. This is a separate bug, but it directly follows from the `/shared/` design's "input is special — protect it" instinct that wouldn't exist in a single-namespace world.
- Manifest back-fill from `AssistantChatMessageAttachment` is needed to make `files.list` see historical files (manifest rows started arriving only with W1 post-deploy). Pre-W1 attachments live in `assistantChatMessageAttachment` with `/shared/...` paths and have no manifest row. Any back-fill done today must use the **new** path shape — there is no point migrating to a soon-to-be-retired prefix.

---

## Decision

**Retire `/shared/<workspaceId>/` as a pod namespace.** Establish a single root: **`/workspace/`**.

### New pod layout

```
/workspace/
  input/                      — user uploads (mode 0555: read+execute; no write)
  outbound/
    self/                     — this assistant's outputs (mode 0755, RW for sandbox)
    <other-handle>/           — sibling outputs (mode 0555, RX)
  <free area>                 — model scratch (writable, ephemeral, NOT GCS-synced)
```

- One emptyDir mount at `/workspace/`. The previous `/shared/<wsid>/` emptyDir mount is removed.
- `workspaceId` is no longer encoded in any pod-side path. It remains the partition key in DB (`workspace_file_metadata.workspaceId`) and the prefix segment in GCS (`fs/workspaces/<wsid>/...`) — both invisible to the model.
- `injectWorkspaceIdSegmentIfMissing` is **deleted** (no translation needed when there is only one shape).
- `buildSharedRoot`, `WorkspaceMountRole.shared_*` variants, all "shared"-prefixed helpers are removed.
- The cold-bootstrap symlinks added by the 2026-06-25 closure follow-up (`/shared/input → /shared/<wsid>/input` and `/shared/outbound → /shared/<wsid>/outbound`) are removed along with their parent prefix — they only existed to bridge the dual-namespace world.

### Path identity in DB and GCS

| Surface | Shape |
| ------- | ----- |
| Manifest `path` | `/workspace/input/X.xlsx`, `/workspace/outbound/self/Y.pdf` — pod-canonical |
| `AssistantChatMessageAttachment.storagePath` | same shape (`/workspace/...`) |
| GCS object key | `fs/workspaces/<wsid>/workspace/input/X.xlsx` — unchanged GCS prefix `fs/workspaces/<wsid>/` plus pod-relative tail (`workspace/...` instead of `shared/...`) |
| Tool descriptions | Only `/workspace/...` mentioned — `/shared/...` not referenced anywhere |
| Working Files block | Renders pod-canonical paths verbatim (`/workspace/input/X.xlsx`) |

### Model contract simplification

The `files` tool description becomes one-namespace:

```
Path-driven workspace operations on `/workspace/...`.
- /workspace/input/  — files the user has shared with this assistant (read-only).
- /workspace/outbound/self/  — files this assistant produces and delivers (read-write).
- /workspace/<anywhere else>  — model's scratch (ephemeral, not delivered, not preserved across pod restart).
Six actions: list, read, preview, write, delete, attach.
```

No mention of `/shared/`. No model-facing notion of `workspaceId`.

### Clean cutover — no transition window, no back-fill

**No prod has launched yet.** This is the last chance to do a clean break before user data exists at scale. The cutover therefore:

- Does NOT keep a transitional dual-prefix GCS reader. Writer emits ONLY `fs/workspaces/<wsid>/workspace/<relPath>` after deploy; reader looks ONLY there.
- Does NOT do a string-rewrite back-fill of existing `/shared/...` rows in DB. Instead, **all dev DB rows in `workspace_file_metadata` and all `AssistantChatMessageAttachment` rows whose `storagePath` does not start with `/workspace/` are deleted** as part of the cutover deploy.
- Wipes legacy GCS subtrees `gs://persai-dev-workspaces/fs/workspaces/*/shared/` and any sibling pre-cutover paths during the same operational step.

This is acceptable because:
- Dev is non-commercial (founder explicitly approved data loss for the 2026-06-25 W5 wipe under the same reasoning).
- Prod is not launched. The cutover lands BEFORE the 1000-user prod rollout. Prod will be born clean — never had a `/shared/` row.
- Keeping any transitional reader/back-fill = carrying legacy into prod. That violates the orchestration directive.

### Exact symbol contract (binding on the implementation)

The implementation MUST converge on these names — any subagent or refactor pass that diverges is rejected:

| Old (delete) | New |
| ------------ | --- |
| `injectWorkspaceIdSegmentIfMissing` | (deleted, no replacement — no translation needed) |
| `buildSharedRoot(workspaceId)` | (deleted; mount root is always `/workspace`) |
| `WorkspaceMountRoots.sharedRoot` | (field removed; only `workspaceRoot: "/workspace"` remains) |
| `WorkspaceMountRole.shared_input` | `WorkspaceMountRole.workspace_input` |
| `WorkspaceMountRole.shared_outbound_self` | `WorkspaceMountRole.workspace_outbound_self` |
| `WorkspaceMountRole.shared_outbound_other` | `WorkspaceMountRole.workspace_outbound_other` |
| `WorkspaceMountRole.workspace` (free area) | `WorkspaceMountRole.workspace_scratch` |
| `buildSharedObjectKey(wsid, relPath)` | `buildWorkspaceObjectKey(wsid, relPath)` → `${prefix}/workspaces/${wsid}/workspace/${relPath}` |
| `writeSharedInputControlPlane` | `writeWorkspaceInputControlPlane` |
| `writeSharedOutboundWithCollision` | `writeWorkspaceOutboundWithCollision` |
| `removeSharedFileFromHotPods` | `removeWorkspaceFileFromHotPods` |
| `hydrateSharedMountFromGcs` | `hydrateWorkspaceMountFromGcs` |
| `ensureSharedMountBootstrapped` | `ensureWorkspaceMountBootstrapped` |
| `ensureSharedMountSymlinks` (Phase 2b) | (deleted — no symlinks needed) |
| `SHARED_MOUNT_BOOTSTRAP_MARKER` | `WORKSPACE_MOUNT_BOOTSTRAP_MARKER` (`/tmp/.persai_workspace_bootstrap_ok`) |
| `SHARED_MOUNT_BOOTSTRAP_OK_SENTINEL` | `WORKSPACE_MOUNT_BOOTSTRAP_OK_SENTINEL` (`__PERSAI_WORKSPACE_OK__`) |
| `SHARED_MOUNT_DIRS_OK_SENTINEL` | `WORKSPACE_MOUNT_DIRS_OK_SENTINEL` |
| `SHARED_MOUNT_SYMLINKS_OK_SENTINEL` | (deleted) |
| `shared-root` k8s emptyDir + `/shared` volumeMount | (deleted) |
| `<assistant>-shared` k8s emptyDir at `/shared/<wsid>` | (deleted) |
| (new) | `workspace` k8s emptyDir at `/workspace` (already exists; extend its scope to subsume input/outbound) |

### Out of scope

- Multi-assistant per workspace. Currently 1:1; if PersAI later supports multiple assistants per workspace, `/workspace/` may need to evolve. That's a future ADR.
- `/workspace/scratch/` GCS persistence. Free-area writes remain ephemeral. ADR-127 documented model is preserved on this point.

---

## Slices

### Slice 1 — Sandbox layer (pod bootstrap + path containment + bridge + GCS)

This slice does the entire sandbox-side refactor in one coherent cut. After it lands, the sandbox compiles and tests pass with the new symbol surface, but the API/runtime layer is still emitting `/shared/...` paths — those calls will fail validation. That's intentional gating between S1 and S2.

Files (touched/created):

- `apps/sandbox/src/workspace-path.ts`
  - Delete: `injectWorkspaceIdSegmentIfMissing`, `buildSharedRoot`.
  - Change `WorkspaceMountRoots`: drop `sharedRoot`; keep only `workspaceRoot: "/workspace"`.
  - Change `WorkspaceMountRole`: drop all `shared_*` variants; add `workspace_input`, `workspace_outbound_self`, `workspace_outbound_other`, `workspace_scratch`.
  - Rewrite `assertAllowedMountPrefix`: single-root prefix match against `/workspace/`, classify the role by sub-path (`/workspace/input/...` → `workspace_input`, `/workspace/outbound/self/...` → `workspace_outbound_self`, `/workspace/outbound/<handle>/...` → `workspace_outbound_other`, anything else under `/workspace/` → `workspace_scratch`).
- `apps/sandbox/src/exec-pod-bridge.service.ts`
  - Delete: `SHARED_MOUNT_BOOTSTRAP_MARKER`, `SHARED_MOUNT_BOOTSTRAP_OK_SENTINEL`, `SHARED_MOUNT_DIRS_OK_SENTINEL`, `SHARED_MOUNT_SYMLINKS_OK_SENTINEL`, `ensureSharedMountSymlinks`, `ensureSharedMountBootstrapped`.
  - Add: `WORKSPACE_MOUNT_BOOTSTRAP_MARKER` (`/tmp/.persai_workspace_bootstrap_ok`), `WORKSPACE_MOUNT_BOOTSTRAP_OK_SENTINEL` (`__PERSAI_WORKSPACE_OK__`), `WORKSPACE_MOUNT_DIRS_OK_SENTINEL`.
  - Add: `ensureWorkspaceMountBootstrapped(assistantHandle, workspaceId)`:
    - Phase 1 — fast-path marker check.
    - Phase 2 — mkdir `/workspace/input`, `/workspace/outbound`, `/workspace/outbound/<handle>`, symlink `/workspace/outbound/self → /workspace/outbound/<handle>`. Print `__PERSAI_DIRS_OK__`.
    - Phase 3 — hydrate from GCS prefix `${PERSAI_MEDIA_OBJECT_PREFIX}/workspaces/${wsid}/workspace/` ONLY. No legacy prefix read.
    - Phase 4 — `chmod 0555 /workspace/input` and `chmod 0755 /workspace/outbound /workspace/outbound/<handle>`. Touch marker.
  - Rename `hydrateSharedMountFromGcs` → `hydrateWorkspaceMountFromGcs`. Read prefix is `${PERSAI_MEDIA_OBJECT_PREFIX}/workspaces/${wsid}/workspace/`.
  - Delete `shared-root` emptyDir volume + `/shared` volumeMount from `createExecPod`. Delete the per-workspace `/shared/<wsid>` emptyDir + mount.
  - The existing `workspace` emptyDir at `/workspace` becomes the sole writable mount.
- `apps/sandbox/src/workspace-file-bridge.service.ts`
  - Rename methods/symbols per the contract table above.
  - Audit-log path field renders pod-canonical (`/workspace/...`) verbatim; no synthetic `/shared/...` strings anywhere.
- `apps/sandbox/src/sandbox-object-storage.service.ts`
  - Rename `buildSharedObjectKey` → `buildWorkspaceObjectKey(wsid, relPath)` → `${prefix}/workspaces/${wsid}/workspace/${relPath}`.
  - Drop any code that reads from a `shared/` GCS tail.
- `apps/sandbox/src/workspace-gc.service.ts`
  - Drop `shared`-prefixed branching. GC operates on `/workspace/` mount + `${prefix}/workspaces/<wsid>/workspace/` GCS subtree only.
- `apps/sandbox/src/workspace-files.service.ts`, `apps/sandbox/src/workspace-mount.service.ts`, `apps/sandbox/src/workspace-runner.service.ts` (or equivalent): align with the new names; audit any string that mentions `/shared/`, `shared_`, or `SharedRoot` and update.
- Tests under `apps/sandbox/test/`: rewrite the affected suites to the new symbol surface. The unit tests that assert `/shared/...` prefixes are deleted or rewritten to assert `/workspace/...`.

Gate: `corepack pnpm --filter @persai/sandbox run lint && corepack pnpm --filter @persai/sandbox run typecheck && corepack pnpm --filter @persai/sandbox run test`.

### Slice 2 — API + runtime path generation + tool descriptions

Files (touched):

- `apps/api/src/modules/workspace-management/application/register-chat-attachment.service.ts`
  - All emitted `storagePath` shapes change from `/shared/input/<name>` to `/workspace/input/<name>`.
- `apps/api/src/modules/workspace-management/application/upload-chat-attachment.service.ts` (or sibling upload paths)
  - Same shape change.
- `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts`
  - Outbound delivery: `/shared/outbound/self/<name>` → `/workspace/outbound/self/<name>`.
- `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-media-job.service.ts` and `workspace-media-job-scheduler.service.ts`
  - Any path emission/validation that references `/shared/...` becomes `/workspace/...`.
- `apps/runtime/src/modules/turns/runtime-files-tool.service.ts`
  - Path validation drops `/shared/` branches. Single-namespace validator over `/workspace/`.
- `apps/runtime/src/modules/turns/native-tool-projection.ts` (and any `tools.json`/markdown that ships tool descriptions to the model)
  - Tool description text is rewritten to the single-namespace contract above.
- `apps/runtime/src/modules/turns/turn-execution.service.ts`
  - Working Files block renders pod-canonical paths verbatim. Drop any translation.
- `apps/web/...` UI: any user-visible string that mentions `/shared/` becomes `/workspace/` (gallery tooltips, error messages, etc.).
- All affected tests: assertions update from `/shared/...` to `/workspace/...`.

Gate: `corepack pnpm --filter @persai/api run lint && corepack pnpm --filter @persai/api run typecheck && corepack pnpm --filter @persai/runtime run lint && corepack pnpm --filter @persai/runtime run typecheck && corepack pnpm --filter @persai/web run typecheck && corepack pnpm -r --if-present run lint`.

### Slice 3 — Dev wipe + deploy

Operational, executed by the orchestrator (not a subagent):

1. Wait for S1 + S2 image publish + GitOps pin.
2. Wait for sandbox + api + runtime + web deploys to stabilize on dev.
3. Execute on dev:
   - `gcloud storage rm -r --quiet gs://persai-dev-workspaces/fs/workspaces/`
     (wipes any pre-cutover `fs/workspaces/*/shared/` content; the post-cutover writer has not yet been driven so the directory is empty or only contains a few legacy rows.)
   - `kubectl exec -n persai-dev <api-pod> -- node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); (async () => { const m = await p.workspaceFileMetadata.deleteMany({}); const a = await p.assistantChatMessageAttachment.deleteMany({}); console.log({ manifest: m.count, attachments: a.count }); await p.$disconnect(); })();"`
   - Verify gallery returns empty, `files.list /workspace/input/` returns empty, no orphan GCS objects.
4. Founder live-validation: upload a fresh xlsx, run `read /workspace/input/<name>` from chat. Confirm 2-call success (files.list + files.read).

Acceptance: zero `/shared/...` strings in any deployed image's running config or audit output. New uploads land at `/workspace/input/<name>` in DB, GCS, pod, all three.

### Slice 4 — Closure

- Update `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, `docs/API-BOUNDARY.md`, `docs/TEST-PLAN.md` to reference only `/workspace/...`. Delete every remaining `/shared/<workspaceId>/` reference except in closed-ADR archive docs (ADR-126 v3, ADR-127, this ADR — historical context only).
- `AGENTS.md` — move ADR-128 from "Open" to closed-archive line.
- `docs/SESSION-HANDOFF.md` checkpoint with closure SHA + dev live-validation result.
- `docs/CHANGELOG.md` closure entry.
- ripgrep gate: `rg "/shared/" apps/ packages/ infra/ docs/ -g '!docs/ADR/*' -g '!docs/CHANGELOG*.md' -g '!docs/SESSION-HANDOFF.md'` returns zero results. `rg "buildSharedRoot|injectWorkspaceIdSegmentIfMissing|hydrateSharedMountFromGcs|writeSharedInputControlPlane|writeSharedOutboundWithCollision|removeSharedFileFromHotPods|ensureSharedMountBootstrapped|ensureSharedMountSymlinks|shared_input|shared_outbound|sharedRoot" apps/ packages/` returns zero results.

---

## Invariants after closure

1. The model sees exactly one namespace: `/workspace/...`. No `/shared/...` mention anywhere model-facing.
2. The pod has exactly one writable user mount: `/workspace/` (plus `/tmp`).
3. `workspaceId` does not appear in any pod-side path.
4. Manifest `path` and `AssistantChatMessageAttachment.storagePath` both hold `/workspace/...` shape — single identity, single shape.
5. Sandbox audit logs print model-facing paths verbatim.
6. `files.list /workspace/input/` works (mode 0555 on the dir).
7. The `injectWorkspaceIdSegmentIfMissing` translation function is deleted from the codebase. No translation layer of any kind exists between model-facing paths and pod-physical paths.
8. No symlinks are required to make any model-facing path resolve (the `/workspace/outbound/self → /workspace/outbound/<handle>` symlink is a real handle-aliasing convenience, not a namespace bridge).
9. No dual-prefix readers, no back-fill code, no `// legacy` branches anywhere in active code paths.
10. ripgrep on `apps/`, `packages/`, `infra/` for `"/shared/"`, `buildSharedRoot`, `injectWorkspaceIdSegmentIfMissing`, `WorkspaceMountRoots.sharedRoot`, `shared_input`, `shared_outbound`, `hydrateSharedMountFromGcs`, `writeSharedInputControlPlane`, `writeSharedOutboundWithCollision`, `removeSharedFileFromHotPods`, `ensureSharedMountBootstrapped`, `ensureSharedMountSymlinks` returns **zero** hits.

---

## Risks

- **Cutover deploy ordering**: if the API/runtime image lands before the sandbox image, the API will emit `/workspace/...` paths that the sandbox does not yet recognize → 500s. Order: sandbox first (S1 image), then API + runtime + web (S2 image) — both should be in the same GitOps pin, but the image build for sandbox must precede or coincide.
- **Tool description bias**: model has historical priors about `/workspace/` semantics (ephemeral, private). When the tool description tells it `/workspace/input/` is the user-shared region, the model may still occasionally default to `/workspace/` for outputs. Tool description rewrite (S2) must be unambiguous: `input/` (RO), `outbound/self/` (RW deliver), bare `/workspace/<name>` (scratch).
- **Dev data wipe**: founder's current dev chats lose their attachments. Acceptable per the orchestration directive ("без коммерческих"); founder confirmed in W5 wipe context.
- **Prod readiness**: this ADR must close BEFORE prod launches. Prod data must never have a `/shared/...` row.

---

## Slice 4 — Flatten `/workspace/` to a single-namespace, role-free filesystem (2026-06-26)

Slice 4 supersedes Slices 1–3 by replacing the role-based subdir structure with a single flat `/workspace/` root. It is the final closure of the dual-namespace migration.

### Motivation

After S1+S2 cutover (single `/workspace/` root with `input/` + `outbound/<handle>/`), founder live test surfaced a second UX problem: the subdirs leak into the model's mental model. Users uploaded files appear in `/workspace/input/`, model outputs in `/workspace/outbound/<handle>/`, and "edit this file" produced a NEW file in outbound instead of updating the original. This is wrong for a 1-user + 1-2-assistant product targeting Claude Code-style UX. The founder is also fed up with explaining `outbound/self → outbound/<handle>` symlink semantics to the model.

GCS and DB on `persai-dev` are wiped (per S3 dev wipe runbook). There is no production data to migrate. This is the cheapest moment to flatten.

### Decision

- Single pod mount at `/workspace/` (mode `0755`, owner `sandbox`).
- No `input/`, no `outbound/`, no `outbound/self`, no `outbound/<handle>`, no symlinks.
- User uploads land directly at `/workspace/<basename>` (macOS-style numeric collision suffix: `report.pdf`, `report (2).pdf`, `report (3).pdf`).
- Model reads + writes any file under `/workspace/<path>` directly. To edit a user file in place, write to the same path. To create a new file, choose a new name.
- Every write under `/workspace/*` mirrors to GCS at `fs/workspaces/<wsid>/workspace/<rel>` and upserts `workspace_file_metadata`. There is no scratch carve-out under `/workspace/`.
- Ephemeral computation uses `/tmp/` (already a tmpfs in the pod).
- Cross-assistant isolation drops to "share by default" — the workspace owns files, all assistants in that workspace see them. Multi-assistant scoping (if ever needed) becomes a manifest-level concern, not a path-level concern.

### Retired symbols

- `WorkspaceMountRole` enum and all variants (`workspace_input`, `workspace_outbound_self`, `workspace_outbound_other`, `workspace_scratch`).
- `isPersistedWorkspaceRole` — replaced by a simpler "is inside `/workspace/`" check inside `workspaceFileWrite` itself.
- All references to `/workspace/input`, `/workspace/outbound`, `/workspace/outbound/self`, `/workspace/outbound/<handle>` from production code, tool descriptions, prompt text, and golden snapshots.
- `ensureSharedMountSymlinks` (already gone in S1) plus the `outbound/self` symlink creation step + `input`/`outbound/<handle>` mkdir/chmod block in `ensureWorkspaceMountBootstrapped`.
- `buildWorkspaceObjectKey`'s role-based special-casing — now strips `/workspace/` prefix and emits `fs/workspaces/<wsid>/workspace/<rel>`.
- `resolveWorkspaceInputStoragePath` (and `resolve-workspace-input-storage-path.ts`) — collapsed into `resolveWorkspaceStoragePath(basename)` that returns `/workspace/<basename>` with collision suffix.

### Renamed symbols

- `writeWorkspaceInputControlPlane` → `writeWorkspaceFileControlPlane`.
- `writeWorkspaceOutboundWithCollision` → `writeWorkspaceFileWithCollision`.
- `recordWorkspaceInputPublished` → `recordWorkspaceFilePublished` (audit event `audit_event=workspace_file_published`).
- `pushWorkspaceInboundBytes` → `pushWorkspaceFileBytes` on the sandbox-control-plane client.
- Sandbox HTTP endpoints: `/api/v1/jobs/workspace-outbound-write` → `/api/v1/jobs/workspace-write`; `/api/v1/jobs/workspace-inbound-write` → `/api/v1/jobs/workspace-write-control-plane`.
- `SandboxClientService.writeWorkspaceOutbound` → `writeWorkspaceFile`.

### Simplified primitives

- `assertAllowedMountPrefix(input)`: normalize → assert starts with `/workspace` → throw `WorkspacePathError` if not. Returns `{ absolutePath, relativePath }` (no `role`).
- `ensureWorkspaceMountBootstrapped`: `mkdir /workspace` → `chmod 0755` → GCS hydrate → marker. No `input/`/`outbound/<handle>/` subdir creation. No `outbound/self` symlink. Cold-pod hydrate runs once per pod creation.
- `workspaceFileWrite`: rejects only when path is outside `/workspace/`. Mirrors every write to GCS + upserts manifest. No role check.
- `workspaceFileDelete`: same shape.
- GC handler `purgeAssistantOutbound` becomes a marker-only purge (no per-handle subdir to remove). The lease still exists on the schema for backward compatibility; the handler just marks it purged so producers do not stall.
- GC handler `purgeWorkspaceShared`: wipes `rm -rf '/workspace'/* '/workspace'/.[!.]*` in every warm pod for the workspace, drops the GCS workspace prefix, deletes matching `workspace_file_metadata` rows.

### Tool description (Claude Code-style)

Production `files` `description` (single source for both `tool-catalog-data.ts` `modelDescription` and the runtime native-tool projection):

> Path-driven file operations on the single flat `/workspace/` namespace. Read and write any file directly under `/workspace/<path>`; user uploads land at `/workspace/<filename>` and stay there. Use `/tmp/` for ephemeral scratch that the user should never see.

Production `files` `modelUsageGuidance` (first paragraph; the standard `WHEN TO USE / WHEN NOT TO USE / EXAMPLES` block follows):

> Files in this workspace live under `/workspace/`. Read any file with `files.read /workspace/<path>`. Write to any path under `/workspace/` (creates or overwrites). When the user uploads a file, it appears at `/workspace/<filename>`. To edit it, write to the same path. To create a new file, pick a new name. Use `/tmp/` for ephemeral scratch that the user should not see.

`document.storagePath` cross-chat revise example updated from `/workspace/outbound/self/report.pdf` → `/workspace/report.pdf`.

### Why not keep `input/` + `outbound/` for "safety"?

- The role distinction protected nothing the model could actually break. Writing to a "wrong" path was a UX irritant, not a security boundary.
- The model is the only writer that matters; the user does not interact with the filesystem directly. Path semantics existed only for the model.
- "Share by default" matches the founder's product shape (single user, 1-2 assistants). Multi-assistant isolation, if ever required, belongs in the manifest layer, not in the filesystem layer.
- Claude Code and Cursor agents both operate on a single flat workspace. The model has the strongest prior for that shape — fighting it costs tool-call budget.

### GCS prefix unchanged

The GCS key shape stays `fs/workspaces/<wsid>/workspace/<rel>` (S2 already established this). After Slice 4, `<rel>` no longer has an `input/` or `outbound/<handle>/` segment — `<rel>` is just the relative path under `/workspace/` (typically a flat basename like `report.pdf`, or any subdir the model chose to create).

### Acceptance criteria

- `rg -n "workspace_input|workspace_outbound|workspace_scratch|/workspace/input|/workspace/outbound|outbound/self|outbound/<handle>|injectWorkspaceIdSegment|buildSharedRoot|WorkspaceMountRole" apps docs/SESSION-HANDOFF.md docs/CHANGELOG.md` returns only historical context (CHANGELOG entries, migration SQL) plus explicit ADR-128 Slice 4 negation assertions in tests that prove the new layout.
- `corepack pnpm --filter @persai/{sandbox,api,runtime,web} run lint` PASS.
- `corepack pnpm --filter @persai/{sandbox,api,runtime,web} run typecheck` PASS.
- `corepack pnpm --filter @persai/{sandbox,api,runtime,web} run test` PASS (sandbox 79/79, web 832/832, api + runtime suites green).
- `corepack pnpm run format:check` PASS.
- Live validation (post-deploy): founder uploads a fresh file → it appears at `/workspace/<basename>`; `files.read /workspace/<basename>` returns content; model edits the file in place by writing to the same path; no `/input/` or `/outbound/` subdir is created anywhere in the workspace.
