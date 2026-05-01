# ADR-079: Knowledge, Skills, document processing, and orchestrated retrieval

**Status:** Accepted  
**Date:** 2026-05-01  
**Relates to:** ADR-073, ADR-074, ADR-078

## Context

PersAI already has a native knowledge baseline:

- user-owned assistant knowledge uploads under `/api/v1/assistant/knowledge-sources/*`
- admin-owned global knowledge under `/api/v1/admin/knowledge-sources*`
- runtime `knowledge_search` / `knowledge_fetch` tools
- `ragMode: "hybrid"` on the active runtime knowledge contract
- retrieval observability in admin knowledge surfaces
- plan-owned retrieval budgets, helper controls, and knowledge storage limits

That baseline is useful, but it is not the target product architecture for a polished knowledge and professional-skill experience.

The current gaps are architectural, not only UI polish:

1. User KB ingestion depends on local parsers such as `pdf-parse`, `word-extractor`, and `xlsx` conversion. This is acceptable as a cheap fallback, but not reliable enough for high-quality PDF, DOC/DOCX, XLS/XLSX, scanned PDFs, tables, charts, and complex layouts.
2. Current admin `scope=skill` global knowledge is not a real product skill. It is a scope flag on global knowledge, not a user-selectable professional capability.
3. A skill must affect both behavior and retrieval. It needs a short instruction card in the runtime prompt when enabled, and it needs indexed documents available to retrieval when the turn requires knowledge.
4. The runtime router already exists and can call a fast semantic classifier. The new architecture must extend that router rather than introduce a second independent router or keyword-only trigger system.
5. Search must not become dry, rigid, or slow. Simple turns must stay fast. Professional or document-grounded turns should use knowledge only when the router semantically decides that retrieval is useful.
6. The backend must enforce policy, rights, limits, and source ordering, but it must not pretend to "think" by hard-coded profession rules.
7. The platform has no production users yet, so this block should be implemented cleanly without permanent legacy compatibility paths or half-product temporary UI.

The founder decisions captured in this ADR come from an architecture interview on 2026-05-01.

## Decision

PersAI will implement one cohesive Knowledge and Skills architecture covering:

1. first-class admin-managed Skills
2. user-controlled skill assignment
3. skill instruction cards in runtime prompt materialization
4. skill documents indexed through the same knowledge pipeline as other KB sources
5. a provider-backed `KnowledgeDocumentProcessor`
6. `pgvector`-backed vector search behind a repository abstraction
7. extension of the existing runtime router with a semantic retrieval plan
8. an orchestrated retrieval layer that prepares source-aware context for the main model
9. user-visible activity/status that explains knowledge work without exposing internal plans
10. contracts-first API and end-to-end product integration

This is a single architecture block. It may be implemented internally in ordered steps, but the product should not expose incomplete intermediate states.

## Boundary with future hybrid knowledge ingestion

ADR-079 is about how PersAI uses knowledge at runtime and how first-class Skills become a product capability. It is not the architecture for long-lived knowledge curation, web-fed knowledge bases, admin cleanup commands, source governance, or curator-LLM maintenance workflows.

Those concerns should be handled by a later architecture decision, tentatively:

- `ADR-080: Hybrid Knowledge Ingestion and Curation`

ADR-080 should own:

- web ingestion by admin query or trusted source policy
- generated and manually curated knowledge entries
- draft / verified / stale / deprecated lifecycle governance
- deduplication, merge, cleanup, and stale detection workflows
- curator / maintenance commands
- knowledge gap discovery
- trust and provenance policy beyond the runtime retrieval roles defined here

ADR-079 must still leave clean extension points so ADR-080 can be layered on top without replacing the retrieval/runtime architecture.

Implementation guidance for ADR-079:

- keep ingestion and indexing abstractions source-agnostic, not file-upload-only
- model retrieval source roles independently from physical origin
- keep document-processing status separate from future knowledge lifecycle status
- preserve source metadata/provenance hooks where they naturally belong, such as `sourceType`, `sourceId`, provider, URL/file reference metadata, creator, timestamps, trust/quality hints, and processing quality
- make the vector index operate on normalized chunks from any knowledge source, not on upload documents directly
- make observability record source role and origin metadata where available

