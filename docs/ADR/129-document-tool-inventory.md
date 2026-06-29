# ADR-129 Wave 0 - document tool inventory and contract freeze

## Scope and freeze

This document is the Wave 0 audit ledger for ADR-129. It inventories the current `document` tool path and adjacent delivery/versioning/extraction surfaces before implementation starts.

Constraints for this wave:

- no production behavior changes;
- no schema, prompt, tool-descriptor, or test edits;
- inventory only;
- classifications are advisory for Wave 1+ and must be re-audited by the parent orchestrator before code changes land.

Working assumptions from current repo truth:

- workspace/file identity is `(workspaceId, path)` with flat `/workspace/...`;
- `workspace_file_metadata` + GCS canonical bytes + pod FS cache are the active filesystem model after ADR-126/127/128;
- final user-visible file delivery should converge on `files.attach`;
- existing document extraction/OCR ownership stays API-side unless a later wave explicitly reassigns it.

## Classification legend

- `KEEP`: preserve the owner/surface; adapt internals only if later waves need it.
- `REPLACE`: same broad surface may survive, but the current contract/behavior is not ADR-129 compliant.
- `DELETE`: remove from the normal active path before ADR-129 closes.
- `MOVE`: capability survives but its source of truth or ownership location must shift.
- `AUDIT`: keep under review; exact fate depends on later-wave design decisions.

## 1. Current document tool path inventory

### 1.1 Runtime: model-facing `document` tool and worker orchestration

| Surface                                   | Path                                                                                                                                                | Key symbols                                                                                                                                             | Current role                                                                                                                                                                                                                                                | Class     | Why                                                                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model-facing tool executor                | `apps/runtime/src/modules/turns/runtime-document-tool.service.ts`                                                                                   | `RuntimeDocumentToolService`, `executeToolCall()`, `readDocumentArguments()`, `selectSourceAttachmentsForRequest()`, `resolveEffectiveDescriptorMode()` | Parses `descriptorMode`, auto-selects source attachments, and always converts document work into deferred background jobs with `action:"pending_delivery"`.                                                                                                 | `REPLACE` | ADR-129 requires visible workspace `extract -> edit -> render -> inspect -> files.attach`, not a normal opaque async generator.                   |
| Deferred-job honesty + developer guidance | `apps/runtime/src/modules/turns/turn-execution.service.ts`                                                                                          | `buildDeferredDocumentFollowUpInstruction()`, `buildOpenDocumentJobsDeveloperSection()`, `buildJobDeliveryUpdatesDeveloperSection()`                    | Teaches the model to acknowledge pending document jobs, not to deliver via files during the same turn, and exposes open/finalizing document-job context.                                                                                                    | `REPLACE` | Pending-delivery guardrails stay useful, but the primary workflow guidance must pivot from hidden job acceptance to visible workspace operations. |
| Tool definition / descriptor projection   | `apps/runtime/src/modules/turns/native-tool-projection.ts`                                                                                          | `createDocumentToolDefinition()`                                                                                                                        | Publishes the model-visible `document` tool contract, including `create_pdf_document`, `create_presentation`, `revise_document`, `export_or_redeliver`, `create_data_document`, auto-inline source extraction, Gamma wording, and `pending_delivery` hints. | `REPLACE` | This is the main ADR-117-owned descriptor surface and currently teaches the wrong mental model.                                                   |
| Worker run entrypoint                     | `apps/runtime/src/modules/turns/runtime-document-job-run.service.ts`                                                                                | `RuntimeDocumentJobRunService`, `run()`                                                                                                                 | Accepts internal `document-jobs/run` requests and dispatches to the provider adapter.                                                                                                                                                                       | `REPLACE` | The internal run seam may survive, but its current job contract is built around opaque worker generation.                                         |
| Worker completion framing                 | `apps/runtime/src/modules/turns/runtime-document-job-completion.service.ts`                                                                         | `RuntimeDocumentJobCompletionService`, `complete()`                                                                                                     | Produces short follow-up text after worker completion/failure through a synthetic turn.                                                                                                                                                                     | `AUDIT`   | May remain for narrow background cases, but normal document quality loops should not depend on post-hoc worker framing.                           |
| Internal runtime controller               | `apps/runtime/src/modules/turns/interface/http/internal-runtime-document-jobs.controller.ts`                                                        | `InternalRuntimeDocumentJobsController`, `parseInput()`, `parseCompletionInput()`                                                                       | Validates internal document-job run/completion payloads, including `create_data_document`, `sourceFiles[]`, and previous-version HTML.                                                                                                                      | `REPLACE` | The current request shape is anchored to the hidden job lane and narrow descriptor modes.                                                         |
| Main document worker                      | `apps/runtime/src/modules/turns/runtime-document-provider-adapter.service.ts`                                                                       | `RuntimeDocumentProviderAdapterService`, `run()`, `runGammaPath()`, `runPdfPatchRevise()`, `runStructuredPdfRevise()`, `runCodeDocumentPath()`          | Implements sandbox PDF generation/revision, Gamma presentations, and hidden code-generated mode-B data documents.                                                                                                                                           | `REPLACE` | ADR-129 keeps useful render primitives but rejects the current black-box worker as the primary product behavior.                                  |
| Rendered artifact persistence             | `apps/runtime/src/modules/turns/runtime-document-provider-adapter.service.ts` + `apps/runtime/src/modules/turns/write-runtime-outbound-artifact.ts` | `writeRuntimeOutboundArtifact()`                                                                                                                        | Persists produced artifacts and returns worker output metadata for downstream delivery.                                                                                                                                                                     | `AUDIT`   | Persistence primitives may remain, but version registration and final delivery must be redesigned around visible workspace outputs.               |

