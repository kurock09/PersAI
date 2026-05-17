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
- PPTX export object before PersAI downloads it

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
3. Should `export_or_redeliver` consume quota only when it creates a new provider render, or should all exports count?
4. How much structured source state is enough for v1: section/slide blocks only, or a richer document AST?
5. Should active document jobs appear as their own `activeDocumentJobs` projection or be generalized with media jobs later?