Status distinction:

- `processing`, `ready`, `failed`, and `needs_review` describe indexing / processing state in ADR-079.
- `draft`, `verified`, `stale`, and `deprecated` describe knowledge lifecycle / governance state and belong to ADR-080 unless a narrow ADR-079 table already needs a product status such as `Skill.status`.

## Product model

### Skill

A Skill is a first-class admin-created professional capability, for example "Accountant", "Lawyer", "HR", or "Sales".

A Skill is not a prompt preset, not a tool, and not a legacy `GlobalKnowledgeSource.scope=skill` row.

The first version uses:

- `Skill`
- `SkillDocument`
- `AssistantSkillAssignment`

There is no `SkillVersion` in the first version. Admin can update or delete documents and edit the skill metadata directly.

### Required Skill fields

Admin-created Skills require:

- name
- short description
- category
- instruction card

Optional fields:

- tags
- icon / emoji / color for UI only
- localized RU/EN name, description, and instruction card

Documents are not required. A Skill can be `instruction-only` if it has no ready documents.

### Skill status

Skills have status:

- `draft`
- `active`
- `archived`

Only `active` Skills are visible for user selection.

Archived Skills:

- are hidden from new selection
- are disabled for runtime prompt and retrieval
- remain visible to users who previously selected them as disabled / archived with a human explanation
- are not hard-deleted by default

### Skill instruction card

Each Skill has one admin-edited instruction card.

The admin UI must provide:

- a clear default example when creating a new Skill
- an editable text field
- a character counter
- a bounded length, approximately 800-1200 characters

The instruction card should describe:

- the professional role or domain
- when the Skill applies
- how the assistant should use Skill knowledge
- important limits or disclaimers
- response behavior that is specific to the Skill

The instruction card is not a long handbook. Long knowledge belongs in Skill documents.

### Skill documents

Admin manages Skill documents inside the Skill detail surface:

- upload
- list
- delete
- reindex
- reprocess with high quality when needed
- edit display name / description after upload

`displayName` and `description` are not UI-only. They should be used in source metadata, retrieval ranking, snippets, and admin observability.

User-visible Skill cards show:

- name
- short description
- category / tags
- enabled state
- document count
- document readiness status: `ready`, `processing`, `some failed`, or `instruction-only`
- updated date

Users do not see or download admin Skill documents. They see document count and readiness only.

## User Skill assignment

Only the user can enable or disable Skills for their assistant.

Admin creates and manages available Skills, but admin does not silently assign Skills to a user's assistant.

### Setup and recreate

When at least one `active` Skill exists, assistant setup and recreate must show a clear optional section:

- "Professional skills" / "Навыки"
- recommended or available Skill cards
- clear text that Skills can be enabled later

Skills are not enabled automatically by default.

On recreate/reset, previously selected Skills are reset. The user chooses Skills again in the recreate flow.

### Settings

After setup, users manage Skills in:

- `Assistant Settings -> Skills / Навыки`

This is separate from ordinary user Knowledge documents.

The assistant card itself does not need a Skill summary. Skills live in Settings.

### Plan limits

The number of enabled Skills is plan-controlled.

Admin sets the allowed number of Skills per plan.

The user UI shows a counter such as:

- `2 of 3 skills enabled`

If the user reaches the limit, extra toggles are disabled with a clear plan explanation.

If a plan downgrade or admin plan change leaves the assistant over the limit:

- excess Skills are disabled
- the user receives a warning through the active assistant communication / notification channel when that mechanism is available
- the Settings UI explains why the Skill was disabled

No assignment history UI is required in the first version.

## Admin surfaces

### `/admin/skills`

PersAI will add a new admin page for Skills.

This page owns:

- Skill list
- create / edit
- status: draft / active / archived
- category and tags
- instruction card
- Skill documents
- document status and reprocessing actions

No demo or seed Skills are created. The page starts empty and admins create real Skills manually.

### `/admin/knowledge`

The existing `/admin/knowledge` page should be refocused.

It remains the admin surface for:

- retrieval observability
- Product KB
- connectors / ingestion pipeline status where applicable

It should no longer present a product concept called "Skill library". The old `scope=skill` concept should not remain active UI truth.

### `/admin/tools`

