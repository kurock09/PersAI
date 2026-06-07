# ADR-112: Context, Memory, and Tool-Surface Quality Program

## Status

Accepted (2026-06-07). Program open; slices pending.

This is an orchestration program ADR in the same operating model as ADR-110. The parent agent acts as orchestrator and reviewer; production-code implementation is delegated to GPT 5.4 subagents. Baseline SHA at program open: `b4fbe24c` (working tree was concurrently dirty with separate ADR-111 UI/video work and the ADR-110 contextual-memory cache fix; each slice records its own clean baseline SHA at start).

This ADR is about the **quality of what the model is given and what the model writes back** — durable memory, the per-turn prompt blocks, the developer block and file/media references, background jobs/turns, the background model-call prompts, and the tool descriptor/instruction surface. It does not change provider/model routing (ADR-110), file storage architecture (ADR-081), media job execution (ADR-086/105/107/109), or the scheduler architecture (ADR-091); it cleans the context and instruction quality that sits on top of them.

## Orchestration Rule

Implementation work under this ADR must follow this operating model:

- The parent agent is the **orchestrator**.
- GPT 5.4 subagents do the implementation work.
- The orchestrator writes the slice task, assigns it to subagents, **audits** the diff, verifies tests, and either accepts, resumes, or rejects the output.
- The orchestrator must not directly implement production-code changes unless the user explicitly permits it for a specific fix.
- Subagent prompts must be bounded: exact scope, non-goals, likely files, required tests, and invariants.
- Every subagent task must say: start the slice cleanly and honestly, do not build a parallel replacement path beside the old one, and remove or supersede the old active truth in the same slice. Temporary dual-read/dual-write is allowed only at a persisted-data migration boundary, and the cleanup condition must be named before implementation starts.
- Subagent summaries are not trusted blindly; the orchestrator verifies code and tests against the slice acceptance criteria.

## Audit Grounding

Five read-only GPT 5.4 audits were run before setting this ADR scope:

1. Durable-memory subsystem (write -> classify -> store -> retrieve -> render).
2. Prompt assembly and developer block (files/media/images).
3. File/media alias and numbering system.
4. Background jobs and background turns.
5. Tool descriptor and instruction hygiene.

Confirmed current truth (the defects this ADR addresses):

### A. Memory formation

- Classification is purely syntactic: `classifyDurableMemoryWriteClass` in `apps/api/src/modules/workspace-management/domain/memory-class-policy.ts:26-36` sends every `fact`/`preference` to always-on `core`; only `open_loop` and `web_chat` go to `contextual`.
- The `kind` taxonomy conflates **identity-preference** ("likes terse answers") with **episodic/task intent** ("wants a talking-avatar video in Italian"). The latter therefore lands in the always-on, cache-stable core block and is injected on every turn (observed live: an unrelated chat carried a core block of ~11 one-off video wishes).
- `web_chat` memory is written after **every** successful web turn unconditionally (`apps/api/src/modules/workspace-management/application/record-web-chat-memory-turn.service.ts:47-60`), so trivial turns like "Привет · Привет" become searchable contextual noise.
- There is no server-side semantic quality gate at write time; only string normalization (1-500 chars) and a source/trust policy.
- Retrieval: core hydration ignores query/relevance (`apps/api/src/modules/workspace-management/application/hydrate-memory-for-turn.service.ts`); contextual search has a relevance floor (`passesRelevanceFloor` in `read-assistant-knowledge.service.ts`) but is lexical `contains` with a `+9` source bias for `memory_write`.
- Render drops `score` and `createdAt` and emits `- [label] summary` only (`apps/runtime/src/modules/turns/turn-context-hydration.service.ts:1570-1588`). `lastUsedAt` is bumped on hydrate but never used in scoring.
- Only the one-time M1 SQL migration ever classified rows; episodic preferences already stored as `core` were never reclassified.

### B. Prompt / block formation

