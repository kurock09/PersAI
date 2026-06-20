# ADR-120: RAG / Knowledge unification and memory JIT — pull-first retrieval, single vector store, honest relevance

## Status

Accepted — 2026-06-19 (founder go; implementation by bounded slices) · **closure-mode 2026-06-20** (all seven slices landed; see § Closure)

> Closure-mode program ADR. Implemented in seven bounded slices (see Work plan). Each slice ended green per the `AGENTS.md` verification gate; the final slice runs full-repository verification before the push/deploy. This ADR is the umbrella reserved by ADR-119 ("ADR-120 implements the unified retrieval engine that fills `<persai_retrieved_knowledge>`") and additionally owns the memory JIT redesign that ADR-121 listed as out of scope. **Do not reopen for new scope** — only the two tracked residual follow-ups in § Closure remain (HNSW ANN index pending live embedding dimension; legacy JSONB chunk column drop pending PROD confirmation + backfill).

## Date

2026-06-19

## Relates to

ADR-079 (knowledge & skills foundation), ADR-094 (smart retrieval / flexible fetch), ADR-100 (project chat mode and B2B analysis profile), ADR-117 (tool instruction single seat), ADR-119 (prompt architecture and 2026 context engineering — defines the `<persai_retrieved_knowledge>` and `<persai_memory>` XML contracts), ADR-121 (two-dimensional execution routing).

---

## Context

Two adjacent subsystems push large, low-relevance context into nearly every turn: **durable memory** and **knowledge retrieval (RAG)**. Both violate the same 2026 context-engineering principle that ADR-119 adopted for prompts — *least relevant context, just in time* — but neither was reworked under ADR-119. The founder reports concrete production symptoms; this ADR maps them to root causes in code and fixes both subsystems on one model: **pull-first, single store, honest relevance, return-nothing-beats-wrong**.

### Symptom 1 — knowledge is auto-pushed into most turns, especially in project mode

`apps/runtime/src/modules/turns/project-execution-profile.ts:59` hardcodes retrieval on for every project turn:

```
const useUserKnowledge = input.availableKnowledge;        // unconditional
```

This sets `retrievalPlan.useUserKnowledge = true` on every project turn regardless of whether the user's message needs a lookup. `apps/runtime/src/modules/turns/turn-execution.service.ts:812` (`resolveRetrievedKnowledgeContext`) then calls the API-side orchestrator **before the provider request** with `gatherProfile: "project"` (`turn-execution.service.ts:839`), which additionally extracts up to two whole chat-attached files (`orchestrate-runtime-retrieval.service.ts` `MAX_PROJECT_FILE_CANDIDATES = 2`, each up to `fetchMaxChars`). A floor `MIN_CONTEXT_ITEMS = 4` forces at least four items even when all scores are weak. The result is a large, frequently-irrelevant block injected as a flat developer section (`# Retrieved Knowledge Context`, `turn-execution.service.ts:1032`).

### Symptom 2 — material quality/relevance is poor (a real retrieval-correctness bug)

The user-document search path does **not** use the pgvector index. `apps/api/src/modules/workspace-management/application/read-assistant-knowledge.service.ts` loads up to `vectorCandidateLimit` (admin default 400) chunks **in table/id order**, then computes cosine in process and gates on `cosineSimilarity <= 0.18` (`read-assistant-knowledge.service.ts:1828`). Because the candidate pool is "first N rows", the actual nearest neighbours to the query frequently never enter scoring. Compounding factors:

- The unified pgvector store `KnowledgeVectorChunk` (`apps/api/prisma/schema.prisma:3055`) is **already populated** for user knowledge via the indexing worker's dual-persist (`knowledge-indexing-job-worker.service.ts:595`), but the **read path ignores it** — only the skill path uses true ANN (`knowledge-vector-index.ts:181`, `ORDER BY embedding_vector <=> query::vector`).
- **No ANN index** exists on `embedding_vector` (no `hnsw`/`ivfflat` in any migration); even the skill query is a full scan.
- The document search applies **no `passesRelevanceFloor`** (`read-assistant-knowledge.service.ts:888`); only memory/chat/text-entry sources get the floor.
- The LLM reranker is optional and fail-open (`helperEnabled`, `knowledge-retrieval-helper.service.ts`).

