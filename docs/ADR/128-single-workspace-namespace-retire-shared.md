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

### Back-fill migration

A one-shot Prisma migration walks every existing row in `workspace_file_metadata` and `AssistantChatMessageAttachment` and rewrites:

```
/shared/input/X.xlsx       →  /workspace/input/X.xlsx
/shared/outbound/self/Y    →  /workspace/outbound/self/Y
/shared/outbound/<h>/Z     →  /workspace/outbound/<h>/Z
/shared/<wsid>/input/X     →  /workspace/input/X     (defensive — physical paths should not be in DB but migrate any that leaked)
/shared/<wsid>/outbound/.. →  /workspace/outbound/.. (defensive)
```

GCS layout is **kept** during migration:

- Old objects under `fs/workspaces/<wsid>/shared/...` remain readable.
- Manifest now points to `/workspace/...` paths, but the GCS lookup must continue to find them. Solution: the GCS prefix in `buildObjectKey` keeps a static `workspace/` tail under the new code, AND the cold-start hydrate checks both `workspace/` and the legacy `shared/` GCS prefixes for transitional cases. Once dev validates that all post-cutover objects are written under `fs/workspaces/<wsid>/workspace/...`, a second GCS wipe runbook step is added to delete the legacy `fs/workspaces/<wsid>/shared/...` tree.

### Out of scope

- Multi-assistant per workspace. Currently 1:1; if PersAI later supports multiple assistants per workspace, `/workspace/` may need to evolve. That's a future ADR.
- `/workspace/scratch/` GCS persistence. Free-area writes remain ephemeral. ADR-127 documented model is preserved on this point.

---

## Slices

### Slice 1 — Pod bootstrap + path containment

- `apps/sandbox/src/workspace-path.ts`: delete `injectWorkspaceIdSegmentIfMissing`, `buildSharedRoot`, `WorkspaceMountRole.shared_*`. Keep `normalizeAndClampPath`, `normalizePosixPath`. Add `WorkspaceMountRole.workspace_input`, `workspace_outbound_self`, `workspace_outbound_other`.
- `apps/sandbox/src/exec-pod-bridge.service.ts`: rewrite `ensureSharedMountBootstrapped` → `ensureWorkspaceMountBootstrapped`. Phase 1 marker, Phase 2 dirs at `/workspace/input/`, `/workspace/outbound/`, `/workspace/outbound/self/` symlink, Phase 3 GCS hydrate from `fs/workspaces/<wsid>/workspace/` (plus legacy `fs/workspaces/<wsid>/shared/` for transition), Phase 4 chmod `/workspace/input/` to `0555`.
- Remove `shared-root` emptyDir from `createExecPod`. Keep `workspace` emptyDir. Drop the `/shared/<wsid>` mount entirely.
- Delete the `/shared/input → /shared/<wsid>/input` and `/shared/outbound → /shared/<wsid>/outbound` symlinks created in the 2026-06-25 closure follow-up.

### Slice 2 — Sandbox bridge

- `apps/sandbox/src/workspace-file-bridge.service.ts`: rename `writeSharedInputControlPlane` → `writeWorkspaceInput`, `writeSharedOutboundWithCollision` → `writeWorkspaceOutbound`, `removeSharedFileFromHotPods` → `removeWorkspaceFileFromHotPods`. All path I/O happens at `/workspace/...` shape; physical paths in audit logs become `/workspace/...`.
- `apps/sandbox/src/sandbox-object-storage.service.ts`: `buildSharedObjectKey` → `buildWorkspaceObjectKey` returning `fs/workspaces/<wsid>/workspace/<relPath>`. Legacy `shared/` reader path stays for the transition window.
- `apps/sandbox/src/workspace-gc.service.ts`: drop any `shared`-prefixed branching.

### Slice 3 — API / runtime path generation

- `apps/api/src/modules/workspace-management/application/register-chat-attachment.service.ts`: emit `/workspace/input/...` `storagePath` for new uploads.
- `apps/api/src/modules/workspace-management/application/upload-chat-attachment.service.ts` (or equivalent): mirror.
- `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts`: outbound delivery service emits `/workspace/outbound/self/...`.
- `apps/runtime/src/modules/turns/runtime-files-tool.service.ts`: drop any `/shared/` references in path validation; rely on `WorkspacePath` helper.
- `apps/runtime/src/modules/turns/native-tool-projection.ts`: tool description text references only `/workspace/...`.
- `apps/runtime/src/modules/turns/turn-execution.service.ts`: Working Files block renders pod-canonical paths verbatim (no translation).

### Slice 4 — DB back-fill migration

- New Prisma migration: rewrite `workspace_file_metadata.path` and `AssistantChatMessageAttachment.storage_path` from any `/shared/...` shape to `/workspace/...`. Idempotent.

### Slice 5 — GCS layout + transition reads

- Sandbox object storage writer paths emit `fs/workspaces/<wsid>/workspace/<relPath>`.
- Sandbox hydrate reader checks both `workspace/` and legacy `shared/` GCS prefixes during the transition window.
- After dev live-validation confirms no new objects land under `shared/`, add Section "Workspace-namespace cutover GCS cleanup" to the GCS wipe runbook (`infra/dev/gke/ADR-126-V3-GCS-WIPE-RUNBOOK.md`) — wipe `fs/workspaces/*/shared/`. Execute on dev. Defer on prod until a prod cutover is scheduled.

### Slice 6 — Closure

- Remove the transitional `shared/` GCS reader (legacy is empty after wipe).
- Update `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, `docs/API-BOUNDARY.md` to reference only `/workspace/...`.
- Update `AGENTS.md` ADR list with ADR-128 closure entry.
- Update `docs/SESSION-HANDOFF.md` and `docs/CHANGELOG.md`.

---

## Invariants after closure

1. The model sees exactly one namespace: `/workspace/...`. No `/shared/...` mention anywhere model-facing.
2. The pod has exactly one writable mount: `/workspace/` (plus `/tmp`).
3. `workspaceId` does not appear in any pod-side path.
4. Manifest `path` and `AssistantChatMessageAttachment.storagePath` both hold `/workspace/...` shape — single identity, single shape.
5. Sandbox audit logs print model-facing paths verbatim.
6. `files.list /workspace/input/` works (mode 0555 on the dir).
7. The `injectWorkspaceIdSegmentIfMissing` translation function is deleted from the codebase.
8. No symlinks are required to make any model-facing path resolve.

---

## Risks

- **Live xlsx workflow disruption during cutover**: founder is in the middle of using the existing `/shared/input/...` paths. Slice 4 back-fill must execute before the new sandbox image starts writing `/workspace/input/...` paths, so manifest rows align with what new code expects. Order matters: deploy DB migration first, then sandbox/runtime, in two phases.
- **GCS reader regression**: if Slice 1 hydrate forgets the legacy `shared/` prefix, all pre-cutover files vanish from cold-bootstrapped pods. Mitigated by explicit dual-prefix read in transition window.
- **Tool description bias**: model has historical priors about `/workspace/` semantics (ephemeral, private). When the tool description tells it `/workspace/input/` is the user-shared region, the model may still occasionally default to `/workspace/` for outputs. Slice 3's tool description rewrite must be unambiguous.