- Per-turn prefix order is fixed: `durable_memory_core` (stable) -> `cross_session_carry_over` (turn-0/long-idle only) -> `rolling_session_synopsis` (if compacted) -> `durable_memory_contextual` (volatile). ADR-110 already moved the volatile contextual block out of the cached prefix via the typed `cacheRole: "volatile_context"` flag.
- The contextual block carries a double header (provider wrapper `<persai_contextual_memory>` plus the inner `[Relevant memories retrieved for this turn ...]`), no grouping by kind, and no relevance/recency signal.

### C. Developer block + file/media confusion

- 7+ overlapping alias namespaces (`current/previous/generated/recent/found/listed/fetched/read`) with no single map.
- `previous attachment #N` means different things in `listAvailableWorkingFileRefs` (counts all attachment kinds) vs `listAvailableImageToolAttachments` (counts images only).
- Historical images are text-only aliases; the model sees pixels for the current turn only. `showCurrentTurnImageOrdinals` is plumbed but never used.
- The developer block is projected after the user message (and after tool history in the loop), so high-recency operational context sits below the user text.
- The section header `## File history (newest first)` does not match the "Working Files" name used in tool schemas.

### D. File alias stability

- Aliases are recomputed positionally every turn (and every tool-loop iteration); they are not persisted on `AssistantFile`. Numbering shifts when a file is added (what was `#1` becomes `#2`), so a stable file gets a moving label (`apps/runtime/src/modules/turns/turn-context-hydration.service.ts` sites ~577-611 and ~399-466). The only stable identity is `fileRef` (UUID), which is intentionally hidden from the model (ADR-081).

### E. Background jobs + background turns

- After delivery there is no "recently completed job" signal; the model learns of a finished job only via hydrated history on the next turn. `completion_pending` is reported as still-open, so the model may say "still generating" after the worker finished.
- Race: a user turn can be hydrated while delivery is in flight.
- The `audio` async lane is declared in the contract but `tts` is synchronous; there is no `audio_generate` worker tool.
- Framing noise: the media/document completion turn injects the full persona `systemPrompt` alongside narrow framing rules.

### F. Background model-call prompts

- Every background call has its own prompt (background_task 2-phase, auto-compaction, auto-extract, media/document completion framing, turn router, skill-state classifier, cross-session carry-over). Confirmed junk: the `heartbeat` template is actually background-task evaluation (misnamed); `checkReason` (`background_bootstrap`/`background_cadence`) is not surfaced into the skill classifier; the compaction-advisory reuses the heavy 2-phase background_task pipeline for a one-line nudge; two distinct jobs share the `background_task_evaluation` classification.

### G. Tool descriptor + instruction hygiene

- Param contradictions: `doc_id` (prose) vs `docId` (schema); `path` (schema) vs `relativePath` (guidance); `knowledge_fetch` schema is missing the required `mode`/`radius` that its `usage_guidance` mandates.
- Ghost/dead operations: `background_task` advertises an `update` action absent from its enum; `scheduled_action` test/policy still references `assistant_check`.
- Stale vocabulary: catalog `action="deferred"` vs runtime `pending_delivery`; catalog codes `memory_search`/`memory_get`/`persai_tool_quota_status` vs runtime `knowledge_search`/`knowledge_fetch`/`quota_status`; OpenClaw-era `cron` tool and `TOOLS.md` reference.
- Naming split: one block is labeled `working_files` / `## File history (newest first)` / "Working Files block"; `Settings -> Characters` vs `Assistant Settings -> Characters`.
- Duplication: the `pending_delivery`/`skipped`/`quota_status` paragraph is copy-pasted across four tool schemas plus the developer delivery-honesty section.
- ADR-id cruft in model-facing param docs (e.g. `memory_write` "ADR-074 Slice M3.1 ...").
- 8 tools were assessed clean: `web_search`, `web_fetch`, `browser`, `tts`, `exec`, `shell`, `compact_context`, `summarize_context`.

## Decision

