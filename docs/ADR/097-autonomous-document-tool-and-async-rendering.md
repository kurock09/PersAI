# ADR-097: Autonomous document tool and async rendering

## Status

Accepted

## Date

2026-05-15

## Relates to

ADR-031, ADR-052, ADR-081, ADR-082, ADR-086, ADR-087

## Context

PersAI needs one assistant-facing document tool that can create and revise user-ready PDFs and slide decks without exposing template, render-engine, layout, or provider complexity to the user.

The intended user interaction is conversational:

1. the user describes a topic, goal, questions, and preferences
2. the assistant asks for missing details when needed
3. the assistant builds structure and content
4. PersAI sends the structured request to an external document backend
5. PersAI waits for async completion
6. PersAI downloads the finished file
7. PersAI delivers a PDF or PPTX back to the user
8. later edits create a new version of the same internal document

Two provider backends are selected for v1:

- PDFMonkey for PDF rendering
- Gamma for presentations / PPTX

Existing PersAI architecture already has relevant primitives:

- ADR-081 makes `AssistantFile` / `fileRef` the canonical product file truth.
- ADR-086 proves the durable async pattern: persisted job, worker claim/run, completion framing, backend-owned delivery.
- `Admin > Tools` already stores provider API keys through encrypted PersAI-managed credential storage with step-up authorization and materialization rollouts.
- `Admin > Presets` already exposes model-facing tool prompt metadata for native tools.
- plan-managed tools already flow through tool catalog, plan activations, quota status, and runtime tool projection.

But the existing async media lane is not a document-domain model. It is shaped around image/audio/video generation, monthly media unit reservation, media delivery, and media-specific continuity. Documents need versioned source state, provider mappings, revision history, and durable document identity.

## Decision

PersAI will add one new assistant-facing tool:

- tool code: `document`
- tool class: `cost_driving`
- policy class: `plan_managed`
- quota model: monthly document tool quota
- provider keys: PersAI-managed encrypted credentials for PDFMonkey and Gamma

The tool will expose four descriptor modes inside one typed tool schema:

1. `create_pdf_document`
   - creates reports, briefs, proposals, summaries, memos, and other PDF-first documents
   - primary provider: PDFMonkey

2. `create_presentation`
   - creates slide decks and PPTX outputs
   - primary provider: Gamma
   - PersAI source JSON may carry a minimal presentation visual brief (`visualStyle`, `imagePolicy`, `visualDensity`) so Gamma receives honest typed visual intent instead of only a generic text prompt

3. `revise_document`
   - revises an existing PersAI document by `doc_id` or server-resolved recent document context
   - creates a new internal document version

4. `export_or_redeliver`
   - re-renders or re-delivers an existing version without semantic regeneration when possible
   - may export from structured source state to the requested supported output

Tool choice must come from the typed schema / descriptor mode. PersAI will not add keyword routing such as `"pitch" -> Gamma`, and will not add a separate capability-routing layer in v1.

## Domain Model

The v1 document domain should add dedicated document tables rather than extending `assistant_media_jobs`.

### `Document`

Canonical persisted document identity:

- `doc_id`
- `assistantId`
- `workspaceId`
- `userId`
- `chatId`
- `documentType`: `pdf_document` | `presentation`
- `currentVersionId`
- `status`: `drafting` | `rendering` | `ready` | `failed` | `archived`
- timestamps

`doc_id` is the stable PersAI identity. Provider ids are never user/product truth.

### `DocumentVersion`

Versioned source state:

- `version_id`
- `doc_id`
- `versionNumber`
- `parentVersionId`
- `descriptorMode`
- structured source JSON
- normalized provider input snapshot
- source summary / outline snapshot
- `status`: `draft` | `render_requested` | `rendering` | `ready` | `failed` | `superseded`
- timestamps

The structured source state is PersAI's source of truth. Final PDF/PPTX files are outputs, not source.

### `DocumentRenderJob`

Durable async render job:

- `id`
- `doc_id`
- `version_id`
- `provider`: `pdfmonkey` | `gamma`
- `outputFormat`: `pdf` | `pptx`
- `status`: `queued` | `running` | `provider_processing` | `fetching_output` | `ready_for_delivery` | `delivered` | `failed` | `expired` | `canceled`
- request payload snapshot
- provider response/status snapshot
- retry/claim fields using the ADR-091 scheduler lease pattern
- terminal error code/message
- timestamps

### `DocumentProviderMapping`

Provider reconciliation state:

- `doc_id`
- `version_id`
- provider key
- external document/render/generation ids
- latest provider status
- provider metadata

This mapping supports polling, webhook reconciliation, provider-side regeneration, and support debugging. It is not source of truth.

### `DocumentDeliveredFile`

Delivery/file truth link:

- `doc_id`
- `version_id`
- `render_job_id`
- `fileRef`
- output MIME type
- chat message / attachment ids
- deliveredAt
- current-output marker

Every delivered PDF/PPTX must be an `AssistantFile` row with a canonical `fileRef`.

### `DocumentRevisionLog`

Append-only revision trace:

- `doc_id`
- previous/new version ids
- user revision request text
- interpreted patch intent
- structured patch JSON
- provider-side edit/remix refs when used
- model/runtime provenance
- timestamps

## Source Of Truth

PersAI stores:

- stable `doc_id`
- document version graph
- structured source state
- descriptor mode and normalized tool input
- provider mappings and reconciliation state
- render job lifecycle
- revision log / patch history
- final `AssistantFile` / `fileRef` links

PDFMonkey may own:

- provider-side template/render lifecycle
- async render status
- rendered PDF object before PersAI downloads it
- provider render ids used for regeneration/reconciliation

Gamma may own:

- provider-side generation/remix lifecycle
- presentation editing/remix state
- provider deck ids used for continuity/reconciliation
- generated PDF/PPTX export objects before PersAI downloads them

PersAI does not depend on Gamma's internal web-app export endpoints for user PPTX downloads. When a user asks for editable PPTX from a PDF-first presentation, PersAI starts a separate, explicit Gamma `pptx` render through the document-job lane and treats it as a normal generated document output.

PersAI must not outsource:

- stable document identity
- user-visible version identity
- source-of-truth content model
- quota state
- chat/file delivery truth
- access control
- audit/history

## Quota Model

The `document` tool uses monthly quota, not the existing generated-media monthly quota model.

V1 rule:

- one successful `document` tool outcome consumes one monthly document unit
- if the tool/job returns a terminal error, no unit is consumed
- a successful revision that produces a new ready version consumes one unit
- re-delivery of an already ready file should not consume a unit
- re-render/export of an existing version may consume a unit if it creates a new provider render/output

