# ADR-094: Smart knowledge search and flexible knowledge fetch

**Status:** Implemented (Step 1 + Step 2 landed 2026-05-13; deploy required)  
**Date:** 2026-05-13  
**Relates to:** [ADR-079](079-knowledge-skills-and-orchestrated-retrieval.md) (knowledge + skills + orchestrated retrieval baseline), [ADR-080](080-admin-controlled-knowledge-authoring-and-skill-curation.md) (admin curation surface), [ADR-074](074-humanity-and-cost-polish-program.md) (humanity / cost polish), [ADR-093](093-clean-prod-launch-readiness-and-concurrency-hardening.md) (clean PROD discipline, no transition modes)

## Context

Today the assistant gets fragments instead of usable knowledge for simple questions ("how do I connect Telegram"):

- `knowledge_search` returns truncated `snippet` strings (≤ 320 chars) per hit, and there is **no inline content path** — the model is forced to emit a follow-up `knowledge_fetch` even for a tiny KB article.
- `knowledge_fetch` returns a fixed window of `radius = 1` chunk around the hit (or `radius = 2` messages for a chat hit) with a hard `MAX_ITEM_CHARS ≈ 6 000` cap. That is structurally unable to deliver a full article or a real chat thread.
- The orchestrated server-side path (`OrchestrateRuntimeRetrievalService` → `# Retrieved Knowledge Context`) uses the same narrow window with `MAX_ITEM_CHARS = 1200` and `MAX_CONTEXT_ITEMS = 6`. So even when the server already knows which document is relevant, it injects fragments.
- All of this is currently driven by `DEFAULT_KNOWLEDGE_RETRIEVAL_POLICY` defaults. The platform has 5 plan tiers (1 free + 4 paid), but admin never customised `billingHints.retrievalPolicy` per plan, so paid tiers silently inherit the Free-tier shape. There is no per-tier differentiation.

Skill base ([ADR-079](079-knowledge-skills-and-orchestrated-retrieval.md), [seed-base-skills.ts](../../apps/api/prisma/seed-base-skills.ts)) sits on top of these tools. Skill bodies do not embed tool calls, but live skills (and bundles) rely on the **runtime contract** of `knowledge_search` and `knowledge_fetch`. **Breaking that contract breaks every skill.** This ADR therefore changes shape only by **additive contract evolution** and a single semantic default; no flag, no legacy mode, no parallel implementation.

Per [ADR-093](093-clean-prod-launch-readiness-and-concurrency-hardening.md): we are entering a clean PROD launch with test users. This work targets PROD directly, so the design rule is **direct replace, no transitional modes, no shadow paths, no feature flags**.

## Non-goals

- A new combined `knowledge_query` tool. The model surface stays exactly two tools: `knowledge_search`, `knowledge_fetch`.
- Any change to indexing, chunking, embeddings, or vector-store behaviour.
- Any change to the existing `knowledge_search` response field set used today (we **add** fields, never remove, never rename).
- Any keyword/heuristic routing to decide what counts as "Telegram setup" — the smart-search rules are purely length- and hit-count-based.
- A long-lived "legacy fetch without `mode`" code path. There is exactly one fetch implementation; the `mode` argument has a documented default and is part of the new permanent contract.

## Decision

Two ordered steps. **Step 1 = backend slice (the feature).** **Step 2 = admin surface + telemetry.** A **mandatory intermediate audit** sits between them; failing the audit blocks Step 2.

### Step 1 — Smart search, flexible fetch, per-tier policy schema (backend)

**1.1 Policy schema (per-plan and global).** Two configuration surfaces, one purpose each:

