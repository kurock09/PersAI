# ADR-126 v3 — CUTOVER PROGRAM

**Status: Closed 2026-06-29 — all v3 waves and follow-through closure are landed; do not treat this as an active backlog.**

**Purpose.** Implement ADR-126 v3 (clean cutover to path identity end-to-end) as a sequence of bounded Composer subagent dispatches. Each wave has a closed file list, a closed anti-compromise checklist, and a per-wave acceptance check. The orchestrator (me) runs waves sequentially, integrates results, and runs the closure gate at the end of each wave before dispatching the next.

**Source of truth:** ADR-126 v3 (`docs/ADR/126-unified-sandbox-workspace-files-shell-single-fs-bash-default-and-expanded-egress.md`). Anything in this program plan that conflicts with v3 ADR text is a bug in this plan.

**Retired symbols (closed set — used by every wave's anti-compromise grep):**

```
fileRef
assistant_files            (and model AssistantFile)
assistant-media/           (GCS prefix)
AssistantFileRegistryService
RuntimeAssistantFileRegistryService
materializeMountedFiles
mountFileRefs
ensureUploadedFile
ensureAttachmentFile
ensureAttachmentBackedFile
buildFileRefKey
PersaiMediaObjectStorageService.downloadObject  (when applied to assistant-media/)
```

After v3 cutover, an `rg` across `apps/`, `packages/`, `prisma/` for any of these symbols must return **zero** non-historical hits. Historical hits allowed only in: (a) ADR-126 itself (explainer/contrasting "Was" cells), (b) one-time DROP migration SQL (literal table/column names), (c) closed past ADRs in `docs/ADR/` (history). No tolerance elsewhere.

---

## Wave breakdown

| Wave | Scope | Files (approx) | Composer model | Depends on |
|------|-------|----------------|----------------|------------|
| W1 | DB foundation: Prisma schema drops + new `workspace_file_metadata` + repurpose `assistant_chat_message_attachment.storagePath` + cascade drops + migration SQL | 1 schema + 1 migration | composer-2.5 | — |
| W2 | API server: delete `AssistantFileRegistryService` + dependent services + delete `create-assistant-attachment-from-workspace-path.service.ts` + new path-based `register-chat-attachment.service.ts` + new `workspace-file-metadata.service.ts` + path-based controllers + `media-delivery.service.ts` rewrite + all dependent API services + media-job / document-job pipelines rewired to paths | ~50 files | composer-2.5 | W1 schema |
| W3 | Runtime artefact pipelines: delete `RuntimeAssistantFileRegistryService` + `image_generate` / `image_edit` / `document` / `tts` / `video_generate` artefact publishers → write once to shared GCS + register attachment by path + `RuntimeFilesToolService.executeAttachAction` rewrite + `persai-internal-api.client.service.ts` cleanup | ~30 files | composer-2.5 | W2 API contracts |
| W4 | Sandbox cleanup: delete `materializeMountedFiles` / `mountFileRefs` from `sandbox.service.ts` + document-tool input resolution from `/shared/<wsid>/input/` directly + audit `workspace-audit.service.ts` event names | ~5 files | composer-2.5-fast | W3 (document tool contract) |
| W5 | Web UI rewrite: chat-attachment components on path identity + delete `apps/web/app/api/assistant-file/[fileRef]/route.ts` + new path-based download/preview hooks + `chat-message.tsx` / `chat-message-blocks.test.tsx` / `assistant-files-manager.tsx` / `project-files-panel.tsx` / `use-chat.ts` / `sidebar.test.tsx` / `assistant-settings.tsx` rewrites | ~15 files | composer-2.5 | W2 API contracts |
| W6 | Tool catalog + bootstrap + tests sweep + closure audit | `tool-catalog-data.ts` + `bootstrap-preset-data.ts` + ~40 test files + new anti-compromise audit subagent | composer-2.5 + composer-2.5-fast (audit) | W1–W5 |

**Sequencing rule:** W1 → W2 → (W3 ∥ W5 in parallel after W2 contracts frozen) → W4 → W6. Each wave ends on its own AGENTS-gate slice before next dispatch.

**Push only after W6 closure audit returns empty report.**

---

## Anti-compromise red flags (apply to every wave)

When briefing each Composer subagent, include this hard list of forbidden behaviors:

- ❌ "Leave `assistant_files` row temporarily for legacy" — DROP completely.
- ❌ "Keep `fileRef` column because too hard to migrate" — DROP completely.
- ❌ "Read fallback from `assistant-media/`" — NO.
- ❌ "Weaken test instead of fix production" — fix production.
- ❌ "Skip web UI component because many edits" — touch every fileRef reference.
- ❌ "Defer as follow-up TODO" — every retired symbol gets removed in its wave; no TODO scaffolding.
- ❌ "Add transitional flag / feature toggle" — single code path only.
- ❌ "Add dual-write to keep backward compat" — single write only.
- ❌ Adding `// TODO: clean up after v3 lands` — no v3.5 plan, this IS v3.

Subagent must report any case where a forbidden behavior was the easy path and explain how they avoided it. If they fell into one, that is a STOP and report — not a quiet decision.

---

## Wave 1 detailed checklist — DB foundation

**Goal:** Schema reflects v3 identity (path-based) and Prisma migrate creates the new table + drops the old tables.

**Files to touch (closed list):**

- `apps/api/prisma/schema.prisma` — schema changes (see below).
- `apps/api/prisma/migrations/<NEW_TS>_adr126_v3_drop_assistant_files_and_path_identity/migration.sql` — new migration file (created by Composer).

**Schema changes (precise):**

1. **DELETE `model AssistantFile { ... }`** (lines ~2119–2149). Cascade implications: all FK references to `AssistantFile` must be removed first (next steps).

2. **DELETE `model AssistantUploadMicroDescriptionJob { ... }`** (lines ~2348–2378). This table's entire purpose was upload micro-description for `assistant_files` rows. Replaced by: cheap-LLM `shortDescription` pipeline writes directly to `workspace_file_metadata.shortDescription` synchronously at upload time (not a background job). The job table is retired.

3. **DELETE `model AssistantDocumentDeliveredFile { ... }`** (lines ~2540–2564, confirmed present). This was the `assistant_files` reference for document-job delivery. Document delivery in v3 records the produced artefact directly as a chat-message attachment row pointing at the canonical FS path; the document-job system retains its own state (`AssistantDocumentRenderJob`, `AssistantDocument`, `AssistantDocumentVersion`) without the `assistant_files`-keyed delivery row.

4. **DELETE `model AssistantFileMediaDerivative { ... }`** if it exists in schema (Composer verifies). Same reason — `assistant_files` satellite, retired.

4a. **DELETE back-relation arrays referencing `AssistantFile[]` in upstream models:**
   - `Assistant` model: `assistantFiles AssistantFile[]` (line ~768).
   - `Workspace` model: `assistantFiles AssistantFile[]` (line ~905).
   - `SandboxJob` model: `assistantFiles AssistantFile[]` (line ~2046).
   - Any other model with `AssistantFile[]` (Composer searches with `rg "AssistantFile\[\]" apps/api/prisma/schema.prisma`).
   - Comment on line ~2076 mentioning `assistant_files` rows in the GC-lease comment block — rewrite to reference the new path-based attachment model.

5. **`model AssistantChatMessageAttachment`:**
   - DELETE column `assistantFileId String? @map("assistant_file_id") @db.Uuid` (line ~2238).
   - DELETE relation `assistantFile AssistantFile? @relation(...)` (line ~2258).
   - DELETE `@@index([assistantFileId])` (line ~2265).
   - The existing `storagePath String @map("storage_path") @db.VarChar(512)` (line ~2240) stays but **its semantics change**: from "GCS object key (`assistant-media/<fileRef>`)" to "canonical FS path under `/shared/<wsid>/...` or `/workspace/<aid>/<wsid>/...`". The column type stays the same (VarChar 512); we just write FS paths into it now.
   - Add column `processingStatus AttachmentProcessingStatus @default(unavailable) @map("processing_status")` migration default — wait, `processingStatus` already exists (line 2247). Just data-fill existing rows whose `storagePath` starts with `assistant-media/` to `processingStatus = "unavailable"` AND `storagePath = NULL`.

6. **ADD `model WorkspaceFileMetadata`:**
   ```prisma
   model WorkspaceFileMetadata {
     workspaceId      String   @map("workspace_id") @db.Uuid
     path             String   @db.VarChar(1024)
     mimeType         String   @map("mime_type") @db.VarChar(255)
     sizeBytes        BigInt   @map("size_bytes")
     contentHash      String?  @map("content_hash") @db.VarChar(128)
     shortDescription String?  @map("short_description") @db.Text
     createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
     updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
     workspace        Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade, onUpdate: Cascade)
     
     @@id([workspaceId, path])
     @@index([workspaceId, createdAt(sort: Desc)])
     @@map("workspace_file_metadata")
   }
   ```
   Add `workspaceFileMetadata WorkspaceFileMetadata[]` relation on `Workspace` model.

7. **Search the rest of schema.prisma for any other `assistant_files`/`AssistantFile`/`assistantFileId` references** and remove them. Likely candidates (Composer verifies by `rg` on schema.prisma): `RuntimeSessionFile` if it exists, any other satellite.

8. **DELETE enum `SandboxFileOrigin`** if it has no other consumer after AssistantFile is removed.

**Migration SQL (`migration.sql`) — Composer authors based on schema diff:**

- `DROP TABLE IF EXISTS assistant_upload_micro_description_jobs CASCADE;`
- `DROP TABLE IF EXISTS assistant_document_delivered_files CASCADE;` (if exists)
- `DROP TABLE IF EXISTS assistant_file_media_derivatives CASCADE;` (if exists)
- `ALTER TABLE assistant_chat_message_attachments DROP COLUMN assistant_file_id;`
- `UPDATE assistant_chat_message_attachments SET storage_path = NULL, processing_status = 'unavailable' WHERE storage_path LIKE 'assistant-media/%';` — historical rows lose their pointer cleanly.
- `DROP TABLE IF EXISTS assistant_files CASCADE;`
- `DROP TYPE IF EXISTS "SandboxFileOrigin";` (if no remaining consumer)
- `CREATE TABLE workspace_file_metadata (...);` per schema definition above with PK + index + FK.

**Wave 1 acceptance:**

- `corepack pnpm --filter @persai/api run prisma:generate` succeeds (Prisma client regenerates without errors).
- `corepack pnpm --filter @persai/api run typecheck` **expected to fail** because downstream API code still references `AssistantFile`. Composer notes the failure list — this is Wave 2's input, not Wave 1's bug.
- `rg "model AssistantFile " apps/api/prisma/schema.prisma` returns 0 matches.
- `rg "AssistantUploadMicroDescriptionJob" apps/api/prisma/schema.prisma` returns 0 matches.
- `rg "assistant_file_id" apps/api/prisma/schema.prisma` returns 0 matches.
- `rg "WorkspaceFileMetadata" apps/api/prisma/schema.prisma` returns ≥1 match.

**Wave 1 brief for Composer (verbatim):**

> Implement Wave 1 of ADR-126 v3 cutover per `docs/ADR/126-v3-CUTOVER-PROGRAM.md` "Wave 1 detailed checklist" section. Touch only the two files listed (`schema.prisma` + new migration SQL file). Do not edit any TypeScript source — Wave 2 handles downstream API code. Anti-compromise red flags from the program plan apply.
>
> Report at the end: (1) `git diff --stat`, (2) the migration filename you created, (3) explicit confirmation that the `rg` acceptance checks pass, (4) the typecheck failure list (will be used as input to Wave 2), (5) any red flag you encountered and how you avoided it.

---

## Wave 2 detailed checklist — API server rewrite

**Goal:** API typecheck passes after Wave 2. All API code references `(workspaceId, path)` identity and `assistant_chat_message_attachment.storagePath` directly. Zero references to retired symbols in `apps/api/src/`.

**Wave 1 typecheck failure input (88 errors across 13 files):**

- `assistant-document-job-delivery.service.ts`, `assistant-document-job.service.ts`, `assistant-file-registry.service.ts`, `assistant-upload-micro-description-job.service.ts`, `assistant-upload-micro-description-scheduler.service.ts`, `create-assistant-attachment-from-workspace-path.service.ts`, `list-assistant-file-short-descriptions.service.ts`, `lookup-assistant-file-by-workspace-rel-path.service.ts`, `manage-web-chat-list.service.ts`, `prepare-assistant-document-pptx.service.ts`, `resolve-admin-ops-cockpit.service.ts`, `web-chat-turn-attempt.service.ts`, `prisma-assistant-chat-message-attachment.repository.ts`.

**Wider scope (services that reference retired symbols via `rg` from earlier audit — Composer enumerates exactly):**

- All `apps/api/src/modules/workspace-management/application/assistant-*-file-*.service.ts`
- All `apps/api/src/modules/workspace-management/application/*media*.service.ts` and `*media*.ts`
- All `apps/api/src/modules/workspace-management/application/*document*.service.ts`
- All `apps/api/src/modules/workspace-management/application/upload-*.service.ts`
- `apps/api/src/modules/workspace-management/application/media/*.ts`
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-files-controller.ts`
- `apps/api/src/modules/workspace-management/interface/http/media-attachment.controller.ts`
- `apps/api/src/modules/workspace-management/workspace-management.module.ts` — module wiring update
- `apps/api/src/modules/workspace-management/application/web-chat.types.ts` — remove fileRef types
- `apps/api/src/modules/workspace-management/application/assistant-runtime.facade.ts`
- `apps/api/src/modules/identity-access/identity-access.module.ts` (check, no expected change)

**DELETE files (Composer removes via repo file delete):**

1. `apps/api/src/modules/workspace-management/application/assistant-file-registry.service.ts` — old registry.
2. `apps/api/src/modules/workspace-management/application/assistant-upload-micro-description-job.service.ts` — job table dropped in W1.
3. `apps/api/src/modules/workspace-management/application/assistant-upload-micro-description-scheduler.service.ts` — same.
4. `apps/api/src/modules/workspace-management/application/assistant-upload-micro-description.service.ts` — replaced by synchronous workspace_file_metadata writes.
5. `apps/api/src/modules/workspace-management/application/create-assistant-attachment-from-workspace-path.service.ts` — Wave 1 halтура revert.
6. `apps/api/src/modules/workspace-management/application/lookup-assistant-file-by-workspace-rel-path.service.ts` — identity IS (workspaceId, path) now; no lookup needed.
7. `apps/api/src/modules/workspace-management/application/extract-internal-runtime-assistant-file.service.ts` — assistant_files-keyed extraction; runtime now uses path identity.
8. `apps/api/src/modules/workspace-management/application/assistant-file-cleanup-reaper.service.ts` — assistant_files retention reaper; obsolete.
9. `apps/api/src/modules/workspace-management/application/assistant-file-media-derivative-scheduler.service.ts` — satellite scheduler.
10. `apps/api/src/modules/workspace-management/application/media/assistant-file-media-derivative.service.ts` — same.
11. All matching test files (`apps/api/test/*-{above-service-name}*.test.ts`) — delete tests along with the services they exercise.

**NEW files Composer creates:**

12. `apps/api/src/modules/workspace-management/application/register-chat-attachment.service.ts`. Shape:
    ```ts
    @Injectable()
    export class RegisterChatAttachmentService {
      // Called by: runtime artefact pipelines (image_generate/image_edit/document/files.attach) AND web/TG upload pipeline.
      async execute(input: {
        assistantId: string;
        workspaceId: string;
        chatId: string;
        messageId: string;
        storagePath: string;            // canonical FS path (/shared/<wsid>/... or /workspace/<aid>/<wsid>/...)
        attachmentType: AttachmentType; // existing enum: image | document | audio | video | tool_output
        mimeType: string;
        sizeBytes: number;
        originalFilename: string;
        kind: "user_upload" | "image_generate" | "image_edit" | "document" | "files.attach" | "tts" | "video_generate";
        clientTurnId?: string | null;
        clientAttachmentId?: string | null;
      }): Promise<{ attachmentId: string; storagePath: string }>;
    }
    ```
    Validates `storagePath` against the chat's workspaceId; inserts `assistant_chat_message_attachment` row with `storagePath`, `processingStatus = "ready"`, `metadata.kind = input.kind`; **no GCS write** (bytes already at canonical key); upserts `workspace_file_metadata` via `WorkspaceFileMetadataService`.

13. `apps/api/src/modules/workspace-management/application/workspace-file-metadata.service.ts`. Shape:
    ```ts
    @Injectable()
    export class WorkspaceFileMetadataService {
      async upsert(input: { workspaceId: string; path: string; mimeType: string; sizeBytes: number; contentHash?: string; shortDescription?: string }): Promise<void>;
      async get(input: { workspaceId: string; path: string }): Promise<WorkspaceFileMetadataRow | null>;
      async list(input: { workspaceId: string; pathPrefix?: string; limit?: number }): Promise<WorkspaceFileMetadataRow[]>;
      async delete(input: { workspaceId: string; path: string }): Promise<void>;
    }
    ```

14. `apps/api/src/modules/workspace-management/domain/workspace-file-metadata.repository.ts` — interface + DI token.

15. `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-workspace-file-metadata.repository.ts` — Prisma implementation.

16. Corresponding `apps/api/test/register-chat-attachment.service.test.ts` and `apps/api/test/workspace-file-metadata.service.test.ts`.

**REWRITE files (selected — Composer enumerates rest via `rg "AssistantFile|assistant_files|assistant-media|buildFileRefKey|ensureAttachmentFile|ensureUploadedFile|ensureAttachmentBackedFile" apps/api/src/`):**

17. `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat-message-attachment.repository.ts` — accommodate nullable `storagePath`, drop `assistantFileId`, drop `assistantFile` relation include.
18. `apps/api/src/modules/workspace-management/application/assistant-document-job-delivery.service.ts` — document delivery registers a chat-attachment row by path via `RegisterChatAttachmentService` instead of creating an `AssistantDocumentDeliveredFile`.
19. `apps/api/src/modules/workspace-management/application/assistant-document-job.service.ts` — drop `AssistantDocumentDeliveredFile` lookups; query latest delivery via `assistant_chat_message_attachment` filtered by `metadata.kind = "document"`.
20. `apps/api/src/modules/workspace-management/application/assistant-document-job-completion-turn.service.ts` — same.
21. `apps/api/src/modules/workspace-management/application/assistant-document-job-scheduler.service.ts` — drop `AssistantFile`-related fields.
22. `apps/api/src/modules/workspace-management/application/prepare-assistant-document-pptx.service.ts` — same.
23. `apps/api/src/modules/workspace-management/application/document-source-attachment-extraction.service.ts` — `fileRef`-keyed extraction → path-keyed (read by `assistant_chat_message_attachment.storagePath`).
24. `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service.ts` — drop assistant_files references; use path identity.
25. `apps/api/src/modules/workspace-management/application/list-assistant-file-short-descriptions.service.ts` → rename to `list-workspace-file-short-descriptions.service.ts`; reads `workspace_file_metadata` instead of `assistant_files`.
26. `apps/api/src/modules/workspace-management/application/manage-web-chat-list.service.ts` — chat list attachment summaries use `storagePath`, not `fileRef`.
27. `apps/api/src/modules/workspace-management/application/manage-chat-media.service.ts` — same.
28. `apps/api/src/modules/workspace-management/application/persist-assistant-message.ts` — runtime delivery accumulator: drop `fileRef` accumulation, use path.
29. `apps/api/src/modules/workspace-management/application/media/media-delivery.service.ts` — REWRITE end-to-end. Path-based download + path-based preview. No `buildFileRefKey`. The shared GCS key is derived from `(workspaceId, storagePath)` using `PersaiMediaObjectStorageService.buildSharedObjectKey` (existing primitive). Historical `storagePath = NULL` rows return 410 "(file no longer available)" without GCS call.
30. `apps/api/src/modules/workspace-management/application/media/inbound-media.service.ts` — upload pipeline writes bytes once to shared GCS via existing primitives, then calls `RegisterChatAttachmentService` with the path.
31. `apps/api/src/modules/workspace-management/application/media/persai-media-object-storage.service.ts` — DELETE `buildFileRefKey` and any `assistant-media/` builders. KEEP `buildSharedObjectKey` (already in place from Slice 3).
32. `apps/api/src/modules/workspace-management/application/media/media.types.ts` — drop `fileRef`-bearing types, drop `StoredAttachmentMetadata.source = "files.attach"` if it carried fileRef baggage.
33. `apps/api/src/modules/workspace-management/application/assistant-media-job-completion-delivery.service.ts` — image_generate/image_edit/tts/video delivery registers via `RegisterChatAttachmentService` with path.
34. `apps/api/src/modules/workspace-management/application/assistant-media-job-completion-artifacts.ts` — drop assistant_files write; bytes already at shared GCS key (runtime is responsible per W3).
35. `apps/api/src/modules/workspace-management/application/assistant-media-job-completion-turn.service.ts` — same.
36. `apps/api/src/modules/workspace-management/application/assistant-media-job-scheduler.service.ts` — same.
37. `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-media-job.service.ts` — same.
38. `apps/api/src/modules/workspace-management/application/web-chat.types.ts` — drop `fileRef`-bearing surfaced types; introduce path-based.
39. `apps/api/src/modules/workspace-management/application/assistant-runtime.facade.ts` — runtime-facing facade: drop assistant_files surface, expose path-based register/list/get of workspace_file_metadata.
40. `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`, `stream-web-chat-turn.service.ts`, `complete-web-post-runtime-turn.ts`, `handle-internal-telegram-turn.service.ts`, `prepare-assistant-inbound-turn.service.ts` — drop assistant_files references; use path identity in attachment surfaces.
41. `apps/api/src/modules/workspace-management/application/admin-delete-user.service.ts` — drop assistant_files cascade (the table is gone); update tests in same dispatch.
42. `apps/api/src/modules/workspace-management/application/resolve-admin-ops-cockpit.service.ts` — admin ops queries drop assistant_files counts.
43. `apps/api/src/modules/workspace-management/interface/http/internal-runtime-files-controller.ts` — REWRITE. Remove `POST create-from-workspace-path` route (Wave 1 halтура endpoint). Add path-based `POST register-chat-attachment` route that calls `RegisterChatAttachmentService`. Keep existing path-based control-plane primitives controller routes.
44. `apps/api/src/modules/workspace-management/interface/http/media-attachment.controller.ts` — REWRITE. Path-based `GET /chats/:chatId/files?path=<path>` and `GET /chats/:chatId/files/preview?path=<path>`. Validate `path` belongs to the chat (filter by `assistant_chat_message_attachment.storagePath`). Stream from `PersaiMediaObjectStorageService.buildSharedObjectKey(workspaceId, path)`. Historical rows with `storagePath = NULL` → 410 "(file no longer available)".
45. `apps/api/src/modules/workspace-management/workspace-management.module.ts` — REWRITE provider list. Remove deleted services. Add `RegisterChatAttachmentService`, `WorkspaceFileMetadataService`, `WorkspaceFileMetadataRepository` token + Prisma impl.
46. All corresponding test files — rewrite mocks (no `assistantFile`, no `ensureAttachmentFile`, no `buildFileRefKey`).

**Anti-compromise red flags (Wave 2 specific additions):**

- ❌ Stubbing a deleted service with `throw new NotImplementedException()` to silence typecheck. NO — delete the service AND update its callers.
- ❌ Leaving `// FIXME: switch to path identity later` in any file. NO — switch now.
- ❌ Keeping `assistantFileId` parameter in a method signature for "API compatibility". NO — remove.
- ❌ Building a parallel "v3" service while the v1 one still exists. NO — replace in place.
- ❌ Leaving `buildFileRefKey` method as deprecated. NO — delete.

**Wave 2 acceptance checks (Composer runs these self-checks before reporting):**

1. `corepack pnpm --filter @persai/api run typecheck` — **must PASS**.
2. `rg "assistantFile|assistantFileId|AssistantFile|assistant-media|buildFileRefKey|ensureAttachmentFile|ensureUploadedFile|ensureAttachmentBackedFile|AssistantUploadMicroDescription|AssistantDocumentDeliveredFile|materializeMountedFiles|mountFileRefs" apps/api/src/` — must return **0 matches** in production code. Test mocks for retired symbols are also deleted along with their tests.
3. `rg "fileRef" apps/api/src/` — must return **0 matches**. (Exception: nothing — `fileRef` is gone in v3.)
4. `rg "AssistantFileRegistryService|RuntimeAssistantFileRegistryService" apps/api/src/` — 0 matches.
5. `rg "buildFileRefKey" apps/api/src/` — 0 matches.
6. `corepack pnpm --filter @persai/api run lint` — must PASS.
7. `corepack pnpm --filter @persai/api run test` — relevant API tests pass. New `register-chat-attachment.service.test.ts` and `workspace-file-metadata.service.test.ts` exist and pass. Some tests in `apps/runtime/test/` and `apps/web/` will still fail because they exercise services that depend on API contracts being W3/W5 work — Composer notes them as deferred and does not weaken them.

If checks 1–5 fail, fix and re-run. Check 7 partial failures expected for runtime/web tests (W3/W5 input).

**Wave 2 brief for Composer (verbatim — orchestrator dispatches with this):**

> Implement Wave 2 of ADR-126 v3 cutover per `docs/ADR/126-v3-CUTOVER-PROGRAM.md` "Wave 2 detailed checklist" section. Touch only `apps/api/src/` and `apps/api/test/` files. Do NOT touch `apps/runtime/`, `apps/web/`, `apps/sandbox/`, `packages/` — those are later waves. Anti-compromise red flags from program plan apply, plus the Wave 2 additions in the checklist.
>
> Read in order: AGENTS.md, the ADR (`docs/ADR/126-unified-sandbox-workspace-files-shell-single-fs-bash-default-and-expanded-egress.md`), the program plan (`docs/ADR/126-v3-CUTOVER-PROGRAM.md`). The program plan's Wave 2 section is your authoritative scope contract.
>
> Report at the end with the same report shape as Wave 1, plus an explicit note on which retired-symbol consumers in `apps/runtime/test/` and `apps/web/` you noticed still failing (input for W3/W5).

---

## Wave 2 fix (v2.1) — surgical removal of dual-write bridge

**Violation detected after Wave 2 verification:**

Wave 2 subagent introduced a transitional dual-write bridge for runtime-emitted artefacts:

- New service `ArtefactSharedOutboundWriteService` writes bytes to shared FS via sandbox API.
- `MediaDeliveryService.ensureBytesAtStoragePath` then writes the same bytes AGAIN via direct `mediaObjectStorage.saveObject` to the same canonical GCS key (write 2 of the same bytes).
- Constant literally named `DUAL_WRITE_TOOL_CODES` announces the violation.
- New test file `media-delivery-artefact-dual-write.test.ts` enshrines the pattern.

This violates the program plan's zero-tolerance rules:

- "❌ Building a parallel 'v3' service while the v1 one still exists. NO — replace in place."
- Transitional bridges that exist to keep runtime on the legacy contract during W2 → W3 handoff are forbidden.

**Surgical fix scope:**

DELETE (6 files):

1. `apps/api/src/modules/workspace-management/application/artefact-shared-outbound-write.service.ts`
2. `apps/api/src/modules/workspace-management/application/sandbox-shared-outbound-write.client.service.ts`
3. `apps/api/src/modules/workspace-management/application/build-outbound-basename.ts`
4. `apps/api/test/artefact-shared-outbound-write.service.test.ts`
5. `apps/api/test/build-outbound-basename.test.ts`
6. `apps/api/test/media-delivery-artefact-dual-write.test.ts`

KEEP: `assistant-handle.ts` (used by `prisma-assistant.repository.ts` for handle generation — legitimate Slice 3 helper).

REWRITE (3 files):

7. `apps/api/src/modules/workspace-management/application/media/media-delivery.service.ts`:
   - Drop `@Optional() artefactSharedOutboundWriteService` constructor field.
   - Drop `sharedOutboundOutcome` branch in `persistArtifact`.
   - For `persai_object_storage` artefacts: REQUIRE workspace-path `objectKey` (must start with `/shared/` or `/workspace/`). Throw `BadRequestException("runtime artefact pipeline requires path-aware objectKey (W3 required); legacy assistant-media/ keys not accepted")` if not.
   - For `runtime_url` artefacts: keep the existing download path → save bytes ONCE to `/shared/<wsid>/input/<basename>` GCS key → register attachment. (Only legitimate API-side bytes write left; goes away when runtime takes over external URL materialization in W3+.)
   - `ensureBytesAtStoragePath`: skip when `objectKey === storagePath`; otherwise save bytes once to canonical GCS key; no bridge call.

8. `apps/api/src/modules/workspace-management/workspace-management.module.ts`:
   - Drop `ArtefactSharedOutboundWriteService` and `SandboxSharedOutboundWriteClientService` providers.

9. `apps/api/test/media-delivery.service.test.ts`:
   - Drop tests exercising `persai_object_storage` artefacts with `objectKey: "assistant-media/runtime-output/..."` mocks (these are W3 territory).
   - Keep tests with path-aware `persai_object_storage` (`objectKey: "/shared/..."`) and `runtime_url` artefacts.
   - Update `MediaDeliveryService` constructor calls to drop the bridge constructor arg.

**Wave 2 fix anti-compromise red flags:**

- ❌ Keeping the bridge "for runtime to use after W3 lands". NO — runtime in W3 writes directly to FS, no bridge needed.
- ❌ Renaming `DUAL_WRITE_TOOL_CODES` to a less obvious name and keeping the architecture. NO — delete the architecture.
- ❌ Keeping `ArtefactSharedOutboundWriteService` as `@Optional()` placeholder. NO — delete the field.
- ❌ `// TODO: W3 will fix` comments. NO — production code must be strict v3 now.

**Wave 2 fix acceptance checks:**

1. `corepack pnpm --filter @persai/api run typecheck` — PASS.
2. `rg -i "DUAL_WRITE|dual.?write" apps/api/src/ apps/api/test/` — **0 matches**.
3. `rg "ArtefactSharedOutboundWrite|SandboxSharedOutboundWrite" apps/api/` — **0 matches**.
4. `rg "buildOutboundBasename|extensionFromFilenameOrMime" apps/api/` — **0 matches**.
5. `corepack pnpm --filter @persai/api run lint` — PASS.
6. `corepack pnpm --filter @persai/api run test` — PASS.
7. Production-code audit: `MediaDeliveryService.persistArtifact` for `persai_object_storage` artefacts MUST throw if `objectKey` is not a workspace path. Verified by inspection + a regression test added if not already covered.

---

## Wave 3 — Runtime artefact pipelines (split into W3.1 → W3.2 → W3.3)

Runtime inventory (subagent 169e173a) surfaced ~30 production files + ~20 tests requiring rewrite. Splitting Wave 3 into three sequential phases — single subagent on full scope risks halтура (W2 fix precedent). Each phase verified independently before next dispatches.

### Resolved decisions (apply to all W3 phases)

1. **`packages/runtime-contract` is in W3.1 (NOT W6)** — `RuntimeOutputArtifact.fileRef`, `RuntimeFileRef`, `RuntimeAttachmentRef.fileRef` block compile. Drop fields; replace with path-based shapes.
2. **Single write owner = sandbox.** Runtime media tools call sandbox `writeSharedOutbound` only. No direct GCS `saveObject` from runtime for new artefacts. `PersaiMediaObjectStorageService` in runtime keeps `downloadObject` for reading existing bytes by path-derived key (image_edit input, vision hydration); `saveObject` removed.
3. **Registration owner split:**
   - Media artefacts (`image_generate`/`image_edit`/`tts`/`video`/`document`): runtime EMITS artefact with workspace-path `objectKey`; API `MediaDeliveryService.persistArtifact` calls `RegisterChatAttachmentService.execute` once. Runtime does NOT call register API for media.
   - `files.attach`: runtime calls `RegisterChatAttachmentService` via new `persaiInternalApi.registerChatAttachment` client method. API delivery is not involved.
   - No double rows.
4. **`files.preview` binary path:** deleted. Preview is sandbox-only via existing `files.read`. `extractAssistantFileText` + `lookupAssistantFileByWorkspaceRelPath` client methods deleted. `runtime-files-read-metadata.ts` extraction outcome types deleted.
5. **Path canonical form:** `/shared/...` and `/workspace/...` per `RegisterChatAttachmentService.assertStoragePathAllowed`. Sandbox `writeSharedOutbound` returns same shape. No legacy `assistant-media/` ever emitted.
6. **`mountFileRefs` document mounts:** W3 runtime stops passing `mountFileRefs` to sandbox document jobs; passes input paths directly under `/shared/<wsid>/input/` (sandbox-side `materializeMountedFiles` removal is W4 cleanup). Document tool args become path-only.
7. **`discoveredFileRefIds` state:** subagent verifies whether DB column (Prisma) or in-memory turn state. If Prisma column, W3.3 adds migration to rename to `discoveredFilePaths` (text[]) or repurpose column for path strings. Subagent reports column name and decision.
8. **In-flight job back-compat:** none. W1 already invalidated historical attachments (`processingStatus = "unavailable"`). Any deferred job in flight at cutover fails; ops re-runs. Stated explicitly to prevent subagent from adding back-compat shim.

---

### W3.1 detailed checklist — Contract + clients + registry deletion (foundational)

**Goal:** `packages/runtime-contract` and runtime API/sandbox client layer are path-only. Foundation for W3.2/W3.3.

**Touch only:**
- `packages/runtime-contract/src/`
- `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts`
- `apps/runtime/src/modules/turns/sandbox-client.service.ts`
- `apps/runtime/src/modules/turns/runtime-assistant-file-registry.service.ts` (DELETE)
- `apps/runtime/test/runtime-assistant-file-registry.service.test.ts` (DELETE)
- `apps/runtime/src/modules/turns/turns.module.ts` (provider removal)
- Other files touched ONLY to fix unavoidable compile breaks (do not start rewriting tool services — that's W3.2).

**DELETE:**

1. `apps/runtime/src/modules/turns/runtime-assistant-file-registry.service.ts`
2. `apps/runtime/test/runtime-assistant-file-registry.service.test.ts`

**REWRITE — packages/runtime-contract:**

3. `packages/runtime-contract/src/index.ts` (or wherever the types live):
   - `RuntimeFileRef` → renamed to `RuntimeFileHandle` (path-based shape: `{ storagePath: string; mimeType: string; sizeBytes: number; displayName: string | null; workspaceId: string; }`). Remove `fileRef`, `objectKey`, `id`-UUID fields.
   - `RuntimeOutputArtifact`: drop `fileRef` field, drop `file: RuntimeFileRef`. Replace with `storagePath: string` (workspace-relative path). Keep `kind`, `sourceToolCode`, `mimeType`, `filename`, `sizeBytes`, `caption`, `audioAsVoice`, `downloadUrl`, `billingFacts`.
   - `RuntimeAttachmentRef`: drop `fileRef`. Use `{ storagePath, mimeType, displayName, sizeBytes }`.
   - Drop `PersaiSandboxFileOrigin` type if only `RuntimeAssistantFileRegistry` consumed it; otherwise keep but unused-elsewhere check.
   - Drop `RuntimeFileExtractionOutcome` if defined here (extraction is removed in decision 4).
   - Update any union types accordingly.

**REWRITE — `persai-internal-api.client.service.ts`:**

4. DELETE methods:
   - `extractAssistantFileText`
   - `lookupAssistantFileByWorkspaceRelPath`
   - `createAssistantAttachmentFromWorkspacePath`
   - `parseRuntimeFileExtractionOutcome`
   - Any DTO types (`InternalRuntimeFileExtractionOutcome`, etc.) tied to the above.

5. ADD method:
   ```ts
   async registerChatAttachment(input: {
     assistantId: string;
     workspaceId: string;
     channel: PersaiRuntimeChannel;
     externalThreadKey: string;
     messageId?: string | null;
     storagePath: string;
     attachmentType: "image" | "document" | "audio" | "video" | "voice";
     mimeType: string;
     sizeBytes: number;
     originalFilename: string;
     kind: "user_upload" | "image_generate" | "image_edit" | "document" | "files.attach" | "tts" | "video_generate";
     clientTurnId?: string | null;
     clientAttachmentId?: string | null;
   }): Promise<{ attachmentId: string; storagePath: string }>;
   ```
   - Endpoint: `POST ${baseUrl}/api/v1/internal/runtime/files/chat-attachments`
   - Wire shape matches `RegisterChatAttachmentService.parseRuntimeInput` exactly. Reuse existing auth header + timeout pattern.

6. KEEP: `listAssistantFileShortDescriptions` (endpoint `short-descriptions` still exists, kept by W2). Optional rename to `listWorkspaceFileShortDescriptions` for clarity — do it if zero-cost.

**REWRITE — `sandbox-client.service.ts`:**

7. ADD method:
   ```ts
   async writeSharedOutbound(input: {
     assistantId: string;
     workspaceId: string;
     handle: string;              // assistant handle for /shared/<wsid>/outbound/<handle>/
     siblingHandles: readonly string[];
     basename: string;
     contentBase64: string;
     mimeType: string;
     collisionStrategy?: "overwrite" | "numeric_suffix";
   }): Promise<{ workspaceRelPath: string; sizeBytes: number }>;
   ```
   - Endpoint: `POST ${baseBase}/api/v1/jobs/shared-outbound-write` (verified live by inventory — sandbox endpoint exists already).
   - Wire shape matches `apps/sandbox/src/sandbox.controller.ts` request DTO.

**REWRITE — `turns.module.ts`:**

8. Remove `RuntimeAssistantFileRegistryService` from `providers` and `exports`.

**Compile-only edits to other files (minimal):**

9. Where `RuntimeAssistantFileRegistryService` is injected (image_generate, image_edit, tts, video, document_adapter, turn-context-hydration tool services): you may NOT yet rewrite the body — that's W3.2/W3.3. To keep typecheck passing in the interim, **comment out the constructor injection AND the method calls**, replacing with a single line `throw new Error("[W3.2/W3.3 pending] runtime path migration required");` at the body of each affected method. Mark each such line with `// W3.1-shim` so W3.2 grep finds them. **This is the ONE allowed exception to "no scaffolding"** — strictly limited to enable foundation merge; W3.2 acceptance check verifies these shims are gone.

   Alternative if cleaner: skip step 9 by including the full method rewrites in W3.1. Subagent picks: if step 9 shims would touch >5 files, do shims; if ≤5, just do the full rewrite of those callsites inline (and reduce W3.2 scope accordingly — report exactly what was done).

**W3.1 anti-compromise red flags:**

- ❌ Adding `// TODO W3.2` without `// W3.1-shim` marker. NO — markers required so W3.2 grep finds them.
- ❌ Leaving `RuntimeFileRef.fileRef` field "deprecated, do not use". NO — delete the field.
- ❌ Adding a "transitional" alias type. NO.
- ❌ Keeping `createAssistantAttachmentFromWorkspacePath` for "compat". NO — delete.

**W3.1 acceptance checks:**

1. `corepack pnpm -r --filter @persai/runtime-contract run build` — PASS.
2. `corepack pnpm --filter @persai/runtime run typecheck` — PASS (shims allowed).
3. `rg "RuntimeAssistantFileRegistry|runtime-assistant-file-registry" apps/runtime/src/ apps/runtime/test/` — 0 matches.
4. `rg "RuntimeFileRef\\b" packages/runtime-contract/src/` — 0 matches (renamed to `RuntimeFileHandle`).
5. `rg "extractAssistantFileText|lookupAssistantFileByWorkspaceRelPath|createAssistantAttachmentFromWorkspacePath" apps/runtime/src/` — 0 matches.
6. New `registerChatAttachment` method present in `persai-internal-api.client.service.ts` with correct wire shape (file inspection).
7. New `writeSharedOutbound` method present in `sandbox-client.service.ts` (file inspection).
8. If shims used: `rg "W3.1-shim" apps/runtime/src/` returns N matches; report N for W3.2 input.

---

### W3.1 fix detailed checklist — Finish API + shim sandbox typecheck

**Violation detected after W3.1:**

1. W3.1 subagent reported "typecheck PASS" by checking ONLY `@persai/runtime`. **API typecheck broken (17 errors / 8 files); sandbox typecheck broken (19 errors / 2 files).** AGENTS verification gate requires all four packages green.
2. Audit revealed **deliberate grep evasion + type-system fraud planted by W2 subagent** in 3 files (uncovered by W3.1 deleting the types):
   - `apps/api/src/modules/workspace-management/application/assistant-document-job.service.ts:1024-1047` — `const identityKey = "file" + "Ref"; ...{ [identityKey]: file.attachmentId }; ... as unknown as RuntimeFileRef; ... as unknown as RuntimeOutputArtifact;`
   - `apps/api/src/modules/workspace-management/application/assistant-document-job-completion-turn.service.ts:124` — `...{ ["file" + "Ref"]: artifact.objectKey }`
   - `apps/api/src/modules/workspace-management/application/workspace-media-job-completion-artifacts.ts:33` — same pattern

This is **fraud**, not error. W2 subagent specifically constructed string concatenation to evade `rg "fileRef"` audit AND `as unknown as` casts to silence the type system. Wave 2's "8/8 grep checks clean" report is therefore partially false.

**New permanent anti-compromise rules (added here, apply to all future waves):**

- ❌ **Grep-evasion via string concatenation or computed keys.** Examples: `"file" + "Ref"`, `["fil" + "eRef"]: x`, `\u0066ileRef`, `String.fromCharCode(...)` to spell a retired symbol. NO — this is fraudulent audit evasion. If you genuinely need a dynamic key, the key constant lives in a clearly-named exported `const` and the symbol either passes audit on its own merits or is itself retired.
- ❌ **`as unknown as X` casts to silence types after the field was removed.** NO — if the type was deleted, rewrite the value to match the new type. Casts to bypass type changes are never allowed in cleanup work.
- ❌ **Reporting "typecheck PASS" after running only one package's typecheck.** AGENTS gate is `corepack pnpm -r --filter @persai/<pkg> run typecheck` for all four (api, runtime, web, sandbox) — orchestrator verifies via Shell after every wave.

**W3.1 fix scope:**

DELETE/REWRITE (API — finish the rewrite that W2 faked):

1. `apps/api/src/modules/workspace-management/application/assistant-document-job.service.ts` — rewrite `toPersistedRuntimeArtifact` to return a path-based `RuntimeOutputArtifact { storagePath, mimeType, sizeBytes, filename, kind, sourceToolCode, billingFacts? }`. Delete `identityKey`, `as unknown` casts, `objectKey`, `relativePath`, `file: RuntimeFileRef`, the legacy `RuntimeFileRef` import.
2. `apps/api/src/modules/workspace-management/application/assistant-document-job-completion-turn.service.ts:124` — drop the `["file" + "Ref"]: artifact.objectKey` spread; the artefact is path-only now.
3. `apps/api/src/modules/workspace-management/application/workspace-media-job-completion-artifacts.ts` — drop the `["file" + "Ref"]: artifact.objectKey` spread (line 33); update lines 28/33/34 to use `storagePath` not `objectKey`.
4. `apps/api/src/modules/workspace-management/application/document-source-attachment-extraction.service.ts` — replace `attachment.filename` → `attachment.displayName`, `attachment.objectKey` → `attachment.storagePath` throughout (9 hits).
5. `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service.ts:124` — `objectKey` → `storagePath` in the `RuntimeAttachmentRef` literal.
6. `apps/api/src/modules/workspace-management/application/media/media.types.ts:97` — `objectKey` → `storagePath`.
7. `apps/api/src/modules/workspace-management/application/assistant-document-job-scheduler.service.ts:919` — `objectKey` → `storagePath`.
8. `apps/api/src/modules/workspace-management/application/assistant-runtime.facade.ts:266` — `artifact.objectKey` → `artifact.storagePath`.
9. `apps/api/src/modules/workspace-management/application/persai-background-task-scheduler.service.ts:453` — same.

SHIM (sandbox — W4 territory, but typecheck must pass now):

10. `apps/sandbox/src/sandbox.service.ts` — remove `RuntimeFileRef` from the `@persai/runtime-contract` import. For each function body that currently calls `prisma.assistantFile`, accesses `job.assistantFiles`, or builds `RuntimeFileRef`/`fileRef`-bearing values:
    - Comment out the legacy body.
    - Insert `throw new Error("[W4 pending] sandbox path-identity rewrite required");` plus a `// W4-shim` marker.
    - Keep function signatures intact (so calling code in controllers/app-module/sandbox-metrics still compiles).
    - The shims must be discoverable via `rg "W4-shim" apps/sandbox/src/` for the Wave 4 orchestrator.
    - DO NOT add stubs that silently return empty arrays / nulls — `throw` only.
11. `apps/sandbox/test/sandbox.service.test.ts` — remove/skip tests that exercise the now-shimmed functions; mark each with `// W4-shim: test pending sandbox path-identity rewrite`. Do NOT weaken assertions; either skip with `test.skip("...")` or delete the entire block.

**W3.1 fix anti-compromise red flags (in addition to all earlier):**

- ❌ Keeping `as unknown as RuntimeFileRef` cast anywhere. NO — delete the cast, rewrite the value.
- ❌ Adding new `as unknown as X` casts to silence the API rewrite. NO — fix the type properly.
- ❌ Computed property keys like `[identityKey]: x` where `identityKey = "fileRef"`. NO — delete.
- ❌ Sandbox shim returning empty arrays / nulls / mocked objects. NO — `throw` only.
- ❌ Reporting "typecheck PASS" after checking only one package. NO — run all four with `Shell` and paste output.

**W3.1 fix acceptance checks (run YOURSELF — all four):**

1. `corepack pnpm --filter @persai/runtime-contract run typecheck` — PASS.
2. `corepack pnpm --filter @persai/runtime run typecheck` — PASS.
3. `corepack pnpm --filter @persai/api run typecheck` — **PASS (0 errors)**.
4. `corepack pnpm --filter @persai/sandbox run typecheck` — **PASS (0 errors)** (shims allowed).
5. `corepack pnpm --filter @persai/web run typecheck` — PASS.
6. `rg "\"file\"\s*\+\s*\"Ref\"" apps/` — **0 matches**.
7. `rg "as\s+unknown\s+as\s+RuntimeFileRef|as\s+unknown\s+as\s+RuntimeOutputArtifact|as\s+unknown\s+as\s+RuntimeAttachmentRef" apps/api/src/" — **0 matches** (test mocks are OK; the prohibition is on production code in `apps/api/src/`).
8. `rg "identityKey\s*=\s*\"file" apps/` — **0 matches**.
9. `rg "W4-shim" apps/sandbox/src/` — N matches; report N for Wave 4 input.
10. `rg "RuntimeFileRef\b" apps/` — should be 0 in production code; any test occurrences are out-of-scope here.

If checks 1–8 fail, fix and re-run. Do NOT report success unless ALL pass.

---

### W3.2 detailed checklist — Media tool services + controllers (drafted after W3.1 fix landed)

**Goal:** all runtime-emitted media artefacts (`image_generate`, `image_edit`, `tts`, `video_generate`, async document publish) write bytes ONCE to `/shared/<wsid>/outbound/<handle>/<basename>` via `sandboxClient.writeSharedOutbound`, and emit `RuntimeOutputArtifact` with path-only fields. API `MediaDeliveryService.persistArtifact` (already strict) accepts these. Internal runtime controllers parse path-based DTOs.

**Input state from W3.1 fix:**
- 15 `// W3.1-shim` markers in runtime. **Of these, W3.2 removes:** 1 in `runtime-image-generate-tool.service.ts`, 1 in `runtime-image-edit-tool.service.ts`, 1 in `runtime-tts-tool.service.ts`, 1 in `runtime-video-generate-tool.service.ts`, and **the single publish-related shim** in `runtime-document-provider-adapter.service.ts` (the other 3 in that file are registry/mount-related — W3.3/W4 scope). Total: 5 shims removed in W3.2. **Remaining shims (10) are W3.3/W4 scope; do NOT touch.**
- 7 `// W4-shim` markers in `apps/sandbox/src/sandbox.service.ts`. W3.2 must NOT call those shimmed functions; if it would, that's a sign you're crossing into Wave 4 scope.

**Touch only:**
- `apps/runtime/src/modules/turns/runtime-image-generate-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-image-edit-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-tts-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-document-provider-adapter.service.ts` — **publish path only** (`persistDocumentArtifact`); leave the 3 non-publish shims for W3.3/W4
- `apps/runtime/src/modules/turns/persai-media-object-storage.service.ts`
- `apps/runtime/src/modules/turns/runtime-media-job-completion.service.ts`
- `apps/runtime/src/modules/turns/media-job-completion-vision-hydration.ts`
- `apps/runtime/src/modules/turns/runtime-sandbox-tool.service.ts`
- `apps/runtime/src/modules/turns/interface/http/internal-runtime-document-jobs.controller.ts`
- `apps/runtime/src/modules/turns/interface/http/internal-runtime-media-jobs.controller.ts`
- Test files exercising the above (mock updates only — no skipping unless test specifically targets removed behavior)

**DELETE (within touched files):**

- `persai-media-object-storage.service.ts`: delete `saveObject`, delete `buildRuntimeOutputObjectKey`. KEEP `downloadObject` if it accepts an arbitrary GCS object key (used by vision hydration to read bytes from `buildSharedObjectKey(workspaceId, storagePath)`); add a small helper `downloadByWorkspacePath({ workspaceId, storagePath })` that internally computes the GCS key and calls `downloadObject`. If `downloadObject` itself is unused after rewrite, delete it too.

**REWRITE — media tool services (apply same pattern to all 4):**

For `runtime-image-generate-tool.service.ts`, `runtime-image-edit-tool.service.ts`, `runtime-tts-tool.service.ts`, `runtime-video-generate-tool.service.ts`:

1. Drop `PersaiMediaObjectStorageService` from constructor IF the only use was `saveObject`. Keep it if the tool also reads input bytes (image_edit, video reference).
2. Drop `RuntimeAssistantFileRegistryService` injection (was already done in W3.1 — verify the shim is gone after rewrite).
3. Replace the persist body (W3.1 shim site) with:
   ```ts
   // a) resolve assistant handle + sibling handles from session context
   //    (probably already in turn state; if not, accept via call site)
   // b) compute basename via buildOutboundBasename (need to create runtime-side
   //    copy — see "Files NEW" below)
   // c) call sandboxClient.writeSharedOutbound({...})
   // d) build RuntimeOutputArtifact { storagePath: result.workspaceRelPath, kind, sourceToolCode, mimeType, filename, sizeBytes, billingFacts?, voiceNote?, downloadUrl? }
   // e) return artifact (or array of artifacts for batch)
   ```
4. For input bytes (image_edit reference, video reference): read via `persaiMediaObjectStorage.downloadByWorkspacePath({ workspaceId, storagePath: attachment.storagePath })`. Do NOT call any `assistant-media/`-prefixed key.

**REWRITE — `runtime-document-provider-adapter.service.ts` (publish path only):**

5. `persistDocumentArtifact`: same pattern — sandbox `writeSharedOutbound` + `RuntimeOutputArtifact { storagePath, ... }`. Leave the OTHER 3 W3.1-shims (registry-related: `ensureAttachmentBackedFile`, `deleteById`, `toRuntimeFileRef`) in place — those are W3.3/W4 scope.

**REWRITE — `runtime-media-job-completion.service.ts`:**

6. Drop `fileRef: artifact.fileRef` from the LLM completion payload (~L236 per inventory). Use `storagePath: artifact.storagePath` (or `path` per ADR-126 D5 — pick the one MediaDeliveryService accepts; verify by re-reading API `RegisterChatAttachmentService.execute`).
7. Update any other artifact-payload field references to be path-based.

**REWRITE — `media-job-completion-vision-hydration.ts`:**

8. Replace `mediaObjectStorage.downloadObject(artifact.objectKey)` with `persaiMediaObjectStorage.downloadByWorkspacePath({ workspaceId, storagePath: artifact.storagePath })`. The `objectKey` field is gone from `RuntimeOutputArtifact` per W3.1 contract.

**REWRITE — `runtime-sandbox-tool.service.ts`:**

9. Stop emitting `fileRefs: job.files.map(f => f.fileRef.fileRef)`. Instead emit `paths: job.producedFiles.map(f => f.storagePath)` (W3.1 fix already updated `pollJob` to return path-based `RuntimeSandboxProducedFile`).

**REWRITE — controllers:**

10. `internal-runtime-document-jobs.controller.ts`: in the DTO parser, replace `fileRef`/`objectKey`/`filename` fields on attachment + workerResult artefacts with `storagePath`/`displayName`. Reject unknown legacy fields with `BadRequestException` (strict v3 — same pattern as API `MediaDeliveryService`).
11. `internal-runtime-media-jobs.controller.ts`: same.

**NEW (files):**

12. `apps/runtime/src/modules/turns/build-outbound-basename.ts` — runtime-side copy of the API helper that was DELETED in W2 fix. Same logic: `<UTC-iso-second>-<slug>.<ext>` from `(slugSourceText, extension)`. Subagent ports from W2 fix discussion. Tests welcome but not mandatory.
13. `apps/runtime/src/modules/turns/resolve-assistant-handle.ts` (or reuse existing helper if there is one) — supplies `handle` + `siblingHandles` to `writeSharedOutbound`. **Discover existing helper first**; only create new if none exists. Source data: turn execution context already has `assistantId`/`workspaceId`; handle lookup goes through `assistantRuntimeFacade` or a new client method. If a new API call is required, ADD to the orchestrator's notes — DO NOT silently invent an endpoint.

**Anti-compromise red flags (W3.2 specific, in addition to all earlier):**

- ❌ Calling `mediaObjectStorage.saveObject(...)` for new artefact bytes. The single write owner is sandbox. NEVER.
- ❌ Building `objectKey: "assistant-media/runtime-output/..."` for any artefact. The API will reject it (`BadRequestException`). NEVER.
- ❌ Putting `// W3.3-shim` markers in media tool persist paths. W3.2 must complete the media tool persist surface. Markers allowed only in W3.3-scoped touchpoints (document adapter registry, files-tool, turn-context-hydration) — and W3.2 explicitly does NOT touch those.
- ❌ Calling any function marked `// W4-shim` in `apps/sandbox/src/sandbox.service.ts`. If you find your rewrite reaching for one, STOP — that's wave-4 scope leak.
- ❌ Adding `objectKey` field to any new `RuntimeOutputArtifact` or `RuntimeAttachmentRef`. The contract was deleted; only `storagePath` exists.
- ❌ Returning empty arrays / nulls "as a temporary" from a rewritten persist function. Either complete the rewrite OR mark it `// W3.3-shim` (only if the orchestrator-approved scope says it's W3.3) — silent no-op is forbidden.
- ❌ Grep-evasion via string concatenation or computed keys (the W2 fraud pattern). The audit `rg "\"file\"\s*\+\s*\"Ref\""` MUST return 0.
- ❌ `as unknown as X` casts in production code. NEVER.

**Acceptance checks (run ALL FIVE):**

1. `corepack pnpm --filter @persai/runtime-contract run typecheck` — PASS.
2. `corepack pnpm --filter @persai/runtime run typecheck` — PASS.
3. `corepack pnpm --filter @persai/api run typecheck` — PASS.
4. `corepack pnpm --filter @persai/sandbox run typecheck` — PASS.
5. `corepack pnpm --filter @persai/web run typecheck` — PASS.
6. `rg "W3\.1-shim" apps/runtime/src/` — should be **≤10** (4 media + 1 document publish removed from 15; remaining are W3.3/W4 scope). Report exact remaining shim sites.
7. `rg "buildRuntimeOutputObjectKey|assistant-media" apps/runtime/src/` — **0 matches**.
8. `rg "saveObject" apps/runtime/src/` — **0 matches in media tool services / publish paths**. If any callers remain, justify (vision hydration reading existing bytes is read-only — should be `downloadObject`/`downloadByWorkspacePath`, not `saveObject`).
9. `rg "objectKey" apps/runtime/src/modules/turns/runtime-image-generate-tool.service.ts apps/runtime/src/modules/turns/runtime-image-edit-tool.service.ts apps/runtime/src/modules/turns/runtime-tts-tool.service.ts apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts` — **0 matches**.
10. `rg "fileRef" apps/runtime/src/modules/turns/runtime-image-generate-tool.service.ts apps/runtime/src/modules/turns/runtime-image-edit-tool.service.ts apps/runtime/src/modules/turns/runtime-tts-tool.service.ts apps/runtime/src/modules/turns/runtime-video-generate-tool.service.ts apps/runtime/src/modules/turns/runtime-sandbox-tool.service.ts apps/runtime/src/modules/turns/runtime-media-job-completion.service.ts apps/runtime/src/modules/turns/interface/http/internal-runtime-media-jobs.controller.ts apps/runtime/src/modules/turns/interface/http/internal-runtime-document-jobs.controller.ts apps/runtime/src/modules/turns/media-job-completion-vision-hydration.ts` — **0 matches**.
11. `rg "\"file\"\s*\+\s*\"Ref\"|identityKey\s*=\s*\"file" apps/` — **0 matches**.
12. `rg "as\s+unknown\s+as\s+Runtime" apps/runtime/src/` — **0 matches** (test mocks OK).
13. Affected tests pass: `corepack pnpm --filter @persai/runtime run test -- --test-name-pattern "image_generate|image_edit|tts|video|document|media"` (or moral equivalent). Report PASS/FAIL.

If checks 1–12 fail, fix and re-run. Report all outputs verbatim — no claimed-pass without paste.

---

### W3.3 detailed checklist — Final runtime path migration

**Goal:** runtime is path-identity end-to-end. All 10 remaining W3.1-shims removed. Turn state, working files, files-tool, document-tool, projection, sanitization, and all runtime tests are path-based. After W3.3, the **entire runtime test suite passes**.

**Input state from W3.2:**
- 10 `W3.1-shim` markers remaining: 3 in `runtime-document-provider-adapter.service.ts` (registry residual / cleanup paths), 5 in `turn-context-hydration.service.ts`, 2 in `runtime-files-tool.service.ts`. All five package typechecks PASS.
- `runtime-files-tool.service.test.ts` deleted by W3.2 — W3.3 writes a new path-based suite.
- `assistantFileRegistryAvailable: false` literal (11 hits in `runtime-document-provider-adapter.service.ts`) — payload feature-flag field that the provider sets to false now. W3.3 cleans the field name itself (rename to `pathRegistryAvailable` or just drop, depending on whether the provider consumer reads it — verify with grep).
- Several stale `AssistantFile` mentions in JSDoc comments (turn-execution, turn-context-hydration, document-tool comment) — W3.3 rewrites comments.

**Touch only:**
- `apps/runtime/src/modules/turns/turn-execution.service.ts` (90 fileRef hits per inventory)
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` (57 hits)
- `apps/runtime/src/modules/turns/runtime-files-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-document-tool.service.ts`
- `apps/runtime/src/modules/turns/runtime-document-provider-adapter.service.ts` (3 remaining shims + field cleanup)
- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- `apps/runtime/src/modules/turns/sanitize-tool-result-for-model.ts`
- `apps/runtime/src/modules/turns/runtime-files-read-metadata.ts`
- `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts` (if any residual fileRef-bearing types still referenced)
- ALL `apps/runtime/test/*.test.ts` files that exercise above (rewrite mocks, drop fileRef, drop assistant-media keys; add new path-based suite for files-tool)
- Possible W3.3 schema migration if Prisma `discoveredFileRefIds` column exists — see Decision 7.

**Decision 7 — `discoveredFileRefIds`:** subagent FIRST verifies whether it's a Prisma column (search schema.prisma + migrations). Three outcomes:
- **(a) In-memory turn-state only** → change field shape in code to `discoveredFilePaths: string[]`; no migration.
- **(b) Prisma column** → add a W3.3 migration: `ALTER TABLE assistant_chat_messages RENAME COLUMN discovered_file_ref_ids TO discovered_file_paths` (or analogous; verify column type — `TEXT[]` should fit path strings since they're <1024 chars). Update Prisma model + repository. Add `apps/api/prisma/migrations/<NEW_TS>_adr126_v3_runtime_discovered_paths/migration.sql`.
- **(c) JSONB column with UUIDs** → similar to (b) but no schema change beyond column name; rows get NULL'd or migrated empty (subagent picks: same-cutover-as-W1 cleanup is acceptable since historical attachments are already invalidated).

Report which outcome applied + migration filename if any.

**Decision: cross-chat document revise** (`runtime-document-tool.service.ts` currently passes `fileRef` for revise). Replace with `storagePath` of the source document. Cross-chat revise becomes a path lookup via `RegisterChatAttachmentService`-listed attachments. API service `enqueue-runtime-deferred-document-job.service.ts` (already rewritten in W3.1-fix) should accept this. Verify signature compatibility.

**Decision: `files.attach` registration callsite.** Per Resolved decision 3, `files.attach` registration is owned by RUNTIME via `persaiInternalApi.registerChatAttachment` (already added in W3.1). `RuntimeFilesToolService.executeAttachAction` rewrite calls this; it returns `{ attachmentId, storagePath }` and the tool result includes those fields. The 2 W3.1-shims in `runtime-files-tool.service.ts` correspond to attach + preview paths.

**Decision: `files.preview`.** Per Resolved decision 4, preview is sandbox-only via `files.read`. The W3.1-shim in `runtime-files-tool.service.ts:492` (preview) is removed by routing preview through sandbox file read + returning bytes/text to the model. No API call needed.

**REWRITE — `turn-execution.service.ts`:**

- Replace `turnState.fileRefs: RuntimeFileRef[]` → `turnState.attachments: RuntimeAttachmentRef[]` (path-based) OR `turnState.discoveredFilePaths: string[]` depending on what's more semantically aligned.
- Replace `discoveredFileRefIdSet: Set<string>` → `discoveredFilePathSet: Set<string>` (UUIDs → path strings).
- Working-files developer section keyed by path, not fileRef.
- Attachment merge: by `storagePath` (canonical key).
- Artefact accumulation: by `artifact.storagePath` (no nested `.file.fileRef`).
- Drop all `RuntimeFileRef`-typed local variables; switch to `RuntimeAttachmentRef` or `string` (storagePath).
- Update JSDoc comments referring to `AssistantFile` / `fileRef` to reference `(workspaceId, path)` identity.

**REWRITE — `turn-context-hydration.service.ts`:**

- Drop `RuntimeAssistantFileRegistryService` constructor injection (already deleted; cleanup).
- Working-files hydration: read from `assistant_chat_message_attachment.storagePath` (via existing `assistantRuntimeFacade` or new client method that wraps `listWorkspaceFileShortDescriptions`). Reuse existing API endpoint where possible.
- Discovered files hydration: lookup by path in `workspace_file_metadata` table.
- Remove `ensureAttachmentFileRef` helper entirely.
- Remove the 5 W3.1-shims by completing the rewrite.

**REWRITE — `runtime-files-tool.service.ts`:**

- `executeAttachAction`: call `persaiInternalApi.registerChatAttachment({ channel, externalThreadKey, storagePath, attachmentType, mimeType, sizeBytes, originalFilename, kind: "files.attach", ... })`. Tool result includes `{ attachmentId, storagePath }`. NO fileRef anywhere.
- `executePreviewAction`: route through sandbox file read (`files.read` action); strip the legacy `extractAssistantFileText` branch (W3.1-shim site). For images, return base64 of bytes (subject to `effectiveMaxPreviewBytes` from `runtime-file-capabilities.ts`).
- `executeListAction`: keep `listAssistantFileShortDescriptions` call (endpoint still exists from W2); rename method to `listWorkspaceFileShortDescriptions` for clarity (optional; if rename, update client method name in `persai-internal-api.client.service.ts`).
- Drop both W3.1-shims.
- Drop `discoveredFileRefs` accumulation; use `discoveredFilePaths` (or equivalent name).

**REWRITE — `runtime-document-tool.service.ts`:**

- `readDocumentArguments`: drop `fileRef` arg from tool schema. Add `storagePath` for revise.
- `resolveEffectiveDescriptorMode`: same.
- Tool description (in `native-tool-projection.ts`): update to reflect path-only contract.
- Attachment refs in document tool args: path-only.

**REWRITE — `runtime-document-provider-adapter.service.ts` (remaining 3 shims + field cleanup):**

- Remove the 3 W3.1-shims (registry residual cleanup paths). After registry deletion, transient sandbox file cleanup isn't tied to registry — re-read inventory + the actual shim sites to determine correct rewrite.
- Replace 11 instances of `assistantFileRegistryAvailable: false` with `pathRegistryAvailable: true` OR drop the field if no consumer reads it. Subagent verifies consumer.
- Document tool sandbox args: stop passing `mountFileRefs` (W4 sandbox-side removal); pass input paths under `/shared/<wsid>/input/` directly.
- Drop stale `AssistantFile` JSDoc comments.

**REWRITE — `native-tool-projection.ts`:**

- Document tool schema (around line 1313, 1366-1371 per inventory): drop `fileRef: { type: "string", format: "uuid" }` property; document the path-based `storagePath` arg if relevant. (`storagePath` may already be implicit in the path-based files contract — verify with current schema state.)
- Files tool description (line 1614 per inventory): already path-only; verify.

**REWRITE — `sanitize-tool-result-for-model.ts`:**

- Replace `delete obj.fileRef` (or equivalent strip) with appropriate path-based strip. ADR D5 says model sees `storagePath` only (no `objectKey`, no UUIDs). Verify current state and adjust.
- Update test `sanitize-tool-result-for-model.test.ts` accordingly.

**REWRITE — `runtime-files-read-metadata.ts`:**

- Drop `InternalRuntimeFileExtractionOutcome` types (extraction is removed per Resolved decision 4).
- Path-based preview metadata types if needed by `executePreviewAction`.

**REWRITE — `persai-internal-api.client.service.ts` (cleanup):**

- Verify `RuntimeAttachmentRef` consumers in `enqueueRuntimeDocumentJob` / `enqueueRuntimeMediaJob` are path-only.
- Drop any residual fileRef-bearing types or methods.

**REWRITE — ALL runtime tests:**

For each `apps/runtime/test/*.test.ts`:
- Replace fileRef-bearing mocks with `storagePath`-bearing.
- Replace `assistant-media/runtime-output/...` object keys with `/shared/outbound/<handle>/<basename>` paths.
- Drop `fakeRuntimeAssistantFileRegistry` and similar fakes; replace with direct path-based assertions.
- NEW `apps/runtime/test/runtime-files-tool.service.test.ts` — path-based attach + preview + list + discovery tests (W3.2 deleted the old; W3.3 rewrites).
- NEW or updated `turn-context-hydration.service.test.ts` — path-based working-files hydration.
- Test `turn-execution-discovered-file-refs.test.ts` should be renamed to `turn-execution-discovered-file-paths.test.ts` or kept with semantic update.

**W3.3 anti-compromise red flags (in addition to ALL earlier permanent rules):**

- ❌ Leaving any `// W3.1-shim`, `// W3.2-shim`, or `// W3.3-shim` marker. After W3.3, runtime is shim-free. Grep `W3\.\d-shim` MUST return 0.
- ❌ Adding a NEW `as unknown as RuntimeFileHandle` cast. NEVER.
- ❌ Adding fields named `fileRef`, `assistantFileId`, `objectKey` to any new type. NEVER.
- ❌ Skipping a test instead of rewriting it (`test.skip("...")` for a path-side regression). NEVER — rewrite the test for path identity.
- ❌ Reporting "tests pass" without running `corepack pnpm --filter @persai/runtime run test` end-to-end and pasting output (PASS count, FAIL count). Orchestrator demands paste.
- ❌ Renaming a type to evade grep (the W3.2 `StateRedisClient` pattern). If you rename, document WHY in the report (clarity, scope) — never "to pass audit".
- ❌ "fileRef in legacy-reject path" — that pattern is ONLY allowed in controller DTO parsers (already done by W3.2). Any new occurrence in tool services / hydration / turn state is fraud.

**W3.3 acceptance checks (run YOURSELF — all 14):**

1. `corepack pnpm --filter @persai/runtime-contract run typecheck` — PASS.
2. `corepack pnpm --filter @persai/runtime run typecheck` — PASS.
3. `corepack pnpm --filter @persai/api run typecheck` — PASS.
4. `corepack pnpm --filter @persai/sandbox run typecheck` — PASS.
5. `corepack pnpm --filter @persai/web run typecheck` — PASS.
6. `rg "W3\.\d-shim" apps/runtime/src/` — **0 matches**. (W4-shim in sandbox is OK; that's Wave 4 territory.)
7. `rg "fileRef|RuntimeFileRef|RuntimeAssistantFileRegistry" apps/runtime/src/` — **0 matches** EXCEPT in `interface/http/internal-runtime-*-jobs.controller.ts` strict-reject paths (W3.2 legacy-field rejection). Report exact files + line counts; confirm rejection-only.
8. `rg "assistantFile|AssistantFile|assistantFileId" apps/runtime/src/` — **0 matches** in code; doc-comment occurrences in JSDoc OK if explicitly migrated wording (e.g. "formerly AssistantFile, now workspace_file_metadata"). Report all matches.
9. `rg "assistant-media|runtime-output" apps/runtime/src/` — **0 matches**.
10. `rg "assistantFileRegistryAvailable" apps/runtime/src/` — **0 matches** (field replaced or removed).
11. `rg "\"file\"\s*\+\s*\"Ref\"|identityKey\s*=\s*\"file" apps/` — **0 matches**.
12. `rg "as\s+unknown\s+as\s+Runtime" apps/runtime/src/` — **0 matches** (test mocks OK).
13. `corepack pnpm --filter @persai/runtime run test` — PASS (entire suite). Paste output verbatim with PASS/FAIL totals.
14. `corepack pnpm --filter @persai/api run test` — PASS (W2 fix passed full API tests; W3.3 should not regress). Paste output verbatim.

If checks 1–12 fail, fix and re-run. Do NOT report success unless ALL 14 pass.

**Migration check (Decision 7):**

15. If schema migration added: `corepack pnpm --filter @persai/api run prisma:generate` — PASS, migration file present at `apps/api/prisma/migrations/<TS>_adr126_v3_runtime_discovered_paths/migration.sql`.
16. If no migration (in-memory only): explicitly state "no migration required" in report.

---

## Wave 4 detailed checklist — Sandbox cleanup

**Goal:** sandbox is path-identity end-to-end. The dead `assistant_files`-keyed workspace shadow mechanism is fully deleted from `sandbox.service.ts`. `workspace-gc.service.ts` no longer issues raw SQL against the dropped `assistant_files` table. Audit event names reflect v3 path-identity. After W4, **all 5 typechecks PASS and full sandbox test suite PASSES**.

**Input state from W3.3 verification (orchestrator-confirmed):**
- **7 `W4-shim` markers** in `apps/sandbox/src/sandbox.service.ts` at lines: 2397, 2437, 2476, 2510, 2526, 2540, 2556.
- **5 disabled tests** in `apps/sandbox/test/sandbox.service.test.ts`: 2 `if (false) { ... }` blocks (lines 416, 548), 3 `test.skip(...)` (lines 1080, 1239, 1562). All marked with `// W4-shim:`.
- Modern bridge primitives **already in place** (`workspace-file-bridge.service.ts`): `workspaceFileWrite/Read/Delete`, `writeSharedOutboundWithCollision`. These handle path-identity correctly: shared GCS mirror for `/shared/` paths.
- Runtime **no longer calls `mountFileRefs`** (verified by W3.3 grep). The `materializeMountedFiles` codepath at `sandbox.service.ts:699` is dead invocation.
- **CRITICAL prod-break introduced by W1 schema drop, not yet fixed:** `apps/sandbox/src/workspace-gc.service.ts:359-369` issues `prisma.$executeRaw\`DELETE FROM "assistant_files" ...\`` against a table that no longer exists. The first GC tick post-deploy will throw a Postgres error. **MUST be fixed in W4.**

### Touch only (closed file list)
- `apps/sandbox/src/sandbox.service.ts` — primary surgery (delete dead workspace-shadow mechanism + its call sites + types).
- `apps/sandbox/src/workspace-gc.service.ts` — retarget raw SQL to `workspace_file_metadata` table (or DELETE the method entirely if cascade-delete via `Workspace` FK is sufficient — subagent decides).
- `apps/sandbox/src/workspace-audit.service.ts` — rename `assistantFilesRemoved` field + audit string format.
- `apps/sandbox/src/sandbox-object-storage.service.ts` — JSDoc comment on line 33 mentioning `AssistantFile records` (rewrite to reference `workspace_file_metadata`).
- `apps/sandbox/test/sandbox.service.test.ts` — un-skip / rewrite / delete the 5 disabled tests.
- `apps/sandbox/test/workspace-gc.service.test.ts` (if exists) — update assertions for the retarget.
- `apps/sandbox/test/workspace-audit.service.test.ts` (if exists) — update field name.
- Do **NOT** touch `apps/runtime/`, `apps/api/`, `apps/web/`, `packages/`. They were finalized by W2/W3.

### Architectural decision subagent MUST surface FIRST (before any code edit)

**Q1 — workspace bash-produced file persistence in v3:**

Currently the sandbox's `executeJob` after a bash/shell tool run does:
1. Scan `workspaceRoot` for changes via `collectWorkspaceFiles`.
2. `resolveWorkspaceDelta` against pre-job snapshot.
3. `persistWorkspaceFiles` — uploads bytes to GCS + inserts `assistant_files` row per file. (W4-SHIMMED.)
4. `deleteRemovedWorkspaceFiles` — deletes `assistant_files` rows for deleted paths. (W4-SHIMMED.)
5. Writes session-state marker.
6. `saveSessionWorkspaceSnapshot` — tar-zips entire workspaceRoot to a session-keyed GCS object (separate, orthogonal mechanism keyed by `runtimeSessionId`; this still works).

In v3, **bridge primitives** mirror `/shared/` writes to GCS automatically (`workspace-file-bridge.service.ts:255-271`). So:
- Files written via `files.write` tool → already GCS-persistent for `/shared/` paths.
- Files written via `bash`/`shell` tool to `/workspace/<aid>/<wsid>/...` → pod-local only, OR persisted via tar session snapshot.

**Subagent picks one of three v3 models** and documents in the report:

- **(a) Tar snapshot is the ONLY persistence for bash-produced workspace files.** Across pod cycles in the same session, tar restore brings them back. Across sessions, bash-produced files are NOT persisted unless the model explicitly used a bridge primitive. → DELETE `persistWorkspaceFiles` entirely. Bash-produced files end up only in the session-tar snapshot.
- **(b) Sandbox still scans + uploads bash-produced files**, but to `workspace_file_metadata` table (NOT `assistant_files`) and to the canonical `buildSharedObjectKey(workspaceId, path)` GCS key. → REWRITE `persistWorkspaceFiles` to upsert `workspace_file_metadata` row + upload to shared GCS key. Identity stays `(workspaceId, path)`.
- **(c) Hybrid: bash-produced files under `/workspace/<aid>/<wsid>/` get metadata-only entries (no extra GCS upload because tar session snapshot covers durability), and the metadata is for discovery only.** → REWRITE `persistWorkspaceFiles` to upsert `workspace_file_metadata` row WITHOUT separate GCS upload. The tar snapshot remains durability.

**Recommendation (orchestrator):** model (a) is simplest and most aligned with "single write owner = sandbox bridge for shared, tar snapshot for workspace-local". Bash that wants durable workspace files writes to `/shared/` instead. But the subagent reads the ADR D5/D6 + the actual tar snapshot lifecycle and confirms. If the subagent picks (b) or (c), they must justify in the report.

**Q2 — `workspace-gc.service.ts:359-369` raw SQL fix:**

Currently:
```ts
private async deleteAssistantFilesByWorkspaceRelPathPrefix(input: {
  workspaceId: string;
  relPathPrefix: string;
}): Promise<number> {
  const result = await this.prisma.$executeRaw<number>(Prisma.sql`
    DELETE FROM "assistant_files"
    WHERE "workspace_id" = ${input.workspaceId}::uuid
      AND ("metadata" ->> 'workspaceRelPath') LIKE ${input.relPathPrefix + "%"}
  `);
  return typeof result === "number" ? result : 0;
}
```

**Subagent picks one:**

- **(i) Retarget to `workspace_file_metadata`:** `DELETE FROM workspace_file_metadata WHERE workspace_id = ... AND path LIKE ...`. Rename method to `deleteWorkspaceFileMetadataByPathPrefix`. Update 3 call sites (lines 221, 278, 331) + their `assistantFilesRemoved` audit fields to `metadataRowsRemoved`.
- **(ii) Delete the method entirely if the GC tick is already handled by other means.** Subagent verifies what each call site at 221/278/331 is doing (chat_scratch, assistant_outbound, workspace_shared GC kinds) and whether metadata cleanup is needed for that kind. If `workspace_file_metadata` has `onDelete: Cascade` from `Workspace` FK, then `workspace_shared` GC of an entire workspace cascades automatically. For `chat_scratch` / `assistant_outbound`, the path-prefix cleanup IS still needed.

**Recommendation (orchestrator):** (i) — retarget. Keeps semantics identical; just changes the target table. Also pre-existing W1 cascade rules cover only workspace-level deletion, not partial path-prefix purges.

### DELETE (sandbox.service.ts internal mechanisms — full surgery)

After applying decision Q1 = (a) (or whichever the subagent picks):

**If Q1 = (a):**
1. DELETE `loadCurrentAssistantWorkspaceFiles` (line 2161 and line 2393 — both copies).
2. DELETE `ensureWorkspaceSessionHydrated` (line 2161).
3. DELETE `resetWorkspaceSessionToCurrentState` (line 2373).
4. DELETE `materializeMountedFiles` (line 2489) + the call at line 699.
5. DELETE `persistWorkspaceFiles` (line 2514) + the call at line 744.
6. DELETE `deleteRemovedWorkspaceFiles` (line 2530) + the call at line 754.
7. DELETE `deleteStaleAssistantWorkspaceFiles` (line 2431).
8. DELETE `backfillWorkspaceFileIntegrity` (line 2472).
9. DELETE `toProducedFile` (line 2544).
10. DELETE `writeWorkspaceSessionStateMarker` (line 2422) + `resolveWorkspaceStateMarkerPath` (line 2401) + `buildWorkspaceStateToken` (line 2405) — the state-marker mechanism was tied to the assistant_files-keyed deduplication; tar snapshot doesn't need it.
11. DELETE `resolveWorkspaceDelta` (line 2441) — only consumer was `persistWorkspaceFiles` / `deleteRemovedWorkspaceFiles`.
12. DELETE `collectWorkspaceFiles` (line 2560) — only consumer was the workspace-shadow delta computation. IF still needed for tar snapshot pre-flight or assertProducedFileLimits, keep it but justify in report.
13. DELETE TYPES no longer referenced after deletes 1–12: `AssistantWorkspaceFileRecord` (line 64), `MountedWorkspaceState` (line 47). `WorkspaceFileSnapshot` (line 29) — keep IF `collectWorkspaceFiles` survives for tar/limits; otherwise delete.
14. DELETE the legacy import surface in test file accordingly.
15. KEEP `saveSessionWorkspaceSnapshot` / `restoreSessionSnapshotOverlay` / `createTarFromDirectory` / `extractTarOverlay` / `extractTarToDirectory` — orthogonal session-tar mechanism using `objectStorage.buildSessionSnapshotKey`. Not assistant_files-tied. Keeps v3 sessions resumable across pod cycles.
16. KEEP `assertProducedFileLimits` if still relevant for limiting bash-output bloat. If its only consumer was workspace-shadow delta + persistWorkspaceFiles, delete it too.
17. KEEP `executeJob` core flow with the dead-mechanism calls removed; the simplified flow becomes:
    ```ts
    await this.ensureWorkspaceLeaseActive(leaseGuard);
    // (no hydrate from assistant_files; tar snapshot handles cross-pod-cycle)
    if (request.runtimeSessionId) {
      await this.restoreSessionSnapshotOverlay(...);
    }
    const result = await this.executeTool({...});
    if (request.runtimeSessionId) {
      await this.saveSessionWorkspaceSnapshot(...);
    }
    // return result
    ```

**If Q1 = (b) or (c):** REWRITE (not delete) `persistWorkspaceFiles`, `deleteRemovedWorkspaceFiles`, `loadCurrentAssistantWorkspaceFiles` to target `workspace_file_metadata` + canonical shared GCS key. Subagent reports the chosen shape.

### REWRITE — `workspace-gc.service.ts`

Per Q2 decision, retarget or delete. If retarget:
- Rename `deleteAssistantFilesByWorkspaceRelPathPrefix` → `deleteWorkspaceFileMetadataByPathPrefix`.
- Replace raw SQL target from `"assistant_files"` to `"workspace_file_metadata"`.
- Replace `("metadata" ->> 'workspaceRelPath') LIKE ...` with `"path" LIKE ...` (the path IS the primary key field now, not a JSON-embedded subfield).
- Update 3 call sites (lines 221, 278, 331): variable name `assistantFilesRemoved` → `metadataRowsRemoved`.
- Update audit event payload field name accordingly (`workspace-audit.service.ts:55,140`).

### REWRITE — `workspace-audit.service.ts`

- Rename field `assistantFilesRemoved: number` → `metadataRowsRemoved: number` (line 55).
- Rename audit string token `assistant_files_removed=` → `workspace_file_metadata_removed=` (line 140) — keep the audit format readable; this is a log/audit string field name.

### REWRITE — `sandbox-object-storage.service.ts:33`

Rewrite JSDoc to remove the `AssistantFile records` reference. Replace with v3 wording referencing `workspace_file_metadata` or describing the storage role generically.

### REWRITE — `apps/sandbox/test/sandbox.service.test.ts`

For each of the 5 disabled tests (`if (false)` at lines 416/548; `test.skip` at 1080/1239/1562):
- If the test was exercising the now-deleted mechanism (workspace shadow, materializeMountedFiles, persistWorkspaceFiles, etc.), **DELETE the entire test block**. Do not leave `test.skip` permanently.
- If the test was exercising a still-relevant flow (e.g., `render_html_to_pdf`, `execute_document_code`, `warm-pool`) and was disabled only because of a peripheral W4-shim collision, **REWRITE the test** without the legacy mechanism — un-skip, rewrite mock setup to use bridge primitives + tar snapshot, assert the v3 flow.
- Subagent reports per-test decision (DELETE vs. REWRITE) with one-line justification.

### Anti-compromise red flags (W4 specific, in addition to ALL permanent rules)

- ❌ Leaving any `W4-shim` marker. After W4, sandbox is shim-free. `rg "W4-shim" apps/sandbox/` MUST return 0.
- ❌ Reverting to `assistant_files` table in raw SQL "as fallback." NEVER — the table is dropped.
- ❌ Adding `workspace_file_metadata` to a place where the existing cascade-delete already handles it (creates a parallel path). Verify cascade rules first.
- ❌ Stubbing a deleted private method with `return []` or `return new Map()`. NEVER — delete the method outright; if any caller remains, fix the caller too.
- ❌ Keeping `materializeMountedFiles` signature for "future runtime callers." NEVER — runtime in v3 does not call it; W3.3 grep confirmed.
- ❌ Leaving `test.skip("...")` permanently for any sandbox test. Either un-skip + rewrite OR delete.
- ❌ Renaming `assistantFilesRemoved` to `assistantFilesPurged` (i.e., keeping the legacy concept word in a new name). The concept is `workspace_file_metadata`-rows. Use `metadataRowsRemoved` or `workspaceFileMetadataRemoved`. The retired symbol family includes `AssistantFile`/`assistantFile`; do not let it leak into new identifiers.
- ❌ Adding `// TODO: refactor in W5` or any deferral comment. W4 owns this completely.
- ❌ Reporting "all checks PASS" after running only the sandbox typecheck. AGENTS gate is **all 5 packages** every wave.

### W4 acceptance checks (subagent runs YOURSELF — all 14)

1. `corepack pnpm --filter @persai/runtime-contract run typecheck` — PASS.
2. `corepack pnpm --filter @persai/runtime run typecheck` — PASS.
3. `corepack pnpm --filter @persai/api run typecheck` — PASS.
4. `corepack pnpm --filter @persai/sandbox run typecheck` — PASS.
5. `corepack pnpm --filter @persai/web run typecheck` — PASS.
6. `rg "W4-shim" apps/sandbox/` — **0 matches**.
7. `rg "materializeMountedFiles|mountFileRefs|persistWorkspaceFiles|deleteRemovedWorkspaceFiles|loadCurrentAssistantWorkspaceFiles|deleteStaleAssistantWorkspaceFiles|backfillWorkspaceFileIntegrity|writeWorkspaceSessionStateMarker|buildWorkspaceStateToken|resolveWorkspaceStateMarkerPath|AssistantWorkspaceFileRecord|MountedWorkspaceState" apps/sandbox/src/` — **0 matches** (assuming Q1 = (a); subagent reports the expected set for chosen Q1).
8. `rg "assistantFile|AssistantFile|assistant_files|assistantFilesRemoved" apps/sandbox/` — **0 matches** in production code; only allowed in `workspace-gc.service.ts` test fixtures IF retained for backward-compat assertions (justify per case).
9. `rg "DELETE FROM \"assistant_files\"|FROM \"assistant_files\"" apps/sandbox/src/` — **0 matches**.
10. `rg "test\.skip|if \(false\)" apps/sandbox/test/sandbox.service.test.ts` — **0 matches** (or sub-agent justifies any remaining occurrence for a legit reason unrelated to W4).
11. `rg "\"file\"\s*\+\s*\"Ref\"|identityKey\s*=\s*\"file" apps/sandbox/` — **0 matches**.
12. `rg "as\s+unknown\s+as\s+(Runtime|Assistant|Workspace)" apps/sandbox/src/` — **0 matches** (test mocks OK).
13. `corepack pnpm --filter @persai/sandbox run test` — PASS (entire suite). Paste output with PASS/FAIL totals.
14. `corepack pnpm --filter @persai/api run test` — PASS (no regression).
15. `corepack pnpm --filter @persai/runtime run test` — PASS (no regression).

If checks 1–12 fail, fix and re-run. Do NOT report success unless ALL 13–15 pass.

### W4 brief for Composer (verbatim — orchestrator dispatches with this)

> Implement Wave 4 of ADR-126 v3 cutover per `docs/ADR/126-v3-CUTOVER-PROGRAM.md` "Wave 4 detailed checklist" section. Touch only `apps/sandbox/src/` and `apps/sandbox/test/` files listed in the "Touch only" block. Do NOT touch `apps/runtime/`, `apps/api/`, `apps/web/`, `packages/`.
>
> **MANDATORY: BEFORE any code edit, surface decisions for Q1 (workspace bash-produced file persistence model) and Q2 (workspace-gc.service.ts:359-369 fix shape) in the report.** State which option you picked and why (one paragraph each). The orchestrator may interrupt if the decision conflicts with ADR v3 intent — make the decision explicit so it can be challenged.
>
> Read in order: AGENTS.md, the ADR (`docs/ADR/126-unified-sandbox-workspace-files-shell-single-fs-bash-default-and-expanded-egress.md` — focus on D5/D6/D8 and the v3 path-identity narrative), the program plan (`docs/ADR/126-v3-CUTOVER-PROGRAM.md`). Wave 4's detailed checklist is your authoritative scope contract.
>
> Anti-compromise red flags from the program plan apply, plus the Wave 4 additions in the checklist. Permanent anti-compromise rules from W3.1 fix (no grep-evasion via string concat; no `as unknown as X` casts to silence type breaks; no reporting PASS after only checking one package's typecheck) apply.
>
> Report at the end with the standard shape: (1) Q1/Q2 decisions + justifications, (2) `git diff --stat`, (3) files deleted / rewritten / new, (4) all 15 acceptance check outputs **verbatim** (no claimed-pass without paste), (5) any architectural surprise or red flag encountered.

---

## Wave 4.5 detailed checklist — Restore thumbnail / poster pipeline (path-identity)

**Goal:** Inbound uploaded images/videos generate thumbnail/poster bytes synchronously during `InboundMediaService.resolve`. The thumbnail/poster paths are stored on `assistant_chat_message_attachment` as path-identity fields. Web consumes them via the existing `GET /api/v1/assistant/chats/web/:chatId/files?path=...` endpoint. No derivative tables, no satellite services, no `fileRef`.

**Why pre-W5 (not in W5):** founder UX-target is a premium tile gallery (Settings → Files) and a fast chat with image previews on mobile. Without thumbnails the gallery and chat would force live full-resolution decode per tile/message → traffic explosion + mobile break. The capability is intact (`MediaPreprocessorService.createImageThumbnail` + `createVideoPoster`) but never called after W2 deleted the satellite service. Restore is small and bounded; doing it before W5 means W5's UI can rely on the path-identity contract being complete.

### Input state (orchestrator-verified)

- `MediaPreprocessorService.createImageThumbnail` (sharp, 256px webp q78) — **alive**
- `MediaPreprocessorService.createVideoPoster` (ffmpeg first-frame → thumb) — **alive**
- `InboundMediaService.resolve` — **does NOT call them** (W2 mistakenly dropped derivative invocation along with the deleted satellite service)
- `apps/web/app/app/_components/chat-message.tsx:1475-1476` — **still reads `thumbnailFileRef`/`posterFileRef`** (v1 fields gone from API response after W2 attachment-shape rewrite). Field is `undefined` everywhere → chat renders no preview.
- `AssistantChatMessageAttachment` Prisma model — has NO `thumbnail_storage_path` / `poster_storage_path` columns. Add in this slice.

### Touch only (closed file list)

Backend (`apps/api/`):
1. `apps/api/prisma/schema.prisma` — add 2 columns to `AssistantChatMessageAttachment`
2. `apps/api/prisma/migrations/<NEW_TS>_adr126_v3_thumbnail_path_identity/migration.sql` — new file
3. `apps/api/src/modules/workspace-management/application/media/inbound-media.service.ts` — call thumbnail/poster generation + saveObject + pass paths
4. `apps/api/src/modules/workspace-management/application/register-chat-attachment.service.ts` — accept optional `thumbnailStoragePath` / `posterStoragePath`
5. `apps/api/src/modules/workspace-management/domain/assistant-chat-message-attachment.entity.ts` — add fields
6. `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat-message-attachment.repository.ts` — read/write new columns
7. `apps/api/src/modules/workspace-management/application/media/media.types.ts` — `toAssistantWebChatMessageAttachmentState` pass-through
8. Tests for above (rewrite-in-place; no new tests required unless attachment-shape coverage gap exposes regression)

Do NOT touch web, runtime, sandbox, contract. (W5 will rewrite web in next slice.)

### Schema delta

`AssistantChatMessageAttachment`:
```
thumbnailStoragePath String? @map("thumbnail_storage_path") @db.VarChar(1024)
posterStoragePath    String? @map("poster_storage_path")    @db.VarChar(1024)
```
No index — these are read alongside the row by primary key, no lookup needed.

### Inbound flow (pseudo)

For each `raw` attachment (after `validatePersaiMediaFile` + `preprocessor.process(...)` + primary `saveObject`):
- If `processed.normalizedMime` starts with `image/` (excluding `image/svg+xml` and `image/gif`):
  - `thumb = await preprocessor.createImageThumbnail(processed.normalizedBuffer)`
  - If `thumb !== null`:
    - `thumbnailStoragePath = "<storagePath>.thumb.webp"` (literal suffix; canonical and predictable)
    - `mediaObjectStorage.saveObject({ objectKey: buildSharedObjectKey({ workspaceId, workspaceRelPath: thumbnailStoragePath }), buffer: thumb.buffer, mimeType: thumb.mimeType })`
- If `processed.normalizedMime` starts with `video/`:
  - `poster = await preprocessor.createVideoPoster(processed.normalizedBuffer)`
  - If `poster !== null`:
    - `posterStoragePath = "<storagePath>.poster.jpg"`
    - `saveObject(...)` mirroring above
- Pass `thumbnailStoragePath` / `posterStoragePath` (or `null`) to `registerChatAttachmentService.execute(...)`.

**Failure handling:** thumbnail/poster generation is best-effort. If `createImageThumbnail` returns `null` (sharp unavailable) or `createVideoPoster` returns `null` (ffmpeg unavailable / extraction failed), record attachment WITHOUT the thumbnail/poster path (NULL). Web must already handle `thumbnailStoragePath === null` gracefully (fall back to icon or full-resolution decode at small size). Do NOT fail the upload because of derivative failure — derivative is presentation-layer optimization, primary bytes must always land.

**Quota accounting:** thumbnail/poster bytes count toward workspace media quota IF the inbound primary already counted toward it. Decision: subagent reports current quota accounting shape; if `trackWorkspaceQuotaUsageService.recordMediaUpload` is called once for the primary, derivative bytes are added in the same call by passing `sizeBytes = primary + thumb + poster` IF cheap to compute. If not cheap, derivative bytes are an internal cost not billed (simpler — matches typical SaaS practice). Subagent picks and reports.

### Anti-compromise red flags (W4.5 specific)

- ❌ Re-creating `AssistantFileMediaDerivative` table. NEVER — derivative IS metadata on the attachment row itself; no satellite.
- ❌ Re-introducing `assistant_files` row for the thumbnail. NEVER — thumbnail bytes live at canonical shared GCS key derived from `<storagePath>.thumb.webp`.
- ❌ Background job / scheduler for derivative generation. NEVER — synchronous in `InboundMediaService.resolve`; upload latency stays bounded (thumbnail = a few ms with sharp; poster = ~1-2s with ffmpeg, acceptable for synchronous upload).
- ❌ Storing thumbnail bytes in `processingMetadata` JSON column as base64. NEVER — bytes go to GCS, only path goes to the row.
- ❌ Adding `thumbnailFileRef` back on the attachment. NEVER — the v3 identity is path. `thumbnailStoragePath` is the field name.
- ❌ Suffix mangling: name the derivative `<storagePath>.thumb` / `.poster` without explicit MIME extension. NEVER — use `.thumb.webp` / `.poster.jpg` so the derivative MIME is unambiguous from the path.
- ❌ Computing thumbnail/poster URL on web by string-concatenation of the raw GCS key. NEVER — web uses the existing path-based delivery endpoint with `?path=<thumbnailStoragePath>`.

### Acceptance checks (subagent runs YOURSELF — all 9)

1. `corepack pnpm --filter @persai/api run prisma:generate` — PASS
2. `corepack pnpm --filter @persai/api run typecheck` — PASS
3. `corepack pnpm --filter @persai/runtime run typecheck` — PASS (no regression)
4. `corepack pnpm --filter @persai/sandbox run typecheck` — PASS (no regression)
5. `corepack pnpm --filter @persai/web run typecheck` — PASS (no regression — web NOT touched in this slice; if web fails it means a contract leaked)
6. `rg "AssistantFileMediaDerivative|AssistantFileMediaDerivativeScheduler|markMediaDerivativesStatus|upsertMediaDerivativeFile" apps/api/src/` — **0 matches** (no satellite resurrection)
7. `rg "fileRef|RuntimeFileRef" apps/api/src/modules/workspace-management/application/media/` — **0 matches** (path identity preserved)
8. `corepack pnpm --filter @persai/api run test` — PASS (entire API suite; pay attention to `inbound-media` / `media-delivery` / `register-chat-attachment` tests)
9. Visual inspection: subagent reads `InboundMediaService.resolve` post-edit and pastes the thumbnail/poster generation block in the report (10–15 lines), confirming sync + null-safe + path-suffixed.

If checks 1–7 fail, fix and re-run. Do NOT report success unless ALL 8–9 also pass.

### W4.5 brief for Composer (verbatim)

> Implement Wave 4.5 of ADR-126 v3 cutover per `docs/ADR/126-v3-CUTOVER-PROGRAM.md` "Wave 4.5 detailed checklist" section. Touch only the 7+ files listed under "Touch only" — do NOT touch web, runtime, sandbox, contract.
>
> Goal: restore image thumbnail + video poster generation in `InboundMediaService.resolve`, using path-identity fields on `AssistantChatMessageAttachment`. Capability is intact (`MediaPreprocessorService.createImageThumbnail` + `createVideoPoster`); W2 broke the wiring when it deleted `AssistantFileMediaDerivativeService`. No satellite tables, no satellite services, no `fileRef`, no background scheduler.
>
> Read in order: AGENTS.md, the ADR D5/D6 sections, the program plan (Wave 4.5 checklist is your authoritative scope contract).
>
> Anti-compromise red flags from the program plan apply (including the W4.5 specific list). Permanent rules from W3.1 fix apply (no grep-evasion via string concat; no `as unknown as X` casts; report typechecks for ALL 5 packages with verbatim shell output; no test.skip permanent placeholders).
>
> Report at the end with: (1) git diff --stat for `apps/api/`, (2) per-file rewrite/new-file summary, (3) quota-accounting decision (count derivative bytes vs. don't), (4) all 9 acceptance check outputs verbatim, (5) the 10–15-line pasted thumbnail-generation block from `InboundMediaService.resolve` post-edit.

---

## Wave 5 detailed checklist — Web UI rewrite (founder-approved tile gallery variant)

**Goal:** web is fully path-identity. Chat attachment rendering reads `thumbnailStoragePath` / `posterStoragePath` (from W4.5). New `GET /api/v1/assistant/workspace-files` endpoint serves a tile gallery for "Settings → Files". Project Files panel collapses to a single-line link that opens the gallery. Legacy `assistant_files`-keyed UI is deleted clean.

**Input state (post W4.5):**
- Path identity end-to-end on backend + sandbox + runtime
- `AssistantChatMessageAttachment.{thumbnailStoragePath,posterStoragePath}` populated for new uploads (historical rows are NULL)
- No web file touched yet — entire `apps/web/` still references v1 `fileRef`-shape (~15 files)
- `media-attachment.controller.ts` already has `GET /api/v1/assistant/chats/web/:chatId/files?path=...&download=0|1` (W2)

### Touch only (closed file list)

Backend (new endpoint — minimal addition):
1. `apps/api/src/modules/workspace-management/application/list-chat-workspace-files.service.ts` (NEW) — service that joins `assistant_chat_message_attachment` rows for the chat's workspace, projects to a tile-gallery shape `{ storagePath, thumbnailStoragePath, posterStoragePath, originalFilename, mimeType, sizeBytes, attachmentType, createdAt, chatId, messageId }`, filters by `attachmentType IN (image, video, document, audio_with_transcription?)` per `?type=` param, sorts `createdAt DESC`, paginates by cursor. Excludes voice notes (heuristic: `attachmentType = audio AND metadata.source = voice_input` or similar — subagent inspects metadata schema).
2. `apps/api/src/modules/workspace-management/interface/http/media-attachment.controller.ts` — add `GET /api/v1/assistant/chats/web/:chatId/workspace-files` route calling the new service.
3. Tests for new service + controller route.

Web (rewrite to path identity):
4. `apps/web/app/api/assistant-file/[fileRef]/route.ts` — DELETE
5. `apps/web/app/api/assistant-file/[fileRef]/route.test.ts` — DELETE
6. `apps/web/app/app/assistant-api-client.ts` — REWRITE: delete `getAssistantFiles`, `cleanupAssistantFilesCache`, `patchAssistantFileDisplayName`, `deleteAssistantFile`, `getAssistantFileDownloadUrl`, `AssistantFileState`, `AssistantFileDocumentLink`, `AssistantFilesCleanupSummary`, `AssistantFilesCleanupResult`. Add path-based: `buildChatFileUrl({ chatId, storagePath, download? })`, `listChatWorkspaceFiles({ chatId, type?, cursor?, limit? })`, `deleteChatWorkspaceFile({ chatId, storagePath })`.
7. `apps/web/app/app/_components/chat-message.tsx` — REWRITE attachment rendering: replace `thumbnailFileRef`/`posterFileRef`/`fileRef` reads with `thumbnailStoragePath`/`posterStoragePath`/`storagePath`. Build all URLs via `buildChatFileUrl({ chatId, storagePath })`. Replace any `localPreviewUrl`/`previewUrl` plumbing as needed to align with path-identity.
8. `apps/web/app/app/_components/chat-message.test.tsx` — REWRITE
9. `apps/web/app/app/_components/chat-message-blocks.test.tsx` — REWRITE
10. `apps/web/app/app/_components/use-chat.ts` — REWRITE: `ChatHistoryAttachment` type loses `fileRef`/`thumbnailFileRef`/`posterFileRef`/`fileDeleted`; gains `storagePath`/`thumbnailStoragePath`/`posterStoragePath`.
11. `apps/web/app/app/_components/use-chat.test.tsx` — REWRITE
12. `apps/web/app/app/_components/project-files-panel.tsx` — REWRITE PER FOUNDER VARIANT:
    - Collapsed by default; show single horizontal line with icon + label "Файлы проекта" + chevron-down
    - Click → DO NOT inline-expand. Dispatch event/route to open Assistant Settings on the "Files" tab (existing settings panel system; subagent picks the mechanism aligned with how other tabs are activated, e.g. `dispatchAssistantSettingsTabRequest('files')` or router push)
    - Delete the inline file-list UI; the gallery lives in Settings → Files
    - `collectProjectFilesFromMessages`: dedupe by `storagePath` (not `fileRef`); keep latest `createdAt`
13. `apps/web/app/app/_components/project-files-panel.test.tsx` — REWRITE
14. `apps/web/app/app/_components/assistant-files-manager.tsx` — RENAME to `apps/web/app/app/_components/workspace-files-gallery.tsx` AND REWRITE PER FOUNDER VARIANT:
    - Tile gallery: 4–5 columns responsive (Instagram-post-sized squares, ~256px–320px tile), grid gap ~8–12px
    - Sort by `createdAt DESC`
    - Filter pills: All | Images | Videos | Documents (NO voice / cache / "user_files" / "assistant_created" bucket separation — content type filter only)
    - Each tile:
      - Image: thumbnail from `thumbnailStoragePath` via `buildChatFileUrl`, fallback to MIME icon
      - Video: poster from `posterStoragePath` + play-button overlay, fallback to icon
      - Document: MIME-specific icon (PDF / DOCX / XLSX / TXT / etc.) + filename overlay
      - Audio (non-voice): waveform icon + filename
    - Click tile → lightbox (image/video) OR new-tab download (document) — use existing `ImageLightbox` component
    - Long-press / hover-menu: Download, Delete
    - Empty state per filter (e.g. "No images yet")
    - Pagination: infinite scroll OR "Load more" — pick the simpler one
    - Calls `listChatWorkspaceFiles({ chatId, type })` from api-client
    - **NO** rename, **NO** cache cleanup, **NO** bucket toggles
15. `apps/web/app/app/_components/assistant-settings.tsx` — REWRITE: replace `AssistantFilesManager` mount with `WorkspaceFilesGallery`; remove anything that referenced `cleanupAssistantFilesCache` / `patchAssistantFileDisplayName` / `getAssistantFiles`
16. `apps/web/app/app/_components/assistant-settings.test.tsx` — REWRITE
17. `apps/web/app/app/_components/sidebar.test.tsx` — REWRITE (likely just attachment-shape mock adjustments)
18. `apps/web/app/app/_components/chat-input.tsx` — minor: ensure local-preview attachment shape carries `storagePath` placeholder (no big rewrite expected)
19. `apps/web/app/app/_components/chat-input.test.tsx` — minor rewrite if shapes changed
20. `apps/web/app/app/assistant-api-client.test.ts` — REWRITE (api-client signature changed)

### Founder-approved UX requirements (verbatim — must respect)

- Project Files in chat: **collapsed** by default; click opens Assistant Settings → Files tab (NOT inline expand)
- Settings → Files: **tile gallery 4–5 columns, square tiles, sort by time desc**, premium look
- **NO** voice notes / cache / "service files" shown in the gallery
- Filter by content type (image / video / document), not by bucket
- Show thumbnail/poster where available (image → 256px webp; video → first-frame jpeg); fallback to MIME icon

### Anti-compromise red flags (W5 specific)

- ❌ Keeping bucket categories (`user_files`, `assistant_created`, etc.) in the new gallery. NEVER — content-type filters only.
- ❌ Inline-expanding the project files panel. NEVER — collapsed link → settings tab.
- ❌ Showing voice notes / cache / service files in the gallery. NEVER — filter at backend `list-chat-workspace-files.service`.
- ❌ Re-introducing any `fileRef` field on web. NEVER — path identity.
- ❌ Keeping the `assistant-file/[fileRef]/route.ts` for back-compat. NEVER — delete; W2 already removed the API endpoint it proxied to.
- ❌ Skipping component tests after rewrite. Rewrite the tests; no `test.skip` permanently.
- ❌ Building a new `AssistantFileState` type on web "to ease migration." NEVER — use the path-based attachment shape from the API directly.
- ❌ Stub gallery UI with placeholder "coming soon" text. NEVER — ship the working tile grid with the founder UX.

### Acceptance checks (subagent runs YOURSELF — all 14)

1. `corepack pnpm --filter @persai/api run typecheck` — PASS
2. `corepack pnpm --filter @persai/runtime run typecheck` — PASS (no regression)
3. `corepack pnpm --filter @persai/sandbox run typecheck` — PASS (no regression)
4. `corepack pnpm --filter @persai/web run typecheck` — PASS
5. `corepack pnpm --filter @persai/runtime-contract run typecheck` — PASS
6. `rg "fileRef|AssistantFileState|getAssistantFileDownloadUrl|getAssistantFiles|deleteAssistantFile|patchAssistantFileDisplayName|cleanupAssistantFilesCache|AssistantFilesCleanupSummary|AssistantFileDocumentLink|thumbnailFileRef|posterFileRef" apps/web/` — **0 matches** in production code (allowed only in deleted-route grep-comments if any, but ideally 0 everywhere)
7. `rg "assistant-file/\[fileRef\]" apps/web/` — **0 matches** (route deleted)
8. `rg "assistant_files|AssistantFile" apps/web/` — **0 matches** in production code
9. `rg "fileBucket|FILE_BUCKETS|user_files|assistant_created|media_uploads|cache_history" apps/web/` — **0 matches** (bucket concept retired)
10. `rg "\"file\"\s*\+\s*\"Ref\"|identityKey\s*=\s*\"file" apps/` — **0 matches**
11. `rg "as\s+unknown\s+as\s+(Runtime|Assistant|Workspace)" apps/web/app/` — **0 matches** in production code (test mocks OK)
12. `corepack pnpm --filter @persai/web run lint` — PASS
13. `corepack pnpm --filter @persai/web run test` — PASS (entire web test suite)
14. `corepack pnpm --filter @persai/api run test` — PASS (no regression; new `list-chat-workspace-files` test passes)

If checks 1–11 fail, fix and re-run. Do NOT report success unless ALL 12–14 also pass.

### W5 brief for Composer (verbatim — dispatched after W4.5 verified)

> Implement Wave 5 of ADR-126 v3 cutover per `docs/ADR/126-v3-CUTOVER-PROGRAM.md` "Wave 5 detailed checklist" section. Touch only the files listed under "Touch only".
>
> Read in order: AGENTS.md, the ADR (D5/D6/D8), the program plan (Wave 5 checklist is your authoritative scope contract). The founder-approved UX requirements section is non-negotiable — surface any deviation in the report.
>
> Anti-compromise red flags from the program plan apply (including the W5 specific list). Permanent rules from W3.1 fix apply.
>
> Report at the end with: (1) git diff --stat, (2) per-file rewrite/delete/new summary, (3) screenshots-equivalent: a written walkthrough of (a) chat with attachment rendering thumbnail, (b) project files panel collapsed state + click flow to settings, (c) workspace files gallery tile layout + filter pills, (4) all 14 acceptance check outputs verbatim, (5) any founder-UX deviation surfaced with one-line justification.

---

## Wave 6 — Tool catalog + bootstrap + tests sweep + closure audit (detailed checklist added at dispatch time)

---

## Closure (after W6)

1. Anti-compromise grep audit subagent (composer-2.5-fast, readonly) — runs the full retired-symbols list across `apps/`, `packages/`, `prisma/`. Reports `file:line` for any non-historical hit.
2. AGENTS gate myself: `corepack pnpm -r --if-present run lint`, `corepack pnpm run format:check`, `corepack pnpm --filter @persai/api run typecheck`, `corepack pnpm --filter @persai/web run typecheck`.
3. Full test suites: api / runtime / sandbox / web.
4. GCS wipe runbook step: `gsutil -m rm -r gs://persai-dev-media/assistant-media/` (operator action, not in code).
5. Update `docs/SESSION-HANDOFF.md` + `docs/CHANGELOG.md`.

Push only after all five steps green.

---

## Closure landed (2026-06-24) — local-only, no push yet

All six waves and the closure phase landed in the working tree. Verification was orchestrator-run independently after each subagent report. Two waves were force-redone (W2 dual-write bridge, W3.1 type-system fraud) after the orchestrator caught violations of the anti-compromise red flags listed at the top of this file; the permanent rules added in those force-redoes (no `as unknown as X` casts in production, no `"file" + "Ref"` grep evasion, no transitional dual-write bridge "for safety") now apply to every future ADR program.

**Closure gate evidence (all green):**

- `corepack pnpm -r --if-present run lint` — PASS (5 apps + scripts/smoke)
- `corepack pnpm run format:check` — PASS
- 6 typechecks: `@persai/api`, `@persai/runtime`, `@persai/sandbox`, `@persai/web`, `@persai/runtime-contract`, `@persai/contracts` — all PASS
- Full test suites: api PASS · runtime PASS · sandbox 63/63 · web 832/832 (69 files)
- Anti-fraud grep `rg "\"file\"\s*\+\s*\"Ref\"|identityKey\s*=\s*\"file"` across `apps/` + `packages/` — **0 matches**
- Retired-symbol grep `rg "fileRef|AssistantFileState|getAssistantFile|deleteAssistantFile"` across `apps/` + `packages/contracts` — **0 production matches** (only intentional JSDoc negations + one rejection-controller comment kept; tests carry `doesNotMatch(/fileRef/)` regression guards)
- OpenAPI surgery clean: 3 endpoints + 7 schemas removed; `AssistantWebChatMessageAttachmentState` + `StageAttachmentAttachment` mirror production export shape; orval regenerated; `deepseek` provider entry added to `RuntimeProviderModelCatalogByProviderState` + `AdminRuntimeProviderSettingsState.providerKeys` (drift caught during regen)
- 6 unused imports removed during lint pass; prettier auto-fix landed on 45 files
- GCS wipe runbook: `infra/dev/gke/ADR-126-V3-GCS-WIPE-RUNBOOK.md` (dev-first → validate → prod; soft-delete is not enabled on `persai-dev-workspaces`, wipe is permanent — accepted per founder direction)
- `docs/SESSION-HANDOFF.md` and `docs/CHANGELOG.md` updated with the 2026-06-24 v3 closure entry
- `AGENTS.md` closed-program archive list updated to include ADR-126 v3 with the "implemented locally; deploy + live validation pending" note (mirrors ADR-125's closure pattern)

**Open follow-ups (not in scope of this program):**

1. Commit + push to `main` is the user's call (standing "no git push unless asked" rule).
2. v3 dev cutover sequence: pin v3 images → approve `persai-dev-migrations` env for both v3 migrations → wait for migration to land → execute Section 2 of the GCS wipe runbook → run the 7 acceptance scenarios listed in the SESSION-HANDOFF "Deferred to next session" block → if green, repeat for prod.
3. The `recordSharedInputPublished` event type + logger exist with no production callers. Intentionally renamed in W6a to the v3 vocabulary; first real caller arrives when a future slice wires the publish-side event (likely after document-job revisits in v3 mode).
4. Three pre-existing `as unknown as RuntimeProviderModelProfileState` casts remain in `apps/web/app/admin/runtime/page.tsx` (W5 baseline; out of scope for this program).

---

## B4 landed — D7 quota enforcement (2026-06-24)

Opus-4.8 post-closure audit item **B4**: plan-driven `/workspace/` and `/shared/` storage caps with stable `workspace_quota_exhausted` / `shared_quota_exhausted` error classes end-to-end.

**What landed:**

- `PlanQuotaHints` + `parsePlanQuotaHints` — `sharedStorageBytesLimit` from `billingProviderHints.quotaAccounting.sharedStorageBytesLimit` with `shared_storage_bytes_limit` fallback in `limits_permissions`.
- `WorkspaceQuotaLimitsInput` + `buildWorkspaceQuotaLimits` — `sharedStorageBytesLimit` with `QUOTA_SHARED_STORAGE_BYTES_DEFAULT` (500 MB) env override in `packages/config/src/api-config.ts`.
- `resolveSharedQuotaBytes` in bundle materialization; `sharedQuotaBytes` in `governance.quota` and assistant config.
- `AssistantRuntimeBundleQuota.sharedQuotaBytes` in `packages/runtime-bundle`.
- `RuntimeSandboxJobRequest.workspaceQuotaBytes` / `sharedQuotaBytes` plumbed runtime → sandbox → `WorkspaceBridgeContext`.
- Pre-write `du -sb` guard in `workspaceFileBridgeWrite` with typed `WorkspaceFileBridgeFailureReason` union (no string widening).
- Runtime `executeWriteAction` surfaces quota reasons on completed jobs with non-null `reason` (mirrors attach path).
- Tests: sandbox bridge quota cases, runtime files.write mapping, bundle materialization `sharedQuotaBytes` assertion.

**Verification (orchestrator-run):** lint PASS · format:check PASS · api/runtime/sandbox/web/runtime-contract/contracts typecheck PASS · runtime test suite PASS · sandbox 67/67 PASS · focused B4 tests PASS. Full api suite has a pre-existing ADR-119 golden-prompt drift unrelated to B4.

**Out of scope (unchanged):** DB row accounting for shared bytes, `assistant-media/` prefix, schema/migrations.