This is intentionally simpler than ADR-082 media accounting:

- no media package semantics in v1
- no delivery-confirmed media settlement
- no image/video package offer logic
- no per-provider token/asset accounting

The data model should use a document-specific monthly counter keyed by workspace, subscription period, and tool code `document`, or a generalized monthly tool quota counter if implemented cleanly. The active usage definition is:

```text
monthly document usage = successful document tool outputs in the current subscription period
```

`quota_status` must include the `document` tool's monthly limit/usage so the assistant can explain availability and plan pressure from the same existing quota surface.

## Admin Tools

PDFMonkey and Gamma credentials must use the existing `Admin > Tools` pattern:

- add credential ids under the existing tool credential settings model
- store keys through `PlatformRuntimeProviderSecretStoreService`
- expose only configured state, last four characters, and updated timestamp
- update through step-up authorization
- bump config generation and create the same materialization rollout shape used by current tool credential changes

No document-provider API key should be read only from process env on the active path.

## Admin Presets

The `document` tool must be added to Prompt Constructor tool metadata:

- `TOOL_CATALOG`
- backend `PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER`
- web `PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER`
- `Admin > Presets` editable model description / usage guidance

The default model guidance must explicitly say:

- use `descriptorMode`, not keyword routing
- ask clarifying questions when required inputs are missing
- do not expose templates/render engines to the user
- do not claim a PDF/PPTX is ready until the tool returns a ready/delivered result
- use `revise_document` for edits to an existing delivered document

## Async Orchestration

Documents get a separate document-job lane.

The job flow is:

```text
runtime calls document tool
-> API validates plan/tool/quota/provider configuration
-> PersAI creates or revises Document + DocumentVersion
-> PersAI creates DocumentRenderJob
-> user receives accepted/pending response
-> document worker calls PDFMonkey/Gamma
-> worker polls or receives webhook completion
-> worker downloads final binary
-> PersAI stores object, registers AssistantFile
-> backend delivers file into chat
-> job moves to delivered
-> monthly document quota is consumed on successful tool output
```

The document worker should reuse the ADR-091 scheduler lease style. It should not run inside the ordinary chat request lifecycle after acceptance.

Completion text may reuse the ADR-086 completion-turn pattern, but the completion turn must not own job truth, quota truth, or delivery truth.

## Files And Delivery

Final document outputs are ordinary PersAI Files:

- each output is registered in `AssistantFile`
- the product handle is `fileRef`
- chat attachments project from the canonical file row
- object storage paths and provider file URLs remain internal
- previous versions stay accessible unless explicitly archived/deleted

The document domain keeps document/version truth. Files keeps binary output truth.

Because files are binary outputs of document versions, any UI/API surface that lists generated document files must project enough document metadata to avoid misleading users. At minimum, delivered document files should carry `docId`, `versionId`, `versionNumber`, and a current-output marker so the product can show quiet version state such as `vN`. The user-facing delete affordance can remain the same as for ordinary files, but the backend must translate deletion of a delivered document output into a document-domain surface action (for example archive the document and hide delivered attachments) rather than physically deleting the protected `AssistantFile` row and breaking version truth.

## Edits And Versions

User edits after delivery create new versions:

```text
user: "shorten slide 3"
-> document({ descriptorMode: "revise_document", doc_id, patchIntent })
-> PersAI loads current DocumentVersion structured source
-> PersAI applies a structured patch
-> PersAI creates DocumentVersion N+1
-> PersAI uses Gamma/PDFMonkey provider capabilities where useful
-> PersAI renders/downloads/delivers a new AssistantFile
```

A patch is domain-level, not a binary file diff:

- replace section
- add block
- shorten slide
- change tone
- reorder outline
- update conclusion
- add risk section

Provider-side remix/edit should be used where it improves output quality, but PersAI must keep a normalized version snapshot and provider-output outline summary to reduce drift.

If a patch target is ambiguous, the assistant should ask a clarifying question instead of guessing from keywords or stale provider structure.

## Sandbox

Sandbox is not required for v1.

V1 document generation does not need local process execution, filesystem mutation, or custom local rendering. PersAI sends structured payloads to external providers and persists the returned binary.

Sandbox may be reconsidered later for:

- PDF merge/split/compress/watermark
- local validation or conversion
- chart/table generation from uploaded data files
- provider fallback rendering
- post-processing that demonstrably requires isolated execution

## Implementation Shape

### Phase 1: Control-plane and settings foundation

- add `document` to tool catalog and plan activation paths
- add PDFMonkey/Gamma credential ids to `Admin > Tools`
- add Prompt Constructor metadata for `document`
- extend quota status with monthly document quota

### Phase 2a: Domain model and enqueue foundation

- add document/version/render-job/provider-mapping/delivered-file/revision-log persistence
- add internal document enqueue boundary that creates persisted `Document` + `DocumentVersion` + `DocumentRenderJob`
- keep dual PDFMonkey/Gamma credential materialization truthful under one logical `document` tool
- extend internal monthly tool quota reserve/mutate parsing to accept `document`
- keep revision/redelivery execution honestly blocked until real version-graph execution exists

### Phase 2b: Worker execution foundation

- add document worker with scheduler lease pattern
- add provider adapter interfaces
- wire success-only quota settlement from document job outcome
- register delivered binaries through `AssistantFile`

### Phase 3: PDFMonkey PDF flow

- implement `create_pdf_document`
- persist output as `AssistantFile`
- deliver into chat
- consume monthly document quota on successful output

### Phase 4: Gamma presentation flow

- implement `create_presentation`
- persist PPTX output as `AssistantFile`
- deliver into chat
- consume monthly document quota on successful output

### Phase 5: Revision flow

- implement `revise_document`
- store structured patches and new versions
- persist merged next-version source truth as the render input snapshot, not only the raw revision patch request
- use provider-side regenerate/remix where useful
- preserve old versions and delivered files
- preserve the previous ready current version when a non-current revision fails during worker or delivery finalization

### Phase 6: Export/redelivery and continuity polish

- implement backend-only `export_or_redeliver` on top of persisted `doc_id` / version / delivered-file truth
- reuse already delivered file truth without new quota consumption when honest redelivery is possible
- make any new provider-side export/re-render path explicit in job/version/quota semantics instead of hiding it behind plain redelivery
- expose active document jobs in chat/bootstrap continuity
- add focused tests and admin/operator visibility
- document webhook/polling operational behavior

## Landed Checkpoints

### 2026-05-15 — Phase 2a foundation landed locally

