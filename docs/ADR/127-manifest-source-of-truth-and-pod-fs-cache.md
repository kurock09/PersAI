# ADR-127 — Manifest as source of truth; pod FS as cache

Status: **Closed 2026-06-29 — implemented and no longer an open program.** Founder-acked 2026-06-25. Continued ADR-126 v3 without reopening it; the remaining namespace simplification was closed by ADR-128. Do not reopen ADR-127 for new scope.

Date: 2026-06-25
Continues: ADR-126 v3 (`docs/ADR/126-unified-sandbox-workspace-files-shell-single-fs-bash-default-and-expanded-egress.md`) — closed 2026-06-24; does not reopen it.

---

## Context

### Audit trigger

A founder-level audit on 2026-06-25 found the ADR-126 v3 cutover to be **structurally clean** (zero retired symbols in active code, DB migrations applied, GCS wipe runbook drafted) but identified a **persistent source-of-truth split** in "what files exist" that was not resolved by v3.

### Three independent indexes — one workspace

ADR-126 v3 established one file identity `(workspaceId, path)` and three concerns:

| Concern | Store | Purpose |
| ------- | ----- | ------- |
| **Index** (what files exist + metadata) | `workspace_file_metadata` DB table (`apps/api/prisma/schema.prisma` lines 2109–2123) | Populated at upload/outbound registration |
| **Bytes** (canonical durable copy) | GCS, keyed by `buildSharedObjectKey(workspaceId, workspaceRelPath)` | The ground-truth bytes for every file |
| **Cache** (working copy for in-flight execution) | Pod FS `/shared/<workspaceId>/...` | Hydrated from GCS at cold-start by `hydrateSharedMountFromGcs` |

In practice these three concerns are serviced by three **different** read paths that do not agree:

#### Path 1 — Model-facing `files.list`

`RuntimeFilesToolService.executeListAction` (`apps/runtime/src/modules/turns/runtime-files-tool.service.ts` lines 165–200) dispatches a `files` sandbox job. The sandbox routes it through `WorkspaceFileBridgeService.workspaceFileList` (`apps/sandbox/src/workspace-file-bridge.service.ts` lines 571–620), which runs a `find -mindepth 1 -maxdepth 1 -printf ...` shell command **inside the pod**. The pod's `/shared/<workspaceId>/` mount is the sole source; if the pod is cold or partially hydrated, `files.list` returns a truncated or empty set.

#### Path 2 — UI gallery `listChatWorkspaceFiles`

`ListChatWorkspaceFilesService.execute` (`apps/api/src/modules/workspace-management/application/list-chat-workspace-files.service.ts` lines 132–138) queries `assistantChatMessageAttachment` directly (no join to `workspace_file_metadata`). The gallery shows only files that have an attachment row — files written by the model via `files.write` (runtime → sandbox-only write) are invisible.

#### Path 3 — `workspace_file_metadata` manifest

Written by `RegisterChatAttachmentService.execute` (`apps/api/src/modules/workspace-management/application/register-chat-attachment.service.ts` lines 212–220) when a file is registered (upload or outbound). Enriches the model-facing `files.list` result with `shortDescription` via `enrichListWithShortDescriptions`. However:

- `deleteChatWorkspaceFile` (`apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts` lines 581–635) deletes the GCS object and marks `assistant_chat_message_attachment.processing_status = 'unavailable'` but **does not delete the corresponding `workspace_file_metadata` row**.
- `RuntimeFilesToolService` (runtime `files.write` / `files.delete` actions) does not touch `workspace_file_metadata` at all — model-authored file mutations are pod-only.
- `WorkspaceFileBridgeService.workspaceFileWrite` (sandbox-side, `apps/sandbox/src/workspace-file-bridge.service.ts`) does not update `workspace_file_metadata`.
- `WorkspaceGcService.deleteWorkspaceFileMetadataByPathPrefix` (`apps/sandbox/src/workspace-gc.service.ts` lines 357–367) **does** delete manifest rows on lease purge — the only consistent delete site.

### The coupling this creates

Because `files.list` reads from pod FS, the pod **must** mirror all of `/shared/<workspaceId>/...` at cold-start to be correct. This is why `hydrateSharedMountFromGcs` (`apps/sandbox/src/exec-pod-bridge.service.ts` lines 1105–1164) iterates every GCS blob **sequentially** inside a `for (const key of keys)` loop — each blob requires an individual pod-exec write shell command. For a workspace with hundreds of files this makes every cold-start proportional to object count, coupling correctness to hydration completeness.

