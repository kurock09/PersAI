# ADR-080: Admin-controlled knowledge authoring and Skill curation

**Status:** Accepted  
**Date:** 2026-05-02  
**Relates to:** ADR-079, ADR-081

## Context

ADR-079 made Skills and Product KB usable at runtime: uploaded documents can be processed, indexed, embedded, and retrieved through source-aware orchestration. That solves execution and retrieval, but it does not yet solve admin authoring.

The first live Knowledge/Skills flows still assume that valuable knowledge usually arrives as uploaded files. That is too narrow for the product:

- many Skill knowledge entries are short, curated professional notes rather than documents
- admins need to edit Product KB text directly without preparing a file
- an admin may create a Skill with only a name and want the assistant to draft the missing card and base knowledge
- existing draft Skills may need enrichment without losing admin-edited fields
- generated content must never silently become production knowledge without admin control

The founder decisions captured for ADR-080 are:

1. the admin stays in control
2. Skill authoring should have an assistant-assisted “collect/fill with agent” path
3. existing Skill drafts can be enriched
4. Product KB should support direct text editing, not only file upload
5. generated drafts are useful, but activation must remain explicit

## Decision

PersAI will add an admin-controlled knowledge authoring layer on top of ADR-079.

The first product scope is:

1. Skill knowledge cards
2. assistant-assisted Skill draft/enrichment
3. manual Product KB text entries
4. lifecycle states for authored knowledge
5. indexing/reindexing through the existing ADR-079 pipeline

This is an admin authoring and curation decision, not a request-time retrieval change. Runtime still consumes indexed, approved, ready sources through ADR-079 orchestration.

## Product model

### Skill authoring

The Skill detail page becomes the authoring workspace for one Skill.

Minimum required input:

- Skill name

Everything else can be manually edited or assistant-drafted:

- localized name
- short description
- category
- tags
- instruction card
- guardrails/disclaimers
- examples
- Skill knowledge cards

The admin can click an action such as `Собрать с помощью агента` / `Fill with assistant`.

That action reads the current draft fields. It may fill empty fields and improve weak draft text, but it works against a draft preview. The admin still saves or discards the result.

If the Skill already has a draft, the same action enriches the draft instead of starting over. The assistant should preserve strong admin-authored fields unless the admin explicitly asks to rewrite them.

### Skill knowledge cards

A Skill knowledge card is a curated text entry attached to a Skill, shown in the same Skill detail knowledge area as uploaded documents.

Cards are for concise professional knowledge that does not justify a full file:

- “Common PCB bring-up checklist”
- “Type 1 diabetes weight-loss safety reminders”
- “What to ask before choosing a MOSFET”
- “Local support policy for paid plans”

A Skill knowledge card has:

- title
- body
- optional locale
- optional tags
- lifecycle status
- provenance metadata
- indexing status

Skill knowledge cards are indexed as Skill sources and retrieved only when the Skill is active for the assistant and the router selects Skill retrieval.

### Product KB text entries

Product KB supports direct text entries in `/admin/knowledge`, alongside uploaded Product sources.

Admins can create and edit Product KB entries as structured text:

- title
- body
- optional category/tags
- optional locale
- lifecycle status
- provenance metadata
- indexing status

These entries are indexed as Product KB sources and participate in Product KB retrieval. They are not user Files and do not become `AssistantFile` rows unless separately exported or uploaded into Files.

### Lifecycle states

Authored Skill cards and Product KB text entries use a knowledge lifecycle separate from ADR-079 processing status.

Lifecycle status:

- `draft` - editable, not used at runtime
- `active` - eligible for indexing and runtime retrieval
- `stale` - still visible to admins, not preferred for retrieval; may be reworked
- `archived` - hidden from runtime and normal admin lists

Processing/indexing status remains the ADR-079 state:

- `processing`
- `ready`
- `failed`
- `needs_review`

Lifecycle answers “should this knowledge be used?” Processing answers “can this source currently be indexed/retrieved?”

## Agent-assisted authoring

Assistant-assisted authoring is an admin workflow, not ordinary chat behavior.

The authoring agent may:

- inspect the current Skill fields
- draft missing Skill metadata
- draft or improve the instruction card
- propose initial Skill knowledge cards
- propose Product KB text from an admin prompt
- summarize uploaded Skill documents into draft cards when explicitly requested
- flag uncertainty and missing facts

The authoring agent must not:

- publish active knowledge without admin action
- silently overwrite saved admin edits
- crawl arbitrary web sources in the first version
- create runtime behavior outside the Skill/Product KB authoring surfaces
- merge Knowledge into Files
- expose admin Skill documents to end users

Generated content is stored as a draft proposal or applied to the editable draft form. It becomes active only after the admin saves/activates it.

## Boundary with ADR-079

ADR-079 owns:

- document processing
- chunking
- vector indexing
- retrieval policy
- runtime retrieval orchestration
- Skill prompt materialization
- user Skill assignment

ADR-080 owns:

- manual authored knowledge entries
- assistant-assisted admin drafts
- lifecycle governance for authored Skill/Product knowledge
- curation UI and admin approval flow

ADR-080 must reuse ADR-079 indexing and retrieval infrastructure. It must not introduce a second retrieval stack.

## Boundary with ADR-081

ADR-081 owns user-visible reusable Files and `fileRef`.

ADR-080 knowledge cards and Product KB text entries are Knowledge sources, not Files. They may have internal provenance links to uploaded files or generated drafts, but their runtime selector is the Knowledge source/chunk pipeline, not `fileRef`.