- added dedicated Prisma document-domain persistence for `AssistantDocument`, `AssistantDocumentVersion`, `AssistantDocumentRenderJob`, `AssistantDocumentProviderMapping`, `AssistantDocumentDeliveredFile`, and `AssistantDocumentRevisionLog`
- added an internal API enqueue boundary for deferred document jobs that persists document/job truth without claiming provider execution exists yet
- fixed materialization so the single logical `document` tool keeps both PDFMonkey and Gamma credential refs instead of overwriting one provider with the other
- extended internal monthly tool quota mutation parsing so `document` can use the same generalized monthly tool quota counter path
- intentionally kept `revise_document` and `export_or_redeliver` enqueue execution blocked until a real stable-`doc_id` version-graph execution path exists

### 2026-05-15 — Phase 2b worker execution foundation landed locally

- added a dedicated `document_job` scheduler lane that claims `AssistantDocumentRenderJob` rows directly instead of reusing `assistant_media_jobs` as document-domain truth
- added runtime/API `document` job run contracts plus internal `api -> runtime` and `runtime -> api` scaffolding for worker execution
- added a document provider adapter boundary that resolves the materialized PDFMonkey/Gamma credential chain honestly and returns explicit `not_implemented` provider state instead of fake success while real provider execution is still missing
- wired `ready_for_delivery -> delivered` through the existing chat attachment + canonical `AssistantFile` delivery seam and now persist document-domain delivery truth in `AssistantDocumentDeliveredFile`
- added a success-only monthly document quota consume path so `document` does not spend units at enqueue time and terminal execution/delivery failure does not consume quota
- intentionally kept model-visible execution closed: the worker foundation now exists, but provider-specific PDF/PPTX rendering is still not implemented, so jobs fail honestly instead of pretending the end-to-end path is ready

### 2026-05-15 — Phase 2b production hardening landed locally

- hardened the `document_job` worker so stale/lost claims no longer overwrite terminal job/version/document truth during retry, failure, or ready-for-delivery transitions
- hardened the delivery path so recovery first reuses the existing completion message + canonical attachment rows when those rows already exist, instead of attempting another external delivery; partial artifact recovery now stays in retryable `ready_for_delivery` truth instead of claiming success
- made `AssistantDocumentDeliveredFile` persistence idempotent per render job / delivered `AssistantFile`, so retry/reclaim does not duplicate delivered-file truth
- aligned success-only quota settlement ordering with durable success truth: monthly `document` usage is consumed before the final `delivered` transition, and if quota settlement is temporarily unavailable the job stays in `ready_for_delivery` recovery instead of claiming terminal success early
- added an explicit ambiguous-settlement guard for the post-delivery crash/retry window: once quota settlement has been entered, retries do not attempt another monthly consume blindly; they move the job into `document_quota_settlement_ambiguous` recovery truth until the exact settlement result can be reconciled honestly
- kept rollout honesty unchanged: model-visible execution is still closed, provider rendering is still not implemented, and no fake completion / no fake delivered state / no fake quota settlement is introduced

### 2026-05-15 — Phase 3 PDFMonkey-first provider path landed locally

- implemented the first real provider-backed `document` execution path for `create_pdf_document`: the runtime document worker now calls `provider-gateway`, `provider-gateway` resolves the PDFMonkey secret through PersAI internal secret resolution, and PDFMonkey returns a real generated PDF instead of `not_implemented`
- runtime now persists the generated PDF through the existing canonical `AssistantFile` / runtime-output object-storage seam, so delivered document truth still flows through `AssistantDocumentDeliveredFile` and ordinary chat attachment delivery instead of provider URLs becoming product truth
- kept PersAI as the source of truth for `doc_id`, version/job state, quota settlement, and delivery state: PDFMonkey only provides render execution + operational metadata (`documentId`, template id, preview/download URLs, status), while terminal success still depends on PersAI-side artifact persistence and delivery
- kept rollout honesty and scope discipline: model-visible `document` execution is still closed, and no fake generic template system was introduced; the initial PDFMonkey path stayed intentionally narrow and required an operator-owned template id for the active rollout

### 2026-05-15 — Phase 3 production hardening and truth alignment landed locally

- closed the known-invalid acceptance gap for the narrow PDFMonkey-first rollout: `create_pdf_document` is now rejected at enqueue/admission time when the required operator-owned PDFMonkey template id is not configured, instead of accepting a job that the system already knows cannot run truthfully
- hardened the provider failure contract so deterministic PDFMonkey failures are no longer misclassified as transient infrastructure retries: provider/config/auth/validation 4xx errors now propagate explicit `retryable: false` + provider failure metadata through `provider-gateway` -> `runtime` -> `api` and terminate the render job honestly instead of churning retries
- preserved provider operational truth on terminal failure as well as success: `AssistantDocumentRenderJob.providerStatusJson` and `AssistantDocumentProviderMapping.providerMetadataJson` now keep provider-side status / error metadata on failure instead of collapsing to `{ errorCode, errorMessage }` only
- landed operator-owned persisted template truth for the narrow first PDFMonkey rollout: the PDFMonkey template id now lives in PersAI-owned `Admin > Tools` configuration, materializes into the assistant runtime bundle, and is consumed by the runtime document worker as control-plane truth instead of hidden per-request metadata
- kept rollout honesty explicit: this slice still does **not** open model-visible `document`, and does **not** claim existing-document revision/redelivery readiness before those real paths exist

### 2026-05-15 — Phase 4 Gamma presentation flow landed locally

- implemented the first real provider-backed `create_presentation` path for the backend-only document rollout: runtime now routes Gamma-backed presentation jobs through `provider-gateway` instead of returning `not_implemented`
- added a real Gamma provider client in `provider-gateway` that creates async generations, polls until terminal completion, downloads the exported `pptx`, and returns truthful provider metadata (`generationId`, `gammaId`, `gammaUrl`, `exportUrl`) plus the delivered file bytes
- expanded the shared document-generation contract from PDFMonkey-only `pdf` responses to honest dual-provider result/request shapes: PDFMonkey remains `pdf`, Gamma now returns `pptx`
- runtime now persists Gamma PPTX output through the same canonical runtime-output object-storage + `AssistantFile` seam as PDF documents, so the API delivery/quota path stays provider-agnostic and PersAI remains the source of truth for delivered-file state and quota settlement
- opened backend admission for `create_presentation` now that the Gamma path is real, while keeping model-visible `document`, `revise_document`, and `export_or_redeliver` closed until their own execution paths exist

### 2026-05-16 — Gamma presentation visual-contract hardening landed locally