### Two residual legacy references in active code

Audit also found two functions named `isAttachmentRef` — in `EnqueueRuntimeDeferredMediaJobService` (`apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-media-job.service.ts` lines 493–520) and in `WorkspaceMediaJobSchedulerService` (`apps/api/src/modules/workspace-management/application/workspace-media-job-scheduler.service.ts` lines 1058–1085) — both of which still carry a legacy `objectKey` fallback branch alongside the v3 `storagePath` field. This fallback is required only for `assistant_media_jobs.request_json` rows persisted before the v3 cutover; once those rows are migrated, the fallback is dead code and a lint red flag.

### GCS prefix hygiene

The operational prefix `PERSAI_MEDIA_OBJECT_PREFIX` defaults to `"assistant-media"` in all three config schemas (`packages/config/src/api-config.ts`, `packages/config/src/runtime-config.ts`, `packages/config/src/sandbox-config.ts`). After the ADR-126 v3 GCS wipe runbook executes, new v3 writes will continue under `assistant-media/workspaces/...` because the default is unchanged. Renaming the default to `"fs"` now — before the first post-wipe object is written — produces a clean separation and makes the resulting GCS layout unambiguous to any future operator.

---

## Decision

### D1 — `workspace_file_metadata` is the authoritative file index

`workspace_file_metadata` (PK `(workspaceId, path)`) is the **single authoritative index** of what files exist for a workspace. GCS holds the bytes. Pod FS is a cache. No other store is authoritative for file existence.

Consequence: any code that needs to answer "does this file exist?" or "what files are in this workspace?" must query `workspace_file_metadata`, not the pod FS and not `assistant_chat_message_attachment`.

### D2 — GCS is the bytes authority; pod FS is a cache

GCS (under `buildSharedObjectKey(workspaceId, workspaceRelPath)`) remains the single durable bytes store. The pod FS is a working cache: it may be stale, partially populated, or absent. A pod's FS being stale or incomplete is **never a correctness bug** — it is the designed cache semantics. No code path may use pod FS absence as evidence that a file does not exist.

### D3 — Model-facing `files.list` reads from manifest, not from pod `ls`

`RuntimeFilesToolService.executeListAction` is refactored to query `workspace_file_metadata` (via an internal API call or direct service injection) rather than dispatching a pod `find` job. The manifest row carries `(path, mimeType, sizeBytes, shortDescription?)` — sufficient to satisfy the model contract without a pod exec. The pod exec remains available for `files.read` and `files.write`; only the index query moves to the manifest.

### D4 — UI gallery `listChatWorkspaceFiles` reads from manifest

`ListChatWorkspaceFilesService` is refactored to query `workspace_file_metadata` (joined or stand-alone) instead of `assistantChatMessageAttachment` as the primary source of file enumeration. Attachment metadata (`thumbnailStoragePath`, `posterStoragePath`, `attachmentType`, `originalFilename`, `createdAt`, `chatId`, `messageId`) can be resolved via a secondary join to `assistant_chat_message_attachment` for display enrichment, but existence is driven by the manifest. This closes the gap where model-written files are invisible to the gallery.

### D5 — Every file mutation site updates the manifest atomically

Every create, update, and delete of a file must update `workspace_file_metadata` within the same logical seam (same transaction or immediate sequential call) as the corresponding GCS or pod write. The following sites are in scope:

| Site | Current state | Required change |
| ---- | ------------- | --------------- |
| `RegisterChatAttachmentService.execute` (`register-chat-attachment.service.ts` line 212) | Upserts manifest ✅ | No change needed — already correct |
| `ManageChatMediaService.deleteChatWorkspaceFile` (`manage-chat-media.service.ts` lines 614–634) | Deletes GCS + nulls attachment row; does NOT delete manifest ❌ | Must call `WorkspaceFileMetadataService.delete(workspaceId, storagePath)` after GCS delete succeeds |
| `RuntimeFilesToolService.executeWriteAction` (runtime `files.write`) | Dispatches pod write; does NOT touch manifest ❌ | Must upsert manifest after sandbox job completes successfully |
| `RuntimeFilesToolService.executeDeleteAction` (runtime `files.delete`) | Dispatches pod delete; does NOT touch manifest ❌ | Must delete manifest row after sandbox job completes successfully (best-effort per D7) |
| `WorkspaceFileBridgeService.workspaceFileWrite` (sandbox-side, called for `files.write` jobs) | Writes to pod FS; does NOT update manifest ❌ | Sandbox-side write path must emit a manifest upsert callback to the api (or the runtime tool layer above does it — see D5 note below) |
| `WorkspaceGcService.deleteWorkspaceFileMetadataByPathPrefix` (`workspace-gc.service.ts` lines 357–367) | Deletes manifest rows on lease purge ✅ | No change needed — already correct |