### 1.2 API: enqueue, persistence, scheduler, delivery, web continuity

| Surface                               | Path                                                                                                                                                                                                                                 | Key symbols                                                                                                                 | Current role                                                                                                              | Class     | Why                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Deferred-job ingress                  | `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service.ts`                                                                                                                             | `EnqueueRuntimeDeferredDocumentJobService`, `execute()`, `enqueueRevision()`, `enqueueExportOrRedeliver()`                  | Validates quota/policy, resolves create/revise/export paths, and creates document DB rows plus deferred jobs.             | `REPLACE` | The orchestration is built around hidden async job acceptance instead of explicit workspace actions.                               |
| Document domain service               | `apps/api/src/modules/workspace-management/application/assistant-document-job.service.ts`                                                                                                                                            | `AssistantDocumentJobService`, `enqueue()`, `enqueueRevision()`, `findRevisionContext*()`, `findExportOrRedeliverContext()` | Owns `AssistantDocument*` row creation, revision context resolution, and delivered-attachment linkage via `documentLink`. | `REPLACE` | The domain survives, but its version semantics must shift to workspace project/source snapshot + output path + inspection summary. |
| Open-job / delivery-update read model | `apps/api/src/modules/workspace-management/application/assistant-document-job-read.service.ts`                                                                                                                                       | `listOpenJobsForWebChat()`, `listOpenJobsForRuntimeContext()`, `listJobDeliveryUpdatesForRuntimeContext()`                  | Projects open and recently-delivered document jobs into web/runtime continuity surfaces.                                  | `AUDIT`   | Some continuity may remain for background render/export cases, but normal document edits should stop depending on this lane.       |
| Background scheduler                  | `apps/api/src/modules/workspace-management/application/assistant-document-job-scheduler.service.ts`                                                                                                                                  | `AssistantDocumentJobSchedulerService`, `processQueuedJob()`, `claimDueJobs()`                                              | Claims queued/running/ready-for-delivery jobs, extracts source attachments, calls runtime, and invokes delivery.          | `REPLACE` | Current hidden worker orchestration is the core ADR-129 target for refactor.                                                       |
| Delivery/finalization                 | `apps/api/src/modules/workspace-management/application/assistant-document-job-delivery.service.ts`                                                                                                                                   | `AssistantDocumentJobDeliveryService`, `deliverReadyJob()`, `parsePersistedPayload()`, `recordDeliveredFiles()`             | Auto-delivers generated artifacts to chat, settles quota, writes `documentLink`, and frames completion text.              | `REPLACE` | ADR-129 requires final delivery through explicit `files.attach`, not backend-owned auto-delivery as the normal path.               |
| Completion framing bridge             | `apps/api/src/modules/workspace-management/application/assistant-document-job-completion-turn.service.ts`                                                                                                                            | `AssistantDocumentJobCompletionTurnService`, `maybeFrame()`                                                                 | Bridges API delivery to runtime synthetic completion framing.                                                             | `AUDIT`   | Could remain for narrow async exceptions, but not for the primary workflow.                                                        |
| PPTX follow-up action                 | `apps/api/src/modules/workspace-management/application/prepare-assistant-document-pptx.service.ts`                                                                                                                                   | `PrepareAssistantDocumentPptxService`, `execute()`                                                                          | User-confirmed second render for PPTX from an existing presentation version.                                              | `AUDIT`   | ADR-129 explicitly allows narrow PPTX follow-up to remain if needed; keep under audit until presentation strategy is finalized.    |
| Chat attachment metadata projection   | `apps/api/src/modules/workspace-management/application/read-attachment-document-link.ts`                                                                                                                                             | `readPersistedDocumentLinkMetadata()`                                                                                       | Normalizes attachment `metadata.documentLink` for SSE/history/web clients.                                                | `REPLACE` | The metadata surface survives, but fields must widen to ADR-129 version/source/inspection truth and drop legacy narrowing.         |
| Web chat serializers                  | `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts`, `stream-web-chat-turn.service.ts`, `complete-web-post-runtime-turn.ts`, `manage-web-chat-list.service.ts`, `web-chat-turn-attempt.service.ts` | `documentLink: readPersistedDocumentLinkMetadata(...)`                                                                      | Re-project delivered document metadata into turn responses, replays, and chat list/history.                               | `AUDIT`   | These surfaces likely remain, but their document payload shape must be synchronized with the new version model.                    |
| Admin doc-processing API              | `apps/api/src/modules/workspace-management/interface/http/admin-document-processing-settings.controller.ts`                                                                                                                          | `AdminDocumentProcessingSettingsController`                                                                                 | Exposes admin settings for document-processing policy and key storage.                                                    | `KEEP`    | API/admin ownership of extraction provider policy is still correct under ADR-129.                                                  |
| Admin doc-processing service          | `apps/api/src/modules/workspace-management/application/manage-admin-document-processing-settings.service.ts`                                                                                                                         | `ManageAdminDocumentProcessingSettingsService`                                                                              | Validates policy, persists provider keys, and supports non-live test-connection checks.                                   | `KEEP`    | Credential/policy governance should stay here.                                                                                     |

### 1.3 API extraction stack and policy/credential ownership