- closed the next bounded `create_presentation` quality gap without redesigning the document architecture: PersAI now has a minimal typed presentation visual contract on the active path (`visualStyle`, `imagePolicy`, `visualDensity`) instead of relying on Gamma to infer visual richness from a mostly text-only prompt blob
- made that contract honest across descriptor/runtime truth: the model-visible `document` tool schema, persisted `AssistantDocument` source JSON, runtime/API document-job contracts, enqueue parsing, revision/export source normalization, and provider-gateway request types now all carry the same optional presentation-only fields
- changed Gamma request shaping from a thin `inputText + themeAccent` fallback into real docs-backed parameter mapping: runtime/provider-gateway now derive `textOptions`, `imageOptions`, `additionalInstructions`, `numCards`, `cardSplit`, and `cardOptions.dimensions` from the typed PersAI visual brief plus the existing prompt/instructions/outline context
- set the bounded product default toward more visual decks when the assistant does not specify a visual brief: `create_presentation` now defaults to a visual-forward path (`visualDensity=visual_heavy`, image-rich Gamma image sources unless the assistant explicitly requests `text_only`) instead of silently degrading to text-heavy slides
- kept scope discipline explicit: no new slideshow-planner subsystem, no user-upload image injection, no Gamma theme-management surface, and no unrelated PDF-flow redesign were added in this slice

### 2026-05-15 — Phase 4 verification alignment landed locally

- cleaned up the remaining stale monthly-media naming drift in the API test contracts after the generalized monthly-tool quota rollout: the active repo truth is `resolveAssistantMonthlyToolQuotaSnapshot` / `monthlyToolQuotas`, not the removed monthly-media helper names
- restored honest repo verification after that contract alignment: local `corepack pnpm run test` is green again and the remaining ADR-097 gaps are product/workflow gaps, not known stale-test fallout

### 2026-05-15 — Phase 5 backend `revise_document` closure landed locally

- opened the backend-only `revise_document` path for valid existing `doc_id` values within the same assistant/chat boundary: API now resolves the current document/version context, creates `version N+1`, records an `AssistantDocumentRevisionLog`, and enqueues the revision through the already-real PDFMonkey/Gamma provider-backed execution path
- forward the real `revise_document` descriptor mode through the scheduler/runtime boundary instead of collapsing every persisted document request back to create-only execution
- persist the merged next-version source state into the render-job request snapshot so runtime/provider execution renders the actual intended successor version instead of only seeing the raw patch request
- promote a revised version to `AssistantDocument.currentVersionId` only after successful artifact delivery plus success-only quota settlement
- preserve the previous ready current version when a non-current revision fails during scheduler terminal-failure handling or delivery finalization instead of incorrectly collapsing the whole document to failed
- keep rollout honesty explicit: `export_or_redeliver` and model-visible `document` execution are still intentionally closed

### 2026-05-16 — Live follow-up hardening for real PDF content and completion truth landed locally

- replaced the PDFMonkey debug-draft path in runtime with a bounded content-generation step: `create_pdf_document` no longer sends a technical HTML page that dumps prompt/instructions/source-message truth, and now generates real user-facing HTML content before calling PDFMonkey
- added an explicit invalid-output gate on the returned PDF path: empty, debug-only, or obviously junk/service PDFs now fail the render job honestly instead of being persisted and delivered as if they were successful document outputs
- added a dedicated runtime/API document completion-framing seam so final document-job delivery text can be LLM-authored from bounded current chat context instead of defaulting to the generic `Your document is ready.` fallback
- kept ADR-097 async ownership intact: the worker still owns render execution, delivery still happens later through the persisted document-job lane, and the completion-framing turn does not become the source of truth for job state, quota, or file delivery

### 2026-05-17 — Attachment ingestion attachment text-extraction landed locally

- text-eligible attachments (`text/*`, `json`, `xml`, `yaml`, `ndjson`) attached to the user message that triggered the document call are now downloaded by the runtime worker and inlined into the HTML generation prompt as `sourceFiles[].text`, so rebuild/restyle/translate-from-attachment requests no longer force the model to invent placeholder content
- binary `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document` attachments are now extracted to inline text directly inside the document worker via `pdf-parse` (already a runtime dep, also reused by PDF validation) and `mammoth` (newly added), so the model never has to round-trip binary files through the sandbox `files.read` path; a 1 MB raw-payload cap protects the worker from oversized scanned PDFs and surfaces a structured "above the cap" note instead
- corrupt / encrypted / scanned-only / unsupported binaries surface as `text: null` with a structured `note` explaining the blocker (parser error, image-only document, etc.) so the model can ask the user for a smaller / OCR-ed / unencrypted version or a textual paste, rather than crashing the worker or pretending it read the file
- Gamma/PPTX worker attachment ingestion, image orchestration in PDFMonkey (so user-attached images become `<img>` tags in the rendered PDF), and a defensive `files.read` UTF-8/NUL-byte hardening pass on the sandbox path remain explicit bounded follow-ups, not part of this slice

### 2026-05-17 — Shared API document source extraction pipeline landed locally

- superseded the temporary runtime-owned source attachment extraction described above with a clean API-owned shared extraction core: `DocumentExtractionService` now owns local text-like extraction, local PDF parsing via the current `pdf-parse` API, local DOCX extraction via `mammoth`, extraction quality scoring, Mistral OCR default provider execution, LlamaParse high-quality fallback, provider trace, and metadata
- kept Knowledge behavior-compatible by leaving `KnowledgeDocumentProcessorService` as a facade over the shared extraction service; Knowledge indexing/chunking/vector persistence and user KB save semantics remain owned by the existing Knowledge pipeline and were not broadened
- changed the API document-job worker boundary so transient generation attachments are extracted in API before runtime execution and forwarded as `RuntimeDocumentJobRunRequest.sourceFiles[]`; these attachments are not persisted into user KB unless the user explicitly saves them through Knowledge flows
- cleaned runtime source handling: `RuntimeDocumentProviderAdapterService` no longer parses source PDF/DOCX attachments, no longer depends on `mammoth`, and no longer knows document-processing provider secrets; it consumes API-extracted `sourceFiles[]`
- closed the PDFMonkey/Gamma asymmetry: PDF HTML generation and Gamma presentation generation now both receive the same extracted source text/notes
- kept generated-PDF validation local to runtime because it validates provider output, not source extraction; image placement/orchestration remains out of scope

### 2026-05-17 — Previous attachment rebuild routing fix landed locally