**D5 implementation note.** For the runtime `files.write` and `files.delete` paths, the manifest update should be owned at the runtime tool layer (`RuntimeFilesToolService`) rather than the sandbox-side bridge, since the runtime has access to the api internal client and knows the `workspaceId`. This avoids adding an api dependency to the sandbox service.

### D6 — Cold-start hydrate downgraded to optional optimization

`hydrateSharedMountFromGcs` (`exec-pod-bridge.service.ts` lines 1105–1164) is downgraded from a **correctness gate** to an **optional cache-warming optimization**. Once D1–D5 are live, `files.list` no longer depends on pod FS completeness. The hydrate may still run at cold-start to improve latency for `files.read` and `files.write` on first use; it is no longer the mechanism that determines what files "exist".

Separately (and out of scope for this ADR — see Out-of-scope list): the sequential `for (const key of keys)` loop in `hydrateSharedMountFromGcs` should be parallelised in a future slice (W2) to reduce cold-start p50 latency.

### D7 — Pod FS delete is best-effort

When a file is deleted (via `deleteChatWorkspaceFile` or model `files.delete`), the manifest row and GCS object must be removed. Pod FS eviction is **best-effort**: a pod exec to remove the cached copy should be attempted but its failure must not fail the delete operation. Staleness in the pod FS is acceptable per D2.

### D8 — Remove `objectKey` fallback in `isAttachmentRef` after one-shot data migration

The `objectKey` fallback branches in both `isAttachmentRef` functions (`enqueue-runtime-deferred-media-job.service.ts` lines 493–520 and `workspace-media-job-scheduler.service.ts` lines 1058–1085) are dead code after all persisted `assistant_media_jobs.request_json` payloads are migrated. The gate for removal is a one-shot `UPDATE` migration:

```sql
UPDATE assistant_media_jobs
SET request_json = jsonb_set(
  request_json - 'attachments',
  '{attachments}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN elem ? 'objectKey' AND NOT (elem ? 'storagePath')
        THEN elem || jsonb_build_object('storagePath', elem->>'objectKey') - 'objectKey'
        ELSE elem
      END
    )
    FROM jsonb_array_elements(request_json->'attachments') AS elem
  )
)
WHERE request_json ? 'attachments'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(request_json->'attachments') AS elem
    WHERE elem ? 'objectKey' AND NOT (elem ? 'storagePath')
  );
```

Once this migration has run (confirmed by `SELECT COUNT(*) FROM assistant_media_jobs WHERE request_json->'attachments' @> '[{"objectKey":"x"}]'` returning 0), both `isAttachmentRef` functions drop the `objectKey` fallback branch.

### D9 — Rename `PERSAI_MEDIA_OBJECT_PREFIX` default value from `"assistant-media"` to `"fs"`

The env var name `PERSAI_MEDIA_OBJECT_PREFIX` is unchanged (renaming the variable itself is deferred — see Out-of-scope). Only the **default value** in all three config schemas is changed:

- `packages/config/src/api-config.ts`: `z.string().min(1).default("fs")`
- `packages/config/src/runtime-config.ts`: `z.string().min(1).default("fs")`
- `packages/config/src/sandbox-config.ts`: `z.string().min(1).default("fs")`

Helm values updated in the same slice:

- `infra/helm/values-dev.yaml`: `PERSAI_MEDIA_OBJECT_PREFIX: "fs"`
- `infra/helm/values.yaml`: `PERSAI_MEDIA_OBJECT_PREFIX: "fs"` (operator override default)

Resulting GCS paths after D9 deploy (new writes only): `gs://persai-{env}-workspaces/fs/workspaces/<wsid>/shared/...` and `gs://persai-{env}-workspaces/fs/assistants/<aid>/sandbox-sessions/<sid>/workspace.tar`.

This change is gated on the ADR-126 v3 GCS wipe runbook (D10) executing first on each cluster, so no `assistant-media/` objects remain to collide with the rename.