| Surface                              | Path                                                                                                     | Key symbols                                                                                                                                                                  | Current role                                                                                                                                     | Class   | Why                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Shared extraction engine             | `apps/api/src/modules/workspace-management/application/document-extraction.service.ts`                   | `DocumentExtractionService`, `extract()`, `extractLocalText()`, `extractWithMistral()`, `extractWithLlamaParse()`                                                            | API-owned extraction core used for knowledge/document paths; handles local parsing, OCR/provider fallback, quality scoring, and provider traces. | `KEEP`  | ADR-129 explicitly wants to reuse the existing extraction stack rather than invent a new one.                                     |
| Transient document-source extraction | `apps/api/src/modules/workspace-management/application/document-source-attachment-extraction.service.ts` | `DocumentSourceAttachmentExtractionService`, `extractSourceFiles()`                                                                                                          | Downloads source attachments and converts them into transient `RuntimeDocumentSourceFile[]` payloads for worker jobs.                            | `MOVE`  | Extraction should stay API-owned, but outputs must move from transient job payloads to visible `/workspace/...extract/` sidecars. |
| Policy normalization                 | `apps/api/src/modules/workspace-management/application/document-processing-settings.ts`                  | `DOCUMENT_PROCESSING_PROVIDER_SECRET_IDS`, `DOCUMENT_PROCESSING_PROVIDER_SECRET_KEYS`, `normalizeDocumentProcessingPolicyRecord()`, `toDocumentProcessingSecretStorageKey()` | Defines provider ids, storage keys, admin request/response schema, and policy normalization.                                                     | `KEEP`  | This is the correct policy/config seam for existing OCR/parsing providers.                                                        |
| Selection/escalation policy          | `apps/api/src/modules/workspace-management/application/knowledge-document-processing-policy.ts`          | `DEFAULT_KNOWLEDGE_DOCUMENT_PROCESSING_POLICY`, `resolveKnowledgeDocumentProcessorSelection()`, `resolveKnowledgeDocumentProcessorEscalation()`                              | Encodes `local` / `mistral` / `llamaparse` default and fallback policy.                                                                          | `KEEP`  | ADR-129 wants to reuse this provider-selection policy for visible extraction.                                                     |
| Tool credential backbone             | `apps/api/src/modules/workspace-management/application/tool-credential-settings.ts`                      | `TOOL_CREDENTIAL_IDS.tool_document_gamma`, `TOOL_PROVIDER_OPTIONS.tool_document_gamma`                                                                                       | Stores Gamma as the active document tool credential on the admin tools surface.                                                                  | `AUDIT` | Gamma may remain only as a narrow presentation/provider seam, not as the generic document mental model.                           |

### 1.4 Provider gateway

| Surface             | Path                                                                                                    | Key symbols                                                                                  | Current role                                                                           | Class   | Why                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Provider controller | `apps/provider-gateway/src/modules/providers/interface/http/provider-document-generation.controller.ts` | `ProviderDocumentGenerationController`, `POST /api/v1/providers/generate-document`           | Internal endpoint for provider-backed document generation.                             | `AUDIT` | May survive for Gamma-only presentation rendering, but it is not the target-state general document surface.                          |
| Provider service    | `apps/provider-gateway/src/modules/providers/provider-document-generation.service.ts`                   | `ProviderDocumentGenerationService`, `generateDocument()`, `normalizeGammaProviderOptions()` | Resolves Gamma secret and submits provider-backed presentation renders (`pdf`/`pptx`). | `AUDIT` | Keep only if presentations still need Gamma after the workspace-visible redesign; otherwise narrow or remove.                        |
| Gamma adapter       | `apps/provider-gateway/src/modules/providers/gamma/gamma-provider.client.ts`                            | `GammaProviderClient`                                                                        | Actual presentation provider integration.                                              | `AUDIT` | Presentation-only follow-up remains allowed, but the parent orchestrator must decide if Gamma stays the long-term presentation path. |

### 1.5 Sandbox

| Surface                          | Path                                                       | Key symbols                                                               | Current role                                                                                                            | Class     | Why                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Internal PDF render primitive    | `apps/sandbox/src/sandbox.service.ts`                      | `case "render_html_to_pdf"`, `handleRenderHtmlToPdf()`                    | Renders HTML to PDF inside sandbox, writes output file, and cleans transient HTML input.                                | `KEEP`    | ADR-129 still needs a deterministic visible PDF render primitive over workspace sources.                                                         |
| Internal code-document primitive | `apps/sandbox/src/sandbox.service.ts`                      | `case "execute_document_code"`, `handleExecuteDocumentCode()`             | Runs model-authored Python to emit `xlsx`/`docx`/`pdf`, mounts raw source files, and writes OCR sidecars when provided. | `AUDIT`   | The primitive may remain for visible build scripts, but the current hidden worker-generated Office path must not remain the normal product flow. |
| Runtime sandbox bridge           | `apps/runtime/src/modules/turns/sandbox-client.service.ts` | sandbox job submission for `render_html_to_pdf` / `execute_document_code` | Bridges runtime worker calls into sandbox jobs.                                                                         | `REPLACE` | The bridge survives, but call sites must move from hidden generation to explicit render/build/inspect flows.                                     |
| Sandbox tests                    | `apps/sandbox/test/sandbox.service.test.ts`                | `render_html_to_pdf` / `execute_document_code` tests                      | Verifies internal render/build primitives.                                                                              | `KEEP`    | Primitive coverage remains valuable, but fixtures and expectations must be updated for flat `/workspace` truth and visible project paths.        |

### 1.6 Web/UI