Document processor provider settings live under `/admin/tools`, in a new **Document Processing** block.

Admin can configure:

- enabled document-processing providers
- API keys
- default provider
- high-quality fallback provider
- local fallback status

API keys for Mistral OCR, LlamaParse, and future document processors use the existing PersAI admin-managed provider/secret pattern. They should not require normal runtime env vars as the primary path.

Saving keys should support lightweight validation / test connection for enabled providers.

## Document processing architecture

### `KnowledgeDocumentProcessor`

PersAI will introduce a `KnowledgeDocumentProcessor` abstraction before chunking and embedding.

It owns:

- provider selection
- extraction
- OCR / layout processing
- table/image/layout metadata where available
- quality signals
- failure reasons
- normalized text / markdown output for chunking

The local parser remains available, but it becomes a cheap fallback, not the premium target path.

### Provider policy

Provider selection is automatic. Users do not choose parser quality per upload.

The policy is:

1. Simple text-like files (`txt`, `md`, `csv`, `json`, simple structured text) may use local parsing.
2. Ordinary document files (`pdf`, `doc`, `docx`, `xls`, `xlsx`, `pptx` where supported) use the configured default document processor, initially expected to be Mistral OCR / Document AI.
3. Complex files, scanned PDFs, poor extraction results, low-confidence OCR, table-heavy files, image-heavy layouts, empty text, or broken structure escalate to the high-quality fallback provider, initially expected to be LlamaParse.
4. Admin can manually reprocess a failed or poor source with high quality.

The decision is based on file properties and extraction quality, not keyword triggers.

Signals may include:

- MIME type / extension
- file size
- estimated pages / sheets
- presence or absence of text layer
- image/table density
- provider confidence scores
- extracted text length
- repeated-character / garbage-text detection
- structure quality

### Missing provider keys

If document processor keys are missing:

- local parser fallback may still process files that it can handle safely
- complex documents fail with a clear `needs_key` / provider-unavailable status
- users see a human-readable failure reason
- admins see provider, technical code, and trace-level detail where available

The system must not silently index low-quality garbage as if extraction succeeded.

### Quality gate

If extraction remains poor after fallback:

- mark the source as `failed` or `needs_review`
- preserve the source metadata and error reason
- do not index garbage chunks

### Cost and limits

Document processing quality is not plan-degraded. Users should get the same recognition quality.

Economics are controlled by:

- existing user KB plan storage limits
- file size/page limits
- admin-only operational safety caps
- retry limits
- provider daily pages/spend guardrails where needed

These safety caps are operational protection, not a user-visible quality tier.

## Indexing jobs

Indexing must move from synchronous upload-time work to DB-backed jobs.

Upload should:

1. validate file
2. store the source object
3. create the source row
4. create an indexing job
5. return quickly with `processing` status

The queue contract should be generic enough for later ADR-080 ingestion sources. File upload is the first producer, not the only possible producer. Future producers may include web ingestion, manually curated entries, generated summaries, or admin maintenance workflows, provided they create the same normalized source + indexing job shape.

The API-owned worker processes the DB queue.

The job should support:

- status
- attempts
- retry with backoff
- provider selected
- extraction quality result
- chunk count
- embedding status
- error code and human-readable message

If the provider fails:

- retry with backoff
- use local fallback when appropriate
- otherwise fail only the affected source
- do not fail the whole queue

### Immediate chat question after upload

If the user uploads a knowledge-eligible file in chat and immediately asks about that file:

- PersAI should show activity such as "processing the file"
- wait for indexing readiness up to a reasonable timeout
- answer with indexed context when ready
- if not ready, be honest and avoid pretending the document was used

Ordinary unrelated chat turns must not be blocked by indexing.

## Vector search

PersAI will move from JSONB embedding vectors and application-side cosine ranking to a vector-index abstraction.

The production default should be:

- Postgres `pgvector`

The code must be written behind an interface such as:

- `upsertChunks`
- `deleteSource`
- `searchSimilar`

The interface accepts normalized chunk records with source identity and metadata. It must not assume the source is a file, a Skill document, or a user upload. ADR-079 producers include user uploads, Product KB, and Skill documents; ADR-080 may add web, generated, and manual curated sources.

The first implementation is:

- `PostgresPgvectorKnowledgeIndex`

This keeps the current production footprint simpler:

- same Postgres / Cloud SQL operational model
- same backup/security boundary
- fewer moving parts
- transactional consistency with source rows

The abstraction keeps a future managed vector DB possible without rewriting the RAG business logic.

## Router and retrieval plan

PersAI already has an early runtime router:

- deterministic precheck for obvious cases
- optional cheap semantic classifier using `routingFastModelKey`
- structured output with `executionMode`, `retrievalHint`, `toolHints`, confidence, and reason

This ADR extends that router. It does not introduce a second router.

### No keyword-only Skill routing

Skill routing must not be a brittle keyword map such as "tax means accounting".

The router/classifier makes a semantic decision using:

- current message
- channel and locale
- attachment summary
- conversation mode
- enabled tool hints
- enabled Skills summary
- available user knowledge state

The backend enforces policy but does not invent professional relevance through hard-coded `if/else` rules.

### Router input for Skills

The router receives a compact list of enabled Skills:

- id
- localized name
- short description
- category
- 1-2 tags

It does not receive Skill documents.

It does not need full instruction cards for all enabled Skills in classifier input.

### Router output

Extend the router output with `retrievalPlan`:

```json
{
  "useSkills": true,
  "selectedSkillIds": ["..."],
  "useUserKnowledge": true,
  "useProductKnowledge": false,
  "useWeb": false,
  "confidence": "high"
}
```

The exact schema can evolve, but the router should decide:

- whether enabled Skills are relevant
- which enabled Skills to search, normally 1-3
- whether user KB is relevant
- whether Product KB is relevant
- whether web freshness / verification is needed
- confidence

The router does not generate every search query and fetch order in the first version. Query construction and ranking remain retrieval-layer responsibilities.

### Simple turns

Simple turns must remain fast.

The router can still skip classifier calls for obvious cases such as:

- greetings
- thanks
- short continuations
- trivial chat
- turns where no retrieval-capable sources exist

Even when a Skill is enabled, Skill documents are not searched on every turn.

## Orchestrated retrieval

PersAI will add an orchestration layer that executes the router's retrieval plan.

The backend executes; it does not think.

It is responsible for:

- verifying selected Skills are enabled for this assistant
- enforcing plan limits
- enforcing source availability
- enforcing document status
- enforcing retrieval budgets
- calling retrieval indexes
- merging/reranking results
- constructing a bounded source-aware context block
- emitting observability
- emitting user-facing activity

### Retrieval source roles

PersAI must not use a rigid priority that says Skill always beats user KB, or user KB always beats Skill.

Instead, retrieval context is source-aware:

- `skill_reference`: professional standards, methods, domain norms, Skill docs
- `user_document`: user-specific files, project docs, requirements, contracts, internal rules
- `product_reference`: PersAI/product/admin knowledge
- `web_reference`: external fresh facts or links

The model should be able to compare sources. Example:

- Skill document contains the general standard.
- User document contains a project specification.
- The answer compares the user's project against the standard and explains mismatches.

### Skill selection

When multiple Skills are enabled:

- the router selects 1-3 relevant Skills
- retrieval starts with those Skills
- if results are weak, empty, or low confidence, retrieval may expand to other enabled Skills within budget

### User KB

User KB is not treated as the main encyclopedia.

It is usually personal or work-specific:

- project docs
- contracts
- requirements
- internal documents
- clarifying files

It may be retrieved together with Skill KB for comparison or grounding.

### Product KB

Product KB remains for PersAI/product/admin knowledge:

- PersAI behavior
- plans
- internal product rules
- product documentation

It is not the professional Skill library.

### Web

Web is included only when the router plan calls for it, such as:

- freshness
- external verification
- links
- prices
- current laws or regulations
- weak local KB confidence where external grounding is useful

Web should not automatically run on every professional answer.

### Retrieved context injection

Orchestrated retrieval injects context into the main model as a bounded prompt block:

- `Retrieved Knowledge Context`

This block uses source-aware labels.

It is not exposed as raw internal JSON to users.

The existing low-level `knowledge_search` and `knowledge_fetch` tools remain available to the main model within limits. They are not removed. They become low-level tools for cases where the main model needs a precise additional excerpt.