| Where                                                                                                                                                                   | Owns                                 | New keys                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billingHints.retrievalPolicy` (per plan, [`manage-admin-plans.service.ts`](../../apps/api/src/modules/workspace-management/application/manage-admin-plans.service.ts)) | **Volume allowed for tier**          | `smartSearchShortDocChars`, `smartSearchMediumDocChars`, `chatSectionDefaultRadius`, `fetchFullModeMaxChars`, `fetchFullModeMaxChatMessages` (all positive ints, in addition to existing keys) |
| Admin Knowledge ([`admin-knowledge-retrieval-policy.ts`](../../apps/api/src/modules/workspace-management/application/admin-knowledge-retrieval-policy.ts))              | **Hard ceilings + form of response** | `smartSearchEnabled` (bool), `smartSearchLongDocSummaryChars` (positive int), `fetchFullModeAbsoluteMaxChars` (positive int), `fetchFullModeAbsoluteMaxChatMessages` (positive int)            |

Effective per-call limit = `min(plan.fetchFullModeMaxChars, admin.fetchFullModeAbsoluteMaxChars)` and analogously for chat messages. `KnowledgeRetrievalPolicy` reading paths fall back to a **Start-tier-grade default** (not the current Free-grade default) so existing plan rows without overrides become reasonable across the catalog.

**Recommended values per role** (admin applies them through the existing JSON billing-hints UI in this step; full UI lands in Step 2):

| Field                          |   Free |  Start |   Plus | Premium | Pro/Biz |
| ------------------------------ | -----: | -----: | -----: | ------: | ------: |
| `defaultMaxResults`            |      5 |      6 |      7 |       8 |      10 |
| `maxMaxResults`                |      8 |     10 |     12 |      15 |      20 |
| `knowledgeFetchWindowRadius`   |      2 |      3 |      4 |       5 |       6 |
| `chatFetchWindowRadius`        |      5 |     10 |     15 |      20 |      30 |
| `fetchMaxChars`                |  4 000 |  8 000 | 14 000 |  25 000 |  40 000 |
| `helperEnabled`                |  false |   true |   true |    true |    true |
| `smartSearchShortDocChars`     |  1 500 |  2 000 |  2 500 |   3 000 |   4 000 |
| `smartSearchMediumDocChars`    |  5 000 |  8 000 | 10 000 |  14 000 |  20 000 |
| `chatSectionDefaultRadius`     |     10 |     15 |     20 |      30 |      50 |
| `fetchFullModeMaxChars`        | 12 000 | 25 000 | 40 000 |  60 000 | 100 000 |
| `fetchFullModeMaxChatMessages` |     80 |    150 |    250 |     400 |     800 |

Admin Knowledge ceilings: `smartSearchEnabled = true`, `smartSearchLongDocSummaryChars = 800`, `fetchFullModeAbsoluteMaxChars = 100 000`, `fetchFullModeAbsoluteMaxChatMessages = 800`.

**1.2 `knowledge_search` becomes smart (server-decided, model-transparent).** Inside `ReadAssistantKnowledgeService.searchKnowledge`, after hit ranking:

- **1 hit AND `documentChars ≤ smartSearchShortDocChars`** → attach `inlinedDocument: { text, chars, truncated: false }` to that hit. Snippet stays for backward compatibility.
- **1 hit AND `documentChars ≤ smartSearchMediumDocChars`** → attach `inlinedSection: { text, chars, radius, truncated }` (radius is `knowledgeFetchWindowRadius` extended).
- **1 hit AND `documentChars > smartSearchMediumDocChars`** → attach `inlinedSection` PLUS `documentSummary: { text, chars }` produced from section headings / first lines of other chunks, capped by `smartSearchLongDocSummaryChars`.
- **multi-hit** → unchanged. Plain `snippet` per hit.
- `KNOWLEDGE_SEARCH_SNIPPET_MAX_CHARS` continues to apply **only** to the snippet field, not to inline payloads.

The smart branch reuses the **same internal fetch function** as Step 1.3; no extra HTTP, no model round-trip, no second tool.

**1.3 `knowledge_fetch` becomes flexible.** Schema:

```
mode: "short" | "section" | "full"   # required, default "section" (permanent contract default, not a legacy fallback)
radius?: integer                     # only meaningful for "section"; clamped to plan policy
```

Behaviour:

- **`short`** — single-chunk window or summary equivalent. Bounded by `fetchMaxChars`.
- **`section`** — extended window using `radius` (default = `knowledgeFetchWindowRadius` for documents, `chatSectionDefaultRadius` for chat). Bounded by `fetchMaxChars`.
- **`full`** — entire document or entire chat thread/session. Bounded by `min(plan.fetchFullModeMaxChars, admin.fetchFullModeAbsoluteMaxChars)` for documents and `min(plan.fetchFullModeMaxChatMessages, admin.fetchFullModeAbsoluteMaxChatMessages)` for chat. When the cap is hit, the response sets `truncated: true` and includes a structured `truncationMarker` (chars omitted, messages omitted).

Chat is a first-class source: `mode = section` for chat means the configured `chatSectionDefaultRadius` (tens of messages), assembled in chronological order with timestamp-aware joining, not a chunk window.

**1.4 Orchestrated path stays smart too.** `OrchestrateRuntimeRetrievalService` applies the same length-based rule when it has 1 ready document for the upcoming turn: short → inline whole document into `# Retrieved Knowledge Context`; medium → section; long → section + summary. `MAX_ITEM_CHARS` and `MAX_CONTEXT_ITEMS` are **replaced by policy-derived limits**, not held as in-file constants.