| Surface                             | Path                                                                      | Key symbols                                                                                 | Current role                                                                        | Class     | Why                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Attachment banner + PPTX affordance | `apps/web/app/app/_components/chat-message.tsx`                           | `att.documentLink`, `PresentationPptxPrepareAction`, `getAssistantDocumentPptxPrepareUrl()` | Shows version badges and the quiet PPTX action for delivered presentation PDFs.     | `AUDIT`   | The UI surface can survive, but metadata and actions must match the new version model and explicit `files.attach` delivery flow. |
| Client document-job types           | `apps/web/app/app/assistant-api-client.ts`                                | `WebChatActiveDocumentJobState`, `getAssistantDocumentPptxPrepareUrl()`                     | Client-side types and helper URL generation for active document jobs and PPTX prep. | `REPLACE` | Current types still narrow to legacy document unions and already drift from server truth.                                        |
| Shared web payload types            | `apps/api/src/modules/workspace-management/application/web-chat.types.ts` | `AssistantWebChatMessageAttachmentDocumentLink`, `AssistantWebChatActiveDocumentJobState`   | Server-side web payload types for `documentLink` and active document jobs.          | `AUDIT`   | This is the correct surface, but it needs widening to ADR-129 source/output/inspection metadata.                                 |

## 2. Extraction call sites and ownership

### 2.1 Active extraction call sites

| Call site                              | Path                                                                                                     | Symbols                                                  | Current extracted output                                               | Class   | Why                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| Shared extraction engine               | `apps/api/src/modules/workspace-management/application/document-extraction.service.ts`                   | `extract()`                                              | `normalizedText`, optional `markdown`, `provider`, `quality`, metadata | `KEEP`  | This should remain the core extraction/OCR engine.                                           |
| Deferred document source extraction    | `apps/api/src/modules/workspace-management/application/document-source-attachment-extraction.service.ts` | `extractSourceFiles()`                                   | Transient `RuntimeDocumentSourceFile[]` for worker job payloads        | `MOVE`  | Outputs must become workspace sidecars plus a compact manifest.                              |
| Knowledge indexing path                | `apps/api/src/modules/workspace-management/application/knowledge-document-processor.service.ts`          | knowledge document processor uses shared extraction      | Persisted knowledge extraction/chunking inputs                         | `KEEP`  | Not part of ADR-129 scope but shares the same extraction substrate.                          |
| Runtime file read extraction path      | `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts` + API internal files/extract seam | internal API file extraction call                        | Shared extraction for `files.read` of PDF/DOCX                         | `AUDIT` | Related extraction behavior must stay consistent with Wave 1 sidecar semantics.              |
| Data-document scanned-PDF OCR sidecars | `apps/runtime/src/modules/turns/runtime-document-provider-adapter.service.ts`                            | `runCodeDocumentPath()` PDF probe + OCR sidecar planning | `*.ocr.txt` mounted only inside hidden mode-B worker sandbox workspace | `MOVE`  | Sidecar writing is directionally correct, but it happens in the wrong hidden worker context. |

### 2.2 Provider credential and policy ownership

| Concern                    | Current owner                              | Path / symbols                                                                                                                       | Current truth                                                                        | Class   | Why                                                                   |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------- |
| Extraction provider policy | API control plane                          | `knowledge-document-processing-policy.ts`, `document-processing-settings.ts`                                                         | Default `mistral`, HQ fallback `llamaparse`, local fallback enabled by policy        | `KEEP`  | ADR-129 explicitly reuses existing policy ownership.                  |
| Mistral OCR secret id      | API admin tools / encrypted secret store   | `document-processing-settings.ts` -> `DOCUMENT_PROCESSING_PROVIDER_SECRET_IDS.mistral = "document-processing/mistral/api-key"`       | Write-only encrypted secret, resolved by `PlatformRuntimeProviderSecretStoreService` | `KEEP`  | Correct owner and storage pattern.                                    |
| LlamaParse secret id       | API admin tools / encrypted secret store   | `document-processing-settings.ts` -> `DOCUMENT_PROCESSING_PROVIDER_SECRET_IDS.llamaparse = "document-processing/llamaparse/api-key"` | Write-only encrypted secret, resolved by `PlatformRuntimeProviderSecretStoreService` | `KEEP`  | Correct owner and storage pattern.                                    |
| Gamma render secret id     | API admin tools / runtime tool credentials | `tool-credential-settings.ts` -> `TOOL_CREDENTIAL_IDS.tool_document_gamma = "tool/document/gamma/api-key"`                           | Active document-provider credential for provider-gateway presentation generation     | `AUDIT` | Keep only if Gamma remains a narrow presentation seam after redesign. |
| Local parsers              | API service code                           | `document-extraction.service.ts` -> local text decode, `pdf-parse`, `mammoth`, `MediaPreprocessorService`                            | First-line extraction for text/PDF/DOCX/media-preprocessed content                   | `KEEP`  | Local extraction is still needed for visible `document.extract`.      |

## 3. Model-facing tool docs, prompt, and catalog text

### 3.1 Active model-facing surfaces

| Surface                       | Path                                                       | Key text / concept                                                                                       | Current truth                                                                                                                                                  | Class     | Why                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| Tool catalog entry            | `apps/api/prisma/tool-catalog-data.ts`                     | `code: "document"`, `modelUsageGuidance`, `create_data_document`, async delivery wording                 | Teaches `document` as an async generator for PDF/presentation/data docs and says runs may go async.                                                            | `REPLACE` | This is core ADR-117 descriptor text and currently reinforces the opaque worker mental model.                       |
| Selection guide               | `apps/api/prisma/bootstrap-preset-data.ts`                 | `<failure_handling>` `pending_delivery`, `<category name="documents">`, `files({action:"attach", path})` | Correctly distinguishes new document generation from `files.attach`, but only at a high level and without extract/render/inspect semantics.                    | `REPLACE` | The selection guide must teach `document.extract`, `document.render`, `document.inspect`, and final `files.attach`. |
| Runtime descriptor projection | `apps/runtime/src/modules/turns/native-tool-projection.ts` | `createDocumentToolDefinition()`                                                                         | Expands the full old contract: `create_*`, auto-inline extraction, `create_data_document`, Gamma presentation hints, `storagePath` revise, `pending_delivery`. | `REPLACE` | This is the most concrete model-facing contract and must be rewritten almost entirely.                              |
| Delivery honesty contract     | `apps/runtime/src/modules/turns/turn-execution.service.ts` | `DELIVERY_HONESTY_CONTRACT`, `buildDeferredDocumentFollowUpInstruction()`                                | Prevents false claims about attached/sent/pending files and blocks same-turn `files` delivery for deferred document jobs.                                      | `AUDIT`   | Honesty rules remain valuable, but they must be narrowed to only the background cases that survive ADR-129.         |
| Runtime contract types        | `packages/runtime-contract/src/index.ts`                   | `RuntimeDocumentToolResult`, `RuntimeDocumentJobRunRequest`, `RuntimeDocumentJobCompletionRequest`       | Contract still centers on worker execution, descriptor modes, and pending-delivery state.                                                                      | `REPLACE` | The contract must shift toward extract/render/inspect/version semantics over workspace files.                       |