### Budgeting

Retrieved context uses:

- total budget from plan / runtime policy
- source-aware allocation
- reranker confidence
- per-source caps
- fetch window limits

It must not dump large documents into prompts.

## Prompt materialization

Enabled Skill instruction cards are part of runtime prompt materialization.

They should appear as a separate prompt block:

- `Enabled Skills`

This block should be placed after persona / Voice DNA and before tool guidance.

The block location and template must be managed through Prompt Constructor rather than hidden hard-coded text.

Prompt Constructor should gain an `Enabled Skills` template section with a placeholder for Skill cards.

If a Skill is disabled, archived, over-plan, or no longer assigned, its instruction card disappears from runtime prompt materialization.

Instruction-only Skills still contribute their instruction card but do not attempt Skill document retrieval.

## Runtime activity and user transparency

PersAI already has activity/badge surfaces for tools and knowledge work. This ADR reuses those surfaces.

Do not add a separate citation-heavy UX as the default.

Activity copy should be human:

- "Checking skill: Accountant"
- "Reviewing your documents"
- "Adding web grounding"
- "Processing the file"

Users do not see the internal retrieval plan.

Detailed references/citations may be expanded later, but the first target is calm, understandable activity and honest answer text.

## Observability

Admin observability should capture enough to improve quality without storing excessive sensitive prompt/chunk data.

Log:

- router retrieval plan
- selected Skill ids
- selected source classes
- whether Skill/User/Product/Web was used
- latency by phase
- result counts
- empty result rate
- fallback / web usage
- provider selected for document processing
- extraction quality outcome
- indexing failures and reason codes

Do not log full prompts and full chunks by default.

## Contracts and APIs

This feature is contracts-first.

Add OpenAPI contracts and generated clients for:

- admin Skill CRUD
- admin Skill status changes
- admin Skill document upload/list/delete/reindex/reprocess
- user assistant Skill list
- user Skill assignment toggle
- Skill limits and status projection
- document processor settings under admin tools
- indexing status where needed

The web app should use generated clients for new Skill APIs.

The old admin knowledge handwritten fetch style should not be copied into the new Skills surface.

## Legacy and cleanup

There is no permanent compatibility promise for the existing admin `GlobalKnowledgeSource.scope=skill` product concept.

The implementation may reuse technical storage patterns or tables if clean, but active product truth must become the first-class Skill model.

Rules:

- no user-visible "legacy Skill library"
- no old `scope=skill` active UI
- no runtime dependency on the old scope as the product Skill model
- historical migrations may remain historical
- dev data can be deleted or ignored if needed

Since PersAI has no production users on this surface yet, prefer clean architecture over compatibility shims.

## Implementation order

The implementation should follow this order:

1. data model and migrations
2. OpenAPI contracts and generated clients
3. document processor and vector index abstractions
4. admin tools provider settings for document processing
5. API services for Skills and Skill documents
6. DB-backed indexing jobs
7. admin Skills UI
8. user Settings -> Skills UI and setup/recreate integration
9. prompt materialization / Prompt Constructor `Enabled Skills` section
10. router retrieval plan extension
11. orchestrated retrieval and source-aware context injection
12. activity copy and observability
13. focused automated tests and founder live validation

## Execution ledger

This ledger is the session-to-session source of truth for ADR-079 implementation progress.

Rules:

- update this ledger at the end of every ADR-079 implementation session
- only mark a row `completed` when code, contracts, docs, and focused tests for that row are done
- mark a row `blocked` with a concrete blocker, not a vague note
- keep the next session on the highest-priority unfinished row unless the founder explicitly changes scope
- do not add visible half-product UX; internal staging is allowed, but user/admin surfaces should become active only when the connected flow is coherent

Statuses:

- `planned` - not started
- `in_progress` - current active work
- `completed` - implemented and verified for this row
- `blocked` - cannot proceed without a named decision or dependency