**1.5 Tool descriptors.** [`bootstrap-preset-data.ts`](../../apps/api/prisma/bootstrap-preset-data.ts) descriptions and `usage_guidance` for `knowledge_search` and `knowledge_fetch` are rewritten to teach the model:

- "Search may return inline content for a single short or medium hit; use it directly."
- "Fetch requires `mode`. Use `full` for whole article / large chat slice; use `section` for surrounding context; use `short` for a quick excerpt."

**1.6 Internal contract.** [`internal-runtime-knowledge.controller.ts`](../../apps/api/src/modules/workspace-management/interface/http/internal-runtime-knowledge.controller.ts) DTO accepts `mode` (enum, required) and optional `radius`. Search response DTO gains optional `inlinedDocument`, `inlinedSection`, `documentSummary`, `truncated`. `openapi.yaml` is updated in the same slice.

**1.7 Runtime client + tool.** [`PersaiInternalApiClientService.fetchKnowledge`](../../apps/runtime/src/modules/turns/persai-internal-api.client.service.ts) and [`RuntimeKnowledgeToolService`](../../apps/runtime/src/modules/turns/runtime-knowledge-tool.service.ts) plumb `mode` and `radius` end-to-end with the same enum validation. There is no "fetch with no mode" code path; the schema sets `mode` as required and the validator enforces a single default of `"section"` at parse time when the model omits it. This is the **permanent contract**, not a deprecation window.

**1.8 What we delete in the same slice.** Direct replace, no transition modes:

- `MAX_ITEM_CHARS` literal in `OrchestrateRuntimeRetrievalService` → derived from policy.
- `MAX_CONTEXT_ITEMS` literal in `OrchestrateRuntimeRetrievalService` → derived from policy.
- The "snippet only" behaviour in `searchKnowledge` for the 1-hit case → replaced by the smart-search branch.
- Any place that hard-codes `radius = 1` for fetch → replaced by policy-derived radius.

### Intermediate audit between Step 1 and Step 2

Mandatory. **Critical findings block Step 2** (per ADR-093 progression gate). Quality findings either land in the Step-1 slice or are explicitly deferred with reason in handoff.