### Symptom 3 — opaque behaviour; too many knobs; three blended sources

Knowledge blends user knowledge, user files, and Skill knowledge bases by **source stage priority** (`orchestrate-runtime-retrieval.service.ts` `selectContextItems`), not a unified relevance ranking, so "why did this enter" is invisible. The admin surface exposes ~20 raw retrieval knobs (`apps/web/app/admin/plans/page.tsx` retrieval policy + smart retrieval; `apps/web/app/admin/knowledge/page.tsx` smart-retrieval limits) that the founder has tuned **upward** (results 6→7, max 10→12, lexical 60→100, vector 240→400, fetch 8 000→20 000) trying to fix relevance with volume — the wrong lever, since no knob fixes the table-order candidate bug.

### Symptom 4 — `knowledge_search`/`knowledge_fetch` are under-used; the model never decides

Because the server pre-pushes a knowledge block, the model rarely calls `knowledge_search` itself, and `knowledge_fetch` even less. The push **pre-empts** the pull. The model never learns "search to locate, fetch to read" because the decision was taken for it. This is the inverse of the Claude-Code agentic-retrieval pattern (progressive disclosure: lightweight references first, expand on demand).

### Symptom 5 — durable memory pushes cross-chat facts into the recency zone (memory bleeding)

Contextual short-memory is hydrated by `assistantId` only — not `chatId` (`hydrate-memory-for-turn.service.ts`), so facts from one chat surface in another. It is spliced as `<persai_memory>` volatile entries **immediately before the user question** (recency zone), competing with the live request for attention. Open loops render in a developer block but are not scoped to the current chat. Memory embeddings exist (`assistant_memory_registry_items.embeddingVector` JSONB) but are unused for retrieval — selection is by recency.

### `<persai_retrieved_knowledge>` is defined but never filled

ADR-119 defined the XML contract (`docs/ADR/119-...md:607`, `<stage source>`/`<item ref>`) and anticipated a **push** consumer. It is unimplemented: the runtime injects the flat `# Retrieved Knowledge Context` markdown instead. This ADR resolves the contract by choosing **pull**, and supersedes the ADR-119 push expectation accordingly (see D6).

---

## Decision

The engine is unified and consumed **pull-first**. Memory and RAG converge on one principle: the model decides what context it needs and pulls it; the server stops pushing "just in case".

### D1 — Single vector store, true ANN, for all persistent knowledge sources

`KnowledgeVectorChunk` becomes the single read-time retrieval store for the persistent sources (`assistant_knowledge_source`, `global_knowledge_source`, `product_knowledge_text_entry`, `skill_document`, `skill_knowledge_card`). The document/product read path is switched from the legacy in-process "first-N-by-table-order + cosine" to the existing pgvector ANN query (`ORDER BY embedding_vector <=> query::vector`), the same path skills already use. A pgvector **HNSW** index is added on `embedding_vector` (raw-SQL Prisma migration) so retrieval is true nearest-neighbour, not a full scan.

The legacy per-source JSONB chunk read path and its dual-persist write (`persistLegacyChunkRows`, the `embeddingVector Json?` columns on `*_chunks`) are **retired** in the same program — no parallel store, no dead columns. One store, one path.

### D2 — Honest relevance: mandatory rerank + relevance floor on every source; empty is allowed

- The LLM reranker becomes **mandatory** on the candidate set for all sources (no fail-open to lexical order); when the helper is unavailable the engine falls back to ANN-score order **but still applies the floor**, it does not widen results.
- `passesRelevanceFloor` (or an equivalent score+margin gate) is applied to **all** sources including documents/files — not just memory/chat.
- The `MIN_CONTEXT_ITEMS = 4` floor is **removed**. If nothing clears the bar, retrieval returns **empty**. No-answer beats wrong-answer.

### D3 — Pull-first, universal (project and ordinary)