### 3.2 Search terms required by ADR-129

| Term                                   | Active hit(s)                                                                                                                                                              | Notes                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `document`                             | Widespread across runtime/api/provider/web and prompt/catalog files above                                                                                                  | Active and central.                                                                                                  |
| `files.attach`                         | `apps/api/prisma/bootstrap-preset-data.ts`; `tool-catalog-data.ts` files guidance; runtime/tests elsewhere                                                                 | Already the correct final-delivery concept in the selection guide, but not yet the normal document completion path.  |
| `create_data_document`                 | `tool-catalog-data.ts`; `native-tool-projection.ts`; runtime/api contracts and services                                                                                    | Primary ADR-129 delete/replace target.                                                                               |
| `pending_delivery`                     | `runtime-document-tool.service.ts`; `turn-execution.service.ts`; `bootstrap-preset-data.ts`; `native-tool-projection.ts`; `packages/runtime-contract/src/index.ts`         | Honest current deferred-job contract; must be retained only where true background rendering still exists.            |
| extraction wording                     | `native-tool-projection.ts`; `document-extraction.service.ts`; `document-source-attachment-extraction.service.ts`; ADR/docs                                                | Current model-facing wording teaches auto-inline extraction into hidden generation instead of visible sidecar files. |
| PDFMonkey/provider wording             | Active code no longer advertises PDFMonkey in current model-facing code paths; archival ADRs still mention it                                                              | Good cleanup baseline; avoid reintroducing provider vocabulary in new model-facing text.                             |
| `fileRef`                              | Retired/guardrail wording remains in `packages/runtime-contract/src/index.ts`, `tool-catalog-data.ts`, and `internal-runtime-document-jobs.controller.ts` rejection guards | Guardrail mentions are acceptable; no active model-facing file selector should reintroduce `fileRef`.                |
| `/shared` or old workspace directories | No active document model-facing code paths found in current descriptor/selection-guide files; old mentions remain mainly in closed ADRs/tests/comments                     | Good baseline, but stale test fixtures still need rewrite.                                                           |

## 4. Delivery metadata and versioning surfaces

### 4.1 Prisma / DB / domain truth

| Surface                 | Path                            | Symbols                                                                                                                                                            | Current truth                                                                                                                                                                       | Class     | Why                                                                                                                |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| Document identity       | `apps/api/prisma/schema.prisma` | `model AssistantDocument`                                                                                                                                          | Canonical `doc_id`, assistant/workspace/chat ownership, `documentType`, `currentVersionId`, status, relations to versions/jobs/mappings/logs                                        | `KEEP`    | Document identity still makes sense.                                                                               |
| Version graph           | `apps/api/prisma/schema.prisma` | `model AssistantDocumentVersion`                                                                                                                                   | Stores `descriptorMode`, `sourceJson`, `providerInputJson`, `sourceSummaryText`, `sourceOutlineJson`, `renderedHtml`, `structureJson`, `styleProfileJson`, `editStrategy`, `status` | `REPLACE` | Version rows need new fields/semantics centered on workspace source snapshot, output path, and inspection summary. |
| Render-job lifecycle    | `apps/api/prisma/schema.prisma` | `model AssistantDocumentRenderJob`                                                                                                                                 | Tracks provider, output format, request/provider status JSON, retry/claim/completion/delivery timestamps, completion usage                                                          | `AUDIT`   | Background render jobs may survive narrowly, but the current normal-path role is too broad.                        |
| Provider reconciliation | `apps/api/prisma/schema.prisma` | `model AssistantDocumentProviderMapping`                                                                                                                           | Stores external ids/status and provider metadata for version/provider pairs                                                                                                         | `AUDIT`   | Still useful if Gamma or any external provider survives; otherwise narrow.                                         |
| Revision audit log      | `apps/api/prisma/schema.prisma` | `model AssistantDocumentRevisionLog`                                                                                                                               | Stores interpreted patch intent, structured patch JSON, provider edit refs, provenance                                                                                              | `AUDIT`   | Revision logging still matters, but fields should reflect workspace-visible edits rather than hidden regeneration. |
| Active enums            | `apps/api/prisma/schema.prisma` | `AssistantDocumentType`, `AssistantDocumentDescriptorMode`, `AssistantDocumentOutputFormat`, `AssistantDocumentRenderProvider`, `AssistantDocumentRenderJobStatus` | Includes `data_document`, `create_data_document`, `xlsx`, `docx`, `sandbox`, `gamma`                                                                                                | `AUDIT`   | Some enum members survive, but the descriptor-mode set will change materially under ADR-129.                       |

### 4.2 Services and metadata surfaces