| Audit                         | Question                                                                                                                                               | Pass criterion                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI gate**                   | `format:check`, `lint -r`, `typecheck`, `test`                                                                                                         | All four green on the Step-1 branch.                                                                                                                                                            |
| **Skill-base contract**       | Do `seed-base-skills.ts` skills + currently-published skills run the new tools without surface change?                                                 | Targeted runtime-knowledge-tool tests cover `mode = "section"` defaulting; integration test exercises a skill that uses `knowledge_fetch` and confirms backwards-shaped responses still render. |
| **Smart-search end-to-end**   | On a short KB document ("how to connect Telegram"), does one `knowledge_search` call return `inlinedDocument` so the model needs no follow-up `fetch`? | Yes, demonstrated by a focused test with a 1 200-char fixture document.                                                                                                                         |
| **Flexible fetch end-to-end** | Does `mode = full` on a 30 000-char doc return the full text under `fetchFullModeMaxChars`, and `truncated: true` with marker when over the cap?       | Yes, with two fixtures spanning under-cap and over-cap cases.                                                                                                                                   |
| **Chat fetch**                | Does `mode = section` on a chat hit return tens of messages assembled in order, not "± 1 message"?                                                     | Yes, with a chat fixture of ≥ 60 messages.                                                                                                                                                      |
| **Orchestrated path**         | Is the prompt block `# Retrieved Knowledge Context` hydrated with full short documents (not 1 200-char chunks) when the router-plan picks 1 ready doc? | Yes, demonstrated by `orchestrate-runtime-retrieval.service.test.ts`.                                                                                                                           |
| **Per-tier reachability**     | Can admin override `retrievalPolicy` JSON in `/admin/plans` with the new keys for any of the 5 tiers and have it actually applied at runtime?          | Yes, parser accepts the new keys and `resolveAssistantRetrievalPolicy` returns the resolved values; covered by `manage-admin-plans.service.test.ts`.                                            |
| **No legacy**                 | Are there any leftover `MAX_ITEM_CHARS` literals, hard-coded radius, "fetch without mode" branches, or hidden flags?                                   | None — checked by code search and reflected in CHANGELOG cleanup notes.                                                                                                                         |
| **Smoke (manual, on dev)**    | One real assistant turn that exercises (a) short-doc smart search, (b) `mode=full` on a known doc, (c) `mode=section` on a chat                        | Each behaves as designed; logs print the chosen mode and bytes returned.                                                                                                                        |

If any **Critical** row fails, Step 2 does not start. The agent stops at the session boundary and emits the next-session prompt per ADR-093 §"Session handoff contract".

### Step 2 — Admin UI + telemetry persistence

**2.1 Admin Plans UI.** [`apps/web/app/admin/plans/page.tsx`](../../apps/web/app/admin/plans/page.tsx) shows the new per-plan keys as form fields with tooltips and tier-aware placeholder hints (e.g. "Free ≈ 12 000 / Pro ≈ 100 000"). The existing JSON billing-hints textarea remains the source of truth; the form writes through to it.

**2.2 Admin Knowledge UI.** [`apps/web/app/admin/knowledge/page.tsx`](../../apps/web/app/admin/knowledge/page.tsx) gets a "Smart Retrieval Limits" section: `smartSearchEnabled`, `smartSearchLongDocSummaryChars`, `fetchFullModeAbsoluteMaxChars`, `fetchFullModeAbsoluteMaxChatMessages`.

**2.3 Telemetry.** Single Prisma migration extends `KnowledgeRetrievalEvent` with `modeUsed VARCHAR(32)` and `bytesReturned INTEGER`. The active persistence boundary is `KnowledgeRetrievalObservabilityService.recordSearch` / `recordFetch`, called from `ReadAssistantKnowledgeService` (search / fetch seams) and `OrchestrateRuntimeRetrievalService` (skill window inlining + aggregate per-source stage rows). The column is `VARCHAR(32)` (not the 16 chars initially sketched in Step 1) so the longest current tag (`smart_inline_summary`, 20 chars) fits without silent truncation; the persistence layer still slices defensively to 32. Migration is **additive only** (nullable columns), so it is safe under the dev `api-migrate` PreSync hook ([infra/dev/gitops/README.md](../../infra/dev/gitops/README.md)) and trivially reversible.

**2.4 Web tests.** `app/admin/plans/page.test.tsx` + `app/admin/knowledge/page.test.tsx` assert presence, default values, and successful save round-trip for the new fields.

### Final audit (after Step 2)