| Step | Status    | Scope                                                                                                                                              | Completion marker                                                                                                                                                                                                                                                                                                                                 |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | completed | Data model and migrations for `Skill`, `SkillDocument`, `AssistantSkillAssignment`, document processor settings, indexing jobs, and vector storage | Prisma schema/migrations added/generated; old `scope=skill` removed from active model truth; Prisma validate/generate and API typecheck pass; DB migration deploy blocked locally by unavailable Postgres                                                                                                                                         |
| 2    | completed | OpenAPI contracts and generated clients for admin Skills, user Skill assignment, document processor settings, and indexing status                  | `packages/contracts/openapi.yaml` updated for `/admin/skills`, `/assistant/skills`, document-processing settings, and indexing jobs; generated artifacts refreshed; contracts/API/web typecheck and full lint/format pass                                                                                                                         |
| 3    | completed | `KnowledgeDocumentProcessor` and source-agnostic `KnowledgeVectorIndex` abstractions                                                               | Local/default/high-quality provider policy represented in code; normalized source/chunk metadata carries source type/id/version, provenance, provider, and quality; source-agnostic `PostgresPgvectorKnowledgeIndex` boundary exists; focused policy/index tests and API typecheck pass                                                           |
| 4    | completed | `/admin/tools` Document Processing provider settings                                                                                               | Admin Tools exposes Document Processing settings; API persists provider policy, encrypted Mistral/LlamaParse keys, default/high-quality/local fallback policy, config generation/audit, and key decryptability test connection                                                                                                                    |
| 5    | completed | API services for Skills and Skill documents                                                                                                        | Admin Skill CRUD/archive, Skill document upload/delete/reindex job enqueue, and user-controlled assignment APIs work through contracts; admin authorization, active/archived assignment behavior, and configured plan limits are enforced                                                                                                         |
| 6    | completed | DB-backed indexing jobs                                                                                                                            | Assistant knowledge, Product global knowledge, and Skill documents enqueue DB jobs; API worker claims with token/expiry, retries with backoff, processes normalized sources through `KnowledgeDocumentProcessor`, persists chunks/source/job provider-quality-error state, applies `needs_review`, and writes pgvector rows when embeddings exist |
| 7    | completed | Admin Skills UI                                                                                                                                    | `/admin/skills` supports list/create/edit/archive plus Skill document upload/delete/reindex/status management; `/admin/knowledge` is Product KB only and no longer exposes the old Skill library scope                                                                                                                                            |
| 8    | completed | User Skills UI and setup/recreate integration                                                                                                      | Setup/recreate final review exposes optional Skill selection without auto-enabling; Assistant Settings has a Skills section backed by `GET/PUT /assistant/skills`, plan counters, archived/over-limit disabled states, and no assistant-card summary                                                                                              |
| 9    | completed | Prompt materialization and Prompt Constructor `Enabled Skills` section                                                                             | Enabled Skill cards render through Prompt Constructor-managed `enabled_skills` block and disappear when disabled, archived, not active, or over the plan limit                                                                                                                                                                                     |
| 10   | completed | Runtime router `retrievalPlan` extension                                                                                                           | Existing `TurnRoutingService` emits additive semantic Skill/user/Product/web `retrievalPlan`; classifier input receives compact enabled Skill summaries only, validates selected Skill ids against enabled Skills, and does not execute retrieval                                                                                                  |
| 11   | completed | Orchestrated retrieval and source-aware context injection                                                                                          | Runtime/API prepare bounded `Retrieved Knowledge Context` with `skill_reference`, `user_document`, and `product_reference` labels; selected Skills are revalidated server-side, ready Skill documents are searched, existing user/Product retrieval is reused, and the block is injected before the current model turn                              |
| 12   | completed | Activity copy and observability                                                                                                                    | Runtime emits calm retrieval activity for retrieved Skill/user/Product/web source classes into the existing web activity badge path; API orchestrated retrieval records durable source/latency/result/empty/error observability through `KnowledgeRetrievalObservabilityService` without storing prompts/chunks                                  |
| 13   | planned   | End-to-end verification and founder validation support                                                                                             | Focused automated tests pass and a concise founder smoke script exists for manual live validation                                                                                                                                                                                                                                                 |

Current next step:

1. Start Step 13: focused automated tests and founder live validation support.

Internal implementation can be staged, but the shipped product should be coherent end-to-end:

admin creates Skill -> admin uploads docs -> user enables Skill -> runtime prompt includes Skill card -> router chooses retrieval plan -> retrieval uses Skill/user/Product/web sources as appropriate -> chat shows calm activity -> answer is grounded.