- fixed the live "previous attachment #1" rebuild failure where a follow-up turn created a PDF job without `sourceUserMessageAttachments`, causing the generated PDF to style the user's request instead of the uploaded source document
- runtime now exposes current plus recent ready user-uploaded text/PDF/DOCX-like attachments to the `document` tool as document source candidates; previous attachments are forwarded only when the prompt/user text explicitly references a previous/attached/source file
- if the model selects `revise_document` for an attached source-file alias or other non-UUID `docId`, runtime treats that as new document creation from source attachments instead of asking API to revise a non-existent PersAI document

### 2026-05-24 — Long-document chunked generation + sticky HTML persistence landed locally

Single-shot vs chunked routing decision:
- made ONCE before any LLM call; if `sourceFiles[]` exist AND total inlined source text > 20 KB (`LARGE_DOCUMENT_SOURCE_THRESHOLD_BYTES`), route to chunked; otherwise single-shot
- one explicitly-allowed re-route: single-shot output that is structurally truncated (no `</body>`/`</html>` AND body text below threshold) logs `[document-pdf-single-shot-truncated]` and switches to chunked once; this counts as one wasted attempt; no other cross-route switch is allowed
- no keyword or prompt-text heuristics

Chunked pipeline (outline → style anchor → sequential section generation → assembly):
- **Outline call (1 LLM call):** strict JSON envelope `{ mode: "document_pdf_outline", sections: [{ heading, intent, expectedLength }] }`; invalid/empty outline fails the job with `document_pdf_outline_invalid`, no fallback
- **Style anchor (no LLM call):** synthesized in worker from `prompt + instructions + persona.displayName + userContext.locale`; identical verbatim in every section call
- **Section generation (sequential, 1 LLM call each):** each call gets style anchor, full outline, current/total position, proportional source-text slice (simple v1 weight split: short=1, medium=2, long=3), and tail summary of prior sections (≤1500 chars); model returns HTML fragment only (no DOCTYPE/html/body wrappers); parallel calls are explicitly forbidden per this ADR to prevent style drift
- **Assembly:** concatenate fragments → wrap in `<!DOCTYPE html><html><head>...</head><body>...</body></html>` → run through existing `repairHtmlDocument` (parse5 + CSS inject + thead promotion) → send to PDFMonkey

Sticky HTML persistence:
- `AssistantDocumentVersion.renderedHtml TEXT` added via Prisma migration `20260524000000_adr097_persist_rendered_html`
- worker returns `renderedHtml` in `RuntimeDocumentJobRunResult`; scheduler persists it to `AssistantDocumentVersion` when transitioning to `ready_for_delivery`
- applies to both single-shot and chunked-assembled HTML
- no retroactive backfill; Slice 2 will reject patch-revise of versions without `renderedHtml` with an honest error

Output-token ceiling:
- `DOCUMENT_HTML_MAX_OUTPUT_TOKENS = 16_000` removed; effective ceiling = `min(bundle.modelSlots[slot].maxOutputTokens, DEFENSIVE_OUTPUT_TOKEN_CAP=64_000)`
- applies to both single-shot and per-section calls

Timeout:
- single-shot keeps `DEFAULT_DOCUMENT_TIMEOUT_MS` (6 min)
- chunked uses `CHUNKED_DOCUMENT_TIMEOUT_MS = 15 * 60 * 1000`

No presentations impact, no PDFMonkey API surface change, no legacy backfill, no revise_document business logic changed (Slice 2 territory).

### 2026-05-24 — Slice 3 hardening landed locally

Addresses two production observations from `persai-dev` manual test.

**Gap A — Timeout → chunked re-route:**
- `ProviderGatewayTimeoutError` (typed) replaces generic `ServiceUnavailableException` for timeout cases in `ProviderGatewayClientService`
- `RuntimeDocumentProviderAdapterService` catches `ProviderGatewayTimeoutError` on single-shot attempts → flips `useChunked`, logs `[document-pdf-single-shot-timeout]`, counts attempt against retry budget (parallels existing truncation re-route)
- Chunked pipeline `ProviderGatewayTimeoutError` → fails job with `document_pdf_chunked_timeout`, no re-route
- `ProviderGatewayTextGenerateRequest.timeoutMsHint` (optional `number`) extends runtime contract; worker passes `240_000ms` for `document_html_generation`, `document_pdf_outline`, `document_pdf_patch_revise`; provider clients use `max(default, hint)` capped at `600_000ms`; gateway validates at `assertValidRequest`; `document_pdf_section_generation` keeps default 90s

**Gap B — Contextual revise hint:**
- `AssistantDocumentJobReadService.listRecentChatPdfsForTurn()`: queries up to 3 `pdf_document` rows with `currentVersion.renderedHtml IS NOT NULL` and `updatedAt >= createdAt of N-th most recent message` (N=10); ordered by `updatedAt DESC`
- Result flows through `RuntimeTurnRequest.recentChatPdfs` (new contract field `RuntimeRecentChatPdf[]`)
- `TurnExecutionService.buildRecentChatPdfsHintSection()` injects `RECENT PDFS IN THIS CHAT (server-resolved, not user-typed)` block into developer section when document tool is in scope and list is non-empty; zero-cost when list is empty
- `native-tool-projection.ts` descriptor: one sentence added reinforcing `revise_document` preference when developer hint lists PDFs
- NO keyword routing on user message; NO server-side reject of `create_pdf_document`

### 2026-05-24 — Patch-revise loop for PDF documents landed locally

`revise_document` for PDF is now an honest patch-edit on top of `AssistantDocumentVersion.renderedHtml` persisted by Slice 1.

Key properties:
- One LLM call per revise job using new `document_pdf_patch_revise` classification; model returns a strict JSON envelope `{ mode: "document_pdf_patch_revise", patches: [{ search, replace }] }`
- Each `search` block must match the previous HTML **exactly once** — non-empty, found at least once, found exactly once. Violation → job fails with `document_pdf_patch_revise_search_not_found` / `document_pdf_patch_revise_search_ambiguous`; no retry, no fuzzy match
- Patches applied sequentially with `String.replace` (first match, guaranteed unique); result passes through existing `repairHtmlDocument`; output HTML persisted to new `AssistantDocumentVersion.renderedHtml`
- Malformed JSON envelope → `document_pdf_patch_revise_invalid_envelope`; no fallback
- Silent `revise_document → create_pdf_document` fallback removed from `RuntimeDocumentToolService.resolveEffectiveDescriptorMode`; PDF revise without a valid docId now routes as `revise_document` and the API resolves via `findLatestRevisionContextForChat` or returns honest `revise_document_requires_existing_pdf`
- Legacy versions with `renderedHtml === null` rejected at enqueue time with `document_revise_unsupported_legacy_version`; no silent full-regeneration fallback
- Single placeholder message "Applying edits…" / "Применяю правки…" via existing delivery service
- Timeout: `DEFAULT_DOCUMENT_TIMEOUT_MS` (6 min) — no chunked budget needed
- Presentations / Gamma path entirely untouched