## API boundary

First-version API surfaces should be admin-only.

Admin Knowledge model policy:

- `/admin/knowledge` owns `authoringModelKey` for assistant-assisted Skill/Product KB authoring, next to `embeddingModelKey` and `retrievalModelKey`.
- Authoring uses the API/control-plane provider-gateway path, not ordinary runtime chat, so admin curation quality can be tuned independently from request-time user conversations.

Skill authoring:

- `POST /api/v1/admin/skills/:skillId/authoring/draft`
- `POST /api/v1/admin/skills/:skillId/knowledge-cards`
- `PATCH /api/v1/admin/skills/:skillId/knowledge-cards/:cardId`
- `DELETE /api/v1/admin/skills/:skillId/knowledge-cards/:cardId`
- `POST /api/v1/admin/skills/:skillId/knowledge-cards/:cardId/reindex`

Product KB text entries:

- `POST /api/v1/admin/knowledge-sources/product/text-entries`
- `PATCH /api/v1/admin/knowledge-sources/product/text-entries/:entryId`
- `DELETE /api/v1/admin/knowledge-sources/product/text-entries/:entryId`
- `POST /api/v1/admin/knowledge-sources/product/text-entries/:entryId/reindex`

Exact route names may be adjusted during implementation, but the boundary must stay:

- admin-only
- explicit save/apply actions
- async indexing through existing jobs
- no runtime mutation from ordinary user chat

## Data model direction

The implementation may either add dedicated tables or extend existing source tables if the resulting model stays clear. The preferred first-version model is explicit:

- `SkillKnowledgeCard`
- `ProductKnowledgeTextEntry`
- `KnowledgeAuthoringDraft` or an equivalent draft/proposal record if generated proposals need persistence before save

Authored records should carry:

- author/admin ids where available
- target `skillId` or Product KB scope
- title/body/locale/tags
- lifecycle status
- processing/indexing status or link to `KnowledgeIndexingJob`
- provenance: manual, assistant-generated, document-summary, imported
- timestamps and last edited by

Authored Skill cards and Product KB text entries are platform/admin-managed shared KB records. They are not owned by a tenant workspace; the consuming assistant workspace is recorded only later as usage/retrieval telemetry.

When an active entry changes, indexing should enqueue or refresh a `KnowledgeIndexingJob` using the existing source-normalization pipeline. Draft/archived entries should not be injected into runtime retrieval.

## UI shape

### Admin Skill detail

The Skill detail page should have:

- core Skill fields at the top
- `Fill with assistant` / `Собрать с помощью агента`
- preview/apply behavior for assistant-generated changes
- Skill knowledge area below, next to or near uploaded documents
- manual “Add knowledge card” action
- card status and reindex controls

### Admin Product KB

The Product KB page should support:

- uploaded sources
- manual text entries
- create/edit text entry drawer or editor
- lifecycle status
- indexing status
- reindex action

Manual text editing is not a file upload workaround. It is a first-class Product KB source.

Product KB is also the runtime-facing product knowledge label. Baseline product documents such as PersAI Product Overview and PersAI Product Principles must live as admin-managed Product KB text entries, not as hidden hard-coded runtime documents. Runtime retrieval may still expose plan/subscription facts from the billing/catalog model for tariffs, quotas, and plan differences, but non-pricing product truth should come from Product KB entries/files.

## Implementation order

1. Add ADR/API/data-model contracts for authored Skill and Product KB text entries.
2. Add persistence and indexing-source adapters for Skill knowledge cards and Product KB text entries.
3. Add admin CRUD for Skill knowledge cards.
4. Add admin CRUD for Product KB text entries.
5. Add assistant-assisted Skill draft/enrichment endpoint with draft/apply semantics.
6. Add focused admin UI in Skill detail and Product KB.
7. Add observability and indexing status integration.
8. Live-smoke: create a Skill from name only, fill it with assistant, approve knowledge cards, reindex, assign Skill, and verify retrieval uses the authored card.

## Out of scope

The first version does not include:

- autonomous production knowledge mutation
- public user knowledge authoring
- web crawling by arbitrary URL/query
- scheduled curator jobs
- marketplace or community Skill publishing
- versioned Skill releases
- conflict-resolution workflows across multiple admins
- automatic stale detection
- replacing uploaded documents

Those can be added later if product evidence justifies them.

## Acceptance criteria

1. Admin can create a Skill with only a name, ask the authoring assistant to draft missing fields and initial knowledge cards, review the result, save it, activate it, and index it.
2. Admin can enrich an existing Skill draft without losing saved admin edits.
3. Admin can manually create/edit/delete a Skill knowledge card.
4. Admin can manually create/edit/delete a Product KB text entry.
5. Active authored entries produce normal indexing jobs and vector chunks through the ADR-079 pipeline.
6. Draft and archived authored entries are not used by runtime retrieval.
7. Retrieval observability identifies authored Skill/Product sources distinctly enough for admin debugging.
8. Ordinary user chat cannot silently create or activate admin knowledge.

## Risks

- Generated knowledge can look authoritative even when weak. The UI must keep provenance and review status visible.
- If “fill with assistant” overwrites strong admin edits, admins will stop trusting it. The default should be enrich/preserve, with explicit rewrite when requested.
- Product KB text entries can become stale faster than uploaded docs. Lifecycle status must be easy to see and change.
- If the first version tries to include web crawling, stale detection, and curator jobs, the slice will become too broad. Keep the first implementation manual/admin-controlled.