| Audit                      | Pass criterion                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI gate**                | `format:check`, `lint -r`, `typecheck`, `test` all green on the Step-2 branch.                                                                           |
| **Migration safety**       | `api-migrate` PreSync runs against dev cluster without rollback; new columns are nullable.                                                               |
| **UI round-trip**          | Admin user saves new per-tier values for all 5 tiers via UI; values reach `resolveAssistantRetrievalPolicy` end-to-end.                                  |
| **Telemetry**              | `KnowledgeRetrievalEvent` rows in dev DB include `modeUsed` and `bytesReturned` for new turns.                                                           |
| **Skill regression sweep** | Run 3 base skills (`dietitian`, `fitness-coach`, `sleep-coach`) end-to-end on dev; each receives sane KB volume per its plan tier; no broken tool calls. |
| **Docs aligned**           | `ARCHITECTURE.md`, `API-BOUNDARY.md`, `DATA-MODEL.md`, `TEST-PLAN.md`, `CHANGELOG.md` updated in the same slice.                                         |

## Acceptance criteria

- "How do I connect Telegram" returns full setup text in **one** `knowledge_search` call, no follow-up fetch needed.
- `knowledge_fetch(mode = "full")` on a KB article returns the article text up to the effective cap, with `truncated` and marker set when over cap.
- `knowledge_fetch(mode = "section")` on a chat hit returns tens of messages, ordered, with timestamps.
- `KnowledgeRetrievalEvent` rows in dev include the chosen `modeUsed` and actual `bytesReturned`.
- Existing `knowledge_fetch` callers that omit `mode` continue to work, served by the permanent default `mode = "section"` (this is the contract default, not a deprecation alias).
- Admin can set per-tier retrieval policy through `/admin/plans` for Free, Start, Plus, Premium, and Pro/Biz, and `resolveAssistantRetrievalPolicy` returns the configured values.

## Risks

- **Skill regression.** Mitigation: additive contract; default `mode = "section"` matches today's behaviour shape; intermediate audit explicitly checks 3 base skills.
- **Token cost spike on `mode = full`.** Mitigation: hard ceilings live in Admin Knowledge, plan caps live in billing hints; over-cap requests truncate with marker. Free tier capped at 12 000 chars / 80 messages.
- **Prompt-cache churn** when long-doc inline lands in `# Retrieved Knowledge Context`. Mitigation: `# Retrieved Knowledge Context` is already a non-stable block (`prompt-cache-stable-blocks.ts`), so cache stability for `durable_memory_core`, `cross_session_carry_over`, and `rolling_session_synopsis` is not affected.
- **Dev-tier admin who never opened the JSON form.** Mitigation: defaults move to Start-tier shape so a fresh plan without overrides is already reasonable; Free is then an explicit override, not the implicit baseline.

## Consequences

### Positive

- One tool call answers simple KB questions instead of search → fetch round trip; lower latency, fewer model decisions.
- The model has a real `full` mode for full-document and full-thread reads, gated by per-tier admin policy.
- Per-tier differentiation actually works: each of the 5 tiers can be tuned independently via Admin Plans.
- Single source of truth for "form" (Admin Knowledge ceilings) and "volume" (plan billing hints), no duplication.
- No legacy modes, no shadow paths, no flags to remove later.

### Negative

- More config surface to keep documented (mitigated by tooltips in Step 2 UI).
- One Prisma migration on `KnowledgeRetrievalEvent` (additive, nullable, low risk under PreSync hook).
- `knowledge_search` response payloads are larger in the smart branch; trade-off accepted for the latency win.

## Alternatives considered

- **New `knowledge_query` tool.** Rejected: contract bloat, duplicate descriptors, no benefit a smart server-side decision can't deliver.
- **Heuristic routing on user text** (e.g., "looks like a KB question, expand fetch"). Rejected per ADR-074 and the user's standing rule: no keyword/text heuristics in chat routing.
- **Plan-only or admin-only configuration.** Rejected: plan-only loses the "form of response" ceiling; admin-only loses tier differentiation. The split keeps each surface focused.
- **Feature flag with dual code paths.** Rejected per ADR-093: clean PROD launch, no transition modes, no shadow paths.