| Surface                  | Path                                                                                               | Symbols                                                                                   | Current truth                                                                                                                            | Class     | Why                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| Delivery metadata writer | `apps/api/src/modules/workspace-management/application/assistant-document-job-delivery.service.ts` | `recordDeliveredFiles()`                                                                  | Writes attachment `metadata.documentLink` with `docId`, `versionId`, `descriptorMode`, `documentType`, `renderJobId`, `isCurrentOutput`. | `REPLACE` | Metadata must widen to output path, version status, inspection summary, and new workflow facts. |
| Delivery metadata reader | `apps/api/src/modules/workspace-management/application/read-attachment-document-link.ts`           | `readPersistedDocumentLinkMetadata()`                                                     | Reads normalized document link for web/SSE/chat history.                                                                                 | `REPLACE` | Reader must be widened alongside writer.                                                        |
| Web payload type         | `apps/api/src/modules/workspace-management/application/web-chat.types.ts`                          | `AssistantWebChatMessageAttachmentDocumentLink`, `AssistantWebChatActiveDocumentJobState` | Server type already includes `data_document` and `create_data_document` for active jobs; attachment link type is generic stringly typed. | `AUDIT`   | Good place to centralize new metadata, but it must stop drifting from client and delivery code. |
| Web client projection    | `apps/web/app/app/assistant-api-client.ts`                                                         | `WebChatActiveDocumentJobState`                                                           | Client type still narrows to `pdf_document` / `presentation` and excludes `create_data_document`.                                        | `REPLACE` | This is a live drift bug against server truth.                                                  |
| PPTX UI action           | `apps/web/app/app/_components/chat-message.tsx`                                                    | `att.documentLink`, `PresentationPptxPrepareAction`                                       | Uses `documentLink.docId/versionId` to offer PPTX preparation for delivered presentation PDFs.                                           | `AUDIT`   | Keep only if the Gamma PPTX exception survives; otherwise simplify.                             |
| Runtime continuity       | `apps/api/src/modules/workspace-management/application/assistant-document-job-read.service.ts`     | open-job and delivery-update projections                                                  | Surfaces active document jobs to runtime and web.                                                                                        | `AUDIT`   | Might remain for narrow background tasks but should not define the normal document workflow.    |

### 4.3 Known delivery/version drift

| Drift                                                   | Path                                                                                                                    | Evidence                                                                                                                                                                                  | Class   | Why                                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| Delivery payload parser drops data-document modes       | `apps/api/src/modules/workspace-management/application/assistant-document-job-delivery.service.ts`                      | `parsePersistedPayload()` only accepts `create_pdf_document`, `create_presentation`, `revise_document`, `export_or_redeliver`; `readDescriptorMode()` falls back to `create_pdf_document` | `AUDIT` | Existing persisted `create_data_document` jobs can lose precise metadata on the delivery path. |
| Delivery payload parser narrows output format           | `apps/api/src/modules/workspace-management/application/assistant-document-job-delivery.service.ts`                      | `parsePersistedPayload()` only keeps `pdf` / `pptx`; `readOutputFormat()` only returns `pdf` / `pptx`.                                                                                    | `AUDIT` | Existing `xlsx` / `docx` jobs are already forced through legacy metadata assumptions.          |
| Web client active-job type is narrower than server type | `apps/web/app/app/assistant-api-client.ts` vs `apps/api/src/modules/workspace-management/application/web-chat.types.ts` | Client omits `data_document` / `create_data_document`; server includes both.                                                                                                              | `AUDIT` | This is a direct docs/code/client drift that should be fixed in Wave 3 or sooner.              |

## 5. Exact current tests covering the old path

### 5.1 Runtime tests

- `apps/runtime/test/runtime-document-tool.service.test.ts`
  - Covers deferred enqueue, source-attachment auto-selection, `revise_document` auto-resolution, forced `pending_delivery`, `create_presentation` PDF forcing, and `create_data_document` routing to `data_document` + `sandbox`.
- `apps/runtime/test/runtime-document-provider-adapter.service.test.ts`
  - Covers sandbox PDF generation, Gamma presentations, patch/structured revise, source auto-inline behavior, hidden mode-B `create_data_document`, sandbox self-repair, Office validation, and OCR sidecar mounting for scanned PDFs.
- `apps/runtime/test/runtime-document-job-run.service.test.ts`
  - Covers internal run request parsing/dispatch shape.
- `apps/runtime/test/runtime-document-job-completion.service.test.ts`
  - Covers synthetic completion framing.
- `apps/runtime/test/internal-runtime-document-jobs.controller.test.ts`
  - Covers internal request/response validation for document job run/completion.
- `apps/runtime/test/deferred-document-acknowledgement.test.ts`
  - Covers `pending_delivery` acknowledgement instructions, delivery honesty, and the explicit ban on using `files` to deliver pending document jobs in the same turn.
- `apps/runtime/test/native-tool-projection.test.ts`
  - Covers presence/shape of model-visible tool definitions, including `document`.
- `apps/runtime/test/turn-execution.service.test.ts`
  - Covers open document jobs, delivery honesty, working-file document anchors, and document-related tool-loop behavior.
- `apps/runtime/test/turn-context-hydration.service.test.ts`
  - Covers working-file/runtime attachment hydration; contains stale `assistant-media/...` fixtures that intersect document flows.
- `apps/runtime/test/sanitize-tool-result-for-model.test.ts`
  - Covers hiding internal selectors and document/media tool-result sanitization.

### 5.2 API tests

- `apps/api/test/enqueue-runtime-deferred-document-job.service.test.ts`
  - Covers job admission, create/revise/export branching, quota checks, and legacy revise rules.
- `apps/api/test/assistant-document-job.service.test.ts`
  - Covers document/version/revision context behavior.
- `apps/api/test/assistant-document-job-scheduler.service.test.ts`
  - Covers scheduler claiming, worker dispatch, and delivery-path orchestration.