The always-on server pre-push is removed for **all** modes:

- `resolveRetrievedKnowledgeContext` server pre-orchestration and `gatherProfile: "project"` whole-file extraction are removed.
- Project precheck stops setting `useUserKnowledge = true` unconditionally; instead it **guarantees the retrieval tools are projected** (`knowledge_search`, `knowledge_fetch`, files) and lets the model pull.
- The model retrieves via `knowledge_search` → `knowledge_fetch`. The existing per-source daily-quota and turn caps (ADR-074) bound the loop.
- Project files are **read on demand via the files tool** (they are already announced to the model in the developer block manifest with per-file descriptions); they are **not** vector-indexed and **not** whole-file pushed.

### D4 — Snippet-first search (the Anthropic progressive-disclosure pattern)

`knowledge_search` returns **snippets + reference id + score only**. Content is obtained through an explicit `knowledge_fetch`. Inline document inflation in search is removed: `smartSearchShortDocChars` and `smartSearchMediumDocChars` default to `0`, and "Smart search inline" defaults off (`lean`). The single principled exception is an **atomic unit whose snippet equals its full content** (e.g. a small `skill_knowledge_card`), where a fetch would add nothing — these may return whole in search.

### D5 — Memory JIT: stop pushing facts; durable core stays; recall becomes pull

- The always-on **pushed contextual short-memory block is removed entirely** (`<persai_memory>` volatile contextual entries no longer spliced before the user question). This eliminates memory bleeding by construction (nothing cross-chat is pushed) and clears the recency zone.
- **Durable identity/core memory is unchanged** — it remains in the stable cache prefix (`durable_memory_core`, primacy zone), shown at session start, global by design.
- The **recency zone is reserved** for `<system-reminder>` and the user's question only (aligns with ADR-119 scenario reminders).
- **Open loops** render in the developer zone, scoped to **the current chat** (`chatId = current`) and **open only** (`resolvedAt IS NULL`), relevant subset only. A `chatId` index is added to the memory registry table.
- **Old / cross-chat memory recall** becomes **pull**: the existing `knowledge_search` `memory` source is the recall path. Memory recall uses its stored embeddings with the same relevance floor; because the per-assistant memory set is small, scoped in-process cosine over a chat/assistant-bounded candidate set is acceptable (documents need ANN; memory does not).

### D6 — `<persai_retrieved_knowledge>` push contract is superseded by pull

Since retrieval is pull-first universal, retrieved knowledge flows back as **tool results**, not as a volatile push block. ADR-120 therefore **supersedes** the ADR-119 expectation that `<persai_retrieved_knowledge>` is filled by an always-on push: the always-on push is retired and the flat `# Retrieved Knowledge Context` developer block is removed. The XML tag is **not** left as a dormant unfilled contract; `docs/API-BOUNDARY.md` / `docs/ARCHITECTURE.md` are updated to record that retrieved knowledge is delivered via the `knowledge_search`/`knowledge_fetch` tool channel. (Tool-result presentation formatting, if any, lives in the tool-result renderer, not as a volatile-context kind.)

### D7 — Collapse the knob zoo into three presets

The ~20 raw retrieval knobs collapse into **`lean` / `balanced` / `rich`** presets that set all values atomically. Raw fields move to an "advanced" disclosure for rare overrides. Target values per the calibration table below; the engine fix (D1/D2) is what makes these meaningful, so values trend **down** (precision), not up.

| Knob | Was | Target (balanced) | Note |
|---|---|---|---|
| Default results | 7 | 5 | precision > recall in the answer |
| Hard max results | 12 | 8 | volume ceiling |
| Vector candidate pool | 400 | 400 | breadth before rerank — only meaningful once it is true ANN top-N |
| Lexical candidate pool | 100 | 100 | feeds hybrid + rerank |
| Helper rerank | optional | mandatory | D2 |
| Fetch max chars | 20 000 | 8 000 | one fetch = focus section, not a dump |
| Short-doc inline | 4 000 | 0 | snippet-first (D4) |
| Medium-doc inline | 20 000 | 0 | snippet-first (D4) |
| Smart search inline | on | off (lean) | snippet-first (D4) |

