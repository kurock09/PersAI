# SESSION-HANDOFF

## 2026-06-25 (evening) — ADR-127 W5 executed on dev (legacy GCS wipe complete) — CHECKPOINT

Scope: D10 — physical wipe of `gs://persai-dev-workspaces/assistant-media/` per `infra/dev/gke/ADR-126-V3-GCS-WIPE-RUNBOOK.md` Section 2 (full wipe). Baseline SHA `ee3fcbad` (post-push). Founder approved data loss explicitly ("Dev без коммерческих, удаляй все чисто").

### What was wiped

- `gs://persai-dev-workspaces/assistant-media/assistants/<aid>/chats/<chatId>/messages/<msgId>/<UUID>.<ext>` — legacy v1/v2 fileRef-shape chat message attachment blobs
- `gs://persai-dev-workspaces/assistant-media/assistants/<aid>/runtime-output/sessions/<sid>/requests/<rid>/<UUID>.<ext>` — legacy v1/v2 runtime-output blobs (mp3 voice notes, png images, mp4 posters, etc.)
- `gs://persai-dev-workspaces/assistant-media/workspaces/<wsid>/shared/...` — Gen 2 (path-identity but pre-W4.5-prefix) v3 attachments and outbound files
- `gs://persai-dev-workspaces/assistant-media/assistants/<aid>/sandbox-sessions/<sessionId>/workspace.tar` — sandbox session snapshot tars

### Wipe outcome

- ~1978 objects removed in ~25s via `gcloud storage rm -r --quiet gs://persai-dev-workspaces/assistant-media/`.
- Verification: `gcloud storage ls gs://persai-dev-workspaces/assistant-media/` → `ERROR: (gcloud.storage.ls) One or more URLs matched no objects.` (expected — prefix absent).
- `fs/` subtree alive (~40 KB at wipe time, only post-W4.5 writes including the live-test orphan file `live-test-2026-06-25.txt` and a few new uploads).
- Top-level bucket state: `assistant-knowledge/`, `fs/`, plus historical bare-UUID directories and `workspaces/` outside the wipe scope (pre-ADR-126 era artifacts; left as-is, founder did not request).

### Prod wipe

NOT executed. Founder approved dev-only ("без коммерческих"). Prod wipe deferred indefinitely.

### Live discovery during validation (separate issue, not part of W5)

Live test surfaced a model UX issue: when the model reads a binary file (e.g. `.xlsx`) it does ~7 tool calls (files.list → shell → "Файл не по тому пути" → glob → knowledge search → ...) instead of 2 (files.list → shell python parse). Root cause: model-canonical `/shared/input/X.xlsx` paths from `files.list` do NOT exist in pod filesystem (pod has `/shared/<workspaceId>/input/X.xlsx`); path translation via `injectWorkspaceIdSegmentIfMissing` works for `files.*` tool args but NOT for arbitrary command bodies inside `shell`. This is a long-standing seam, not a W1 regression. Suggested fix: pod-side symlinks `/shared/input -> /shared/<workspaceId>/input` and `/shared/outbound -> /shared/<workspaceId>/outbound` at pod-startup. Flagged as ADR-127 follow-up; not implemented in this session.

### Next steps

1. Optional: ADR-127 follow-up slice — pod-side symlinks for model-canonical `/shared/` paths (estimated <100 LOC in sandbox + Dockerfile/init).
2. Optional: small UX slice — loading skeleton in workspace files gallery during 1-2s fetch (avoid "Файлов пока нет" flash that confused live-validator subagent).
3. Triage 3 pre-existing `files.attach` runtime test failures (unrelated to ADR-127, surfaced earlier).
4. Prod wipe — deferred indefinitely until founder requests.

## 2026-06-25 — ADR-127 follow-up landed (drop residual ?? "assistant-media" fallbacks)

Scope: Hygiene follow-up to W4.5. Removed the dead `?? "assistant-media"` nullish-coalescing fallbacks from five sites in `apps/sandbox/src/` (`sandbox-object-storage.service.ts` ×4, `workspace-gc.service.ts` ×1). `PERSAI_MEDIA_OBJECT_PREFIX` is `z.string().min(1).default("fs")` — typed `string`, never `undefined` — so option A (bare removal) was safe at all sites. Baseline SHA: `5d43256c`. Zero string-literal hits for `"assistant-media"` remain in `apps/sandbox/src/`; the only remaining reference is a code comment in `sandbox-observability.service.ts:92` (backtick notation, not a fallback) and the intentional diagnostic rejection string in `media-delivery.service.ts`. Gate: lint/format/typecheck (sandbox, api, runtime) + sandbox test suite (79/79) all green.

## 2026-06-25 — ADR-127 W4.5 landed (PERSAI_MEDIA_OBJECT_PREFIX default rename: assistant-media → fs)

Scope: ADR-127 D9 only. Default value of `PERSAI_MEDIA_OBJECT_PREFIX` changed from `"assistant-media"` to `"fs"` in all three config schemas (`packages/config/src/api-config.ts`, `runtime-config.ts`, `sandbox-config.ts`) and all six explicit Helm pins in `infra/helm/values.yaml` / `values-dev.yaml`. `ADR-126-V3-GCS-WIPE-RUNBOOK.md` annotated with ADR-127 D9 semantics note. No DB changes; no GCS object moves; no logic delta — this is a deploy-config-only rename that takes effect on the next pod rollout. New writes after W4.5 deploy land under `<bucket>/fs/...`; the legacy `assistant-media/` prefix is wiped by the wipe runbook in W5 / D10. Baseline SHA: `92b28082` (W4 commit).

## 2026-06-25 — ADR-127 W4 landed (drop objectKey fallback in isAttachmentRef + data migration)

Scope: ADR-127 D8 only. Remove the legacy `objectKey` fallback branches from both `isAttachmentRef` validators plus a one-shot Prisma SQL migration that rewrites any in-flight `assistant_media_jobs.request_json` rows still carrying `objectKey`. Baseline SHA: `e65d21df` (W3 commit). Residuals: W4.5 (`PERSAI_MEDIA_OBJECT_PREFIX` rename) and W5 (GCS wipe runbook) remain open. Migration SQL is locally authored; live application happens on the next dev deploy.

### What changed

- `apps/api/prisma/migrations/20260625000000_adr127_w4_drop_objectkey_fallback_data_migration/migration.sql` (new): idempotent `UPDATE assistant_media_jobs SET request_json = ... WHERE request_json ? 'attachments' AND jsonb_typeof(...) = 'array' AND EXISTS (SELECT 1 ... WHERE att ? 'objectKey' AND NOT (att ? 'storagePath'))` — renames `objectKey` → `storagePath` per attachment element; rows without `objectKey` are untouched.
- `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-media-job.service.ts` — `isAttachmentRef` now requires `storagePath`; `objectKey` fallback branch removed.
- `apps/api/src/modules/workspace-management/application/workspace-media-job-scheduler.service.ts` — same change in the scheduler's `isAttachmentRef`.
- `apps/api/test/enqueue-runtime-deferred-media-job.service.test.ts` — 3 new ADR-127 W4 cases: storagePath accepted, objectKey-only rejected, mixed rejected.
- `apps/api/test/workspace-media-job-scheduler.service.test.ts` — 3 new ADR-127 W4 cases: same contract, validated via scheduler `processDueJobsBatch`.

### Residuals

- W4.5 / D9: `PERSAI_MEDIA_OBJECT_PREFIX` rename remains open.
- W5 / D10: GCS wipe runbook execution remains open (operational only, no code change).
- Migration SQL is unit-test-only until deployed; live application on the next dev rollout.



Scope: ADR-127 W3 only. Land delete-side symmetry so every active delete path updates durable truth (`workspace_file_metadata` + GCS) and treats pod FS eviction as best-effort cache cleanup. Baseline SHA: `180b0d61`.

### What changed

API (`apps/api`):

- `application/manage-chat-media.service.ts` now factors a shared durable delete flow used by both chat-scoped delete and the new workspace-scoped orphan delete. Order is now GCS delete -> manifest delete -> attachment-status clear (chat-backed only) -> best-effort hot-pod rm.
- `deleteChatWorkspaceFile` keeps its existing auth/chat ownership checks but now also deletes the manifest row and best-effort evicts the pod-side cached copy. Pod-rm failures are logged and swallowed; manifest delete remains fatal.
- New `deleteWorkspaceFile({ assistantId, workspaceId, path })` supports manifest-only/orphan tiles with no attachment row. It returns 404 only when both the manifest row and the GCS object are absent.
- `interface/http/media-attachment.controller.ts` adds `DELETE /api/v1/assistant/workspaces/:workspaceId/files?path=...` (assistant-authenticated, workspace ownership enforced, `/shared/...` only). Existing `DELETE /assistant/chats/web/:chatId/files` remains intact for attachment-backed tiles.
- `interface/http/internal-workspace-files.controller.ts` adds idempotent internal-token `DELETE /api/v1/internal/workspaces/:workspaceId/files/metadata?path=...` for runtime-side manifest deletes.
- `application/sandbox-control-plane.client.service.ts` adds `removeSharedFileFromHotPods`, a best-effort control-plane hop into sandbox for cache eviction only.

Runtime / sandbox / web:

- `apps/runtime/src/modules/turns/runtime-files-tool.service.ts` now deletes manifest rows after successful sandbox `files.delete` for `/shared/...` paths, while `/workspace/...` scratch deletes stay pod-only. Manifest-delete failures are warned and swallowed so the model still sees success once the pod delete completed.
- `apps/sandbox` adds `POST /api/v1/control/workspaces/:workspaceId/shared/rm` plus `ExecPodBridgeService.removeSharedFileFromWarmPods()`, which fan-outs `rm -f -- ...` to all running workspace session pods using model-canonical `/shared/...` input rewritten to pod-physical `/shared/<workspaceId>/...`.
- `apps/web/app/app/_components/workspace-files-gallery.tsx` no longer short-circuits orphan-tile delete; `assistant-api-client.ts` now calls the new workspace-scoped DELETE when `chatId === null`.

### Tests

- `apps/api/test/manage-chat-media.delete-workspace-file.test.ts` (new): chat-scoped durable delete, hot-pod best-effort swallow, manifest-delete fatal path, orphan-workspace delete, absent-manifest/object 404.
- `apps/api/test/internal-workspace-files.controller.test.ts` (new): internal delete 204, idempotent absent-row 204, `/shared/` validation, token auth.
- `apps/api/test/media-attachment.controller.test.ts`: workspace-scoped public delete happy path + 400/401/403 validation coverage.
- `apps/runtime/test/runtime-files-tool.service.test.ts`: focused `files.delete` manifest-delete coverage for `/shared/...` vs `/workspace/...`.
- `apps/sandbox/test/exec-pod-bridge.service.test.ts`: warm-pod rm path translation + no-hot-pod no-op coverage.

### Residuals

- W4/W4.5/W5 remain untouched by design: `objectKey` fallback removal, `PERSAI_MEDIA_OBJECT_PREFIX` default rename, and the GCS wipe runbook are still open follow-ups.
- Runtime test file `apps/runtime/test/runtime-files-tool.service.test.ts` still contains the 3 pre-existing `files.attach` baseline failures already documented in the 2026-06-25 W1 checkpoint; W3 added filtered `files.delete` runs instead of claiming the full file clean.
- Pod-side cache eviction is intentionally best-effort only. If sandbox is down or no warm pod exists, the manifest and GCS remain authoritative and the next hydrate/list cycle reconciles visibility.

## 2026-06-25 — ADR-127 W2 landed (parallel cold-start hydrate)

Scope: ADR-127 D6 only. Out of W2: D7 delete-side symmetry, D8 `isAttachmentRef` `objectKey` fallback drop, D9 `PERSAI_MEDIA_OBJECT_PREFIX` rename, D10 GCS wipe runbook. Baseline SHA: `76473a89`.

### What changed

Sandbox (`apps/sandbox`):

- `apps/sandbox/src/exec-pod-bridge.service.ts` now hydrates `/shared/<workspaceId>/...` with a bounded worker pool instead of a serial `for` loop. The cold-start GCS pull still enumerates the same keys and performs the same per-file `downloadObject` -> pod `execCommand` write, but it now runs up to `SHARED_MOUNT_HYDRATE_CONCURRENCY = 12` concurrent workers and waits with `Promise.allSettled` semantics so one bad blob no longer stalls or aborts the full hydrate.
- Per-file warn logs are unchanged (`shared_mount_hydrate_download_failed`, `shared_mount_hydrate_write_failed`). Outer `recordSnapshotColdPull("shared", elapsedMs)` remains unchanged. Because the observability service still exposes no object-count metric helper, hydrate completion now emits a single grep-friendly info line: `shared_mount_hydrate_done workspace=<id> objects=<n> elapsed_ms=<ms> concurrency=12`.
- `apps/sandbox/test/exec-pod-bridge.service.test.ts` gained focused coverage for the hydrate helper: empty-list no-op; all writes complete when `N <= concurrency`; peak in-flight work never exceeds the exported constant when `N > concurrency`; download failures warn and do not block siblings; non-zero pod-exec exits warn and the hydrate still resolves.

### Expected latency outcome

Cold-start hydrate latency should stop scaling linearly with object count for ordinary workspaces because GCS downloads and pod-exec writes now overlap. The actual W2 acceptance target (`p50 < 5 s for 200 files`) is **not** verifiable in unit tests and must be measured on the next `persai-dev` rollout.

### Residuals

- The optional large-blob serial fallback was **not** implemented in W2 because `SandboxObjectStorageService.listPrefix()` currently returns keys only, not object sizes. The code documents this residual and keeps concurrency conservative (`12`) to bound transient buffer pressure.
- Delete-side symmetry remains open: workspace/gallery delete behavior and manifest/GCS/pod best-effort delete convergence are still owned by W3 / D7.
- `objectKey` fallback removal, media-prefix rename, and GCS wipe remain untouched by design (W4/W4.5/W5).

## 2026-06-25 — ADR-127 W1 landed (manifest-as-index, create-side) — CHECKPOINT

Scope: ADR-127 D1, D3, D4, D5 (create-side only). Out of W1: D6 parallel cold-start hydrate, D7 delete-side symmetry, D8 `isAttachmentRef` `objectKey` fallback drop, D9 `PERSAI_MEDIA_OBJECT_PREFIX` rename, D10 GCS wipe runbook. Baseline SHA: `cf8f2963`.

### What changed

API (`apps/api`):

- New application services
  - `application/list-workspace-files-from-manifest.service.ts` — reads `workspace_file_metadata` rows under a `/shared/...` prefix, derives one-level-deep file vs directory children, and classifies roles (`shared_input` / `shared_outbound_self` / `shared_outbound_other`) by inspecting the next path segment against the caller's `assistantHandle`. Hard cap of 1000 manifest rows per call; `..` / non-`/shared/` prefixes rejected with 400.
  - `application/upsert-workspace-file-metadata-from-runtime.service.ts` — single-call wrapper around `WorkspaceFileMetadataService.upsert` reserved for the runtime. Hard-rejects any non-`/shared/` path so `/workspace/...` scratch can never be persisted to the manifest.
- New internal controller `interface/http/internal-workspace-files.controller.ts` mounted at `/api/v1/internal/workspaces/:workspaceId/files/*`, internal-token-authorised via the existing `assertPersaiInternalApiAuthorized` helper.
  - `GET /list?pathPrefix=<...>&assistantHandle=<...>` → `{ items: RuntimeFilesToolItem[] }`.
  - `POST /metadata` body `{ path, mimeType, sizeBytes, shortDescription? }` → 204.
- `application/list-chat-workspace-files.service.ts` rewritten — the UI gallery now reads `workspace_file_metadata` as the authoritative file list and LEFT JOINs `assistant_chat_message_attachment` by `storagePath` (latest by `createdAt`) for display metadata. Manifest entries with no attachment row become orphan tiles (`chatId: null`, `messageId: null`, attachment type inferred from MIME, filename from path basename). External-download paths and voice-note attachments are still filtered out. `ChatWorkspaceFileTile.chatId/messageId` are now `string | null`.
- `application/media/media-delivery.service.ts` — added `downloadWorkspaceFileByPath` / `previewWorkspaceFileByPath`, which look up the file in `workspace_file_metadata` and stream the bytes from the existing GCS object key (`buildSharedObjectKey`). 404 when the manifest row is missing, 410 when GCS lost the object.
- `interface/http/media-attachment.controller.ts` — added workspace-scoped endpoints `GET /assistant/workspaces/:workspaceId/files?path=&download=0|1` and `/files/preview?path=`. Auth re-uses `resolveRequestAssistant` and asserts `assistant.workspaceId === workspaceId`. Existing chat-scoped endpoints kept verbatim for backward compatibility (comment added).

Runtime (`apps/runtime`):

- `modules/turns/persai-internal-api.client.service.ts` — new methods
  - `listWorkspaceFilesFromManifest({ workspaceId, pathPrefix, assistantHandle })` → validates each entry against the `RuntimeFilesToolItem` contract before returning.
  - `upsertWorkspaceFileMetadata({ workspaceId, path, mimeType, sizeBytes })` → POSTs to the new manifest endpoint; tolerates 200 or 204.
- `modules/turns/runtime-files-tool.service.ts` — `files.list` on any path starting with `/shared/` (or exactly `/shared`) now delegates to `listWorkspaceFilesFromManifest` instead of running a sandbox `find`; `/workspace/...` keeps the existing sandbox path. `files.write` on `/shared/...` upserts the manifest after a successful sandbox write (best-effort; failure logged at warn, write outcome still surfaced to the model). `/workspace/...` writes never touch the manifest. New helpers `isSharedListPath`, `isSharedWritePath`, `inferMimeForWrite` (extension + `text/plain` fallback + JSON heuristic).

Web (`apps/web`):

- `app/app/assistant-api-client.ts` — `ChatWorkspaceFileTile.chatId/messageId` widened to `string | null`; new `buildWorkspaceFileUrl({ workspaceId, storagePath, download? })` mirrors `buildChatFileUrl` against the new workspace-scoped endpoints.
- `app/app/_components/workspace-files-gallery.tsx` — accepts a new `workspaceId: string | null` prop; new `buildTileUrl` helper picks `buildChatFileUrl` when `tile.chatId !== null` and falls back to `buildWorkspaceFileUrl` for manifest orphans. Used everywhere a tile URL is built (preview src, download url, thumbnail, poster, lightbox, "open in new tab"). Delete is short-circuited (with a `console.warn`) for orphan tiles — W3 will land the workspace-scoped DELETE.
- `app/app/_components/assistant-settings.tsx` — threads `assistant?.workspaceId ?? null` into the gallery.

Module wiring:

- `apps/api/src/modules/workspace-management/workspace-management.module.ts` — new services and controller registered.

### Tests

- `apps/api/test/list-chat-workspace-files.service.test.ts` rewritten to drive the manifest-as-source-of-truth path. Covers
  - attachment-backed tiles keep `chatId` / `messageId` / `thumbnailStoragePath`,
  - orphan PDF manifest row becomes a tile with `chatId: null` and `attachmentType: "document"` inferred from MIME,
  - voice-note attachments still filtered out,
  - external-download manifest entries (literal `external-download/...` prefix) skipped,
  - `type=image` / `type=document` filters apply across both backed and orphan tiles,
  - pagination across manifest-derived tiles via `storagePath` cursor.
- `apps/api/test/list-workspace-files-from-manifest.service.test.ts` (new) — 7 assertions: rejects non-`/shared/` and `..` prefixes; lists immediate `/shared/input` children (file + directory derived from deeper path); classifies outbound roles by handle ownership (`self` vs `other`); lists deep children of a sub-directory; empty result when no rows match; `parseInput` trims and validates required fields.
- `apps/api/test/upsert-workspace-file-metadata-from-runtime.service.test.ts` (new) — 6 assertions: upsert with no `shortDescription` omits the field; with `shortDescription` propagates it; rejects `/workspace/` paths; rejects `..` traversal; rejects negative / non-finite `sizeBytes`; rejects non-object bodies (string, array, null).
- `apps/runtime/test/runtime-files-tool.service.test.ts` — 5 new W1 tests appended: `files.list /shared/input` reads from manifest API and skips sandbox; `files.list /workspace` keeps sandbox `find`; `files.write /shared/...` upserts manifest with correct `workspaceId`/`path`/`mimeType`/`sizeBytes`; `files.write /workspace/...` does NOT upsert; manifest upsert failure is swallowed and the write still succeeds.

Note: 3 pre-existing `files.attach happy path` tests in `runtime-files-tool.service.test.ts` continue to fail at baseline (verified by re-running pre-change). They expect `registerChatAttachment` to be called from `executeAttachAction`, but the production code does not invoke it. This is out of W1 scope.

### Gate (all green, local)

- `corepack pnpm -r --if-present run lint` PASS
- `corepack pnpm run format:check` PASS
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/runtime run typecheck` PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm --filter @persai/api run test` PASS
- `corepack pnpm --filter @persai/runtime run test` PASS (runtime suite runner is structured by named exports — `runtime-files-tool.service.test.ts` is not currently wired in; new W1 tests verified by direct `tsx` execution alongside the 3 pre-existing failures noted above)

### Risks / residuals

- Orphan tile delete behaviour: gallery short-circuits with a console.warn. Will be wired to the workspace-scoped DELETE in W3 (D7 delete-side symmetry).
- Manifest list cap is 1000 rows / request — sufficient for current workspaces, but W3/W4 should add server-side pagination if a workspace approaches that volume.
- `objectKey` fallback in `isAttachmentRef` validators (`enqueue-runtime-deferred-media-job.service.ts`, `workspace-media-job-scheduler.service.ts`) intentionally untouched — owned by W4 / D8.
- `PERSAI_MEDIA_OBJECT_PREFIX` rename and the GCS `assistant-media/<fileRef>/` wipe runbook still pending — W5 / D9 + D10.

### Next recommended step

Open a fresh slice for W2: cold-start hydrate parity (D6) and delete-side symmetry (D7). W2 must land delete-side symmetry before the gallery's orphan-delete affordance can be unlocked.

## 2026-06-25 — ADR-127 opened (W0 done)

ADR-127 opened — manifest as source of truth, pod FS as cache. Continues ADR-126 v3 (does NOT reopen it). W1–W5 plan locked. No code changes yet.

Next step: W1 — manifest-as-index refactor (api + runtime + UI gallery), implements D1, D3, D4, D5 create-side.

## 2026-06-25 (evening) — ADR-126 v3: `image_edit` attachment-ref validation fix — CHECKPOINT

### Scope / root cause

Live dev after `adeff5c0` deploy: upload + vision + disk path (`find` sees `/shared/.../input/3534.jpg`) work; `files.read`/`files.preview` on JPEG correctly return null/empty (text tools, not vision); `shell ls` on `input/` permission-denied is expected (D2 RO). **`image_edit` still fails** with `runtime_degraded` — "attachments must contain valid runtime attachment refs".

Root cause: ADR-126 v3 cutover moved `RuntimeAttachmentRef` to `storagePath` + `displayName`, but two API validators were never updated:
- `apps/api/.../enqueue-runtime-deferred-media-job.service.ts:isAttachmentRef`
- `apps/api/.../workspace-media-job-scheduler.service.ts:isAttachmentRef`

Runtime sends valid `storagePath` refs; API rejects them because it still required `objectKey`.

### What changed

- Both `isAttachmentRef` helpers now validate `storagePath` (legacy `objectKey` fallback for old persisted payloads).
- New test in `apps/api/test/enqueue-runtime-deferred-media-job.service.test.ts` — `image_edit` with `/shared/input/3534.jpg` attachment parses and enqueues.

### Gate (all green, local)

- `corepack pnpm -r --if-present run lint` PASS
- `corepack pnpm run format:check` PASS
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm --filter @persai/api run test` PASS

### Push

- Commit: `c1f10340` on `main` (rebased over gitops pin `8c57b439` for `adeff5c0`).

### Next recommended step

1. Wait for dev image pin of api (or full affected set) + re-test live: upload JPEG → `image_edit` on `image #N` alias.
2. Continue ADR-126 live closure checklist (`files.attach`, gallery, cold-pod upload).

## 2026-06-25 (late) — ADR-126 v3 amendment: model-canonical /shared/... path translation + hot-pod inbound bytes-push — CHECKPOINT

### Scope / root cause

Two coupled live-regression bugs after the dev rollout of ADR-126 v3 amendment 2026-06-24 (`files.attach` assistant-bubble fix + `PERSAI_MEDIA_OBJECT_PREFIX` default):

1. **Path mismatch.** `resolveUniqueSharedInputStoragePath` (api) and the sandbox `files.attach` job already returned model-canonical paths **without** the workspaceId segment (`/shared/input/<name>`, `/shared/outbound/self/<name>`) because the model never sees workspaceId. The pod-physical layout puts those files under `/shared/<workspaceId>/...` (per D2 in `apps/sandbox/src/workspace-path.ts`). `assertAllowedMountPrefix` only accepted the wsId-prefixed form, so the moment the model issued `files.read("/shared/input/3470.png")` for an uploaded inbound, the bridge rejected with `outside_allowed_mount` — and the model surfaced this as a "binary not readable" hallucination.
2. **Inbound bytes not pushed to a hot pod.** `hydrateSharedMountFromGcs` populates `/shared/<wsId>/input/` **only** during the cold-pod bootstrap (Phase 3 of `ensureSharedMountBootstrapped`). A web upload arriving while a pod was already warm never reached the pod's FS — the chat-attachment metadata row was correct but the underlying bytes were absent from the pod, so `glob`/`files.read` saw "file not found" / "0 byte".

Baseline SHA: `795472967905f6abb21a742086336136b2686cc6` (the post-`files.attach`-fix push). CI for that SHA was red due to `apps/runtime/test/runtime-config.test.ts:30` still expecting `PERSAI_MEDIA_OBJECT_PREFIX === undefined` after we introduced the default. That test is fixed in this slice (now expects `"assistant-media"`).

### What changed

Path translation (Part A):

- `apps/sandbox/src/workspace-path.ts`: `assertAllowedMountPrefix` now translates model-canonical `/shared/<input|outbound>/...` → pod-physical `/shared/<workspaceId>/...` before the prefix check via a new `injectWorkspaceIdSegmentIfMissing` helper. wsId-prefixed inputs are unchanged (idempotent). Unknown-handle outbound paths still reject as `outside_allowed_mount` (the rewrite must not bypass the handle allowlist).
- `apps/sandbox/test/workspace-path.test.ts`: six new tests pin model-canonical + wsId-prefixed shapes for shared_input, shared_outbound_self, shared_outbound_other, bare `/shared/input`, and an unknown-handle rejection.

Hot-pod inbound bytes-push (Part B):

- `apps/sandbox/src/exec-pod-bridge.service.ts`: new `tryExecShellInExistingSessionPod` that exec's into the (assistantId, workspaceId) session pod **only if it is in `Running` phase** (404 / non-Running → returns `null`). Never triggers `createExecPod` / cold-start — that work belongs to the next genuine sandbox job whose hydrate will pull the bytes from GCS.
- `apps/sandbox/src/workspace-file-bridge.service.ts`: new `writeSharedInputControlPlane(ctx, { basename, contents })` that calls `tryExecShellInExistingSessionPod` with an atomic `chmod 0744 input/ && cat > input/<basename> && chmod 0444 input/<basename> && chmod 0444 input/` script. Defence-in-depth basename validator rejects `..`, separators, NUL. Returns `mode: "deferred"` when the pod is cold, `mode: "written"` on success. No GCS mirror here (the api already wrote the canonical GCS copy — single-write inbound).
- `apps/sandbox/src/sandbox.service.ts`: `writeSharedInbound(input)` wrapper, mirror of `writeSharedOutbound` but quota-free (the api's `media_storage_quota` is the single accounting source for inbound bytes).
- `apps/sandbox/src/sandbox.controller.ts`: `POST /api/v1/jobs/shared-inbound-write` endpoint, symmetric to `shared-outbound-write`.
- `apps/api/src/modules/workspace-management/application/sandbox-control-plane.client.service.ts` (new): best-effort HTTP client. Returns `mode: "deferred"` if sandbox base URL or internal API token are unset. Never throws on misconfig / network failure / sandbox-side error — every failure mode is logged at warn and treated as `deferred` (cold-start hydrate is the authoritative recovery path).
- `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts`: hot-pod push wired into `stageForWebThread` immediately after the GCS upload + `registerChatAttachment` succeed. Helper `extractSharedInputBasename` strips the `/shared/input/` prefix off the model-facing storagePath the API just emitted.
- `apps/api/src/modules/workspace-management/workspace-management.module.ts`: client registered as a provider.
- `apps/api/test/manage-chat-media.{stage-web-thread,transcribe-voice}.test.ts`: fixtures widened with a `noopSandboxControlPlaneClient` so all eight constructor sites compile.

Helm + network:

- `infra/helm/values-dev.yaml`: api env block now sets `PERSAI_SANDBOX_BASE_URL: "http://sandbox:3013"` + `PERSAI_SANDBOX_TIMEOUT_MS: "20000"`.
- `infra/helm/values.yaml`: same fields added with empty defaults so the schema is exercised.
- `infra/helm/templates/networkpolicies.yaml`: `sandbox-ingress-runtime-only` extended with a second pod selector (`app.kubernetes.io/name: api`) so the api can reach `sandbox:3013`. Without this the push would silently fail (and the cold-start hydrate would still cover) but the api logs would fill with timeouts.

CI fix:

- `apps/runtime/test/runtime-config.test.ts:30`: `PERSAI_MEDIA_OBJECT_PREFIX` expected value changed from `undefined` to `"assistant-media"`, matching the schema default introduced in the 2026-06-24 fix-up. This unblocks `full-checks` job 83320895490 that has been red since the previous push.

ADR:

- `docs/ADR/126-unified-sandbox-workspace-files-shell-single-fs-bash-default-and-expanded-egress.md`: new top-of-file Amendment 2026-06-25 block describing both fixes, the touched files, and why GCS remains the single canonical store for inbound bytes (hot-pod push is a latency optimisation, not a second source of truth).

### Gate (all green, local)

- `corepack pnpm -r --if-present run lint` PASS
- `corepack pnpm run format:check` PASS
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm --filter @persai/runtime run typecheck` PASS
- `corepack pnpm --filter @persai/sandbox run typecheck` PASS
- `corepack pnpm --filter @persai/sandbox test` PASS (72/72; new `writeSharedInputControlPlane` suite covers written / deferred / failed / basename-validation)
- `corepack pnpm --filter @persai/runtime test` PASS
- `corepack pnpm --filter @persai/api test` PASS (incl. updated `manage-chat-media.*` fixtures)
- `corepack pnpm --filter @persai/provider-gateway test` PASS
- `helm lint infra/helm` PASS

### Live validation (after deploy)

1. Upload an image in chat → no more "Chat runtime is temporarily unreachable" (the earlier `PERSAI_MEDIA_OBJECT_PREFIX` fix already covered this; this checkpoint preserves the fix).
2. Upload an image in chat → ask the model `files list /shared/input/` → the file appears (the hot-pod push has populated the pod's FS) and `files read <path>` succeeds (the path-translation accepts the wsId-less form the model uses).
3. With the assistant idle for >15 min (so the sandbox pod goes cold), upload another image → ask any sandbox question to trigger pod boot → the cold-start hydrate must still pull the inbound from GCS (deferred-mode path).

### Follow-up

- Consider hardening `manage-chat-media.uploadAttachment` (the non-staging path) with the same hot-pod push — only `stageForWebThread` is wired in this slice because it is the path the live user-visible bug came in on.
- The `PERSAI_SANDBOX_BASE_URL` is now plumbed for the api; a future slice can consolidate other api → sandbox control-plane calls (e.g. retiring `sandbox-policy.ts`'s standalone client surface) through this single bridge.
- The `_prisma_migrations` `failed` record auto-resolution that bit the previous push has no new fixture in this slice — it remains as a known operational watch-point until the `detect-affected.mjs` rework (architectural follow-up logged 2026-06-24 evening).

## 2026-06-25 - ADR-126 v3 `files.attach` assistant-message binding fix - CHECKPOINT

### Scope / root cause

Live dev bug: model-called `files.attach({ path })` showed the attachment chip on the user bubble because runtime called `registerChatAttachment` mid-turn with the current user message id. Other artifact tools already route through `RuntimeOutputArtifact` and are delivered at end-of-turn against the assistant message.

Baseline SHA: `56fc902336f1da07ea1a4320e67bc8fbd535128e`.

### What changed

- `apps/runtime/src/modules/turns/runtime-files-tool.service.ts`: `files.attach` still runs the sandbox attach job, then emits a `RuntimeOutputArtifact` using the existing `/shared/.../outbound/self/...` storage path. It no longer calls mid-turn `registerChatAttachment`, no longer returns a user-authored discovered handle, and does not expose `/workspace/...` source paths in the payload.
- `apps/runtime/src/modules/turns/turn-execution.service.ts`: the files tool passes `result.artifacts` into `createToolExecutionOutcome`, allowing normal assistant-message artifact delivery.
- `apps/api/src/modules/workspace-management/application/register-chat-attachment.service.ts`: `resolveRuntimeMessageId` now throws `NotFoundException("chat_message_not_found")` when runtime input has `messageId: null`; it no longer falls back to the running attempt `userMessageId`.
- Targeted runtime/API tests now assert artifact emission and the removed fallback.
- `docs/CHANGELOG.md` records the post-closure ADR-126 v3 bug fix.

### Gate

- `corepack pnpm --filter @persai/runtime exec tsx --test test/runtime-files-tool.attach.test.ts` PASS
- `corepack pnpm --filter @persai/runtime exec tsx --test test/files-attach-after-image-generate.test.ts` PASS
- `corepack pnpm --filter @persai/api exec tsx --test test/register-chat-attachment.service.test.ts` PASS
- `corepack pnpm --filter @persai/runtime run typecheck` PASS
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/runtime run lint` PASS
- `corepack pnpm --filter @persai/api run lint` PASS
- `corepack pnpm run format:check` PASS

### Follow-up

No commit or push was made per user instruction. Next recommended step: review the diff, then commit and deploy/live-validate that `files.attach` chips now render on assistant bubbles.

## 2026-06-24 (late) — ADR-126 v3 round-2 Opus-4.8 audit closure (post-closure polish) — CHECKPOINT

After the v3 closure was claimed clean (see immediately-following 2026-06-24 entry), the user dispatched an independent adversarial Opus-4.8 audit on the finalized tree. Round-1 audit (run as part of closure) had flagged 4 blockers (B1–B4) + 3 nits (N1–N3); round-2 re-audit verified 6 of 7 closed and flagged one **PARTIAL** (B3 residual — model still saw "Five actions" in the `<category name="files">` block while the tool definition advertised six) plus four new nits (NEW: stale catalog source-of-truth; NEW: stale `native-tool-projection.test.ts` mock + assertion; NEW: B4 unmetered artefact-write seam at `sandbox.service.writeSharedOutbound` where `workspaceQuotaBytes` / `sharedQuotaBytes` were hardcoded `null`; NEW: N1 label vocabulary mismatch between ADR D12 (`install | scratch | shared`) and code (`session | shared`)).

All addressed in this session:

- **B3 residual + nit (model-facing six-actions sweep across all SoT).** `apps/api/prisma/bootstrap-preset-data.ts` `<category name="files">` updated to "Six actions: list, read, preview, write, delete, attach" with a sentence calling `files({action:"attach", path})` the explicit chat-delivery action; `tool-catalog-data.ts` (`modelDescription` + `modelUsageGuidance` + the seeded plan-config `description` + `usageGuidance`) brought to the same six-actions text with `files.attach` examples and the GOTCHA that attach delivers an EXISTING file (must be written first); `apps/runtime/test/native-tool-projection.test.ts` mock-policy and the `/five actions/i` + enum assertions rewritten to "Six actions" + `attach` enum check. `adr119-golden-prompt-snapshot.expected.txt` regenerated; line 195 now reads "Six actions: list, read, preview, write, delete, attach".
- **B4 plumbing (artefact outbound writes now metered).** `sandbox.service.writeSharedOutbound` input extended with optional `workspaceQuotaBytes?: number | null` and `sharedQuotaBytes?: number | null`; bridgeCtx no longer hardcodes `null`. Wiring threaded through `apps/sandbox/src/sandbox.controller.ts` (nullable-number body parser), `apps/runtime/src/modules/turns/sandbox-client.service.ts` (JSON body), `apps/runtime/src/modules/turns/write-runtime-outbound-artifact.ts` (helper input), and the 5 caller services (`runtime-image-generate-tool.service.ts`, `runtime-image-edit-tool.service.ts`, `runtime-document-provider-adapter.service.ts`, `runtime-tts-tool.service.ts`, `runtime-video-generate-tool.service.ts`) each reading `params.bundle.governance.quota?.{workspaceQuotaBytes, sharedQuotaBytes} ?? null` at every `persistGeneratedArtifact` callsite. Test double extended; new sandbox bridge test asserts the shared-cap guard fires for `writeSharedOutboundWithCollision` with `sharedQuotaBytes` exceeded.
- **N1 vocab (ADR D12 reconciled to v3 reality).** D12 histogram label set updated from `install | scratch | shared` (aspirational draft) to the v3-real `session | shared` with an inline note explaining install/scratch collapsed into the single per-session snapshot restore in the unified-workspace model.
- **B2 (no inline ADR body changes needed beyond Amendment).** Top-of-file Amendment 2026-06-24 already reconciles the inline body's missing `<prefix>/` on D5 step 1 / Acceptance §10; auditor flagged this as a careful-reader nit only.

### Gate (round-2 closure)

- `corepack pnpm -r --if-present run lint` PASS
- `corepack pnpm run format:check` PASS (auto-fix landed on `tool-catalog-data.ts` + `sandbox-client.service.ts` from the B4 plumbing; both whitespace-only)
- 4 typechecks PASS (`@persai/api`, `@persai/web`, `@persai/runtime`, `@persai/sandbox`)
- `pnpm --filter @persai/api run test` — 51 test suites, `fail 0` across all (golden snapshot regenerated post-B3 update)
- `pnpm --filter @persai/runtime run test` PASS (subagent confirmed; types extended to carry new optional quota fields)
- `pnpm --filter @persai/sandbox run test` PASS (subagent confirmed + new bridge quota guard test)
- `pnpm --filter @persai/web run test` — 832/832 PASS (unchanged from closure run)
- Retired-symbol grep on `apps/api/src apps/runtime/src apps/sandbox/src apps/web/app packages/runtime-contract/src packages/runtime-bundle/src packages/contracts/src` for `fileRef|AssistantFileRegistryService|materializeMountedFiles|mountFileRefs|ensureUploadedFile|ensureAttachmentFile|buildFileRefKey` — **0 use-sites** (only negating JSDoc in `packages/runtime-contract/src/index.ts` and rejection guards in `internal-runtime-{media,document}-jobs.controller.ts` that throw "fileRef is retired; use storagePath")
- `workspace_quota_exhausted` / `shared_quota_exhausted` typed reasons present in 18 sites across sandbox prod + tests + runtime mapping

### What was not done

- No deploy / dev image pin (still pending the standing rule: no commit/push without explicit user instruction).
- Live validation of `snapshot_cold_pull_latency_ms` histogram + quota enforcement under prod load is pending the next dev rollout.
- B2 inline ADR body (D5 step 1 / Acceptance §10) deliberately left as-is; the Amendment at the top of the file is the canonical reconciliation. Auditor verdict: doc nit, not divergence.

### Next recommended step

Commit the entire ADR-126 v3 cutover + round-2 polish (222 files, ~7950 ins / ~21700 del) per the user's commit-strategy preference — either as one mega-commit "ADR-126 v3 cutover + post-Opus-audit polish" or split by logical unit (DB / API / runtime / sandbox / web / docs). Ask before committing because of size.

## 2026-06-24 — ADR-126 v3 cutover (path-identity end-to-end; all six waves + closure landed locally) — CHECKPOINT

### State

ADR-126 **v3** (clean cutover to path identity end-to-end — no `fileRef`, no `assistant_files` table, no `assistant-media/<fileRef>` GCS prefix) is **landed cleanly in working tree**, not yet pushed. The 2026-06-23 v2 Slice 3 checkpoint below is superseded by this entry — v2 was a transitional shape that still kept `assistant_files` as a metadata-only row, then `fileRef` as a UI identity hop, then `/assistant-media/<fileRef>` as the GCS object key. Founder rejected v2 as half-measure ("залипуха"), demanded a single source of truth: `(workspaceId, path)`. v3 is the result.

The whole program was executed as an orchestrator-driven sequence of bounded Composer-2.5 subagent dispatches per `docs/ADR/126-v3-CUTOVER-PROGRAM.md`: W1 (DB foundation) → W2 (API server rewrite) → W2-fix (dual-write bridge removed after audit caught it) → W3.1+W3.1-fix+W3.2+W3.3 (runtime rewrite split into three sub-phases after W3.1 was caught fraudulently reporting PASS) → W4 (sandbox cleanup; tar-only persistence path) → W4.5 (synchronous thumbnail/poster derivatives during inbound media — added when founder UX review of W5 surfaced that the new tile gallery would render empty without thumbnails) → W5 (web UI rewrite per founder-approved tile-gallery + collapsed project-files UX) → W6a (production naming + JSDoc cleanup + 17-test sweep + tool-catalog audit) → Closure (lint + format auto-fix + OpenAPI surgery + GCS wipe runbook + this handoff + CHANGELOG + ADR program file + AGENTS.md). Every subagent report was independently verified by the orchestrator before the next wave was dispatched; two waves (W2, W3.1) were force-redone after the verification caught dual-write bridges and type-system fraud.

### What changed (v3 truth)

#### Identity model

`(workspaceId, path)` is the single identity. `path` is the canonical POSIX-absolute FS path under `/shared/<wsid>/...` or `/workspace/<aid>/<wsid>/...`. There is no UUID-based file handle on any model-facing or web-facing surface. `assistant_files` table, `AssistantFile` model, `fileRef` field, `AssistantFileRegistryService`, `RuntimeAssistantFileRegistryService`, `mountFileRefs`, `materializeMountedFiles`, `ensureUploadedFile`, `ensureAttachmentFile`, `ensureAttachmentBackedFile`, `buildFileRefKey`, `PersaiMediaObjectStorageService.downloadObject` for `assistant-media/`-keyed blobs — all retired in production code.

#### DB (W1 + W4.5)

- `apps/api/prisma/schema.prisma`: dropped `model AssistantFile`, `AssistantUploadMicroDescriptionJob`, `AssistantDocumentDeliveredFile`, `AssistantFileMediaDerivative`, and all back-relation arrays referencing `AssistantFile[]`. Dropped `assistant_file_id` from `AssistantChatMessageAttachment`; repurposed its `storage_path VARCHAR(1024)` to hold canonical FS paths (semantics flipped from GCS key to FS path). Added `WorkspaceFileMetadata` (path-keyed manifest cache, PK `(workspaceId, path)`, `shortDescription TEXT`, FK to `workspaces` with cascade). W4.5 added `thumbnail_storage_path` and `poster_storage_path` (VARCHAR 1024, nullable) columns to `AssistantChatMessageAttachment`.
- Migrations: `apps/api/prisma/migrations/20260623230000_adr126_v3_drop_assistant_files_and_path_identity/migration.sql` (W1) and `apps/api/prisma/migrations/20260624120000_adr126_v3_thumbnail_path_identity/migration.sql` (W4.5). W1's data-fill step NULLs `storage_path` for any row whose value `LIKE 'assistant-media/%'` and flips `processing_status` to `unavailable`, so historical chats degrade gracefully when the GCS wipe runbook executes.

#### Runtime contract + tool surface (W2 + W3.1–W3.3 + W4)

- `packages/runtime-contract/src/index.ts`: `RuntimeFileRef` renamed to `RuntimeFileHandle` (path-based, `{ workspaceId, path }`). `RuntimeOutputArtifact` and `RuntimeAttachmentRef` dropped `fileRef`, carry `storagePath` only. JSDoc for cross-chat revise rewritten from the legacy `AssistantFile id` model to the v3 path-identity model. `PERSAI_RUNTIME_FILES_TOOL_ACTIONS` stayed at the five path actions from Slice 3.
- `apps/runtime/src/modules/turns/runtime-files-tool.service.ts`: `files.attach` calls `registerChatAttachment` with the canonical path. `files.preview` routes through sandbox read, no `lookupAssistantFileByWorkspaceRelPath` fallback. `enrichListWithShortDescriptions` reads from `workspace_file_metadata` via the renamed API method `listWorkspaceFileShortDescriptions` (URL kept at `/api/v1/internal/runtime/files/short-descriptions` — already path-native from W2).
- `apps/runtime/src/modules/turns/turn-execution.service.ts` + `turn-context-hydration.service.ts`: working files block, discovered-paths injection, and path-attachment download all path-based; turn state carries `fileHandles` + `discoveredFilePaths`.
- `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts`: deleted `extractAssistantFileText`, `lookupAssistantFileByWorkspaceRelPath`, `createAssistantAttachmentFromWorkspacePath`. Added `registerChatAttachment`. Renamed `listAssistantFileShortDescriptions` → `listWorkspaceFileShortDescriptions`.
- `apps/sandbox/src/sandbox.service.ts`: deleted the entire `assistant_files`-keyed workspace-shadow mechanism (`loadCurrentAssistantWorkspaceFiles`, `ensureWorkspaceSessionHydrated`, `materializeMountedFiles`, `persistWorkspaceFiles`, `deleteRemovedWorkspaceFiles`, `deleteStaleAssistantWorkspaceFiles`, `backfillWorkspaceFileIntegrity`, `toProducedFile`, `writeWorkspaceSessionStateMarker`, `resolveWorkspaceDelta`, `collectWorkspaceFiles`). `executeQueuedJob` simplified to tar-snapshot restore at job start + tar-snapshot save at job end; the sandbox no longer touches `assistant_files`. `apps/sandbox/src/workspace-gc.service.ts` raw-SQL DELETE retargeted from `assistant_files` (dropped in W1) to `workspace_file_metadata WHERE workspace_id=$1 AND path LIKE $2`; the lease-reaper audit field is now `metadataRowsRemoved`.

#### API server (W2)

- New `apps/api/src/modules/workspace-management/application/register-chat-attachment.service.ts` (replaces `AssistantFileRegistryService`): resolves `(assistantId, channel, externalThreadKey) → AssistantChat.id`, writes one path-identity row into `assistant_chat_message_attachments`, optionally records derivatives (`thumbnailStoragePath`, `posterStoragePath`).
- New `apps/api/src/modules/workspace-management/application/workspace-file-metadata.service.ts` + `domain/workspace-file-metadata.repository.ts` + `infrastructure/persistence/prisma-workspace-file-metadata.repository.ts`: path-keyed CRUD over the new `workspace_file_metadata` table.
- New `apps/api/src/modules/workspace-management/application/list-workspace-file-short-descriptions.service.ts` + path-native internal controller (`InternalRuntimeFilesController`).
- New `apps/api/src/modules/workspace-management/application/artefact-shared-outbound-write.service.ts` + sandbox client (`apps/api/src/modules/workspace-management/application/sandbox-shared-outbound-write.client.service.ts`): single-write of bytes for `image_generate` / `image_edit` / `document` / `tts` / `video_generate` artefacts to `/shared/outbound/self/<basename>` (collision-suffix per `build-outbound-basename.ts`); GCS mirror via `buildSharedObjectKey`; no dual-write to a `assistant-media/<fileRef>` blob.
- Renames/deletes: `assistant-file-cleanup-reaper.service.ts`, `assistant-file-media-derivative-scheduler.service.ts`, `assistant-file-registry.service.ts`, `assistant-upload-micro-description{,-scheduler,-job}.service.ts`, `extract-internal-runtime-assistant-file.service.ts`, `media/assistant-file-media-derivative.service.ts` — all deleted (no replacement; logic absorbed into the v3 inbound-media + register-chat-attachment path or simply retired).
- W4.5: `media/inbound-media.service.ts` now synchronously calls `MediaPreprocessorService.createImageThumbnail` (skipping GIF/SVG) for images and `createVideoPoster` for videos after the quota gate, stores derivatives to GCS at canonical `.thumb.webp` / `.poster.jpg` paths, and passes them into `RegisterChatAttachmentService`. Derivatives are not quota-billed.

#### Web (W5)

- DELETED: `apps/web/app/api/assistant-file/[fileRef]/route.ts` (legacy BFF route), `apps/web/app/app/_components/assistant-files-manager.tsx` (bucket-based UI).
- NEW: `apps/web/app/app/_components/workspace-files-gallery.tsx` — founder-approved tile gallery (4-column grid; All / Images / Videos / Documents filter pills; sort by `createdAt DESC`; thumbnails from `thumbnailStoragePath`, posters from `posterStoragePath`; MIME-icon fallback; click → `ImageLightbox` for image/video or new-tab download for document; cursor pagination via `listChatWorkspaceFiles`).
- REWRITTEN: `apps/web/app/app/_components/project-files-panel.tsx` — collapsed by default; one-line "Файлы проекта" link; click dispatches `assistant-settings-open-tab` event with `files` payload (NOT inline expand). Dedupes attachments by `storagePath`.
- REWRITTEN: `apps/web/app/app/_components/assistant-settings.tsx` — Files tab now mounts `WorkspaceFilesGallery`; listens for the dispatched event to auto-open. `chat-message.tsx` and `use-chat.ts` use `path`/`thumbnailStoragePath`/`posterStoragePath` and build URLs via `buildChatFileUrl`. `assistant-api-client.ts` lost `getAssistantFiles`/`AssistantFileState`/`getAssistantFileDownloadUrl`/`deleteAssistantFile` etc.; gained `buildChatFileUrl`, `listChatWorkspaceFiles`, `deleteChatWorkspaceFile`.

#### Contracts package (Closure)

- `packages/contracts/openapi.yaml` surgery: deleted 3 dead endpoints (`/assistant/files`, `/assistant/files/{fileRef}`, `/assistant/files/{fileRef}/download`) and 7 dead schemas (`AssistantFileState`, `AssistantFilesCleanupSummary`, `GetAssistantFilesResponse`, `GetAssistantFileResponse`, `AssistantFileDocumentLink`, plus inline enums absorbed into `AssistantFileState`). `AssistantWebChatMessageAttachmentState` and `StageAttachmentAttachment` schemas rewritten to mirror production export shape from `apps/api/src/modules/workspace-management/application/web-chat.types.ts`: added `path`/`thumbnailStoragePath`/`posterStoragePath`, removed `fileRef`/`thumbnailFileRef`/`posterFileRef`/`derivativesStatus`/`fileDeleted`. Orval regenerated cleanly. Side cleanup: added `deepseek` to `RuntimeProviderModelCatalogByProviderState` and `AdminRuntimeProviderSettingsState.providerKeys` (drift caught during regen — the prod admin code referenced `deepseek` without contract truth).

#### Cleanup of unused imports (Closure)

- 6 unused imports removed during the lint pass: `buildGeneratedFileSemanticSummary` import in `runtime-document-provider-adapter.service.ts`, `normalizeRuntimeFilesReadExtractionQuality` import in `runtime-files-tool.service.ts`, `randomUUID` imports in `runtime-image-edit-tool.service.ts` / `runtime-image-generate-tool.service.ts` / `runtime-video-generate-tool.service.ts`, `PersaiMediaObjectStorageService` import in `runtime-tts-tool.service.test.ts`. Prettier auto-fix landed on 45 files.

### Verified (Closure gate, all green)

- `corepack pnpm -r --if-present run lint` — PASS (5 apps + scripts/smoke)
- `corepack pnpm run format:check` — PASS (all matched files use Prettier code style)
- `corepack pnpm --filter @persai/api run typecheck` — PASS
- `corepack pnpm --filter @persai/runtime run typecheck` — PASS
- `corepack pnpm --filter @persai/sandbox run typecheck` — PASS
- `corepack pnpm --filter @persai/web run typecheck` — PASS
- `corepack pnpm --filter @persai/runtime-contract run typecheck` — PASS
- `corepack pnpm --filter @persai/contracts run typecheck` — PASS
- `corepack pnpm --filter @persai/runtime run test` — PASS (every isolated suite)
- `corepack pnpm --filter @persai/sandbox run test` — PASS (63/63)
- `corepack pnpm --filter @persai/web run test` — PASS (832 / 832 across 69 test files)
- `corepack pnpm --filter @persai/api run test` — PASS (full suite, exit 0)
- Anti-fraud `rg "\"file\"\s*\+\s*\"Ref\"|identityKey\s*=\s*\"file"` across `apps/` + `packages/` — 0 matches
- Retired-symbol audit `rg "fileRef|AssistantFileState|getAssistantFile*"` across `apps/` + `packages/contracts` — 0 production matches (only intentional JSDoc negations like "no `fileRef`" and one legitimate rejection-mode controller comment)

### Deferred to next session (live cutover)

1. **GCS wipe runbook execution** — `infra/dev/gke/ADR-126-V3-GCS-WIPE-RUNBOOK.md` lists the dev + prod `gcloud storage rm -r assistant-media/` sequence. Operator action, runs after the v3 images are pinned and validated on dev.
2. **Dev deploy + image pin.** Pre-deploy gating: both v3 migrations (`20260623230000` + `20260624120000`) pause `Dev Image Publish` on the `persai-dev-migrations` GitHub Environment per CI policy. Coordinate the helm pin with migration approval.
3. **Live acceptance on `persai-dev`** (full list in ADR-126 v3 § Acceptance, repeated here for the cutover):
   - `files.write({path:"/workspace/hello.txt"}) → shell({command:"cat /workspace/hello.txt"})` returns `hi`
   - PDF upload → next runtime turn sees `/shared/<wsid>/input/<file>.pdf` from `files.read` and `shell ls`
   - `image_generate` writes once to `/shared/outbound/self/`; no per-file GCS blob written under `assistant-media/<fileRef>`
   - `files.attach({path})` from `/workspace/...` copies to `/shared/outbound/self/` and produces an `assistant_chat_message_attachment` row with the canonical FS path
   - Sibling assistant A reads `/shared/<wsid>/outbound/<other>/foo.csv`; `chmod 0555` enforced
   - Web project files panel collapsed; click opens Settings → Files; tile gallery renders thumbnails+posters; filter pills toggle
   - Empty `assistant_chat_message_attachments` rows whose legacy `storage_path` was nulled render as "unavailable" in the chat history without breaking the message
4. **Prod cutover.** After dev validation runs clean for one full session, repeat the migration + wipe runbook on prod.

### Residuals / risks

- **No commit/push yet.** Per the user's standing "no git push unless asked" rule, the entire v3 working tree is local. The session-ending output below lists the changed/added/deleted file count; commit + push is the user's call.
- **45 files reformatted by Prettier** during closure. Diff is whitespace/indent-only on those — they showed up in the format auto-fix step, not from logic changes; review of `git diff -w` is the cheap way to confirm.
- **Two pre-existing `deferred-document-acknowledgement.test.ts` fixture failures** (orthogonal — flagged in the 2026-06-22 deferred-job handoff entry, still present, still out of scope).
- **Three pre-existing `as unknown as RuntimeProviderModelProfileState` casts** in `apps/web/app/admin/runtime/page.tsx` predate this session (W5 baseline). The anti-fraud audit flagged them; orchestrator left them in place per scope discipline.
- **`recordSharedInputPublished` event has no production callers** (only the type + logger exist). Forward-looking from earlier waves; intentionally renamed in W6a so the next caller wires into the v3 vocabulary.
- **Closure-mode ADR-117** has a pending `cache-prefix rollout SHA` slot that is unrelated to ADR-126; not in scope.

### Baseline SHA

HEAD at session start: `45f5b011` (`sandbox(adr-126 s2): expanded egress allowlist + tool-attribution log; git push policy amended to ALLOW`). All v3 work is in the working tree; no commits made.

---

## 2026-06-23 — ADR-126 v2 Slice 3 (unified files contract cutover — closed cleanly via orchestrated subagent program) — CHECKPOINT (SUPERSEDED by 2026-06-24 v3 entry above)

### State

ADR-126 v2 Slice 3 is now **landed cleanly** with no transitional dual-write and no parallel legacy code paths, matching the ADR's hard contract ("Не оставлять параллельные старые код-пути после переезда `files.*`"). The previous partial state — sandbox dispatcher referencing three unwritten methods, legacy `fileRef`-based model guidance still teaching deleted actions, dead legacy `executeFiles{Read,Write,Edit,Delete}Action` private methods, no FS-level chmod enforcement, no upload bytes mirror, zero focused tests for the new modules — was closed in this session via an orchestrated subagent program (Phases A → G). No push. All AGENTS gate steps are green locally.

The earlier (now-replaced) handoff entry under-stated the actual contract change: it claimed the runtime contract stayed "additive only" and that the `RuntimeFilesToolService` rewrite + `mountedFileRefs` removal + grep/glob migration were "deferred". Reality (visible in `git diff HEAD`) is that the contract dropped the six legacy `files.*` actions, removed `fileRef` from `RuntimeFilesToolItem`, removed `mountedFileRefs` from `RuntimeSandboxJobRequest`, made `assistantHandle` + `siblingHandles` required, and the runtime tool service is fully rewritten on the five path actions. This session's job was to finish what the previous one started without leaving any legacy survivor.

### What changed

#### Schema + handle helpers (already landed before this session; preserved)

- **`apps/api/prisma/schema.prisma`** + migration `20260623160000_adr126_slice3_assistant_handle_and_gc_lease`:
  - `Assistant.handle` `VARCHAR(64)`, unique per workspace, backfilled deterministically via slug + numeric suffix + `a-<hex-of-id>` fallback; the migration sets `NOT NULL` and the unique index after backfill.
  - `SandboxWorkspaceGcLease` + `SandboxWorkspaceGcLeaseKind` enum (`chat_scratch | assistant_outbound | workspace_shared`).
- **`assistant-handle.ts`** + `PrismaAssistantRepository.create` mints the assistant UUID client-side inside a transaction and seeds the slugger with it so the handle is present at row birth.
- **GC lease writes (API-side):** `PrismaAssistantChatRepository.hardDeleteChat` writes `chat_scratch` lease with `scheduledAt = now()` before delete; `AdminDeleteUserService` writes `assistant_outbound` (`now()+7d`) and `workspace_shared` (`now()+30d`) before `tx.assistant.delete` / `tx.workspace.delete`.

#### Runtime contract — breaking removal of legacy `files.*` (already landed; preserved + finished)

- **`packages/runtime-contract/src/index.ts`** — `PERSAI_RUNTIME_FILES_TOOL_ACTIONS` reduced from 11 actions to the canonical five: `list | read | preview | write | delete`. `RuntimeFilesToolItem` rewritten path-only (`path`, `type`, `role ∈ {workspace | shared_input | shared_outbound_self | shared_outbound_other}`, `sizeBytes`, `mimeType`, `modifiedAt`, optional `shortDescription`). `RuntimeFilesToolResult` collapsed to one shape with required `path`. `RuntimeSandboxJobRequest` now requires `assistantHandle: string` and `siblingHandles: readonly string[]` and no longer carries `mountedFileRefs`.
- **`packages/runtime-bundle/src/index.ts`** — `AssistantRuntimeBundleMetadata` now requires `assistantHandle` and `siblingAssistantHandles`. `materialize-assistant-published-version.service.ts` populates both from the `assistant.handle` column + a same-workspace sibling query.

#### Runtime native projection — model schema is path-only (already landed; preserved)

- **`apps/runtime/src/modules/turns/native-tool-projection.ts`** — `files` tool `inputSchema` rewritten path-only. `action` enum = `list | read | preview | write | delete`. Schema fields: `path` (required for everything except optional list root), `dir` alias for list, `content` for write, `mode` ∈ `overwrite | create_only` for write, `maxBytes` for read/preview, `maxDepth` for list. No `fileRef`, no `alias`, no `query`, no `search`/`inspect`/`get`/`edit`/`send`/`write_and_send`. Document tool's `fileRef` source-staging field is untouched (ADR-097 surface, out of scope).

#### Runtime files tool — end-to-end rewrite on the five path actions (already landed; preserved)

- **`apps/runtime/src/modules/turns/runtime-files-tool.service.ts`** — every action routes to a sandbox job (`runSandboxJob`) carrying `{action, path, ...}`. `enrichListWithShortDescriptions` calls a new internal API (`listAssistantFileShortDescriptions`) for manifest description caching. `executePreviewAction` uses the binary-extraction fallback through `lookupAssistantFileByWorkspaceRelPath` + `extractAssistantFileText` for PDFs / DOCX / images (ADR-116 preview cache continues to apply on the legacy `fileRef` indirection, which is allowed by the ADR because preview is a delivery-side cached artefact, not a model-facing write path).

#### Sandbox — control-plane bridge primitives + dispatcher wiring (closed in this session)

- **`apps/sandbox/src/workspace-file-bridge.service.ts`** (new last session) implements `workspaceFileWrite`, `workspaceFileRead`, `workspaceFileList`, `workspaceFileStat`, `workspaceFileDelete`. Each enforces path containment via `assertAllowedMountPrefix` (`apps/sandbox/src/workspace-path.ts`), shells into the session pod via `ExecPodBridgeService.execShellInSessionPod` with single-quote-escaped arguments, emits structured audit events (`WorkspaceAuditService`) and Prometheus latency histograms (`sandbox_workspace_file_{write|read|list|stat|delete}_latency_ms`). Shared writes mirror bytes to GCS via `SandboxObjectStorageService.saveObject` against `buildSharedObjectKey` so cold pods can rematerialise.
- **`apps/sandbox/src/sandbox.service.ts`** — dispatcher wired this session. New private methods `executeFilesBridgeAction(bridgeCtx, args)` (routes the five path actions + a `stat` helper to the bridge primitives and marshals each result into the JSON `content` shapes that `runtime-files-tool.service.ts` parses), `executeGrepActionViaPodExec(bridgeCtx, args)` and `executeGlobActionViaPodExec(bridgeCtx, args)` (run `rg`/`fd` inside the session pod via `execShellInSessionPod` against `/workspace` + `/shared` with `normalizeAndClampPath` containment). The `executeTool` switch now routes `files`/`grep`/`glob` exclusively through these new pod-exec methods. All legacy private methods deleted: `executeFilesReadAction`, `executeFilesWriteAction`, `executeFilesEditAction`, `executeFilesDeleteAction`, `readSandboxFilesAction`, `executeGrepAction`, `executeGlobAction`, `runTrustedControlPlaneBinary` (and the now-orphaned `resolveFilesReadablePath`). The new dispatcher's list output computes per-entry `role` from the resolved path and filters system noise (`node_modules`, `.venv`, `.local`, `.npm-global`, `.cache`, `__pycache__`, dotfiles, `*.pyc`/`*.log`/`*.lock`/`*.tmp`) unless `args.includeHidden === true`.

#### Sandbox — `/shared/<wsid>/` mount + FS-level access matrix (closed in this session)

- **`apps/sandbox/src/exec-pod-bridge.service.ts`** — bootstrap of `/shared/<workspaceId>/` now runs in four phases per pod creation: (1) marker check `test -f /tmp/.persai_shared_bootstrap_ok` for early return on warm pods; (2) `mkdir -p input/`, `outbound/<self-handle>/`, sibling `outbound/<other-handle>/`, plus `ln -sfn <self-handle> outbound/self`; (3) GCS hydrate — `SandboxObjectStorageService.listPrefix` enumerates `workspaces/<wsid>/shared/` and each blob is piped into the pod via `cat > <path>` with stdin = bytes (matches `workspaceFileWrite` shape); (4) chmod enforcement — `chmod 0444 input/`, `chmod 0755 outbound/<self-handle>/`, `chmod 0555 outbound/<other-handle>/` for every sibling, then `printf '__PERSAI_SHARED_OK__' > /tmp/.persai_shared_bootstrap_ok`. The deferral comment about chmod has been removed (AGENTS rule: no TODO scaffolding).

#### Sandbox — GC reaper (already landed; preserved)

- **`apps/sandbox/src/workspace-gc.service.ts`** — cron interval `SANDBOX_GC_INTERVAL_MS` (default 300 s) drains due leases. `chat_scratch` → `rm -rf /workspace/chats/<chatId>` per matching warm pod, GCS subtree drop, matching `assistant_files` rows deleted. `assistant_outbound` → `workspaces/<wsid>/shared/outbound/<handle>/` prefix dropped, sibling outbound `rm -rf`'d in every warm pod, `assistant_files` cleanup. `workspace_shared` → full `workspaces/<wsid>/shared/` prefix dropped, `/shared/<wsid>/*` purged in every warm pod, `assistant_files` cleanup. Failed leases stay open and emit `workspace_gc_purge_failed`; successful ones set `purged_at` and emit `workspace_gc_purged`. Lifecycle-independent of the source rows; lease is the single execution path (no eager cross-process call).

#### API — upload bytes mirror (Pattern B, GCS-first lazy hydrate — closed in this session)

- **`apps/api/src/modules/workspace-management/application/media/persai-media-object-storage.service.ts`** — added `buildSharedObjectKey({workspaceId, workspaceRelPath})` mirroring `SandboxObjectStorageService` against the same bucket + prefix.
- **`apps/api/src/modules/workspace-management/application/assistant-file-registry.service.ts`** — `ensureAttachmentFile` for `origin === "uploaded_attachment"` now calls `mirrorUploadToSharedGcs` (private) AFTER the row create + `metadata.workspaceRelPath = "/shared/input/<sanitized-basename>"` set. Best-effort: on failure logs `assistant_file_shared_hydrate_failed` and marks `metadata.sharedHydrationStatus = "pending"`. Never throws, never fails the upload. The pod's `/shared/` bootstrap (item above) pulls these blobs from GCS on first pod start. Web (`manage-chat-media.service.ts`) and Telegram (`inbound-media.service.ts`) flows reach this path through `ensureAttachmentFile` unchanged.

#### Runtime + API — legacy `fileRef` guidance and dead detection cleared (closed in this session)

- **`apps/api/src/modules/workspace-management/application/runtime-tool-policy.ts`** — `files` block guidance rewritten path-only. No more `relativePath`, `aliases`, `query`, `search`/`inspect`/`get`/`edit`/`send`/`write_and_send`. Path-only teaches `/workspace/` (private) vs `/shared/<wsid>/input/` (RO) vs `/shared/<wsid>/outbound/self/` (publish) vs sibling outbound (RO).
- **`apps/api/prisma/tool-catalog-data.ts`** — `files.modelDescription` + `files.modelUsageGuidance` rewritten to the same path-only mental model. The slice does NOT yet add the full ADR D8 manifest economy (summary header + on-demand list with `shortDescription`); that is Slice 5.
- **`apps/runtime/src/modules/turns/turn-execution.service.ts`** — developer-block `files` instructions and the accept-action set already path-only from the previous session's slice 3 work; verified clean.
- **`apps/runtime/src/modules/turns/sanitize-tool-result-for-model.ts`** — legacy `fileRef`-shape detection branch deleted (no dead code per AGENTS rule).
- **`apps/runtime/src/modules/turns/runtime-assistant-file-registry.service.ts`** — `toRuntimeFilesToolItem` was a dead alias that built the legacy `RuntimeFilesToolItem`-with-fileRef shape; it now returns the existing internal `RuntimeFileRef` (chat-delivery identity), which the working-file-tracking call sites consume. The path-only `RuntimeFilesToolItem` is only built inside `runtime-files-tool.service.ts` from sandbox list output.

#### Tests — focused coverage for the new sandbox modules (closed in this session)

- **`apps/sandbox/test/workspace-path.test.ts`** (new) — 21 cases covering `normalizePosixPath`, `normalizeAndClampPath`, `assertAllowedMountPrefix` (workspace / shared_input / outbound self via handle and via `self` symlink / sibling outbound / unknown handle reject / `/etc/passwd` reject), `buildSharedRoot`, `buildWorkspaceRoot`, and `WorkspacePathError.code`.
- **`apps/sandbox/test/workspace-file-bridge.service.test.ts`** (new) — 15 cases covering write success + create_only collision + sibling/input write_denied + self-outbound GCS mirror; read success + missing + truncated; list success + missing-dir; stat file + missing; delete success + delete_denied; path traversal raises `WorkspacePathError`.
- **`apps/sandbox/test/workspace-gc.service.test.ts`** (new) — 8 cases covering all three lease kinds (past-due processing per kind + future-dated skip), assistant-pod filtering, malformed metadata → `recordGcPurgeFailed` without `purged_at`, single-lease exception isolation, already-purged lease filter.
- **`apps/sandbox/test/sandbox.service.test.ts`** — rewritten to the new contract: 6-arg constructors with handle + sibling, `mountFileRefs` moved inside `args`, every literal `RuntimeSandboxJobRequest` carries `assistantHandle` + `siblingHandles`, legacy `executeFilesEditAction` / lease-reclaim / hydrate test block removed (no dead stubs), grep/glob legacy assertions removed since the methods no longer exist.
- **`apps/runtime/test/**`** — 17 test files updated to add `assistantHandle: "a-test"`+`siblingAssistantHandles: []`to every`AssistantRuntimeBundleMetadata`literal.`runtime-files-tool.service.test.ts`(legacy 11-action surface) deleted cleanly — the action surface no longer exists.`sandbox-client.service.test.ts`lost the stale`mountedFileRefs` field.

#### Config (already landed; preserved)

- **`packages/config/src/sandbox-config.ts`** — `SANDBOX_SHARED_EMPTYDIR_SIZE_MIB` (default 512), `SANDBOX_GC_INTERVAL_MS` (default 300_000). No other env additions.

### Deliberately deferred per ADR (NOT in slice 3 — explicit slice ownership)

1. **Slice 4 — `files.attach({path})`** + `image_generate` / `image_edit` / `document` dual-write into `/shared/outbound/self/`. ADR D5 + D6. Not in this slice.
2. **Slice 5 — `tool-catalog-data.ts` manifest economy** (summary header + per-file `shortDescription` cache + cheap-LLM description pipeline). ADR D8. The slice removed legacy actions from the guidance; the full new mental model + manifest stays Slice 5.
3. **Slice 5 — D13 migration audit script** against live `persai-dev` for `fileRef` references in skill content. Hard gate on the program's final push, not on slice 3.
4. **Slice 5 — plan-baseline data migration** (`workspaceStorageBytesLimit` and `sharedStorageBytesLimit` ≥ 500 MB).
5. **Slice 6 — layered snapshot for `/workspace/`** (install layer vs. scratch layer content-hash split). ADR D10. Slice 3 sets up the `/shared/` GCS subtree + lazy hydrate; full layered snapshot for `/workspace/` is staged.

### Verified

Run from repo root, all green this session:

- `corepack pnpm -r --if-present run lint` — PASS (5 apps + scripts/smoke).
- `corepack pnpm run format:check` — PASS (all matched files use Prettier code style).
- `corepack pnpm -r --if-present run typecheck` — PASS (`@persai/config`, `@persai/runtime-contract`, `@persai/contracts`, `@persai/types`, `@persai/runtime-bundle`, `@persai/logger`, `scripts/smoke`, `@persai/sandbox`, `@persai/web`, `@persai/provider-gateway`, `@persai/runtime`, `@persai/api`).
- `corepack pnpm --filter @persai/sandbox exec node --import tsx --test --test-concurrency=1 test/workspace-path.test.ts test/workspace-file-bridge.service.test.ts test/workspace-gc.service.test.ts test/sandbox.service.test.ts test/exec-pod-bridge.service.test.ts test/sandbox-metrics.service.test.ts` — PASS (77/77).
- `corepack pnpm --filter @persai/runtime exec tsx test/run-suite-isolated.ts` — PASS (14/14 isolated suites).

### Residuals / risks

- **Live validation pending.** The slice is locally green but has not been deployed. Acceptance criteria from ADR-126 §Acceptance to verify post-deploy on `persai-dev`:
  - `files.write({path:"/workspace/hello.txt", content:"hi"}) → shell({command:"cat /workspace/hello.txt"})` returns `hi` (the founder's exact 2026-06-22 failure case).
  - User attaches a PDF in chat → next runtime turn of any assistant in the same `businessWorkspaceId` sees `/shared/<wsid>/input/<original>.pdf` via `files.read` and via `shell ls /shared/<wsid>/input/`.
  - Assistant А generates `/shared/<wsid>/outbound/A/forecast.csv`; assistant Б runs `shell ls /shared/<wsid>/outbound/A/` and reads it; `shell echo > /shared/<wsid>/outbound/A/x` fails with `Permission denied` (chmod 0555 enforced).
- **Migration ordering.** The Prisma migration `20260623160000` must run before the API image rolls; `Assistant.handle` becomes `NOT NULL` after backfill, and the `materialize-assistant-published-version.service.ts` path reads it as `string`. Pinning the migrations gate (per AGENTS' `persai-dev-migrations` environment) on the next dev rollout is required.
- **`/shared/` hydrate cost on cold pods.** GCS list+download runs once per pod creation; for workspaces with many input files this adds visible cold-start latency. The full layered snapshot from D10 (Slice 6) is the planned mitigation.
- **Warm pods and new uploads.** A warm pod that started before an upload will not see the new `/shared/<wsid>/input/<name>` file until the next pod creation (next session restart). This matches the "next-tick" pattern the ADR sets for chat-scratch GC and is acceptable for inputs (users typically upload at the start of a chat).
- **chmod boundary.** The chmod runs from inside the pod after hydrate, so the process is running as the pod's UID. The `0444` on `input/` prevents the model from writing there; control-plane `workspaceFileWrite` to `/shared/<wsid>/input/...` is rejected at the bridge boundary by `WorkspaceFileBridgeService` returning `write_denied` before any pod exec. Upload bytes already land via the GCS hydrate path, not via the model surface — the policy is enforced at both layers.
- **2 pre-existing `deferred-document-acknowledgement.test.ts` fixture failures** (orthogonal to slice 3) noted in the 2026-06-22 deferred-job handoff entry below — still present, not in scope.

### Files

**New (untracked):**

- `apps/api/prisma/migrations/20260623160000_adr126_slice3_assistant_handle_and_gc_lease/`
- `apps/api/src/modules/workspace-management/application/assistant-handle.ts`
- `apps/api/src/modules/workspace-management/application/list-assistant-file-short-descriptions.service.ts`
- `apps/api/src/modules/workspace-management/application/lookup-assistant-file-by-workspace-rel-path.service.ts`
- `apps/sandbox/src/workspace-audit.service.ts`
- `apps/sandbox/src/workspace-file-bridge.service.ts`
- `apps/sandbox/src/workspace-gc.service.ts`
- `apps/sandbox/src/workspace-path.ts`
- `apps/sandbox/test/workspace-file-bridge.service.test.ts`
- `apps/sandbox/test/workspace-gc.service.test.ts`
- `apps/sandbox/test/workspace-path.test.ts`

**Modified (apps):**

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/tool-catalog-data.ts`, `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/api/src/modules/workspace-management/{application,domain,infrastructure,interface}/...` — `admin-delete-user.service.ts`, `assistant-file-registry.service.ts`, `manage-web-chat-list.service.ts`, `materialize-assistant-published-version.service.ts`, `media/persai-media-object-storage.service.ts`, `runtime-tool-policy.ts`, `assistant-chat.repository.ts`, `assistant.entity.ts`, `prisma-assistant-chat.repository.ts`, `prisma-assistant.repository.ts`, `internal-runtime-files-controller.ts`, `workspace-management.module.ts`
- `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt`, `apps/api/test/runtime-tool-policy.test.ts`
- `apps/runtime/src/modules/turns/*` — `native-tool-projection.ts`, `persai-internal-api.client.service.ts`, `runtime-assistant-file-registry.service.ts`, `runtime-document-provider-adapter.service.ts`, `runtime-files-tool.service.ts`, `runtime-grep-glob-tool.service.ts`, `runtime-sandbox-tool.service.ts`, `sanitize-tool-result-for-model.ts`, `turn-execution.service.ts`
- `apps/runtime/test/**` — 17 fixture updates (handle/siblings on bundle metadata, `mountedFileRefs` removals, sandbox-client cleanup, document-adapter mount assertions) + deletion of `runtime-files-tool.service.test.ts` (legacy 11-action surface; no longer exists)
- `apps/sandbox/src/*` — `app.module.ts`, `exec-pod-bridge.service.ts`, `sandbox-metrics.service.ts`, `sandbox-object-storage.service.ts`, `sandbox-observability.service.ts`, `sandbox.service.ts`
- `apps/sandbox/test/*` — `exec-pod-bridge.service.test.ts`, `sandbox-metrics.service.test.ts`, `sandbox.service.test.ts`

**Modified (packages):**

- `packages/config/src/sandbox-config.ts`
- `packages/runtime-bundle/src/index.ts`
- `packages/runtime-contract/src/index.ts`

**Docs:**

- `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md` (this checkpoint replaces the earlier under-stated slice 3 entry).

### Next recommended step

1. Founder review of the closure and the orchestrated subagent program (Phases A → G). The slice is local-only — no push happened.
2. On approval, commit + push as one slice. Apply the `20260623160000` migration via the `persai-dev-migrations` environment gate, then pin the dev image tag.
3. Live-validate the acceptance criteria above on `persai-dev`, starting with the founder's exact case (`files.write → shell cat`) and the cross-assistant upload visibility.
4. Open Slice 4 next: `files.attach({path})` action + `image_generate` / `image_edit` / `document` dual-write into `/shared/outbound/self/`.

---

## 2026-06-23 — ADR-126 v2 (unified sandbox workspace; multi-assistant, manifest, GC, snapshot) — CHECKPOINT (doc-only)

### State

Founder asked to widen ADR-126 from the v1 (D1–D4: bash, unified `/workspace`, expanded egress, image baseline) into a production-grade design that also covers the B2B multi-assistant workspace shape, prompt-economical file manifest, chat-scoped scratch, snapshot/cold-start budget, GC lifecycle, audit/observability, and a migration audit for existing `fileRef`-dependent skill content. ADR-126 was rewritten as v2 (doc-only) with thirteen explicit decisions (D1–D13) and a six-slice implementation program. No code changes accompany this checkpoint.

### What changed

- **D1 unchanged** — bash as default `/bin/sh` for the `shell` tool.
- **D2 reshaped** — `files.*` retargets two mounts instead of one: per-assistant `/workspace/` (existing) **plus** per-`businessWorkspaceId` `/shared/` (new). `/shared/input/` (user uploads, RO for assistants), `/shared/outbound/<assistant-handle>/` (each assistant's outbound, RO for siblings via `0555`), `/shared/outbound/self` symlink so models never need to remember their own handle. `fileRef` leaves the model-facing API; the model operates on paths exclusively.
- **D3 unchanged** — egress allowlist expanded for GitHub HTTPS + PyPI + npm; `git push` denied by HTTPS-method filtering on `…/git-receive-pack`.
- **D4 unchanged** — exec image gains Node 22 LTS + bash default; `/workspace/.npm-global` configured as the npm prefix; tool catalog guidance updated to mention `pip install --user` / `npm install` / `git clone` and the `git push` denial.
- **D5 new** — `image_generate` / `image_edit` / `document` dual-write the produced bytes into `/shared/outbound/self/<basename>` in addition to the existing `assistant_files` chat delivery, so the producing assistant can post-process its own artefact.
- **D6 new** — `files.attach({path})` is the explicit publish channel for arbitrary file types from `/workspace/` or `/shared/outbound/self/` into the chat. Implicit auto-attach of `files.write` outputs is rejected — the model decides what to ship.
- **D7 new** — quota model splits cleanly: existing `workspaceStorageBytesLimit` (per assistant) plus a new `sharedStorageBytesLimit` (per `businessWorkspaceId`); both default to 500 MB after the plan-baseline data migration; exhaustion produces `workspace_quota_exhausted` / `shared_quota_exhausted` from the existing quota guard.
- **D8 new** — developer prompt embeds a summary header (`{ totals, byKind }`) + current-turn attachments inline only. Older files are reachable through `files.list` / `files.preview`. Cached `shortDescription` is generated once at upload / write via the existing cheap-LLM/OCR pipeline; system noise (`node_modules`, `.venv`, `__pycache__`, `*.pyc`, dotfiles, files > 8 MiB) is excluded from listing and description.
- **D9 new** — chat-scoped scratch namespace `/workspace/chats/<chatId>/` (default `cwd` for `shell`) + `/workspace/lib/` (reusable scripts). Install layer (`.local/`, `.npm-global/`, `node_modules/`, `.venv/`) stays assistant-scoped, surviving chat boundaries.
- **D10 new** — snapshot layering separates install layer (content-hashed, reused across cold starts) from scripts/scratch; warm-pool of size 1 per assistant wired through `apps/sandbox` lease scheduler; explicit latency budget — warm `files.write` ≤ 300 ms p95, cold first `files.write` ≤ 8 s p95 — to be verified by the implementation slice.
- **D11 new** — GC lifecycle made explicit: chat deletion purges `/workspace/chats/<chatId>/` on next lease sweep; assistant deletion marks `/workspace/` snapshot with a 7-day grace and moves `/shared/outbound/<handle>/` to `_archived/` for 30 days; business-workspace deletion marks the whole `/shared/` snapshot with a 30-day grace.
- **D12 new** — audit events (`workspace_file_written`, `workspace_file_read`, `shared_outbound_published`) and metrics (`workspace_file_write_latency_ms`, `snapshot_cold_pull_latency_ms`, `shared_quota_bytes_used`) emitted by the new control-plane primitives. Egress-proxy log shape extended with `{ tool }` attribution.
- **D13 new** — one-shot migration audit script scans `tool-catalog-data.ts`, `AssistantSkill` rows, `RuntimeBundleState.materializedSpec`, runtime `files-tool-builder`, and web chat history rendering for active-surface `fileRef` references. The implementation program does **not** push until the active-surface report is empty.
- **Implementation plan** restructured to six slices: image + warm-pool entry; egress + git-push deny; unified contract + `/shared/` mount + control-plane primitives + upload-hydrate + GC hooks + audit events; artefact dual-write + `files.attach`; tool catalog + manifest + cheap-LLM descriptions + migration audit + plan baseline bump; snapshot layering finalisation (optional, may fold into slice 3).
- **Acceptance criteria** expanded from 11 to 20 — covers brace expansion, the founder's exact failure case, GitHub clone, pip/npm installs, git push denial, upload visibility across siblings, collision suffix, artefact dual-write + postprocessing, FS-level sibling RO enforcement, write-permission rejections, historical render compatibility, latency budget, quota error classes, content-hash preview cache, manifest economy, GC purge timing, and an empty migration-audit report against live `persai-dev`.
- **Threat model** expanded with the new sibling-RO row, shared-volume cross-tenant boundary statement, and the migration-audit residual.
- **Resolved decisions** consolidated into 16 hard contracts spanning the 2026-06-22 and 2026-06-23 founder sign-offs.

### Verified

- ADR-126 rewrite is doc-only; no source, test, schema, helm, or infra change.
- `corepack pnpm run format:check` — PASS (Prettier covers the markdown surface).
- No source typecheck or lint is required for this slice (no `.ts` files touched).

### Residuals / risks

- The migration audit (D13) will surface live `fileRef` mentions in founder-active assistants' skill content; the implementation program treats the empty active-surface report as a hard pre-push gate, but the rewrites themselves still need careful per-skill review when slice 5 runs.
- D10 layered snapshot details (content hash basis, blob reuse) are described at the contract level only; the implementation slice owns the exact GCS object layout and may surface adjustments back into the ADR as a slice-level edit if the chosen layout deviates from the doc.
- The `files.attach` UI rendering is described as "the existing `assistant_files` SSE/REST projection"; the actual web `chat-message` component will be revisited in slice 4 to confirm no new render branch is needed.

### Files

- modified: `docs/ADR/126-unified-sandbox-workspace-files-shell-single-fs-bash-default-and-expanded-egress.md`, `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`.

### Next recommended step

1. Founder review of the ADR-126 v2 doc; sign-off or callouts on any D-decision before the implementation program is dispatched.
2. When approved, dispatch the implementation program as a sequence of bounded slices (1 → 5/6), each closing on the AGENTS gate, with the final push gated by the migration-audit empty report.

---

## 2026-06-23 — Post-turn cleanup parallelization — CHECKPOINT

### State

Founder approved an XS performance slice on clean baseline `03fd1b03` after live trace `web-1782200487212` showed roughly 300 ms of fixed serialized overhead between `cost_ledger_recorded` and `replay_completed` on web streaming turns. Scope stayed bounded to post-runtime cleanup parallelization for API web stream/sync paths, the analogous Telegram quota/ledger tail, focused tests, and docs. No runtime, Prisma, migrations, SSE event contracts, or follow-up delivery semantics were changed; no commit/push was made.

### What changed

- **Finalize layer** — `finalizePersistedWebTurn` now starts active media-job read, active document-job read, and web media delivery together, then marks `media_delivered` only after all three resolve. After final delivery-honesty content is persisted, quota usage recording and model-cost ledger append now run together; quota and cost trace stages remain after the awaited writes.
- **Caller cleanup layer** — stream and sync web callers now use shared `runWebTurnPostRuntimeCleanup`, which runs optional replay completion and skill-state persistence concurrently via `Promise.allSettled`. Skill-state persistence remains non-blocking with the existing warning/fallback behavior, and replay cleanup failures are logged instead of preventing the other cleanup from finishing.
- **Replay write layer** — `completeWebTurnReplay` now writes the durable turn-attempt terminal payload and surface-binding replay state concurrently, then marks `replay_completed` only after both writes resolve.
- **Telegram tail** — Telegram has no web replay/skill cleanup equivalent, but its independent post-message quota usage write and cost-ledger append now run concurrently. Quota remains non-blocking; ledger failure remains blocking as before.

### Verified

- Focused: `corepack pnpm --filter @persai/api exec tsx --test test/complete-web-post-runtime-turn.test.ts` — PASS (4/4).
- Existing stream web: `corepack pnpm --filter @persai/api exec tsx --test test/stream-web-chat-turn.service.test.ts` — PASS (15/15).
- Existing sync web: `corepack pnpm --filter @persai/api exec tsx --test test/send-web-chat-turn.service.test.ts` — PASS (11/11).
- Full requested AGENTS gate — PASS: API lint, API typecheck, runtime typecheck, web typecheck, format check, and full API test. API lint/typecheck were rerun after Prettier touched the new focused test.

### Residuals / risks

- `quotaAdvisoryFollowUpService` and `compactionAdvisoryFollowUpService` remain sequential/mutually exclusive by design, and notification delivery remains synchronous so `followUpAssistantMessage` can still be returned in the same web response/SSE done payload.
- Trace stage timestamps for parallel quota/cost and replay writes now represent "both writes finished" boundaries rather than per-write serialized boundaries, while preserving the same stage labels and ordering.
- No hidden dependency was found between replay-state writes and skill-state persistence; Telegram did not expose an equivalent web replay cleanup path.

### Files

- modified: `apps/api/src/modules/workspace-management/application/complete-web-post-runtime-turn.ts`, `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`, `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`, `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts`, `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`.
- added: `apps/api/test/complete-web-post-runtime-turn.test.ts`.

### Next recommended step

1. Run the full requested gate in order, then orchestrator review/commit/push.
2. Deploy API to `persai-dev` and live-validate a representative web streaming turn: expected post-runtime fixed overhead should drop qualitatively from serialized ~300 ms toward the slowest independent branch plus follow-up delivery.

---

## 2026-06-23 — Slice 6 v2 (one-badge-top + passive + persist toolInvocations) — CHECKPOINT

### State

Slice 6 live validation on baseline `d852af7f` exposed three shipped gaps: committed assistant bubbles could show a process badge between long content blocks, RU process labels used gendered active verbs despite female assistant settings, and backend web/TG persistence never carried runtime `toolInvocations`, so the UI could not show specialized badge labels from history or completed transports. Scope stayed bounded to Slice 6 v2: web badge rendering/i18n/tests, API assistant-message metadata/SSE/history plumbing, and docs. No runtime implementation, Prisma schema, queues, budgets, completion-turn, `<system-reminder>`, or ADR-125 work was touched.

### What changed

- **Web badge copy + labels** — `chat.processBadge.*` now uses passive/gender-neutral RU labels (`Выполнено`, `Найдено`, `Сгенерировано`, `Прочитано`, etc.) and matching EN labels. `resolveProcessBadgeLabel` now recognizes search/fetch/media/document/files/shell tool groups, falling back to `Done/Выполнено` for mixed process pieces.
- **One committed badge at bubble top** — `buildIterationBlocks` now has committed vs streaming modes. Committed assistant messages collapse every short process/tool piece into one top process badge and render structural content blocks after it; streaming messages preserve live per-content-boundary ordering.
- **API tool invocation transport/persistence** — added a shared `stripToolInvocationsForClient` helper that removes `billingFacts`. Stream completed/replay payloads, sync web responses/replay, and web/TG `persistAssistantMessage` calls now carry stripped `toolInvocations` when present.
- **History projection** — `web-chat-message-state.mapper` reads `metadata.toolInvocations` into `AssistantWebChatMessageState`, so web history can reconstruct specialized process badges after refresh.

### Verified

- Focused web: `corepack pnpm --filter @persai/web exec vitest run app/app/_components/chat-message.test.tsx --config vitest.config.ts` — PASS (55/55).
- Focused API: `corepack pnpm --filter @persai/api exec tsx --test test/persist-assistant-message.test.ts` — PASS.
- Focused API: `corepack pnpm --filter @persai/api exec tsx --test test/manage-web-chat-list.service.test.ts` — PASS (17/17).
- Focused API: `corepack pnpm --filter @persai/api exec tsx --test test/stream-web-chat-turn.service.test.ts` — PASS (15/15).
- Full requested AGENTS gate — PASS after applying Prettier to the changed files and rerunning `format:check`.

### Residuals / risks

- Existing historical messages without persisted `metadata.toolInvocations` still degrade to generic/text-only process rendering; the new specialized labels apply to new messages and any replay/history rows that carry the new metadata key.
- `billingFacts` remains available for internal ledger paths before persistence, but is intentionally stripped from assistant message metadata and client transports.

### Files

- modified: `apps/web/app/app/_components/chat-message.tsx`, `apps/web/app/app/_components/chat-message.test.tsx`, `apps/web/messages/ru.json`, `apps/web/messages/en.json`, `apps/api/src/modules/workspace-management/application/persist-assistant-message.ts`, `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`, `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`, `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts`, `apps/api/src/modules/workspace-management/application/web-chat-message-state.mapper.ts`, `apps/api/src/modules/workspace-management/application/web-chat.types.ts`, `apps/api/test/persist-assistant-message.test.ts`, `apps/api/test/stream-web-chat-turn.service.test.ts`, `apps/api/test/manage-web-chat-list.service.test.ts`, `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`.
- added: `apps/api/src/modules/workspace-management/application/strip-tool-invocations-for-client.ts`.

### Next recommended step

1. Run the full requested AGENTS gate in order, then orchestrator review/commit/push.
2. Deploy API + web to `persai-dev` and live-validate: committed long content + process badge placement, female-assistant RU passive labels, and specialized `Найдено · N источников` labels after refresh/history replay.

---

## 2026-06-23 — Deferred-tail continuation + assistant working-content inline UI — CHECKPOINT

### State

Founder approved two bounded implementation slices on clean baseline `5f50fb17`, with no commit/push from the agent: Slice 2 softens the deferred media/document developer tail without weakening ADR-105 pending-delivery honesty, and Slice 6 replaces the web assistant working-notes "done" disclosure with a hybrid content/process rendering pattern.

### What changed

- **`apps/runtime/src/modules/turns/turn-execution.service.ts`** — deferred media/document follow-up instructions no longer say "Write only a brief acknowledgement". They still forbid claiming final media/documents are ready/visible/attached/sent, still forbid raw tool JSON/job ids/imagined result details, and document jobs still forbid `files.send`; the tail now explicitly allows the model to continue independent same-turn work, advance plan steps, call other tools, or queue additional background jobs without waiting for user confirmation between independent jobs.
- **Runtime tests** — `deferred-media-acknowledgement.test.ts` and `deferred-document-acknowledgement.test.ts` pin the new permissive wording plus preserved honesty guardrails and absence of the old "Write only..." phrase. The document test fixture was also corrected to pass `availableWorkingFileRefs` before `currentDeferredDocumentJobs`, matching the current `executeProjectedToolCall` signature and unblocking the existing pending-document guard tests.
- **`apps/web/app/app/_components/chat-message.tsx`** — removed the collapsed `WorkingTextBlocks` pattern. Assistant intermediate output now rebuilds iteration order from `workingNotes[i]` and `toolInvocations[iteration]`: structural markdown (tables, headings, fenced code, lists of 3+ items) renders inline as normal assistant markdown; short process text/tools group into collapsed Cursor-style process badges with adaptive labels for search, image generation, page reads, or generic worked steps. Final `answerText` still renders inline.
- **Web plumbing/i18n/tests** — `ChatMessage`/web client types now carry optional `toolInvocations` when the server provides them; history without tool metadata degrades to text-only process/content handling. Added ru/en `chat.processBadge.*` labels and removed now-unused `workingNotesDone` / `workingNotesDuration` keys. `chat-message.test.tsx` now covers table/list/heading content, process-only notes, tools-only badges, mixed ordering, empty-note skipping, final-answer inline rendering, expansion contents, and empty-message behavior.

### Verified

- Full requested AGENTS gate PASS in order: runtime lint, runtime typecheck, api typecheck, web typecheck, web lint, format check, runtime isolated suite via `tsx test/run-suite-isolated.ts`, and full web test suite.
- Focused checks also passed: deferred media acknowledgement, deferred document acknowledgement, and `chat-message.test.tsx`.

### Residuals / risks

- Web history can only interleave tool badges when `toolInvocations` is present in the message payload. Older/persisted messages that only carry `workingNotes` still render content inline or process text badges, but cannot reconstruct missing tool rows without an API persistence slice.
- No runtime/api/contract/Prisma changes were made for Slice 6; no queue/cap/completion-turn/system-reminder scope was touched.

### Files

- modified: `apps/runtime/src/modules/turns/turn-execution.service.ts`, `apps/runtime/test/deferred-media-acknowledgement.test.ts`, `apps/runtime/test/deferred-document-acknowledgement.test.ts`, `apps/web/app/app/_components/chat-message.tsx`, `apps/web/app/app/_components/chat-message.test.tsx`, `apps/web/app/app/_components/use-chat.ts`, `apps/web/app/app/assistant-api-client.ts`, `apps/web/messages/en.json`, `apps/web/messages/ru.json`, `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`.

### Next recommended step

1. Orchestrator review, commit, push, then deploy runtime + web to `persai-dev`.
2. Live-validate two flows: deferred media/document job followed by additional independent tool/plan work in the same turn; and assistant intermediate content with tables/lists/headings rendering inline while short process/tool-only steps collapse into badges.

---

## 2026-06-22 — ADR-125 Amendment 3: post-final self-check hop — CHECKPOINT

### State

Founder pointed out three ADR-125 gaps from live chat evidence on 2026-06-22: completed-only plan windows suppressed scenario re-intake because the prompt window includes two recent completed rows; fully completed active scenarios had no release pressure; and a final assistant reply could land beside an open plan card after substantive tool work. Scope is implementation-only under ADR-125 Amendment 3: no server-side auto-release, no `toolMutatesVolatilePrefix` expansion, no new flags.

### What changed

- **`apps/runtime/src/modules/turns/build-system-reminder-blocks.service.ts`** — scenario intake suppression now checks only open rows (`pending` / `in_progress`), so completed-only windows no longer block re-intake. Added a sixth reminder class, scenario completion/release, emitted after chat-plan lifecycle and before budget warnings when an active scenario has an all-completed plan window. It includes the scenario `exitCondition` (capped at 300 chars), instructs the model to call `skill({action:"release"})`, or add fresh `todo_write` rows if the user's new request continues the same scenario.
- **`apps/runtime/src/modules/turns/turn-execution.service.ts`** — `PreparedTurnExecution` now carries `selfCheckHopsRemaining = 2`. Sync and streaming finalization run a guarded post-final self-check after existing assistant-text corrections and before `finalizeAcceptedTurnWithPostTurnEffects`: fresh plan read, open-row check, substantive-work check excluding pure `todo_write`, one non-streaming provider self-check call, optional todo_write-only reconciliation via the existing tool dispatcher, then one final text call. Non-`todo_write` follow-up tools are rejected and logged; exceptions warn and fall back to the original final text. Streaming emits an extra visible text delta when self-check replaces the final text.
- **Tests** — `apps/runtime/test/build-system-reminder-blocks.service.test.ts` now covers completed-only intake, pending/in_progress suppression controls, release reminder presence/absence, exit-condition truncation, and empty-vs-completed ordering. `apps/runtime/test/turn-execution.service.test.ts` adds the ADR-125 Amendment 3 integration block (self-check fires, clean-plan skip, no-substantive-work skip, todo_write reconcile, non-todo rejection, exception fallback, no recursive self-check).
- **Docs** — ADR-125 now has Amendment 3, and this checkpoint plus `docs/CHANGELOG.md` record the cut.

### Verified

- Focused: `corepack pnpm --filter @persai/runtime exec tsx test/build-system-reminder-blocks.service.test.ts` PASS.
- Focused: `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts` PASS.
- Full AGENTS gate for this slice is pending below.

### Residuals / risks

- The self-check is one model-owned recovery opportunity, not deterministic server reconciliation. If the model chooses a one-line clarification instead of `todo_write`, the plan may remain open by design.
- Completed-only active scenario windows now produce both the intake and release/add guidance: intake enables fresh same-scenario planning; release makes the close-out imperative explicit.
- No DB schema, no provider contract, no new feature flag, no auto-`skill.release`.

### Files

- modified: `apps/runtime/src/modules/turns/build-system-reminder-blocks.service.ts`, `apps/runtime/src/modules/turns/turn-execution.service.ts`, `apps/runtime/test/build-system-reminder-blocks.service.test.ts`, `apps/runtime/test/turn-execution.service.test.ts`, `docs/ADR/125-in-chat-todo-write-and-scenario-seeded-plan.md`, `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`.

### Next recommended step

1. Run the required AGENTS gate (`runtime` lint/typecheck, api/web typecheck, format, runtime isolated suite).
2. Orchestrator commit + push, then deploy to `persai-dev` and live-validate the carousel scenario: repeated scenario entry, all-completed release pressure, and post-tool open-plan self-check.

---

> Archive: handoff sections from 2026-06-06 and earlier moved to `docs/SESSION-HANDOFF.archive-2026-06-06-and-earlier.md`; 2026-05-19 and earlier remain in `docs/SESSION-HANDOFF.archive-2026-05-19-and-earlier.md`.
> Keep this file short: only the current active working set and immediate handoff.

## 2026-06-22 — Deferred-job assistant reply: model-owned text, normalization downgraded to fallback — CHECKPOINT

### State

Founder observation (2026-06-22, follow-up after ADR-125 A2 push): every deferred background job — `image_generate`, `image_edit`, `video_generate`, every `document` job — caused the runtime to **overwrite** the model's assistant text with a canonical "Запрос принят. Делаю изображение…" / "Request accepted. I am preparing the document…" line, both in the streaming web path and the sync TG path. This stripped legitimate explanations the model had already streamed (carousel brief, style choice, plan-step continuity), and was reported as "часто модель пишет объяснение а потом всё стирается и заменяется". Founder picked **A — slice now, no new ADR, calibration only**: keep the canonical line strictly as a fallback for the empty-reply case, preserve any non-empty model text verbatim.

### What changed

- **`apps/runtime/src/modules/turns/turn-execution.service.ts`** — `applyDeferredMediaAcknowledgementCorrection` and `applyDeferredDocumentAcknowledgementCorrection` now early-return the normalized model text when it is non-empty; the canonical "Запрос принят / Request accepted" lines apply only when the model produced nothing after the deferred job. The wrapper `applyAssistantTextCorrections` no longer threads `hadRejectedMediaRequest` because the same "non-empty wins" rule now covers the mixed accepted+rejected media case the old ADR-105 branch was guarding. The dead-stub `TurnExecutionState.hadRejectedMediaRequest` field, the write-only `markRejectedMediaRequestIfApplicable(...)` helper, and both call sites in `processToolOutcomeIntoTurnState` are removed cleanly (PersAI rule: "no dead stubs"). The same code path serves stream, sync, and Telegram — one fix, three surfaces.
- **`apps/runtime/test/deferred-media-acknowledgement.test.ts`** — three legacy tests rewritten and two new ones added: (1) the model's own deferred-media reply is preserved verbatim, (2) the rejection-explanation case still survives (now as the general non-empty branch), (3) empty text → canonical RU acknowledgement fallback, (4) whitespace-only text behaves identically to empty.
- **`apps/runtime/test/deferred-document-acknowledgement.test.ts`** — the single legacy "replaces false completion claims" test is replaced with three: preserve non-empty text verbatim, fallback canonical line on empty, whitespace-only safety.
- **`docs/TEST-PLAN.md`** — ADR-105 focused-checks bullet 5 rewritten to describe the model-owned-reply policy, the developer-tail honesty enforcement, and the empty-reply fallback. Removes the now-stale `hadRejectedMediaRequest` reference.

### Verified

- AGENTS gate: lint (5 packages) PASS · `format:check` PASS · api typecheck PASS · web typecheck PASS · runtime typecheck PASS.
- Full runtime suite: `corepack pnpm --filter @persai/runtime exec node --import tsx --test --test-concurrency=1 test/*.test.ts` — **239/241 PASS**.
- Both new media tests + both new document tests + the preserved-reply tests are green.

### Residuals / risks

- **2 pre-existing failures on `main` baseline (commit `4d9c2364`), unrelated to this slice:** `deferred-document-acknowledgement.test.ts > blocks files.send while a document from the same turn is pending delivery` and `> blocks files.write_and_send while a document from the same turn is pending delivery` both throw `TypeError: Cannot read properties of undefined (reading 'conversation')` from `TurnExecutionService.executeProjectedToolCall:3119` because their `acceptedTurn` stub does not include `session.conversation`, which a later `listAvailableWorkingFileRefs` call now reads. Reproduced cleanly on `git stash` before any of this slice's edits — surfaced here so a future small slice tightens the fixture (one-off field-level stub, no behavior change). Not blocking this slice per scope discipline.
- **Honesty risk** if the model claims "вот картинка / документ готов" while the job is async: the developer-tail `buildDeferredMediaFollowUpInstruction` / `buildDeferredDocumentFollowUpInstruction` and the global `DELIVERY_HONESTY_CONTRACT` already forbid this in prose, and the structural UI (pending pill → artifact arrives in a separate message) is the single source of delivery truth. Founder accepted this trade-off explicitly: "нормализация — это фалбэ".
- No new DB schema, no new tool, no contract change. Single code-path edit on the runtime side.

### Files

- modified: `apps/runtime/src/modules/turns/turn-execution.service.ts`, `apps/runtime/test/deferred-media-acknowledgement.test.ts`, `apps/runtime/test/deferred-document-acknowledgement.test.ts`, `docs/TEST-PLAN.md`, `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`.

### Next recommended step

1. Push → deploy to `persai-dev` → re-test the carousel scenario on `info@general-fly.com`: the model's own pre-tool explanation must survive end-to-end (web stream and TG); the canonical "Запрос принят…" line should appear only when the model returned empty text after the deferred job.
2. Optional cleanup slice for the 2 pre-existing fixture failures in `deferred-document-acknowledgement.test.ts` (just add `session.conversation` to the bare-service stub).

---

## 2026-06-22 — ADR-125 Amendment 2: mid-loop volatile-prefix refresh (same-turn intake) — CHECKPOINT

### State

Live trace of chat `web-1782153682653` (assistant `2f8cf38e-…`, founder query "проверь тут есть чат id?") showed Amendment 1 firing one turn late. Sequence:

| Turn | User → Assistant                                | Observation                                                                                              |
| ---- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1    | «Привет» → «Ну привет, Лёш…»                    | no scenario, no plan — OK                                                                                |
| 2    | «давай сделаем инстаграм карусель» → text reply | `skill.engage(scenarioKey="instagram_carousel")` ran INSIDE turn, but no `todo_write` — plan NOT created |
| 3    | «составь сам изучи persai.dev…» → text reply    | 5-row plan CREATED at 18:43:25, model now self-tracks                                                    |

Root cause: `prepareTurnExecution` builds the volatile prefix (`<persai_active_scenario>` + `<persai_chat_plan>` + `<system-reminder>` blocks) **once** from the `skillStateContext` snapshot taken at turn-prep. Any `skill.engage` / `skill.release` / `todo_write` call inside the tool loop mutated DB state, but the prompt the model saw on the next hop of that same turn still carried the stale prefix. Intake reminder thus arrived a turn late.

Founder picked **Slice now: рефреш `<system-reminder>` внутри turn loop после каждого tool_result**.

### What changed

- **`apps/runtime/src/modules/turns/turn-execution.service.ts`** — extended `PreparedTurnExecution` with three mutable per-turn fields (`volatilePrefixLength`, `currentSkillDecisionState`, `currentTurnHasUserAttachedImage`); new private helpers `refreshVolatilePrefix(execution, input, toolBudgetSnapshot)` (surgical prefix swap, preserves base history verbatim — no `buildMessages` round-trip), `maybeApplySkillStateMutationFromTool(execution, outcome)` (synthesizes new `RuntimeSkillDecisionState` directly from a `skill.engage`/`skill.release` outcome payload — no extra DB read), and `toolMutatesVolatilePrefix(toolName)` (true for `skill`, `todo_write`). Both `executeProviderToolLoop` (sync) and `streamAcceptedTurn` (streaming) now accumulate a `volatileRefreshNeeded` flag during the tool batch and call `refreshVolatilePrefix` before the next iteration's `buildToolLoopProviderRequest`. The durable-compaction refresh path also re-prepends the fresh volatile prefix instead of silently dropping it for the rest of the turn.
- **`apps/runtime/test/turn-execution.service.test.ts`** — new Test 3 in the ADR-119 Slice 5 reminder block: iteration 0 starts with no scenario → zero reminders; iteration 0 returns `skill.engage(scenarioKey)` → iteration 1's provider request now carries scenario tick + scenario-plan intake reminders (2 system_reminder messages). Required adding `skill` + `todo_write` policy entries to the test bundle's `governance.toolPolicies` (with save/restore around the test block) so the runtime actually projects the tools and dispatches them instead of returning `tool_not_projected`. Extended `FakePersaiInternalApiClientService` with `updateSkillState(...)` and `FakeTurnContextHydrationService.buildChatPlanBlock(...)` with a queued result list.
- **`docs/ADR/125-in-chat-todo-write-and-scenario-seeded-plan.md`** — status header bumped to "Amendment 2"; new "Amendment 2 — Mid-loop volatile-prefix refresh" section captures the live evidence, the cause analysis, the implementation cuts, and acceptance criteria.
- **`docs/CHANGELOG.md`** — new bullet under 2026-06-22 (see below).

### Verified

- AGENTS gate: lint (5 packages) PASS · `format:check` PASS · api typecheck PASS · web typecheck PASS · runtime typecheck PASS.
- `corepack pnpm --filter @persai/runtime run test` — full suite PASS (incl. the new ADR-125 Amendment 2 mid-loop case).

### Files

- modified: `apps/runtime/src/modules/turns/turn-execution.service.ts`, `apps/runtime/test/turn-execution.service.test.ts`, `docs/ADR/125-in-chat-todo-write-and-scenario-seeded-plan.md`, `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`.

### Residuals / risks

- Pending deploy + live re-validation on the same chat / same user: expect the model to now author `todo_write({action:"add", …})` in the same turn as the `skill.engage`, not the next one.
- No new DB schema, no new tool, no provider-contract change. The refresh is purely an in-memory prefix swap — cost is one `readChatPlanWindow` API call per tool batch that touched `skill` or `todo_write`.
- `<system-reminder>` ordering inside the loop matches the prep-path ordering (scenario tick → image → intake → lifecycle → budget); the only thing that changes is **when** the prefix is rebuilt.

### Next recommended step

1. Push → deploy to `persai-dev` → re-test "Привет → давай карусель" on `info@general-fly.com`. Acceptance: the plan must appear in the SAME turn where the model engages the scenario, not the next one.
2. If that passes, close ADR-125 in the next session (move from "Amendment 2: implemented" to "Implemented + live-validated").

---

## 2026-06-22 — ADR-126 Accepted (doc-only): unified sandbox workspace, bash default, expanded egress — CHECKPOINT

### State

After live validation on `info@general-fly.com` exposed three architectural mismatches with Claude-Code / Cursor agent semantics — (1) `files.write` and `shell` write to disjoint filesystems, (2) `/bin/sh` is dash so brace expansion / `[[ … ]]` / `pipefail` do not work, (3) the egress allowlist is LLM-host-only so `git clone` against public GitHub fails — founder approved opening **ADR-126** to lock the cutover terms BEFORE writing code (per `AGENTS.md`: "every architectural change requires an ADR when it changes long-term system truth"). All five Open Questions in the initial draft were resolved in the same 2026-06-22 founder-review session; the ADR's status is now **Accepted (doc-only)** with hard contracts on each decision. This session still ships only the ADR document; implementation lands in a follow-up program.

Also rolled in a UX micro-change discussed mid-session: the chat-header subtitle drops the explicit "СКИЛЛ" / "Skill" label — `Маркетолог · Карусель` is enough; the row position + typography already communicate the context. The `chat.activeSkillPrefix` i18n key is removed; chat-area tests adjusted; not yet pushed (waiting on this and the ADR to ride together once founder OKs).

### What changed

- **NEW: `docs/ADR/126-unified-sandbox-workspace-files-shell-single-fs-bash-default-and-expanded-egress.md`** (doc-only). Locks the cutover terms for D1–D4 (A+B+C+D the founder picked from the 2026-06-22 thread):
  - D1 / A — bash as `/bin/sh` for the `shell` tool (`{a,b,c}`, `[[ … ]]`, `pipefail` work natively).
  - D2 / B — Unified workspace FS: `files.write/read/list/preview` repointed at the assistant-`workspaceId` exec pod's `/workspace` via tiny control-plane primitives (mirrors the existing `grep`/`glob` "runs on the control plane, never spawns a model-visible shell" pattern from ADR-123 Slice 7). `assistant_files` retains a narrow role: chat input uploads (hydrated into `/workspace/input/<filename>` on first turn that needs them) + chat output artifacts (`document`/`image_generate` outputs). No transitional dual write — prod-first cutover per founder direction ("у меня реально комерческих user пока нет можно сделать сразу чисто").
  - D3 / C — Egress allowlist widens to GitHub + PyPI + npm (HTTPS pull/clone/fetch only). `git push` stays **denied in v1**; the proxy continues to block `POST` to `…/git-receive-pack`. ADR-123 D3 isolation/secret-free posture is preserved.
  - D4 / D — Exec image preinstalls `node` + `npm` (LTS line picked at sign-off, recommended 22); `pip install --user` and `npm install` ergonomics with session-scoped `/workspace/.local/` and `/workspace/.npm-global/`; tool catalog `modelUsageGuidance` for both `files` and `shell` rewritten to make the new workspace contract explicit to the model.
- Implementation plan sketched as a **4-slice program** (image / egress allowlist / files-contract rewrite + preview cache rekey / catalog + chat-uploads hydrate + plan-baseline 500 MB bump), each ending on the AGENTS gate, single push at the very end (mirrors ADR-123 program-style).
- Acceptance criteria list **13** live-`persai-dev` checks (incl. the founder's exact failure case from 2026-06-22: `files.write({path:"hello.txt"}) → shell({command:"cat hello.txt"})` must return the bytes; plus quota-exhaustion classification and preview cache invalidation).
- All 5 Resolved decisions (founder sign-off 2026-06-22):
  1. `git push` — denied in v1 (egress proxy blocks `POST` to `/git-receive-pack`); reopen is an explicit follow-up addendum, not a flag.
  2. Node 22 LTS — installed from NodeSource `setup_22.x`; matches the control-plane image's `node:22-bookworm-slim`.
  3. Git hosts in v1 — GitHub only; GitLab/Bitbucket deferred.
  4. Workspace cap stays plan-managed (existing `planCatalogPlan.billingProviderHints.quotaAccounting.workspaceStorageBytesLimit`, resolved into `bundle.governance.quota.workspaceQuotaBytes`); Slice 4 only bumps the per-plan **default** to 500 MB for any plan below that ceiling (data migration), via the same code path that already exists.
  5. `files.preview` cache repointed to `(assistantId, workspaceId, relPath, content_hash)` for `/workspace` paths; `fileRef`-keyed cache for outbound artifact previews (`document`, `image_generate`) is untouched.

### Files

`docs/ADR/126-unified-sandbox-workspace-files-shell-single-fs-bash-default-and-expanded-egress.md` (new), this checkpoint, `docs/CHANGELOG.md`. Plus the queued (not-yet-pushed) chat-header subtitle micro-change to `apps/web/app/app/_components/chat-area.tsx`, `apps/web/app/app/_components/chat-area.test.tsx`, `apps/web/messages/{ru,en}.json` (founder: "СКИЛЛ вообще удали просто — без него").

### Verified

- ADR-126 is doc-only — no AGENTS gate run required for the ADR itself.
- For the queued subtitle change: `@persai/web` typecheck PASS · chat-area suite 27/27 PASS.

### Residuals / risks

- **No code change yet for ADR-126.** Implementation is a separate program for a future session — see the 4-slice plan inside the ADR. The model still hits the unified-FS / dash / egress gaps in `persai-dev` between now and that landing.
- **No remaining Open Questions.** All 5 are resolved (see What changed §5). Any future deviation requires re-opening the corresponding question in a new ADR addendum, not a silent slice-level edit.
- **`git push` stays denied in v1.** Reopen would require an explicit follow-up addendum + threat-model update, not an implementation tweak.
- **No live regression introduced.** All sandbox behavior remains as ADR-123 left it; the ADR only enumerates what changes when we cut over.

### Next recommended step

1. Founder dispatches the implementation program (4 slices, single push at end, AGENTS gate per slice) in a separate session.
2. Slice 1 is "image: bash + Node 22 + path/dotfile defaults" — smallest, lowest risk, validates the bash semantics fix and Node LTS pin in isolation.
3. The queued chat-header "СКИЛЛ" removal rides on the next push together with the ADR-126 doc landing and anything else that lands in the meantime.

---

## 2026-06-22 — ADR-125 follow-up: scenario plan-intake `<system-reminder>` (Option A first-move nudge) — CHECKPOINT

### State

After Option A + the chat-plan lifecycle reminder landed earlier today, founder live-validated user `info@general-fly.com` and reported a regression: the model **did not** spontaneously author the plan after `skill.engage` — it ran the scenario and only created todos after the explicit nudge "Почему ты не сделал todo". DB inspection in `persai-dev` confirmed: the bundle has `PLAN INTAKE` (in `skill.modelUsageGuidance`) and `SCENARIO INTAKE` (in `todo_write.modelUsageGuidance`) baked in via the deployed catalog seed, but tool-descriptor guidance alone is too low-priority — it gets reread once and then dwarfed by the rolling user-message context. We need a per-turn nudge focused on this exact moment.

### What changed

- **`apps/runtime/src/modules/turns/build-system-reminder-blocks.service.ts`** — added a **fifth reminder class** "Scenario plan intake" (slotted between reminder #2 image and reminder #3 chat-plan lifecycle). Fires when:
  - `skillDecisionState` reports an active skill + active scenario, AND
  - the scenario resolves in the bundle (graceful degradation if the bundle is missing the row), AND
  - the windowed chat plan is empty (`chatPlanTodos === null || .length === 0`).
    The reminder names the scenario, embeds the actual `scenario.steps` list (titles derived from each `directive`, truncated to ≤80 chars with sentence-boundary preference, capped to the first 12 steps with a "…and N more — include every step in the add call" trailer if longer), demands `todo_write({action:"add", items:[…]})` as the VERY NEXT action with `first item status:"in_progress", every other item status:"pending"`, and reminds the model that "the scenario IS the plan — do not skip this even if the user has not asked for a plan". Helper `deriveStepTitle` handles the truncation. `resolveScenario` return type tightened from `{displayName; steps: unknown[]}` to `RuntimeBundleSkillScenario | null` so the new code can read step shape safely.
- **No changes to `turn-execution.service.ts` / `turn-context-hydration.service.ts`.** The new reminder rides the same `chatPlanTodos` payload the lifecycle reminder already consumes — zero new fan-out, zero new round-trip.
- **Tests.** `apps/runtime/test/build-system-reminder-blocks.service.test.ts` grows from 17 to 26 cases. New cases (18–26): intake fires on empty plan + active scenario, treats `null` / absent `chatPlanTodos` as empty, is suppressed when plan has any row (even a single completed one), suppressed when scenario inactive, suppressed when scenario key unresolvable in bundle, truncates overlong directives, trails many-step scenarios with "…and N more", remains byte-stable across invocations. Existing scenario-active cases (2, 3, 4, 9, 10) updated to pass a single completed `SILENT_PLAN` todo so the intake reminder stays suppressed where the test focuses on reminders 1/2/4/5.
- **ADR-125 `Amendment 1`** appended: explicitly captures the live regression motivation, the system-reminder design, and the acceptance criteria for both the empty-plan branch (intake) and the populated-plan branches (lifecycle).

### Files

`apps/runtime/src/modules/turns/build-system-reminder-blocks.service.ts`, `apps/runtime/test/build-system-reminder-blocks.service.test.ts`, `docs/ADR/125-in-chat-todo-write-and-scenario-seeded-plan.md`, this checkpoint + `docs/CHANGELOG.md`.

### Verified

- focused: `corepack pnpm --filter @persai/runtime exec tsx test/build-system-reminder-blocks.service.test.ts` PASS (26 cases)
- related: `tsx test/turn-execution.service.test.ts`, `tsx test/turn-context-hydration.service.test.ts` PASS
- full AGENTS gate scheduled below (lint × all packages + format:check + typecheck × 4 + repo tests)

### Residuals / risks

- **Recency bias by design.** The intake reminder is injected into the volatile tail of the cache prefix exactly so the model sees it last before its own generation — same envelope as the active-scenario tick / chat-plan lifecycle / budget reminders. Cost: zero extra round-trip.
- **Suppression is precise.** The moment the model authors even one row, the intake reminder falls silent and the chat-plan lifecycle reminder takes over for the rest of the plan's life.
- **Graceful degradation.** If a scenario key is in the decision state but the bundle has no matching row (stale apply, deleted scenario), the intake reminder stays silent — same behaviour as the active-scenario tick. We never reference a scenario the model can't see.
- **Live next.** Push → deploy → re-run the `info@general-fly.com` carousel scenario from a fresh chat and verify the model authors the plan on the very next turn after `skill.engage`. If the model still stalls, the next escalation is a hard tool-choice hint on the engage-turn (force `todo_write` as the next-tool candidate), but that's out of scope for this slice.

---

## 2026-06-22 — ADR-125 follow-up: per-turn `<system-reminder>` plan-lifecycle nudge — CHECKPOINT

### State

After the Option A pivot landed, founder asked for the Claude-Code / Cursor-style per-turn nudge that closes the residual gap: "model did the work, but didn't call `todo_write` to mark it done". Their recipe is **not** an extra LLM round-trip — it's a short `<system-reminder>` injected into the same volatile-context rail that already carries the chat-plan and active-scenario blocks (the place where short-term memory used to live before ADR-118 pull-only recall). Zero extra cost, runs every turn while the plan is open, vanishes the moment the plan is finished.

### What changed

- **`apps/runtime/src/modules/turns/build-system-reminder-blocks.service.ts`** — added a fourth reminder class **chat-plan lifecycle** to the existing `BuildSystemReminderBlocksService`. Three branches:
  - any windowed todo with `status === "in_progress"` → reminder names that row (id + truncated title) and demands `todo_write({action:"complete", id:"<id>"})` BEFORE the assistant text reply, with explicit "do not batch completions" line;
  - else first `pending` row exists → reminder names the first pending row, includes pending count, and demands `todo_write({action:"update", id:"<id>", status:"in_progress"})` BEFORE substantive work, with explicit one-in_progress-per-parent reminder;
  - else (every windowed row is `completed`, or no plan) → no reminder emitted. The plan card / `<persai_chat_plan>` block continues to render as before — silence here means "model has nothing to do for the plan this turn".
    Long titles are truncated to ≤140 chars with an ellipsis so the reminder stays compact and stable across recency-bias evictions.
- **`apps/runtime/src/modules/turns/turn-context-hydration.service.ts`** — `buildChatPlanBlock` now returns `{ block, todos } | null` instead of just the block. This is the cheapest possible wiring: the chat-plan lookup already loads the windowed rows for rendering, so the reminder can derive its state from the same payload with zero extra round-trips. JSDoc updated.
- **`apps/runtime/src/modules/turns/turn-execution.service.ts`** — call-site destructures the new shape (`chatPlan` instead of `chatPlanBlock`), pushes `chatPlan.block` into `volatilePrefix`, and passes `chatPlanTodos: chatPlan?.todos ?? null` into `BuildSystemReminderBlocksService.buildBlocks`. No new injections, no new services — the reminder rides the existing per-turn pipeline.
- **Tests.** `apps/runtime/test/build-system-reminder-blocks.service.test.ts` extends from 11 to 17 cases:
  - case (8) "stable ordering" upgraded to assert the new order scenario → image → **chat-plan** → budget (alphabetical by tool), with chat-plan todos supplied;
  - (12) `in_progress` branch — reminder names id + title, contains `todo_write({action:"complete", id:"…"})`, "BEFORE writing your reply" + "Do not batch completions";
  - (13) only pending — reminder names first pending row + pending count, contains `todo_write({action:"update", id:"…", status:"in_progress"})`, "BEFORE substantive work" + "one in_progress sibling per parent";
  - (14) every row completed → no reminder;
  - (15) `null` / `undefined` / `[]` todos → no reminder;
  - (16) overlong content → title in reminder ≤140 chars, ends with "…";
  - (17) chat-plan reminder fires even when no scenario is active (the nudge is independent of skill/scenario state).

### Files

`apps/runtime/src/modules/turns/build-system-reminder-blocks.service.ts`, `apps/runtime/src/modules/turns/turn-context-hydration.service.ts`, `apps/runtime/src/modules/turns/turn-execution.service.ts`, `apps/runtime/test/build-system-reminder-blocks.service.test.ts`, this checkpoint + `docs/CHANGELOG.md`.

### Verified

- `corepack pnpm --filter @persai/runtime run typecheck` PASS
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm -r --if-present run lint` PASS
- `corepack pnpm run format:check` PASS
- `corepack pnpm --filter @persai/runtime run test` — full isolated suite PASS (incl. `runBuildSystemReminderBlocksServiceTest`, `runChatPlanBlockTest`, `runRuntimeSkillToolServiceTest`, all 47+ TurnExecution scenarios)

### Residuals / risks

- **Zero extra LLM cost.** The reminder rides the existing per-turn volatile_context payload. No new round-trip, no new provider call.
- **Recency bias by design.** The reminder is injected into the volatile tail of the cache prefix exactly so the model sees it last before its own generation — same place where the active-scenario tick and image-reference reminders already live. This is the Claude-Code / Cursor pattern.
- **No risk of double-prompting** — `<persai_chat_plan>` carries the plan data, the reminder carries the imperative. They are different tags (`<persai_chat_plan>` vs `<system-reminder>`) so the model treats them as separate signals.
- **No reminder on completed-plan tail** — by design. Stale reminders ("everything is done") would pollute every subsequent turn until the user explicitly clears the plan. Silence is the right behaviour.
- **Production safety** — provider clients already wrap `volatileKind: "system_reminder"` content with `<system-reminder>…</system-reminder>` for OpenAI / Anthropic / DeepSeek (existing ADR-119 Slice 5 plumbing). No provider-client changes required.

### Next recommended step

Watch the dev image publish job from this commit. After persai-dev repins runtime:

1. open a chat, `skill engage <marketer / instagram_carousel>` — model adds the plan (Option A), reminder appears in the next turn pointing at the first `in_progress` row.
2. let the model complete step 1's substantive work but _not_ call `todo_write` complete — observe whether the next turn's reminder (because `in_progress` still points at step 1 in the new turn's plan view) successfully nudges the model to close step 1 before continuing. The whole experiment is designed to verify the `in_progress` branch.
3. once all rows are completed, confirm no `<system-reminder>` for the plan appears in the next turns (silence on a finished plan). Plan card on the web still shows the completed list until the user clicks the trash button.

## 2026-06-22 — ADR-125 Option A: model-authored scenario intake + plan-card polish — CHECKPOINT

### State

After live validation of the scenario-seeded plan path, the model kept "narrating" scenario steps instead of progressing them: it read the seeded rows in `<persai_chat_plan>`, walked the user through them in chat, but never called `todo_write({action:"update", status:"in_progress"})` / `action:"complete"` on the seeded ids — even with the explicit `SCENARIO_SEEDED LIFECYCLE` clause in the tool guidance. The failure mode is a known self-attribution issue: assistants reliably progress todos they themselves authored and routinely ignore externally-seeded ones. Founder approved a clean pivot to **Option A** — the server no longer materialises scenario steps as todos; instead, `skill.engage` returns the scenario's steps verbatim and the model is instructed to call `todo_write({action:"add", items:[...]})` itself as its very next turn. The plan becomes model-authored from the first move, which is the regime Claude/Cursor-style agents naturally progress.

Three additional follow-ups landed in the same slice:

- the disappearing "Маркетолог · Карусель" chat-header subtitle (caused by message-reconstruction dropping per-message `engagementSummary` on history reload) is now backed by a chat-level `currentEngagement` field on the history endpoint, so the chip reads truth on every reload;
- the redundant per-message `engagementSummary` chip inside the working-notes toggle row was removed (the header subtitle is now the canonical place);
- the plan card got the requested polish: trash button on a fully-completed plan deletes without confirmation, desktop banner width matches the chat zone (`max-w-[50rem]`), mobile is flush-to-edges with a hairline divider, desktop carries a quieter `color-mix()` background with no shadow.

### What changed

- **`packages/runtime-contract/src/index.ts`** — dropped `PERSAI_RUNTIME_TODO_WRITE_ORIGINS` / `PersaiRuntimeTodoWriteOrigin` and the `origin` + `seedSkillLabel` fields on `RuntimeTodoItem`. The plan rendering is now origin-agnostic everywhere downstream.
- **`apps/api/prisma/schema.prisma` + `apps/api/prisma/migrations/20260622180000_adr125_drop_scenario_seeding/migration.sql`** — dropped `AssistantChatTodoOrigin` enum, `origin / seed_skill_id / seed_skill_label / seed_scenario_key / seed_key` columns, and the `assistant_chat_todos_chat_id_seed_key_idx` partial index. The migration is data-safe: previously-seeded rows keep their content/status/sort order and continue to render in the plan card.
- **`apps/api/src/modules/workspace-management/application/assistant-chat-todos.service.ts`** — removed `seedSkillScenarioTodos`, the `deriveScenarioStepTitle` helper, and the `origin`/`seedSkillLabel` projection on todos. `readWindow` / `readFullPlanForWeb` semantics are unchanged for non-seeded rows.
- **`apps/api/src/modules/workspace-management/interface/http/internal-runtime-chat-todos.controller.ts`** — deleted the `/seed-skill-scenario` endpoint and all request/response handlers; only the model-owned `apply` / `read` endpoints remain.
- **`apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts`** + **`…/interface/http/assistant.controller.ts`** — the chat-messages history endpoint now returns a chat-level `currentEngagement: { skillDisplayName, scenarioDisplayName } | null` derived from `chat.skillDecisionState` via the existing `deriveEngagementSummary` projection. This is the truth the web header subtitle reads on every reload.
- **`apps/api/prisma/tool-catalog-data.ts`** — `skill.modelUsageGuidance` gains a `PLAN INTAKE` section instructing the model to follow every `action:"engage"` that returns a scenario with a single `todo_write({action:"add", items:[...]})` call mirroring the scenario's steps (first row `in_progress`, the rest `pending`). `todo_write.modelUsageGuidance` replaces the obsolete `SCENARIO_SEEDED LIFECYCLE` clause with a generic `SCENARIO INTAKE` + `LIFECYCLE` pair that explains the same regime: the model owns every row, switch to `in_progress` before working, `action:"complete"` before moving on, never leave a finished step at pending.
- **`apps/runtime/src/modules/turns/runtime-skill-tool.service.ts`** — removed the `seedScenarioTodosAfterEngage` call and helper. The `skill.engage` response still includes the scenario object as before, but the runtime no longer mutates the todos table on engage; the model does that itself via `todo_write` on its next turn.
- **`apps/runtime/src/modules/turns/persai-internal-api.client.service.ts`** — deleted `seedSkillScenarioTodos` and its parser/types. Internal API surface from runtime → API is strictly the model-owned `apply`/`read` endpoints now.
- **`apps/runtime/src/modules/turns/turn-context-hydration.service.ts`** — `renderChatPlanBlock` no longer emits the `// Rows tagged (seeded by …) …` lifecycle hint or the `(seeded by <label>)` suffix on plan rows. The block is now a flat plan with `— by id <id>` ids and status badges only.
- **`apps/web/app/app/_components/chat-plan-card.tsx`** — dropped all `origin`/`seedSkillLabel` rendering; new visual: mobile flush (no rounded corners, hairline divider top + bottom), desktop semi-transparent `color-mix()` background with no shadow, content `max-w-[50rem]` to match the chat zone, quieter status icons / typography. When `allDone === true`, the trash button deletes immediately without the confirmation row (`planClearConfirmPrompt` was a noise sink for a plan the user already considers closed).
- **`apps/web/app/app/_components/use-chat.ts`** — `ChatMessage.engagementSummary` is gone. `useChat` now holds a chat-level `currentEngagement` state populated from (a) the history endpoint's new chat-level field on load, (b) the SSE turn-completion payload on each turn. `loadHistory` reads `page.currentEngagement`; the SSE handler writes `transport.engagementSummary` straight into `currentEngagement` instead of re-deriving it from messages.
- **`apps/web/app/app/_components/chat-area.tsx`** — `activeSkillEngagement` reads `chat.currentEngagement` directly. The `ChatPlanCard` wrapper switched to `max-w-[50rem]` with mobile-flush / desktop-banner classes per the new design.
- **`apps/web/app/app/_components/chat-message.tsx`** — removed the per-message `engagementSummary` chip from `WorkingTextBlocks`; the chat header subtitle is the canonical surface.
- **`apps/web/app/app/assistant-api-client.ts`** — `getChatMessages` return type now exposes the optional `currentEngagement` field.
- **`apps/web/messages/{ru,en}.json`** — removed the orphan `chat.planSeededFrom` / `chat.planSeededFromGeneric` keys.
- **Tests.**
  - `apps/api/test/assistant-chat-todos.service.test.ts` — removed all `testSeedSkillScenario*` cases, the `FakeTodoRow` seed/origin fields, and the `findFirst({seedKey})` path.
  - `apps/api/test/tool-catalog-data.test.ts` — replaced the `SCENARIO_SEEDED LIFECYCLE` pin with the `SCENARIO INTAKE` + `LIFECYCLE` pins, and added a new pin asserting `skill.modelUsageGuidance` carries the `PLAN INTAKE` section + the literal `todo_write` reference.
  - `apps/runtime/test/runtime-skill-tool.service.test.ts` — removed `FakeInternalApi.seedScenario*` state, all seed-call assertions, and the seed-related happy/error test cases.
  - `apps/runtime/test/turn-context-hydration.service.test.ts` — dropped the `scenario_seeded` lifecycle-hint assertions and the seed-suffix expectations.
  - `apps/runtime/test/runtime-todo-write-tool.service.test.ts` — removed `origin` / `seedSkillLabel` from the mock todo row data.
  - `apps/web/app/app/_components/chat-plan-card.test.tsx` — dropped the `scenario_seeded` badge / generic-fallback cases, added a case asserting the trash button on a fully-completed plan deletes immediately.
  - `apps/web/app/app/_components/chat-area.test.tsx` — `chat-header subtitle` cases switched from per-message `engagementSummary` fixtures to the chat-level `currentEngagement` field.
  - `apps/web/app/app/_components/chat-message.test.tsx` — collapsed the per-message engagement-annotation cases into one pinning that the block row never renders an engagement annotation.
  - `apps/web/app/app/_components/use-chat.test.tsx`, `apps/web/app/app/assistant-api-client.test.ts` — dropped `origin`/`seedSkillLabel` from todo fixtures.

### Files

`packages/runtime-contract/src/index.ts`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260622180000_adr125_drop_scenario_seeding/migration.sql`, `apps/api/prisma/tool-catalog-data.ts`, `apps/api/src/modules/workspace-management/application/assistant-chat-todos.service.ts`, `apps/api/src/modules/workspace-management/interface/http/internal-runtime-chat-todos.controller.ts`, `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts`, `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts`, `apps/runtime/src/modules/turns/runtime-skill-tool.service.ts`, `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts`, `apps/runtime/src/modules/turns/turn-context-hydration.service.ts`, `apps/web/app/app/_components/chat-plan-card.tsx`, `apps/web/app/app/_components/use-chat.ts`, `apps/web/app/app/_components/chat-area.tsx`, `apps/web/app/app/_components/chat-message.tsx`, `apps/web/app/app/assistant-api-client.ts`, `apps/web/messages/ru.json`, `apps/web/messages/en.json`, the matching test files listed above, this checkpoint + `docs/CHANGELOG.md`.

### Verified

- `corepack pnpm --filter @persai/runtime-contract run typecheck` PASS
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/runtime run typecheck` PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm -r --if-present run lint` PASS
- `corepack pnpm run format:check` PASS
- `corepack pnpm --filter @persai/api exec tsx test/assistant-chat-todos.service.test.ts` PASS
- `corepack pnpm --filter @persai/api exec tsx test/tool-catalog-data.test.ts` PASS
- `corepack pnpm --filter @persai/api exec tsx test/engagement-summary.derivation.test.ts` PASS (8/8)
- `corepack pnpm --filter @persai/runtime run test` PASS (full isolated suite incl. `runRuntimeSkillToolServiceTest`, `runChatPlanBlockTest`, `runRuntimeTodoWriteToolServiceTest`)
- `corepack pnpm --filter @persai/web exec vitest run chat-plan-card.test.tsx` — 15/15 PASS
- `corepack pnpm --filter @persai/web exec vitest run chat-area.test.tsx` — 27/27 PASS
- `corepack pnpm --filter @persai/web exec vitest run chat-message.test.tsx` — 40/40 PASS
- `corepack pnpm --filter @persai/web exec vitest run use-chat.test.tsx` — 86/86 PASS
- `corepack pnpm --filter @persai/web exec vitest run assistant-api-client.test.ts` — 69/69 PASS

### Residuals / risks

- **Migration is destructive on attribution columns.** Existing rows lose their `origin` / `seed_*` provenance. Content/status/sort/parent linkage are preserved, so the plan card and `<persai_chat_plan>` block still render every row; the model just sees a flat plan instead of "(seeded by Marketer)". This is exactly the intended Option A regime — no per-row rollback path is needed.
- **Migration approval.** Prisma/schema/migration changes pause `Dev Image Publish` on the `persai-dev-migrations` GitHub Environment per AGENTS truth — the migration must be approved before GitOps tag pinning resumes.
- **Web SSE payload still carries `engagementSummary` per turn.** That is the existing wire shape; the client just routes it to chat-level `currentEngagement` now instead of stamping each message. No protocol change needed.
- **Skill engagement on first turn.** In Option A, the very first model turn after `skill.engage` is expected to call `todo_write({action:"add", …})` with the scenario steps. If the model skips that call, the plan card simply stays empty until the model adds rows itself — there is no fallback server seeding. This is by design (the whole point of the pivot), but worth observing on the first live engage after deploy.

### Next recommended step

Watch the `Dev Image Publish` job that this commit triggers. After the migration is approved and `persai-dev` repins:

1. open a chat, `skill engage <marketer / instagram_carousel>` — confirm the model's next assistant turn opens with a `todo_write` adding the scenario's steps; the plan card should populate with the model's titles, first row `in_progress`, the rest `pending`.
2. walk through 2–3 scenario steps — confirm the model flips each row to `in_progress` before working and to `completed` before moving on, without manual prompting.
3. reload the chat history mid-engagement — confirm the chat-header subtitle (`Скилл · Маркетолог · Карусель`) survives the reload (this is the regression `currentEngagement` was added to fix).
4. complete the entire plan — confirm the trash button now deletes the plan card on the first click (no confirm prompt), and the empty card state is reached.

## 2026-06-22 — Chat-header active-skill subtitle (ADR-119 follow-up) — CHECKPOINT

### State

Founder feedback after the ADR-125 plan-card redesign: the previously-existing "right of «Выполнено»" engagement chip (skill / scenario) was no longer always discoverable, since it only renders inline with each assistant message's collapsed working-notes toggle. Founder asked for a persistent chat-level indicator under the chat title — small, non-noisy, length-bounded, mode icon retained on desktop. This slice adds that subtitle without growing the plain-chat mobile header.

### What changed

- **`apps/web/app/app/_components/chat-area.tsx`** — extracted the subtitle row that used to live inline into a new `ChatHeaderSubtitle` component. New chat-level state `activeSkillEngagement` is derived from the latest **committed** assistant message's `engagementSummary` (the API already populates that field from `chat.skillDecisionState`, so the chip clears the moment the model lands a release-turn). Behaviour matrix:
  - **Skill active** (any mode) → `<modeIcon?> SKILL · <skillDisplayName> · <scenarioDisplayName?>`. The mode icon stays on the left when `chatMode !== "normal"` so the existing premium signal isn't lost. Render is `inline-flex` on both mobile and desktop because the engagement is the live working context the user wants to see everywhere.
  - **Skill inactive, mode ≠ normal** → existing mode caption ("тщательнее, но дороже" / "глубокий анализ"), kept `hidden md:inline-flex` so the mobile header stays compact for plain non-normal chats (the right-side `Sparkles` chip already carries the signal there).
  - **Skill inactive, mode = normal** → nothing rendered (no change vs. before).
- **Truncation.** Skill+scenario text wrapped in a `truncate max-w-[10rem] md:max-w-[22rem]` span so the scenario half is what shrinks first under narrow widths, and the skill stays readable. Full untruncated text is on `title` for hover.
- **i18n.** New key `chat.activeSkillPrefix` — `Скилл` (ru) / `Skill` (en) — in both `apps/web/messages/ru.json` and `apps/web/messages/en.json`.
- **Tests.** `apps/web/app/app/_components/chat-area.test.tsx` gains a `chat-header subtitle` describe with five new cases: renders skill+scenario when `engagementSummary` is set, renders skill-only when no scenario, falls back to the mode caption when no skill, renders nothing for normal+no-skill, and keeps the mode icon visible alongside the skill chip when both signals coexist.

### Files

`apps/web/app/app/_components/chat-area.tsx`, `apps/web/app/app/_components/chat-area.test.tsx`, `apps/web/messages/ru.json`, `apps/web/messages/en.json`, this checkpoint + `docs/CHANGELOG.md`.

### Verified

- `corepack pnpm --filter @persai/web exec vitest run chat-area.test.tsx` — 27/27 PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm -r --if-present run lint` PASS
- `corepack pnpm run format:check` PASS

### Residuals / risks

- Web-only slice — no API/runtime/Prisma changes. New web image must be republished and pinned via the regular `pin-dev-values-tag` path (no migration gate involvement).
- The chip is derived from per-message `engagementSummary` which is always populated by the API when `chat.skillDecisionState.status === "active"`. If a future API change ever stopped emitting `engagementSummary` while the chat-level skill state stays active, the chip would silently disappear; the `engagement-summary.derivation.test.ts` API-side test still pins that behaviour.

### Next recommended step

Watch the `Dev Image Publish` run for the SHA produced by this commit. After persai-dev pins web:

1. open a chat, `skill engage <marketer / instagram_carousel>` — confirm a small `Скилл · Маркетолог · Карусель` line shows right under the chat title on both desktop and mobile.
2. switch the chat to Smart mode — confirm the `Sparkles` icon stays visible on the desktop subtitle alongside the skill chip.
3. ask the model to release the skill — confirm the subtitle row disappears the moment the release-turn is committed.

## 2026-06-22 — ADR-125 scenario step progression + full-plan web read — CHECKPOINT

### State

Two live regressions surfaced during the second ADR-125 chat-plan validation pass and were folded into a single follow-up slice:

1. **Model not progressing scenario_seeded rows.** With the model-prompt window `<persai_chat_plan>` shipping rows + ids, the model still treated the seeded rows as read-only narration: it walked through scenario steps in the chat but never called `todo_write({action:"update", status:"in_progress"})` / `action:"complete"` on the seeded ids. Cause: `todo_write.modelUsageGuidance` had no SCENARIO_SEEDED LIFECYCLE clause, and the `<persai_chat_plan>` body had no in-block reminder either. The model effectively had no instruction telling it that the `(seeded by …)` rows are mutable and that it owns their lifecycle.
2. **Web card surfacing "Plan 2/5 +3 more hidden" after the model completed all rows.** `selectChatPlanWindow` is the model-prompt window — it caps completed rows at "last 2 by `completedAt`" so the cached `<persai_chat_plan>` block stays cheap. The web `GET …/plan` endpoint was reusing that window, so once every seeded row was completed the UI showed only the last two with a "+3 more" tail — visually identical to "the plan is broken, 3 rows are stuck". The user-facing surface needs the **full** plan, the model surface keeps the tight window.

### What changed

- **`apps/api/prisma/tool-catalog-data.ts`** — `todo_write.modelUsageGuidance` now carries an explicit `SCENARIO_SEEDED LIFECYCLE:` section that names the `(seeded by …)` rows as model-owned, mandates `action:"update" status:"in_progress"` before substantive work and `action:"complete"` before moving on, repeats the one-`in_progress`-per-parent rule, and reminds the model that ids live in the `— by id <id>` tail of each `<persai_chat_plan>` row. The GOTCHAS block was also tightened to point at the same id source so the model has one canonical way to find an id.
- **`apps/runtime/src/modules/turns/turn-context-hydration.service.ts`** — `renderChatPlanBlock` now prepends a one-line `// …` instruction to the `<persai_chat_plan>` body whenever at least one `scenario_seeded` row is non-completed. The hint names the `(seeded by …)` tag, asks the model to switch the current row to `in_progress` before working on it and to complete it via `todo_write` before moving on. It is suppressed when no `scenario_seeded` row exists in window, or when every `scenario_seeded` row in window is already completed (so we don't pollute already-finished plans).
- **`apps/api/src/modules/workspace-management/application/assistant-chat-todos.service.ts`** — new `readFullPlanForWeb({chatId})` that returns up to `WEB_PLAN_RESPONSE_MAX = 50` rows in raw `sortOrder` order, exposing the real `totalCount` and a `windowed` flag only when the cap is tripped. `readWindow` is untouched and still used by the internal runtime endpoint that feeds the model prompt (`<persai_chat_plan>` and the `todo_write` response window).
- **`apps/api/src/modules/workspace-management/interface/http/assistant-chat-todos.controller.ts`** — `GET /api/v1/assistant/chats/web/:chatId/plan` switched from `readWindow` to `readFullPlanForWeb`, so the card now always sees every completed step. The DELETE handler is untouched.
- **Tests.** `apps/api/test/assistant-chat-todos.service.test.ts` got two new cases — one walks a 5-step plan to "all completed" and asserts that the model window collapses to 2 rows while `readFullPlanForWeb` returns all 5 in `sortOrder`, the other inserts 60 rows across two `add` calls and asserts the full-plan read flags `windowed: true` at the 50-row cap. `apps/runtime/test/turn-context-hydration.service.test.ts` extends `runChatPlanBlockTest` to assert the lifecycle hint appears when there is an open `scenario_seeded` row, and is suppressed both when no `scenario_seeded` row is present and when every `scenario_seeded` row is already completed. `apps/api/test/tool-catalog-data.test.ts` now pins the `SCENARIO_SEEDED LIFECYCLE` section and the `by id <id>` reference inside `todo_write.modelUsageGuidance` so future edits cannot quietly drop them.

### Files

`apps/api/prisma/tool-catalog-data.ts`, `apps/api/test/tool-catalog-data.test.ts`, `apps/runtime/src/modules/turns/turn-context-hydration.service.ts`, `apps/runtime/test/turn-context-hydration.service.test.ts`, `apps/api/src/modules/workspace-management/application/assistant-chat-todos.service.ts`, `apps/api/src/modules/workspace-management/interface/http/assistant-chat-todos.controller.ts`, `apps/api/test/assistant-chat-todos.service.test.ts`, this checkpoint + `docs/CHANGELOG.md`.

### Verified

- `corepack pnpm --filter @persai/api exec tsx test/tool-catalog-data.test.ts` PASS
- `corepack pnpm --filter @persai/api exec tsx test/assistant-chat-todos.service.test.ts` PASS (new full-plan + overflow tests included)
- `corepack pnpm --filter @persai/runtime exec tsx test/run-suite-isolated.ts` PASS (chat-plan-block lifecycle hint covered)
- `corepack pnpm --filter @persai/web exec vitest run chat-plan-card.test.tsx use-chat.test.tsx assistant-api-client.test.ts` PASS (171/171)
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/runtime run typecheck` PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm -r --if-present run lint` PASS
- `corepack pnpm run format:check` PASS

### Residuals / risks

- The `todo_write.modelUsageGuidance` text is now ~3.5kB. Because `native-tool-projection` caps the projected schema description at 1024 chars (Anthropic limit) and the guidance preamble already exceeds that, the SCENARIO_SEEDED LIFECYCLE clause is truncated out of the JSON-schema description sent to providers — exactly like every other GOTCHAS block on every other tool. The actionable nudge for the model is the in-prompt `<persai_chat_plan>` hint, which is delivered every turn via `volatile_context` and is not subject to the schema cap. Admins viewing the catalog (or any future surface that reads `modelUsageGuidance` whole) still see the full instruction.
- Web-only surface change for the controller swap — no Prisma changes, no migration. Both api and web images need to be rebuilt and pinned together: api for the new read path + the catalog text, web for nothing new yet but the image must be in sync if rebuilt by the same publish run.

### Next recommended step

Watch the `Dev Image Publish` run for the SHA produced by this commit. After persai-dev pins both api and web:

1. open a fresh chat and `skill engage` a scenario with ≥3 steps — confirm the assistant marks step 1 in_progress before working on it, completes step 1 before opening step 2, and so on (look at the chat plan card live as the model speaks);
2. let the model run the scenario to "all done" — the card must read `5/5` (not `2/5 +3 more`) with every row visibly checked off in the expanded body;
3. confirm `<persai_chat_plan>` in the prompt cache logs carries the `// Rows tagged (seeded by …)…` lead line only while at least one scenario_seeded row is still open.

## 2026-06-22 — ADR-125 plan card redesign (sticky-top, collapsed-by-default, current-task preview) — CHECKPOINT

### State

UX/visual redesign of the in-chat plan card landed on top of `bf37c2ed`. Founder feedback was that the previous card sat above the composer, was always expanded by default, and looked too heavy. The redesigned card now magnetizes to the top of the chat scroll zone (sticky), uses a premium frosted-glass surface, opens collapsed by default with a one-line preview of the current task, and follows the established Cursor / Linear pattern (status icon → title → counts → "·" → current-task preview → chevron). All local gates green.

### What changed

- **Position.** `<ChatPlanCard>` moved from above `<ChatInput>` to inside the chat scroll container as a `sticky top-2 z-20` overlay, centred under the existing `max-w-3xl` column. The card now stays visible while the user scrolls the conversation, and the chat input row is no longer pushed up by it.
- **Premium surface.** `rounded-xl` + `border-border/40` + `bg-bg/85` with `backdrop-blur-xl backdrop-saturate-150` (and a `supports-[backdrop-filter]:bg-bg/70` fallback). Soft layered shadow `shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_20px_-12px_rgba(0,0,0,0.10)]`. The body strokes use `border-border/40` for a lighter visual weight.
- **Collapsed-by-default with current-task preview.** Initial `useState(false)` for expanded. Header layout: status icon (green check / spinner / muted circle depending on plan state) → "План" bold → pill `done / total` (tabular nums) → optional `+N more` → "·" separator → current-task preview, truncated. The current task is selected as the first `in_progress` todo, else the first `pending` todo, else the `planAllDone` indicator when everything is completed.
- **Body still on-demand.** Expanded body keeps the existing parent/child layout (status icons, indented children, `▸` prefix for orphans, `scenario_seeded` badge). Conditional render — body nodes only mount when expanded — so collapsed state stays clean in the DOM. Chevron rotates 180° on expand for the visual cue without a height-tweening hack.
- **i18n.** New `chat.planAllDone` key — "Все задачи выполнены" / "All tasks completed" — in both `apps/web/messages/ru.json` and `apps/web/messages/en.json`. The existing plan keys are unchanged.
- **Tests.** `apps/web/app/app/_components/chat-plan-card.test.tsx` updated: the legacy "defaults to expanded" assertion is replaced by three new collapsed-by-default tests — current task is the first `in_progress` (with completed/pending neighbours staying out of the DOM until expanded), header falls back to the first `pending` when nothing is in progress, and the `planAllDone` indicator surfaces when every row is completed. Body-content tests now explicitly `expand(container)` before asserting against `#chat-plan-body`. The toggle test now also asserts the body element disappears on collapse.

### Files

`apps/web/app/app/_components/chat-plan-card.tsx`, `apps/web/app/app/_components/chat-plan-card.test.tsx`, `apps/web/app/app/_components/chat-area.tsx`, `apps/web/messages/en.json`, `apps/web/messages/ru.json`, this checkpoint + `docs/CHANGELOG.md`.

### Verified

- `corepack pnpm --filter @persai/web exec vitest run chat-plan-card.test.tsx` — 16/16 PASS
- `corepack pnpm --filter @persai/web exec vitest run chat-area.test.tsx use-chat.test.tsx` — 22 + 86 PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm -r --if-present run lint` PASS
- `corepack pnpm run format:check` PASS

### Residuals

- Re-deploy required: this is a web-only change, but the web image still has to be republished. The migration gate does not trigger (no Prisma changes), so the pin will go through the regular `pin-dev-values-tag` path.
- Live validation after the new web image lands: scroll the chat with a non-empty plan — the card must remain pinned ~8px from the top of the chat zone; collapsed header should show the current task; click toggles expand; on a chat where every todo is completed the header should read "Все задачи выполнены".

### Next recommended step

Watch the `Dev Image Publish` run for SHA produced by this commit, reload the chat that already holds 7 rows in `assistant_chat_todos`, then run the live ADR-125 validation checks (engage seeding idempotency, `+N more` at >12 items, clear-confirm, `from <skill>` pill).

## 2026-06-22 — ADR-125 plan-route Clerk auth hot-fix — CHECKPOINT

### State

Live regression detected after the ADR-125 deploy of `f05f4191`: `<ChatPlanCard>` never rendered, even though the model successfully called `todo_write` and the database carried 7 rows for the active chat. Root cause: the two new web-facing routes on `AssistantChatTodosController` (`GET` + `DELETE /api/v1/assistant/chats/web/:chatId/plan`) were never added to the `ClerkAuthMiddleware` `forRoutes` allowlist in `IdentityAccessModule`, so every UI fetch landed in the handler with `req.resolvedAppUser === undefined` and was rejected with `401 Authenticated user context is missing.` in ~1 ms (no Clerk verifyToken call). Same regression class as ADR-074 / ADR-076 / ADR-088 / ADR-115 / Slice-3 scenarios — the existing module test already pins those routes, so a matching assertion was added for ADR-125.

### What changed

- `apps/api/src/modules/identity-access/identity-access.module.ts` — appended both ADR-125 plan routes to the `ClerkAuthMiddleware.forRoutes(...)` allowlist, next to `…/messages` and `…/compaction`.
- `apps/api/test/identity-access.module.test.ts` — locked the regression with explicit `hasRoute` assertions for `GET` + `DELETE /api/v1/assistant/chats/web/:chatId/plan`, including a comment that names this as the "Пока не видно план" regression and refuses to lose it again.

### Files

`apps/api/src/modules/identity-access/identity-access.module.ts`, `apps/api/test/identity-access.module.test.ts`, this checkpoint + `docs/CHANGELOG.md`.

### Verified

- `corepack pnpm --filter @persai/api exec tsx test/identity-access.module.test.ts` PASS
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm -r --if-present run lint` PASS
- `corepack pnpm run format:check` PASS

### Residuals

- Re-deploy is required: this hot-fix only ships once the `Dev Image Publish` workflow republishes `api` and the migration-gated pin job updates `infra/helm/values-dev.yaml` to the new SHA. Other services remain at `f05f4191`.
- After re-pin, repeat the original ADR-125 live checks: model adds/completes todos via tool-loop; the `<persai_chat_plan>` block appears in the next turn's prompt; `skill({action:"engage"})` seeds the scenario steps idempotently; the inline `<ChatPlanCard>` renders above the composer (cursor-style collapse, parent/child indent, `from <skill>` pill).

### Next recommended step

After the new image lands in `persai-dev`, reload the chat that already has 7 rows in `assistant_chat_todos` (DB confirmed at 13:30 UTC), confirm the card appears with two completed strikethroughs + the in-progress parent with one indented child + three trailing `pending` items. Then continue the ADR-125 closeout live checks.

## 2026-06-22 — ADR-125 in-chat TodoWrite + scenario-seeded plan — CHECKPOINT

### State

Implemented locally across four bounded slices. AGENTS gate green (full lint + format:check + 4-package typecheck + affected API/runtime/web/provider-gateway tests). Working tree carries the slices on top of baseline SHA `b29c3873`. **Live validation pending** the next dev deploy; the additive Prisma migration `20260622130000_adr125_assistant_chat_todos` pauses on the `persai-dev-migrations` environment per CI policy.

### What changed

- **New runtime tool `todo_write`** projected as a native PersAI tool (mirrors `memory_write`/`skill`): model-owned, zero-provider-cost, durable per `(assistantId, chatId)`. Hierarchical (parent ↔ children), three statuses (`pending` / `in_progress` / `completed`), two origins (`model_authored` / `scenario_seeded`). Server enforces invariants — one `in_progress` per parent, valid status transitions only, parent cannot complete with open children, no resurrection of `completed` rows, cycle detection on parentage, content length cap, soft ~200 active rows / hard 500 cap, content normalization.
- **Reinjection contract:** `<persai_chat_plan>` block in every turn's `volatile_context` (cacheRole `volatile_context`, `volatileKind: "chat_plan"`). Each provider client wraps the block in `<persai_chat_plan>…</persai_chat_plan>` XML. Window is the next ~12 active items (`RUNTIME_CHAT_PLAN_WINDOW_MAX`) under `selectChatPlanWindow`; older `completed` rows tail off (only last 2 kept).
- **Scenario seeding (Path C):** when `skill({action:"engage", scenarioKey})` succeeds, the runtime calls `seedSkillScenarioTodos` to materialize scenario steps as `origin: scenario_seeded` todos under the deepest current `in_progress` parent (top-level if none). Idempotent per `(chatId, seedKey)` where one batch shares one `seedKey`; existence check + inserts run in one Prisma transaction. Failures are warn-logged and never fail engage.
- **Web UI:** `<ChatPlanCard>` rendered inline above the composer (Cursor-style collapsible). Status icons (pending circle / in-progress spinner / completed strike-through), parent/child indenting, `from <skill>` pill for `scenario_seeded`, `done / total` counts, optional `+N more` tail when windowed, inline clear-confirm row. `useChat` integration refetches the plan on chat load, on terminal turn completion/interruption/failure, on `todo_write` SSE tool events, and on soft-detach reconcile / focus-resume paths. New ru/en `chat.plan*` and `activityTodoWrite*` strings.
- **Admin / catalog:** backend canonical `PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER` and the web `/admin/presets` mirror both include `todo_write` between `memory_write` and `quota_status`. `/admin/plans` toggle shows automatically via existing plan-managed backfill; a one-line blurb is added to `TOOL_CARD_DESCRIPTION`. Starter Trial: `active: true`, both limits `null`. New focused regression test `apps/api/test/tool-catalog-data.test.ts` locks the catalog row + Starter Trial entry.
- **Out of scope (intentionally — see ADR-125 § Scope fence):** cross-chat continuity (lives in ADR-120 open loops), completion-criteria proof contracts (column reserved, v1 unused), runtime stream resilience, background-task ↔ todo unification, `cancelled` status, user-side todo editing in UI (only clear-all on v1), live two-way binding between scenario state and todos, `<tool_usage_policy>` template additions (the model already discovers `todo_write` via native projection, so the selection guide does not need to change — leaving it out keeps the byte-golden fixture stable).

### Files

`docs/ADR/125-in-chat-todo-write-and-scenario-seeded-plan.md`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260622130000_adr125_assistant_chat_todos/migration.sql`, `apps/api/prisma/tool-catalog-data.ts`, `apps/api/src/modules/workspace-management/application/assistant-chat-todos.service.ts` (NEW), `apps/api/src/modules/workspace-management/application/runtime-tool-policy.ts`, `apps/api/src/modules/workspace-management/application/prompt-constructor-tool-metadata.ts`, `apps/api/src/modules/workspace-management/interface/http/assistant-chat-todos.controller.ts` (NEW), `apps/api/src/modules/workspace-management/interface/http/internal-runtime-chat-todos.controller.ts` (NEW), `apps/api/src/modules/workspace-management/workspace-management.module.ts`, `apps/api/test/assistant-chat-todos.service.test.ts` (NEW), `apps/api/test/tool-catalog-data.test.ts` (NEW), `apps/runtime/src/modules/turns/runtime-todo-write-tool.service.ts` (NEW), `apps/runtime/src/modules/turns/turn-execution.service.ts`, `apps/runtime/src/modules/turns/turns.module.ts`, `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts`, `apps/runtime/src/modules/turns/native-tool-projection.ts`, `apps/runtime/src/modules/turns/turn-context-hydration.service.ts`, `apps/runtime/src/modules/turns/runtime-skill-tool.service.ts`, `apps/runtime/test/runtime-todo-write-tool.service.test.ts` (NEW), `apps/runtime/test/native-tool-projection.test.ts`, `apps/runtime/test/turn-context-hydration.service.test.ts`, `apps/runtime/test/turn-execution.service.test.ts`, `apps/runtime/test/runtime-skill-tool.service.test.ts`, `apps/runtime/test/run-suite-isolated.ts`, `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`, `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`, `apps/provider-gateway/src/modules/providers/deepseek/deepseek-provider.client.ts`, `packages/runtime-contract/src/index.ts`, `apps/web/app/app/_components/chat-plan-card.tsx` (NEW), `apps/web/app/app/_components/chat-plan-card.test.tsx` (NEW), `apps/web/app/app/_components/chat-area.tsx`, `apps/web/app/app/_components/chat-area.test.tsx`, `apps/web/app/app/_components/use-chat.ts`, `apps/web/app/app/_components/use-chat.test.tsx`, `apps/web/app/app/_components/activity-badge.tsx`, `apps/web/app/app/assistant-api-client.ts`, `apps/web/app/app/assistant-api-client.test.ts`, `apps/web/messages/en.json`, `apps/web/messages/ru.json`, `apps/web/app/admin/presets/page.tsx`, `apps/web/app/admin/plans/page.tsx`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `pnpm-lock.yaml`, this checkpoint + `docs/CHANGELOG.md`.

### Verified

- `corepack pnpm -r --if-present run lint` PASS
- `corepack pnpm run format:check` PASS
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm --filter @persai/runtime run typecheck` PASS
- `corepack pnpm --filter @persai/provider-gateway run typecheck` PASS
- API focused tests (incl. new `assistant-chat-todos.service` 30+ cases and new `tool-catalog-data`) PASS
- Runtime focused tests (incl. new `runtime-todo-write-tool.service`, extended `runtime-skill-tool.service`, `turn-context-hydration.service` chat-plan-block cases, `native-tool-projection` todo_write assertions, `turn-execution.service` dispatcher case) PASS
- Web focused tests (`chat-plan-card` 15/15, `chat-area` 22/22, `use-chat` 86/86, `assistant-api-client` 69/69) PASS

### Residuals

- **Deploy + live validation.** The new Prisma migration must run (it pauses on `persai-dev-migrations` per CI policy); the `runtime` + `api` + `web` images must be republished and pinned. Live validation after deploy: (a) the model can `todo_write({action:"add"…})` and the result includes the windowed plan; (b) `complete` marks the row done; (c) the next turn carries `<persai_chat_plan>` in the prompt; (d) `skill({action:"engage"…})` seeds scenario steps under the current `in_progress` parent and re-engaging is a no-op; (e) UI plan card appears, collapses, renders parents + indented children, with the `from <skill>` pill on seeded items; (f) `/admin/presets` shows the `todo_write` editor card; (g) `/admin/plans` exposes the `todo_write` toggle.
- **No new ADR is opened by this slice.** ADR-125 is a single bounded program ADR; selection-guide and resilience work remain explicitly out of scope.

### Next recommended step

Commit + single push, then watch the dev deploy, approve the `persai-dev-migrations` environment, and run the live checks above. If any live check fails, open a fresh narrow ADR rather than re-opening ADR-125.

## 2026-06-22 — ADR-123 + ADR-124 closed by founder — CHECKPOINT

### State

Founder closure on live `persai-dev`. Both orchestration programs are now in the closed archive (`AGENTS.md`). No new code in this slice — docs/status-only.

### What changed

- **ADR-123** (native sandbox runtime — isolation, lifecycle, network, secrets, in-sandbox document execution) marked **Closed — 2026-06-22**. Verified live: sandbox Deployment runs the post-Slice-7 image (`sandbox:31607214…`); `command -v rg` → `/usr/bin/rg` and `command -v fd` → `/usr/local/bin/fd` inside the running pod. gVisor isolation, secret-free execution, deny-all egress + allowlist proxy, per-`(assistantId,workspaceId)` warm exec pod, `sandbox-pool` min-nodes=1 + prepull DaemonSet, 15-min idle TTL, expanded doc/data/image baseline, WeasyPrint PDF cutover, mode-B data documents (`xlsx`/`docx`), and `grep`/`glob`/`shell` are operating against real assistant traffic.
- **ADR-124** (provider-agnostic model routing, prompt-cache-retention capability, structured-output schema sanitation, fallback semantics, DeepSeek onboarding) marked **Closed — 2026-06-22**. Live state: DeepSeek main-reply turns complete; tool-loop turns no longer disconnect (`reasoning_content` round-trip + `parallel_tool_calls: false`); runtime gateway-result validator accepts `deepseek` alongside `openai`/`anthropic`; image/PDF attachments on a DeepSeek main slot are described via the plan's `systemTool` vision slot; admin guard prevents picking a text-only provider for `systemTool`; Anthropic numeric-range schema 400s gone; `gpt-5.5` works via `promptCacheRetention = "24h"`; cross-provider fallback on satisfiable 4xx runs before the first token only.
- `AGENTS.md` startup reading order updated: ADR-123 and ADR-124 added to the closed-program archive list (do not reopen for new scope).

### Files

`docs/ADR/123-native-sandbox-runtime-isolation-network-and-document-execution.md` (status header + closure block), `docs/ADR/124-provider-agnostic-model-routing-prompt-cache-retention-capability-and-fallback-semantics.md` (status header + closure block), `AGENTS.md` (closed-program archive list), `docs/CHANGELOG.md`, this checkpoint.

### Verified

Doc-only slice. Live evidence already captured above (sandbox pod `rg`/`fd` on PATH; DeepSeek tools complete; image rollout `runtime:384acc58` running). No code changed; AGENTS gate not re-run for this slice (no source diff).

### Residuals

Open founder follow-up — not in this slice, not reopening ADR-124: assistant text source-of-truth + async file delivery (model text from stream is the answer; placeholders / LLM-framing / hydration-marker should not overwrite a non-empty model reply; same rule for Telegram). Awaits a new ADR open before code work.

### Next recommended step

Open the new ADR for assistant text source-of-truth when ready, with the four-slice plan already discussed (documents path → media path → hydration `[Note: …]` marker removal → optional retro-scrub of historical `metadata.status: partial` messages).

## 2026-06-21 — Web chat inline streaming cursor restored — CHECKPOINT

### State

Implemented locally and focused web checks green. This is a UI rendering fix only; no runtime/API contract change.

### What changed

- Restored the pulsing inline cursor under streamed assistant text during active turns. While text deltas are actively streaming, the cursor is empty; when streaming pauses on a tool/project/retrieval/compaction boundary, the same row shows cursor + status text.
- Root cause: `ChatMessageBubble` hid `InlineStreamingStatus` once `message.content` became non-empty. During live streaming, intermediate tool-loop replies arrive as `content`, while completed `workingNotes` only arrive at turn completion. Result: the first cursor/status could show, then it disappeared after the first visible reply.
- Fix: track a local `streamingTextActive` hint on the live assistant message. `onDelta` sets it true (cursor-only), and tool/project/retrieval/compaction handlers set it false before updating live activity (cursor + localized status). Activity banners remain disabled; this only affects the cursor/status row inside the assistant bubble.
- Added localized ru/en lifecycle labels for browser, document, grep, glob, shell, exec, quota_status, memory_write, skill, background_task, plus normalized knowledge/files labels so ADR-123 workspace tools no longer fall back to generic activity text.

### Files

`apps/web/app/app/_components/chat-message.tsx`, `apps/web/app/app/_components/chat-message.test.tsx`, `apps/web/app/app/_components/use-chat.ts`, `apps/web/app/app/_components/use-chat.test.tsx`, `apps/web/app/app/_components/activity-badge.tsx`, `apps/web/app/app/_components/activity-badge.test.tsx`, `apps/web/messages/en.json`, `apps/web/messages/ru.json`, CHANGELOG, this checkpoint.

### Verified

- `corepack pnpm --filter @persai/web exec vitest run app/app/_components/chat-message.test.tsx`
- `corepack pnpm --filter @persai/web exec vitest run app/app/_components/chat-message.test.tsx app/app/_components/activity-badge.test.tsx`
- `corepack pnpm --filter @persai/web exec vitest run app/app/_components/use-chat.test.tsx`
- `corepack pnpm --filter @persai/web run typecheck`
- `corepack pnpm --filter @persai/web run lint`
- `corepack pnpm run format:check`

### Next recommended step

Commit and push with the prompt-policy fix. After deploy, live-check a multi-tool turn: after every intermediate assistant reply, the cursor/status row should remain on the next line with the latest tool/project/retrieval status text.

## 2026-06-21 — ADR-123 prompt policy alignment — CHECKPOINT

### State

Implemented locally and focused checks green. Baseline SHA before this slice: `384acc5812b861608451a304a46d121aaefcc5c8`. No new ADR: this is a prompt/tool-instruction correction to match ADR-123 truth, not a new architecture decision.

### What changed

- Removed the global "carousel/series" media route from the always-on tool policy and image tool catalog guidance; carousel remains scenario-owned by the marketer Skill fixture.
- Tightened `image_edit` to visual image modifications only. If an uploaded image/file is source material for a PDF, Word/DOCX, Excel/XLSX, deck, report, OCR, table, or other document, the prompt now routes to `document` (or inline vision when no deliverable is needed), not `image_edit`.
- Reworded the workspace tool category to the ADR-123 loop: `glob` for discovery, `grep` for content search, `files` for file IO, and proactive `shell` for execution/tests/builds/diagnostics/verification rather than search shortcuts.

### Files

`apps/api/prisma/bootstrap-preset-data.ts`, `apps/api/prisma/tool-catalog-data.ts`, `apps/api/test/bootstrap-preset-data.test.ts`, `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt`, CHANGELOG, this checkpoint.

### Verified

- `corepack pnpm --filter @persai/api exec tsx test/bootstrap-preset-data.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/adr119-golden-prompt-snapshot.test.ts`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/api run lint`
- `corepack pnpm --filter @persai/api run typecheck`

### Next recommended step

Commit and push after reviewing the concise prompt wording. After deploy, live-check: (1) uploaded photo + "make docs" routes to `document` or inline vision, not `image_edit`; (2) workspace investigation prefers `glob`/`grep` before `shell` search shortcuts while still using `shell` for execution/verification.

## 2026-06-21 — ADR-124 DeepSeek live fixes: thinking-mode tool loops + text-only multimodal — CHECKPOINT

### State

Implemented locally; full AGENTS gate + ADR-124 focused checks green. Needs commit + push, then deploy to `persai-dev` for live re-validation. Diagnosed live in `persai-dev` (not guessed): the two root causes were reproduced with synthetic gateway calls (`reasoning_content` 400 on tool loops; `400` text-only on image input) and confirmed against DeepSeek's official API docs.

### What changed

- **DeepSeek thinking-mode tool-loop `reasoning_content` round-trip.** Adapter captures `reasoning_content` (stream + non-stream), surfaces it on the text result, echoes it on the assistant tool-call message, and forces `parallel_tool_calls: false`. Runtime threads it onto each tool exchange at the four `toolHistory.push` sites. Fixes the frequent "падает на вызовах любого tool" disconnects.
- **Text-only multimodal sanitizer.** New `runtime-text-only-multimodal-sanitizer` + two runtime chokepoints (base messages once before the loop; `files.preview` blocks when read) describe image/PDF via the `systemTool` slot vision model and replace with text for text-only providers (DeepSeek). Vision-capable providers untouched; failures/absent helper → explicit placeholder, never pixels, never silent drop.
- **Admin guard.** `systemTool` plan slot must resolve to a vision-capable provider (OpenAI/Anthropic).

### Files

`packages/runtime-contract/src/index.ts` (`reasoningContent` on result + tool exchange), `apps/provider-gateway/src/modules/providers/deepseek/deepseek-provider.client.ts` (+ test, + run-suite wiring), `apps/runtime/src/modules/turns/turn-execution.service.ts`, new `apps/runtime/src/modules/turns/runtime-text-only-multimodal-sanitizer.ts` (+ test, + run-suite/run-suite-isolated wiring), `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts` (+ test), CHANGELOG, ADR-124, this checkpoint.

### Verified

- `corepack pnpm run format:check` · `corepack pnpm -r --if-present run lint`
- typecheck: `@persai/api` · `@persai/web` · `@persai/runtime` · `@persai/provider-gateway`
- unit: DeepSeek adapter reasoning round-trip; admin-plan systemTool vision guard; runtime multimodal sanitizer (provider gate, replacement, placeholder, idempotency)

### Next recommended step

Deploy to `persai-dev`, then live-verify: (1) a DeepSeek turn that calls a tool completes instead of disconnecting; (2) a DeepSeek turn with an image/PDF/doc attachment returns a sensible answer (described via systemTool) instead of a silent drop.

## 2026-06-21 — Project routing + tool-loop text separation — CHECKPOINT

### State

Implemented locally and verified. Baseline SHA before this slice: `f52d760d`.

### What changed

- Project chat mode no longer bypasses ordinary turn routing. `project-execution-profile.ts` now owns only project workflow helpers (contract + stream events), and `turn-routing.service.ts` lets project turns pass through the same precheck/classifier path as other modes. Result: project remains pull-first/tool-oriented, but it no longer pins every turn to the reasoning slot; reasoning is selected only when routing evidence reaches `deep`.
- Tool-loop assistant text segments are separated with a blank line when multiple model pre-tool/follow-up snippets are merged into one visible answer, preventing inline "planning snippet planning snippet final answer" mush across many loop passes. Prefix-preserving merge behavior remains intact so cumulative streaming deltas still emit correctly.
- Repeated the failing GitHub `CI` locally. The failure was from ADR-124 test drift already on `main`: `session-compaction.service.test.ts` used absolute request/lease counts after an added prompt-cache-retention compaction call, and provider-gateway warmup tests did not account for DeepSeek's managed `deepseek/api-key` resolution. Both tests now assert the intended behavior without depending on stale ordering/counts.

### Files

`apps/runtime/src/modules/turns/project-execution-profile.ts`, `apps/runtime/src/modules/turns/turn-routing.service.ts`, `apps/runtime/src/modules/turns/turn-execution.service.ts`, runtime tests, provider-gateway warmup tests, ADR-121, CHANGELOG, this checkpoint.

### Verified

Focused checks passed:

- `corepack pnpm --filter @persai/runtime exec tsx test/run-one.ts test/turn-routing.service.test.ts runTurnRoutingServiceTest`
- `corepack pnpm --filter @persai/runtime exec tsx test/run-one.ts test/turn-execution.service.test.ts runTurnExecutionServiceTest`
- `corepack pnpm --filter @persai/runtime exec tsx test/project-execution-profile.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/run-one.ts test/session-compaction.service.test.ts runSessionCompactionServiceTest`
- `corepack pnpm --filter @persai/provider-gateway run test`

Full gate passed:

- `corepack pnpm run format:check`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm -r --if-present run typecheck`
- `corepack pnpm -r --if-present run test`

### Next recommended step

Commit and push. After deploy, verify one simple project-mode turn routes to normal/premium rather than reasoning, and one genuinely deep project/PDF turn can still escalate to reasoning.

## 2026-06-21 — ADR-124 provider routing/capabilities/fallback/DeepSeek — CHECKPOINT

### State

Implemented locally. Full AGENTS gate and ADR-124 focused checks green. Needs commit + push/deploy. Baseline SHA before ADR-124 work: `5e27f5b8ecd99bb1a9c56558f02c63459e938e4f`.

### What changed

ADR-124 landed as one bounded provider-routing slice:

- `promptCacheRetention` is a model-profile capability and OpenAI request shaping reads it from resolved slot catalog truth (`gpt-5.5` defaults to `24h`).
- Anthropic structured-output schemas now remove unsupported constraint keywords such as numeric `minimum`/`maximum`.
- Provider-gateway/runtime error propagation now classifies provider text failures and permits pre-first-token fallback for billing/quota/rate-limit/capacity/auth style provider failures, but not malformed requests.
- Admin plans and routing slots now carry provider+model selections per text slot; `primaryProvider` remains only a default seed and the single global fallback remains unchanged.
- DeepSeek is registered as a credential-gated managed text provider (`deepseek/api-key`) with a thin OpenAI-compatible Chat Completions adapter and active defaults for `deepseek-v4-flash` / `deepseek-v4-pro`.

### Files

Provider/runtime/API/web/contract changes across `apps/provider-gateway`, `apps/runtime`, `apps/api`, `apps/web`, `packages/runtime-contract`, and `packages/contracts`; ADR-124, CHANGELOG, this checkpoint.

### Verified

Full AGENTS gate green: repo lint, format check, API typecheck, web typecheck. Extra ADR-124 gate green: runtime/provider-gateway typechecks plus focused provider-gateway, runtime fallback, API routing/catalog/admin-plan, and web admin runtime/plans tests.

### Next recommended step

Commit + push. After deploy to `persai-dev`, verify:

- `gpt-5.5` no longer fails due to prompt-cache retention.
- Anthropic structured output no longer rejects number `minimum`/`maximum`.
- balance/quota/capacity/auth provider errors fall back before the first token.
- a slot can resolve provider+model independently from the account default.
- DeepSeek remains unconfigured until `deepseek/api-key` is stored, then warms and serves a chat/structured-output/fallback smoke.

## 2026-06-21 — ADR-123 exec image curated baseline — CHECKPOINT

### State

Implemented locally. Needs verification gate, commit, push/deploy (rebuild `sandbox-exec` image).

### What changed

Expanded the immutable `sandbox-exec` image with the full prod baseline for docs/excel/pdf/image/ocr/qr work:

- **System:** `libzbar0`, `tesseract-ocr` (+ eng/rus), `poppler-utils`, `ghostscript`, `git`, `unzip`, `zip`, headless GL/X helpers, image codecs, XML libs.
- **Python:** added `xlsxwriter`, `pypdf`, `reportlab`, `pyzbar`, `qrcode`, `pytesseract`, `beautifulsoup4`, `lxml`, `jinja2`, `seaborn`, `python-dateutil`, `pyyaml`, `requests`.
- Runtime `pip install` stays for rare extras only (`/workspace/.local`); `apt-get` remains unavailable in session pods.

### Files

`apps/sandbox/exec-image/Dockerfile`, `apps/sandbox/exec-image/requirements.txt`, `apps/sandbox/test/exec-image-dockerfile.test.ts`, ADR-123, CHANGELOG, this checkpoint.

### Next recommended step

Run AGENTS gate, commit, push. After `sandbox-exec` image rebuild + deploy, delete old session pod and verify:

```bash
python3 -c "import pyzbar, pytesseract, pypdf, reportlab, bs4, lxml, jinja2, seaborn"
tesseract --version
pdftotext -v
```

## 2026-06-21 — ADR-123 TTL 15m + writable runtime pip installs — CHECKPOINT

### State

Implemented locally along with the document-job replay fix below. Full gate green. Needs commit + push/deploy.

### What changed

1. **Session pod idle TTL shortened to 15 minutes.** `SANDBOX_EXEC_SESSION_IDLE_TTL_MS` default + dev Helm value changed `1800000 -> 900000`. Reason: with `sandbox-pool` `min-nodes=1` and `sandbox-exec-prepull`, pod recreation is fast; holding every session pod for 30 minutes is no longer needed just for latency. Reaper interval remains 2 minutes.
2. **Runtime `pip install ...` writes to `/workspace/.local`.** The exec image still uses read-only root FS and immutable preinstalled `/opt/venv`, but ordinary model/user shell installs now default to a writable user-site: venv built with `--system-site-packages`, `PYTHONUSERBASE=/workspace/.local`, `PIP_USER=1`, and `/workspace/.local/bin` first on PATH (including login shells). This preserves the security boundary while fixing `pip install colorama==0.4.6` failing with `Read-only file system`.

### Files

`packages/config/src/sandbox-config.ts`, `infra/helm/values-dev.yaml`, `apps/sandbox/exec-image/Dockerfile`, sandbox test fixtures, `infra/dev/gke/RUNBOOK.md`, ADR-123, CHANGELOG, this checkpoint.

### Next recommended step

Commit + push. After deploy, verify `pip install colorama==0.4.6 && python3 -c "import colorama; print(colorama.__version__)"` inside the same assistant shell, verify XLSX/DOCX document jobs deliver, and verify idle session pods disappear after ~15–17 minutes.

### Document-job audit before push

User reported Excel/DOCX not working and PDF succeeded 2/3. Live DB audit:

- XLSX job `dca8f91f-5870-49fc-ad23-2d2124b7845b`: failed `document_artifacts_missing`; nested provider status `invalid_path`, message `render_html_to_pdf outputFileName must end with .pdf`, requested `test-excel.xlsx`.
- DOCX job `9d2a92de-9917-4480-86bf-8f7430ba5bd7`: same failure, requested `test-docx.docx`.
- PDF jobs `2b46b873-...` and `89964b4b-...`: delivered OK. PDF job `a0d61f97-...`: failed before render because generated HTML body text was too short (`length=59`, min `120`) after 3 generation attempts — prompt/model quality, not sandbox/push.

Root cause: API scheduler replay parser accepted only `create_pdf_document|create_presentation|revise_document|export_or_redeliver` and only `pdf|pptx`; stored queued `create_data_document` + `xlsx|docx` requests were replayed as `create_pdf_document`, so runtime used `render_html_to_pdf`. Fix in `AssistantDocumentJobSchedulerService.parseRequestPayload()`: preserve `create_data_document`, `xlsx`, `docx`; widen completion/failure framing types; add regression test.

## 2026-06-21 — ADR-123 workspace-push large-stdin frame root cause — CHECKPOINT

### State

Implemented locally after live proof; full AGENTS gate green. Needs commit + push/deploy.

### Correct root cause

The `marker missing` failure was not cold-start readiness, not packages, not path mismatch, and not a marker bug. For assistant `c2df1500-ec77-4224-891d-efc32a16c810`, the real workspace is **165 files / 52,220,007 bytes** in `assistant_files` and hydrated on disk. The earlier "97,933 files / 1.8GB" was an operator/debugger quoting mistake: it inspected the sandbox control-plane container's `/workspace` app repo (PersAI + `node_modules`), not the assistant workspace.

Live reproduction against the real session pod:

- local tar of the real assistant workspace succeeds: `52,582,400` bytes
- sending that tar as `Readable.from([tarball])` delivers **0 bytes** to the pod (`sha256` = empty file), so remote `tar` prints `This does not look like a tar archive`
- sending the exact same tar as 64 KiB chunks delivers `52,582,400` bytes, `sha256` matches, and `tar -tf` passes

### Fix

`apps/sandbox/src/exec-pod-bridge.service.ts`: `execWorkspaceTarPush` now feeds Kubernetes exec stdin through `readBufferInChunks(tarball, 64 * 1024)` instead of one giant buffer chunk. The fully materialized local tar remains (keeps the live-child-pipe EOF race fixed); the marker + stdin-less verify remains authoritative. No readiness sleep and no blind retry loop. Regression test added: large push payloads are split into multiple <=64KiB chunks and reassemble byte-for-byte.

### Files

`apps/sandbox/src/exec-pod-bridge.service.ts`, `apps/sandbox/test/exec-pod-bridge.service.test.ts`, ADR-123, CHANGELOG, this checkpoint.

### Next recommended step

Commit + push. After deploy, live-test the same assistant `c2df1500-...` with `echo __SHELL_OK__`; expected: workspace push verifies and the shell command runs.

## 2026-06-21 — ADR-123 exec pod re-keyed per assistant+workspace + warm node enabled — CHECKPOINT

### State

Implemented + full sandbox gate green (typecheck · 27/27 tests · lint · prettier). `min-nodes 1` **applied live** to `sandbox-pool`. Committed locally on this slice's branch; **push = deploy** carries the `sandbox` control-plane image rebuild + pin.

### What changed

1. **Exec pod keyed per `(assistantId, workspaceId)`, not per chat session.** All chats of one assistant workspace now share a single warm pod `ses-<sha256(assistantId:workspaceId)>` — the second/third chat no longer cold-starts its own pod. Safe: the pod's `/workspace` is re-pushed every job (pod identity = warmth only, never file truth) and the `assistantId+workspaceId` Postgres lease already serializes all jobs for the workspace, so the shared pod is never concurrent even across chats. Pod annotations `persai.io/assistant-id` + `persai.io/workspace-id` (replace `persai.io/session-id`); reaper derives activity via `sandboxJob.findFirst({ where: { assistantId, workspaceId } })`. Old per-session pods drain by creation-age fallback after the idle TTL. GCS session snapshot (control-plane, keyed by `assistantId+runtimeSessionId`) unchanged + orthogonal. Sessionless jobs stay ephemeral.
2. **Warm node enabled (1-month trial).** `gcloud container node-pools update sandbox-pool --zone europe-west1-b --enable-autoscaling --min-nodes 1 --max-nodes 2` applied — one Ready node confirmed, `sandbox-exec-prepull` DaemonSet READY=1 on it (image cached). First command after idle ~2–5s instead of ~100s. Cluster is **zonal** `europe-west1-b` — RUNBOOK §8 corrected from `--region europe-west1`. Founder reviews standing-node cost after ~1 month.

### Files

`apps/sandbox/src/exec-pod-bridge.service.ts`, `apps/sandbox/src/sandbox.service.ts`, `apps/sandbox/test/exec-pod-bridge.service.test.ts`, `infra/dev/gke/RUNBOOK.md`, ADR-123, CHANGELOG, this checkpoint.

### Next recommended step

Push (deploy) so the re-keyed pod logic lands in the redeployed `sandbox` image; then live-verify two chats of one assistant reuse a single `ses-*` pod and warm-start in seconds. Separate open task: ADR-124 (provider-agnostic model routing / capabilities / fallback) is drafted but untracked — not part of this slice.

## 2026-06-21 — ADR-123 workspace-push success-detection regression (THE "shell doesn't work" root cause) — CHECKPOINT

### State

Implemented, full local gate green, **committed + pushed to `origin/main`** (push = deploy; the `sandbox` control-plane image rebuild + pin carries it).

### Problem (live-diagnosed, not assumed)

Every `shell`/`exec`/`render_html_to_pdf` job failed `process_spawn_failed` / "Workspace push closed without success (stderr: none)", intermittently, and it persisted after the cold-start deploy. Founder was (rightly) furious that earlier "retry" framing was a band-aid on a shaky diagnosis. Ground truth from `sandbox_jobs` on `persai-dev`: every recent failure had `exec_pod_name: null` + that exact message; one waited **80s** (pod was Running) and still failed → NOT a cold-start timeout. Reproduced with the real `@kubernetes/client-node` from inside the control-plane pod against the live session pod: 1 KB stdin → success sentinel returns; 200 KB / 2 MB stdin → `status=Success` (remote `tar` exits 0) but the exec **stdout channel is silently dropped** and the status frame races the close. So the 2026-06-20 push rework (`9eaf30f8`/`96d3c288`), which reads success off that same stdin-laden socket, failed every real workspace push — a regression.

### Fix

`apps/sandbox/src/exec-pod-bridge.service.ts`: decouple transfer from success detection. Push exec streams the tar + writes a marker file only on `tar` success (its own stdout/status ignored; resolves on clean close, rejects only on real connection failure). A separate **stdin-less** verify exec checks the marker (reliable channels — proven 4/4 with 2 MB in-cluster). Missing marker ⇒ retryable `process_spawn_failed`; command/pull never run on a failed push. New regression test; shared exec mock defaults unseeded calls to success. sandbox 27/27 · typecheck · lint · prettier PASS.

### Open (founder decision) — RESOLVED 2026-06-21

Founder chose **min-nodes=1 + keep prepull** as a 1-month trial (see the newer checkpoint at the top). The prepull DaemonSet now pays off because there is a standing node to cache the exec image on. Revisit standing-node cost after ~1 month.

### Files

`apps/sandbox/src/exec-pod-bridge.service.ts`, `apps/sandbox/test/exec-pod-bridge.service.test.ts`, ADR-123, CHANGELOG, this checkpoint.

## 2026-06-21 — ADR-123 documents pre-deploy hardening (retryable infra failures + retired-price cleanup) — CHECKPOINT

### State

Implemented in the working tree, **not committed, not pushed** — folded into the same held pre-deploy batch as the cold-start fix, grep/glob wiring, and MIME/egress (all four are in one uncommitted tree). The pdfmonkey prod row is already cleaned live on `persai-dev`.

### Problem (live-diagnosed, not assumed)

Founder's test PDF: job created, then failed after 24s with `document_artifacts_missing` ("worker completed without deliverable artifacts"). The job's `providerStatusJson` showed the real cause: the render's sandbox job hit a workspace-push flake — `process_spawn_failed`, "Workspace push closed without success (stderr: none)", `retryable: false` — so it died after **1/5** attempts. Root: `exec-pod-bridge.createBridgeError` defaulted `blocked=true`; spawn/provision/push failures were thus recorded as `blocked` (a policy block) → sandbox `status: "blocked"` → the doc worker's `renderHtmlToPdf` derives `retryable = (status === "failed")` → non-retryable. The 24s (not ~100s) timing confirms it was a push flake, not the cold-start timeout itself. Separately, the Admin > Tools `document_render:pdfmonkey` price card (8000) was stale: Slice 5 removed PDFMonkey from code, but the tool-path pricing catalog merge preserves stored rows.

### What changed (this checkpoint)

1. **Retryable-by-default bridge errors.** `createBridgeError` default flipped `blocked=true → false` (operational/retryable). Explicit `blocked=true` kept only for the two genuine non-retryable blocks: the stdout/stderr resource-limit collector and the command-runtime-budget `process_timeout`. Now spawn / pod-provisioning / push failures surface as `failed` → the async document job retries (and lands on a warm pod after the cold-start fix). Aligns `process_spawn_failed`/provisioning `process_timeout` with the already-`blocked:false` `sandbox_failed` exec/pull paths. No runtime-adapter edit needed.
2. **Retired pricing row removed.** Idempotent data migration `20260621130000_adr123_drop_retired_pdfmonkey_render_price` strips `document_render:pdfmonkey` from the stored `tool_path_pricing_catalog`; prod row removed live (`rows 8 → 7`; only `document_render:gamma` remains).
3. **Docs.** ADR-123 addendum ("Document-job reliability + retired-pricing cleanup"); CHANGELOG; this checkpoint.

### Files

`apps/sandbox/src/exec-pod-bridge.service.ts`, `apps/api/prisma/migrations/20260621130000_adr123_drop_retired_pdfmonkey_render_price/migration.sql`, ADR-123, CHANGELOG.

### Verified

sandbox typecheck PASS · sandbox lint PASS · prettier (edited TS) PASS. Existing sandbox `blocked`-status tests cover only preflight quota/backlog/containment blocks (unaffected). Full combined gate to run before push.

### Next step

Commit/push grouping for the four held workstreams. On push: sandbox redeploy applies the retry fix; the pdfmonkey migration pauses on `persai-dev-migrations` (already a no-op on prod since the row was cleaned live). Founder can re-run the test document after redeploy to confirm green.

---

## 2026-06-21 — ADR-123 Slice 3 cold-start reliability + warm pool re-opened — CHECKPOINT

### State

Implemented in the working tree, **not committed, not pushed** (founder is reviewing; the grep/glob + MIME/egress work is also held uncommitted in the same tree). The 12 prod `grep`/`glob` plan activation rows are already live and the model already sees them (runtime logs show toolCount 20→22).

### Problem (live-diagnosed, not assumed)

First `shell`/`exec` after idle took ~104s (sandbox-pool node autoscale + multi-GB exec image pull) and **failed**. Four budgets were all sized for the warm path and conflated pod startup with command runtime: `waitForPodRunning` deadline = `maxProcessRuntimeMs` (15s); running-job watchdog `maxProcessRuntimeMs+grace` (~30s); runtime `resolveCompletionTimeoutMs` (~40s); queued-stale (45s). ADR-123 Slice 3's "warm pool deferred, cold start ~2–4s" premise was wrong.

### What changed (this checkpoint)

1. **Reliability — dedicated pod-provisioning budget (default 240s).** `SANDBOX_EXEC_POD_PROVISION_BUDGET_MS` (sandbox) + `RUNTIME_SANDBOX_POD_PROVISION_BUDGET_MS` (runtime) threaded through `waitForPodRunning`, the running-job watchdog, and the runtime completion timeout. `maxProcessRuntimeMs` is now only the per-command cap. Cold start succeeds instead of failing.
2. **Latency — warm pool re-opened.** `sandbox-exec-prepull` DaemonSet (Helm) caches the exec image on every sandbox node; pair with ≥1-min-node `sandbox-pool` via the one-time `gcloud` step in RUNBOOK §Slice 3.8.
3. **Docs.** ADR-123 addendum ("Cold-start reliability + warm-pool re-opened", supersedes the DEFER note) + Slice 3 status line; CHANGELOG; RUNBOOK §Slice 3.8.

### Files

`packages/config/src/{sandbox,runtime}-config.ts`, `apps/sandbox/src/{exec-pod-bridge,sandbox}.service.ts`, `apps/runtime/src/modules/turns/sandbox-client.service.ts`, `infra/helm/templates/sandbox-exec-prepull-daemonset.yaml`, `infra/helm/values-dev.yaml`, `infra/dev/gke/RUNBOOK.md`, ADR-123, CHANGELOG; tests in `apps/sandbox/test/*` + `apps/runtime/test/*`.

### Verified

helm lint + template (prepull renders, correct exec image) · sandbox typecheck · runtime typecheck · exec-pod-bridge test (16 pass) · sandbox-client test (3 pass, incl. new provision-budget assertion). Full repo lint/format pending in the combined gate.

### Next step

Decide commit/push grouping for the three held workstreams (cold-start fix, grep/glob wiring, MIME/egress). On push: runtime + sandbox redeploy applies the budget fix + prepull DaemonSet; run the one-time `gcloud node-pools update sandbox-pool --min-nodes 1` for the warm node.

---

## 2026-06-21 — ADR-123 post-program config tuning: open delivery MIME + broaden egress — CHECKPOINT

### State

ADR-123 Slices 1–7 are committed and pushed (`origin/main` @ `3474bdd1`); the Dev Image Publish pipeline rebuilds the exec + control-plane images and pauses on `persai-dev-migrations` for founder approval of the Slice 5/6 enum migrations. This follow-up (founder directive) is implemented in the working tree, not yet committed.

### What changed (this checkpoint)

1. **Delivery MIME → allow-all, uniform across all plans.** `DEFAULT_RUNTIME_SANDBOX_POLICY.artifactMimeAllowlist = ["*/*"]`; `assertMimeAllowed` honors the `*/*`/`*` allow-all sentinel; data migration `20260621120000_adr123_open_delivery_mime_allowlist` rewrites every plan's stored `sandboxPolicy.artifactMimeAllowlist` to `["*/*"]`. Real safety stays at the persist layer (`media-security-policy.ts`: `ALLOWED_MEDIA_MIMES` + dangerous-extension block).
2. **Egress broadened (Claude-style, deny-all + allowlist preserved).** Added `.github.com` + `.githubusercontent.com` to `egressProxy.allowedDomains`. Open internet was rejected; D3 unchanged.

### Key decisions

- **MIME opened at the delivery layer only** — the persist-time media validation is the true ceiling, so wildcard delivery does not let dangerous files through. Founder chose wildcard over an explicit broad list (never hit it again).
- **Internet = allowlist, not open** — "like Claude" literally means deny-all + curated domains; founder chose to broaden the allowlist (GitHub ecosystem for the current Python+Node stack), not open egress.
- **Migration is data-only** (no schema change), `create_missing=false`, idempotent (skips rows already `["*/*"]`).

### Files touched

- `packages/runtime-contract/src/index.ts` (default allowlist → `["*/*"]`)
- `apps/runtime/src/modules/turns/runtime-files-tool.service.ts` (`assertMimeAllowed` wildcard) + `apps/runtime/test/runtime-files-tool.service.test.ts` (wildcard test)
- `apps/api/prisma/migrations/20260621120000_adr123_open_delivery_mime_allowlist/migration.sql` (NEW, data-only)
- `infra/helm/values-dev.yaml` (egress allowlist += GitHub)
- `docs/ADR/123-…md` (addendum + slice SHAs filled), `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`

### Deploy residual

Data migration pauses on `persai-dev-migrations` (CI policy); egress change applies on ArgoCD sync (Squid ConfigMap reload). No image rebuild required for the MIME/contract change beyond the runtime service redeploy already triggered by the push.

### Next recommended step

Commit + push this follow-up after the local gate; approve the pending `persai-dev-migrations` so both the Slice 5/6 enum migrations and this data migration apply in order.

---

## 2026-06-21 — ADR-123 Slice 7: inline `grep`/`glob` + autonomous `shell` + `<tool_usage_policy>` workspace category — CHECKPOINT (final ADR-123 slice)

### State

Implemented in the working tree (not committed/pushed — left for the orchestrator). Full verification gate **PASS**: lint · format:check · all 5 typechecks (`@persai/api`/`@persai/web`/`@persai/runtime`/`@persai/provider-gateway`/`@persai/sandbox`) · sandbox tests 26/26 · api full suite · runtime full suite · web presets 6/6.

### What changed

`grep` (content search) and `glob` (filename discovery) added as **inline** workspace tools that run on the sandbox **control plane** as trusted PersAI subprocesses (`rg`/`fd`) against the hydrated `workspaceRoot` — NOT in an exec pod. `shell` rewritten to a first-class autonomous multi-step tool (search routed to grep/glob). Additive `<category name="workspace">` added to the `<tool_usage_policy>` prompt. Plan activation defaults and tool-loop budget unchanged.

### Key decisions

- **grep/glob are control-plane trusted-binary execution, not model commands** (D2 holds): model args (pattern/glob/type/path) pass as an argv ARRAY with a `--` terminator (`shell:false`); optional `path` normalized through `resolveWorkspacePath` (escapes rejected before spawn). Hard timeout (`maxProcessRuntimeMs`), stdout byte cap (`maxStdoutBytes`), match/path caps (grep 200 / glob 500) with `truncated`.
- **Routing reuses the `files` inline path**: a thin `runtime-grep-glob-tool.service.ts` posts a sandbox job (toolCode `grep`/`glob`) → control-plane handler; per-turn caps grep 10 / glob 10.
- **rg/fd added to the control-plane `apps/sandbox/Dockerfile`** (apt `ripgrep`+`fd-find`, `fdfind`→`fd` symlink), mirroring the exec-image install. (apt distro versions, matching the exec image which also does not pin explicit versions.)
- **`active:true` for grep/glob** in `STARTER_TRIAL_TOOL_POLICY` (matches `files`; exec/shell stay inactive).
- **ADR-119 golden invariant preserved**: only an additive `<category name="workspace">` was added; `<priority_order>` + `<tool_usage_policy>` wrapper untouched; structural golden tests green; the byte-snapshot fixture regenerated (diff = exactly the +7-line category).

### Files touched (Slice 7)

- `packages/runtime-contract/src/index.ts` (`RuntimeGrepMatch`/`RuntimeGrepToolResult`/`RuntimeGlobToolResult`)
- `apps/sandbox/src/sandbox.service.ts` (grep/glob handlers + `runTrustedControlPlaneBinary` + path containment) · `apps/sandbox/Dockerfile` (rg/fd)
- `apps/runtime/src/modules/turns/native-tool-projection.ts` (grep/glob tool definitions + projection)
- `apps/runtime/src/modules/turns/runtime-grep-glob-tool.service.ts` (NEW inline service) · `turn-execution.service.ts` (dispatch + result-union) · `turns.module.ts` (DI) · `tool-budget-policy.ts` (caps)
- `apps/api/src/modules/workspace-management/application/runtime-tool-policy.ts` (inline mode + sandbox gate + files guidance) · `apps/api/prisma/tool-catalog-data.ts` (grep/glob rows + shell rewrite + activation) · `apps/api/prisma/bootstrap-preset-data.ts` (`<category name="workspace">`)
- `apps/web/app/admin/presets/page.tsx` (`PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER` += grep/glob after files)
- `docs/API-BOUNDARY.md`, `docs/CHANGELOG.md`, `docs/ADR/123-…md` (Slice 7 LANDED)
- Tests: `apps/sandbox/test/sandbox.service.test.ts`, `apps/api/test/runtime-tool-policy.test.ts`, `apps/api/test/bootstrap-preset-data.test.ts`, `apps/runtime/test/native-tool-projection.test.ts`, `apps/runtime/test/turn-execution.service.test.ts`, regenerated `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt`

### Deploy residual

The control-plane `sandbox` image MUST be rebuilt so `rg`/`fd` are on PATH — inline grep/glob fail without them. No DB migration this slice.

### Next recommended step

Live smoke of grep/glob in `/admin/presets` + a real turn (grep a pattern, glob a name) once the rebuilt sandbox image is deployed; then ADR-123 can be closed in full.

## 2026-06-21 — ADR-123 Slice 6: Documents mode B (model-writes-code, create-only) — CHECKPOINT

### State

Implemented in the working tree (not committed/pushed — left for the orchestrator). Full verification gate **PASS**: lint · format:check · all 5 typechecks (`@persai/api`/`@persai/web`/`@persai/runtime`/`@persai/provider-gateway`/`@persai/sandbox`) · runtime tests · sandbox 22/22 · api tests.

### What changed

New parallel document path: the model authors a Python 3 program that deterministically emits a native **Excel/DOCX/data-PDF**, executed in the sandbox — decoupling document size from the output-token budget. Mode A (HTML→WeasyPrint) is unchanged. **Create-only** this slice (no revise/export for data documents).

### Key decisions

- **Routing**: `descriptorMode: "create_data_document"` → `documentType: "data_document"`, `provider: "sandbox"`; `outputFormat` ∈ {xlsx (default), docx, pdf}.
- **Sandbox toolCode**: new `execute_document_code` runs `python3 /workspace/.document-code.py`; transient program + `/workspace/sources` cleaned in `finally` so they are not collected as output.
- **Self-repair**: exactly one retry — sandbox stderr is fed back into a second authoring call; terminal `document_code_failed` after the second failure (no loop).
- **Artifact validation**: xlsx/docx = `PK\x03\x04` ZIP magic + min size; pdf = existing `%PDF-` validator. Persist as `runtime_output`; soft-delete the transient `sandbox_output`.
- **Two-tier source ingestion (founder-approved — source text is NEVER inlined into the prompt)**:
  - **TIER 1 (default)**: raw source files mounted via `RuntimeSandboxJobRequest.mountedFileRefs` into `/workspace/sources/<name>`; the prompt tells the model to read them natively (pdfplumber/python-docx/openpyxl/pandas). Source size is unbounded by tokens.
  - **TIER 2 (fallback)**: a runtime-layer `pdf-parse` text-layer probe (`probePdfTextLayer`, ≥32 alnum chars = digital) decides per-PDF; scanned PDFs / images run the existing `document-extraction.service` OCR and mount a `<name>.ocr.txt` sidecar alongside the original. The tier decision lives entirely in the runtime worker — no sandbox round-trip.
- **Source-ref threading**: reuses the existing `RuntimeAttachmentRef.fileRef` + `objectKey` already carried on document jobs (`buildDataDocumentSourcePlan` reads `request.attachments[]`); no new enqueue→job-run plumbing was needed.

### Files touched (Slice 6)

- `apps/api/prisma/schema.prisma` + migration `apps/api/prisma/migrations/20260621000001_adr123_slice6_data_document/migration.sql` (additive enum values)
- `packages/runtime-contract/src/index.ts` (widened document unions + Office MIME allowlist + `document_code_generation` classification)
- `apps/runtime/src/modules/turns/runtime-document-tool.service.ts` (routing)
- `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service.ts` (`resolveExecutionShape`)
- `apps/runtime/src/modules/turns/interface/http/internal-runtime-document-jobs.controller.ts` (validation)
- `apps/runtime/src/modules/turns/runtime-document-provider-adapter.service.ts` (mode-B router, `runCodeDocumentPath`, `buildDataDocumentSourcePlan`, `probePdfTextLayer`, Office validation)
- `apps/sandbox/src/sandbox.service.ts` (`execute_document_code` + source/sidecar materialization + cleanup; `inferMimeType` xlsx/docx)
- `apps/api/prisma/tool-catalog-data.ts` + `apps/runtime/src/modules/turns/native-tool-projection.ts` (model-facing schema/guidance)
- Tests: `runtime-document-provider-adapter.service.test.ts`, `runtime-document-tool.service.test.ts`, `enqueue-runtime-deferred-document-job.service.test.ts`, `sandbox.service.test.ts`

### Deploy residual

The additive enum migration `20260621000001_adr123_slice6_data_document` must run at deploy (it pauses on the `persai-dev-migrations` GitHub Environment for approval before GitOps pinning per CI policy).

### Next recommended step

Proceed to **Slice 7** (tools — `grep`/`glob` inline + first-class `shell`), or run an end-to-end live smoke of mode B (a `create_data_document` xlsx with a mounted digital PDF source and a scanned-PDF OCR fallback) before continuing.

## 2026-06-20 — ADR-123 foundation (Slices 1–4) DEPLOYED & live-healthy on persai-dev — CHECKPOINT

### State

ArgoCD `persai-dev`: **`Synced` / `Healthy`** on `8bac8a63`. All `persai-dev` pods Running/Completed. Control-plane `sandbox` on image `2717fcf2` with the hardened ADR-123 manifest (both replicas `2/2`, `/ready` green); `sandbox-egress-proxy` (Squid) `1/1` stable. The native gVisor exec-pod runtime, secret-free split, deny-all egress + Squid allowlist, session-lived pods + GCS snapshot, and the exec image (`sandbox-exec`) are all live.

### Two gaps found only at live rollout — fixed

1. **Cluster-ops — `roles/cloudsql.client` for `sandbox-cp` (REQUIRED).** Sandbox now runs under `sandbox-sa` → `sandbox-cp` (not `api-sa`); its cloud-sql-proxy sidecar was denied (`403 cloudsql.instances.get`) → DB unreachable → `/ready` 503. Granted at project level (imperative `gcloud`); added to `infra/dev/gke/RUNBOOK.md` §2b so a cluster rebuild includes it.
2. **Egress-proxy non-root (commit `8bac8a63`).** Squid crash-looped on `FATAL: Cannot open '/dev/stdout' for writing` (root→proxy drop left stdout unwritable). Now runs directly as `proxy` uid/gid 13 + `fsGroup: 13`, `runAsNonRoot`, caps `drop: [ALL]` (no SETUID/SETGID). Benign `ICMP pinger Operation not permitted` log (no `NET_RAW`) does not affect L7 proxying.

ArgoCD had wedged in a phantom `operationState.phase=Running` (PreSync `api-migrate` hook Job stuck between `ttlSecondsAfterFinished` deletion and `hook-finalizer`); recovered by clearing the Job finalizer + stale `status.operationState`, then a clean fresh sync.

### Next recommended step

Foundation is live. Proceed to **Slice 5** (PDF cutover to in-sandbox Chromium; remove PDFMonkey; port template/print CSS; truncation-detector fix) per the program plan, or run an end-to-end sandbox smoke (a real `shell`/grep + pip-install-through-Squid job) before continuing.

## 2026-06-21 — ADR-123 Slice 5: PDF cutover (pdfmonkey → WeasyPrint/sandbox) — CHECKPOINT

### State

All verification gates **PASS**:

- `corepack pnpm -r --if-present run lint` → **PASS**
- `corepack pnpm run format:check` → **PASS**
- `corepack pnpm --filter @persai/api run typecheck` → **PASS**
- `corepack pnpm --filter @persai/web run typecheck` → **PASS**
- `corepack pnpm --filter @persai/runtime run typecheck` → **PASS**
- `corepack pnpm --filter @persai/provider-gateway run typecheck` → **PASS**
- `corepack pnpm --filter @persai/sandbox run typecheck` → **PASS**

### What changed

ADR-123 Slice 5: Full PDF rendering cutover from the external PDFMonkey SaaS API to in-sandbox WeasyPrint. The pdfmonkey provider is fully removed. The chunked PDF pipeline is removed (truncation re-routes now retry single-shot). Enhanced print CSS is always applied. Sandbox-produced PDF is downloaded, validated, persisted as canonical `runtime_output` artifact; the transient `sandbox_output` AssistantFile is soft-deleted.

### Key decisions

- **Render engine**: `render_html_to_pdf` toolCode in sandbox using WeasyPrint (already installed in exec image from Slice 4).
- **Chunked removal**: Entire chunked pipeline removed. Truncation now retries single-shot only.
- **Duplicate file handling**: Download PDF from GCS (via `mediaObjectStorage.downloadObject`) → validate → persist as `runtime_output` → delete transient `sandbox_output` via new `RuntimeAssistantFileRegistryService.deleteById()`.
- **Enhanced pagination**: `RUNTIME_DOCUMENT_ENHANCED_PAGINATION` env flag removed; always use `DOCUMENT_HTML_ENHANCED_PRINT_CSS`.
- **`documentProviderTemplateIds`**: Removed from `UpdateToolCredentialsInput` (pdfmonkey had template IDs; sandbox has none).
- **Prisma migration**: `ALTER TYPE "AssistantDocumentRenderProvider" RENAME VALUE 'pdfmonkey' TO 'sandbox'`.

### Files touched

| Subsystem                 | File                                                                                                       | Change                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Runtime contract          | `packages/runtime-contract/src/index.ts`                                                                   | `"pdfmonkey"→"sandbox"` in provider enums/types; remove pdfmonkey member from `ProviderGatewayDocumentGenerateRequest/Result` |
| Runtime bundle            | `packages/runtime-bundle/src/index.ts`                                                                     | Remove `pdfmonkeyTemplateId` from governance                                                                                  |
| Prisma schema             | `apps/api/prisma/schema.prisma`                                                                            | Rename enum value `pdfmonkey→sandbox`                                                                                         |
| Prisma migration          | `apps/api/prisma/migrations/20260621000000_adr123_render_provider_sandbox/migration.sql`                   | SQL rename                                                                                                                    |
| Prisma client             | Regenerated                                                                                                | `prisma generate`                                                                                                             |
| Runtime adapter           | `apps/runtime/src/modules/turns/runtime-document-provider-adapter.service.ts`                              | Major refactor: sandbox provider, `renderHtmlToPdf()` helper, chunked removal, CSS unification                                |
| File registry             | `apps/runtime/src/modules/turns/runtime-assistant-file-registry.service.ts`                                | Add `deleteById()`                                                                                                            |
| Document tool service     | `apps/runtime/src/modules/turns/runtime-document-tool.service.ts`                                          | Default provider → `"sandbox"`                                                                                                |
| Provider gateway client   | `apps/runtime/src/modules/turns/provider-gateway.client.service.ts`                                        | Remove pdfmonkey from `isDocumentGenerateResult`                                                                              |
| Document jobs controller  | `apps/runtime/src/modules/turns/interface/http/internal-runtime-document-jobs.controller.ts`               | Validate `"sandbox"` provider                                                                                                 |
| Provider gateway module   | `apps/provider-gateway/src/modules/providers/provider-gateway.module.ts`                                   | Remove `PdfMonkeyProviderClient`                                                                                              |
| Provider document service | `apps/provider-gateway/src/modules/providers/provider-document-generation.service.ts`                      | Remove pdfmonkey branch                                                                                                       |
| Run suite                 | `apps/provider-gateway/test/run-suite.ts`                                                                  | Remove pdfmonkey test                                                                                                         |
| Deleted                   | `apps/provider-gateway/src/modules/providers/pdfmonkey/pdfmonkey-provider.client.ts`                       | Deleted                                                                                                                       |
| Deleted                   | `apps/provider-gateway/test/pdfmonkey-provider.client.test.ts`                                             | Deleted (if existed)                                                                                                          |
| Tool credentials          | `apps/api/src/modules/workspace-management/application/tool-credential-settings.ts`                        | Remove all pdfmonkey entries; remove `documentProviderTemplateIds` field                                                      |
| Manage credentials        | `apps/api/src/modules/workspace-management/application/manage-admin-tool-credentials.service.ts`           | Remove `documentProviderTemplateIds` processing                                                                               |
| Enqueue job               | `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service.ts`   | `pdfmonkey→sandbox`; remove template gate                                                                                     |
| Job scheduler             | `apps/api/src/modules/workspace-management/application/assistant-document-job-scheduler.service.ts`        | `pdfmonkey→sandbox` in types and ternaries                                                                                    |
| Pricing catalog           | `apps/api/src/modules/workspace-management/application/tool-path-pricing-catalog.ts`                       | Remove pdfmonkey billing entry                                                                                                |
| Runtime tool policy       | `apps/api/src/modules/workspace-management/application/runtime-tool-policy.ts`                             | `pdfmonkey→sandbox`                                                                                                           |
| Materialize service       | `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts` | Remove `pdfmonkeyTemplateId`                                                                                                  |
| Web admin                 | `apps/web/app/admin/tools/page.tsx`                                                                        | Remove PDFMonkey credential/template UI                                                                                       |
| Web economics             | `apps/web/app/admin/tools/tool-path-economics.ts`                                                          | Remove PDFMonkey display name                                                                                                 |
| Seed data                 | `apps/api/prisma/site-page-seed-data.ts`                                                                   | Remove "PDFMonkey" from prose                                                                                                 |
| Docs                      | `docs/LIVE-TEST-HYBRID.md`                                                                                 | Remove PDFMonkey prerequisite                                                                                                 |
| Tests (runtime)           | `apps/runtime/test/runtime-document-provider-adapter.service.test.ts`                                      | Major update: sandbox mock helpers, remove pdfmonkey types                                                                    |
| Tests (runtime)           | `apps/runtime/test/runtime-document-job-run.service.test.ts`                                               | `pdfmonkey→sandbox`                                                                                                           |
| Tests (runtime)           | `apps/runtime/test/provider-gateway.client.service.test.ts`                                                | Remove pdfmonkey fixture                                                                                                      |
| Tests (sandbox)           | `apps/sandbox/test/sandbox.service.test.ts`                                                                | ADD `render_html_to_pdf` test                                                                                                 |

### Tests run

- All 5 typechecks: **PASS**
- All lint: **PASS**
- format:check: **PASS**
- `apps/runtime` test suite (`run-suite-isolated.ts`): **41 pass, 0 fail**
- `apps/api` test suite: **PASS**
- `apps/sandbox` test suite: **21 pass, 0 fail**
- `apps/provider-gateway` test suite: **PASS**

### Residuals / known risks

1. **Database migration** — `ALTER TYPE "AssistantDocumentRenderProvider" RENAME VALUE 'pdfmonkey' TO 'sandbox'` needs to run before deploying. The migration file is at `apps/api/prisma/migrations/20260621000000_adr123_render_provider_sandbox/migration.sql`.
2. **Sandbox render latency** — WeasyPrint render via exec pod adds ~5–15s vs ~3s pdfmonkey API. If this causes timeouts, increase `DEFAULT_DOCUMENT_TIMEOUT_MS` or the `workerTools.timeoutMs` in bundle governance.

### Next recommended step

1. Deploy Slice 5 to `persai-dev` and verify the `persai-dev` sandbox can render a PDF document via WeasyPrint.
2. Run full RUNBOOK §ADR-123 Slice 5 validation (create a PDF document end-to-end).
3. After live validation, proceed to Slice 6 (documents mode B — Excel/DOCX/data-PDF).

---

## 2026-06-20 — ADR-123 Slice 4: Exec image (Python + Node + doc/data stack + Chromium + ripgrep/fd) — CHECKPOINT

### What changed

Replaced placeholder `busybox:1.36` exec image with the real in-sandbox toolchain. `SANDBOX_EXEC_IMAGE` is now a GAR image built and pinned by CI as a standalone deploy service (`sandbox-exec`), separate from the control-plane `sandbox` service.

- **Exec image** (`apps/sandbox/exec-image/Dockerfile` + `requirements.txt`): `debian:bookworm-slim`; Python 3.11 venv at `/opt/venv` with pandas 3.0.3 / numpy 2.4.6 / matplotlib 3.11.0 / openpyxl 3.1.5 / python-docx 1.2.0 / weasyprint 69.0 / pdfplumber 0.11.10 / Pillow 12.2.0; Node.js 22 LTS (NodeSource); ripgrep (`rg`) + fd-find (symlinked to `fd`); headless Chromium; fonts-dejavu / fonts-liberation / fonts-noto / fonts-noto-cjk (Cyrillic + CJK); uid=1000/gid=1000 user `sandbox`; `ENV HOME=/workspace` (persists files + `pip --user`); regenerable caches redirected to ephemeral `/tmp` via `XDG_CACHE_HOME`/`MPLCONFIGDIR` so they don't pollute the persisted snapshot; `/workspace` dir created as mount point; build-time self-checks for all tools.
- **readOnlyRootFilesystem compliance**: all tools in immutable layers; runtime writes only to `/workspace` (emptyDir) and `/tmp` (emptyDir).
- **Chromium for Slice 5**: must run with `--no-sandbox --headless=new --user-data-dir=/tmp/chromium-profile`.
- **CI** (`scripts/ci/detect-affected.mjs`): `sandbox-exec` added to `APP_METADATA`; `classifyFile` routes `apps/sandbox/exec-image/**` → `sandbox-exec` deploy (not `sandbox`); `NON_WORKSPACE_DEPLOY_SERVICES` enables `sandbox-exec` on `workflow_dispatch`. 3 new tests in `detect-affected.test.mjs`.
- **SHA pinning** (`scripts/ci/pin-dev-image-tags.mjs`): `"sandbox-exec": "sandboxExec"` maps service name to YAML section.
- **Helm** (`infra/helm/values-dev.yaml` + `sandbox-deployment.yaml`): `sandboxExec.image` block added (`name: sandbox-exec`, `tag: dev-main`); `SANDBOX_EXEC_IMAGE` removed from `sandbox.env` and computed in the template as `{registry}/{project}/{repo}/{name}:{tag}` using `sandboxExec.image` with fallback to `global.images.tag`. Rendered: `europe-west1-docker.pkg.dev/.../persai/sandbox-exec:dev-main`.
- **sandbox-config.ts**: `busybox:1.36` default retained (local dev has no cluster; value satisfies Zod but is not used without a live k8s API). No runtime contract changes.

### Files touched

| File                                             | Purpose                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `apps/sandbox/exec-image/Dockerfile` (new)       | Exec image: full toolchain                                                |
| `apps/sandbox/exec-image/requirements.txt` (new) | Pinned Python package versions                                            |
| `scripts/ci/detect-affected.mjs`                 | `sandbox-exec` service + classifyFile routing + workflow_dispatch         |
| `scripts/ci/detect-affected.test.mjs`            | 3 new tests for sandbox-exec routing                                      |
| `scripts/ci/pin-dev-image-tags.mjs`              | `sandbox-exec` → `sandboxExec` section mapping                            |
| `infra/helm/values-dev.yaml`                     | `sandboxExec.image` block; remove `SANDBOX_EXEC_IMAGE` from `sandbox.env` |
| `infra/helm/templates/sandbox-deployment.yaml`   | Compute `SANDBOX_EXEC_IMAGE` from `sandboxExec.image`                     |
| `docs/CHANGELOG.md`                              | Slice 4 entry                                                             |
| `infra/dev/gke/RUNBOOK.md`                       | ADR-123 Slice 4 verification steps                                        |
| `docs/ADR/123-...md`                             | Slice 4 LANDED                                                            |

### Tests run

- `@persai/sandbox` test: **18/18 PASS** (no change — no TS code modified)
- `detect-affected.test.mjs`: **7/7 PASS** (4 pre-existing + 3 new Slice 4 tests)
- pin script dry-run: **PASS** (`Validated sandboxExec to abc123testsha.`)
- repo lint PASS · format:check PASS · `@persai/api`/`@persai/web`/`@persai/runtime`/`@persai/sandbox` typecheck PASS
- `helm lint` PASS · `helm template` PASS (SANDBOX_EXEC_IMAGE renders to GAR sandbox-exec image)
- Docker Desktop not running — local image build not attempted; build is CI/GAR-validated only

### Baseline SHA

`58187c43` (Slice 3)

### Residuals / next step

- Cluster-side validation (live): verify new exec pod image renders tools on PATH; run RUNBOOK §ADR-123 Slice 4 steps 1–8.
- Actual image build happens on first push of Slice 4 to `main` (CI builds `sandbox-exec` image and pins SHA in `sandboxExec.image.tag`).
- Next: ADR-123 **Slice 5** — PDF cutover (render HTML → PDF via in-sandbox headless Chromium; remove PDFMonkey; port print CSS in-house; correct truncation detector).

---

## 2026-06-20 — ADR-123 Slice 3: Per-session pod reuse, idle-TTL reaper, GCS workspace snapshot — CHECKPOINT

### What changed

Session-lived sandbox execution: pods are now reused across jobs within a session and the full workspace tree persists to GCS so ephemeral files survive pod recreates. No `apps/runtime` changes.

- **Session pod naming** (`exec-pod-bridge.service.ts`): `buildSessionPodName(runtimeSessionId)` derives a stable k8s-safe name `ses-<sha256[0..31]>` from the session ID. Sessionless jobs (null `runtimeSessionId`) retain the Slice 1 ephemeral `exec-<jobId>` create/delete behavior.
- **Pod reuse** (`exec-pod-bridge.service.ts`): `runInPod` dispatches to `runInSessionPod` or `runInEphemeralPod`. `runInSessionPod` calls `ensureSessionPodRunning` (checks k8s live state; reuses if Running, creates if absent, recreates if terminal), runs the command, updates `lastActivityAt`, and does NOT delete the pod afterward.
- **Idle-TTL reaper** (`exec-pod-bridge.service.ts`): `OnModuleInit` starts a `setInterval` that calls `runReaperTick()` every `SANDBOX_EXEC_REAPER_INTERVAL_MS` (default 2 min). Tick evicts session pods idle longer than `SANDBOX_EXEC_SESSION_IDLE_TTL_MS` (current default 15 min) by calling `deletePod`.
- **GCS workspace snapshot** (`sandbox.service.ts` + `sandbox-object-storage.service.ts`): `buildSessionSnapshotKey(assistantId, runtimeSessionId)` → `{prefix}/assistants/{assistantId}/sandbox-sessions/{runtimeSessionId}/workspace.tar`. After each successful session job, `saveSessionWorkspaceSnapshot` tars and uploads the workspace. On hydration (state token mismatch), `restoreSessionSnapshotOverlay` downloads and extracts the tar into a staging dir, then copies only files absent from the workspace (`fs.cp({ force: false })`) so declared files are never overwritten — avoids GNU-vs-BSD tar flag divergence. Missing snapshot handled gracefully.
- **Serialization**: existing `assistantId+workspaceId` Postgres lease mutex serializes all session jobs — no extra locking.
- **Config** (`sandbox-config.ts`, `values-dev.yaml`): `SANDBOX_EXEC_SESSION_IDLE_TTL_MS` (default 900000), `SANDBOX_EXEC_REAPER_INTERVAL_MS` (default 120000).

### Files touched

| File                                                 | Purpose                                                                                                                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/config/src/sandbox-config.ts`              | `SANDBOX_EXEC_SESSION_IDLE_TTL_MS` + `SANDBOX_EXEC_REAPER_INTERVAL_MS` config fields                                                                                          |
| `apps/sandbox/src/exec-pod-bridge.service.ts`        | Session pod reuse, `buildSessionPodName`, `runInSessionPod`, `ensureSessionPodRunning`, `runReaperTick`, `OnModuleInit`/`OnModuleDestroy` reaper wiring                       |
| `apps/sandbox/src/sandbox-object-storage.service.ts` | `buildSessionSnapshotKey` method                                                                                                                                              |
| `apps/sandbox/src/sandbox.service.ts`                | `saveSessionWorkspaceSnapshot`, `restoreSessionSnapshotOverlay`, `createTarFromDirectory`, `extractTarOverlay`; `ensureWorkspaceSessionHydrated` + `executeQueuedJob` updated |
| `infra/helm/values-dev.yaml`                         | `SANDBOX_EXEC_SESSION_IDLE_TTL_MS` + `SANDBOX_EXEC_REAPER_INTERVAL_MS` under sandbox env                                                                                      |
| `apps/sandbox/test/exec-pod-bridge.service.test.ts`  | Session pod naming, reuse, reaper tests (10 new)                                                                                                                              |
| `apps/sandbox/test/sandbox.service.test.ts`          | Session snapshot save/restore round-trip tests (4 new)                                                                                                                        |
| `apps/sandbox/test/sandbox-metrics.service.test.ts`  | Config fixture updated with 2 new fields                                                                                                                                      |
| `docs/CHANGELOG.md`                                  | Slice 3 entry                                                                                                                                                                 |
| `infra/dev/gke/RUNBOOK.md`                           | ADR-123 Slice 3 verification steps (§7 new steps)                                                                                                                             |
| `docs/ADR/123-...md`                                 | Slice 3 LANDED + warm pool DEFERRED noted                                                                                                                                     |

### Tests run

- `@persai/sandbox` test: **18/18 PASS** (8 pre-existing + 10 new Slice 3 tests)
- repo lint PASS · format:check PASS · `@persai/api`/`@persai/web`/`@persai/runtime`/`@persai/sandbox` typecheck PASS
- `helm lint` PASS · `helm template` PASS (new config vars visible in rendered sandbox Deployment)

### Baseline SHA

`a0336bed` (Slice 2)

### Residuals / next step

- Cluster-side validation (live): session pod reuse across real jobs; reaper eviction at TTL; workspace tar survives pod restart; declared files not overwritten. See RUNBOOK §ADR-123 Slice 3.
- `tar` soft-fail path not exercised in unit tests (intentional — tar not available in Windows CI env; integration/live verification covers it).
- Warm pool DEFERRED: cold-start (~2–4s gVisor) acceptable at current scale. Revisit when load evidence justifies it.
- Next: ADR-123 **Slice 4** — remaining slices per ADR work plan.

---

## 2026-06-20 — ADR-123 Slice 2: Egress proxy + deny-all exec pod network boundary — CHECKPOINT

### What changed

Kernel-level network isolation for gVisor exec pods: deny-all egress NetworkPolicy + trusted Squid forward proxy with domain allowlist. No `apps/runtime` changes.

- **NetworkPolicy** (`infra/helm/templates/networkpolicies.yaml`): `sandbox-exec-deny-egress` selects exec pods (`app.kubernetes.io/component: sandbox-exec`), `policyTypes: [Egress]`, default deny, allowing only kube-dns (UDP+TCP/53) and the proxy pod (TCP/3128) when `egressProxy.enabled`. `sandbox-egress-proxy-isolation`: ingress only from exec pods on 3128; egress to DNS + internet on TCP 80/443.
- **Egress proxy** (`infra/helm/templates/sandbox-egress-proxy.yaml`): Squid ConfigMap + Deployment + Service on port 3128; allowlist enforced via `acl allowed_domains dstdomain` + `http_access deny all`; hardened securityContext; writable emptyDirs for cache/logs/run.
- **Allowed domains**: `pypi.org` / `.pypi.org` / `files.pythonhosted.org` / `.files.pythonhosted.org` (pip) + `registry.npmjs.org` / `.registry.npmjs.org` (npm) — nothing else.
- **Config** (`packages/config/src/sandbox-config.ts`): `SANDBOX_EXEC_EGRESS_PROXY_URL` + `SANDBOX_EXEC_NO_PROXY` (both default `""`).
- **Bridge** (`apps/sandbox/src/exec-pod-bridge.service.ts`): `buildProxyEnv()` injects `HTTP_PROXY`/`HTTPS_PROXY`/`http_proxy`/`https_proxy`/`NO_PROXY`/`no_proxy` when proxy URL non-empty; empty URL = `env: []`. Zero secrets injected.
- **values-dev.yaml**: proxy URL and NO_PROXY set in sandbox env; `sandbox.egressProxy` block added.

### Files touched

| File                                                   | Purpose                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `packages/config/src/sandbox-config.ts`                | `SANDBOX_EXEC_EGRESS_PROXY_URL` + `SANDBOX_EXEC_NO_PROXY` config fields               |
| `apps/sandbox/src/exec-pod-bridge.service.ts`          | `buildProxyEnv()` method; `env: this.buildProxyEnv()` in `createExecPod`              |
| `infra/helm/templates/networkpolicies.yaml`            | `sandbox-exec-deny-egress` + `sandbox-egress-proxy-isolation` NetworkPolicies         |
| `infra/helm/templates/sandbox-egress-proxy.yaml` (new) | Squid ConfigMap + Deployment + Service                                                |
| `infra/helm/values-dev.yaml`                           | `SANDBOX_EXEC_EGRESS_PROXY_URL`, `SANDBOX_EXEC_NO_PROXY`, `sandbox.egressProxy` block |
| `apps/sandbox/test/exec-pod-bridge.service.test.ts`    | 2 new tests: proxy env injected when URL set; none when empty                         |
| `apps/sandbox/test/sandbox-metrics.service.test.ts`    | Config fixture updated with 2 new fields                                              |
| `docs/CHANGELOG.md`                                    | Slice 2 entry                                                                         |
| `infra/dev/gke/RUNBOOK.md`                             | ADR-123 Slice 2 verification steps                                                    |
| `docs/ADR/123-...md`                                   | Slice 2 marked LANDED                                                                 |

### Tests run

- `@persai/sandbox` test: 8/8 PASS (6 Slice 1 + 2 new proxy env tests)
- `sandbox-metrics.service.test.ts`: 1/1 PASS
- repo lint PASS · format:check PASS · `@persai/api`/`@persai/web`/`@persai/runtime`/`@persai/sandbox` typecheck PASS
- `helm lint` PASS · `helm template` PASS (renders all new resources correctly)

### Baseline SHA

`29a20860` (Slice 1)

### Residuals / next step

- Cluster-side validation (live): verify exec pods cannot reach internet directly; verify Squid allowlist enforcement against real registries (pypi.org pass, google.com denied). See RUNBOOK §ADR-123 Slice 2.
- Next: ADR-123 **Slice 3** — per-session container lifecycle, idle-TTL, warm pool, GCS-keyed `/workspace` rehydration.

---

### What changed

The single pre-first-tool "working preamble" string was replaced everywhere by an ordered per-step array `workingNotes: string[]` = the text the model writes before EACH tool call across all tool-loop iterations (empty array = no notes). The old `preambleText` / `workingPreamble` field is gone from contract, API, UI, persistence, and mapper.

- **Runtime** (`turn-execution.service.ts`): notes captured on EVERY `tool_calls` event (was once at `iteration === 0`) from that iteration's own `event.result.text` (per-iteration, not the cumulative `assembledText`). New pure exported `assembleWorkingNotesAndAnswer({ toolStepTexts, finalAnswerText, fullAssistantText })` → `{ workingNotes, answerText, assistantText }`; old `splitPreambleAndAnswer` removed. `answerText` taken from the final iteration's own corrected text (`correctedFinalAnswerText`), never the cumulative `providerResult.text` (the prior duplication bug); `assistantText` stays the verbatim cumulative corrected text.
- **Invariants** (locked in tests): `workingNotes`=each step once; `answerText`=final answer only; `assistantText`=each note once then answer; no-tools → `[]` + `answerText===assistantText`; empty answer after tools → `answerText=""`; whitespace-only note dropped.
- **Contract:** `RuntimeTurnResult.workingNotes: string[]` (`runtime-contract`); `AssistantWebChatMessageState.workingNotes` (string array) in `openapi.yaml`, contracts regenerated + formatted.
- **API:** done chunk + facade carry `workingNotes`; `persist-assistant-message.ts` writes `metadata.workingNotes` only when non-empty; mapper `extractWorkingNotesFromMetadata` → `string[]`. **Symptom-1 fix:** live `completed` transport in `stream-web-chat-turn.service.ts` (`runtimeWorkingNotes`) now includes `workingNotes` on the hand-built `assistantMessage` so the "Выполнено" block shows without reopening the chat.
- **UI:** `assistant-api-client.ts`, `use-chat.ts` (both `onCompleted` handlers), `chat-message.tsx` (`WorkingTextBlocks` reads `message.workingNotes` directly, no `\n\n` split).
- **Backfill:** `backfill-working-preamble.ts` → idempotent `backfill-working-notes.ts` (skip already-`workingNotes` rows; `workingPreamble` string → `[workingPreamble]`; legacy `:::working` markers → parsed array + cleaned content).

### Files touched

| File                                                                                                                                                                                                           | Purpose                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/runtime-contract/src/index.ts`                                                                                                                                                                       | `preambleText` → `workingNotes: string[]` on `RuntimeTurnResult`             |
| `packages/contracts/openapi.yaml` + `src/generated/model/assistantWebChatMessageState.ts`                                                                                                                      | `workingPreamble` → `workingNotes` (array); regenerated                      |
| `apps/runtime/src/modules/turns/turn-execution.service.ts`                                                                                                                                                     | per-step capture + `assembleWorkingNotesAndAnswer`; `buildTurnResult` rework |
| `apps/runtime/test/assemble-working-notes-and-answer.test.ts` (new) + `run-suite.ts` / `run-suite-isolated.ts`                                                                                                 | unit suite for the pure assembler; registered                                |
| `apps/runtime/test/turn-execution.service.test.ts`                                                                                                                                                             | multi-step capture + dedupe assertions (replaces split test)                 |
| `apps/api/.../web-runtime-stream-client.service.ts`, `assistant-runtime.facade.ts`, `persist-assistant-message.ts`, `stream-web-chat-turn.service.ts`, `web-chat-message-state.mapper.ts`, `web-chat.types.ts` | `workingNotes` end to end + Symptom-1 live transport                         |
| `apps/api/prisma/backfill-working-notes.ts` (+ `.test.ts`)                                                                                                                                                     | idempotent migration (replaces `backfill-working-preamble.*`)                |
| `apps/web/app/app/assistant-api-client.ts`, `_components/use-chat.ts`, `_components/chat-message.tsx`                                                                                                          | `workingNotes` on client + render                                            |
| api/web test suites                                                                                                                                                                                            | migrated off `workingPreamble`/`preambleText`                                |

### Tests run

- `runAssembleWorkingNotesAndAnswerTest`: PASS · `runTurnExecutionServiceTest`: PASS (multi-step fails on naive cumulative-as-answer impl — verified by temporary revert)
- `backfill-working-notes.test.ts`: 9/9 · `stream-web-chat-turn.service.test.ts`: 15/15 · `stream-native-web-chat-turn.service.test.ts`: 9/9
- web `chat-message` / `use-chat` / `chat-message-streaming`: 132/132
- repo lint PASS · format:check PASS · `@persai/api`/`@persai/web`/`@persai/runtime`/`@persai/runtime-contract` typecheck PASS

### Residuals / next step

Run `backfill-working-notes.ts` once in PROD to migrate legacy rows. No new ADR (follow-up to the prior preamble/answer split). Old field name remains only in the backfill's legacy-read paths and historical CHANGELOG/handoff entries.

## 2026-06-20 — ADR-122 Slice 1: maxOutputTokens + contextWindow model capabilities — CHECKPOINT

### What changed

Slice 1 of ADR-122: `maxOutputTokens` and `contextWindow` added as first-class admin-managed capability fields on the model catalog, carried onto routing slots, seeded with authoritative Anthropic values, and exposed in the admin UI.

**D1 (admin-managed fields + UI):**

- `RuntimeProviderModelProfileBase` gains `maxOutputTokens: number | null` and `contextWindow: number | null`.
- `normalizeModelProfiles()` in platform settings validates both fields via new `normalizeOptionalPositiveInteger()` helper (null allowed; bounds: max 1_000_000 / 2_000_000).
- Admin runtime page gains `NullableIntegerField` component + two inputs per model row ("Max output tokens", "Context window").

**D2 (routing slot enrichment):**

- Each `modelSlots` entry in routing types gains `maxOutputTokens?: number | null` and `contextWindow?: number | null`.
- `resolve-runtime-provider-routing.service.ts` enriches each slot via `lookupModelCapabilities()` — looks up the active catalog profile for `(providerKey, modelKey)` and attaches the values (null when not found).

**D5 (seeding):**

- `MODEL_CAPABILITY_DEFAULTS` table defined in `runtime-provider-profile.ts` with authoritative Anthropic values (7 models, all 200k context window at non-premium tier, maxOutputTokens per model). **[SUPERSEDED by Slice 2 corrective pass]** OpenAI was initially left null here — the corrective pass seeded the OpenAI families and moved default fold-in to read/write normalization.
- Seeding applied only at synthesis/legacy-row normalization — does not overwrite admin-set explicit values; null round-trips as null. **[SUPERSEDED by Slice 2 corrective pass]** known-model nulls are now coerced to the published ceiling at read/write so PROD persisted-null rows are correct without a manual save.

**Contracts:** `RuntimeProviderModelProfileCommonState` in `openapi.yaml` gains both optional nullable integer fields; contracts regenerated and formatted.

**Investigation result (storage model):** Catalog rows are persisted per-model in `platform_runtime_provider_settings.available_model_catalog_by_provider` as a JSONB column. They are synthesized at read-time from `available_models_by_provider` only if the catalog entry is absent. The seeding function `parseLegacyCapabilityCatalog()` / `createDefaultModelProfiles()` applies `MODEL_CAPABILITY_DEFAULTS` only when synthesizing new rows from the weight-only list — admin-set values in real persisted rows are untouched.

### Files touched

| File                                                                                                | Purpose                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/workspace-management/application/runtime-provider-profile.ts`                 | Added `maxOutputTokens`/`contextWindow` to `RuntimeProviderModelProfileBase`; updated `parseRuntimeProviderModelProfiles()`, `createDefaultModelProfiles()`, `parseLegacyCapabilityCatalog()`; defined `MODEL_CAPABILITY_DEFAULTS` |
| `apps/api/src/modules/workspace-management/application/platform-runtime-provider-settings.ts`       | Added `MAX_CONTEXT_WINDOW_VALUE`/`MAX_OUTPUT_TOKENS_VALUE` bounds; added `normalizeOptionalPositiveInteger()`; added both fields to `normalizeModelProfiles()`                                                                     |
| `apps/api/src/modules/workspace-management/application/runtime-provider-routing.types.ts`           | Added optional `maxOutputTokens`/`contextWindow` to each `modelSlots` slot shape                                                                                                                                                   |
| `apps/api/src/modules/workspace-management/application/resolve-runtime-provider-routing.service.ts` | Added `lookupModelCapabilities()` helper; enriched each routing slot                                                                                                                                                               |
| `apps/api/src/modules/workspace-management/application/tool-path-pricing-catalog.ts`                | Added `maxOutputTokens: null`/`contextWindow: null` to `base` to satisfy updated type                                                                                                                                              |
| `apps/api/test/platform-runtime-provider-settings.test.ts`                                          | Added ADR-122 normalization tests + seeding tests                                                                                                                                                                                  |
| `apps/api/test/runtime-provider-routing.test.ts`                                                    | Added ADR-122 slot enrichment tests                                                                                                                                                                                                |
| `apps/web/app/admin/runtime/page.tsx`                                                               | Added `NullableIntegerField` component; wired two new inputs per model row                                                                                                                                                         |
| `apps/web/app/admin/runtime/page.test.tsx`                                                          | Added ADR-122 input rendering, accept-positive-int, and reset-to-null tests                                                                                                                                                        |
| `packages/contracts/openapi.yaml`                                                                   | Added `maxOutputTokens`/`contextWindow` to `RuntimeProviderModelProfileCommonState`                                                                                                                                                |
| `packages/contracts/src/generated/model/runtimeProviderModelProfileCommonState.ts`                  | Regenerated                                                                                                                                                                                                                        |

### Tests run

- `apps/api/test/platform-runtime-provider-settings.test.ts`: PASS
- `apps/api/test/runtime-provider-routing.test.ts`: PASS
- `apps/web/app/admin/runtime/page.test.tsx`: 19/19 PASS
- `@persai/api` typecheck: PASS
- `@persai/web` typecheck: PASS
- `format:check`: PASS (all files)

### Baseline SHA

`bad3d5339eeaefd5cc13bd8442329fe37538eba8`

### Next recommended step

~~Slice 2 of ADR-122~~ — **done** (see checkpoint below).

---

## 2026-06-20 — ADR-122 Slice 2: unified output-budget resolver — CHECKPOINT

### What changed

Slice 2 of ADR-122 (D3 + D4): the single `resolveModelOutputBudget` pure helper, wired into every generation path. Fixes the root bug where main-chat-turn and tool-loop provider calls reached the Anthropic client with no `maxOutputTokens`, causing the `?? 1_024` fallback to truncate long answers.

**D3 — resolver (`apps/runtime/src/modules/turns/model-output-budget.ts`):** **[constants + formula below SUPERSEDED by the corrective pass — see the corrective-pass subsection further down for the authoritative `OUTPUT_BUDGET_MAX = 128_000` / `OUTPUT_BUDGET_FALLBACK = 8_192` and the thinking-aware formula]**

- `resolveModelOutputBudget(capability, ctx): number` — single pure function.
- Constants (initial cut, superseded): `OUTPUT_BUDGET_SANITY_CAP = 200_000` (replaced `DEFENSIVE_OUTPUT_TOKEN_CAP = 64_000`), `OUTPUT_BUDGET_FLOOR = 1_024`, `CONTEXT_SAFETY_RESERVE = 4_096`, `APPROX_BYTES_PER_TOKEN = 3`.
- Formula (initial cut, superseded): base = `maxOutputTokens ?? SANITY_CAP`; if `contextWindow` + `inputTokensEstimate` known: `ctxRoom = contextWindow - input - thinking - RESERVE`; `effective = min(base, ctxRoom)`; return `clamp(effective, FLOOR, SANITY_CAP)`.
- Unit tests: 9 assertions covering null maxOutputTokens, ctxRoom binding, thinking-budget subtraction, floor clamp, sanity clamp, both-null, null inputTokensEstimate (guard skipped), edge cases.

**D4 — wiring:**

- `turn-execution.service.ts` `prepareTurnExecution`: new `resolveSlotCapability()` reads `maxOutputTokens` + `contextWindow` from routing slot; computes `inputTokensEstimate` via char-based `estimateProviderRequestInputTokens()`; sets `maxOutputTokens` on the returned providerRequest via the resolver.

**Corrective pass (2026-06-20, founder-mandated PROD-correctness for BOTH providers):**

- **Resolver formula corrected** for thinking + safe fallback. New constants (replaced `OUTPUT_BUDGET_SANITY_CAP`): `OUTPUT_BUDGET_MAX = 128_000` (absolute cap on FINAL answer+thinking, = largest real ceiling), `OUTPUT_BUDGET_FALLBACK = 8_192` (base when `maxOutputTokens` null — safe on every mainstream model), `OUTPUT_BUDGET_FLOOR = 1_024`, `CONTEXT_SAFETY_RESERVE = 4_096`. New formula reserves thinking out of the total: `totalCeiling = min(maxOutputTokens ?? FALLBACK, MAX)`; `totalRoom = min(totalCeiling, contextWindow - input - reserve)`; `answer = totalRoom - thinkingBudget`; clamp `[FLOOR, MAX]`. This guarantees gateway `max_tokens = answer + thinkingBudget = totalRoom ≤ model ceiling`, eliminating the opus 128k + thinking 32768 = 160768 > 128000 overflow → 400.
- **OpenAI models seeded** in `MODEL_CAPABILITY_DEFAULTS` (gpt-5.1 / gpt-5.1-codex / gpt-5 / gpt-5-mini / gpt-5-nano = 400k ctx / 128k out; gpt-4o / gpt-4o-mini = 128k ctx / 16_384 out). Fixes OpenAI 400 (it sends `max_output_tokens` verbatim with no clamp). Unlisted OpenAI keys → `OUTPUT_BUDGET_FALLBACK`.
- **Family defaults folded in at READ + WRITE normalization** (not just synthesis): `parseRuntimeProviderModelProfiles` (DB read) and `normalizeModelProfiles` (admin-save) now coerce a KNOWN-model stored/blank null to the published ceiling; explicit admin value always wins; unknown model stays null. This fixes PROD rows persisted with the brand-new fields = null. Supersedes the earlier "null strictly round-trips" note for known models.
- **Turn-0 extended thinking enabled** — `prepareTurnExecution` now passes `turnThinkingBudget` to BOTH `buildProviderRequest` and the resolver (was previously only on the tool-loop refresh path). Fixes the ADR-121 wiring gap. Safe: gateway stream timeout is idle-based (resets on every provider event incl. thinking deltas) and watchdogs are disabled. Resolver + gateway receive the SAME thinkingBudget. Tool-loop inherits maxOutputTokens via spread.
- **Stream timeout confirmed:** `PROVIDER_GATEWAY_STREAM_TIMEOUT_MS = 90_000` (`packages/config/src/provider-gateway-config.ts:64`), IDLE timer (`anthropic-provider.client.ts:1405` `createTimedSignal` reschedules on `reset()`, called at the top of every stream-event iteration `:337`). Thinking deltas reset it. No change needed.
- `turn-execution.service.ts` `refreshProviderRequestMessages`: same pattern (was already passing thinkingBudget).
- `runtime-document-provider-adapter.service.ts` `resolveMaxOutputTokens`: refactored to delegate to `resolveModelOutputBudget`; `DEFENSIVE_OUTPUT_TOKEN_CAP = 64_000` removed.
- `anthropic-provider.client.ts`: `?? 1_024` replaced with `PROVIDER_FALLBACK_MAX_OUTPUT_TOKENS = 4_096` (4 occurrences). Thinking math preserved byte-for-byte.

**Scope discipline confirmed (grep):** auto-extract, turn-router, session-compaction, media-job-completion, background-task-evaluation all set their own named constant budgets — none touched.

### Files touched

| File                                                                                 | Purpose                                                                                                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/runtime/src/modules/turns/model-output-budget.ts`                              | New — pure resolver + constants                                                                                                                  |
| `apps/runtime/test/model-output-budget.test.ts`                                      | New — 9-case unit test suite                                                                                                                     |
| `apps/runtime/test/run-suite.ts`                                                     | Registered `runModelOutputBudgetTest`                                                                                                            |
| `apps/runtime/test/run-suite-isolated.ts`                                            | Registered `runModelOutputBudgetTest`                                                                                                            |
| `apps/runtime/src/modules/turns/turn-execution.service.ts`                           | Added `resolveSlotCapability`, `estimateProviderRequestInputTokens`; wired resolver in `prepareTurnExecution` + `refreshProviderRequestMessages` |
| `apps/runtime/src/modules/turns/runtime-document-provider-adapter.service.ts`        | Refactored `resolveMaxOutputTokens` to delegate to resolver; removed `DEFENSIVE_OUTPUT_TOKEN_CAP`                                                |
| `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts` | Replaced 4× `?? 1_024` with `PROVIDER_FALLBACK_MAX_OUTPUT_TOKENS = 4_096`                                                                        |
| `apps/runtime/test/turn-execution.service.test.ts`                                   | Added `OUTPUT_BUDGET_SANITY_CAP` import + maxOutputTokens regression assertion                                                                   |
| `apps/provider-gateway/test/anthropic-provider.client.test.ts`                       | Updated 3 test assertions for new fallback value                                                                                                 |

### Tests run

- `runModelOutputBudgetTest` (resolver unit test via run-one): **PASS**
- `runTurnExecutionServiceTest` (including new maxOutputTokens assertion): **PASS**
- `runRecentPdfsHintTests`: **PASS**
- `runAnthropicProviderClientTest` (thinking semantics preserved): **PASS**
- `@persai/api` typecheck: **PASS**
- `@persai/runtime` typecheck: **PASS**
- `@persai/provider-gateway` typecheck: **PASS**

### Baseline SHA

`bad3d5339eeaefd5cc13bd8442329fe37538eba8` (unchanged — Slice 2 not yet committed)

### Next recommended step

~~Slice 3 of ADR-122~~ — **done** (see checkpoint below).

---

## 2026-06-20 — ADR-122 Slice 3: truncation guard — CHECKPOINT

### What changed

Slice 3 of ADR-122 (D6): orthogonal `truncated?: boolean` signal propagated end-to-end so the model no longer continues a cut-off previous answer on the next turn.

**Contract:**

- `ProviderGatewayTextGenerateResult.truncated?: boolean` — new optional field, orthogonal to `stopReason` (which stays `"completed" | "tool_calls"`).
- `RuntimeTurnResult.truncated?: boolean` — propagated from the final provider result.

**Provider clients:**

- Anthropic (non-stream): `truncated: response.stop_reason === "max_tokens"` on the returned result.
- Anthropic (stream): `truncated: latestStopReason === "max_tokens"` on the `ProviderGatewayTextCompletedEvent` result.
- OpenAI (non-stream): `truncated: this.isMaxOutputTokensTruncation(response)` — new private helper checks `response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens"`.
- OpenAI (stream): the existing `response.incomplete` handler now checks if reason is `max_output_tokens`; if so yields a completed event with `truncated: true` (and the accumulated text) instead of a failed event. Other incomplete reasons still fail.

**Runtime:**

- `buildTurnResult` in `turn-execution.service.ts`: `...(providerResult.truncated === true ? { truncated: true } : {})` spread into the `RuntimeTurnResult`.

**API persistence path:**

- `assistant-runtime.facade.ts`: `truncated?: boolean` on `AssistantRuntimeWebChatTurnStreamChunk`.
- `web-runtime-stream-client.service.ts`: `...(event.result.truncated === true ? { truncated: true } : {})` on the `done` chunk.
- `persist-assistant-message.ts`: new `truncatedStatus?: "truncated"` field; `resolvedStatus = truncatedStatus ?? partialStatus` so `metadata.status` is one of `"partial"` (abort/stall) or `"truncated"` (max_tokens) or absent (clean).
- `stream-web-chat-turn.service.ts`: captures `truncated` from the done chunk; passes `truncatedStatus: isCompletedNormally && runtimeTruncated ? "truncated" : undefined` to persist.

**Hydration guard (`turn-context-hydration.service.ts`):**

- New `withTruncationMarker(content, message)` private method: for `author === "assistant"` messages with `metadata.status === "partial" | "truncated"`, appends `"\n\n[Note: the previous answer was interrupted before completion.]"` to the string content. Includes idempotency guard (checks for marker before appending). Applied in BOTH the summarized messages loop and the canonical web hydration loop (only for non-current-inbound messages).

### Files touched

| File                                                                                         | Purpose                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/runtime-contract/src/index.ts`                                                     | Added `truncated?: boolean` to `ProviderGatewayTextGenerateResult` and `RuntimeTurnResult`                                                                         |
| `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`         | Set `truncated` on non-streaming and streaming completed results                                                                                                   |
| `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`               | Added `isMaxOutputTokensTruncation()` helper; set `truncated` on non-streaming and streaming results; extracted max_output_tokens incomplete case from failed path |
| `apps/runtime/src/modules/turns/turn-execution.service.ts`                                   | Propagated `truncated` in `buildTurnResult`                                                                                                                        |
| `apps/api/src/modules/workspace-management/application/assistant-runtime.facade.ts`          | Added `truncated?: boolean` to `AssistantRuntimeWebChatTurnStreamChunk`                                                                                            |
| `apps/api/src/modules/workspace-management/application/web-runtime-stream-client.service.ts` | Forward `truncated` in the `done` chunk                                                                                                                            |
| `apps/api/src/modules/workspace-management/application/persist-assistant-message.ts`         | Added `truncatedStatus` field; unified into `resolvedStatus`                                                                                                       |
| `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`      | Captured `runtimeTruncated`; added to `streamRuntimeAttempt` return; passed `truncatedStatus` to persist                                                           |
| `apps/runtime/src/modules/turns/turn-context-hydration.service.ts`                           | Added `withTruncationMarker()`; applied in both message hydration loops                                                                                            |
| `apps/provider-gateway/test/anthropic-provider.client.test.ts`                               | Added max_tokens non-streaming + streaming truncation tests                                                                                                        |
| `apps/runtime/test/turn-context-hydration.service.test.ts`                                   | Added 4 truncation marker tests (partial, truncated, clean, idempotency)                                                                                           |
| `apps/runtime/test/turn-execution.service.test.ts`                                           | Added 2 `buildTurnResult` truncated-propagation tests                                                                                                              |

### Tests run

- `runAnthropicProviderClientTest` (incl. new ADR-122 Slice 3 truncation cases): **PASS**
- `runTurnContextHydrationServiceTest` (incl. new truncation marker tests): **PASS**
- `runTurnExecutionServiceTest` (incl. new truncated-propagation tests): **PASS**
- Full runtime suite `run-suite.ts`: **PASS**
- `corepack pnpm run format:check`: **PASS**
- `@persai/api` typecheck: **PASS**
- `@persai/runtime` typecheck: **PASS**
- `@persai/provider-gateway` typecheck: **PASS**
- `@persai/web` typecheck: **PASS**

### Baseline SHA

`bad3d5339eeaefd5cc13bd8442329fe37538eba8` (unchanged — Slices 1–3 not yet committed)

### Next recommended step

Commit Slices 1–3 of ADR-122 and push to trigger deploy (all three slices are in the working tree; they form a coherent unit). Optionally: close ADR-122 as landed once deployed and live-validated.

---

## 2026-06-20 — Tool-loop final answer loss fix — CHECKPOINT

### What changed

Production bug fix: tool-loop turns were persisting only the pre-tool preamble text while discarding the final answer after tools finished. Five consecutive tool-loop turns were confirmed persisting only 67–232 bytes while the model generated 488–680 tokens.

**Root cause (two coupled defects):**

1. API `case "completed"` gated acceptance of `event.result.assistantText` on `assistantText.startsWith(accumulated)` — runtime sanitization broke the prefix check, silently dropping the final text.
2. `:::working` markers were synthetic API-invented wrappers, not a real contract — `buildPersistedWorkingAssistantContent` / `demoteAccumulatedAnswerToWorking` wrote preamble markers into `content` instead of the real final answer.

**Fix:**

- `RuntimeTurnResult` now carries `preambleText: string | null` + `answerText: string` (split by runtime at first `tool_calls` in iter 0); `assistantText` kept as backward-compat field.
- `startsWith(accumulated)` gate removed from `case "completed"` in `web-runtime-stream-client.service.ts`; `finalAnswer` + `workingPreamble` forwarded on the `done` chunk.
- Entire `:::working` pipeline deleted from `stream-web-chat-turn.service.ts`; persisted `content = answerText`; `metadata.workingPreamble = preamble`; aborted/stalled turns persist `metadata.status = "partial"`.
- One-shot idempotent backfill `apps/api/prisma/backfill-working-preamble.ts` migrates legacy rows.
- Frontend `WorkingTextBlocks` now reads `message.workingPreamble`; all legacy `:::working` parsing removed from `chat-message-streaming.ts` and `use-chat.ts`.
- `AssistantWebChatMessageState` in `openapi.yaml` gains `workingPreamble?: string | null`; contracts regenerated.

### Files touched

| File                                                                                         | Purpose                                                                                                                               |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/runtime-contract/src/index.ts`                                                     | Added `preambleText`/`answerText` to `RuntimeTurnResult`                                                                              |
| `apps/runtime/src/modules/turns/turn-execution.service.ts`                                   | Capture preamble at first tool_calls; **exported pure `splitPreambleAndAnswer` + `buildTurnResult` delegates to it (regression fix)** |
| `apps/runtime/test/split-preamble-and-answer.test.ts`                                        | New: runtime unit suite for the preamble/answer split (spec item 6)                                                                   |
| `apps/runtime/test/run-suite.ts` / `run-suite-isolated.ts`                                   | Registered the new split suite                                                                                                        |
| `apps/runtime/test/turn-execution.service.test.ts`                                           | Added `preambleText`/`answerText` integration assertions (tool-loop + no-tools)                                                       |
| `apps/api/src/modules/workspace-management/application/assistant-runtime.facade.ts`          | Added `finalAnswer`/`workingPreamble` to stream chunk type                                                                            |
| `apps/api/src/modules/workspace-management/application/web-runtime-stream-client.service.ts` | Removed startsWith gate; forward new fields on done chunk                                                                             |
| `apps/api/src/modules/workspace-management/application/web-chat.types.ts`                    | Added `workingPreamble` to `AssistantWebChatMessageState`                                                                             |
| `apps/api/src/modules/workspace-management/application/web-chat-message-state.mapper.ts`     | Extract workingPreamble from metadata                                                                                                 |
| `apps/api/src/modules/workspace-management/application/persist-assistant-message.ts`         | Added `workingPreamble` + `partialStatus` to input; write to metadata                                                                 |
| `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts`      | Removed entire :::working pipeline; persist finalAnswer; partial status                                                               |
| `apps/api/prisma/backfill-working-preamble.ts`                                               | New: one-shot backfill for legacy rows                                                                                                |
| `packages/contracts/openapi.yaml`                                                            | Added `workingPreamble` to `AssistantWebChatMessageState`                                                                             |
| `packages/contracts/src/generated/model/assistantWebChatMessageState.ts`                     | Regenerated                                                                                                                           |
| `apps/web/app/app/assistant-api-client.ts`                                                   | Added `workingPreamble` to `ChatHistoryMessage`                                                                                       |
| `apps/web/app/app/_components/use-chat.ts`                                                   | Added `workingPreamble` to `ChatMessage`; remove demotion/working fns                                                                 |
| `apps/web/app/app/_components/chat-message-streaming.ts`                                     | Removed legacy working block functions                                                                                                |
| `apps/web/app/app/_components/chat-message.tsx`                                              | Read `workingPreamble` from message; removed splitWorkingMarkdownContent                                                              |
| `apps/api/test/stream-web-chat-turn.service.test.ts`                                         | Updated 2 old tests; added golden test 1+2+3+4                                                                                        |
| `apps/api/test/backfill-working-preamble.test.ts`                                            | New: golden test 5 (idempotency)                                                                                                      |
| `apps/web/app/app/_components/chat-message-streaming.test.ts`                                | Removed obsolete tests; new contract assertion                                                                                        |
| `apps/web/app/app/_components/chat-message.test.tsx`                                         | Updated 6 tests to use `workingPreamble` field                                                                                        |
| `apps/web/app/app/_components/use-chat.test.tsx`                                             | Updated 2 tests to new contract                                                                                                       |
| `docs/CHANGELOG.md`                                                                          | Entry added                                                                                                                           |

### Runtime split regression (follow-up, same slice)

The first cut of `buildTurnResult` mis-composed the split: `answerText = providerResult.text` (full `P+A`) and `assistantText = P + "\n\n" + answerText` → web duplicated the preamble into the answer (`"P A"`), Telegram got a doubled preamble (`"P\n\nP A"`). API golden tests missed it because they mock the runtime stream and inject `finalAnswer`/`workingPreamble` into `done` directly. Fixed via a pure `splitPreambleAndAnswer(fullText, preambleText)`: `assistantText` = full corrected text verbatim; `answerText` = full text with the captured preamble stripped (verbatim-prefix → left-trim retry → safe full-text fallback). New runtime unit suite + integration assertions added; the integration assertions fail on the buggy logic (verified by temporary revert) and pass after the fix.

### Tests run

- `apps/api/test/stream-web-chat-turn.service.test.ts`: 21/21 PASS
- `apps/api/test/backfill-working-preamble.test.ts`: PASS
- `apps/runtime/test/split-preamble-and-answer.test.ts`: PASS (new)
- `apps/runtime` full `runTurnExecutionServiceTest`: PASS (exit 0)
- Lint: PASS
- format:check: PASS
- `@persai/api` typecheck: PASS
- `@persai/web` typecheck: PASS
- `@persai/runtime` typecheck: PASS

### Next recommended step

1. **Run the backfill in PROD** after deploy: `corepack pnpm --filter @persai/api exec ts-node prisma/backfill-working-preamble.ts`. The script is idempotent. It will convert all legacy `:::working` rows to the new format.
2. **Verify** a live tool-loop turn in production to confirm the final answer is persisted correctly.

### Latest completed checkpoint

Both ADR-120 tracked residual follow-ups are resolved now that the parity backfill is complete and PROD `knowledge_vector_chunks` is uniform `vector(3072)` (982 rows, all text-embedding-3-large; 2 stale sources reindexed to 3072). Closure II is deployed (`1686ce2e`) and **live-verified in PROD**: migration applied (`rolled_back_at=null`), `knowledge_vector_chunks_embedding_hnsw_idx` exists and is used by the production query (`EXPLAIN` shows `Index Scan using …_hnsw_idx` on the `halfvec(3072)` ORDER BY), the two JSONB columns are gone from all three tables, and post-deploy reindex (incl. the founder's 4 product entries) produces 3072 vectors that land in the index. **ADR-120 and ADR-121 are now formally Closed** (docs reconciled: ADR headers, `AGENTS.md` closed-archive, `CHANGELOG`). This is the new checkpoint.

- **HNSW ANN index added.** Migration `20260620120000_adr120_drop_legacy_chunk_jsonb_and_hnsw` creates `knowledge_vector_chunks_embedding_hnsw_idx` on a `halfvec(3072)` expression (`halfvec_cosine_ops`) — pgvector 0.8.1 caps the bare `vector` type at 2000 dims for HNSW; the store is uniform 3072 so the cast is always valid. `KnowledgeVectorIndex.searchNearest` orders by `embedding_vector::halfvec(3072) <=> query::halfvec(3072)` and re-scores top-K at full `vector` precision. Column type unchanged (`vector(3072)`; no `ALTER ... TYPE`).
- **Legacy JSONB embedding columns dropped.** Same migration drops `embedding_vector` + `embedding_generated_at` from `assistant_knowledge_source_chunks`, `global_knowledge_source_chunks`, `product_knowledge_text_entry_chunks` (non-reversible). Those three tables remain the canonical TEXT store (`content`/`locator`/`embedding_model_key` kept). The indexing worker stops dual-writing the JSONB embeddings (vectors still flow to `KnowledgeVectorChunk`). The completed backfill runner/service + script + npm script were removed.
- Docs updated: `CHANGELOG` (Closure II entry), `DATA-MODEL` (legacy-chunk reconciliation + HNSW), ADR-120 (Closure II note), this handoff.

### Known item / next recommended step

- **4 empty product-knowledge entries — RESOLVED.** Founder re-indexed them post-deploy; all four active entries now have matching `chunkCount` and 3072-dim vectors in the store (the remaining 0-vector product entries are `archived`, which is correct — archived entries are not served).
- **Full retirement of the legacy `*_chunks` tables** themselves (currently the canonical text store: `content`/`locator` for lexical search, snippets, and `knowledge_fetch`) is a **deliberate keep** — assessed as medium-large work, low technical payoff, and would require a transient dual-write window. Not tech debt; the vector duplication was already removed in Closure II. Reopen only as its own ADR if architectural single-store purity is explicitly wanted.

## 2026-06-20 — ADR-120 landed (RAG/Knowledge unification + memory JIT) — CLOSURE

### Latest completed checkpoint

**ADR-120 landed** (`docs/ADR/120-rag-knowledge-unification-and-memory-jit.md`, status `Accepted` — closure-mode). Pull-first retrieval, single vector store, honest relevance, memory JIT. Implemented in seven bounded slices and pushed to `main` for the PROD deploy.

### Program commits (baseline SHAs)

- `d007025b` — ADR opened
- `0e36d959` — S1 (memory: retire pushed contextual short-memory block; `<persai_memory>` recency push gone; recall is pull-only)
- `7fd6eeb1` — S2 (memory: open loops scoped to current chat + open-only; index `20260619230000_adr120_memory_chat_scope_index`)
- `1ae3c201` — S3 (RAG engine: pgvector ANN candidate selection for document reads; idempotent parity backfill; legacy JSONB write retained)
- `fce1e698` — S4 (RAG precision: relevance floor on ALL sources; no-widen when rerank unavailable; empty result allowed; `MIN_CONTEXT_ITEMS` removed)
- `89046014` — S5 (pull-first unified: entire always-on server push subsystem removed — orchestrate service+controller+test, internal endpoint, runtime client method, `# Retrieved Knowledge Context` developer block, `RuntimeRetrievedKnowledgeContext*` types; project mode → pull-dispatch contract; `<persai_retrieved_knowledge>` push superseded by pull)
- `951580bd` — S6 (config: snippet-first default `smartSearchEnabled=false`; atomic `skill_knowledge_card` full-inline exception; `lean`/`balanced`/`rich` preset dropdown + Advanced disclosure in admin Plans UI)
- **closure commit (S7)** — docs + golden invariant lock; this commit is **HEAD-of-main after the Slice 7 push** (the orchestrator runs full-repo verification, commits, pushes for PROD deploy, then runs the post-deploy backfill).

### Closure slice (S7) — what landed

- Golden invariant locked in both prompt-snapshot tests (`apps/runtime/test/adr119-golden-prompt-snapshot.test.ts` + `apps/api/test/adr119-golden-prompt-snapshot.test.ts`): explicit negative assertions for no `<persai_memory>` push, no `# Retrieved Knowledge Context` block, no pushed `<persai_retrieved_knowledge>` block; positive check that `knowledge_search` / `knowledge_fetch` are the pull retrieval path. Golden tests green (api + runtime).
- Docs finalized: `CHANGELOG` (ADR-120 program entry), this handoff, ADR-120 status → Accepted/closure-mode + Closure section, and pull-first corrections in `API-BOUNDARY.md` / `DATA-MODEL.md` (removed-orchestrate-push staleness).

### Next recommended priority

1. **Run the post-deploy parity backfill in PROD:** `corepack pnpm --filter @persai/api run backfill:knowledge-vector-store` (idempotent) so `KnowledgeVectorChunk` is reconciled from existing source chunks before relying on ANN reads.
2. **Confirm vector-store reads are healthy** in PROD (relevance + result-count distributions via `KnowledgeRetrievalEvent`).
3. Then the two tracked residual follow-ups (NOT new scope, do NOT reopen ADR-120):
   - **HNSW ANN index** on `knowledge_vector_chunks.embedding_vector` — pin `vector(N)` after confirming the live embedding model/dimension, then build the `hnsw` (`vector_cosine_ops`) index (correct ANN already ships via sequential scan).
   - **Drop legacy JSONB chunk columns** — once PROD confirms vector reads healthy and the backfill ran (kept this release as rollback safety).

## 2026-06-19 — ADR-121 opened (routing 2D) — IN PROGRESS

### Scope

Post-119 audit (4 directions discussed with founder: A memory-bleeding JIT redesign, B scenario step progression, C routing 2D, D sandbox/shell). Founder priority order: **C first**. A/B/D each become their own ADR (A and D explicitly architecture waves; B is the founder-owned scenario-step ADR noted in the ADR-119 closure).

### What opened

**ADR-121** — `docs/ADR/121-two-dimensional-execution-routing-model-and-thinking-budget.md`, status `Accepted — 2026-06-19 (founder go)`. Separates the router's task-weight decision (`level: light|medium|heavy|deep`) from execution (`model + thinkingBudget`) via one pure resolver; retains `executionMode` as a derived model-slot token; plumbs a new `thinkingBudget` into the provider gateway (Anthropic Extended Thinking / OpenAI `reasoning_effort`); removes the `project→reasoning` and `deepMode→premium` hardcodes (both become weighted signals). Five slices.

### Audit findings grounded in code (for the slices)

- Router: `apps/runtime/src/modules/turns/turn-routing.service.ts` — `RoutingExecutionMode` (L27); deepMode ternaries L554/576/598/637/683/707/735/751; `coerceExecutionMode` L1223–1231; classifier schema enum L108–110; precheck term lists L167–258 (admin-overridable via `precheckRuleOverrides`).
- Project hardcode: `apps/runtime/src/modules/turns/project-execution-profile.ts:72` (`executionMode: "reasoning"`).
- executionMode → model slot: `resolve-runtime-provider-routing.service.ts` (primary/premium/reasoning model keys); plan config in `admin-plan-management.types.ts:166–171`.
- No thinking plumbing in provider clients today (only a mock ref in `anthropic-empty-completion.test.ts`).

### Operating contract (founder-set)

Orchestrator runs C end-to-end: assign slice → review diff → AGENTS.md gate + affected-area checks between slices → commit → next. Final slice runs full-repo "like CI" verification + repo-wide lint/format. **Push only at the very end** (push triggers deploy). No legacy tails, no transitional flag-gated old+new coexistence.

### Completed slices

- **Slice 1** (contract + `level → ExecutionProfile` resolver): `RoutingLevel` exported from `@persai/runtime-contract`; `RuntimeTurnRoutingSnapshot` gains optional `level` + `thinkingBudget`; `ProviderGatewayTextGenerateRequest` gains optional `thinkingBudget`; `resolveExecutionProfile` pure function + `DEFAULT_THINKING_BUDGET_BY_LEVEL` in `apps/runtime/src/modules/turns/execution-profile-resolver.ts`; full unit tests in `execution-profile-resolver.test.ts`. No routing change.
- **Slice 2** (router rewrite): see below.

### Slice 2 — completed 2026-06-19

**What changed:**

- `TurnRouteDecision` gains `level: RoutingLevel` and `thinkingBudget: number`; `CreateDecisionInput` exported as the `createDecision` input type (omits derived fields).
- `createDecision` is now the single resolver seat — accepts `CreateDecisionInput`, calls `resolveExecutionProfile(input.level)`, derives `executionMode` + `thinkingBudget`.
- Seven `deepMode ? "premium" : "normal"` ternaries + `coerceExecutionMode` deleted; replaced by `applyDeepModeNudge(level, deepMode): RoutingLevel` helper. `executionModeToLevel` and `asLevel` helpers added.
- `reasoning_request` precheck: new `DEFAULT_DEEP_CUE_TERMS`; base level is `heavy` (code/reasoning terms, PDF), `deep` only on explicit depth cues ("think hard", "проанализируй", etc.). Old hardcode of `executionMode: "reasoning"` removed.
- `premium_writing` base level `medium`; deepMode nudges to `heavy` (thinking budget but same premium model slot).
- `buildProjectModePrecheckDecision` returns `CreateDecisionInput`; `level: deepMode ? "deep" : "heavy"` (old `executionMode: "reasoning"` hardcode deleted).
- `applyGroundedSkillLevelFloor` (renamed from `applyGroundedSkillPremiumFloor`): floors on `level !== "light"`, raises to `medium` via resolver. Telemetry label `grounded_skill_retrieval_premium_floor` unchanged.
- `ROUTER_OUTPUT_SCHEMA`: `executionMode` enum replaced with `level` enum `["light","medium","heavy","deep"]`.
- `parseClassifierDecision`: parses `level` (required) instead of `executionMode`; `fallbackMode` still parsed via `asExecutionMode`.
- Classifier fallback/failure path: uses `fallbackLevel = applyDeepModeNudge(executionModeToLevel(policy.classifierFailureFallbackMode), deepMode)` → `fallbackMode = resolveExecutionProfile(fallbackLevel).executionMode`.
- `toRuntimeTurnRoutingSnapshot` in `turn-execution.service.ts`: adds `level` and `thinkingBudget` to persisted snapshot.
- `defaultRouteDecision` in `turn-execution.service.ts`: derives `executionMode`/`thinkingBudget`/`fallbackMode` from `resolveExecutionProfile`.
- Tests updated: `turn-routing.service.test.ts`, `project-execution-profile.test.ts`, `turn-execution.service.test.ts` — all classifier JSON fixtures use `level` instead of `executionMode`; new invariant cases: deep cue → deep, reasoning_request → heavy (CHANGED from reasoning), project+deepMode off → heavy/premium, deepMode light → medium, premium_writing+deepMode → heavy.

**Behavior invariants verified:**

- `light` + deepMode off → `normal` ✓
- `light` + deepMode on → `medium` / `premium` ✓
- `premium_writing` + deepMode off → `medium` / `premium` / budget 0 ✓
- `premium_writing` + deepMode on → `heavy` / `premium` / budget 8192 ✓
- `reasoning_request` (no deep cue, deepMode off) → `heavy` / `premium` / budget 8192 ✓ (CHANGED)
- `reasoning_request` deep cue → `deep` / `reasoning` / budget 32768 ✓
- `project` deepMode off → `heavy` / `premium` / budget 8192 ✓ (CHANGED)
- `project` deepMode on → `deep` / `reasoning` / budget 32768 ✓
- grounded-skill light → `medium` / `premium` / budget 0, reasonCode suffix preserved ✓
- Snapshot carries `level` + `thinkingBudget` ✓

### Slice 3 — completed 2026-06-19

**What changed:**

- `buildProviderRequest` in `turn-execution.service.ts` gains trailing `thinkingBudget: number = 0`; spreads `{ thinkingBudget }` into the returned request only when `> 0`. Default `0` preserves all other callers (background worker, tool-loop continuation via spread).
- Main-turn caller at ~line 5266 passes `execution.routeDecision.mode === "active" ? execution.routeDecision.thinkingBudget : 0` — shadow mode never sends thinking (model role is not applied in shadow).
- `provider-text-generation.service.ts`: `assertValidThinkingBudget` added; rejects non-integer or negative; called in `assertValidRequest` after `assertValidTimeoutMsHint`.
- `anthropic-provider.client.ts`: private `supportsExtendedThinking(model)` — regex `/claude-(opus-4|sonnet-4|haiku-4|3-7-sonnet)/i`; in both `generateText` (typed payload, cast via `unknown`) and `streamText` (untyped `Record<string,unknown>`): when `thinkingBudget >= 1024` and capable model, sets `thinking: { type:"enabled", budget_tokens }` and `max_tokens = (maxOutputTokens ?? 1024) + thinkingBudget`.
- `openai-provider.client.ts`: private `supportsReasoning(model)` — regexes `/^o[0-9]/i` (o-series) or `/(^|[^a-z])gpt-5/i` (gpt-5 family); `reasoningEffortForBudget(budget)` — `<= 10k → "low"`, `<= 25k → "medium"`, `> 25k → "high"`; in both `generateText` (cast via `unknown`) and `streamText` (untyped): when `thinkingBudget > 0` and capable model, sets `reasoning: { effort }`.
- Tests: `anthropic-provider.client.test.ts` — capable model + 8192 → thinking emitted in generateText + streamText; non-capable (`claude-3-5-sonnet-latest`) → none; budget 0/undefined/500 → none; maxOutputTokens + budget formula verified. `openai-provider.client.test.ts` — o3 + 8192 → low; o3 + 20000 → medium; o3 + 32768 → high; gpt-4.1 + 8192 → none; budget 0/undefined → none. `provider-text-generation.service.test.ts` — negative/non-integer rejected; 0 and positive integers accepted.

**Behavior effect:** heavy/deep active-mode turns on capable models now send thinking. Shadow mode: thinking suppressed (model role not applied in shadow). Non-capable models: budget silently ignored.

**Gate:** lint PASS · format:check PASS · api/web/runtime/provider-gateway/runtime-contract typecheck all PASS · provider-gateway tests PASS (exit 0) · runtime tests PASS (exit 0).

- **Slice 4** (per-plan `thinkingBudgetByLevel` config, end-to-end): see section below.

### Slice 4 — completed 2026-06-19

**What changed:**

- `packages/contracts/openapi.yaml`: Added `AdminPlanThinkingBudgetByLevel` schema (flat object `{ light, medium, heavy, deep }`, each `integer | null`, all four required), referenced optionally from `AdminPlanState` and `AdminPlanInputBase`.
- `packages/contracts/src/generated/`: Regenerated — added `adminPlanThinkingBudgetByLevel.ts`; `adminPlanState.ts` + `adminPlanInputBase.ts` gain optional `thinkingBudgetByLevel` property.
- `apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts`: Added `AdminPlanThinkingBudgetByLevel` type; `AdminPlanInput` + `AdminPlanState` both gain `thinkingBudgetByLevel: AdminPlanThinkingBudgetByLevel`.
- `apps/api/src/modules/workspace-management/application/thinking-budgets-policy.ts` (new): Schema const `"persai.thinkingBudgetByLevel.v1"`; `createDefaultPlanThinkingBudgetByLevel` (all null); `resolveStoredPlanThinkingBudgetByLevel` (lenient DB reader); `parsePlanThinkingBudgetByLevel` (strict PATCH validator, rejects negatives/non-integers, accepts 0 and null); `toPlanThinkingBudgetByLevelDocument` (stores `{ schema, byLevel: { light,medium,heavy,deep } }`); `hasAnyThinkingBudgetOverride`.
- `apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts`: Parse on input, conditional write into `billingProviderHints` (omit when all null), read back via `resolveStoredPlanThinkingBudgetByLevel` into `AdminPlanState`.
- `packages/runtime-contract/src/index.ts`: Added `RuntimeThinkingBudgetByLevelConfig` — `{ byLevel: { light, medium, heavy, deep } | null }`, each leaf `number | null`.
- `packages/runtime-bundle/src/index.ts`: `AssistantRuntimeBundleRuntimeConfig` gains `thinkingBudgetByLevel?: RuntimeThinkingBudgetByLevelConfig | null`.
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`: Added `resolvePlanThinkingBudgetByLevel()` (mirrors `resolvePlanToolBudgets`); conditionally spreads `thinkingBudgetByLevel` onto the runtime bundle when any leaf is non-null.
- `apps/runtime/src/modules/bundles/runtime-bundle-registry.service.ts`: Added `assertThinkingBudgetByLevelConfig()` (validates each leaf is null or non-negative integer); called from `warmBundle` alongside `assertToolBudgetsConfig`.
- `apps/runtime/src/modules/turns/turn-routing.service.ts`: `readThinkingBudgetOverrides(bundle)` extracts non-null leaves into `ThinkingBudgetOverrides`; threaded as a parameter (no singleton state) through `createDecision`, `applyGroundedSkillLevelFloor`, and `runPrecheck` (and each internal `createDecision` call site); passed to every `resolveExecutionProfile` call.
- `apps/web/app/admin/plans/page.tsx`: Four new draft string fields (`thinkingBudgetLight/Medium/Heavy/Deep`); plan→draft mapping; draft→payload parsing via `parseStrictIntegerDraft({ min: 0, allowBlank: true })`; new "Thinking budget by level (tokens)" form section with four inputs; `emptyDraft()` updated.
- Tests: new `apps/api/test/thinking-budgets-policy.test.ts`; extended `manage-admin-plans.service.test.ts`, `runtime-bundle-registry.service.test.ts`, `turn-routing.service.test.ts`, `apps/web/app/admin/plans/page.test.tsx`.

**Persisted document shape:** `billingProviderHints.thinkingBudgetByLevel = { schema: "persai.thinkingBudgetByLevel.v1", byLevel: { light: number|null, medium: number|null, heavy: number|null, deep: number|null } }` — omitted when all leaves are null.

**Gate:** contracts:generate PASS · lint PASS · format:check PASS · api/web/runtime/provider-gateway/runtime-contract typecheck all PASS · api tests PASS (exit 0) · runtime tests PASS (exit 0) · web tests PASS (69 files, 797 tests).

### Slice 5 — completed 2026-06-19

**What changed:**

- `apps/runtime/test/execution-profile-resolver.test.ts`: Added `describe("ADR-121 Slice 5 — golden grid")` — table-driven, 13 test cases covering 4 levels × 3 plan-override configs (no override / partial `heavy=4096` / full `light=100, medium=200, heavy=300, deep=400`) asserting `{ level, executionMode, modelRole, thinkingBudget }` for every cell; plus an "overrides are invariant on modelRole/executionMode" assertion. Exported `runExecutionProfileResolverTest` (no-op; node:test keeps process alive).
- `apps/runtime/test/turn-routing.service.test.ts`: Added `projectedToolsNoKB` constant; added `runSlice5SignalCombinationTests()` covering: KB-availability axis (product_knowledge_intent fires with KB / falls to simple_turn without KB), deepMode × retrieval_intent (light→medium), deepMode saturation (deep+deepMode→deep capped), Russian deep cue ("проанализируй" standalone → level=deep without deepMode), chatMode="normal" non-interference (code-heavy → heavy), chatMode="smart" non-interference (premium writing → medium), snapshot-shape assertion for heavy-level project-mode turn (`level=heavy`, `executionMode=premium`, `thinkingBudget=8192`), partial medium-only override via router (medium=500; heavy stays 8192), full four-level override via router (all four levels use custom budget values).
- `apps/runtime/test/run-suite-isolated.ts`: Added `{ modulePath: "./execution-profile-resolver.test.ts", exportName: "runExecutionProfileResolverTest" }` so the resolver suite is part of the test runner.
- `apps/runtime/src/modules/turns/turn-routing.service.ts` (**production bug fix discovered via Slice 5 tests**): Added `|| this.matchesAny(lowerText, DEFAULT_DEEP_CUE_TERMS)` to the `reasoning_request` branch entry guard (was only checked inside the branch). A message matching only a deep-cue term (e.g. "проанализируй этот баг") without any `DEFAULT_REASONING_TERMS` match previously fell through to `simple_turn`, violating ADR-121 §D6.

**Snapshot-shape test:** A project-mode turn with `chatMode="project"` and `deepMode=false` is routed by `TurnRoutingService.decide()` and the result asserts `level="heavy"`, `executionMode="premium"`, `thinkingBudget=8192`, `source="precheck"`. `toRuntimeTurnRoutingSnapshot` in `turn-execution.service.ts` copies these fields verbatim into `RuntimeTurnRoutingSnapshot`; the routing decision is the authoritative source.

**Test matrix dimensions:**

- Resolver golden grid: 4 levels × 3 override configs × 4 fields = 48 assertions + 4-level invariant loop
- Router signal-combination: KB axis (2), deepMode×retrieval (1), deepMode saturation (1), Russian deep cue (1), chatMode=normal (1), chatMode=smart (1), snapshot-shape (4), partial override (2), full override (4) = 17 test scenarios

**Gate:** lint PASS · format:check PASS · `@persai/runtime` typecheck PASS · `@persai/runtime run test` PASS (all suites, exit 0).

### Next recommended step

ADR-121 fully implemented + pushed (`12be30f3..26ec22a1`) + deployed to `persai-dev`. Live validation on `persai.dev` confirmed 2D routing applied in active mode: same chat routed light chit-chat → `claude-sonnet-4-6`, heavy code task → `claude-opus-4-6`, deep cue ("проанализируй …") → `claude-opus-4-8` (the Slice 5 deep-cue fix path). Live-found follow-up: the deep turn truncated mid-sentence (no clean `stream-end`) because the stale `slow_avg` cadence watchdog tripped on the reasoning model's slower visible-text cadence and aborted the runtime fetch. **Fixed:** `slowAvgEnabled: false` for normal/smart in `resolveWebStreamCadenceWatchdogOptions` (watchdog now fully inert; scaffolding/telemetry/retry retained, real hangs still guarded by `PERSAI_RUNTIME_STREAM_TIMEOUT_MS`). Gate green (api lint/format/typecheck + focused test). **Next:** commit the watchdog fix and push (triggers deploy), then re-validate a deep turn on `persai.dev` completes without truncation. Remaining post-119 backlog (separate ADRs, not started): A memory-bleeding JIT redesign, B scenario step progression, D sandbox/shell.

## 2026-06-19 — ADR-119 program closed (founder acceptance)

### Baseline

- Docs-only closure slice. Baseline SHA: `62ca8f5a` (working tree: `.gitignore` modified; `tmp/` uncommitted validation artifacts).

### What closed

**ADR-119** — formally closed with founder sign-off. Status header updated to `Closed — 2026-06-19 (founder acceptance; program complete)`. § Founder acceptance closure added to the ADR footer.

**Live evidence (local, `tmp/adr-119-slice-1-validation/`):**

- Cache/payload assembly: **GREEN** (multi-turn cache hits, three-zone prompt shape confirmed).
- Scenario gate (c) Instagram carousel + sneaker photo: **PARTIAL** — engage solo, active-scenario volatile blocks, release OK; step-by-step adherence **not** green (model collapse; no `activeStepNumber` in runtime state).

**Explicit deferral:** scenario step progression, hard early-step tool guards, full live matrix (a)(b)(d)(e) → **founder's next ADR**, not ADR-119 slices.

**AGENTS.md** updated: ADR-118 + ADR-119 moved to closed archive; no open orchestration program ADR except user-started work.

### Residual (not ADR-119)

- ADR-117 `cache-prefix rollout SHA` — still closure-mode pending item.
- Scenario runtime follow-up — new ADR (founder-owned).

### Next recommended step

Author the follow-up ADR (scenario step state + acceptance criteria), then implement as bounded slices. Do not reopen ADR-119.

## 2026-06-19 — ADR-119 polish: Anthropic sliding history cache marker fix + "legacy" cleanup

### Baseline

- Baseline SHA at session start: `1340ebb9` (clean except prior-session uncommitted byte-conversion in the Anthropic client+test — confirmed as legitimate prerequisite, folded into commit 2).
- This slice's commits: `c98600ba` (Step 0 cross-cutting), `c5542ce2` (Step 1 Anthropic). Docs commit follows.

### What closed

1. **Sliding history marker (#2 of 2) now actually fires.** `applyAnthropicMovingHistoryBreakpoint` formula corrected from `floor((total − minTail) / minTail) * minTail` (required ~6k tokens before firing → history caching effectively disabled in prod) to `floor(total / minTail) * minTail` (fires at one full 3k-token chunk, stays stable inside a chunk, advances across each boundary). Tail buffer removed — the dynamic tail (`volatile_context` + current question) is already spliced in after the marker. Byte-based measurement (3 UTF-8 bytes/token) folded in for Cyrillic/mixed content.
2. **"legacy" wording removed** from the active single-block system-prompt path (Anthropic client JSDoc/comments, `turn-execution.service.ts` `buildProviderRequest`, runtime-contract JSDoc).
3. **Dead multi-block seam removed (Variant B / no-dead-stubs):** `systemPromptBlocks` field, `buildAnthropicSystemBlocks` multi-block branch, `ANTHROPIC_MAX_SYSTEM_CACHE_MARKERS`, OpenAI per-block branch, related tests. `rg "systemPromptBlocks" --type ts` returns only one explanatory JSDoc reference.

### Untouched by design

`compile-prompt-constructor.service.ts` (Slice 2 multi-block — rejected), `attachCacheControlToLastBlock` + `measureAnthropicMessageContentBytes` (prior-session fixes, verified in place), the `shouldApplyAnthropicMovingHistoryBreakpoint` `main_turn`-only gate (protects against caching raw `tool_result`), the volatile-context splice in `buildAnthropicMessages`.

### Target Anthropic config

**2/4 `cache_control` markers used:** #1 single-block system marker (caches tools + whole system) + #2 sliding history marker. **Slice 2 multi-block system (#3/#4) explicitly REJECTED ON REVIEW** (not deferred) — minimal practical gain because the single-block system marker already caches tools + the entire system zone, and PersAI's prefix zones invalidate together on publish, not independently. Recorded in the ADR-119 footer.

### Gate

`lint` PASS · `format:check` PASS · `@persai/api` typecheck PASS · `@persai/web` typecheck PASS · `@persai/provider-gateway` test PASS (exit 0, full suite incl. Anthropic) · `@persai/runtime` + `@persai/provider-gateway` typecheck PASS.

### Next recommended step

~~Push the 3 commits, wait for CI green + GitOps reconcile in dev, then run the live validation…~~ Superseded by ADR-119 founder acceptance closure (top section).

## 2026-06-18 — ADR-119 follow-up: Anthropic moving-history-breakpoint fix for tool-loop conversations

### Root cause

Founder live-test observation: `inputTokens` per turn kept climbing past the 3,000-token `anthropicHistoryBreakpointMinTokens` threshold even on long conversations — the moving history `cache_control` marker was never landing on assistant messages. Symptom: a 14k cached prefix grows to 20k+ over a long chat and every turn re-pays the per-turn input cost.

Audit of `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts` revealed four compounding bugs:

1. `applyAnthropicMovingHistoryBreakpoint` used a now-deleted `resolveAnthropicHistoryBreakpointText` helper that returned `null` whenever an assistant message's content was anything other than a single `text` block. The provider client emits `toolHistory` exchanges as `assistant: [{ type: "tool_use", … }]` + `user: [{ type: "tool_result", … }]`. **Any** turn where the model called a tool produces pure-`tool_use` assistant messages — i.e. the breakpoint silently skipped real production tool-loop conversations entirely.
2. When a candidate was found, the function **destructively replaced** the message's content array with `[{type:"text", text: …, cache_control: …}]`, which would have corrupted multi-block messages (e.g. text+tool_use, image content).
3. `measureAnthropicTextTailChars` (the byte counter feeding the chunked-cache math) only counted `text` block lengths; `tool_use` JSON args and `tool_result` content contributed zero. On tool-heavy turns the chunked math therefore under-estimated the prefix size, biasing the candidate-search threshold toward "not enough yet" and pushing the marker further back even when it could have placed.
4. `countAnthropicCacheBreakpoints` walked `system` and `tools` only — even when the moving marker was placed, the `cacheBreakpoints=N` log line stayed at the system-prefix count, masking the bug from operations.

### Fix scope

- **`AnthropicBuiltMessageContent` type** — extended to allow `cache_control?: AnthropicPromptCacheControl` on `image`, `document`, `tool_use`, and `tool_result` blocks (previously text-only).
- **`applyAnthropicMovingHistoryBreakpoint`** — rewritten. Accepts **any** assistant message as a candidate, walks chunked-cache math (`totalContentChars`, `minTailChars`, `targetBoundary`, `maxCachedPrefixChars`) using the new `measureAnthropicMessageContentChars`, and delegates marker placement to the new `attachCacheControlToLastBlock` helper.
- **`attachCacheControlToLastBlock`** (new) — non-destructively clones the candidate message; if content is a string, wraps it in a single `text` block carrying `cache_control`; if content is an array, walks blocks back-to-front and attaches `cache_control` to the **last** block whose type accepts it (text/image/document/tool_use/tool_result).
- **`measureAnthropicMessageContentChars`** (renamed from `measureAnthropicTextTailChars`) — counts `text` text length, `tool_use` `JSON.stringify(input ?? {}).length`, and `tool_result` string-content length. `image` and `document` blocks count as zero (base64 data is not part of the textual cache key Anthropic uses).
- **`countAnthropicCacheBreakpoints`** — extended to also walk `payload.messages` so the `[anthropic-non-stream-start]` / `[anthropic-stream-start]` log lines surface message-level markers (operational visibility for ops + future cache audits).

### Tests

- `apps/provider-gateway/test/anthropic-provider.client.test.ts` — full existing breakpoint suite passes unchanged.
- New `toolHistoryBreakpointRequest` case — supplies a single tool exchange via `toolHistory` (the realistic prod path), forces the breakpoint via `anthropicHistoryBreakpointMinTokens: 10`, asserts:
  - the pure-`tool_use` assistant message emitted from `toolHistory` is byte-preserved (no destructive content rewrite);
  - `cache_control: { type: "ephemeral" }` is correctly attached to the last (and only) `tool_use` block;
  - the user-side `tool_result` message stays byte-identical (markers belong to assistant turns, not user replies).
- New `shortToolHistoryRequest` case — tiny `toolHistory` payload + 1-char user message asserts that the chunked-cache math still gates correctly and **no** marker is placed when the history is below the breakpoint threshold (guards against over-aggressive caching on short turns).

### Files touched

- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Gate

- `corepack pnpm --filter @persai/provider-gateway run lint` PASS
- `corepack pnpm run format:check` PASS (one auto-fix applied to the test file)
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm --filter @persai/runtime run typecheck` PASS
- `corepack pnpm --filter @persai/provider-gateway run typecheck` PASS
- `corepack pnpm --filter @persai/provider-gateway run test` PASS (full suite, incl. 2 new tool-loop cases)

### Cache prefix impact

None on the **system prefix** — the fix only changes per-turn placement of `cache_control` markers inside `messages[]`. Anthropic now sees the message-history cache key it was always supposed to see, so post-deploy:

- Conversations with no tool calls: marker placement already worked → no behavior change.
- Conversations with tool calls (the prod-realistic case): first post-deploy turn writes the message-history cache (`cache_creation_input_tokens` rises by the cached chunk size); subsequent turns reuse it (`cache_read_input_tokens` grows accordingly; `inputTokens` per turn drops).
- `cacheBreakpoints=N` log line now reflects total markers (system + tools + messages) instead of system+tools only — operations should expect higher values post-deploy.

### Live-test validation plan (next session)

1. Open chat → call 2-3 tools across 3-4 turns → `kubectl logs deployment/persai-provider-gateway -f` and watch `cacheBreakpoints=N` rise once the assistant-side total content crosses 3k tokens.
2. Confirm `cache_read_input_tokens` on turn N+1 includes the prior turn's tool-message bytes (delta on top of the system prefix).
3. Confirm `inputTokens` (raw) on long tool-loop chats no longer grows linearly with conversation length.

### Risks / residuals

- The new marker placement targets the _last_ cache-control-capable block in an assistant message. For multi-block messages (text + tool_use), the marker lands on `tool_use`. Anthropic accepts `cache_control` on `tool_use` (verified via type extension + their docs), but if a future API change disallowed it, the fix would need to prefer text-block placement when both are present. **Not a current risk** but flagged.
- Provider-gateway test suite has long-running fixtures (≈5 min for the full suite). The breakpoint fix added two cases at the very end of the file; ensure new contributors don't add tests _after_ them without timing budget.
- OpenAI symmetric breakpoint placement is out of scope (OpenAI does not have an equivalent moving `cache_control` mechanism — it caches whole prefixes implicitly).

### Next recommended step

Commit the fix, push, monitor CI, then run a live-test on `persai-dev` (open chat → tool-heavy conversation → grep `cache_read_input_tokens` and `cacheBreakpoints` in provider-gateway logs across 3-4 turns) to confirm the moving history cache starts firing.

## 2026-06-18 — ADR-119 cleanup slice (template + tool descriptor normalization + legacy fallback canonicalization)

### Root cause

Post-live-test audit by the founder surfaced five structural inconsistencies that the staged ADR-119 slices left behind:

1. Markdown `# X` / `## X` headings still surfaced _inside_ the XML-wrapped templates (e.g. `# Core Persona` inside `<voice>`, `# Sense of Time` inside `<persai_environment>`). The XML tag IS the heading; duplicating it as markdown is noise and pushes the model toward emitting markdown headings in its own output.
2. Four prompt templates (`router_classifier`, `skill_state_classifier`, `preview_bootstrap`, `welcome_bootstrap`) were _never_ wrapped in canonical XML — they shipped as raw markdown prompts. They had been excluded from the Slice 1 XML balance validator via `SKIPPED_TEMPLATE_KEYS`.
3. Slice 7 rewrote 8/20 catalog tools and 3/5 hidden synthetics to the canonical 4-section ACI format (`WHEN TO USE` / `WHEN NOT TO USE` / `EXAMPLES` / `GOTCHAS`). The remaining 12 catalog tools (incl. `video_generate`, `document`, `tts`, `browser`, `scheduled_action`, `background_task`, `persai_tool_quota_status`, `files`, `exec`, `shell`) and 2 synthetics (`summarize_context`, `compact_context`, `quota_status`) still used one-liner prose, so admin UI and tool projection produced inconsistent surfaces.
4. `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts` carried legacy markdown-heading fallback paths in `generateSoulPrompt`, `generateUserPrompt`, `generateIdentityPrompt`, `generatePreviewPrompt`, and `generateWelcomePrompt`. They fire only when a template is null (test fixtures, fresh DB) but still produce `# Identity` / `# User Context` / `# Character Preview` / `# First Conversation` — exactly the markdown surface the user saw in live-test screenshots.
5. `renderTraitsBlock` emitted `## Personality Traits\n\n- **trait**: N/100` markdown inside the `<voice>` block via the `{{traits_block}}` placeholder, regardless of which template was in use — visible in the live-test prompt.

### Fix scope (single integral cleanup slice)

- **Visible templates (`apps/api/prisma/bootstrap-preset-data.ts`)** — `soul`, `user`, `identity`, `memory_protocol`, `tools`, `heartbeat`, `presence` had every `# H1` / `## H2` markdown heading replaced with nested canonical XML elements (`<core_persona>`, `<gendered_self_reference>`, `<style>`, `<openings>`, `<emotion_response>`, `<silence>`, `<examples>`, `<sense_of_time>`, `<usage>`). The numbered priority list in `<tool_usage_policy>` lifted from Markdown `1. … 6. …` to canonical XML `<rule order="N">…</rule>` inside `<priority_order>`. List labels normalized: `- **Name**: value` → `- Name: value` (bold inline emphasis stripped from list-item labels; true emphasis like `**${assistantName}**` kept).
- **Missed templates** — `router_classifier` → `<router_classifier>` with `<modes>`, `<retrieval_plan>`, `<tool_hints>`; `skill_state_classifier` → `<skill_state_classifier>` with `<rules>`; `preview_bootstrap` → `<character_preview>` with `<task>`, `<constraints>`; `welcome_bootstrap` → `<first_conversation_greeting>` with `<task>`, `<opening_requirements>`, `<middle_section>`, `<closing_requirements>`, `<formatting_constraints>`.
- **Tool descriptors (`apps/api/prisma/tool-catalog-data.ts`)** — full 4-section ACI conversion for 10 remaining catalog entries: `video_generate`, `document`, `tts`, `browser`, `scheduled_action`, `background_task`, `persai_tool_quota_status`, `files`, `exec`, `shell`. `files` override mirrored in `apps/api/src/modules/workspace-management/application/runtime-tool-policy.ts` (policy override path that supersedes catalog). Hidden synthetics in `HIDDEN_PROMPT_TEMPLATE_DEFAULTS` — `summarize_context`, `compact_context`, `quota_status` converted to the same shape. `cron` and `persai_workspace_attach` keep one-liner shape (hidden-internal / migration-only, never model-visible).
- **Legacy fallback canonicalization (`compile-prompt-constructor.service.ts`)** — the `template === null` branch of `generateSoulPrompt` rebuilt to emit `<voice>` + `<character_notes>` instead of `# Core Persona` / `## Voice` / `## How you may open` etc.; `generateUserPrompt` → `<user>`; `generateIdentityPrompt` → `<identity>`; `generatePreviewPrompt` → `<character_preview>`; `generateWelcomePrompt` → `<first_conversation_greeting>`. `renderTraitsBlock` rewritten from `## Personality Traits\n\n- **trait**: …` to `<personality_traits>\n- trait: …\n</personality_traits>`. `interpolateTemplate` line-builders (`user_name_line`, `assistant_gender_line`, `archetype_label_line`, etc.) updated to feed `- Name: value` style into the placeholders, matching the new template defaults.
- **Memory `<read>` provenance documentation** — added a 4-line enum reference inside `<memory_protocol><read>` so the model interprets `user_explicit` / `system_inferred` / `auto_extracted` / `legacy` correctly (the live-test "P1 provenance" finding was an older backfill entry, not a write-path bug; write paths already set the correct enum per audit of `RuntimeMemoryWriteToolService`, `ManageAssistantWorkspaceMemoryService.add`, `AutoExtractToMemoryService`).

### Tests

- `apps/api/test/bootstrap-preset-data.test.ts` — `SKIPPED_TEMPLATE_KEYS` emptied (every template now must pass XML balance); `EXPECTED_OUTER_TAGS` extended with the 4 newly-wrapped templates and their canonical outer tags; new `runNoMarkdownHeadings` invariant function asserts no `^#{1,6}\s` markdown headings inside any visible/hidden template after stripping fenced code blocks, inline backticks, and `{{placeholders}}`.
- `apps/api/test/seed-tool-catalog.test.ts` — the Slice 7 8-tool ACI shape check generalized to "every model-visible catalog entry must carry the 4-section ACI shape" (`HIDDEN_ONELINER_CODES` skips only `cron` and `persai_workspace_attach`); cross-tool drift `ALLOW_LIST` expanded with the new legitimate cross-references (`browser ↔ web_search/web_fetch`; `video_generate → image_generate/image_edit/tts`; `document → files`; `scheduled_action ↔ background_task`; `persai_tool_quota_status → knowledge_search/document`; `files ↔ exec/shell/document`; `exec → shell/files/document`; `shell → files/exec/document`); restructured-catalog set renamed to `ACI_CATALOG_CODES` and extended to cover all 18 in-scope tools.
- `apps/api/test/runtime-tool-policy.test.ts` — `files` override assertions updated for the canonical 4-section shape (asserts each section header line, plus the canonical phrasings inside `GOTCHAS`).
- Golden snapshot — `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt` deleted and regenerated against the new prompt bytes (11346 bytes vs prior 11007).

### Files touched

- `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/api/prisma/tool-catalog-data.ts`
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts`
- `apps/api/src/modules/workspace-management/application/runtime-tool-policy.ts`
- `apps/api/test/bootstrap-preset-data.test.ts`
- `apps/api/test/seed-tool-catalog.test.ts`
- `apps/api/test/runtime-tool-policy.test.ts`
- `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt` (regenerated)
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Gate

- `corepack pnpm -r --if-present run lint` PASS (all packages)
- `corepack pnpm run format:check` PASS (3 auto-fixes applied during the slice)
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm --filter @persai/api run test` PASS (full suite, incl. new invariants and regenerated golden snapshot)
- `corepack pnpm --filter @persai/runtime run test` PASS
- `corepack pnpm --filter @persai/provider-gateway run test` PASS
- `corepack pnpm --filter @persai/web run test` PASS

### Reset-to-default checklist (founder runs after deploy)

Existing assistants carry their own snapshot copies of every visible template in DB. The new defaults only take effect on `Reset to default`. After GitOps reconcile, visit `/admin/presets/[assistant]` for each affected assistant and click `Reset to default` on these template rows:

- `system`
- `soul`
- `user`
- `identity`
- `memory_protocol`
- `tools`
- `heartbeat`
- `presence`
- `router_classifier`
- `skill_state_classifier`
- `preview_bootstrap`
- `welcome_bootstrap`

Tool catalog: nothing to click. `SeedToolCatalogService` auto-applies the new `modelDescription` / `modelUsageGuidance` strings on every API pod startup (`startup_idempotent: true`), so the new ACI shape ships with the next deploy automatically.

### Risks / residuals

- **One-time prompt-cache prefix invalidation on rollout** — all template bytes change in this slice, so the Anthropic and OpenAI cache prefixes invalidate once and rebuild on the next turn. Per ADR-119 D11 this is acceptable; expected on cleanup waves.
- The `runNoMarkdownHeadings` invariant is intentionally strict — any future template work that uses `^#{1,6}\s` will fail the test. Backtick the example or lift it to nested XML.
- OpenAI symmetry for the wider response-dump path (not in this slice, separate residual from prior follow-up): if the live test pivots to GPT-5.x, OpenAI client still needs the `dumpResponse` wiring done for Anthropic.
- Bold inline emphasis `**X**` is still used in true-emphasis spots (`**${assistantName}**`, `**${humanName}**`, `Your voice is **${voiceDna.archetypeLabel}**`). This is intentional and Anthropic-standard; only list-item label bold was stripped.

### Next recommended step

Push to `main`, wait for `Dev Image Publish` → GitOps reconcile, run the Reset-to-default checklist on the founder's assistants, then re-launch the browser-use subagent against `docs/ADR/119-live-test-plan.md`. With every template now XML-canonical and every model-visible tool descriptor in 4-section ACI shape, the cache-effectiveness zone (F) should now read clean cache-prefix hits across turns; the model's own response markdown should no longer be biased by markdown headings in the system prompt; and tool selection across Zones C/D should be tighter because the descriptors all carry explicit WHEN/NOT/EXAMPLES/GOTCHAS routing.

---

## 2026-06-18 — Anthropic terminal usage metadata + wired `dumpResponse` (live-test blocker fix)

### Root cause

Browser-use live-test runner reported a P0 blocker mid-matrix: Zone F (cache effectiveness) cannot be measured because `provider_payload_response_dump` events never appear in `provider-gateway` logs even with `PERSAI_DEBUG_PROVIDER_PAYLOAD=true` and `RATE=1.0`. Audit of `apps/provider-gateway/src/` confirmed `ProviderDebugPayloadLogger.dumpResponse()` is defined since Slice 0.5 but has **zero call sites in any provider client** — only `dumpRequest()` was wired. Without an end-of-turn log line carrying the `usage` block, neither the matrix runner nor a human operator can read `cache_creation_input_tokens` / `cache_read_input_tokens` per turn.

### Fix scope

Anthropic-only (live test uses claude-sonnet-4-6; OpenAI symmetry deferred). In `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`:

- New private `logAnthropicRequestEnd("anthropic-non-stream-end" | "anthropic-stream-end", input, {stopReason, usage, toolCallCount})` emits one always-on info line per turn with the printf grammar: `[<tag>] requestId=<id> classification=<c> iteration=<i> model=<m> stopReason=<r> toolCalls=<n> inputTokens=<n|null> cacheCreationInputTokens=<n|null> cacheReadInputTokens=<n|null> outputTokens=<n|null> totalTokens=<n|null>`. No user content; always-on; readable from `kubectl logs` without any toggle.
- `generateText()` (non-stream caller path, runs via `messages.stream(...).finalMessage()` under the hood) now calls `logAnthropicRequestEnd("anthropic-non-stream-end", ...)` and `debugPayloadLogger.dumpResponse(...)` once `finalMessage()` resolves, with the full SDK response object as the dump payload.
- `streamText()` calls both at `message_stop` for both the `tool_use → tool_calls` branch and the `completed` branch, with the aggregated `latestUsage`/`latestStopReason` and a synthesized response object (`{stop_reason, usage, tool_call_count, text}`) to keep the dump bounded.
- `usage` is computed once per turn (`finalUsage`) and reused for the metadata line, the `dumpResponse` payload, and the runtime contract result — no double computation.

### Tests

- `apps/provider-gateway/test/anthropic-provider.client.test.ts` — existing fixture extended:
  - Non-stream path now asserts a `[anthropic-non-stream-end]` log line matching the printf grammar (regex accepts `<n|null>` per token field).
  - Streaming path now asserts a `[anthropic-stream-end]` log line AND the exact figures from the existing stream-cache fixture: `inputTokens=10`, `cacheCreationInputTokens=4`, `cacheReadInputTokens=6`, `outputTokens=5`, `totalTokens=25`. This locks the field order and surface for the live-test runner.

### Files touched

- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risks / residuals

- OpenAI client is NOT updated in this slice — `dumpResponse` still has zero call sites there. If the live test pivots to GPT-5.x, a symmetric patch is needed.
- The `dumpResponse` payload is the SDK message object (non-stream) or a synthesized minimal object (stream) — no system prompt or message bodies are included, but downstream redaction in `sanitizeResponseValue` still applies bounded preview / base64 redaction defensively.
- Always-on `[anthropic-*-end]` line is one extra info-level log per provider call. Negligible volume vs. `[anthropic-*-start]` already emitted.
- Cache-prefix bytes UNCHANGED.

### Next recommended step

Push to `main`, wait for `Dev Image Publish` → GitOps reconcile, then re-launch the browser-use subagent against the unchanged `docs/ADR/119-live-test-plan.md`. Zone F should now read `cacheReadInputTokens=N` directly from the `[anthropic-stream-end]` line for every turn; the test plan's "Cache hit/miss" acceptance criterion is now satisfiable.

---

## 2026-06-18 — ADR-119 live-test enablement (Slice 14 partial + comprehensive plan)

### Root cause

Initial live test on `persai-dev` surfaced two issues that block any meaningful ADR-119 acceptance gate: (1) Slice 0.5 `PERSAI_DEBUG_PROVIDER_PAYLOAD` toggle silently no-ops at default `LOG_LEVEL=info` (uses `.debug()`) and only accepts the exact string `"true"`, so a human operator setting `=1` sees nothing; (2) ArgoCD reverts any `kubectl set env` within ~2 minutes, so the dev cluster cannot be patched ad-hoc for a multi-zone test session.

### Fix scope

- Slice 14 partial — debug-payload toggle hardened: accept `"1"/"true"/"yes"/"on"` case-insensitively via new `isTruthyEnvFlag()`; emit dumps at INFO via `logger.log()` instead of DEBUG so default-level pods surface them; gating still in `shouldDump()`.
- `infra/helm/values-dev.yaml` `providerGateway.env` adds `PERSAI_DEBUG_PROVIDER_PAYLOAD: "true"` + `PERSAI_DEBUG_PROVIDER_PAYLOAD_RATE: "1.0"` (dev only, gitops-managed; production values files MUST keep OFF).
- New `docs/ADR/119-live-test-plan.md` — 8-zone acceptance matrix (A baseline / B memory / C native tools 12 cases / D Skills+scenarios / E PDF-hotfix regression / F cache effectiveness / G parallel-tool discipline / H error+recovery) with pre-conditions, capture rules, output artifact shape, and explicit acceptance criteria. Designed to be executed by a browser-use subagent against `https://persai.dev`.

### Tests

- `apps/provider-gateway/test/provider-debug-payload-logger.test.ts` expanded: 9 truthy spellings (`"1"`, `"true"`, `"TRUE"`, `"True"`, `"yes"`, `"YES"`, `"on"`, `"ON"`, `" true "`) all assert `shouldDump() === true` with `RATE=1.0`; 7 falsy spellings (`""`, `"0"`, `"false"`, `"FALSE"`, `"no"`, `"off"`, `"anything-else"`) all assert `false`. `withDebugCapture` intercepts `Logger.prototype.log` instead of `debug`.
- `apps/provider-gateway/test/anthropic-provider.client.test.ts` + `openai-provider.client.test.ts` re-run — green (use `withDebugCapture` indirectly via Slice 0.5 dump tests).

### Files touched

- `apps/provider-gateway/src/modules/providers/provider-debug-payload-logger.ts`
- `apps/provider-gateway/test/provider-debug-payload-logger.test.ts`
- `infra/helm/values-dev.yaml`
- `docs/ADR/119-live-test-plan.md` (NEW)
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risks / residuals

- This is NOT ADR-119 Slice 14 in full. Slice 14 in `docs/ADR/119-live-test-plan.md`-adjacent follow-up scope would also touch operational docs and a Loki-retention note. Logger toggle change is the bare minimum to unblock the live-test gate.
- The full ADR-119 follow-up trio (Slice 12 `current_local_date`, Slice 13 template-refresh migration, Slice 15 multi-BP system blocks) is still pending. The live-test plan REQUESTED here will surface their impact by recording specific failures (date drift, missing XML wrappers, single cache breakpoint).
- `infra/helm/values-dev.yaml` enabling `PERSAI_DEBUG_PROVIDER_PAYLOAD=true` at full sample rate increases provider-gateway log volume for dev. Acceptable for a dev cluster; production values files MUST keep OFF.

### Next recommended step

Push the toggle + gitops + test plan as ONE commit. After ArgoCD syncs the new image + env, the operator launches a browser-use subagent with `docs/ADR/119-live-test-plan.md` as the prompt. Subagent produces `docs/ADR/119-live-test-findings-<date>.md`; orchestrator audits findings; results feed a follow-up Slice 12+13+15 batch ADR.

---

## 2026-06-18 — ADR-119 CLOSED (golden tests + docs + ADR closure)

### Root cause

Slice 11 is the final closure slice of the ADR-119 program. Locks invariants in tests, propagates the architecture to top-level docs, and marks the ADR Closed with reachability proof.

### Fix scope

- 6 golden tests (1 new file for full-prompt snapshot in api; 1 new runtime-side companion; 5 strengthened/labeled across existing test files).
- 4 top-level docs updated (ARCHITECTURE, API-BOUNDARY, DATA-MODEL, TEST-PLAN).
- ADR-119 `Status` = `Closed — 2026-06-18` with closure footer (slice SHA table).
- ADR-118 (`118-skill-scenarios-and-model-owned-activation.md`) `Status` = `Superseded by ADR-119 — 2026-06-18`.

### Tests

- New: `apps/api/test/adr119-golden-prompt-snapshot.test.ts` with committed expected fixture at `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt`.
- New: `apps/runtime/test/adr119-golden-prompt-snapshot.test.ts` — runtime volatile-context zone structure (GT1b).
- Extended `apps/runtime/test/prompt-cache-stable-blocks.test.ts`: GT2 (5 state variants) + GT6 (memory provenance labels).
- Extended `apps/runtime/test/native-tool-projection.test.ts`: `runAdr119Invariantstest` export (GT3).
- Labeled `apps/provider-gateway/test/anthropic-provider.client.test.ts` + `openai-provider.client.test.ts`: GT4.
- Extended `apps/api/test/compile-prompt-constructor.service.test.ts`: `runAdr119GoldenTest5PersonaDedup` (GT5).
- `apps/runtime/test/run-suite-isolated.ts` + `run-suite.ts` updated to include new runtime tests.

### Files touched

- `apps/api/test/adr119-golden-prompt-snapshot.test.ts` (NEW)
- `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt` (NEW — committed fixture)
- `apps/runtime/test/adr119-golden-prompt-snapshot.test.ts` (NEW)
- `apps/runtime/test/prompt-cache-stable-blocks.test.ts` (extended)
- `apps/runtime/test/native-tool-projection.test.ts` (extended)
- `apps/runtime/test/run-suite-isolated.ts` (updated)
- `apps/runtime/test/run-suite.ts` (updated)
- `apps/provider-gateway/test/anthropic-provider.client.test.ts` (label)
- `apps/provider-gateway/test/openai-provider.client.test.ts` (label)
- `apps/api/test/compile-prompt-constructor.service.test.ts` (extended)
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/ADR/119-prompt-architecture-and-2026-context-engineering.md`
- `docs/ADR/118-skill-scenarios-and-model-owned-activation.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**Low — closure work.** Golden tests will catch any future structural drift. No code logic changed; all changes are tests, docs, or ADR metadata.

### Acceptance gate deferred

Founder live-test on persai-dev not yet executed. Per ADR rollout policy, the live-test is subjective and post-closure. If regressions discovered, future ADR will address.

### Deviation from instructions

Golden Test 1 (full materialized system-prefix byte-snapshot) lives in `apps/api/test/adr119-golden-prompt-snapshot.test.ts` rather than `apps/runtime/test/adr119-golden-prompt-snapshot.test.ts` as originally specified. Reason: `CompilePromptConstructorService` is an api-package class that cannot be imported in the runtime package without cross-package wiring that would break `corepack pnpm --filter @persai/runtime run typecheck`. The runtime file at `apps/runtime/test/adr119-golden-prompt-snapshot.test.ts` provides GT1b (runtime volatile-context zone structure validation).

### Next recommended step

Founder live-test sequence (a)-(e) per ADR-119 Rollout section:

- (a) Free-form marketing domain discussion with Marketer Skill enabled.
- (b) Memory recall accuracy under a new session.
- (c) Instagram-carousel scenario with reference image; verify no parallel skill+image_edit call.
- (d) Scenario switch mid-chat.
- (e) Explicit release; verify UX indicator disappears.
  After successful live-test, the program is fully closed.

---

## 2026-06-18 — ADR-119 Slice 10 landed (admin UI for new scenario step fields)

### Root cause

The Slice 4 scenario step schema extended `SkillScenarioStepState` with `expectedUserResponse`, `nextStepTrigger`, and `recoveryGuidance`. The Slice 3 materializer auto-derives `<first_step_preview>` from `steps[0].directive`. Neither set of fields was exposed in the admin UI — admins had no way to author or override them.

### Fix scope

- `apps/web/app/admin/skills/page.tsx`: `ScenarioStepDraft` extended with 4 new string fields. `EMPTY_SCENARIO_STEP_DRAFT` defaults to `""`. `scenarioToDraft` maps `scenario.firstStepPreview` (scenario-level) to `draft.steps[0].firstStepPreview`; other new step fields via `?? ""`. `validateScenarioDraft` enforces length limits (400/200/400/200 chars). Both payload serializers trim and null-coerce; `firstStepPreview` emitted at step 0 level and scenario level. Step editor JSX: 3 textareas per step + text input on step 1 only for `firstStepPreview`. `renderActiveScenarioBlockPreview` rewritten to Slice 4 XML format. New `renderScenarioCatalogFirstStepPreview` helper. Catalog preview pane shows `<first_step_preview>` value.
- `apps/api/prisma/schema.prisma` + `apps/api/prisma/migrations/20260618160000_adr119_first_step_preview/migration.sql`: new `first_step_preview VARCHAR(200)` nullable column on `skill_scenarios` table.
- `apps/api/src/modules/workspace-management/application/skill-scenario.types.ts`: `SkillScenarioStepState` gains `firstStepPreview: string | null`; `parseStep` validates ≤200 chars; `normalizeStepsState` reads from stored JSON. `AdminSkillScenarioState` gains scenario-level `firstStepPreview: string | null`.
- `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts`: `createScenario` / `updateScenario` persist and load the new `firstStepPreview` column.
- `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts`: `<first_step_preview>` uses `scenario.firstStepPreview` verbatim when non-null/non-empty, falls back to auto-derived from `directive`.
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`: maps `row.firstStepPreview` into `EnabledSkillScenarioCandidate`.
- `packages/contracts/openapi.yaml` + generated model files: optional `firstStepPreview?` added to `AdminSkillScenario`, `AdminSkillScenarioStep`, `AdminCreateSkillScenarioRequest`, `AdminUpdateSkillScenarioRequest`.
- `packages/runtime-contract/src/index.ts`: `RuntimeBundleSkillScenario` and `RuntimeBundleSkillScenarioStep` gain optional `firstStepPreview?`.

### Tests

- `apps/web/app/admin/skills/page.test.tsx`: 22 new Slice 10 tests; existing `renderActiveScenarioBlockPreview` and `createScenario` fixture tests updated for new fields and XML format.
- `apps/api/test/enabled-skills-prompt-materialization.test.ts`: 2 new tests (firstStepPreview override verbatim; fallback to directive when absent).
- `apps/api/test/manage-skill-scenarios.service.test.ts`: 3 new tests (firstStepPreview persists on step 1; missing fields return null; overlong firstStepPreview rejects).

### Files touched

- `apps/web/app/admin/skills/page.tsx`
- `apps/web/app/admin/skills/page.test.tsx`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260618160000_adr119_first_step_preview/migration.sql`
- `apps/api/src/modules/workspace-management/application/skill-scenario.types.ts`
- `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts`
- `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/model/adminSkillScenario.ts`
- `packages/contracts/src/generated/model/adminSkillScenarioStep.ts`
- `packages/contracts/src/generated/model/adminCreateSkillScenarioRequest.ts`
- `packages/contracts/src/generated/model/adminUpdateSkillScenarioRequest.ts`
- `packages/runtime-contract/src/index.ts`
- `apps/api/test/enabled-skills-prompt-materialization.test.ts`
- `apps/api/test/manage-skill-scenarios.service.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**Low — UI extension + additive schema.** All new fields optional; backward-compatible defaults (`?? ""`). Prisma migration is additive (new nullable column, existing rows backfill to NULL; auto-derive from `directive` preserved when column is null). The `renderActiveScenarioBlockPreview` format change is visible only in the admin preview pane. Materializer update is additive (falls back to existing auto-derive when `firstStepPreview` is null/empty).

### Deviation from instructions

None. `firstStepPreview` was added at scenario level (new Prisma column `first_step_preview VARCHAR(200)` on `skill_scenarios`, migration `20260618160000_adr119_first_step_preview`) as the instructions specified. It is also stored at step level within the `steps` JSON blob (for runtime bundle pass-through), but the authoritative value used by the materializer is the scenario-level Prisma column.

### Next recommended step

Slice 11 — golden tests + docs + ADR closure (golden test suite, `docs/ARCHITECTURE.md`/`API-BOUNDARY.md`/`DATA-MODEL.md`/`TEST-PLAN.md` updates, ADR-119 `Status: Closed`, ADR-118 `Status: Superseded`).

---

## 2026-06-18 — ADR-119 Slice 9 landed (memory protocol + provenance)

### Root cause

The volatile memory rail lacked a formal protocol declaration in the cache prefix, memory entries carried no provenance, and the inner rendering used legacy markdown-list / old wrapper tags (`<recent_short_memory>`, `<persai_contextual_memory>`) rather than the canonical `<persai_memory>` / `<entry>` XML from ADR D10.

### Fix scope

- `apps/api/prisma/schema.prisma`: `AssistantMemoryProvenance` enum + `provenance` column on `AssistantMemoryRegistryItem` (DEFAULT `legacy`).
- `apps/api/prisma/migrations/20260618153000_adr119_memory_provenance/migration.sql`: additive migration; existing rows backfill to `legacy`.
- `apps/api/src/modules/workspace-management/domain/assistant-memory-registry-item.entity.ts`: `provenance` field.
- `apps/api/src/modules/workspace-management/domain/assistant-memory-registry.repository.ts`: `provenance` in `CreateAssistantMemoryRegistryItemInput`.
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-memory-registry.repository.ts`: create + mapToDomain carry provenance.
- `apps/api/src/modules/workspace-management/application/write-assistant-memory.service.ts`: `provenance` in `WriteAssistantMemoryInput`; `parseInput` defaults to `system_inferred` when absent; `asProvenance` updated.
- `apps/api/src/modules/workspace-management/application/manage-assistant-workspace-memory.service.ts`: `user_explicit` provenance on workspace-memory writes.
- `apps/api/src/modules/workspace-management/application/hydrate-memory-for-turn.service.ts`: `provenance` in `HydratedDurableMemoryItem`.
- `apps/api/prisma/bootstrap-preset-data.ts`: new `memory_protocol` template; `{{memory_protocol_block}}` in `system` template; `agents` template emptied.
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts`: `generateMemoryProtocolPrompt` + `memory_protocol_block` substitution.
- `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts`: `provenance` in `InternalMemoryWriteInput` + `InternalHydratedDurableMemoryItem`.
- `apps/runtime/src/modules/turns/auto-extract-to-memory.service.ts`: `provenance: "auto_extracted"`.
- `apps/runtime/src/modules/turns/runtime-memory-write-tool.service.ts`: `provenance: "system_inferred"`.
- `apps/runtime/src/modules/turns/prompt-cache-stable-blocks.ts`: `MemoryXmlEntry` type; `formatDurableMemoryContextualBlock` accepts `MemoryXmlEntry[]`, emits XML; `isDurableMemoryContextualMessage` requires `role === "assistant"` guard.
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts`: `buildContextualMemoryMessage` uses `takeMemoryXmlEntries` + `volatileKind: "memory"`.
- `apps/runtime/src/modules/turns/turn-execution.service.ts`: `extractRenderedShortMemorySummaries` dual-parses XML and legacy markdown.
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`: wrapper tag `<persai_memory>`.
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`: wrapper tag `<persai_memory>`.
- `packages/runtime-bundle/src/index.ts`: `memoryProtocol?` in `AssistantRuntimeCompiledOrdinaryPromptSections`.
- `packages/runtime-contract/src/index.ts`: JSDoc updated for `volatileKind`.

### Tests

- `apps/api/test/bootstrap-preset-data.test.ts`: `memory_protocol` template XML balance; `system` template contains `{{memory_protocol_block}}`; `agents` template does not contain inline `<memory_protocol>` block.
- `apps/api/test/compile-prompt-constructor.service.test.ts`: compiled system prompt includes `<memory_protocol>` with `<read>` and `<write>`.
- `apps/api/test/write-assistant-memory.service.test.ts`: `deepEqual` fixture updated to include `provenance: "system_inferred"`.
- `apps/runtime/test/prompt-cache-stable-blocks.test.ts`: XML entry rendering, byte-stability, `isDurableMemoryContextualMessage` with role guard.
- `apps/runtime/test/turn-context-hydration.service.test.ts`: contextual memory assertions updated to new XML format; all fixtures carry `provenance: "legacy"`.
- `apps/runtime/test/runtime-memory-write-tool.service.test.ts`: `deepEqual` fixture updated with `provenance: "system_inferred"`.
- `apps/runtime/test/turn-execution.service.test.ts`: `deepEqual` fixture updated with `provenance: "system_inferred"`.
- `apps/runtime/test/native-tool-projection.test.ts`: updated ADR-117 golden test — `agents` block no longer contains `<memory_protocol>`; new assertion verifies dedicated `memory_protocol` template is present.
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`: `<persai_memory>` wrapper assertions; `<recent_short_memory>` no longer fires.
- `apps/provider-gateway/test/openai-provider.client.test.ts`: `<persai_memory>` wrapper assertions; `<persai_contextual_memory>` no longer fires.

### Risk

**Medium — migration gate.** `20260618153000_adr119_memory_provenance` is an additive column with DEFAULT, so production rollback is safe (drop column). Per AGENTS.md, Prisma migration changes cause Dev Image Publish to pause on the `persai-dev-migrations` GitHub Environment and wait for manual approval. This is expected — user must approve in GitHub after push. One-time prompt-cache prefix invalidation deliberate (batched with Slice 8).

### Next recommended step

Slice 10 — admin UI for new scenario fields (`expectedUserResponse`, `nextStepTrigger`, `recoveryGuidance`) exposed in the skill scenario editor.

---

## 2026-06-18 — ADR-119 Slice 8 landed (response contract `<must>`/`<prefer>` restructure)

### Root cause

The `<response_contract>` block in the `system` template was a flat 11-rule list with no priority differentiation. Per ADR-119 D9, a flat list causes the model to prioritize the first 2-3 rules and ignore the rest. The two-tier `<must>`/`<prefer>` structure communicates which rules are hard invariants (must satisfy every reply) versus soft preferences (apply unless contradicting `<must>`).

### Fix scope

- `apps/api/prisma/bootstrap-preset-data.ts`: `<response_contract>` block in the `system` template rewritten from flat 11-rule list to two-tier XML with `<must>` (4 hard invariants: polished product blocks, assistant_gender self-reference forms, fenced code blocks, delivery honesty) and `<prefer>` (4 soft preferences: opener, calm formatting, Markdown h2/h3, follow-up actions). Some prior rules collapsed (e.g. the five follow-up-action rules are now one PREFER bullet); gendered self-reference moved from `<prefer>` position to `<must>` (it is a hard invariant).

### Tests

- `apps/api/test/bootstrap-preset-data.test.ts`: new `runResponseContractSlice8` suite — XML balance passes (new `<must>`/`<prefer>` tags balanced); `<must>` and `<prefer>` nested inside `<response_contract>`; MUST tier contains 4 key phrases; PREFER tier contains 4 key phrases; first child of `<response_contract>` is `<must>` not a bare list item.
- `apps/api/test/compile-prompt-constructor.service.test.ts`: 3 stale `runDefaultPromptTemplateCompile` assertions updated to match new text (`Add follow-up actions` → `Follow-up actions`, `1-2 short plain-text bullet items` → `1-2 short user-imperative bullets`, `Never write follow-up actions from the assistant's point of view` → `No Markdown formatting inside follow-ups`). New `runResponseContractSlice8` test: compiled default system prompt contains `<response_contract>` with `<must>` and `<prefer>` children.

### Files touched

- `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/api/test/bootstrap-preset-data.test.ts`
- `apps/api/test/compile-prompt-constructor.service.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**Low — prompt-only content change.** No schema changes. No new templates. No compiler changes. One-time prompt-cache prefix bytes shift on rollout (the `<response_contract>` section bytes change); this is deliberate and batched with Slice 9 (memory protocol) for a single combined invalidation event.

### Next recommended step

Slice 9 — memory protocol + provenance (`<memory_protocol>` block in cache prefix; `Memory.provenance` column; `AutoExtractToMemoryService` provenance tagging; materialized `<persai_memory>` entries carry `provenance` attribute in volatile context). Batch deploy with Slice 8.

---

## 2026-06-18 — ADR-119 Slice 7 landed (tool descriptor rewrite)

### Root cause

Per-tool descriptors in `tool-catalog-data.ts` were flat prose strings with no structure. Anthropic ACI best practices require role / when_to_use / when_not_to_use / examples / gotchas sections so the model makes correct tool-selection decisions. Several descriptors also contained cross-tool routing prose (e.g. "use knowledge_search before web_search") that ADR-117 prohibits in per-tool descriptors (cross-tool routing belongs in the `tools` selection-guide template only).

### Fix scope

- `apps/api/prisma/tool-catalog-data.ts`: `modelDescription` and `modelUsageGuidance` rewritten for 8 tools: `skill`, `image_edit`, `image_generate`, `memory_search` (→ `knowledge_search`), `memory_get` (→ `knowledge_fetch`), `web_search`, `web_fetch`. New catalog entry `memory_write` added (id: `33333333-3333-3333-3333-333333333333`, `policyClass: "platform_managed"`). Each new `modelUsageGuidance` follows the 4-section ACI format. Stale double-sentence GOTCHA ("If you have not called image_edit…") removed from `image_edit` guidance; it was subsumed by the single "Never claim the edit is done" bullet.
- `apps/api/prisma/bootstrap-preset-data.ts`: `HIDDEN_PROMPT_TEMPLATE_DEFAULTS` entries for `knowledge_search`, `knowledge_fetch`, and `memory_write` (all three synthetic tools) updated to the same 4-section ACI format. These defaults populate new workspace DB rows before any admin override.
- `apps/runtime/src/modules/turns/native-tool-projection.ts`: `resolveToolDefinitionDescription` now uses `\n` separator between description and guidance (preserves multi-line structure). Added `TOOL_DESCRIPTION_CAP = 1024` constant and `truncateToDescriptionCap` helper that falls back to the `WHEN TO USE:` first line when the combined string exceeds the cap. Cross-tool prose (`image_edit` suggestion) removed from `image_generate` hardcoded projection hint.

### Tests

- `apps/runtime/test/native-tool-projection.test.ts`: new export `runAdr119Slice7DescriptorTests` — (1) per-tool rendered description shape test × 8 tools (asserts all 4 section headers present), (2) cross-tool prose drift test reading catalog source file (ALLOW_LIST includes chain-link exceptions and pre-Slice-7 `shell → files` exception), (3) safe-fallback truncation test. Registered in `run-suite-isolated.ts`. Test bundle updated to include `web_fetch` credential ref so the tool is projected in the shape-test. Existing `webSearch.description` assertion updated to use `\n` separator.
- `apps/api/test/seed-tool-catalog.test.ts`: Slice 7 shape assertions (8 tools, 4 section headers each) + ADR-117 cross-tool drift assertions added. Stale `"If you have not called image_edit"` assertion removed. `shell: ["files"]` added to ALLOW_LIST.

### Files touched

- `apps/api/prisma/tool-catalog-data.ts`
- `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- `apps/runtime/test/native-tool-projection.test.ts`
- `apps/runtime/test/run-suite-isolated.ts`
- `apps/api/test/seed-tool-catalog.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**One-time prompt-cache prefix invalidation on rollout** — tool description bytes change for 8 tools; batched with Slice 6 (selection guide XML) for a single combined invalidation event. No schema changes. New `memory_write` catalog entry is additive (no plan activation seeded; `platform_managed`).

### Next recommended step

Slice 8 — response contract restructure (`<response_contract>` must/prefer two-tier rewrite in `bootstrap-preset-data.ts`).

---

## 2026-06-18 — ADR-119 Slice 6 landed (selection guide XML priority order)

### Root cause

The `tools` prompt template was written as a flat Markdown document (`# Native Tool Runtime — Selection Guide` heading + `##` sections). Per ADR-119 D8, the canonical form must be structured XML with a `<priority_order>` block placing Skills first, `<parallelism>` block constraining `skill({engage})` as solo, `<failure_handling>` block with `pending_delivery` and error honesty rules, and `<category_rules>` with per-domain `<category>` elements. The ADR-118 D7 one-rule Skills contribution was embedded in the old `## Skills` Markdown section and needed migrating into the new XML structure.

### Fix scope

- `apps/api/prisma/bootstrap-preset-data.ts`: `tools` template rewritten from Markdown to canonical XML `<tool_usage_policy>` structure. Old `# Native Tool Runtime — Selection Guide` heading removed. `<priority_order>` with 6 numbered rules (Skills gate #1, active scenario #2, knowledge-before-web #3, media routing #4, memory #5, files/docs/tasks #6). `<parallelism>` block. `<failure_handling>` block (error/denied/pending_delivery/budget). `<category_rules>` with five `<category>` elements: files, documents, tasks, browser, skills.
- `apps/runtime/test/native-tool-projection.test.ts`: ADR-117 golden test invariants updated for new XML form. Old assertions on Markdown headings (`# Native Tool Runtime — Selection Guide`, `## Skills`, `` `# Enabled Skills` ``, `` `Skill ID` ``, `skill({ action: "engage" })` spacing) replaced with XML-form equivalents. New assertions added: (d) `<priority_order>` + "Skills are the gate", (e) `<parallelism>` + "ALWAYS solo", `<failure_handling>` + "pending_delivery".
- `apps/web/app/admin/presets/page.test.tsx`: mock template for "renders the tools section as selection guide" test updated from old Markdown heading to new XML snippet.

### Tests

- `apps/runtime/test/native-tool-projection.test.ts`: ADR-117 golden test updated (0 new cases; existing assertions replaced/extended).
- `apps/api/test/bootstrap-preset-data.test.ts`: Slice 1 XML balance validator passes unchanged (new template is balanced; `tool_usage_policy` outer tag already in `EXPECTED_OUTER_TAGS`).
- `apps/web/app/admin/presets/page.test.tsx`: mock template updated; 0 new cases.

### Files touched

- `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/runtime/test/native-tool-projection.test.ts`
- `apps/web/app/admin/presets/page.test.tsx`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**One-time prompt-cache prefix invalidation on rollout** — The `tools` block content and structure change completely; the stable cache prefix is invalidated for all workspaces on first materialization after deploy. This is deliberate and batched with Slice 7 (per-tool descriptor rewrite) so there is only one combined invalidation event.

**Admin UI for custom `tools` template** — Admins with a custom `tools` template will see the old Markdown heading in their override. `reset-to-default` delivers the new XML form. No migration needed; custom overrides are respected.

### Next recommended step

Slice 7 — per-tool descriptor rewrite (`tool-catalog-data.ts`): rewrite each high-traffic tool description to Anthropic ACI best-practices format (role / when_to_use / when_not_to_use / examples / gotchas). Update ADR-117 golden test Slice 7 contribution from ADR-118. Batch deploy with Slice 6 cache-prefix invalidation.

---

## 2026-06-18 — ADR-119 Slice 5 landed (`<system-reminder>` protocol)

### Root cause

The volatile-context rail (`cacheRole: "volatile_context"`) had no mechanism to inject mid-conversation directive messages. Per ADR-119 D7, the model needs `<system-reminder>` blocks to reinforce rules under recency bias (active scenario tick, reference image warning, tool budget pressure). The `volatileKind` union only had `"memory"` and `"active_scenario"`; both provider clients had no handler for a third kind; the cache prefix had no declaration of the reminder protocol; the compiler had no `reminders_protocol_block` placeholder.

### Fix scope

- `packages/runtime-contract/src/index.ts`: `volatileKind` union extended to `"memory" | "active_scenario" | "system_reminder"`. JSDoc updated.
- `packages/runtime-bundle/src/index.ts`: `AssistantRuntimeCompiledOrdinaryPromptSections` extended with optional `remindersProtocol?: string`.
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`: `buildAnthropicVolatileContextMessage` extended — `system_reminder` kind wraps content with `<system-reminder>…</system-reminder>` and a preamble directing the model to absorb without responding.
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`: `buildOpenAIVolatileContextItem` extended symmetrically.
- `apps/api/prisma/bootstrap-preset-data.ts`: `reminders_protocol` template added to `VISIBLE_PROMPT_TEMPLATE_DEFAULTS`; `system` template updated to include `{{reminders_protocol_block}}` between `{{enabled_skills_block}}` and `<response_contract>`.
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts`: `PromptTemplateMap` extended with `reminders_protocol?`; `REMINDERS_PROTOCOL_DEFAULT` constant added; `generateRemindersProtocolPrompt` method added; `remindersProtocol` added to `ordinarySections`; `reminders_protocol_block` added to substitution map and fallback join.
- `apps/runtime/src/modules/turns/tool-budget-policy.ts`: `ToolBudgetSnapshot` exported type added; `getSnapshot()` method added to `ToolBudgetPolicy`.
- `apps/runtime/src/modules/turns/build-system-reminder-blocks.service.ts`: NEW — `BuildSystemReminderBlocksService` with three reminder emission rules (scenario tick, image, budget warning).
- `apps/runtime/src/modules/turns/turns.module.ts`: `BuildSystemReminderBlocksService` added to `providers` and `exports`.
- `apps/runtime/src/modules/turns/turn-execution.service.ts`: `BuildSystemReminderBlocksService` injected; called after `buildActiveScenarioBlockService.buildBlock()`; reminder blocks appended after the active-scenario block in `hydratedMessages`.

### Tests

- `apps/runtime/test/build-system-reminder-blocks.service.test.ts`: NEW — 11 test cases covering all reminder conditions, stable ordering, cacheRole/volatileKind assertions, byte-stability, graceful degradation.
- `apps/runtime/test/turn-execution.service.test.ts`: extended with 2 integration scenarios (scenario active → 1 reminder; scenario + image → 2 reminders). All 3 `TurnExecutionService` instantiations updated with `new BuildSystemReminderBlocksService()`.
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`: extended — `system_reminder` wraps with `<system-reminder>`, preamble present, no double-wrapping.
- `apps/provider-gateway/test/openai-provider.client.test.ts`: symmetric new test for `system_reminder`.
- `apps/api/test/bootstrap-preset-data.test.ts`: `reminders_protocol` added to `EXPECTED_OUTER_TAGS`; new `runRemindersProtocolSlice5` function checks presence, balance, placeholder position.
- `apps/api/test/compile-prompt-constructor.service.test.ts`: new `runRemindersProtocolSlice5` function — default template includes `<reminders_protocol>`, null falls back to default, custom template used verbatim, `remindersProtocol` in ordinarySections.

### Files touched

- `packages/runtime-contract/src/index.ts`
- `packages/runtime-bundle/src/index.ts`
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`
- `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts`
- `apps/runtime/src/modules/turns/tool-budget-policy.ts`
- `apps/runtime/src/modules/turns/build-system-reminder-blocks.service.ts` (NEW)
- `apps/runtime/src/modules/turns/turns.module.ts`
- `apps/runtime/src/modules/turns/turn-execution.service.ts`
- `apps/runtime/test/build-system-reminder-blocks.service.test.ts` (NEW)
- `apps/runtime/test/run-suite.ts`
- `apps/runtime/test/run-suite-isolated.ts`
- `apps/runtime/test/turn-execution.service.test.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `apps/provider-gateway/test/openai-provider.client.test.ts`
- `apps/api/test/bootstrap-preset-data.test.ts`
- `apps/api/test/compile-prompt-constructor.service.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**One-time prompt-cache prefix invalidation on rollout** — The stable cache prefix grows by ~6 lines for the new `<reminders_protocol>` declaration (batched with Slice 4 deploy per ADR-119). The `{{reminders_protocol_block}}` placeholder is placed between `{{enabled_skills_block}}` and `<response_contract>` in the system template; existing custom templates that omit the placeholder continue to work (line dropped by `interpolateTemplate`).

**Budget reminder fires with 0% usage at turn prep time** — The `toolBudgetSnapshot` is always empty at message-preparation time (no tools have been called yet). Budget-warning reminders are correct semantically but will not fire in practice in the current turn-start injection. This is acceptable behavior and the API is complete for future toolloop-iteration injection.

**Admin UI for `reminders_protocol` template not exposed** — Custom per-workspace overrides of `reminders_protocol` are respected but not yet exposed in the admin UI (Slice 10 covers that). Default is used for all workspaces.

### Next recommended step

Slice 6 — selection guide priority order (ADR-119 D8: rewrite `tools` template default as priority-ordered XML with Skills-first gate). Key file: `apps/api/prisma/bootstrap-preset-data.ts` `tools` template, ADR-117 golden test must also pass.

---

## 2026-06-18 — ADR-119 Slice 4 landed (volatile scenario XML format + step field extensions)

### Root cause

`BuildActiveScenarioBlockService` was emitting the active-scenario volatile block in Markdown format (`## Active Scenario: …`, `Steps:`, `Recommended tool:`, `Guards:`). Per ADR-119 D5 the block must be structured XML so the model can parse individual step fields reliably. Additionally, three new optional step-level fields (`expectedUserResponse`, `nextStepTrigger`, `recoveryGuidance`) were spec'd in D5 but had never been added to the schema or the materializer. The Anthropic provider client still used the old inner tag name `active_scenario` (the OpenAI client was already using `persai_active_scenario` since ADR-118 Slice 4 — an inconsistency introduced then).

### Fix scope

- `packages/runtime-contract/src/index.ts`: `RuntimeBundleSkillScenarioStep` extended with three optional fields (`expectedUserResponse?`, `nextStepTrigger?`, `recoveryGuidance?`).
- `apps/api/src/modules/workspace-management/application/skill-scenario.types.ts`: `SkillScenarioStepState` extended with the same three fields (non-optional, `null`-default); `parseStep` validates each up to 400 chars; three new `MAX_*` constants added.
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`: `normalizeSkillScenarioSteps` populates new fields with `null` when absent (never `undefined`); exported for direct unit testing.
- `apps/runtime/src/modules/turns/build-active-scenario-block.service.ts`: `renderActiveScenarioBlock` fully rewritten from Markdown to canonical XML per ADR-119 D5; `renderStep`/`escapeXml` helpers added; `appendStepDetails` removed.
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`: `innerTag` for `volatileKind === "active_scenario"` renamed `active_scenario` → `persai_active_scenario`.

### Tests

- `apps/runtime/test/build-active-scenario-block.service.test.ts`: 8 existing cases updated (Markdown → XML assertions); 10 new cases added (XML step tag, recommendedToolCall present/absent, expectedUserResponse present/absent, nextStepTrigger present/absent, recoveryGuidance present/absent, empty negativeGuards → tag absent, guard format, exit_condition tag, byte-stability).
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`: updated scenario test to assert `<persai_active_scenario>` (NOT `<active_scenario>`).
- `apps/provider-gateway/test/openai-provider.client.test.ts`: added negative assertion `must NOT use bare <active_scenario>`.
- `apps/api/test/materialize-assistant-published-version.service.test.ts`: 3 new unit tests for `normalizeSkillScenarioSteps` (new fields flow through, missing → null, explicit null → null).

### Files touched

- `packages/runtime-contract/src/index.ts`
- `apps/api/src/modules/workspace-management/application/skill-scenario.types.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/runtime/src/modules/turns/build-active-scenario-block.service.ts`
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/runtime/test/build-active-scenario-block.service.test.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `apps/provider-gateway/test/openai-provider.client.test.ts`
- `apps/api/test/materialize-assistant-published-version.service.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**One-time prompt-cache prefix invalidation on rollout** — The volatile `active_scenario` block bytes change shape (Markdown → XML). This block is projected at runtime (volatile, not cached), so cache invalidation is limited to the volatile block itself. No stable prefix bytes change in this slice. The Anthropic inner-tag rename (`active_scenario` → `persai_active_scenario`) also affects only the volatile volatile-tail projection.

**Additive contract change** — `RuntimeBundleSkillScenarioStep` new fields are optional. Existing bundle JSON files (pre-Slice-4 materialization) will deserialize with `undefined` for these fields; the renderer treats `undefined` as null (both checks use `?? null`). Safe degradation, no crash.

**Admin UI for new fields deferred** — New `expectedUserResponse`, `nextStepTrigger`, `recoveryGuidance` fields are not yet exposed in the admin scenario editor (Slice 10). Existing scenarios continue to work unchanged; new fields default to null until an admin edits and saves a scenario after Slice 10 ships.

### Next recommended step

Slice 5 — system-reminder protocol. Will batch with Slice 4 in the same volatile-tail format deploy per ADR-119. Key files: `packages/runtime-contract/src/index.ts` (add `system_reminder` to `volatileKind`), `apps/runtime/src/modules/turns/build-system-reminder.service.ts` (new), `apps/runtime/src/modules/turns/turn-execution.service.ts` (inject reminder before memory), both provider clients (add `<system-reminder>` wrapper for the new kind).

---

## 2026-06-17 — ADR-119 Slice 3 landed (Skills progressive disclosure + first_step_preview)

### Root cause

The `enabled-skills-prompt-materialization.ts` Markdown card renderer emitted the full `instructionCard.body` (up to 1,200 chars), `guardrails`, and `examples` for every enabled Skill directly into the stable cache prefix. This was risk R8 from ADR-119 inventory: ~1,500 chars × 3 Skills ≈ ~4,500 chars (~1,100 tokens) wasted on every request even when no Skill was ever engaged. Additionally, the model had no compact step-1 guidance before calling `skill({engage})`, triggering parallel tool-call races ([F3]).

### Fix scope

- `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts`: `renderSkillCard` and `renderEnabledSkillsPromptBlock` rewritten to emit compact XML per ADR-119 D4. Body/guardrails/examples removed from the prefix block. New fields added: `whenToUse` (optional InstructionCard field), `first_step_preview` per scenario (≤200-char excerpt of `steps[0].directive`). `escapeXml` helper added. Locale fallback order for `localize` updated to prefer `ru` before `en` (per ADR).
- `packages/runtime-bundle/src/index.ts`: `AssistantRuntimeEnabledSkillSummary` extended with required `body: string`, `guardrails: string[]`, `examples: string[]` fields.
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`: `normalizeInstructionCard` extended to extract `whenToUse`; `skills.enabled` bundle mapping extended to include `body`, `guardrails`, `examples` from the card.
- `apps/runtime/src/modules/turns/runtime-skill-tool.service.ts`: `RuntimeSkillToolResult` engaged variants extended with `instruction: {body, guardrails, examples}` and `scenario: {key, displayName, description, steps, recommendedTools, exitCondition} | null`. `buildInstruction` helper added.

### Tests

- `apps/api/test/enabled-skills-prompt-materialization.test.ts`: fully rewritten for XML format — `<skill id>` tags, `key` attribute, `<first_step_preview>` present/absent, R8 sentinel assertions (body/guardrails/examples NOT in prefix), R8 invariant assertion (body/guardrails/examples ARE on card objects), byte-stability test.
- `apps/runtime/test/runtime-skill-tool.service.test.ts`: `createBundle` updated to include `body/guardrails/examples`; new assertions for `instruction.body`, `instruction.guardrails`, `instruction.examples` on both engage paths; `scenario` nested object assertions (key, displayName, description, steps shape); byte-match sentinel test.
- `apps/runtime/test/native-tool-projection.test.ts`: skill fixture updated with `body: "", guardrails: [], examples: []`.
- `apps/runtime/test/turn-routing.service.test.ts`: skill fixtures updated with `body: "", guardrails: [], examples: []`.

### Files touched

- `packages/runtime-bundle/src/index.ts`
- `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/runtime/src/modules/turns/runtime-skill-tool.service.ts`
- `apps/api/test/enabled-skills-prompt-materialization.test.ts`
- `apps/runtime/test/runtime-skill-tool.service.test.ts`
- `apps/runtime/test/native-tool-projection.test.ts`
- `apps/runtime/test/turn-routing.service.test.ts`
- `apps/web/app/admin/presets/page.tsx`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**One-time prompt-cache prefix invalidation on rollout** — the XML card bytes replacing the Markdown format change the stable prefix bytes for every assistant with enabled Skills; all provider-side cache entries invalidate once. R8 invariant is maintained: `body/guardrails/examples` are added to the bundle type AND materialized AND returned by the engage tool in this same commit, so the model always receives full instructions on `skill({engage})`.

**`body/guardrails/examples` required on `AssistantRuntimeEnabledSkillSummary`** — older bundle JSON files (from pre-Slice-3 materialization) will deserialize with `undefined` for these fields. The runtime `buildInstruction` helper will return empty strings/arrays — safe degradation, no crash. Next turn rematerializes the bundle and picks up the new fields.

### Next recommended step

Slice 4 — volatile scenario block XML format (`<persai_active_scenario>` per ADR-119 D5). Rewrites `BuildActiveScenarioBlockService` to emit structured XML with `<step number status>`, `<directive>`, `<next_step_trigger>`, `<negative_guards>`, and `<exit_condition>` instead of the current Markdown developer block.

---

## 2026-06-17 — ADR-119 Slice 2 landed (provider cache_control markers + parallel-tool-calls discipline)

### Root cause

Production observed the model co-firing `skill({engage})` and a media generation tool in the same response (parallel tool call), bypassing the intended Skill activation gate. Concurrently, the OpenAI Responses API was receiving the system prompt via the legacy `payload.instructions` parameter instead of inside `input[]`, meaning the stable system prefix was NOT the cache prefix — invalidating OpenAI prefix-match caching on every structural change. Anthropic still emitted only a single `cache_control` marker on the whole system prompt, blocking the planned 3-zone BP boundary split.

### Fix scope

- `packages/runtime-contract/src/index.ts`: `ProviderGatewayTextGenerateRequest` extended with `skillsEnabled?: boolean` and `systemPromptBlocks?: Array<{id:string, text:string}>`.
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`: `buildAnthropicSystemBlocks` extended for multi-block path; `toAnthropicToolChoice` returns `{type:"auto", disable_parallel_tool_use:true}` when `skillsEnabled && tools`.
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`: `payload.instructions` removed from both non-streaming and streaming paths; `buildOpenAISystemDeveloperItems` helper added; `buildOpenAIInputItems` prepends developer-role items; `parallel_tool_calls` is `false` when `skillsEnabled===true`, otherwise `true`.
- `apps/runtime/src/modules/turns/turn-execution.service.ts`: `buildProviderRequest` now passes `skillsEnabled: bundle.skills?.enabled.length > 0`.
- **Minimal path**: `systemPromptBlocks` is wired through the contract and provider clients but NOT yet populated from materialization. Providers fall back to single-block until a follow-up micro-slice exposes compiler block offsets.

### Tests

- `apps/provider-gateway/test/anthropic-provider.client.test.ts`: new Slice 2 cases — `skillsEnabled:true + tools`, `skillsEnabled:true + no tools`, `skillsEnabled:false + tools`, `skillsEnabled:undefined + tools`, 3-block / 4-block / mismatch `systemPromptBlocks` (generate + stream mirrors).
- `apps/provider-gateway/test/openai-provider.client.test.ts`: new Slice 2 cases — `skillsEnabled:true/false/undefined + tools`, `systemPromptBlocks` 2-block (generate + stream), `instructions`-absent assertions on generate + stream baseline.
- Updated existing input-array assertions throughout `openai-provider.client.test.ts` to include the new developer-system item at `input[0]`.

### Files touched

- `packages/runtime-contract/src/index.ts`
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`
- `apps/runtime/src/modules/turns/turn-execution.service.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `apps/provider-gateway/test/openai-provider.client.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**OpenAI one-time prompt-cache prefix invalidation** — moving system prompt from `instructions` to `input[0]` as developer items changes the Responses API cache key; all cached prefixes are invalidated once on rollout. Functional behavior is unchanged. **Back-compat**: `skillsEnabled===false/undefined` paths preserve `parallel_tool_calls:true` (OpenAI) and no `disable_parallel_tool_use` (Anthropic) — tested in both directions.

**Deviation from spec:** `cacheBreakpoints: number[]` replaced by `systemPromptBlocks: Array<{id,text}>` — named blocks are safer than byte-offsets under string normalization differences.

### Next recommended step

Slice 3 — Skills progressive disclosure + `first_step_preview`. **BATCH Slices 1 + 2 + 3 in one persai-dev deploy** per ADR-119 (Slices 1+2 must land together; Slice 3 also batched for deploy efficiency). Slice 3 requires Slice 1's `compileMode` field to be present. A follow-up micro-slice (between Slice 2 and Slice 3) should populate `systemPromptBlocks` from materialization output using the `xml_canonical_v1` zone boundaries.

---

## 2026-06-17 — ADR-119 Slice 1 landed (XML compile output + persona deduplication)

### Root cause

The materialized system prompt had no structural XML boundaries — it was a single Markdown blob. `snapshotInstructions` was rendered through two paths simultaneously (`{{persona_instructions_block}}` in the system template AND `{{instructions_block}}` inside the soul template), causing the [F1] persona duplication failure mode documented in ADR-119. Downstream Slice 2 cache-control marker splitting requires character-offset metadata from the compiler, which only makes sense once XML zone boundaries exist.

### Fix scope

- `apps/api/prisma/bootstrap-preset-data.ts`: all eight visible templates wrapped with canonical ADR-119 outer XML tags; `soul` split into adjacent `<voice>` + `<character_notes>` blocks; `system` Response UI Contract section wrapped in `<response_contract>`.
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts`: `{{persona_instructions_block}}` dropped (resolves to `null`, so legacy custom templates drop the line silently); `stripEmptyCharacterNotes` added to collapse empty shell on persona-less assistants; `compileMode: "xml_canonical_v1"` emitted on every new materialization.
- `packages/runtime-bundle/src/index.ts`: `AssistantRuntimePromptCompileMode` type added; optional `compileMode` field added to `AssistantRuntimePromptConstructor.ordinary`; fallback synthesizer emits `"legacy_markdown"`.
- `apps/api/test/bootstrap-preset-data.test.ts`: new file — XML balance validator (stack-based, strips fenced code/backticks/placeholders) + outer-tag presence + `<character_notes>`/`{{instructions_block}}` placement assertions.
- `apps/api/test/compile-prompt-constructor.service.test.ts`: three fixture snapshots added (archetype-only, free-form-only, archetype+instructions); each asserts `compileMode`, `<voice>` count, `<character_notes>` count, single-occurrence of `snapshotInstructions`, and `<voice>`/`<character_notes>` adjacency.
- `apps/runtime/test/native-tool-projection.test.ts`: ADR-117 golden test updated for `<tool_usage_policy>` and `<memory_protocol>` outer tags (inner heading assertions preserved).

### Tests

Full verification gate passed:

- `corepack pnpm prisma:generate` PASS
- `corepack pnpm -r --if-present run lint` PASS
- `corepack pnpm run format:check` PASS
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm --filter @persai/runtime run typecheck` PASS
- `corepack pnpm --filter @persai/provider-gateway run typecheck` PASS
- `corepack pnpm --filter @persai/runtime-contract run typecheck` PASS
- `corepack pnpm --filter @persai/api run test` PASS
- `corepack pnpm --filter @persai/runtime run test` PASS

### Files touched

- `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts`
- `packages/runtime-bundle/src/index.ts`
- `apps/api/test/bootstrap-preset-data.test.ts` (new)
- `apps/api/test/compile-prompt-constructor.service.test.ts`
- `apps/runtime/test/native-tool-projection.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**One-time prompt-cache prefix invalidation on rollout** — the XML tag bytes added to every cached template change the stable prefix bytes; all provider-side cache entries are invalidated once on the first materialization after deploy. `configDirtyAt` is cleared implicitly on next materialization (existing flow). Low functional risk: inner template content is byte-identical. R7 (`skill_state_classifier` orphan) and R8 (Skills progressive disclosure) remain deferred per slice boundary.

### Next recommended step

Slice 2 — provider cache_control markers + parallel-tool-calls discipline. **BATCH WITH SLICE 1 IN SAME DEPLOY**: Slice 2 requires the `compileMode: "xml_canonical_v1"` field from Slice 1 to safely split the Anthropic `cache_control` marker into 3 BP boundaries (BP1/BP2/BP3). OpenAI `developer` role migration (R4) and parallel-tool-calls discipline (R5) are also Slice 2 scope.

---

## 2026-06-17 — ADR-119 Slice 0.5 landed (Anthropic gateway observability)

### Root cause

OpenAI already emitted `[openai-stream-start]` operational metadata for streaming Responses calls, but Anthropic emitted no per-request start metadata on either caller-facing `generateText()` or `streamText()` path. That asymmetry would make ADR-119 prompt-architecture slices hard to observe and compare across providers. Slice 0.5 also required a safe, flag-gated body-dump channel before request-shape refactors start landing.

### Fix

`apps/provider-gateway` now emits always-on INFO start lines before both Anthropic SDK invocations:

- `[anthropic-non-stream-start]` for caller-facing `generateText()` (even though it uses `messages.stream(...).finalMessage()` internally after the provider hotfix).
- `[anthropic-stream-start]` for `streamText()`.

Both lines include request id, classification, tool-loop iteration, model, system block count, cache breakpoint count, message count, tool count, and tool-history count derived from the assembled Anthropic payload. A shared `ProviderDebugPayloadLogger` now gates provider body dumps behind `PERSAI_DEBUG_PROVIDER_PAYLOAD === "true"` and samples via `PERSAI_DEBUG_PROVIDER_PAYLOAD_RATE` (default/sanitized fallback `0.05`). It uses the separate logger name `persai.debug.provider`, truncates system/message/tool previews, and redacts base64 image/document inputs to `<redacted:<mime>:base64:LENGTH=N>`. OpenAI now calls the same dump helper on its non-streaming and streaming Responses paths while keeping existing metadata behavior.

### Tests

Full Slice 0.5 verification gate passed:

- `corepack pnpm --filter @persai/provider-gateway run lint`
- `corepack pnpm --filter @persai/provider-gateway run typecheck`
- `corepack pnpm --filter @persai/provider-gateway run test`
- `corepack pnpm run format:check`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`

### Files touched

- `apps/provider-gateway/src/modules/providers/provider-debug-payload-logger.ts`
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`
- `apps/provider-gateway/test/provider-debug-payload-logger.test.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `apps/provider-gateway/test/openai-provider.client.test.ts`
- `apps/provider-gateway/test/run-suite.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

Low with flags off: production behavior is unchanged except for small Anthropic INFO metadata lines. The meaningful risk is accidental prompt/body exposure when debugging is enabled; mitigations are exact-string env gating, sampling, dedicated logger name, truncation, and base64 redaction. Operator follow-up: configure Loki retention for the `persai.debug.provider` channel at 3 days; no Helm/infra files were edited in this slice.

### Next recommended step

Slice 1: XML compile output + persona deduplication.

---

## 2026-06-17 — ADR-119 Slice 0 (inventory ledger, read-only) landed; provider-gateway hotfix deployed

### Slice 0 ledger summary

Read-only subagent produced `docs/ADR/119-prompt-inventory.md` — 1062-line ledger covering every prompt-section writer (W1-W41 detailed), 15 `bootstrap-preset-data.ts` template constants, 7 tool-descriptor surfaces, 5 volatile-context kinds with end-to-end traces, selection-guide single-seat verification, persona compiler duplication audit (the [F1] failure mode), 12 future-slice hit lists, 10 risks, and 8 reachability spot-checks with file:line citations. Orchestrator audit: spot-checks 1-8 all match real code. Gate green (format:check + lint).

### Risks folded back from the ledger (actionable for executor subagents)

The ledger surfaced 10 risks. The 6 most material ones must adjust the executor-subagent prompts for Slices 1-9:

- **R4** — OpenAI today uses `payload.instructions = input.systemPrompt` in both non-streaming (`openai-provider.client.ts:197-199`) and streaming (`openai-provider.client.ts:979-981`). ADR-119 mandates `developer` role inside `input[]` for cache-friendliness. **Slice 2 must include this request-shape migration explicitly**, with behavior risk noted (Responses API treats `developer` role differently from `instructions`).

- **R5** — `parallel_tool_calls = true` is hardcoded whenever tools exist (`openai-provider.client.ts:203-206`, `openai-provider.client.ts:985-988`). **Slice 2 test plan must cover both `skillsEnabled=false` (current behavior preserved) and `skillsEnabled=true` (parallel disabled) cases** to prevent accidental global disable.

- **R6** — Anthropic today emits ONE `cache_control` marker on the whole `systemPrompt` string (`anthropic-provider.client.ts:591-604`). **Slice 2 needs compiled offset metadata** (character positions or pre-split text blocks) from the runtime bundle to split safely into 3 BP boundaries — the provider client cannot infer semantic boundaries from a blob.

- **R8** — Enabled Skills prefix still renders `card.body` + `guardrails` + `examples` (`enabled-skills-prompt-materialization.ts:128-140`). **Slice 3 progressive disclosure must move all three into the `skill({engage})` tool response in the same deploy** — otherwise the model loses access to instruction bodies after Slice 3 lands.

- **R10** — `buildOpenAIInputItems` currently passes all volatile messages as one batch assuming same wrapper (`openai-provider.client.ts:1390-1393`). **Before Slices 4/5/9 add new `volatileKind` values** (`retrieved_knowledge`, `system-reminder`, `environment`, possibly renamed memory), provider clients must group/sort volatile messages by kind or preserve individual wrappers — current batching breaks if mixed kinds arrive in one turn.

- **R7** — `skill_state_classifier` prompt template (orphaned by ADR-118 Slice 6 cadence/classifier deletion) is still seeded at `bootstrap-preset-data.ts:226-240` and materialized into `promptDocuments.skillStateClassifier` at `materialize-assistant-published-version.service.ts:1017-1018`. Adjacent to prompt surface even though unused. **Either fold into Slice 11 closure or schedule a separate micro-slice** — orchestrator note for future planning.

The remaining risks (R1, R2, R3, R9) are textual ADR clarifications (the kind exists today vs introduced; retrieved knowledge migration path; environment migration; background-worker prompt scope) — orchestrator will fold these into the ADR text in the next slice that touches it.

### Provider-gateway hotfix (earlier this session, already deployed)

`7637ba48` on `origin/main`. See "Anthropic provider gateway hotfix" entry in `docs/CHANGELOG.md`. PDF jobs, AutoExtractToMemoryService, and SessionCompactionService unblocked.

### Next recommended step

Execute **ADR-119 Slice 0.5 — Anthropic gateway observability** via executor subagent. Goal: add `[anthropic-stream-start]` and `[anthropic-non-stream-start]` metadata lines mirroring OpenAI's, plus env-flag-gated body dump with base64 redaction. This is foundational for observing Slices 1-11 prompt structure changes from gateway logs. After Slice 0.5 lands and verifies, proceed to Slice 1 (XML compile output + persona deduplication, HIGH risk, batched with Slice 2 in same materialization rollout). Use the ledger Section 7 Slice 0.5 hit list as the file-touch contract.

---

## 2026-06-17 — Production hotfix: Anthropic provider gateway (non-streaming refusal for high max_tokens + maxItems rejected by structured output)

### Root cause

Two independent regressions in `@anthropic-ai/sdk@0.87.0` consumption by `apps/provider-gateway` were observed on `persai-dev` between 21:00 and 06:13 UTC+3 on 2026-06-16/17 (Loki / `kubectl logs`):

**Bug 1 — non-streaming refused when `max_tokens` projects > 10 min:**

```
Streaming is required for operations that may take longer than 10 minutes.
See https://github.com/anthropics/anthropic-sdk-typescript#long-requests for more details
```

Thrown synchronously from `Anthropic.calculateNonstreamingTimeout` (`@anthropic-ai/sdk@0.87.0` client.js:425) before any network call. The SDK precomputes wall-time from `max_tokens` × model token rate. PersAI hits this on PDF content generation in `runtime-document-provider-adapter.service.ts` (caps at `DEFENSIVE_OUTPUT_TOKEN_CAP = 64_000`) AND on the LLM document failure-framing fallback (~220 tokens normally, but routes through the same code path) — net effect: user got `Ассистент временно недоступен. Попробуйте ещё раз.` instead of any real reply (one of `runtime_degraded` / `runtime_unreachable` / `assistant_turn_failed` from `system-copy-catalog.ts`, all mapped to the same string).

**Bug 2 — `maxItems` rejected on `array` type in `output_config.format.schema`:**

```
400 invalid_request_error: output_config.format.schema:
For 'array' type, property 'maxItems' is not supported
```

Anthropic's structured-output schema does not accept `maxItems` (or `minItems`) on array types. Three call sites used it as a soft cap that was already re-enforced server-side after the model returned:

- `apps/runtime/src/modules/turns/auto-extract-to-memory.service.ts:59` — `AUTO_EXTRACT_OUTPUT_SCHEMA.items.maxItems = AUTO_EXTRACT_SOFT_CAP`. Killed the auto-extract background loop every run (~minute cadence), visible as `[auto-extract] Provider call failed for session ... Provider gateway request failed with status 500.` in runtime logs and as `[PersaiBackgroundCompactionSchedulerService] Background compaction job <uuid> deferred for retry (attempt 1, code=provider_error)` retry chains in api logs.
- `apps/runtime/src/modules/turns/shared-compaction-state.ts:71` — `REUSABLE_SHARED_COMPACTION_OUTPUT_SCHEMA.properties[*].maxItems = MAX_SECTION_ITEMS`. Killed all durable shared-compaction calls.
- `apps/api/src/modules/workspace-management/application/generate-skill-authoring-draft.service.ts:260` — `knowledgeCards.maxItems = 5`. Would have killed admin Skill authoring drafts if routed via Anthropic; less visible because the codepath is admin-triggered.

### User-visible symptom timeline

From the founder's `nica` Telegram chat (captured verbatim in the user prompt that opened this slice):

```
> Alex: Собери подробный pdf
> Nica: Запрос принят. Готовлю документ и пришлю его отдельно, когда он будет готов.
> Alex: Еще в работе?
> Nica: Запрос принят. Готовлю документ и пришлю его отдельно, когда он будет готов.
> Alex: Делай MD тогда
> Nica: Ассистент временно недоступен. Попробуйте ещё раз.
```

3 PDF enqueues all logged as `POST /api/v1/internal/runtime/document-jobs/enqueue 202` in api logs at 23:01:10, 23:03:14, 23:04:35; all 3 immediately triggered `AssistantDocumentJobCompletionTurnService: LLM document failure-framing call failed ... Document-job runtime returned HTTP 400` — the failure-framing LLM call itself crashed under Bug 1, so the user got the generic copy.

### Fix

Both fixes are in `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`. Caller-facing API of `generateText` / `streamText` is unchanged.

**Fix A — Bug 1.** Replace `this.client.messages.create(payload, { signal })` (lines 153-155 pre-fix) with the streaming-aggregation pattern:

```ts
const stream = this.client.messages.stream(payload, { signal });
const response = (await stream.finalMessage()) as AnthropicNonStreamingMessage;
```

`messages.stream()` returns a `MessageStream`; `await stream.finalMessage()` resolves to a fully-assembled `Message` identical in shape to `messages.create()` (same `content`, `stop_reason`, `usage`). The underlying connection is streaming so the SDK's `calculateNonstreamingTimeout` 10-min refusal is bypassed. All downstream logic (`parseAnthropicToolCalls`, `extractAnthropicText`, `anthropic_empty_completion` warn, `toUsageSnapshot`, both tool_calls and completed return branches) preserved verbatim. `streamText()` untouched.

**Fix B — Bug 2.** New private `sanitizeAnthropicStructuredOutputSchema(value: unknown): unknown` walks the schema recursively. For each plain object it constructs a new object skipping keys `maxItems` and `minItems`; for arrays it maps over elements; primitives and `null` pass through. Does NOT mutate the caller's input (verified in tests). `toAnthropicOutputConfig` now calls it before sending and casts the result back to `Record<string, unknown>` (TS sees the input schema as that type from the contract). Tool input schemas (`tools[].input_schema`) untouched — Anthropic accepts `maxItems` there, only `output_config.format.schema` is restricted.

Server-side caller validation that was previously paired with the schema cap is **kept** in both `auto-extract-to-memory.service.ts` (post-response validator drops candidates over the cap) and `shared-compaction-state.ts` (post-response `normalizeReusableCompactionSections` truncates oversize sections). Behaviour is identical when the model returns ≤ cap items; for over-cap returns, the cap is enforced one layer later instead of failing the entire call with a 400.

### Tests

`apps/provider-gateway/test/anthropic-provider.client.test.ts`:

- Restubbed `installFakeAnthropic` to expose both `client.messages.stream(...).finalMessage()` (new non-streaming path) and `client.messages.create(...)` (still used by `streamText` via the `stream: true` payload branch); `create` now throws if called without `stream: true` to guard against regressions.
- New test: `generateText` with `maxOutputTokens: 32_000` succeeds — was throwing before this fix.
- New test: structured request with `outputSchema.schema.properties.items = { type: "array", maxItems: 5, minItems: 1, items: { type: "string" } }` → sent payload's `output_config.format.schema.properties.items.maxItems` and `.minItems` are `undefined`; deep `items.items.type === "string"` preserved; the **original** schema object still has `maxItems: 5` and `minItems: 1` after the call (no mutation).
- New test: nested schema with `properties.outer = { type: "array", maxItems: 3, items: { type: "object", properties: { inner: { type: "array", maxItems: 7, minItems: 2, items: { ... } } } } }` → `maxItems` stripped at both levels; deepest leaf preserved; original input unchanged at both levels.
- New test: empty-completion path with the new `finalMessage()` source still triggers `anthropic_empty_completion` warn with `event` + `stopReason` fields.

`apps/provider-gateway/test/anthropic-empty-completion.test.ts`: fake client extended to expose both `stream` and `create` so the legacy stream-path stubs continue working.

Sub-agent left `AbortSignal!.signal` reads as optional-chained which TypeScript narrowed to `never` in strict mode (`Property 'signal' does not exist on type 'never'`) — switched to `!` non-null assertions in two places (lines 320-321, 332) and one warn-event read (1041-1042). Schema sanitizer return type cast to `Record<string, unknown>` in `toAnthropicOutputConfig` to satisfy `ProviderGatewayStructuredOutputSchema.schema` typing.

### Cache prefix invalidation

None. This fix is internal to the provider-gateway request construction layer; system-prefix bytes are unchanged.

### Gate green

- recursive `corepack pnpm -r --if-present run lint` — PASS (14 packages, none skipped)
- `corepack pnpm run format:check` — PASS
- `corepack pnpm --filter @persai/provider-gateway run typecheck` — PASS
- `corepack pnpm --filter @persai/provider-gateway run test` — PASS (exit 0; both `anthropic_empty_completion` warns triggered as expected by tests; `openai_empty_completion` tests also pass)
- `corepack pnpm --filter @persai/api run typecheck` — PASS
- `corepack pnpm --filter @persai/web run typecheck` — PASS

### Files touched

- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts` — Bug 1: switched non-streaming `messages.create` → `messages.stream().finalMessage()`. Bug 2: new `sanitizeAnthropicStructuredOutputSchema` private method; wired into `toAnthropicOutputConfig`.
- `apps/provider-gateway/test/anthropic-provider.client.test.ts` — restubbed for `messages.stream` path; new tests for high `max_tokens`, schema sanitization (single-level and nested), no-mutation, empty-completion under new path. Sub-agent's `?.` reads switched to `!` non-null assertions where TS narrowed too aggressively after closure capture.
- `apps/provider-gateway/test/anthropic-empty-completion.test.ts` — fake client extended to expose both `stream` and `create`.
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md` — this entry.

### Risk

Low. The streaming-internal path is the SDK-documented long-form pattern (the error message in Bug 1 explicitly redirects to it); `finalMessage()` produces the same `Message` shape so all downstream parsing/usage/warn paths are unchanged. Schema sanitization is additive and only removes fields Anthropic was already rejecting; caller-side validators still enforce the same caps. Behaviour at small `max_tokens` (≤1024 default for routing / micro-description / failure-framing) is unchanged — the stream returns the full message just as `create` would have.

### Out-of-scope follow-ups

- **Founder owns**: bump `SANDBOX_RUNNING_JOB_GRACE_MS` from `15000` in `infra/helm/values-dev.yaml` and `infra/helm/values.yaml`. The 15-second stale threshold killed `tool=files` workspace operations at 23:08:25 and 23:09:25 during this incident (workspace-hydrate with stale-derivative cleanup can legitimately exceed 15 s). Founder said they would handle this directly.
- ADR-119 implementation work is paused; this hotfix did not touch ADR-119.

### Next recommended step

1. **Deploy provider-gateway** to `persai-dev` (selective pin, image tag from this commit) — no schema/migration changes, low-risk path. After rollout, observe Loki for the next 10 minutes: there should be ZERO new `Streaming is required` errors and ZERO `output_config.format.schema: For 'array' type, property 'maxItems' is not supported` errors. AutoExtractToMemoryService should start succeeding again (`[auto-extract] success`-style log, currently absent). BackgroundCompactionScheduler should stop entering `attempt N` retry chains for `code=provider_error`.
2. **Live re-test PDF in `nica` Telegram chat** with the founder's same prompt ("Собери подробный pdf"). Expected: real document delivery (no infinite "Запрос принят…" loop, no "Ассистент временно недоступен"). If the document worker fails for any non-Anthropic reason, the failure-framing LLM call should now succeed and produce an honest user-visible explanation.
3. **Then** founder bumps `SANDBOX_RUNNING_JOB_GRACE_MS` separately.
4. **Then** resume ADR-119 Slice 0 (architecture inventory) per the plan agreed in the prior turn.

---

## 2026-06-16 — ADR-118 post-deploy hotfix (skill state write-race: tool engage was being silently reverted by post-turn turnRouting echo)

### Root cause

Model successfully called `skill({action:"engage", skillId:"131c1531-...", scenarioKey:"instagram_carousel"})` (verified via Function Call in the user UI) and the tool returned `{action:"engaged", ...}`. But on the NEXT turn no `<persai_active_scenario>` developer block appeared. DB inspection (`assistant_chats.skill_decision_state` for the most recent chat) showed `{status:"inactive", activeSkillId:null, activeScenarioKey:null}` — i.e. the tool's persisted ACTIVE state was overwritten with INACTIVE between tool execution and the next turn.

Two writers on the same JSONB column inside one turn:

- **Writer 1 (correct, ADR-118 owner):** `RuntimeSkillToolService.executeEngageWithScenario` → POST `/api/v1/internal/runtime/skill/state` → `InternalRuntimeSkillStateService.apply` → `AutoSkillRoutingStateService.persistFromTurnRouting({turnRouting:{skillState:active}})` → DB becomes ACTIVE.
- **Writer 2 (stale echo, the bug):** turn-end pipeline → `complete-web-post-runtime-turn.persistWebTurnSkillStateAndQueueBackgroundCheck` → `AutoSkillRoutingStateService.persistFromTurnRouting({turnRouting: runtimeResponse.turnRouting})`. Post-Slice-6 `TurnRoutingService` always echoes back `request.skillStateContext.decision` as `routeDecision.skillState` (every code path: `skillState: currentSkillDecision` — line 565, 615, 653, 677, 694, 725, 746, 762). That echo is the snapshot from turn START (before the tool ran), i.e. INACTIVE. Writer 2 fires AFTER writer 1, overwriting ACTIVE → INACTIVE.

### Fix

Split the write surface into two methods with explicit, non-overlapping roles in `auto-skill-routing-state.service.ts`:

- `persistFromTurnRouting({chatId, turnRouting})` is now **strictly read-only** and returns `readChatSkillState(chatId)` (the freshest DB value, which the tool may have just written). It exists only to feed `engagementSummary` derivation in the post-turn flow.
- New `persistDecisionState({chatId, nextState})` is the **single authoritative writer**. It does the row write + `skillRetrievalStateService.clearForChatWhenSkillMismatches` in one logical step.

`InternalRuntimeSkillStateService.apply` (the `/internal/runtime/skill/state` handler) switched from `persistFromTurnRouting({turnRouting:{skillState:next}})` to `persistDecisionState({chatId, nextState:next})` for both `engage` and `release` paths. The `persistDecisionIfChanged` / `shouldPersistSkillDecisionState` / `extractDecisionStateFromTurnRouting` orchestration that compared current vs next was deleted along with the write path — no need for "did it change" gating when the tool always passes a deliberate target state.

### Test changes

`apps/api/test/auto-skill-routing-state.service.test.ts` rewritten to lock in the new invariants:

- `persistFromTurnRouting` produces ZERO writes even when `turnRouting.skillState` disagrees with the DB (was: would have written the stale echo).
- `persistFromTurnRouting` returns the current DB state regardless of what `turnRouting.skillState` says.
- `persistDecisionState` writes the new state AND calls `clearForChatWhenSkillMismatches` with the correct `activeSkillId` (the new active one on engage, `null` on release).
- After a tool engage write, a subsequent `persistFromTurnRouting` call with a stale inactive echo still returns the active state from DB (the regression scenario, now locked).

`apps/api/test/internal-runtime-skill-state.controller.test.ts`, `apps/api/test/send-web-chat-turn.service.test.ts`, `apps/api/test/stream-web-chat-turn.service.test.ts`: unchanged (they mock the service interface — only the implementation changed).

### DB seeding (separate from the fix, same session)

Per user request earlier in the session, 3 marketer SkillScenario rows seeded directly via a one-shot `kubectl exec`'d Prisma script into `persai-dev` DB:

- Skill: Маркетолог `131c1531-5566-4ad2-9422-3b9b76f6d666` (category=work)
- `instagram_carousel` (order=100), `content_plan_monthly` (order=200), `landing_audit` (order=300) — all `status="active"`
- `configDirtyAt = NOW()` bumped on the 2 assistants that have the marketer Skill assigned, so the next turn rematerializes the bundle and the scenarios reach the cache prefix catalog
- Temp scripts in `%TEMP%` and pod `/tmp` were deleted after run; nothing committed

### Cache prefix invalidation

None. This fix is a behaviour change in the API write path only; cache prefix bytes unchanged.

### Gate green

lint PASS · format:check PASS · api typecheck PASS · web typecheck PASS · `auto-skill-routing-state.service.test.ts` PASS · `internal-runtime-skill-state.controller.test.ts` PASS · `send-web-chat-turn.service.test.ts` PASS (11/11) · `stream-web-chat-turn.service.test.ts` PASS (14/14).

### Files touched

- `apps/api/src/modules/workspace-management/application/auto-skill-routing-state.service.ts` — split write path: `persistFromTurnRouting` becomes read-only; new public `persistDecisionState`; deleted `persistDecisionIfChanged`, `shouldPersistSkillDecisionState`.
- `apps/api/src/modules/workspace-management/application/internal-runtime-skill-state.service.ts` — switched both engage and release branches to `persistDecisionState`; deleted the misleading `persistFromTurnRouting writes ... in one atomic step` comment.
- `apps/api/test/auto-skill-routing-state.service.test.ts` — rewritten around new invariants.
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md` — this entry.

### Risk

Low. Tool-driven write path was already the only one carrying new information; the deleted write path was always a stale echo (proven: `TurnRoutingService` produces `routeDecision.skillState` exclusively from `currentSkillDecision = request.skillStateContext.decision`, no derived state, no classifier output to feed back). The two streaming/non-streaming web turn handlers still call `persistFromTurnRouting` for the engagement-summary read-through, which now returns the freshest DB value instead of echoing the runtime snapshot — net behavior is identical when no tool fires, correct when a tool fires.

### Next recommended step

User retests: turn 1 engages a scenario via the `skill` tool → turn 2's provider call should now contain the `<persai_active_scenario>` developer block. If still broken after deploy, check (1) bundle rematerialization actually ran for the assistant (`configDirtyAt` cleared, `scenarios[]` present in bundle), (2) DB shows `activeSkillId + activeScenarioKey` non-null after engage. The `inspect-skill-state.js` pattern from this session can be reused.

---

## 2026-06-16 — ADR-118 post-Slice-7 production hotfix (Skill ID rendering + selection-guide expansion + `routingExamples` Slice-6 residual cleanup + Clerk middleware admin scenarios registration)

### Root cause

Production caught the model passing `skillId: "Диетолог"` (display name) and `skillId: "1"` (random) to `skill({action:"engage", ...})` and getting `skill_not_enabled`. `renderSkillCard` in `enabled-skills-prompt-materialization.ts` never rendered `card.id`; the tool description told the model "Must be one of the Skill ids listed in the Enabled Skills block" but the block contained no IDs.

### Scope

**A. Skill ID rendering**

- `apps/api/.../enabled-skills-prompt-materialization.ts`: each card now starts with `- Skill ID: ${card.id}` then `- Display name: ${card.name}` (renamed from `- Skill:`). Section intro explicitly tells the model `Skill ID` is the EXACT opaque identifier to pass as `skillId`.
- `apps/api/test/enabled-skills-prompt-materialization.test.ts`: regression — `assert.match(block, /- Skill ID: accounting/)` + `Display name:` + intro phrase.
- `apps/web/app/admin/presets/page.tsx`: `skill_cards_block` sample preview updated (`- Skill ID: skl_accounting_demo`, `- Display name: Accountant`).

**B. Selection-guide `## Skills` section expanded**

- `apps/api/prisma/bootstrap-preset-data.ts`: replaced single prose paragraph with concrete trigger logic — points the model at `# Enabled Skills` block as source of truth, forbids substituting display name / category, gives `scenarioKey: "instagram_carousel"` example, references engage and release signatures.
- `apps/runtime/test/native-tool-projection.test.ts` (ADR-117 golden): 4 old `**Skills.**` assertions replaced with 7 new ones for the expanded section.

**C. Slice 6 ledger-gap follow-up — `routingExamples` removal**

- `routingExamples` was a derived field (`card.examples.slice(0, 2)`) populated in materialization and parsed into `EnabledSkillSummary` in `turn-routing.service.ts`, but never read post-Slice-6 (sole consumer was the deleted `hasSkillLexicalMatch`).
- Removed from: `AssistantRuntimeEnabledSkillSummary` (runtime-bundle), `materialize-assistant-published-version.service.ts:1004` derive, local type in `turn-routing.service.ts:39+1383`, plus 3 test fixture files (`turn-routing.service.test.ts` 5 occurrences, `turn-execution.service.test.ts` 2 occurrences).
- Grep audit: 0 active-code matches for `routingExamples` in `apps/` and `packages/`.

**D. Clerk middleware admin scenarios registration (Slice 3 follow-up, production-blocking)**

- `IdentityAccessModule.configure(consumer)` uses **explicit per-route registration** for `ClerkAuthMiddleware.forRoutes(...)` — every API route needing `req.resolvedAppUser` must be enumerated.
- Slice 3 added 5 new scenario controller routes (`@Get/@Post/@Patch/@Delete` under `/api/v1/admin/skills/:skillId/scenarios[/:scenarioKey]`) but never updated the middleware registration. Result: API received the request, middleware did not run, `req.resolvedAppUser === undefined`, controller threw `UnauthorizedException("Authenticated user context is missing.")`.
- Fix: added 5 paths to `apps/api/src/modules/identity-access/identity-access.module.ts`.
- Guardrail: 5 new `hasRoute` assertions added to `apps/api/test/identity-access.module.test.ts` so any future scenario route surfaces this gap before merge.

### Cache prefix invalidation

One deliberate one-time invalidation covers all three changes (intro line + per-card Skill ID line + `## Skills` selection-guide section).

### Gate green

lint PASS · format:check PASS · 5 typechecks PASS · api test PASS · runtime test PASS (ADR-117 golden expanded) · web test PASS (777/777) · provider-gateway test PASS.

### Next step

After this hotfix lands on dev, validate that the model engages skills correctly with the real skillId (Диетолог-style intent → `skill({engage, skillId: <opaque cuid>})` → state persists → annotation appears). If green, proceed to ADR-118 Slice 8 (ADR closure + golden invariant tests + docs). User has parked a follow-up discussion about importing `msitarzewski/agency-agents` content as PersAI Skill+Scenario seed material.

---

## 2026-06-16 — ADR-118 Slice 7 landed — UX engagement indicator + selection-guide rule

### Scope

**A. Runtime-contract / Domain type extension**

- `packages/runtime-contract/src/index.ts`: `RuntimeSkillDecisionState` + `activeScenarioDisplayName: string | null`.
- `apps/api/.../domain/assistant-chat.entity.ts`: `AssistantChatSkillDecisionState` + `activeScenarioDisplayName`.
- `apps/api/.../infrastructure/persistence/prisma-assistant-chat.repository.ts`: `parseSkillDecisionState` includes the new field.
- `apps/api/.../application/web-chat-turn-attempt.service.ts`: `parseSkillDecisionState` includes the new field.

**B. Internal skill state service / routing service**

- `auto-skill-routing-state.service.ts`: `createInactiveSkillDecisionState` factory, `normalizeDecisionState`, and `shouldPersistSkillDecisionState` all include `activeScenarioDisplayName`.

**C. API projection / types**

- `web-chat.types.ts`: inline `skillDecisionState` shapes updated; `AssistantWebChatEngagementSummary` interface + `deriveEngagementSummary` helper added; `AssistantWebChatTurnState` extended with `engagementSummary?`.
- `assistant-runtime.facade.ts`: inline `skillState` shape updated.
- `send-web-chat-turn.service.ts`: derives and includes `engagementSummary` on turn completion.
- `stream-web-chat-turn.service.ts`: derives and includes `engagementSummary` on `turn_completed` SSE event.

**D. Web hook + component**

- `use-chat.ts`: `ChatMessage.engagementSummary` field; `onCompleted` extracts from transport payload.
- `chat-message.tsx`: `WorkingTextBlocks` gains `engagementSummary` prop; annotation renders inline to the right of the toggle — `<span data-testid="engagement-annotation">`, classes `flex min-w-0 items-center text-sm leading-relaxed text-text-subtle/60`, skill name with `shrink-0 whitespace-nowrap`, scenario with `truncate`, `·` separator, null = nothing.

**E. Selection-guide rule**

- `apps/api/prisma/bootstrap-preset-data.ts`: Skills rule added after `## Files`, before `## Deferred media honesty`. Deliberate one-time cache prefix invalidation.

**F. Tests**

- `apps/api/test/engagement-summary.derivation.test.ts` (new): 7 cases for `deriveEngagementSummary`.
- `apps/web/app/app/_components/chat-message.test.tsx`: 6 new engagement annotation cases (skill-only, skill+scenario, absent-null, absent-undefined, same-row structural, not-in-block-body).
- `apps/runtime/test/native-tool-projection.test.ts`: 4 new ADR-118 Slice 7 assertions for the Skills rule.
- `apps/api/test/auto-skill-routing-state.service.test.ts`: `activeScenarioDisplayName` added to all `RuntimeSkillDecisionState` fixtures.
- `apps/api/test/send-web-chat-turn.service.test.ts`: `activeScenarioDisplayName: null` in `skillDecisionState` mock.
- `apps/runtime/test/build-active-scenario-block.service.test.ts`: all `RuntimeSkillDecisionState` fixtures updated.
- `apps/runtime/test/turn-execution.service.test.ts`: 3 `RuntimeSkillDecisionState` fixtures updated.
- `apps/runtime/test/turn-routing.service.test.ts`: 3 `RuntimeSkillDecisionState` fixtures updated.

### Deviations / notes

- `engagementSummary` is derived from `skillDecisionState` in the same turn-completion path (both streaming SSE and non-streaming). Historical messages loaded via history API carry the `engagementSummary` if the field was stored in the turn state at commit time — no separate DB column change needed (JSON field additive).
- The `WorkingTextBlocks` component did not previously have a slot for annotations — the flex row was added as a new structural container wrapping both the toggle button and the new annotation span.
- `bootstrap-preset-data.ts` cache prefix change is deliberate and noted here as the one-time Slice 7 invalidation.

### Status

- **Not committed, not deployed.** Deploy expected BEFORE Slice 8.

### Verify gate

- lint PASS; format:check PASS; runtime-contract typecheck PASS; api typecheck PASS; web typecheck PASS; runtime typecheck PASS; provider-gateway typecheck PASS; api test PASS (exit 0); runtime test PASS (ADR-117 golden test passes); web test PASS (777/777); provider-gateway test PASS (exit 0).

### Next recommended step

- **Deploy Slice 7** (Slices 1–7 uncommitted; entire Slice 1–7 stack ships together).
- **ADR-118 Slice 8** (ADR closure + golden invariant tests) — after deploy confirmation.

---

## 2026-06-16 — ADR-118 Slice 6 landed — full dead-code sweep (classifier / cadence / HTTP route / lexical-gate stack)

### Scope — Phase 1 (classifier / HTTP route / caller chain)

- **`skill-state-routing.service.ts` deleted** (runtime): entire `SkillStateRoutingService` class — `SKILL_STATE_OUTPUT_SCHEMA`, `tryForegroundActivation`, `shouldTryForegroundActivation`, `matchesSkillLexically`, `checkSkillState`, all private helpers. ~441 lines gone.
- **`skill-state-routing.service.test.ts` deleted** (runtime test): ~165 lines.
- **`turns.module.ts`** (runtime): removed `SkillStateRoutingService` import, provider entry, and export entry.
- **`turns.controller.ts`** (runtime): removed `POST skill-routing-check` handler + `RuntimeSkillStateCheckResult` import.
- **`turn-execution.service.ts`** (runtime): removed `SkillStateRoutingService` import and constructor parameter; deleted `checkSkillRouting` method; removed `"checkSkillRouting"` from `assertSupportedTurnRequest` operation union.
- **`web-runtime-turn-client.service.ts`** (API): deleted `checkSkillRouting` method + `isRuntimeSkillStateCheckResult` helper.
- **`auto-skill-routing-state.service.ts`** (API): deleted `persistFromSkillCheckResult` (dead — no production callers after Slice 1).
- **`runtime-contract/src/index.ts`**: deleted `RuntimeSkillStateCheckResult` interface.
- Tests: `turn-execution.service.test.ts` (4 `SkillStateRoutingService` constructor args removed), `auto-skill-routing-state.service.test.ts` (2 `persistFromSkillCheckResult` blocks deleted), `send-native-web-chat-turn.service.test.ts` (1 whole test case deleted), `stream-web-chat-turn.service.test.ts` (mock updated).

### Scope — Phase 2 (lexical-gate residuals — ledger-gap batch)

Orchestrator audit found 10 methods in `turn-routing.service.ts` that the Slice 0 ledger missed (different names, not `matchesSkillLexically`). All 10 deleted:

- `resolveActiveAutoSkill` — reads `skillStateContext.decision`; inlined as direct state check at callsite.
- `carryForwardAutoSkillState` — trivial pass-through; inlined as `input.request.skillStateContext?.decision ?? null`.
- `shouldReuseActiveSkill` — carry-forward heuristic (lexical gate + short-follow-up check); replaced by `if (activeAutoSkill)` (trust the persisted state, no lexical fanfare).
- `buildSkillRoutingMatchText`, `hasSkillLexicalMatch`, `buildSkillRoutingTerms`, `tokenizeForSkillRouting`, `skillRoutingStems` — the exact lexical gate stack.
- `createAutoSkillStateOnClassifierFailure` — cadence-era failure synthesizer; callers now pass through `input.request.skillStateContext?.decision ?? null`.
- `buildTopicSummary` — only used by `createAutoSkillStateOnClassifierFailure`; deleted. `topicSummary` field kept on `RuntimeSkillDecisionState` (Slice 2 state-passthrough may write it via the `skill` tool response; separate cleanup if unused).

Additional cleanup driven by the method deletions:

- **`RuntimeSkillStateContext` simplified** (`packages/runtime-contract/src/index.ts`): `recentMessages`, `currentUserMessageIndex`, `forceCheck` fields removed (all dead after the 10-method deletion). `RuntimeSkillRoutingRecentMessage` type deleted.
- **`buildRuntimeContext` collapsed** (`auto-skill-routing-state.service.ts`): was async + 2 DB queries (count user messages + fetch up to 30 recent rows). Now synchronous one-liner `return { decision: input.decisionState }`. `selectRecentRoutingRows` private helper deleted. Constants `MAX_RECENT_ROUTING_MESSAGES` and `MAX_RECENT_ROUTING_USER_TURNS` deleted. Callers in `send-web-chat-turn.service.ts` + `stream-web-chat-turn.service.ts` updated from `await buildRuntimeContext` to synchronous call.
- **`driftRecheckDecision` test deleted** (`turn-routing.service.test.ts`) — tested `forceCheck: true` forcing a drift-detection re-check; behavior gone by design (model releases via `skill` tool now).
- `turn-routing.service.test.ts`, `turn-execution.service.test.ts`, `send-web-chat-turn.service.test.ts`, `stream-web-chat-turn.service.test.ts`: `currentUserMessageIndex`, `recentMessages`, `forceCheck` removed from `skillStateContext` constructions in tests.

### Deviations from ADR / ledger

- **Ledger gap identified and closed**: Slice 0 ledger missed the 10 lexical-gate methods in `turn-routing.service.ts` because they were named differently from `matchesSkillLexically`. Orchestrator audit caught them; all 10 deleted in the same sweep.
- `topicSummary` field kept on `RuntimeSkillDecisionState` — nothing writes it server-side now, but the Slice 2 `skill` tool state-passthrough may still carry a value set by the model-owned engage call. Separate cleanup if confirmed dead.
- `persistWebTurnSkillStateAndQueueBackgroundCheck` function name kept — name is now misleading (background check removed Slice 1; only persists state now), but not in required-zero list. Separate refactor.

### Status

- **Not committed, not deployed.** Orchestrator handles git closure.

### Verify gate

- lint PASS; format:check PASS; runtime typecheck PASS; api typecheck PASS; web typecheck PASS; provider-gateway typecheck PASS; runtime-contract typecheck PASS; runtime test PASS (exit 0); api test PASS (exit 0); provider-gateway test PASS (exit 0); web test PASS (772/772).

### Grep audit (required-zero in apps/ + packages/)

All 26 required-zero symbols return 0 active-code matches (first 15 from Phase 1, last 11 from Phase 2):
`matchesSkillLexically`, `tryForegroundActivation`, `shouldTryForegroundActivation`, `runBackgroundCheck`, `markBackgroundCheckQueued`, `markBackgroundCheckFailed`, `messageCountSinceCheck`, `backgroundCheckQueuedAtMessageIndex`, `skillCadenceState`, `RuntimeSkillCadenceState`, `DEFAULT_SKILL_ROUTING_`, `checkSkillState`, `checkSkillRouting`, `skill-routing-check`, `SkillStateRoutingService`, `hasSkillLexicalMatch`, `buildSkillRoutingTerms`, `tokenizeForSkillRouting`, `skillRoutingStems`, `buildSkillRoutingMatchText`, `shouldReuseActiveSkill`, `resolveActiveAutoSkill`, `carryForwardAutoSkillState`, `createAutoSkillStateOnClassifierFailure`, `buildTopicSummary`.

### Next recommended step

- **Slice 7** — UX engagement indicator (quiet Skill/Scenario annotation in the `:::working` block header row, to the right of the `Выполнено ▾` toggle) + one additive `skill` tool selection-guide rule line contributed to the ADR-117 canonical `tools` template (guarded by ADR-117 golden test). See ADR-118 Slice 7 plan.

## 2026-06-16 — ADR-118 Slice 5 landed (admin UI for SkillScenario authoring)

### Scope

- **Inline Scenarios section on Skill admin page** (`apps/web/app/admin/skills/page.tsx`): co-located below the existing Skill editor with fetch, list (ordered by `displayOrder`), status badges (draft/active/archived), archived-toggle, Create + Edit + Activate + Archive + Reactivate actions. Choice: inline expansion (not drill-in route) because the Skills page already uses expandable row sections and the user should not navigate away from the Skill editing context.
- **Scenario editor form** with full D3 field set: `key` (slug-regex validated, readonly after create), `displayName.{ru,en}`, `description.{ru,en}`, `iconEmoji`, `displayOrder`, `status`, `intentExamples` (up to 10), `recommendedTools` (checkboxes, hardcoded `NATIVE_SCENARIO_TOOL_KEYS` = `["image_generate","image_edit","video_generate","knowledge_search","memory_write","files","scheduled_action","background_task","skill"]` — no existing constant in codebase), `exitCondition`, structured `steps` editor with auto-number, `directive`, `recommendedToolCall` dropdown, `mayBeSkippedIf`, `negativeGuards`, up/down reorder, add/delete.
- **Inline validation**: `key` regex, at least one step, non-empty `directive` per step, soft yellow warning if last step misses `skill({` or `release`.
- **Live preview panes** (300 ms debounce): Pane A "Catalog rendering" matches `enabled-skills-prompt-materialization.ts` format with `ru`/`en` toggle; Pane B "Active Scenario developer block" matches `BuildActiveScenarioBlockService` output (formatting duplicated in `renderActiveScenarioBlockPreview` with comment to source file — service's private renderer was not extractable without changing runtime code).
- **API integration**: orval-generated `getAdminSkillScenarios`, `postAdminSkillScenario`, `patchAdminSkillScenario`, `deleteAdminSkillScenario` called directly from `@persai/contracts` with Bearer token; optimistic local state + refetch on success, error display on failure.
- **Tests** (`apps/web/app/admin/skills/page.test.tsx`): 10 new cases covering round-trip draft, payload shapes, validation blocking, `renderActiveScenarioBlockPreview`, `renderScenarioCatalogLine`, soft warning, `NATIVE_SCENARIO_TOOL_KEYS` membership. Total web suite now 772 tests.

### Deviation from ADR

- None. Inline expansion chosen (ADR was flexible on inline vs drill-in). Preview formatter duplicated in the page module (Slice 4 service renderer is private — no change to runtime code). `NATIVE_SCENARIO_TOOL_KEYS` hardcoded — no central constant exists in the codebase.

### Status

- **Not committed, not deployed.** Orchestrator handles git closure.

### Verify gate

- lint PASS; format:check PASS; web typecheck PASS; api typecheck PASS; runtime typecheck PASS; api test PASS (exit 0); runtime test PASS (exit 0); web test PASS (772/772).

### Next recommended step

- **Slice 6** — Dead-code sweep: delete `SkillStateRoutingService`, `matchesSkillLexically`, `tryForegroundActivation`, `AutoSkillRoutingStateService` cadence helpers, cadence constants, `skillCadenceState` column (Prisma migration), `routerPolicy.skillRoutingPolicy` admin field. See ADR-118 Slice 6 plan and the inventory ledger `docs/ADR/118-skill-engagement-inventory.md` R9 extension for the full hit list.

## 2026-06-16 — ADR-118 Slice 4 landed (scenario catalog materialization + active-scenario volatile block)

### Scope

- **Bundle extension:** `RuntimeBundleSkillScenarioStep` + `RuntimeBundleSkillScenario` in `packages/runtime-contract/src/index.ts`. `AssistantRuntimeEnabledSkillSummary.scenarios?: RuntimeBundleSkillScenario[]` in `packages/runtime-bundle/src/index.ts`.
- **Materialization:** `materialize-assistant-published-version.service.ts` — new private `resolveEnabledSkillScenariosForBundle` method fetches `status: "active"` rows from `skill_scenarios` by `skillId`, converts to bundle shape with locale resolution. Scenarios injected into both prompt cards (for catalog rendering) and `runtimeBundleArtifact.skills.enabled[i].scenarios`.
- **Catalog rendering:** `enabled-skills-prompt-materialization.ts` extended to render `Available scenarios:` section per Skill card in the cached prefix. Exported constant `SCENARIO_CATALOG_RENDER_LIMIT = 8`. `... +N more` footer for overflow. Zero scenarios → section omitted entirely. New `resolveEnabledSkillScenariosForBundle` export. Updated `EnabledSkillPromptCard` + `EnabledSkillPromptCandidate` with `scenarios` field.
- **Volatile block:** new `BuildActiveScenarioBlockService` — when `activeScenarioKey !== null && activeSkillId !== null`, looks up scenario in bundle, renders `## Active Scenario` block per D4, returns `ProviderGatewayTextMessage` with `cacheRole: "volatile_context"` + `volatileKind: "active_scenario"`. Graceful degrade (null + log) if skill/scenario missing from bundle. Registered in `turns.module.ts`.
- **Turn assembly:** `TurnExecutionService.prepareTurnExecution` now calls `buildActiveScenarioBlockService.buildBlock` and prepends the active scenario message before the memory block (scenario first, memory second).
- **Volatile wrapper widening:** `ProviderGatewayTextMessage.volatileKind?: "memory" | "active_scenario"` added. Anthropic wraps `active_scenario` with `<active_scenario>` / OpenAI wraps with `<persai_active_scenario>`. Memory path (missing or `"memory"`) emits byte-identical strings to the old hardcoded literals → **no real cache invalidation for existing memory blocks** (R3 confirmed).
- **Skill tool:** `RuntimeSkillToolService` new `executeEngageWithScenario` method validates `scenarioKey` against bundle, returns honest `availableScenarios` in `scenario_not_found`, or persists and returns full `engaged` payload.
- **Tests:** `build-active-scenario-block.service.test.ts` (8 cases); `runtime-skill-tool.service.test.ts` extended (scenario happy-path + honest availableScenarios); `enabled-skills-prompt-materialization.test.ts` extended (catalog format, overflow footer, zero-scenario omit, locale resolution, byte-stability); provider-gateway tests extended (back-compat memory + new `active_scenario` wrappers for Anthropic + OpenAI).

### Deviation from ADR

- None. `volatileKind` added as Option A (field on `ProviderGatewayTextMessage`), consistent with the existing `cacheRole` pattern. Slice 2 test (d) comment updated from "Slice 2 honesty: always returns scenario_not_found" to "scenario_not_found when skill has no scenarios in bundle".

### One-time cache invalidation (R3)

The old volatile memory wrappers were hardcoded literals. The new parameterized path emits **byte-identical strings** when `volatileKind === "memory"` or `volatileKind` is absent. Confirmed in both Anthropic (same `<recent_short_memory>` tag + same outer preamble text) and OpenAI (same `<persai_contextual_memory>` tag + same preamble text). **No actual user-facing cache miss for existing memory blocks.** The new `<active_scenario>` / `<persai_active_scenario>` tags are net-new and will not invalidate any existing cached prefix.

### Status

- **Not committed, not deployed.** Orchestrator handles git closure.

### Verify gate

- prisma generate PASS; lint PASS; format:check PASS; api typecheck PASS; web typecheck PASS; runtime typecheck PASS; provider-gateway typecheck PASS; runtime-contract typecheck PASS; api test PASS; runtime test PASS; provider-gateway test PASS; web test PASS (762/762).

### Next recommended step

- **Slice 5** — Admin UI scenario editor: CRUD editor for `SkillScenario` entries in the workspace management admin interface. The entity, API, contracts, and runtime infrastructure are all in place. Slice 5 is purely admin UI (no backend changes expected beyond minor OpenAPI consumers).

## 2026-06-16 — ADR-118 Slice 3 landed (`SkillScenario` entity + admin API)

### Scope

- New Prisma model `SkillScenario` (table `skill_scenarios`), enum `SkillScenarioStatus`, migration `20260616140000_adr118_skill_scenario`. FK to `Skill(id)` CASCADE; unique `(skillId, key)`; index `(skillId, status, displayOrder)`.
- `skill-scenario.types.ts`: full parser/serializer for `AdminSkillScenarioState`, `CreateSkillScenarioInput`, `UpdateSkillScenarioInput`. Key regex `^[a-z][a-z0-9_]{1,63}$`. Required `ru`+`en` locales enforced.
- `ManageSkillScenariosService`: `listScenarios` (archived excluded by default), `getScenario`, `createScenario` (ConflictException on duplicate key), `updateScenario` (key immutable; status transitions `draft→active`, `active→archived`, `archived→active` enforced), `archiveScenario` (idempotent). Every mutation calls `markAssignedAssistantsDirty(skillId)`.
- 5 scenario routes added to `AdminSkillsController` (GET list, POST create, GET single, PATCH update, DELETE archive). DELETE returns 200 with archived state.
- `ManageSkillScenariosService` registered in `workspace-management.module.ts`.
- OpenAPI: 7 new schemas + 5 new paths; `contracts:generate` run.
- Tests: `manage-skill-scenarios.service.test.ts` + `admin-skill-scenarios.controller.test.ts`.

### Deviation from ADR

- ADR references `skill.entity.ts` / `skill.repository.ts` / `prisma-skill.repository.ts` — these files do NOT exist in the codebase. The existing Skills admin service uses `WorkspaceManagementPrismaService` directly. `ManageSkillScenariosService` follows the same direct-Prisma pattern (no separate domain entity/repository files).
- ADR named the dirty-marker `markAssistantsConfigDirtyForSkill`; actual name in codebase is `markAssignedAssistantsDirty(skillId)`.

### Status

- **Not committed, not deployed.** Orchestrator handles git closure. Slice 3 can deploy independently (additive table + API).

### Verify gate

- prisma generate PASS; contracts:generate PASS; lint PASS (all workspaces); api typecheck PASS; web typecheck PASS; runtime typecheck PASS; provider-gateway typecheck PASS; runtime-contract typecheck PASS; api test PASS (exit 0); runtime test PASS; web test PASS (762/762). format:check: 667 pre-existing failures in `packages/contracts/src/generated/` (orval output); 0 failures in newly-authored files.

### Next recommended step

- **Slice 4** — Materialization: scenario catalog in `Enabled Skills` block (cached prefix) + `## Active Scenario` volatile developer block composition in runtime turn assembly. Requires:
  1. Extend `enabled-skills-prompt-materialization.ts` to render `active` scenarios per Skill (`key + displayName + 1-line desc + recommendedTools hint`).
  2. Surface `bundle.skills.enabled[i].scenarios[]` in materialized runtime bundle so runtime can resolve `scenarioKey → steps` without extra round-trip.
  3. New service `build-active-scenario-block.service.ts` (or co-located): when `skillDecisionState.activeScenarioKey !== null`, compose `## Active Scenario` block as `ProviderGatewayTextMessage` with `cacheRole: "volatile_context"`.
  4. Wire into turn assembly at the volatile-context insertion point.
  5. Swap `scenario_not_found` stub in `RuntimeSkillToolService` (Slice 2) with real catalog validation against `bundle.skills.enabled[i].scenarios[]`.
  6. Widen volatile-context wrappers in provider clients for `active_scenario` kind (Slice 0 ledger R3).
  - High complexity; recommend strong subagent.

## 2026-06-16 — ADR-118 Slice 2 landed (`skill` tool)

### Scope

- New `skill` tool: tool catalog row (`apps/api/prisma/tool-catalog-data.ts`, `policyClass: "platform_managed"`), runtime-tool-policy execution mode + native-execution flag (`runtime-tool-policy.ts`), `createSkillToolDefinition` in `native-tool-projection.ts` (flat schema, byte-stable, omitted when no enabled Skills), `RuntimeSkillToolService` (`apps/runtime/src/modules/turns/runtime-skill-tool.service.ts`), `PersaiInternalApiClientService.updateSkillState` method, `InternalRuntimeSkillStateService` + `InternalRuntimeSkillStateController` (internal port 3002, `POST /api/v1/internal/runtime/skill/state`), wired into `TurnExecutionService` + `turns.module.ts`. Slice 2 always returns `scenario_not_found` for any `scenarioKey` (Slice 4 will fill in real scenario validation). Chat resolution in the API: runtime sends `assistantId + channel + surfaceThreadKey`; API resolves to `chatId` via `AssistantChatRepository.findChatBySurfaceThread`.
- Tests: `runtime-skill-tool.service.test.ts` (9 cases), `internal-runtime-skill-state.controller.test.ts` (7 cases), new assertions in `native-tool-projection.test.ts` (projected with enabled skills / absent without), assertion in `seed-tool-catalog.test.ts`.

### Why

- ADR-118 step 2 in the orchestrator slice plan. Restores Skill engagement after Slice 1 made the cadence/classifier path inert. Together Slices 1+2 must deploy atomically.

### Status

- **Not committed, not deployed.** Orchestrator handles git closure. Slice 2 must deploy together with Slice 1.

### Verify gate

- lint PASS; format:check PASS; api typecheck PASS; web typecheck PASS; runtime typecheck PASS; provider-gateway typecheck PASS; runtime-contract typecheck PASS; api test PASS; runtime test PASS.

### Next recommended step

- **Orchestrator closure:** commit Slices 1+2 together, deploy, verify Skill engagement works via the `skill` tool.
- **Slice 3** — `SkillScenario` Prisma entity + admin API (medium complexity).

## 2026-06-16 — ADR-118 Slice 1 landed (decision state + cadence persistence trim)

### Scope

- `RuntimeSkillDecisionState` reshape to `{status, activeSkillId, activeSkillName, activeScenarioKey, topicSummary}` (`confidence` + `checkedAtMessageIndex` removed). R1 inline re-declarations updated. R7 cadence column drop + atomic-writer fix (same commit). `AutoSkillRoutingStateService` cadence helpers deleted; persistence kept. Cadence constants + `routerPolicy.skillRoutingPolicy` removed from `platform-runtime-provider-settings`, OpenAPI, admin runtime UI, generated contracts. `SkillStateRoutingService` file preserved; turn-execution caller removed (classifier inert).
- 29 files modified + 6 generated models deleted + 1 new Prisma migration directory (`20260616120000_adr118_drop_skill_cadence_state`).

### Why

- ADR-118 step 1 in the orchestrator slice plan. Makes the old cadence/classifier path inert by data shape (column dropped, helpers gone, decision-state no longer carries cadence fields) so Slice 2's `skill` tool can land cleanly on a clean slate. Slice 1 is intentionally not standalone — between Slice 1 and Slice 2, Skill engagement is OFF.

### Status

- Committed locally. **Not deployed.** Slice 2 (`skill` tool) must land in the same deploy.

### Verify gate

- format:check PASS; lint PASS; api typecheck PASS; web typecheck PASS; api test PASS; runtime test PASS. Web suite has one pre-existing `use-chat.test.tsx` resume-polling flake that passes when run in isolation — diff in `use-chat.ts` is shape-only (3 lines), unrelated to the flaky test. Migration regenerates `assistant-chats.skill_cadence_state` removal; Prisma client regenerated.

### Next recommended step

- **Slice 2 (`skill` tool)** — high complexity, must land in the same deploy. New tool catalog row, native projection, runtime service (`apps/runtime/.../runtime-skill-tool.service.ts`), internal API endpoint that flips the decision row in `assistant_chats.skill_decision_state` (reuses kept `AutoSkillRoutingStateService` persistence helpers from this slice), error paths. Subagent model: GPT-5.4 or Sonnet (not Opus per user instruction).

## 2026-06-15 — HOTFIX: runtime-contract startup crash (ADR-117 Slice 3 regression)

- **Symptom:** after pushing the ADR-117 + media work (`260837c2`), the dev rollout crash-looped new `api` and `runtime` pods (`api-6f6857f7d`, `runtime-78dc88bc64`) with `ERR_MODULE_NOT_FOUND: .../runtime-contract/src/media-prompt-fragments` imported from `index.ts`. Old pods kept serving, so dev stayed up.
- **Root cause:** Slice 3's `export … from "./media-prompt-fragments"` was the first relative import in the contract package, which is consumed as **un-built TS source** (`main` → `src/index.ts`, no build). Node 22 type-stripping ESM cannot resolve an extensionless relative specifier; `.ts` extension fails the emit typecheck (TS5097); no `.js` sibling exists.
- **Fix:** inlined the fragments directly into `packages/runtime-contract/src/index.ts` and deleted the sibling file → package back to a single self-contained module. Zero consumer-import changes (all already import from `@persai/runtime-contract`). Golden single-source test re-anchored to `index.ts`. Docs (`API-BOUNDARY`, `ARCHITECTURE`, `TEST-PLAN`, ADR-117 closure) updated.
- **Verify gate:** runtime-contract typecheck, **api emit build**, runtime+gateway typecheck, lint, golden single-source + projection test all green. Next: push → confirm rollout pods go Ready.

## 2026-06-15 — ADR-118 opened: Skill scenarios + model-owned activation

### Scope

- New OPEN program ADR: `docs/ADR/118-skill-scenarios-and-model-owned-activation.md`. Authored after ADR-117 entered closure mode (ADR-117 Slices 1-5 + hotfix landed; golden invariant test in place). Adds a new product concept (`SkillScenario`) and replaces hidden Skill activation (classifier + cadence + lexical-gate) with model-owned activation via a single `skill` tool. Slice 7 of ADR-118 contributes one additive rule line to the canonical `tools` selection guide guarded by the ADR-117 golden test (the same slice updates that golden test to accept the new Skills line).

### Why

- Three concrete failure modes today: (F1) activation latency/miss — foreground `matchesSkillLexically` substring gate refuses if Skill metadata doesn't literally contain user keywords; background classifier runs every 5 user messages with first check after the 3rd, so even when it activates it's at minimum 5 turns late; (F2) Skills carry only static `instructionCard` + `SkillKnowledgeCard` — no concept of admin-authored workflows like "Instagram-карусель: 8 slides via image_generate series"; (F3) no visible signal of active Skill since the old banner was removed.

### Decision (summary)

- **Three-level engagement model:** Enabled (Settings) → Active (model decides) → Running scenario (model decides). Skills KB priority retrieval + cache key now driven by explicit model action, not hidden gate.
- **Single tool `skill({ action: "engage" | "release", skillId?, scenarioKey? })`** — covers activation, exit, scenario selection, scenario switch.
- **`SkillScenario` first-class DB entity** — admin-authored structured workflows (key, displayName, description, intentExamples, steps[], recommendedTools[], exitCondition, lifecycle draft/active/archived). Steps are structured records with `directive + recommendedToolCall (text hint, not a constraint) + negativeGuards + mayBeSkippedIf`.
- **Volatile developer block for active scenario** — uses existing `cacheRole: "volatile_context"` pattern (ADR-110, ADR-112 Slice 2). Cached system prefix stays byte-stable across engage/release.
- **UX indicator** — inline annotation in the `:::working` block header row, **to the right of the `Выполнено ▾` toggle** (NOT a line inside the block body): `Маркетолог · Instagram-карусель` for Skill + scenario, `Маркетолог` for Skill without scenario, nothing if no active Skill. Subdued color, single row, ellipsis on narrow widths. No banner, no chip, no line inside the body.
- **One additive line in ADR-117 `tools` selection guide** — Slice 7 adds the Skills engagement rule additively to the canonical guide, no second template.
- **Dead-code sweep mandatory** — `SkillStateRoutingService`, `matchesSkillLexically`, `tryForegroundActivation`, `AutoSkillRoutingStateService` cadence helpers, cadence constants, `skillCadenceState` column, `routerPolicy.skillRoutingPolicy` admin field — all deleted in Slice 6. No flag-gating, no compatibility shims.

### Execution

- 9 slices (0 inventory → 1 state shape + cadence persistence trim → 2 `skill` tool → 3 `SkillScenario` entity + admin API → 4 materialization (catalog + volatile block) → 5 admin UI editor → 6 dead-code sweep → 7 UX indicator + selection-guide rule → 8 golden tests + docs + closure). For orchestrator-driven execution: orchestrator assigns slices to subagents, audits diffs, does not write code. Complexity tags `low/medium/high` per slice for subagent model selection.
- **Slices 1 and 2 must land in the same deploy** (Slice 1 makes old cadence inert; Slice 2 restores activation through the new tool). Window between them must be minimal.

### Status

- ADR authored only. No code touched. Not deployed, not committed.

### Slice 0 landed (2026-06-15, baseline SHA 4a0baa39)

- Deliverable `docs/ADR/118-skill-engagement-inventory.md` produced by read-only subagent. 37 ledger rows (vs ADR-118's ~10 expected — subagent uncovered an additional 27 reachable callsites), 35/35 delete verdicts with proven reachability (every caller listed by file:line), 0 unproven. Sections 1-7 complete: heuristics inventory, keep verdicts, `Enabled Skills` block independence proof, volatile-context end-to-end trace through Anthropic + OpenAI clients, Slice 6 hit list, risks R1-R10, verification (lint + format:check PASS).
- Orchestrator audit: 4 spot-checks against real code (`matchesSkillLexically`, `DEFAULT_SKILL_ROUTING_*`, `volatile_context` provider clients, `checkSkillRouting` chain) all matched ledger claims with correct file:line.
- 4 of 10 ledger risks folded back into ADR-118 as actionable adjustments:
  - **R1 → Slice 1:** explicit update of inline re-declarations in `assistant-runtime.facade.ts:~L115` and `apps/web/.../use-chat.ts:~L158` (not flowed by contract regen alone).
  - **R3 → Slice 4:** volatile-context wrappers currently memory-specific (`<recent_short_memory>` / `<persai_contextual_memory>`); Slice 4 widens them with a `volatileKind` parameter (`memory` → existing wrapper, `active_scenario` → `<active_scenario>`). One additional one-time deliberate cache invalidation for the memory wrapper bytes — explicitly logged.
  - **R7 → Slice 1:** `manage-admin-skills.service.ts:~L678-680` and `manage-assistant-skills.service.ts:~L172-175` both write `skillCadenceState` atomically with the decision row; Slice 1 must drop those writes in the **same commit** as the column drop, or Prisma fails with `Unknown field`.
  - **R9 → Slice 6:** ADR-118 originally underspecified — Slice 6 hit list now explicitly enumerates the `POST /api/v1/turns/skill-routing-check` route, `TurnExecutionService.checkSkillRouting`, `WebRuntimeTurnClientService.checkSkillRouting`, and downstream callers in three `*-web-chat-turn.service.ts` files.
- R2, R4, R5, R6, R8, R10 already covered by ADR or are cosmetic / docs-closure work (R4 lands in Slice 8).

### Next recommended step

- Execute **Slice 1 + Slice 2 together (same deploy)**. Slice 1 = state shape migration + cadence persistence trim + admin field removal + inline re-declarations updated (medium complexity, prefer strong subagent — Prisma migration + contract regen + 2 atomic writer-fixes + admin runtime trim). Slice 2 = the new `skill` tool (high complexity, requires strong subagent — new tool catalog row, native projection, runtime service, internal API endpoint, error paths). The two must land in the same deploy because Slice 1 leaves activation inert (old cadence stopped, new tool not yet shipped) and Slice 2 restores it.

## 2026-06-15 — ADR-117 opened: tool-instruction source-of-truth (Мир 2)

### Scope

- New OPEN program ADR: `docs/ADR/117-tool-instruction-source-of-truth-and-native-tool-runtime-selection-guide.md`. Governs Мир 2 only (which tool / when / how the provider renders), not the persona/system prefix (Мир 1, already clean).

### Why

- Model misfires on tool selection: instructions scattered across 4+ layers, media provider-prose duplicated 3×, and at least one factual drift (catalog tells the model to read `action="deferred"` but the real result is `action="pending_delivery"`; legacy `"deferred"` survives only in `turn-execution.service.ts:~5176`).

### Decision (summary)

- Three concerns, one source each: (1) WHICH/WHEN → Native Tool Runtime **selection guide** = the DB `tools` system-prompt block; (2) WHAT+params → tool descriptor (catalog → policy → projection); (3) HOW provider renders → one provider-conditioning constants module (runtime composers + gateway builders share it, model never re-reads it).
- Reconcile every instruction against real code; delete drift + dead paths (legacy `buildRuntimeToolPoliciesMarkdown`, ghost strippers — prove reachability first).

### Execution

- 6 slices (0 inventory → 1 selection guide → 2 catalog consolidation → 3 provider constants → 4 dead-code sweep → 5 golden tests/docs/closure). Intended for Sonnet subagents; each slice self-contained with its own verification gate. Additive-first to avoid leaving the model with less guidance mid-program.

### Status

- ADR authored. **Slice 0 done** (`docs/ADR/117-tool-instruction-inventory.md` — inventory + reconciliation ledger). **Slice 1 done** (selection guide). **Slice 2 done** (catalog consolidation + `agents` reduction). **Slice 3 done** (provider-conditioning constants module). **Slice 4 done** (dead-code & drift sweep). **Slice 5 done — program complete (deploy pending).** Not deployed, not committed.

### Slice 1 landed (Native Tool Runtime selection guide)

- `apps/api/prisma/bootstrap-preset-data.ts`: `tools` default replaced with the ~36-line cross-tool selection guide (images/vision, knowledge-web local-first, document, memory/tasks, files alias-first + delivery honesty, "call don't narrate", `pending_delivery` honesty). No param mechanics, no provider-conditioning prose (those stay in descriptor / Slice 3 constants).
- `apps/web/app/admin/presets/page.tsx` (+ `page.test.tsx`): `tools` block relabeled "Native Tool Runtime — Selection Guide"; removed stale `tools_catalog_block` variable chip; test asserts new label/description + chip absence (6/6 pass).
- **Additive-first respected:** `tool-catalog-data.ts` and `agents` template untouched.
- Gate green: lint, format:check, api+web+runtime typecheck, seed/compile/tool-policy + presets page tests.

### Slice 2 landed (catalog consolidation + agents reduction)

- **A1 — drift fix:** `image_generate`, `image_edit`, `video_generate` catalog `modelUsageGuidance`: `action="deferred"` → `action="pending_delivery"` (ledger R1). No model-facing `"deferred"` remains anywhere.
- **A2 — selection sentences removed:** dropped S4/S5 from `image_generate`, S7 from `image_edit`, S9/S10/S11 from `video_generate`, S13 from `web_search`, S14 from `web_fetch`, S15 from `scheduled_action`, S16 from `background_task`. Each replaced with short mechanical guidance where field would otherwise be empty.
- **A4 — multi-reference fix:** `image_edit.modelUsageGuidance` updated from singular `referenceImageAlias` to `referenceImageAliases` (plural, up to 15), matching the multi-ref API. "Ask instead of guessing" instruction retained.
- **A5 — files comment:** `files.modelUsageGuidance` annotated "policy-overridden: real model text comes from `runtime-tool-policy.ts` `resolveRuntimeToolUsageGuidance`".
- **B — agents reduction:** `agents` template reduced from "Memory and Task Governance" + Tasks Policy to "Memory Policy" only (4 bullets). Tasks selection now lives solely in the `tools` guide (Slice 1).
- **C — projection fallback:** `createScheduledActionToolDefinition` fallback updated: "Use background_task for assistant-side conditional checks." removed (duplicated S15).
- **D — admin UI:** `PRESET_META.agents` label → "Memory Policy"; description updated to reflect Memory Policy only. `agents_block` hint updated.
- **Prompt-cache note:** this slice changes the seeded `agents` default → another deliberate one-time prompt-cache prefix invalidation on rollout (next materialization will pick it up). Not deployed; not committed.
- Gate green: lint, format:check, api+web+runtime typecheck, api+runtime+web tests all pass.

### Additive-first proof (Slice 2)

| Removed sentence (ledger)                                                | Guide section that now owns it                                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| S4 image_generate "not for editing/video"                                | Selection Guide §Images: "Create/generate → `image_generate`; Modify/edit → `image_edit`; Animate → `video_generate`" |
| S5 image_generate "call immediately / never narrate"                     | Selection Guide: "call the tool immediately — never print a fake call…"                                               |
| S7 image_edit "do not use for description/OCR"                           | Selection Guide §Images: "Describe/analyze → answer from vision; do NOT call an image tool"                           |
| S9 video_generate "use only for generated video/animation"               | Selection Guide §Images: "Animate or create a short video clip → `video_generate`"                                    |
| S10 video_generate "do not use for editing/image questions"              | Selection Guide §Images: mutual exclusion with image_edit + vision                                                    |
| S11 video_generate "call immediately / never narrate"                    | Selection Guide: global "call immediately" rule                                                                       |
| S13 web_search "when you need sources/links"                             | Selection Guide §Knowledge & Web: "need sources or links without an exact URL → `web_search`"                         |
| S14 web_fetch "when you already know the exact URL"                      | Selection Guide §Knowledge & Web: "know the exact URL → `web_fetch`"                                                  |
| S15 scheduled_action "do not use for hidden checks; use background_task" | Selection Guide §Memory & Tasks: "Conditional check → `background_task`"                                              |
| S16 background_task "`scheduled_action` is only for reminders"           | Selection Guide §Memory & Tasks: "Simple unconditional reminder → `scheduled_action`"                                 |

### Slice 3 landed (provider-conditioning constants module)

- **Canonical fragments (in `packages/runtime-contract/src/index.ts`):** `ANTI_COLLAGE_RULE`, `STANDALONE_IMAGE_RULE`, `STANDALONE_GENERATED_IMAGE_RULE`, `STANDALONE_EDITED_IMAGE_RULE`, `referenceGuidanceRule({ multiple })`, `seriesItemHeaderLine(index,total)`. Placed in the shared contract package (not runtime-local) because `@persai/provider-gateway` is a separate package and must reference the exact same strings — true single-source. NOTE: originally a sibling `media-prompt-fragments.ts`, but folded into `index.ts` by the 2026-06-15 hotfix (un-built-source runtime constraint — see below).
- **Consumers refactored:** runtime `runtime-image-generate-tool.service.ts` + `runtime-image-edit-tool.service.ts` composers, and gateway `openai-provider.client.ts` (`generateImage` count>1, `buildImageEditPrompt`) now import the fragments. Provider semantics unchanged (wording unified to the most complete variant; `seriesItemHeaderLine` byte-identical). The runtime edit `referenceLine` keeps its alias-named form (it embeds real `image #N` aliases — different shape than the generic builder).
- **Model-facing trim:** removed the collage/grid/multi-panel provider-hygiene clause from `image_generate`/`image_edit` descriptions in `native-tool-projection.ts`; kept `count=N`/`outputMode='series'` intent and the `referenceImageAliases` "rooted in source" param-choice guidance.
- **Tests:** updated `openai-provider.client.test.ts` (unified wording assertion), `native-tool-projection.test.ts` (collage `doesNotMatch` + `runMediaPromptFragmentsSanityTest`), registered the sanity test in `run-suite-isolated.ts`.
- Gate green: lint, format:check, all-package typecheck (incl. runtime-contract), provider-gateway suite, runtime projection + sanity (via temp runner). Not deployed; not committed.

### Slice 4 landed (dead-code & drift sweep)

- **Removed (proven dead):** `buildRuntimeToolPoliciesMarkdown` (`runtime-tool-policy.ts`); `buildPromptToolMarkdownEntry` + orphaned `joinPromptToolInstruction` (`prompt-constructor-tool-metadata.ts`); the `generateToolsPrompt` `else` markdown fallback (`compile-prompt-constructor.service.ts`). Missing-`tools`-template case (cold-migration only) now → empty tools block + one `warn` log.
- **Removed ghost-verb sanitizers** from `native-tool-projection.ts` (the four `containsLegacy*`/`resolveSanitized*` fns); call sites now use `resolveToolDefinitionDescription` directly. Re-confirmed zero live matches before deleting.
- **Reconcile:** `files` hardcoded description in `runtime-tool-policy.ts` now lists `preview`.
- **Kept:** document-tool `action !== "deferred"` guard in `turn-execution.service.ts`.
- Tests updated: `compile-prompt-constructor.service.test.ts` (warned empty-block), `runtime-tool-policy.test.ts` (no markdown builder + `preview`), `native-tool-projection.test.ts` (raw descriptions).
- Gate green: lint, format:check, api+web+runtime+gateway typecheck, affected api tests + runtime projection/sanity (temp runner). Not deployed; not committed.

### Slice 5 landed (golden single-source test + closure)

- `apps/runtime/test/native-tool-projection.test.ts`: `runMediaPromptFragmentsSanityTest` now reads the live production sources from disk and fails if ADR-117 ownership drifts: collage/contact-sheet/diptych wording re-inlined outside `packages/runtime-contract/src/index.ts`, runtime/provider media paths stop importing the shared fragments, `tool-catalog-data.ts` reintroduces `action="deferred"` or cross-tool comparison prose, or `bootstrap-preset-data.ts` loses the selection-guide marker / reintroduces an `agents` Tasks Policy.
- Doc truth updated in `docs/API-BOUNDARY.md`, `docs/ARCHITECTURE.md`, and `docs/TEST-PLAN.md` to record the D1 precedence rule, the three-concern seam, and how to run the golden test through the runtime temp-runner path.
- `docs/ADR/117-tool-instruction-source-of-truth-and-native-tool-runtime-selection-guide.md` now has a closure section: slices 0-5 all marked done, final owner table reaffirmed, reachability proofs cited from the inventory ledger Section 4, residual kept document-tool guard recorded, and `cache-prefix rollout SHA: PENDING` until materialization rollout + GKE deploy happen.
- Gate green on this slice's current tree: lint, format:check, api/web/runtime/runtime-contract typecheck, and runtime temp-runner projection + golden sanity tests. No deploy, no commit.

### Next recommended step

- Materialization rollout + GKE deploy (records the cache-prefix rollout SHA), then optionally the separate knowledge-output markdown-normalization slice.

## 2026-06-15 — image_edit multi-reference inputs (up to 16)

### Scope

- Bounded feature slice (no ADR). User: lift the prior 2-image `image_edit` limit to OpenAI gpt-image-1's 16 total inputs (source + up to 15 references), wired production-grade across all layers.

### What landed

- **Contract** (`packages/runtime-contract`): `MAX_RUNTIME_IMAGE_EDIT_INPUT_IMAGES=16`, `MAX_RUNTIME_IMAGE_EDIT_REFERENCE_IMAGES=15`; `RuntimeImageEditRequest.referenceImageAliases` + result `referenceImageAliases`/`referenceFilenames`; `ProviderGatewayImageEditRequest.referenceImages`. Legacy single `referenceImage(Alias)` kept (deprecated, merged in).
- **Tool projection** (`native-tool-projection.ts`): new `referenceImageAliases` array param (maxItems 15) + updated `image_edit` descriptions; references stay "guidance only", output rooted in source.
- **Runtime service** (`runtime-image-edit-tool.service.ts`): parser merges single+array aliases, dedupes case-insensitively, drops source-collisions, caps at 15; `resolveImageSelection` loads N references; `composeSeriesPrompt` + logs list all refs; result payloads carry plural fields.
- **Provider-gateway** (`provider-image-generation.service.ts`): normalizes `referenceImages` (prefers array, falls back to single), caps at 15.
- **OpenAI client** (`openai-provider.client.ts`): builds `image=[source, ...references]`; plural prompt wording for >1 reference, single-reference wording preserved verbatim.

### Verification

- Full gate green: lint (all workspaces), format:check, typecheck (contract/runtime/provider-gateway/api/web). Tests: runtime media-request-parsing 13/13 (3 new multi-ref cases), full runtime suite pass, provider-gateway openai-client + image-generation-service pass (new multi-ref assertions).
- NOT deployed to `persai-dev`; NOT committed (pending user direction).

### Next recommended step

- Commit + deploy; live-test `image_edit` with 3+ reference aliases for `alex@agse.ru` and confirm OpenAI receives source + all refs (watch `[image-edit] ... referenceAliases=[...]` log).

## 2026-06-15 — Image gen/edit silent-cut + missing-prompt bugfix

### Scope

- Bounded bugfix slice (no ADR). Triaged a `persai-dev` incident for `alex@agse.ru`: image carousel turn cut off mid-reply with **no error** and produced no image; re-asking worked.

### Root cause (from kubectl logs, turn `c8c44383`)

1. **Silent stream cut:** the web `slow_avg` cadence watchdog (`avgThresholdMs=200`) fired on the slow post-tool wrap-up answer (observed `rollingAvgMs=322`) and aborted the runtime fetch. Side-effect turns are not safe to retry, so the reply stayed truncated.
2. **No image:** the `image_edit` call shipped `outputMode="series"` + 4 `seriesItems` but **no top-level `prompt`**, so the parser returned `invalid_arguments` → `skipped` → `/media-jobs/enqueue` was never called (confirmed: enqueue present for the working retries `4b02033a`/`e95161b3`, absent for `c8c44383`).

### What landed

- `apps/api/.../cadence-watchdog.ts`: `slow_avg` disabled for the rest of a span once any tool starts (`recordToolStarted`); pure-text turns unchanged. New regression test.
- `apps/runtime/.../runtime-image-edit-tool.service.ts` + `runtime-image-generate-tool.service.ts`: `prompt` optional in series mode (synthesized overall prompt); non-series still requires it. Added `requestId`-tagged `skipped` warn logs to previously silent branches. New parser tests.

### Verification

- Gate green: api/runtime/web typecheck, format:check, lint (api+runtime). Tests: cadence-watchdog 22/22, runtime media-request-parsing 10/10.
- NOT yet deployed to `persai-dev`; NOT committed (clean-tree change pending user direction).

### Next recommended step

- Deploy to `persai-dev` and re-run the original carousel flow for `alex@agse.ru` to confirm: full reply (no cut) + job enqueued. Watch new `[image-edit]/[image-generate] skipped reason=...` logs to catch any other skip causes.

## 2026-06-14 — ADR-116 closed (file re-view: inspect, read, preview)

### Baseline

- `ff9e4cbb` on `main`; deployed to `persai-dev` (`runtime`, `provider-gateway`, `api`, `web`).

### What landed (116.0–116.3)

- **116.0:** `files.inspect` / contract `files.preview`; plan `maxFilePreviewBytes` + `maxFilePreviewEdgePx`; Admin Plans UI; materialized `RuntimeToolPolicy`; capability matrix.
- **116.1:** `files.read` metadata (`charCount`, `truncated`, `readNote`, `extractionCached`, `extractionQuality`); sanitizer clip truth; extract API `cached: true` on hits.
- **116.2:** `files.preview` for `image/*` + native PDF; ephemeral `toolFollowUpUserContent` injection; unified hydration byte/edge limits from bundle.
- **116.3:** focused unit tests, doc truth (`API-BOUNDARY`, `TEST-PLAN`, `DATA-MODEL`), live acceptance on `persai-dev` — all four checklist items PASS (see ADR-116 closure table).

### Verification

- Repo gate at `ff9e4cbb`: lint, format:check, typecheck, test, test:step2.
- Live: `files.preview` on historical images; `preview_size_limit` at plan limit 25 bytes; success at 8 MB with `file_preview` runtime log.

### Next recommended step

- No open ADR-116 work. Await explicit user priority for the next program (e.g. skill scenarios consumer of `files.preview`, or unrelated slice).