- `apps/api/test/assistant-document-job-delivery.service.test.ts`
  - Covers `documentLink` writes, recovery semantics, quota settlement, promotion of delivered revisions, and completion framing caching.
- `apps/api/test/assistant-document-job-read.service.test.ts`
  - Covers active/open job and delivery-update read models.
- `apps/api/test/assistant-document-job-failure-copy.service.test.ts`
  - Covers failure-message copy for document job failures.
- `apps/api/test/document-source-attachment-extraction.service.test.ts`
  - Covers source attachment extraction into transient worker payloads.
- `apps/api/test/manage-admin-document-processing-settings.service.test.ts`
  - Covers admin policy/credential configuration and test-connection validation.
- `apps/api/test/knowledge-document-processing-policy.test.ts`
  - Covers extraction provider selection/escalation policy.
- `apps/api/test/knowledge-document-processor.service.test.ts`
  - Covers shared knowledge-side extraction/processing behavior that shares the same extraction engine.
- `apps/api/test/prepare-assistant-document-pptx.service.test.ts`
  - Covers PPTX readiness/idempotency/queueing for presentation follow-up renders.
- `apps/api/test/runtime-tool-policy.test.ts`
  - Covers tool-policy presence and Gamma credential/config plumbing for `document`.
- `apps/api/test/seed-tool-catalog.test.ts`
  - Covers seeded tool catalog including the `document` tool entry.
- `apps/api/test/bootstrap-preset-data.test.ts`
  - Covers prompt-template selection-guide invariants, including document/files routing and `pending_delivery`.
- `apps/api/test/send-web-chat-turn.service.test.ts`, `stream-web-chat-turn.service.test.ts`, `complete-web-post-runtime-turn.test.ts`, `manage-web-chat-list.service.test.ts`, `register-chat-attachment.service.test.ts`
  - Cover chat projections and attachment metadata paths that surface document jobs or `documentLink`.

### 5.3 Web and sandbox tests

- `apps/web/app/app/_components/chat-message.test.tsx`
  - Covers chat attachment rendering, including document-specific UI affordances.
- `apps/web/app/app/assistant-api-client.test.ts`
  - Covers client payload parsing/helpers, including PPTX prepare URL behavior.
- `apps/sandbox/test/sandbox.service.test.ts`
  - Covers internal `render_html_to_pdf` and `execute_document_code` primitives.
- `apps/sandbox/test/exec-image-dockerfile.test.ts`
  - Covers document/data/python baseline packages available in the exec image.

## 6. Tests that must be created or rewritten for ADR-129

### 6.1 Tests to rewrite

- Rewrite `apps/runtime/test/runtime-document-tool.service.test.ts` around `document.extract`, `document.render`, `document.inspect`, and explicit registration/attach flow; current `pending_delivery`-first expectations should become background-exception-only.
- Rewrite `apps/runtime/test/runtime-document-provider-adapter.service.test.ts` to split visible render primitives from hidden worker generation; delete or quarantine mode-B black-box expectations.
- Rewrite `apps/runtime/test/deferred-document-acknowledgement.test.ts` to only cover background cases that still survive after the new workflow.
- Rewrite `apps/api/test/enqueue-runtime-deferred-document-job.service.test.ts` if enqueue survives; otherwise replace with explicit version-registration/render-request service tests.
- Rewrite `apps/api/test/assistant-document-job.service.test.ts` to assert workspace project path, source manifest, output path, and inspection summary instead of DB-only HTML/source snapshots.
- Rewrite `apps/api/test/assistant-document-job-delivery.service.test.ts` so normal-path delivery is driven by `files.attach` metadata/registration, not backend auto-delivery.
- Rewrite `apps/api/test/document-source-attachment-extraction.service.test.ts` so extraction writes visible sidecar files/manifest rows rather than transient `sourceFiles[]`.
- Rewrite `apps/api/test/prepare-assistant-document-pptx.service.test.ts` only if Gamma PPTX remains; otherwise delete with the feature.
- Rewrite `apps/web/app/app/_components/chat-message.test.tsx` and `apps/web/app/app/assistant-api-client.test.ts` for widened document metadata and the updated active-job model.
- Rewrite prompt/descriptor tests: `apps/api/test/runtime-tool-policy.test.ts`, `apps/api/test/seed-tool-catalog.test.ts`, `apps/api/test/bootstrap-preset-data.test.ts`, `apps/runtime/test/native-tool-projection.test.ts`.

### 6.2 New tests to add

- New API extraction-sidecar tests for `document.extract` manifest creation over PDF, DOCX, XLSX/CSV, and OCR fallback cases.
- New runtime/model contract tests for `document.extract`, `document.render`, and `document.inspect` argument/result schemas.
- New sandbox/API integration tests proving PDF render writes `/workspace/...` output and inspect sidecars without hidden worker generation.
- New XLSX inspector tests covering workbook open, sheet names/dimensions/formula counts/sample rows, blank-sheet detection, and inspect sidecar persistence.
- New DOCX inspector tests covering paragraph/headings/table counts, sample text, and empty-section detection.
- New version-registration tests proving `AssistantDocumentVersion` records workspace source manifest, output path, inspection summary, and parent linkage.
- New attach-path tests proving final delivery is `files.attach(path)` and that `documentLink` metadata survives refresh/replay after explicit attach.
- New migration-regression tests for data-document metadata drift: `create_data_document`/`xlsx|docx` legacy rows must either map cleanly during migration or be isolated from active-path assumptions.

### 6.3 Stale fixture rewrites required before closure

The following tests/fixtures still use stale pre-ADR-128 path conventions and should be rewritten when touched by ADR-129 work:

- `apps/runtime/test/runtime-document-tool.service.test.ts`
- `apps/runtime/test/turn-execution.service.test.ts`
- `apps/runtime/test/turn-context-hydration.service.test.ts`
- `apps/runtime/test/runtime-document-job-run.service.test.ts`
- `apps/runtime/test/runtime-document-provider-adapter.service.test.ts`
- `apps/sandbox/test/sandbox.service.test.ts`
- `apps/api/test/runtime-tool-policy.test.ts` comment guard for `/workspace/input` / `/workspace/outbound/self/`

## 7. High-risk invariants

- Final user-visible delivery must remain structural `files.attach` over `/workspace/...`; ADR-129 must not introduce a second document-only delivery channel.
- Workspace/file identity must stay `(workspaceId, path)`; no `fileRef`, no second file registry, no `/shared` or role-based workspace layout, no hidden alternate namespace.
- Extraction provider policy and secrets must remain API/admin-owned; runtime and sandbox must not grow direct Mistral/LlamaParse secret ownership.
- Large extracted text must become visible sidecar files, not larger prompt blobs.
- Version registration must remain durable and replay-safe even if rendering/inspection/delivery become explicit multi-step operations.
- Gamma PPTX preparation must remain idempotent if it survives; repeated clicks must not create duplicate background jobs or duplicate attachments.
- Any surviving background render path must preserve delivery honesty: no false “sent/attached/ready” claims unless the structural result exists.

## 8. Likely migration risks

- Existing document rows store useful PDF archive fields (`renderedHtml`, `structureJson`, `styleProfileJson`) but not visible workspace project snapshots; migration for legacy revise/export flows needs a clear fallback/materialization rule.
- Current delivery code narrows descriptor/output unions; any partial migration that leaves that drift in place will silently misclassify `data_document` rows.
- Web client/server type drift around active document jobs can produce UI bugs even if backend migrations succeed.
- Hidden worker assumptions are spread across runtime instructions, scheduler, delivery, and tests; deleting only one layer will leave false prompt guidance or dead paths behind.
- `execute_document_code` is a valid sandbox primitive, but keeping its current hidden “worker writes code for the main model” call pattern would violate ADR-129 even if the file outputs are correct.
- Quota and `document_render` billing facts are currently settled on backend delivery; explicit `files.attach` may require the settlement trigger to move or split.
- Security policy for attaching source/build files must remain intentional: visible workspace source files are part of the workflow, but unsafe extension handling still matters.

## 9. Docs/code contradictions discovered

1. `apps/api/src/modules/workspace-management/application/assistant-document-job-delivery.service.ts` still parses persisted delivery payloads as if only legacy descriptor modes and `pdf|pptx` output formats exist. `create_data_document` / `xlsx|docx` exist elsewhere in code and schema, so the delivery metadata path is already lossy.
2. `apps/web/app/app/assistant-api-client.ts` defines `WebChatActiveDocumentJobState` with only `pdf_document|presentation` and without `create_data_document`, while `apps/api/src/modules/workspace-management/application/web-chat.types.ts` already includes `data_document` and `create_data_document`. Server and client are out of sync.
3. Active model-facing tool text in `apps/runtime/src/modules/turns/native-tool-projection.ts` and `apps/api/prisma/tool-catalog-data.ts` still teaches the old hidden-worker mental model: auto-inline source extraction, `create_data_document` as a black-box generator, Gamma/provider-specific behavior, and async delivery-first wording.
4. Multiple current tests still use stale `assistant-media/...` storage paths or pre-flat-workspace comments for document-related fixtures, which conflicts with the post-ADR-128 `/workspace/...` contract freeze.

## 10. Proposed implementation order for Wave 1+

1. **Wave 1 - extraction first.**
   - Keep API ownership in `DocumentExtractionService`.
   - Introduce visible sidecar writing and manifest rows under `/workspace/...extract/`.
   - Do not touch version registration or delivery yet.

2. **Wave 2 - render/inspect primitives.**
   - Reuse sandbox `render_html_to_pdf` as the PDF primitive.
   - Introduce explicit inspect outputs for PDF/XLSX/DOCX.
   - Keep Gamma isolated to presentation-only audit scope.

3. **Wave 3 - version registration + metadata drift fix.**
   - Refactor `AssistantDocumentVersion` semantics around workspace project path, source manifest, output path, inspection summary.
   - Fix delivery metadata/client drift (`create_data_document`, `xlsx`, `docx`, widened `documentLink`).

4. **Wave 4 - cut normal hidden data-document worker path.**
   - Remove `create_data_document` as a model-facing black-box generation mode.
   - Keep `execute_document_code` only as a visible build primitive if still needed.

5. **Wave 5 - PDF revise from workspace source.**
   - Materialize prior source snapshot into visible project files.
   - Stop treating DB-stored HTML as the only editable source of truth.

6. **Wave 6 - prompt/catalog/web cleanup.**
   - Rewrite selection guide, descriptor text, tests, and UI wording under ADR-117 ownership rules.
   - Delete stale provider wording, stale unions, and stale path/file-identity traces in active surfaces.

7. **Wave 7 - orchestrator closure.**
   - Run full verification gate.
   - Live-validate large PDF/XLSX/DOCX create/revise/inspect/attach flows before ADR closure.

## Parent-audit checklist

- Confirm whether Gamma remains a narrow presentation-only seam or is scheduled for later replacement.
- Confirm whether any background render/export path survives after `document.render` / `document.inspect` land, or whether `pending_delivery` becomes exceptional only.
- Confirm migration strategy for legacy document versions that have DB-only PDF source truth.
- Confirm quota-settlement and `document_render` billing settlement point once final delivery becomes explicit `files.attach`.