---

## Target architecture

### Before (current state)

```
turn → project precheck: useUserKnowledge = true (unconditional)
     → turn-execution.resolveRetrievedKnowledgeContext (server PUSH)
         → orchestrateRetrieval(gatherProfile="project")
             → read-assistant-knowledge document search
                 → first 400 chunks BY TABLE ORDER → in-proc cosine > 0.18
                 → MIN_CONTEXT_ITEMS=4 floor (always ≥4)
                 → + up to 2 whole project files
     → flat "# Retrieved Knowledge Context" developer block (large, often irrelevant)
     → <persai_memory> contextual facts (assistant-scoped) spliced before user question (bleeding)
```

### After (this ADR)

```
turn → tools projected: knowledge_search (snippet-first) + knowledge_fetch + files
     → model decides it needs a lookup
         → knowledge_search → KnowledgeVectorChunk pgvector ANN (HNSW)
             → hybrid candidates → MANDATORY rerank → relevance floor
             → snippets + ref id + score   (empty if nothing clears the bar)
         → knowledge_fetch(ref) → focused section content
     → recency zone = <system-reminder> + user question only
     → durable core memory = stable prefix (unchanged)
     → open loops = developer zone, current chat + open only
     → old/cross-chat recall = knowledge_search source=memory (pull)
```

Key invariant: the server never pushes "just in case" context. The model owns retrieval; the engine returns honest, nearest-neighbour, reranked, floored results, or nothing.

---

## Work plan

Memory slices land first (smaller, kill the live bleeding + recency pollution), then the RAG engine, then pull-first, then config and closure. Order: 1, 2 (memory) → 3, 4 (engine) → 5 (pull-first) → 6 (config) → 7 (docs + closure).

**Verification gate** (every slice ends green):

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`
5. `--filter @persai/runtime`, `@persai/provider-gateway`, `@persai/runtime-contract` typecheck
6. Affected package tests.

### Slice 1 — Memory: retire the pushed contextual short-memory block

- Remove the always-on contextual short-memory hydration + the `<persai_memory>` contextual splice in the provider clients (Anthropic + OpenAI volatile path). Durable core prefix unchanged.
- The `memory` source remains available to `knowledge_search` (pull recall path) — no change to the tool.
- Tests: assert no contextual `<persai_memory>` entries are spliced; durable core prefix snapshot unchanged; cross-chat fact never appears in another chat.
- Acceptance: bleeding eliminated by construction; recency zone carries only `<system-reminder>` + question; gate green.

### Slice 2 — Memory: open loops scoped to current chat + open-only

- Scope the open-loops query to `chatId = current` AND `resolvedAt IS NULL`; render in the developer zone, relevant subset only.
- Prisma migration: additive `@@index` on the memory registry table `chatId` (and `(chatId, resolvedAt)` if the query shape needs it). Migration name `adr120_memory_chat_scope_index`. Reversible.
- Tests: open loops from another chat are excluded; resolved loops excluded; index present.
- Acceptance: open loops are current-chat + open only; gate green.

### Slice 3 — RAG engine: pgvector ANN for documents + HNSW index + retire legacy JSONB store

- Switch user-knowledge + product/global document reads in `read-assistant-knowledge.service.ts` from the legacy first-N-by-table-order path to the `KnowledgeVectorChunk` pgvector ANN query (reuse `knowledge-vector-index.ts`).
- Prisma raw-SQL migration: add `hnsw` index on `knowledge_vector_chunks.embedding_vector` (cosine ops). Migration name `adr120_knowledge_vector_hnsw`.
- Retire the legacy read path and the dual-persist legacy write (`persistLegacyChunkRows`); drop the now-dead `embeddingVector Json?` chunk columns (additive-safe migration: stop writing first, then drop). No parallel store.
- Tests: ANN query returns true nearest neighbours; legacy path removed without behavioural regression on a seeded corpus; migration applies + reverts.
- Acceptance: documents retrieved via true ANN; single store; gate green.

### Slice 4 — RAG precision: mandatory rerank + relevance floor everywhere; empty allowed

- Make the helper rerank mandatory over the candidate set for all sources; on helper unavailability, fall back to ANN-score order **without** widening, floor still applied.
- Apply the relevance floor (score + top-K margin) to all sources including documents/files.
- Remove `MIN_CONTEXT_ITEMS`; allow empty retrieval.
- Tests: weak-match query returns empty; floor applied to documents; rerank invoked deterministically; no min-items injection.
- Acceptance: low-relevance results no longer slip through; gate green.

### Slice 5 — Pull-first + snippet-first; remove push; project flow to Claude-Code shape

- Remove `resolveRetrievedKnowledgeContext` server pre-push and `gatherProfile: "project"` whole-file extraction; remove the flat `# Retrieved Knowledge Context` developer section.
- Project precheck: stop forcing `useUserKnowledge`; guarantee `knowledge_search`/`knowledge_fetch`/files tools are projected; rewrite `PROJECT_EXECUTION_DEVELOPER_CONTRACT` to a pull-dispatch contract ("locate with search, read with fetch; one excerpt is not sufficiency").
- `knowledge_search` returns snippets + ref id + score only; `smartSearchShortDocChars`/`smartSearchMediumDocChars` → 0; smart inline off; atomic-card exception preserved.
- Tests: no server push on any turn; project turn projects the tools + pull contract; search returns snippets only; atomic card returns whole.
- Acceptance: model-driven retrieval in project and ordinary turns; gate green.