Adopt a single quality program with seven workstreams (A-G). The unifying principle is: **the model is given clean, stable, relevance-ranked context and a single coherent instruction/tool vocabulary, and memory is formed by model judgment rather than heuristics.**

### A. Memory formation methodology — model-as-judge, NOT heuristics

Deciding what to remember, at which durability, is a semantic judgment. The model decides; the system only structures, routes, dedups, and consolidates. Heuristics are allowed only as a cheap guardrail (reject empty/too-short/obvious exact dupes), never as the deciding layer.

- **Layer 1 - capture.** The write path persists a richer, model-judged schema beyond `kind`: a durability signal (identity vs episodic/task) and a stability signal (timeless vs time-bound), optional confidence. Core/contextual/skip routing becomes deterministic on those model-emitted semantic fields, not on string parsing. `memory_write` guidance is tightened to reduce over-writing.
- **Web-chat capture gate.** Trivial turns (greetings, acknowledgements, content with no durable signal) are not stored. Web-chat auto-write becomes salience-gated rather than unconditional.
- **Layer 2 - normalize.** Dedup/merge by semantic similarity (embeddings / the existing semantic rerank), not exact-string matching.
- **Layer 3 - consolidate.** A periodic background LLM reflection pass (extending the existing post-compaction auto-extract) merges items, promotes/demotes class, and prunes stale or contradicted items. An episodic note becomes a stable fact only if it recurs.
- **Layer 4 - lifecycle.** Supersession (new overrides old), recency/usage decay, and explicit forgotten/resolved, so changed facts do not resurface as current.
- **Retrieval/render.** Apply a relevance threshold and sort by score; semantic dedup of contextual vs core; drop low-value items; stop discarding `score`/`createdAt` at render. Core stops being an unfiltered always-on dump of episodic content.
- **Backfill.** A safe one-shot reclassification of already-polluted rows (episodic `core` -> `contextual`) plus pruning of trivial `web_chat` memories, gated by a dry-run report and step-up confirmation.

### B. Prompt / block formation

Finalize the contextual-memory block as a single, runtime-owned, semantically grouped block: one framing owned by the runtime (not duplicated per provider), grouped by kind (PREFERENCES / FACTS / OPEN LOOPS), a single header (drop the double header), optional recency on facts. Confirm block ordering and developer-instruction placement relative to the user message. This builds directly on the ADR-110 `cacheRole` typed-flag work and must not regress prompt-cache stability.

### C. Developer block + file/media references

Collapse the overlapping alias namespaces into one coherent scheme, remove the dual meaning of `previous attachment #N`, decide how prior images are anchored, align the developer section title with tool-schema vocabulary, and remove the dead `showCurrentTurnImageOrdinals` plumbing. The developer block stays provider-native (OpenAI `developer`, Anthropic `user`-wrapped) per ADR-110.

### D. File alias stability — sticky model

A file gets a **stable label assigned at first appearance that never changes for the chat lifetime**. Recency ("just sent", "latest generated", "this turn") is expressed as a separate marker, not by renumbering. Execution identity remains `fileRef` (UUID); the sticky label is the model-facing handle. This eliminates the "file stays but its number moves" confusion.

### E. Background jobs + background turns

Give the model a clear, timely completion signal (a "recently completed jobs" surface) and stop presenting `completion_pending` as still-open. Address the hydration/delivery race. Reduce completion-turn framing noise (do not inject the full persona `systemPrompt` into a narrow framing call). Finish or explicitly close the `audio` async lane decision.

### F. Background model-call prompt hygiene

Audit every background model-call prompt for a consistent style and remove noise/dead/misleading copy: rename the misnamed `heartbeat` template, surface `checkReason` where the classifier needs it, stop reusing the heavy 2-phase pipeline for one-line advisories, and split the shared `background_task_evaluation` classification so distinct jobs are observable.

### G. Tool descriptor + instruction hygiene