### D10 — Execute `infra/dev/gke/ADR-126-V3-GCS-WIPE-RUNBOOK.md`

Execute the existing wipe runbook in order: dev cluster first → founder validates v3 functional on dev → then prod. The runbook wipes the legacy `assistant-media/*` prefix; new writes already land under `fs/*` after D9 is deployed. D10 is the final cleanup that closes the legacy surface.

---

## Migration / Data plan

### In-flight `assistant_media_jobs` — `objectKey` → `storagePath`

Before D8 code lands, run the one-shot `UPDATE` described under D8. This rewrites any persisted `request_json.attachments[].objectKey` to `storagePath` in-place. The migration is idempotent (rows without `objectKey` are untouched). After the migration, both `isAttachmentRef` functions can drop the fallback safely.

New Prisma migration file: `20260625000000_adr127_media_jobs_objectkey_to_storagepath` (raw SQL only, no schema-model change needed).

### GCS prefix transition

- D9 deploy: new writes land under `fs/*`. Old `assistant-media/*` objects (legacy `<fileRef>`-shape) still exist but are no longer written.
- D10 wipe: `gcloud storage rm -r gs://persai-{env}-workspaces/assistant-media/` per the runbook, dev → founder validation → prod.
- Net effect: after D10, `assistant-media/` is absent on both clusters; `fs/` is the sole active prefix.

### `workspace_file_metadata` coverage

`RegisterChatAttachmentService.execute` already upserts a manifest row for every registered attachment (confirmed at `register-chat-attachment.service.ts` line 212). This covers:

- User uploads (via `manage-chat-media.stageForWebThread` → `registerChatAttachment`)
- All outbound artifacts (`image_generate`, `image_edit`, `document`, `tts`, `video_generate` — all call `registerChatAttachment` in the runtime attachment pipeline)
- `files.attach` (calls `registerChatAttachment` via internal API)

**Gaps** not yet covered by the manifest:

- Files written by model `files.write` (runtime → sandbox write; no manifest upsert today) — closed by D5
- Files materialised by the sandbox hot-pod-push (`writeSharedInputControlPlane`) — these are already covered by `registerChatAttachment` on the GCS-upload path upstream, so no additional manifest write is required here

No backfill migration for `workspace_file_metadata` is needed for new rows; existing rows may be absent if they pre-date the ADR-126 v3 cutover. The v3 W1 migration already nulled `assistant_chat_message_attachments.storage_path` for legacy `assistant-media/<fileRef>`-shaped rows, so there are no legacy attachments pointing at valid bytes.

---

## Wave plan

| Wave | Scope | Dependencies |
| ---- | ----- | ------------ |
| **W0** | This ADR (doc-only) | — |
| **W1** | Manifest-as-index refactor: `RuntimeFilesToolService.executeListAction` queries manifest; `ListChatWorkspaceFilesService` queries manifest; `RegisterChatAttachmentService` confirmed (no change). Implements D1, D3, D4, D5 (create side already covered). | W0 |
| **W2** | Parallel cold-start hydrate (sandbox): `hydrateSharedMountFromGcs` refactored to fan-out downloads in parallel (e.g. `Promise.allSettled` with a concurrency cap). D6 enabling work — reduces p50 cold-start latency for warm-path benefit. | W1 (D1 must be live so correctness no longer depends on hydrate completeness) |
| **W3** | Delete-everywhere symmetry: `deleteChatWorkspaceFile` deletes manifest row; runtime `files.delete` deletes manifest row (best-effort per D7); runtime `files.write` upserts manifest row. Finishes D5, implements D7. | W1 |
| **W4** | Remove `objectKey` fallback: one-shot `UPDATE` migration (`20260625000000_adr127_media_jobs_objectkey_to_storagepath`) + drop fallback branches in both `isAttachmentRef` functions + regression test. Implements D8. | W3 (no structural dependency, but clean to do after W3 closes all file-mutation gaps) |
| **W4.5** | Rename `PERSAI_MEDIA_OBJECT_PREFIX` default to `"fs"` in all three config schemas + Helm values dev + prod. Implements D9. Gate: `pnpm run format:check` + `pnpm -r run typecheck` PASS. | W4 and D10 wipe runbook must have executed on the target cluster first |
| **W5** | Execute GCS wipe runbook (D10): dev → founder validates → prod. Implements D10. Not a code wave — operational execution only. | W4.5 deployed and live-validated on each cluster |

---

