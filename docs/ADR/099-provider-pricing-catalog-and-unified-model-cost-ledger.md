# ADR-099: Provider pricing catalog and unified model cost ledger

## Status

Accepted.

## Date

2026-05-20

## Relates to

ADR-082, ADR-083, ADR-084, ADR-089, ADR-092, ADR-097

## Context

PersAI already has strong product-side quota and billing truth:

- user-facing text quota is tracked through weighted token/credit accounting
- image, video, and document product limits are tracked as monthly units
- plans own user-facing limits and model selections
- admin runtime settings already own the active provider/model catalog

That is enough for product quota enforcement, but it is not enough for long-term unit economics and margin control.

Current audit findings:

1. model pricing is not the primary truth in admin runtime settings; the active UI is still a pipe-delimited profile list centered on token weights rather than on explicit provider pricing
2. interactive chat turns can emit `usageAccounting.entries`, but many cost-incurring model/provider paths are not part of one canonical cost ledger: router/helper calls, background evaluation, async completion copy, STT, embeddings, OCR/document parsing, and other provider-priced paths
3. business and ops admin surfaces do not read one unified cost truth; Business shows raw token averages from runtime receipts while Ops shows weighted user quota/credits
4. `providerPriceMetadata` exists in the typed model profile shape, but current admin/runtime flow does not treat it as the source of truth

Founder decision for this ADR:

- keep user-facing quota semantics simple and product-owned:
  - text is shown and enforced in PersAI-owned internal text units (the product may continue to call them `tokens`)
  - tools such as image, video, and document remain unit-counted for the user
- separately add a real internal cost ledger in money so PersAI can tune subscription pricing, package sizes, and margins from actual provider spend
- the first economics block should cover all provider/model-priced paths, not only visible chat replies: main chat, helper calls, router/classifier calls, background model calls, STT, image, video, and other model-priced provider paths
- non-model tool/path economics can follow as a second block after the model-priced ledger is landed

## Decision

PersAI will add a provider pricing catalog and a unified model cost ledger without replacing current product quota semantics.

Core decisions:

1. user quota and internal себестоимость are separate truths
2. `Admin > Runtime` becomes the source of truth for provider/model pricing metadata
3. every provider/model-priced call writes one immutable cost-ledger event
4. all model-priced paths use the same ledger shape whether they happen in visible chat, helper flows, background flows, or media/STT flows
5. `Admin > Business` reads aggregated average cost/margin by plan
6. `Admin > Ops` reads per-user cost/margin detail
7. plan, knowledge, and other existing product surfaces continue to choose models from one shared active model catalog

## Product and admin semantics

### User-facing quota

User-facing quota stays product-owned:

- text: PersAI internal text units
- image/video/document and similar tools: units/calls according to existing product rules

The user-facing quota layer is not the internal money ledger.

### Internal cost truth

Internal cost truth is money-first.

For every cost-incurring provider/model call, PersAI stores:

- provider
- model
- billing mode
- raw usage facts
- actual cost amount
- attribution context (workspace, assistant, user when applicable)
- purpose

This ledger is the source for margin analytics.

### Purpose attribution

Every ledger event must carry a normalized purpose so PersAI can distinguish visible chat cost from helper and background cost.

Minimum purpose set:

- `chat_main_reply`
- `chat_helper`
- `router`
- `retrieval_helper`
- `tool_helper`
- `background_task`
- `notification_generation`
- `stt`
- `tts`
- `image_generation`
- `image_edit`
- `video_generation`
- `document_generation`
- `ocr_or_document_parsing`
- `system_internal`

`system_internal` is reserved for model spend that cannot be attributed to one user/workspace and therefore belongs to platform overhead rather than user margin.

## Provider pricing catalog

### Admin surface

`Admin > Runtime` should stop using a single pipe-delimited profile textarea as the primary truth.

Target-state UI:

- model catalog table
- add/edit/archive/version actions per model card
- pricing form on each model card
- downstream model pickers still consume the same active model list

Required model-card fields:

- provider
- model
- capabilities
- billing mode
- effective from
- effective to
- active
- billing-specific price fields with exactly one active pricing branch per row matching `billingMode`

### Billing modes

The pricing catalog must support at least:

- `token_metered`
- `time_metered`
- `fixed_operation`
- `tiered_operation`

Examples:

- text model with input/cached/output prices -> `token_metered`
- STT model billed by seconds -> `time_metered`
- image/video model billed by one render/output -> `fixed_operation`
- image/video model with size/quality/duration tiers -> `tiered_operation`

### Price truth

The pricing catalog stores prices, not quota multipliers, as the primary truth.

Token/unit conversion used for user quota may still exist, but it must be derived from current pricing/business policy rather than become the only economics source of truth.