## Implementation Shape

### Phase 7: Long-document chunked generation

- `RuntimeDocumentProviderAdapterService` owns the entire chunked pipeline: routing decision, outline call, style-anchor synthesis, sequential section generation, assembly, and `repairHtmlDocument` pass
- `RuntimeDocumentJobRunResult.renderedHtml` carries the exact post-repair HTML for persistence
- `AssistantDocumentJobSchedulerService.processQueuedJob()` persists `renderedHtml` to `AssistantDocumentVersion` inside the same `ready_for_delivery` transition transaction
- `AssistantDocumentVersion.renderedHtml` is the enabler for patch-revise (Slice 2): Slice 2 reads this field to avoid a full re-generation and rejects revisions of versions without it with an honest explicit error
- Progress milestones ("Outline ready", "Section K of N", "Assembling PDF") are emitted as structured log lines with localized text; live in-chat progress updates require a progress-callback endpoint that is Slice 2+ infrastructure

### Phase 10: Cross-chat revise via file_ref (ADR-097 Slice 4)

**Commit:** `ADR-097 Slice 4 — cross-chat PDF revise via file_ref`

The read crosses chats; the write stays chat-local.

- **`file_ref` on `revise_document`:** Model may now pass `fileRef` (an `AssistantFile.id`) instead of `docId` on a `revise_document` call. The API resolves it via `AssistantDocumentDeliveredFile.assistantFileId` → `AssistantDocument` → latest `AssistantDocumentVersion`, reads `renderedHtml`, and feeds the existing Slice 2 patch-revise loop. The new `AssistantDocumentVersion` is created in the **current chat** with `parentVersionId` pointing to the cross-chat ancestor. `AssistantDocument.chatId` is NOT changed.
- **Security:** `AssistantDocumentJobService.findRevisionContextByFileRef()` filters on `AssistantFile.assistantId === currentAssistantId`. Workspace-only scoping is explicitly rejected. Cross-assistant `fileRef` returns `revise_document_file_ref_not_found`.
- **Latest-version semantics:** Uses `AssistantDocument.currentVersionId` (canonical latest version), NOT the version pinned by the delivered file row (which may be stale after subsequent revisions).
- **Mutual exclusivity:** Passing both `file_ref` and `doc_id` → `revise_document_ambiguous_source`. Passing neither → existing `revise_document_requires_existing_pdf` path.
- **Three new typed errors:** `revise_document_file_ref_not_found`, `revise_document_file_ref_not_a_pdf_document`, `revise_document_ambiguous_source`.
- **Existing guards:** `document_revise_unsupported_legacy_version` fires on the cross-chat path when `renderedHtml` is null on the latest version. No silent fallbacks.
- **Explicit non-change:** `listRecentChatPdfsForTurn` stays per-chat. Cross-chat PDF visibility is already handled by ADR-100 follow-up (`discoveredFileRefIds` + Working Files + token-aware `files.search`). Adding a second cross-chat hint would duplicate that infra.
- **Files changed:**
  - `packages/runtime-contract/src/index.ts` — `fileRef` in `RuntimeDocumentJobRunRequest.directToolExecution.request`
  - `apps/runtime/src/modules/turns/runtime-document-tool.service.ts` — parse + thread `fileRef`; `resolveEffectiveDescriptorMode` updated to treat valid `fileRef` as confirmed revise intent
  - `apps/api/src/modules/workspace-management/application/assistant-document-job.service.ts` — `findRevisionContextByFileRef()` new method
  - `apps/api/src/modules/workspace-management/application/enqueue-runtime-deferred-document-job.service.ts` — `fileRef` on `DocumentDirectToolExecutionPayload`; new `enqueueRevisionByFileRef()` + `resolveFileRefToRevisionContext()` private methods; ambiguity check in `execute()`
  - `apps/runtime/src/modules/turns/native-tool-projection.ts` — `fileRef` field added to schema; `docId`/`file_ref` descriptions updated
- **Tests added:** `apps/api/test/enqueue-runtime-deferred-document-job-file-ref-resolver.service.test.ts` (9 cases: cross-chat happy path, same-chat happy path, cross-assistant security, non-existent ref, non-PDF document, legacy-version null HTML, ambiguous source, neither-field fallback, secondary type guard)

### Phase 11: Cross-chat recent-PDFs hint + descriptor sharpening (ADR-097 Slice 5)

**Production diagnostic that motivated this slice:**

After Slice 4 shipped (`5ead1632`), DB inspection showed 4 revise jobs across 4 hours all with `fileRef = null` and `docIdReq = "last generated file"`. The model had the `fileRef` schema field but kept passing aliases (`"last generated file"`, `"previous attachment #1"`, `"current attachment #1"`) instead of UUIDs. Error: `file_alias_not_found`. Root cause: descriptor-level — the model had no server-resolved UUID anchor for cross-chat documents since `listRecentChatPdfsForTurn` (Slice 3) only covered the current chat.

**Fix 1 — Assistant-scope recent-PDFs hint:**

- `AssistantDocumentJobReadService.listRecentAssistantPdfsForTurn()`: new method querying `AssistantDocument` filtered by `assistantId` (not `chatId`) with `documentType = "pdf_document"`, `currentVersionId IS NOT NULL`, `currentVersion.renderedHtml IS NOT NULL`; ordered by `updatedAt DESC`; cap 6; includes `AssistantDocumentDeliveredFile.assistantFileId` (= `fileRef`) and `deliveredAt`. Per-chat `listRecentChatPdfsForTurn` kept intact for backwards compat.
- `RuntimeRecentChatPdf` extended with three optional fields: `fileRef?: string` (the UUID the model must use), `chatRef?: "current_chat" | "other_chat"`, `relativeAge?: string` (short human-readable age, e.g. `"5 min ago"`, `"3h ago"`, `"yesterday"`).
- All 5 API entry points updated: `stream-web-chat-turn.service.ts` (was already calling `listRecentChatPdfsForTurn` — switched), `send-web-chat-turn.service.ts` (new call added), `send-native-web-chat-turn.service.ts` (new `recentChatPdfs` field on `SendNativeWebChatTurnInput`), `handle-internal-telegram-turn.service.ts` (new `AssistantDocumentJobReadService` dependency + call), `send-native-telegram-turn.service.ts` (new `recentChatPdfs` field on `SendNativeTelegramTurnInput`). Each entry point computes `chatRef` and `relativeAge` before passing the list.
- `TurnExecutionService.buildRecentChatPdfsHintSection()` updated to new format: header `RECENT PDFS YOU CAN REVISE (server-resolved, not user-typed):`, each row `fileRef: <uuid>  filename: <name>  origin: <chatRef>  age: <relativeAge>`, followed by explicit anti-alias warning: "Do NOT use aliases like 'last generated file' or 'recent file #N' as fileRef values — those resolve elsewhere and will fail."