## Out-of-scope (explicit closure list)

The following items are intentionally deferred. Do not fold them into W1–W5 without a new ADR or explicit founder priority.

1. **On-first-read lazy hydration.** Deferring GCS→pod hydration until the pod first accesses a path (instead of at cold-start) is a valid future optimisation. It is safe to consider only after D1–D5 are live (manifest is the index; pod absence is not an error). Deferred until workspaces grow beyond a yet-to-define object-count threshold.
2. **Deduplication of `PersaiMediaObjectStorageService`** between `apps/api` and `apps/runtime`. Two implementations exist with the same class name but different shapes. Reconciling them is a separate hygiene slice.
3. **Renaming the env var `PERSAI_MEDIA_OBJECT_PREFIX` itself.** Only the default value changes in D9. The var name is unchanged. Renaming it is a later hygiene slice (requires updating every Helm values file, every CI override, and every local `.env` reference).
4. **Stricter Zod schema for `WORKSPACE_SHARED_METADATA` GC lease** and safer shell quoting in `workspace-gc.service.ts` (noted in the audit). Deferred to a dedicated hardening slice.

---

## Acceptance criteria

Binary, per wave. Live validation on `persai-dev` is required before closing each wave.

**W1:**
- `files.list` (model, via runtime) and `listChatWorkspaceFiles` (UI gallery) return **identical path sets** given identical workspace state in a live `persai-dev` test: upload one file, write one file via `files.write`, then confirm both surfaces see both files.
- `workspace_file_metadata` row count equals `assistant_chat_message_attachment WHERE storage_path IS NOT NULL` count for any `(workspaceId, assistantId)` pair that has never used model `files.write` (i.e., files registered only through `registerChatAttachment`).

**W2:**
- Cold-start hydrate latency p50 < 5 s measured on `persai-dev` for a workspace with 200 files (use `snapshot_cold_pull_latency_ms` histogram if available, or wall-clock from pod-Running to hydrate-complete log line).

**W3:**
- After a UI delete (`deleteChatWorkspaceFile`): `workspace_file_metadata` row absent, GCS object absent, `assistant_chat_message_attachment.processing_status = 'unavailable'`. Pod FS absence is best-effort (may lag).
- After model `files.delete`: `workspace_file_metadata` row absent (or absent within one turn). GCS object absent.
- After model `files.write`: `workspace_file_metadata` row present with correct `sizeBytes` and `mimeType`.

**W4:**
- `rg "row\.objectKey" apps/**/src/**/*.ts` inside any function named `isAttachmentRef` returns zero matches.
- New regression test: `image_edit` request with a pre-v3 `objectKey`-only payload is rejected with a clear error (not silently misrouted) after the fallback is removed.

**W4.5:**
- New GCS writes (upload, `files.write` outbound) land under `fs/workspaces/...`; `gcloud storage ls gs://persai-dev-workspaces/assistant-media/` returns 404 or empty (post-D10 only).
- `rg "default.*assistant-media" packages/config/src` returns zero matches.

**W5:**
- `gcloud storage du gs://persai-{env}-workspaces/assistant-media/` returns empty (0 bytes / 0 objects) on both dev and prod.

---

## Closure-mode invariants

These principles are locked. They must not be weakened without a new ADR.

1. **Three sources, three concerns.** Manifest = index. GCS = bytes. Pod = cache. These concerns never merge.
2. **Pod FS being stale or partial is never a bug.** It is the designed cache semantics. Any code that treats pod FS absence as a correctness failure is a regression.
3. **Every file mutation site updates the manifest within the same atomic/transactional seam as the GCS or pod write.** No eventually-consistent "catch up later" pattern for the index.

---

## Anti-compromise red flags

Port from ADR-126 v3 cutover program hygiene; these apply to every wave of this ADR.

- `execPodBridgeService.ls(...)` or `workspaceFileList(...)` inside any `files.list` execution path is a red flag — the manifest must be the source.
- Reintroducing pod-as-index reasoning anywhere is a red flag.
- Returning to `assistant_chat_message_attachment` as the sole or primary file-existence index is a red flag.
- Any new file identity tied to a UUID or `objectKey` rather than `(workspaceId, path)` is a red flag.
- Type fraud (`as unknown as X`) to silence type errors during W1–W4 implementation is a red flag.
- Leaving `objectKey` fallback branches in place after the D8 migration is confirmed (confirmed = zero rows still carry `objectKey`-only payloads) is a red flag.