Make the tool surface internally consistent and free of legacy cruft: fix param-name contradictions, remove ghost actions and dead enums, retire OpenClaw-era vocabulary (`cron`, `TOOLS.md`, `deferred`, `memory_search`/`memory_get`/`persai_tool_quota_status`), unify the one-block naming, de-duplicate the delivery-honesty paragraph into a single source, strip ADR-id cruft from model-facing docs, and align all alias examples with the new sticky-alias scheme from D.

## Non-goals

- No change to provider/model routing or fallback (owned by ADR-110).
- No new vector pipeline; reuse ADR-073/079 hybrid retrieval and the existing semantic rerank.
- No change to file storage architecture (ADR-081) or media job execution/economy (ADR-086/105/107/108/109).
- No reintroduction of OpenClaw runtime/filesystem memory or deploy wiring.
- No heuristic rule-engine as the deciding layer for memory; heuristics only as cheap guardrails.

## Slice backlog

Each slice is one bounded session, implemented by a GPT 5.4 subagent and reviewed by the orchestrator. Each slice must pass the AGENTS.md verification gate (`lint`, `format:check`, `@persai/api` typecheck, `@persai/web` typecheck) plus its own focused tests, and must regenerate contracts if `runtime-contract`/OpenAPI changed.

- **Slice 1 - Memory capture schema + classification + web-chat gate (A Layer 1).** DONE (2026-06-07) — `memory_write` + auto-extract now carry model-emitted `durability` / `stability` (+ optional `confidence`); write routing is semantic (`identity+stable -> core`, otherwise contextual, negative-guardrail skip); trivial web-chat greeting/ack turns are suppressed; Prisma rows gained nullable durability/stability/confidence columns; guidance/tests updated. No heuristic deciding layer.
  - Acceptance: episodic task-wishes no longer land in core; greetings are not stored; existing memory tests pass; new tests cover identity-vs-episodic routing.
- **Slice 2 - Memory retrieval/render quality + single runtime-owned framing (A retrieval/render + B).** DONE (2026-06-07) — runtime-facing hydration (`hydrate-memory-for-turn.service.ts`) now drops trivially-non-durable contextual hits via the Slice 1 negative guardrail (`isObviouslyNonDurableMemorySummary`, so legacy greeting/ack rows that pass the lexical exact-token floor no longer hydrate) and de-duplicates contextual vs core by `normalizeMemoryText` (not just id), preserving `searchMemory`'s relevance order. The contextual block is rendered as ONE volatile block under the existing header, deterministically grouped by kind (`Preferences -> Facts -> Open loops -> Other`) inside `formatDurableMemoryContextualBlock`, still carrying `cacheRole: "volatile_context"` and still placed last in the prefix. The volatile-context cache invariant is now locked by a provider-gateway guard test (the flagged block is re-projected as a non-cacheable `user` block before the question, never carries `cache_control`), and the core stable token is asserted invariant under contextual rotation. No embeddings, no consolidation, no backfill (later slices). No heuristic deciding layer.
  - Acceptance: contextual block is one grouped block; low-relevance noise (e.g. greeting matches) dropped; provider cache stability unchanged (ADR-110 tests green). MET.
  - Cache effectiveness regression: ALREADY FIXED + live-VERIFIED 2026-06-07. The earlier "harmless 27-375 token micro-write, source unknown" framing was wrong and is retracted. Direct query of `runtime_turn_receipts.result_payload.usageAccounting` against `persai-dev` (session `78ae7b44`, 28 turns, `claude-sonnet-4-6`) shows two regimes split exactly at the ~18:25 UTC deploy boundary of the typed-`cacheRole` contextual-memory fix (see SESSION-HANDOFF "Contextual-memory prompt-cache PROD fix (typed flag)"; the `volatile_context` marker is present in the running provider-gateway `dist`):
    - PRE-FIX / wasteful (e.g. 10:38, 14:55-15:05, 16:15-16:17): consecutive single `main_turn` calls keep `cacheRead` PINNED at the ~14.1k system block (`14138`) while `cacheCreation` is a large, growing history segment RE-WRITTEN every turn that never converts to a read (`3114, 3120, 3144` -> later `10584, 10547, 10520, 10528`). Worked example (16:15-16:17, 4 turns): per turn ≈ `input 8.2k @1.0 + write 10.5k @1.25 + read 14.1k @0.1 ≈ 22.7k` token-units vs ideal cached ≈ `10.7k` — ~2x inflation growing with session length. Root cause was the volatile `durable_memory_contextual` block sitting in the cacheable prefix before the moving-history breakpoint, busting the prefix match every turn.
    - POST-FIX / healthy (18:47-19:11, same session, same loaded chat): `cacheRead` grows monotonically (`31774 -> 31786 -> ... -> 34203`) with `cacheRead[n+1] ≈ cacheRead[n] + cacheCreation[n]` and writes shrink to the genuine new tail only (`18, 19, 18, 27, 0, 375, 185, ...`). This is exactly the "do not repeat ~10.5k cacheCreation on short turns / keep history cache reads" post-deploy verification the handoff asked for — CONFIRMED. The small per-turn write the operator saw (`27`, `375`) is correct incremental caching, NOT waste: it caches this turn's new content so the next turn reads it at 0.1x; an "accumulate 3k then cache once" scheme would be strictly worse (it would pay 1.0x on the growing uncached tail every turn until the breakpoint advanced).
    - Established mechanics confirmed by live data: full rewrites (`cacheRead=0, cacheCreation≈24.6k`) occur ONLY after >5min idle gaps = Anthropic 5m TTL expiry (expected; the only legitimate large-write cause; the optional 1h TTL is intentionally not enabled). The moving-history breakpoint target is quantized to `minTailChars` steps and never moves backward.
    - Remaining Slice 2 cache work is therefore narrow: keep the ADR-110 invariant green and add a focused regression guard so a future change cannot reintroduce a volatile block into the Anthropic cacheable prefix (assert `cacheRole: "volatile_context"` messages are projected after the moving-history breakpoint, into the uncached tail). No further root-cause investigation needed.