### Slice 6 — Config: collapse knobs into lean/balanced/rich presets

- Collapse the retrieval-policy + smart-retrieval knobs into three presets (D7 table) applied atomically; raw fields move to an advanced disclosure; admin UI + plan config + materialization wired end-to-end in one slice (no dormant field).
- Tests: selecting a preset sets all values; advanced override round-trips.
- Acceptance: founder selects one preset; gate green.

_Slice 6 landed (2026-06-20):_ Snippet-first is the new default — `DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS.smartSearchEnabled` flipped `true → false` (default-only change, no migration). Atomic-card exception added to the skill search render path: even when smart search is snippet-only, a `skill_knowledge_card` hit returns its FULL card text inline (`inlinedDocument`), capped by `min(max(plan.fetchMaxChars, plan.smartSearchShortDocChars), admin.fetchFullModeAbsoluteMaxChars)`. The admin Plans UI gains a `lean` / `balanced` / `rich` retrieval preset dropdown (UI fill-helper only — fills all 16 raw draft fields, no persisted `retrievalPolicy.preset`, no contract change) with the 16 raw knobs moved under an "Advanced retrieval knobs" disclosure. Focused tests added in `apps/api/test/read-assistant-knowledge.service.test.ts` (snippet-only document hit + full-card inline) and `apps/web/app/admin/plans/page.test.tsx` (preset fills all 16 fields; dropdown reflects custom).

### Slice 7 — Docs + golden tests + closure; full-repo verify + PUSH

- Update `docs/API-BOUNDARY.md` (retrieved knowledge via tool channel; `<persai_retrieved_knowledge>` push superseded), `docs/ARCHITECTURE.md` (pull-first retrieval; single vector store), `docs/DATA-MODEL.md` (HNSW index, memory `chatId` index, dropped legacy JSONB columns), `docs/TEST-PLAN.md`, `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md`.
- Golden tests: pull-first (no push) invariant; ANN correctness; floor/empty; snippet-first; memory non-bleeding; open-loop chat scope.
- Final: full-repository CI-like verification (lint + format:check + all-package typecheck + full tests), then PUSH (deploy trigger).

No infra changes (Helm / NetworkPolicy / RuntimeClass) are required by this ADR beyond the additive Prisma migrations.

---

## Consequences

### Positive