## Definition of done

The block is complete when all of the following are true:

1. Admin can create, edit, activate, archive, and manage Skills.
2. Admin can upload, delete, reindex, and high-quality reprocess Skill documents.
3. `/admin/knowledge` no longer presents the old Skill library as active product truth.
4. `/admin/tools` can configure document processing providers and validate enabled keys.
5. User setup/recreate shows optional Skill selection when active Skills exist.
6. User Settings has a dedicated Skills section with plan limit state.
7. Enabled Skill instruction cards materialize into runtime prompt through Prompt Constructor.
8. The existing runtime router emits semantic `retrievalPlan` data.
9. Orchestrated retrieval injects bounded source-aware context.
10. `knowledge_search` / `knowledge_fetch` remain available as low-level tools.
11. Skill/user/Product/web activity is human-readable.
12. Knowledge observability records router plan and retrieval quality signals without full prompt/chunk logging by default.
13. Automated tests cover data, API, indexing, router, retrieval, prompt materialization, and web flows.
14. Founder performs final live product validation.

## Verification expectations

Automated coverage should include:

- Prisma repository/model tests for Skills, Skill documents, and assignments
- contract generation and API controller/service tests
- document processor policy tests
- indexing job retry/failure tests
- `pgvector` repository tests where practical
- router schema/classifier parsing tests
- orchestrated retrieval tests for:
  - Skill-only
  - user KB only
  - Skill + user comparison
  - Product KB
  - web fallback
  - empty result honesty
- prompt materialization tests for `Enabled Skills`
- web tests for:
  - admin Skills
  - admin tools Document Processing
  - setup/recreate Skill selection
  - Settings -> Skills
  - activity copy

Founder live validation is expected after automated checks, not replaced by them.

## Non-goals

This ADR does not add:

- Skill marketplace
- public Skill catalog
- seeded demo Skills
- user download/open access to admin Skill documents
- full audit UI for every Skill edit
- Skill versioning
- per-turn manual Skill picker
- plan-degraded OCR quality
- separate managed vector DB as the first implementation
- connectors such as Drive, Notion, SharePoint in the first release
- citations-heavy answer UI by default

## Consequences

### Positive

- Skills become a real product concept instead of a knowledge scope flag.
- User choice stays explicit and controllable.
- Professional behavior can affect both prompt and retrieval.
- Simple chat stays fast because retrieval is semantic and conditional.
- Document ingestion becomes reliable enough for production KB use.
- The existing router is reused and strengthened rather than duplicated.
- `pgvector` improves retrieval quality without adding another operational service.
- Admin gets observability that can explain retrieval quality issues.

### Negative

- This is a large cross-cutting block touching data, contracts, API, web, runtime, and provider settings.
- DB-backed indexing jobs add scheduler/worker complexity.
- Document processor providers add cost and provider failure modes.
- Prompt Constructor gains another dynamic block that must be carefully tested.
- Router output schema changes must be coordinated with runtime tests and persisted telemetry.

## Alternatives considered

### Keep `scope=skill` as the Skill model

Rejected. It is not a user-selectable Skill entity, has no instruction card, has no assignment model, and does not express status, plan limits, or prompt materialization.

### Let the main LLM decide everything with existing `knowledge_search`

Rejected. It preserves too much tool-loop latency and gives weak control over source roles, budgets, and enabled Skill policy.

### Add a second retrieval router

Rejected. The existing `TurnRoutingService` already owns early routing and cheap semantic classification. Skills should extend that router rather than fork routing truth.

### Use keyword triggers for Skills

Rejected. Professional relevance must be semantic. Keyword rules are too brittle and would make PersAI feel narrow and mechanical.

### Use managed vector DB immediately

Rejected for first implementation. `pgvector` is the better production default for the current architecture. A vector index abstraction keeps the future path open.

### Make high-quality document processing a premium-only feature

Rejected. Recognition quality should not be degraded by plan. Plan economics should use storage/file limits and operational safety caps.

### Always search Skills on every turn

Rejected. This would increase latency and make casual answers too dry. Skill instruction cards stay in prompt, but Skill document retrieval is conditional.