**Fix 2 — Descriptor sharpening:**

- `native-tool-projection.ts` `fileRef` field description replaced with: "fileRef MUST be a UUID — the exact `fileRef` value returned by `files.search`/`files.read` response items, or the `fileRef:` value listed in the `RECENT PDFS YOU CAN REVISE` developer-block section. Example valid value: `\"abc12345-0000-4000-8000-deadbeef1234\"`. Aliases such as `\"last generated file\"`, `\"recent file #1\"`, `\"previous attachment #1\"`, or `\"current attachment #1\"` are NOT valid fileRef values — they belong to different resolution paths and will fail with `file_alias_not_found`. Mutually exclusive with `docId`; do not pass both."
- All `file_ref` (snake-case) references in the supporting description text replaced with `fileRef` (camelCase) to match the field name. Added sentence: "When the developer-block lists fileRefs in RECENT PDFS YOU CAN REVISE, prefer revise_document with one of those fileRef UUIDs over create_pdf_document."

**Fix 3 — Guardrail check (no code change):**

Verified that `docIdReq = "last generated file"` magical alias still fires as a fallback AFTER `fileRef` and `docId` paths in `enqueue-runtime-deferred-document-job.service.ts`. The existing routing handles this correctly; no code change needed.

- `runtime-document-tool.service.ts`: added `logger.warn('[document-tool] fileRef-not-uuid')` when `fileRef` is provided but fails UUID validation — makes future debugging easier without changing any routing.

**Files changed:**

- `packages/runtime-contract/src/index.ts` — `fileRef?`, `chatRef?`, `relativeAge?` on `RuntimeRecentChatPdf`
- `apps/api/src/modules/workspace-management/application/assistant-document-job-read.service.ts` — `listRecentAssistantPdfsForTurn()` new method
- `apps/api/src/modules/workspace-management/application/stream-web-chat-turn.service.ts` — switched to `listRecentAssistantPdfsForTurn`, `computeRelativeAge` utility, new field mapping
- `apps/api/src/modules/workspace-management/application/send-web-chat-turn.service.ts` — added `listRecentAssistantPdfsForTurn` call, `computeRelativeAge`, `recentChatPdfs` in `buildNativeSyncTurnInput`
- `apps/api/src/modules/workspace-management/application/send-native-web-chat-turn.service.ts` — `recentChatPdfs` on `SendNativeWebChatTurnInput`, passed to `RuntimeTurnRequest`
- `apps/api/src/modules/workspace-management/application/handle-internal-telegram-turn.service.ts` — new `AssistantDocumentJobReadService` dep, call `listRecentAssistantPdfsForTurn`, pass `recentChatPdfs`
- `apps/api/src/modules/workspace-management/application/send-native-telegram-turn.service.ts` — `recentChatPdfs` on `SendNativeTelegramTurnInput`, passed to `RuntimeTurnRequest`
- `apps/runtime/src/modules/turns/turn-execution.service.ts` — updated `buildRecentChatPdfsHintSection` to new format with `fileRef:`, `origin:`, `age:`, anti-alias warning
- `apps/runtime/src/modules/turns/native-tool-projection.ts` — sharpened `fileRef` field description, `file_ref` → `fileRef` in tool description
- `apps/runtime/src/modules/turns/runtime-document-tool.service.ts` — `[document-tool] fileRef-not-uuid` log line

**Tests added/updated:**

- `apps/api/test/assistant-document-job-read.service.test.ts` — 5 new `listRecentAssistantPdfsForTurn` tests (multi-chat, cross-assistant exclusion, null-renderedHtml exclusion, no-file exclusion, cap at 6)
- `apps/runtime/test/turn-execution.service.test.ts` — updated existing hint tests to new format; 2 new cross-chat tests (`origin: other_chat`, `age:` field)
- `apps/api/test/stream-web-chat-turn.service.test.ts` — mock switched to `listRecentAssistantPdfsForTurn`; 3 new contract tests for new fields
- `apps/api/test/send-web-chat-turn.service.test.ts` — mock updated to add `listRecentAssistantPdfsForTurn`
- `apps/api/test/handle-internal-telegram-turn.service.test.ts` — all 9 instantiations updated with `noopAssistantDocumentJobReadService`
- `apps/runtime/test/native-tool-projection.test.ts` — 4 new assertions: `fileRef` description contains "MUST be a UUID", contains example UUID, tool description uses `fileRef` not `file_ref`
- `apps/runtime/test/runtime-document-tool.service.test.ts` — 1 new test asserting `[document-tool] fileRef-not-uuid` log when alias is passed

**Verification:** lint + format:check + 5× typecheck + 3× test suites — all PASS.

### 2026-05-24 — Bounded hotfix: retrying DB-truth revision version allocation

Addresses the first production race found after Slice 4/5 cross-chat revise reached the enqueue boundary.

- **Observed failure:** two quick `revise_document` enqueues for the same document could both allocate `versionNumber = currentVersionNumber + 1` and collide on Prisma unique constraint `assistant_document_versions_doc_version_number_key` (`doc_id`, `version_number`).
- **Root cause:** `AssistantDocument.currentVersionId/currentVersionNumber` remain delivery-promoted truth, so they intentionally lag while queued/rendering revisions already exist. Using them as the enqueue allocator source is therefore stale under concurrency.
- **Hotfix shape:** `AssistantDocumentJobService.enqueueRevision()` now reads the latest persisted `AssistantDocumentVersion` for the target `docId` inside the transaction, allocates `nextVersionNumber` from that DB truth, and uses that number for the new row. This applies to both same-chat and cross-chat revise because both paths converge on `enqueueRevision()`.
- **Concurrency behavior:** if another enqueue still wins between the read and insert, the service catches the specific Prisma `P2002` on `(doc_id, version_number)` and retries in a fresh transaction up to 3 bounded attempts, re-reading the latest version each time.
- **Explicit non-changes:** no schema change, no migration, no global lock, no change to `parentVersionId` semantics, and no change to delivery-time promotion of `currentVersionId/currentVersionNumber`.
- **Tests:** new focused `apps/api/test/assistant-document-job.service.test.ts` covers (1) allocation from latest persisted DB truth even when it is ahead of `revisionContext.currentVersionNumber`, and (2) a simulated unique-conflict retry that advances to the next free version number on the second attempt.