Historical price rows must be versioned by `effectiveFrom` / `effectiveTo`; old prices must not be overwritten in place because past cost events need stable replayable truth. Admin Runtime should archive rows by inactivation/date-bounding rather than hard-deleting them from the primary catalog path.

## Unified model cost ledger

### Ledger event shape

PersAI should add one immutable ledger event model for every provider/model-priced call.

Recommended persisted fields:

- `workspaceId`
- `assistantId`
- `userId`
- `provider`
- `model`
- `capability`
- `purpose`
- `surface`
- `billingMode`
- `rawUsage` JSON
- `actualCostMinor` or equivalent integer money field
- `currency`
- `priceCatalogVersion`
- `sourceEventId` / request correlation ids
- `createdAt`

### Raw usage capture

The ledger must accept heterogeneous usage shapes.

Examples:

- `token_metered`: input/cached/output/total tokens
- `time_metered`: duration seconds or milliseconds
- `fixed_operation`: operation count
- `tiered_operation`: matched tier parameters and resulting price

This is necessary because image, video, and STT provider pricing may not share the same metering shape as chat text.

### Coverage rule

The ledger must cover all provider/model-priced calls, not only visible chat replies.

The first block includes at minimum:

- ordinary web/telegram chat text generation
- helper and router/classifier model calls
- background-task evaluation model calls
- media completion/document completion copy generation
- STT
- TTS when a model/provider path is priced as such
- image generation/edit
- video generation
- document generation when provider/model pricing is applicable
- document OCR/parsing or retrieval helper model calls when the provider path is model-priced

## Business and Ops read models

### Admin > Business

`Admin > Business` should become the aggregate economics surface.

Required views:

- average cost per user by plan
- average revenue per user by plan
- average margin per user by plan
- split by cost class:
  - text/model cost
  - image/video cost
  - document cost
  - other model-priced cost

Business should not read one token metric from runtime receipts and another metric from quota state and call both “economics”. One shared ledger-backed aggregate must drive the analytics.

### Admin > Ops

`Admin > Ops` should become the per-user drill-down.

Required views:

- current plan
- current quota view
- actual cost for the current period
- revenue attributed to the user/workspace for the period
- margin for the period
- cost breakdown by provider/model/purpose

Ops remains the place for one-user support and investigation; Business remains the place for averaged plan economics.

## Execution split

### Block 1 — provider/model-priced economics

This ADR's first implementation block should cover:

- runtime model catalog redesign in `Admin > Runtime`
- provider pricing catalog
- unified model cost ledger
- business/ops surfaces for model-priced economics

Block 1 includes text, image, video, STT, and other provider/model-priced paths.

### Block 2 — non-model tool/path economics

Second block, explicitly later:

- document/tool/provider paths that are not naturally model-priced
- OCR/parsing or external APIs that need standalone cost rules
- sandbox/exec or other future non-model paid tool paths

## Execution rules for Cursor agents and subagents

1. **One bounded slice per session.** A parent agent may explore broadly, but implementation in one session must close exactly one bounded slice or one tightly coupled sub-slice from this ADR.
2. **Parent-agent control only.** Subagents may be used for readonly audit, code search, test/result collection, or parallel design comparison, but the parent agent remains the single owner of scope, edits, reconciliation, and final decisions.
3. **No parallel write tracks.** Multiple subagents must not implement different parts of the same slice in parallel. Parallelism is allowed for discovery and audit, not for competing code changes across the same source of truth.
4. **Block order is mandatory.** Do not start Block 2 work until Block 1 has landed enough provider/model catalog and ledger foundations that later tool/path economics can attach to one stable money ledger.
5. **Do not mix quota redesign into this ADR.** User-facing quota semantics remain as documented. Any agent that finds itself changing user quota units, plan marketing semantics, or payment lifecycle policy has left scope and must stop.
6. **Catalog first, consumers second.** When implementing Block 1, establish the provider pricing catalog/admin runtime truth before changing Business/Ops analytics or downstream per-path cost writes. Do not let analytics invent a second pricing source.
7. **Ledger before dashboards.** Business and Ops read models must not be implemented from temporary SQL over mixed proxy metrics once the ledger slice begins. New analytics should read from the new cost truth, even if that means a temporary smaller surface first.
8. **Historical truth must be replay-safe.** Agents must not overwrite old pricing rows in place. Any implementation slice touching pricing must preserve historical effective dates so old cost events keep stable pricing context.
9. **Attribution must be explicit.** If a model-priced path cannot yet provide `userId` or workspace attribution, the slice must write explicit `purpose`/ownership truth such as `system_internal` rather than silently dropping the cost event.
10. **If docs and code disagree, reconcile before broad edits.** The parent agent must treat this ADR, `ARCHITECTURE.md`, `API-BOUNDARY.md`, `DATA-MODEL.md`, and current repo truth as one contract. If implementation reveals a mismatch, update docs in the same slice or stop.