- **Relevance fixed at the root**: true ANN candidate selection + mandatory rerank + floor replaces the table-order bug; quality stops depending on volume knobs.
- **Less noise, sharper attention**: no always-on push; recency zone carries only the reminder + question; project stops dumping whole files.
- **Memory bleeding eliminated by construction**: nothing cross-chat is pushed; recall is pull, scoped, floored.
- **Single store, no parallel branches**: legacy JSONB chunk store retired; one pgvector path for reads.
- **Model owns retrieval**: `knowledge_search`/`knowledge_fetch` are actually used; the model decides when it needs more (the founder's intent).
- **Operability**: three presets instead of a 20-knob zoo.

### Negative

- **Extra tool round-trips** for some lookups (snippet → fetch). Mitigated by prompt caching and by snippets often answering directly. This is the deliberate Anthropic trade-off: a cheap tool call to keep context clean.
- **Migration surface**: HNSW index build on existing vector rows; dropping legacy JSONB columns is destructive (mitigated by stop-writing-then-drop ordering and reversible index migration).
- **Behaviour change in project mode**: project no longer auto-grounds; it gathers via tools. The staged contract must steer this well; covered by golden tests in Slice 7.
- **Slice 3 + 5 are the highest-risk** (read-path swap; push removal). Golden tests precede push.

### Out of scope

- Vector-indexing ephemeral chat-attached files (read via files tool on demand instead).
- Re-embedding model migration / multi-embedding-model support.
- Sandbox / shell execution model (separate ADR).
- Scenario step progression (ADR-119 founder-acceptance follow-up; separate ADR).
- A gated low-latency push optimization for explicit-recall turns — intentionally **not** built (no dormant scaffolding); revisit via a future ADR only if live latency on simple lookups proves painful.

---

## Alternatives considered

### Alternative A — keep push, just fix the candidate bug and raise the floor

Fix the table-order bug and add a document relevance floor, but keep the always-on server push (including project whole-file extraction).

**Why rejected**: it leaves the model unable to decide ("under-used tools" symptom persists), keeps the recency/attention pollution, and keeps the project over-injection. It treats the relevance symptom without removing the structural cause (push pre-empts pull). It also keeps two parallel consumption paths (push block + tools).

### Alternative B — index everything (incl. chat files) into the vector store and push a unified ranked block

Build one global similarity pool across all sources and chat files, push the top-K every turn.

**Why rejected**: still push; still pollutes attention; adds a heavy indexing path for ephemeral files; and a single global ranking obscures source roles the model benefits from choosing explicitly. Higher cost, same anti-pattern.

### Alternative C — keep the legacy JSONB chunk store alongside the pgvector store

Switch reads to ANN but keep writing/keeping the JSONB chunks for safety.

**Why rejected**: leaves a parallel store and dead columns — exactly the "legacy tails / parallel branches" the program forbids. One store, one path.

---

## Rollout and safety

1. **Memory slices (1–2) first**: they remove pushed context and scope open loops with no retrieval-engine risk; bleeding is fixed immediately.
2. **Slice 3** swaps the document read path; a seeded-corpus golden test asserts ANN parity/superiority before the legacy path is deleted. The HNSW migration is reversible; the column drop is ordered after writes stop.
3. **Slice 5** removes push; the pull contract + tool projection must be in place in the same slice so project turns are never left without a retrieval path. Golden tests assert tools are always projected when knowledge is available.
4. **No production push/deploy** until the final slice runs full-repository verification. PUSH is the explicit last step and triggers deploy.
5. Existing retrieval telemetry (`KnowledgeRetrievalEvent`) is used to compare pre/post relevance and result-count distributions.

---

## Open verification items

Code-level spot-checks during implementation (do not block acceptance):

1. **HNSW vs ivfflat** on the live pgvector version: confirm `hnsw` availability and cosine ops class (`vector_cosine_ops`) against the deployed Postgres/pgvector image before Slice 3 ships; fall back to `ivfflat` only if `hnsw` is unavailable.
2. **Embedding dimension** on the `embedding_vector` column must match the active embedding model before building the ANN index.
3. **Reranker latency budget**: mandatory rerank adds an LLM call on the retrieval path; confirm the 20s helper timeout and quota interplay keep turn latency acceptable; if not, bound candidate count rather than making rerank optional.
4. **Memory recall scope** for `knowledge_search source=memory`: confirm whether cross-chat recall should be assistant-wide or also offer current-chat-only narrowing.

---

## Closure (2026-06-20)

Status: **Accepted — closure-mode.** The program landed in all seven bounded slices. The final slice (S7) finalized docs and locked the golden invariant; full-repository verification, commit, push (deploy trigger), and the post-deploy backfill are owned by the orchestrator.

### Slice status

| Slice                                                                  | Commit     | Status   |
| ---------------------------------------------------------------------- | ---------- | -------- |
| ADR opened                                                             | `d007025b` | done     |
| S1 — memory: retire pushed contextual short-memory block               | `0e36d959` | done     |
| S2 — memory: open loops scoped to current chat + open-only             | `7fd6eeb1` | done     |
| S3 — RAG engine: pgvector ANN for documents + idempotent backfill      | `1ae3c201` | done     |
| S4 — RAG precision: rerank + relevance floor everywhere; empty allowed | `fce1e698` | done     |
| S5 — pull-first + snippet-first; push subsystem removed                | `89046014` | done     |
| S6 — config: lean/balanced/rich presets + snippet-first default        | `951580bd` | done     |
| S7 — docs + golden tests + closure                                     | HEAD-of-main after the S7 push | done |

### Shipped reality vs. the original plan

The decision body (D1, D3, Slice 3) called for retiring the legacy JSONB chunk read path **and** its dual-persist write **and** dropping the dead columns, plus building an HNSW ANN index in the same program. Two founder closure decisions deliberately defer parts of that to dedicated follow-ups so the high-risk read-path swap and push removal could ship first behind rollback safety:

- **True ANN ships now via sequential scan.** Document reads use the unified `KnowledgeVectorChunk` pgvector query (`ORDER BY embedding_vector <=> query::vector`); candidate selection is genuine nearest-neighbour. The **HNSW index is the only deferred performance optimization**, not a correctness gap.
- **The legacy JSONB chunk write is retained this release** (the dual-persist still runs) so the previous read path remains a viable rollback if PROD vector reads regress. No legacy read path is used in the active product path.

### Tracked residual follow-ups (NOT new scope — do not reopen this program)

1. **HNSW ANN index** on `knowledge_vector_chunks.embedding_vector`. The column is currently dimensionless (`vector` without a pinned `N`); pin `vector(N)` once the live embedding model/dimension is confirmed, then add the `hnsw` index with `vector_cosine_ops` (fall back to `ivfflat` only if `hnsw` is unavailable on the deployed pgvector image). This is a latency optimization over the already-correct sequential-scan ANN.
2. **Drop the legacy JSONB chunk columns** (`embeddingVector Json?` on the `*_chunks` tables) and stop the dual-persist write, in a follow-up migration ordered **after** PROD confirms vector reads are healthy and the post-deploy backfill has run (stop-writing-then-drop).

Each follow-up is a small, self-contained migration ADR/slice when scheduled. Neither is a reason to reopen ADR-120.

### Post-deploy step

After the S7 push deploys, run the idempotent parity backfill in PROD — `corepack pnpm --filter @persai/api run backfill:knowledge-vector-store` — to reconcile `KnowledgeVectorChunk` from existing source chunks, then confirm vector-store reads are healthy (relevance + result-count distributions via `KnowledgeRetrievalEvent`) before scheduling the two follow-ups above.

### Golden invariant locked

The ADR-120 prompt reality is locked by explicit assertions in both prompt-snapshot tests (`apps/runtime/test/adr119-golden-prompt-snapshot.test.ts`, `apps/api/test/adr119-golden-prompt-snapshot.test.ts`): no `<persai_memory>` contextual push in the recency zone (S1); no flat `# Retrieved Knowledge Context` developer block and no pushed `<persai_retrieved_knowledge>` block anywhere (S5 / D6); and a positive check that `knowledge_search` / `knowledge_fetch` are the pull retrieval path.