### Phase 9: Hardening

- **Timeout → chunked re-route (Gap A):** `RuntimeDocumentProviderAdapterService.run()` now catches `ProviderGatewayTimeoutError` (a new typed error surfaced by `ProviderGatewayClientService`) on the single-shot path. On timeout the attempt is counted against the retry budget, `useChunked` is flipped, and `[document-pdf-single-shot-timeout]` is logged. Chunked pipeline timeouts fail the job honestly with `document_pdf_chunked_timeout` (no further re-route). This is the second objective re-route signal alongside the existing truncation re-route.
- **Per-classification timeout hint (Gap A):** `ProviderGatewayTextGenerateRequest` extended with optional `timeoutMsHint?: number`. Worker passes `240_000ms` for `document_html_generation`, `document_pdf_outline`, and `document_pdf_patch_revise`. Provider clients (OpenAI, Anthropic) use `max(default, hint)` capped at `600_000ms`. Gateway validates the hint and rejects values ≤ 0 or > 600_000ms. Default 90s unchanged for non-document classifications.
- **Recent-PDFs developer hint (Gap B):** `AssistantDocumentJobReadService.listRecentChatPdfsForTurn()` queries up to 3 recent `pdf_document` rows whose `currentVersion.renderedHtml IS NOT NULL` and whose `updatedAt >= windowFloor` (the oldest of the last 10 chat messages). API layer calls this before dispatching the turn and passes the result as `recentChatPdfs` in `RuntimeTurnRequest`. `TurnExecutionService.buildRecentChatPdfsHintSection()` injects a factual `RECENT PDFS IN THIS CHAT` block into the developer section when the `document` tool is in scope and the list is non-empty. No hint when list is empty — zero prompt cost for chats without recent PDFs.
- **Descriptor reinforcement:** `native-tool-projection.ts` `document` tool description updated with one sentence: "When a developer hint lists recent PDFs in this chat, prefer `revise_document` over `create_pdf_document` for any modification to one of those PDFs. `revise_document` with no `docId` auto-resolves to the latest matching PDF in the chat."
- **No keyword routing, no hard reject:** The hint is server-resolved factual state. `create_pdf_document` is not blocked. User message text is never pattern-matched.
- **Contract changes:** `RuntimeRecentChatPdf` interface and `RuntimeTurnRequest.recentChatPdfs` added to `packages/runtime-contract/src/index.ts`.

### Phase 8: PDF patch-revise loop

- `RuntimeDocumentProviderAdapterService.runPdfPatchRevise()` is the new third generation path (alongside single-shot and chunked); triggered when `descriptorMode === "revise_document"` AND `previousVersionRenderedHtml` is present on the job request
- `PERSAI_PROVIDER_REQUEST_CLASSIFICATIONS` extended with `"document_pdf_patch_revise"`
- `RuntimeDocumentJobRunRequest.previousVersionRenderedHtml` carries the prior rendered HTML from API to worker; populated by `EnqueueRuntimeDeferredDocumentJobService` from `AssistantDocumentRevisionContext.currentVersionRenderedHtml`
- `AssistantDocumentRevisionContext.currentVersionRenderedHtml` added to both `findRevisionContext` and `findLatestRevisionContextForChat`
- `AssistantDocumentJobSchedulerService` forwards `previousVersionRenderedHtml` from `DocumentJobRequestPayload` into the runtime run request
- `AssistantDocumentJobDeliveryService` emits "Applying edits…" / "Применяю правки…" placeholder for PDF revise jobs instead of the standard "Preparing…" copy
- New error codes: `document_pdf_patch_revise_invalid_envelope`, `document_pdf_patch_revise_search_not_found`, `document_pdf_patch_revise_search_ambiguous`, `document_pdf_patch_revise_repair_failed`, `document_revise_unsupported_legacy_version`, `revise_document_requires_existing_pdf`

## Non-goals

- no user-facing template editor
- no user-facing render-engine selector
- no keyword routing
- no separate capability-routing layer in v1
- no sandbox-required v1 path
- no provider-owned PersAI source of truth
- no reuse of `assistant_media_jobs` as the document data model
- no merging Knowledge documents into the document-tool domain

## Consequences

### Positive

- Users get one simple document tool UX.
- PersAI keeps durable document/version truth.
- PDFMonkey and Gamma are used for their strengths without owning PersAI's domain model.
- Delivered files reuse ADR-081 `AssistantFile` / `fileRef` truth.
- Monthly quota can be managed like a normal plan-level product limit.
- Future provider replacement remains possible because provider ids are mappings, not identity.

### Negative

- Adds a new durable job lane.
- Adds a new monthly quota surface separate from media.
- Requires careful source-state design to avoid provider/PersAI version drift.
- Requires Prompt Constructor, Plans, quota, runtime projection, delivery, and Admin Tools changes in one coherent implementation program.

## Risks And Mitigations

- Provider lock-in: keep provider adapters behind PersAI document-domain contracts.
- Version drift: persist structured source plus provider output summaries and require clarification on ambiguous patch targets.
- Unstable edits: create new versions, never mutate prior delivered files as truth.
- Provider-side structure changes: store provider mappings and normalized outline snapshots after each render.
- Descriptor ambiguity: make `descriptorMode` required and typed; do not route from keywords.
- Delivery semantics: register `AssistantFile` before chat delivery and make delivery idempotent.
- Quota/billing ambiguity: monthly `document` units count only successful tool outputs in v1.
- UI continuity: project active document jobs separately, similar to `activeMediaJobs`, without overloading `activeTurn`.

## Open Questions

1. Should monthly document units be plan-only at first, or should paid add-on packages for documents be designed later after media package behavior proves stable?
2. Should PDFMonkey/Gamma completion use webhooks in v1, or start with polling and add webhooks after provider behavior is observed?
3. Same-format redelivery reuses persisted file truth without a new quota charge; explicit presentation PPTX preparation reuses the current version's source/request snapshot with `outputFormat=pptx`, creates a new provider render, and consumes the normal successful document quota.
4. How much structured source state is enough for v1: section/slide blocks only, or a richer document AST?
5. Should active document jobs appear as their own `activeDocumentJobs` projection or be generalized with media jobs later?