### Allowed subagent usage

Subagents are explicitly allowed and encouraged for:

- readonly path audits across runtime/api/provider/admin surfaces
- inventorying cost-incurring call sites
- checking where model lists are consumed in plans/knowledge/tools
- comparing candidate schema/read-model designs
- collecting focused test targets and regression risk

Subagents should return findings and proposed deltas back to the parent agent. The parent agent then chooses one bounded implementation plan and applies the edits itself.

### Recommended Block 1 session sequence

The parent agent should execute Block 1 through bounded sessions in this order:

1. **Session A — catalog foundation**
   - replace the runtime model textarea truth with structured provider/model catalog persistence and admin UI editing
   - keep downstream model selection semantics unchanged
2. **Session B — ledger foundation**
   - add unified model cost-ledger write path and canonical event shape
   - instrument only the first high-confidence provider/model-priced paths needed for end-to-end proof
3. **Session C — path expansion**
   - extend ledger coverage to helper/router/background/STT/image/video and other Block 1 model-priced paths
4. **Session D — Business/Ops read models**
   - move Business and Ops economics views onto the new ledger-backed aggregates

An agent may combine adjacent sessions only when the combined scope remains small enough to verify safely.

### Prompt for a future implementation session

```text
Continue ADR-099 provider pricing catalog and unified model cost ledger.

Read before coding:
1. AGENTS.md
2. docs/SESSION-HANDOFF.md
3. docs/CHANGELOG.md
4. docs/ADR/099-provider-pricing-catalog-and-unified-model-cost-ledger.md
5. docs/ARCHITECTURE.md
6. docs/API-BOUNDARY.md
7. docs/DATA-MODEL.md
8. docs/TEST-PLAN.md

Session rules:
- one bounded slice only
- parent agent owns all edits and final decisions
- subagents may be used only for readonly audit / search / verification support
- do not change user-facing quota semantics
- do not start Block 2 unless explicitly directed and Block 1 foundation is already landed

Current target:
- choose exactly one bounded Block 1 slice
- keep downstream model selection by active model list unchanged
- move economics toward one provider pricing catalog and one unified model cost ledger

Before ending:
- run focused checks for changed code
- run AGENTS verification gates when code/contracts changed
- update docs/SESSION-HANDOFF.md and docs/CHANGELOG.md
- state the next recommended ADR-099 slice
```

## Current code audit summary

Current repo truth relevant to this ADR (2026-05-21):

- `TrackWorkspaceQuotaUsageService` remains product quota logic; it is not the money ledger
- **Session A landed:** structured Admin Runtime provider/model catalog with versioned pricing metadata
- **Session B landed:** `model_cost_ledger_events` + `RecordModelCostLedgerService` with replay-safe deterministic ids
- **Block 1 model-priced ledger writes landed** for: ordinary web/Telegram chat (main reply + router), background-task evaluator, persisted media job + attachment billing facts (image/video/STT/TTS), retrieval-helper reranker, async media/document completion framing (`chat_helper`), standalone voice HTTP transcribe, and Mistral OCR (`ocr_or_document_parsing`)
- **Admin > Business / Ops** read compact ledger-backed aggregates with `coverageScope=adr099_block1_model_priced_paths` and an explicit coverage note
- **Still outside Block 1 ledger (honest):** provider document render jobs without model-priced billing facts (PdfMonkey/Gamma — Block 2 / non-model economics); async failure-framing LLM calls (no persisted usage); knowledge **embedding** indexing (no ledger row yet); ADR purpose stubs not yet wired (`tool_helper`, `notification_generation`, `document_generation` for external render)
- **Block 2 not started:** non-model tool/path economics attach later to the same ledger shape

## Non-goals

- do not change current user-facing quota semantics in this ADR
- do not move image/video/document user quota from units to text-like tokens
- do not redesign subscription lifecycle or payment-intent architecture
- do not merge Business and Ops into one surface
- do not make plan rows the source of provider pricing truth

## Consequences

### Positive

- PersAI gets real cost and margin truth without disturbing existing product quota semantics
- model selection remains clean because pricing truth and selection truth share one catalog
- Business and Ops can answer real pricing and margin questions from the same ledger
- future provider or model changes become catalog updates rather than quota-logic rewrites

### Negative

- provider/model-priced paths need broader instrumentation than the current visible-chat accounting
- admin runtime settings become more structured and require migration away from the textarea profile editor
- Business and Ops analytics become dependent on a new ledger and aggregate layer rather than on direct quota snapshots alone