- **Slice 3 - Memory normalization + consolidation + lifecycle (A Layers 2-4).** DONE (2026-06-07) — landed in two tightly-coupled sub-slices. **3a (substrate, `56613bff`)**: added nullable `supersededAt` / `supersededByMemoryId` columns + `markSupersededById` repo method, and made every active read/hydration/search path also exclude `supersededAt: null` (so once a fact is superseded it stops resurfacing, audit row retained). **3b (engine, `8433dd6d`)**: added lazy memory embeddings (`embedding_vector` JSONB + `embedding_model_key` + `embedding_generated_at`, model key reused from `KnowledgeModelPolicyService`) and a best-effort `ConsolidateAssistantMemoryService` that runs after each successful background compaction (reusing the existing scheduler's lease/cadence, never failing the compaction job): it lazily embeds new memories, merges near-duplicates within the same kind (cosine >= 0.92 -> supersede the loser, survivor priority core > confidence > recency > id), and decay-prunes time_bound contextual rows untouched for > 45 days. Open loops that are unresolved are never merged or pruned; identity/stable/core rows are never decay-pruned. Degrades gracefully (decay still runs) when embeddings are unavailable. Mechanical cosine merge, not a positive durability classifier.
  - Acceptance: near-duplicate memories merge (cosine supersession); a consolidation pass demotes/prunes (decay prune of stale time_bound contextual); superseded facts stop resurfacing (3a active-read exclusion). MET.
- **Slice 4 - Safe memory backfill (A backfill).** Dry-run report of episodic `core` rows and trivial `web_chat` rows; step-up confirmed reclassification/prune.
  - Acceptance: dry-run output reviewed before any mutation; live problem assistant verified lighter after backfill.
- **Slice 5 - Unified file references + sticky aliases (C + D).** One alias namespace; sticky per-file label; recency as a separate marker; `fileRef` stays execution identity; contract + runtime + tool consumers updated together.
  - Acceptance: adding a file does not renumber existing files; `image_edit`/`video_generate`/`files`/`document` resolve sticky labels; no parallel alias scheme left behind.
- **Slice 6 - Developer-block clarity (C).** Align section title with tool vocabulary, remove dead `showCurrentTurnImageOrdinals`, confirm placement; align tool-schema examples with the sticky scheme.
  - Acceptance: one consistent name for the working-files block across schema, developer section, and guidance.
- **Slice 7 - Background jobs visibility (E).** Recently-completed-job signal; stop showing `completion_pending` as open; address the race; resolve the `audio` lane decision.
  - Acceptance: model no longer says "still generating" after worker completion; completion is visible promptly.
- **Slice 8 - Background model-call prompt hygiene (F).** Rename `heartbeat`, surface `checkReason`, lighten compaction-advisory, split shared classification.
  - Acceptance: background prompts are consistent and observable; advisory no longer runs a 2-phase pipeline.
- **Slice 9 - Tool descriptor + instruction hygiene (G).** Fix param contradictions, remove ghost actions/dead enums, retire legacy vocabulary, de-duplicate delivery-honesty copy, strip ADR-id cruft, align with the new alias scheme.
  - Acceptance: the 40+ cited defects are resolved or explicitly deferred with reason; clean tools stay clean; seed/catalog tests updated to live truth.

Slices 1-4 are sequential within memory. Slice 6 depends on Slice 5. Slice 9 depends on Slice 5 (alias examples) but can otherwise proceed independently. Slices 7 and 8 are independent.

## Risks

- **Live-data backfill (Slice 4):** reclassifying/pruning stored memory is destructive; mitigated by dry-run + step-up and by keeping rows soft-deleted (`forgottenAt`) rather than hard-deleted where possible.
- **Alias migration (Slice 5):** changing the alias scheme touches multiple tool consumers; a stale example or a missed consumer breaks alias resolution. Mitigated by updating contract + all consumers + tool schemas in one slice and asserting resolution across `image_edit`/`video_generate`/`files`/`document`.
- **Prompt-cache regression (Slice 2/6):** reshaping blocks must not move volatile content back into the cached prefix; the ADR-110 cache tests are the guardrail.
- **Consolidation cost (Slice 3):** RESOLVED by design — the consolidation pass is mechanical (embedding generation for un-embedded rows + in-process cosine over a bounded <=200-row working set + deterministic decay), not an LLM reflection call. It runs off-band, piggybacked on the existing background compaction scheduler (lease/cadence reused) strictly after the compaction job is marked complete, and is best-effort so it can never delay or fail a user turn or the compaction job. Residual: O(n^2) cosine and per-pass embedding of newly-written rows run on every successful compaction; bounded and cheap at current memory volumes, revisit if working sets grow.

## Consequences

### Positive

- Lower per-turn token cost: core stops carrying episodic noise; contextual stops carrying greeting matches.
- Higher answer quality: the model gets relevance-ranked, grouped memory and stable file references, so it stops confusing files/images and stops treating memory as a question.
- A coherent tool/instruction surface reduces model errors from contradictory or stale guidance.
- Memory becomes principled (model judgment + consolidation + lifecycle) instead of an append-only heuristic dump.

### Negative

- Multiple slices touch the API write path, runtime hydration, the contract, and tool descriptors; coordination cost is real and the orchestration rule must be followed to avoid parallel code paths.
- The consolidation pass adds background LLM cost.
- The backfill requires operator involvement (step-up) and live verification.

## Alternatives considered

- **Heuristic write filters** (keyword/regex gates for what to store): rejected — fragile and semantically blind; this ADR uses model judgment with heuristics only as a guardrail.
- **Per-file sticky handle derived from `fileRef`** (e.g. `img-a3f`) instead of a human number: viable, but a stable human-readable number is clearer for the model; the sticky-number model was chosen for clarity.
- **Separate ADRs per area:** rejected — the areas share the same context-assembly seam and tool vocabulary; one program ADR keeps the decisions and slice ordering coherent.
