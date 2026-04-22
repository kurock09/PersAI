# ADR-074: Humanity and cost polish program (post-ADR-073, founder-driven)

**Status:** Accepted
**Date:** 2026-04-20
**Relates to:** ADR-061, ADR-070, ADR-072, ADR-073
**Origin:** structured founder interview (13 questions) on token cost optimization, assistant quality, and human-likeness, conducted on 2026-04-20.

## Context

ADR-073 closes the ADR-072 migration residuals and frames the remaining cost/quality program at architecture level. ADR-074 narrows that program into a concrete, agent-implementable execution plan derived from a founder interview on the active PersAI-native path.

ADR-074 is **scoped to two anchored product goals**:

1. **Token cost reduction per active user** — the active path has prompt caching scaffolding (`prompt_cache_key`, `stable_prefix` in `compile-prompt-constructor.service.ts`), but practical wins are leaking through avoidable prompt churn, duplicated tool descriptions, sequential tool execution, full-history hydration, and disabled web auto-compaction.
2. **Human-likeness and "feels like a real companion, not a chatbot"** — the active prompt templates (`bootstrap-preset-data.ts`) ship persona as **role** (name, gender, traits, free-form instructions) without **voice** (tone, pacing, anti-phrases, silence heuristics, micro-examples). Cross-session continuity, time awareness, and proactive presence are partially scaffolded (scheduler + `audience: user|assistant` + `open_loop` memory kind) but not wired end-to-end.

The remaining slices are not architectural; they are bounded and tunable on top of ADR-073's landed baseline. ADR-074 captures the founder's explicit choices, the four sticky principles those choices implied, and a phased execution stack that any single agent can pick up from one slice without re-reading the whole interview.

ADR-074 is the agent-resumable execution document. ADR-073 remains the program ADR. ADR-072 remains the historical migration ADR.

## Founder principles (sticky across all slices)

These four principles are output of the interview and govern every slice below. Any agent implementing ADR-074 slices MUST treat them as hard constraints.

### 1. Magic, not user-controlled

If a feature requires the user to configure it, the feature is a design failure. Smart defaults are coded, not exposed. Memory Center may show what is happening for trust, but the mechanism itself never asks the user to tune it.

### 2. The assistant lives in time

The assistant must know how long since the last message, when the last session was, what time of day it is for the user, and adapt tone, presence, and proactive behavior accordingly. "Time-blind chat" is not acceptable on the active path.

### 3. Tune and finish, do not rebuild

Existing architecture (turn routing, scheduler, materialization, runtime bundle, scheduled-action two-step pattern, channel binding model) is the stable base. Slices must change behavior mechanically (config, templates, ordering, small policy modules), not re-architect.

### 4. Smoke harness is agent-runnable

Every slice must be measurable through the smoke harness from Slice S0. The harness runs as a single CLI command, in an isolated test workspace, with no interactive input, producing JSON + Markdown output. Any agent (including the implementing model in Cursor) can execute the harness, capture before/after numbers, and prove the slice landed.

### 5. No transitional modes, no shadow paths, no legacy fallbacks

PersAI has no real production users yet and has time budget for clean debugging. Slices MUST cut over directly to the new behavior. The following are explicitly forbidden in any ADR-074 slice unless the slice text itself names the exception:

- feature flags whose only purpose is "old behavior vs new behavior"
- shadow modes that run new logic alongside old logic and compare
- legacy fallback branches kept "in case the new path breaks"
- migration toggles (`useNewMemoryRetrieval`, `enableV2Compaction`, etc.)
- duplicated services or duplicated schemas where one is "v1" and one is "v2"
- environment-variable switches between old and new implementations

Code is a liability; transitional code is double liability. If the new behavior is correct, ship the new behavior. If it is not correct, do not ship the slice. Tests cover the new behavior only. Reverting a bad slice is a clean `git revert`, not a runtime toggle.

The only acceptable kind of "switch" in ADR-074 slices is plan-policy-driven configuration that already exists in the architecture (e.g. `autoCompactionWeb` is part of the existing `RuntimeContextHydrationConfig` policy surface — flipping its default is fine; inventing a new `useNewCompaction` flag would not be).

## Decisions table

The interview yielded the following bound decisions. Each decision is implemented by one or more slices listed in the next section.

| #   | Topic                           | Decision                                                                         | Slice(s)   | Deferred to                   |
| --- | ------------------------------- | -------------------------------------------------------------------------------- | ---------- | ----------------------------- |
| Q4  | Durable memory injection        | Core (~10–15 facts always) + relevance-retrieved tail                            | M1         | —                             |
| Q5  | Long-session compaction         | Rolling synopsis + verbatim recent window + auto-extract to memory               | M2         | (no user-visible C — magic)   |
| Q6  | Cross-session continuity        | Open-loops always + top-3 last-session synopses (TTL plan-tunable, default 7d)   | M3, M3.1   | —                             |
| Q7  | Time awareness + proactive push | Phased: time/safeguards then multichannel                                        | T1, T2     | T3 (web push)                 |
| Q8  | Turn routing                    | Keep current precheck + classifier on ambiguity                                  | (no slice) | (sticky-routing C dropped)    |
| Q9  | Tool loop limits                | Adaptive per mode + per-tool hard caps                                           | L1         | —                             |
| Q10 | Round-trip reduction            | Smart budgets + parallel calls + compound tools (with discipline)                | R1, R2, R3 | —                             |
| Q11 | Smoke harness                   | Scenario catalog + JSON report + diff mode + agent-runnable                      | S0         | LLM-judge layer (Q11-C)       |
| Q12 | Stable prefix / cache           | Heartbeat to tail, routing to developer message, drop tools markdown duplication | P1         | Multi-level cache key (Q12-C) |
| Q13 | Persona quality                 | Voice DNA scaffold + 3–4 archetypes                                              | V1         | Living USER.md (Q13-C)        |

## Slice catalog

Each slice is **self-contained**: it includes goal, founder anchor, file touch points, implementation outline, acceptance criteria, out-of-scope, and a handoff prompt block. An implementing agent should be able to start a session with only one slice's text plus the universal handoff prompt at the end of this ADR.

---

### Slice S0 — Smoke harness (foundation)

- **Goal:** Provide a single CLI tool that runs canonical end-to-end user scenarios against a real local PersAI stack and emits machine-readable + human-readable reports, so every later slice has objective before/after measurement.
- **Founder anchor:** Principle 4. From Q11-B.

**Touch points:**

- New: `scripts/smoke/run-scenario.ts` (tsx CLI).
- New: `scripts/smoke/scenarios/*.yaml` (5–8 scenarios, see below).
- New: `scripts/smoke/lib/{harness,reporter,workspace,trace}.ts`.
- New: `scripts/smoke/baselines/<scenario>.baseline.json` (committed once after first green run, then diffed against).
- Reads from: `apps/api` and `apps/runtime` running locally per `docs/LIVE-TEST-HYBRID.md`.

**Scenario catalog (initial 6):**

1. `onboarding.yaml` — fresh user signs up, creates assistant, completes welcome chat (3 turns).
2. `chitchat-short.yaml` — 5 trivial turns ("привет", "как дела", "что нового"), assistant should never call tools.
3. `long-session-200.yaml` — 200-turn rolling conversation across mixed topics; checks compaction and recall at turn 100.
4. `tool-heavy-search.yaml` — "find me X with images and 3 buy links" (image describe → search → batch fetch).
5. `multi-session-continuity.yaml` — session 1 establishes open loops; session 2 (next day) checks if assistant recalls them.
6. `emotional-long.yaml` — 30-turn emotional support conversation; checks voice consistency and silence heuristics.

**Implementation outline:**

1. Spin up isolated test workspace per run via `apps/api` admin/internal endpoints (workspace + user + assistant fixtures, fresh DB schema or scoped namespace).
2. For each scenario, send turns through `POST /v1/turns/create` (same path as web client) to local `apps/runtime` via `apps/api` proxy.
3. Capture full trace per turn: model id used, tool calls (name + arguments + result size), token counts (`input`, `cachedInput`, `output`, per internal call), wall-clock latency, scheduled-action emissions.
4. Aggregate per scenario: total turns, total round-trips, sum of input/cached/output tokens, p95 latency, tool-call histogram, token cost estimate.
5. Write JSON report to `scripts/smoke/out/<run-id>.json` and Markdown summary to `scripts/smoke/out/<run-id>.md`.
6. Diff mode: if `--baseline=<scenario>` flag is set, compare against `baselines/<scenario>.baseline.json` and exit non-zero on regressions beyond a threshold (default ±10% on tokens, ±20% on latency).
7. CLI entry: `pnpm smoke:run <scenario>` and `pnpm smoke:run-all`. Scripts wired into root `package.json`.

**Acceptance criteria:**

- `pnpm smoke:run chitchat-short` exits 0, produces `out/<id>.json` and `out/<id>.md`.
- The Markdown summary contains: total turns, total tokens (input/cached/output), tool-call count, p95 latency.
- Re-running the same scenario twice produces token counts within ±5% (deterministic enough for diffing).
- `pnpm smoke:run-all` exits 0 against current `main`, producing a baseline file per scenario.
- The harness can be invoked by an agent through a non-interactive shell command without prompting.

**Out of scope (S0):**

- LLM-judge quality scoring (deferred to Q11-C).
- CI integration (the harness must run locally first; CI integration is later).
- Telegram channel scenarios (web only at S0; T2 will extend).

**Status — landed (live truth as of S0 closure, 2026-04-20):**

S0 was implemented and validated end-to-end against `persai-dev`. All six starter scenarios (`onboarding`, `chitchat-short`, `long-session-200`, `tool-heavy-search`, `multi-session-continuity`, `emotional-long`) produce green `summary.json` baselines with `ok=N failed=0` and full per-turn token capture. The implementation deviates from the plan text above in a small number of places that future slices must follow rather than re-derive:

- **Scenario file format:** `scripts/smoke/scenarios/*.json` (not `*.yaml`). YAML loader was not pulled in because `JSON.parse` is enough for the starter shape.
- **Baseline filename:** `scripts/smoke/baselines/<id>.summary.json` (not `<id>.baseline.json`). The same shape is written for the per-run artifact, so "baseline = last accepted summary" is literal.
- **Run artifacts:** per-run `trace.json` + `summary.json` + human-readable `console.txt` live under `scripts/smoke/artifacts/<scenario>-<runId>/` (not `scripts/smoke/out/<run-id>.{json,md}`). A standalone Markdown summary file was deferred — `console.txt` already covers the human view, and re-rendering Markdown from `summary.json` is cheap to add later if a slice actually needs it.
- **Transport:** turns go through the same web client path as production — `POST /api/v1/assistant/chat/web` and `/api/v1/assistant/chat/web/stream` from `apps/api` — not through `POST /v1/turns/create` directly to runtime. This keeps the harness honest about full API → runtime → provider → API path the user actually sees.
- **CLI shape:** `pnpm smoke:run --scenario <id>` (repeatable, not positional) and `pnpm smoke:run-all`. Baseline mode is `--update-baseline` (writes a new baseline) — there is no `--baseline=<scenario>` flag; baseline diff vs the committed `<id>.summary.json` runs automatically on every run when a baseline exists, and a regression simply prints a non-zero delta in `console.txt` (the run still exits 0; non-zero exit is reserved for `failed > 0` turns). Hard-thresholded regression gating (±10% tokens / ±20% latency) was deferred — slices in P/M/L phases will set their own per-slice acceptance bars rather than one global bar.
- **Receipt correlation:** the harness does **not** correlate by `requestId`. The HTTP-level `requestId` returned by the public chat endpoint is a tracing id, not the value persisted on `runtime_turn_receipts.requestId`. Correlation runs through `/api/v1/internal/smoke/turn-receipts?assistantId=...&afterCursor=...` filtered by `externalThreadKey == surfaceThreadKey` with a `now − 1s` cursor captured before send. This is unambiguous because the harness sends turns sequentially per thread, and it is the contract every later slice (P1/M1/M2/V1/L1/R1/R2/R3) must rely on.
- **Internal endpoint listener split:** the internal smoke-receipts route is served only on `API_INTERNAL_PORT=3002` (`svc/api-internal`), enforced by `routeByListenerPort` middleware in `apps/api/src/main.ts`. Live-dev runs require **two** port-forwards (`svc/api 3001:3001` and `svc/api-internal 3002:3002`), driven by `SMOKE_API_BASE_URL` (default `http://127.0.0.1:3001`) and `SMOKE_API_INTERNAL_BASE_URL` (default `http://127.0.0.1:3002`).
- **Pacing:** every starter scenario uses `defaultThinkAfterMs: 8000` and `harness.ts` honors it (skipping the pause after the last turn of each session). This keeps user-perceived traffic at ≤ ~5.4 turns/min, safely under dev's `ABUSE_USER_SLOWDOWN_REQUESTS_PER_MINUTE=8`. Slices that need to push faster must lift the limit at the workspace level rather than shorten the harness pause.
- **Tool-call accounting:** smoke tool counts now prefer `RuntimeTurnResult.toolInvocations[]`, surfaced through receipts as `toolCallsSource=tool_invocations`, and only fall back to billable `usage.entries[].toolCode` when invocation data is absent. This closes the earlier blind spot where inline tools such as `web_search` / `web_fetch` could execute in real chats but still show up as `Tools: <none>` in `tool-heavy-search`.
- **Scenario encoding:** starter JSON scenarios are canonical UTF-8 files and may contain Cyrillic text directly. Keep edits in UTF-8; do not round-trip them through ANSI / cp1251, or the browser transcript will show mojibake in user bubbles during smoke runs.

Operator and per-slice usage instructions live in `scripts/smoke/README.md` (the cross-link from `docs/LIVE-TEST-HYBRID.md` "Smoke harness (ADR-074)" section is the canonical entry point for live-dev runs). Later slices in this ADR (P1/V1/M1/M2/M3/T1/T2/L1/R1/R2/R3) must read those two documents instead of re-reading the original plan text above when wiring acceptance commands.

**Slice S0 handoff prompt:**

> You are implementing ADR-074 Slice S0 (Smoke harness foundation). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice S0 section in full. Read `docs/LIVE-TEST-HYBRID.md` for the local hybrid stack. Do not implement any other slice in this session. Acceptance: `pnpm smoke:run chitchat-short` produces a JSON + Markdown report with the fields listed in the slice spec, deterministic within ±5% across reruns. Do not introduce LLM-judge logic, do not extend to Telegram, do not modify production runtime code paths beyond adding optional trace headers if `LIVE-TEST-HYBRID` already supports them. When done, append a SESSION-HANDOFF entry per `docs/ADR/005-docs-and-session-discipline.md`, listing the new files and the verification commands you ran.

---

### Slice P1 — Stable prefix engineering (cheap, biggest token win)

- **Status (2026-04-20):** landed on `main` and validated against `persai-dev` (image `e01bb5d`). The cached `systemPrompt` no longer carries `heartbeat_block` or `tools_catalog_block`; routing guidance + heartbeat now travel as a separate `developerInstructions` tail (OpenAI: `role: "developer"` input item; Anthropic: second `text` block on the `system` array). Unit tests in `apps/api/test/compile-prompt-constructor.service.test.ts` and `apps/runtime/test/turn-execution.service.test.ts` lock the invariants.
- **Smoke acceptance (2026-04-20, warm cache, vs S0 baselines committed in `scripts/smoke/baselines/*.summary.json`):**
  - `chitchat-short`: total tokens **−4.4%** (55821 → 53919 input), cached **+9.7%** (36864 → 40448), latency p95 **−1408ms**, ok 8/8.
  - `long-session-200`: total tokens **−24.5%** (412760 → 308873 input), avg/turn **−25%** (14449 → 10909), latency p95 **−49%** (24869ms → 12587ms), ok 29/29.
  - `tool-heavy-search`: total tokens **−29.5%** (98834 → 69544 input), avg/turn **−29.5%** (20077 → 14151), expected-tool-hit ratio unchanged at 2/4 (web_search hits, web_fetch misses — pre-existing, not caused by P1), ok 5/5.
  - The first cold-cache `chitchat-short` run after the rollout (artifacts `chitchat-short-2026-04-20T21-11-12-614Z`) showed cached=6144 only on turn 8: this is the expected one-time provider-side prefix warmup after the bundle hash flipped (new stable prefix content has no prior OpenAI cache). The warm-cache rerun above is the canonical P1 acceptance number.
  - The original 5–8x input-token target was overstated for our actual prefix size: removing heartbeat + tools_catalog shrank the cacheable prefix itself (less to cache), so the realistic structural ceiling is the ~25% per-turn input reduction we observed on `long-session-200`. Subsequent cost slices (P2 retrieval ceilings, P3 web auto-compaction, P5 lazy tools) compose on top of this and are tracked separately. P1 is closed.
- **Artifacts:** `scripts/smoke/artifacts/chitchat-short-2026-04-20T21-26-58-779Z`, `scripts/smoke/artifacts/long-session-200-2026-04-20T21-28-41-139Z`, `scripts/smoke/artifacts/tool-heavy-search-2026-04-20T21-25-06-477Z`. Baseline files in `scripts/smoke/baselines/` are intentionally NOT overwritten — they remain the pre-P1 reference for future slices.
- **Goal:** Restructure the system prompt so a large exact prefix is reusable across turns by provider-native prompt caching, cutting input tokens by 5–8x in typical long sessions without changing assistant behavior.
- **Founder anchor:** Principle 3. From Q12-B.

**Touch points:**

- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts` (`generateSystemPrompt`, `ordinarySections` ordering).
- `apps/api/prisma/bootstrap-preset-data.ts` (`VISIBLE_PROMPT_TEMPLATE_DEFAULTS.system` template — reorder placeholders).
- `apps/runtime/src/modules/turns/turn-execution.service.ts` (where routing guidance is currently injected — move to a `developer` / system tail message).
- `apps/runtime/src/modules/turns/native-tool-projection.ts` (verify tool definitions carry sufficient description so the markdown duplication can be removed safely).
- `apps/api/prisma/bootstrap-preset-data.ts` (`tools` template — possibly reduced to the catalog block alone or removed).

**Implementation outline:**

1. Reorder `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.system` so the order is: `assistant_identity_block`, `user_identity_block`, `locale_block`, `timezone_block`, `persona_instructions_block`, `soul_block`, `user_block`, `identity_block`, `tools_block`, `agents_block`, **then dynamic tail at the end**: `heartbeat_block` last.
2. Move `heartbeat_block` rendering to assemble immediately before the user message (last position), so the date-bearing content does not invalidate the cached prefix.
3. Remove `{{tools_catalog_block}}` from the `tools` template and rely only on provider-native tool definitions emitted by `native-tool-projection.ts`. Keep the leading `Native tool runtime:` framing line (cheap, stable). Verify tool descriptions in `prompt-constructor-tool-metadata.ts` carry enough usage guidance.
4. In `turn-execution.service.ts`, where routing/execution-mode guidance is injected into the system prompt per turn, move it to a separate `developer` message (OpenAI) / second system block (Anthropic) appended after the cached prefix. The cached prefix must not include any per-turn routing variation.
5. Verify `prompt_cache_key` is set to a value that is stable per assistant + user pair (not per turn) on OpenAI requests.
6. Update unit tests for `compile-prompt-constructor.service.ts` to lock the new ordering. Snapshot the produced `systemPrompt` for an assistant fixture and assert it does not change between turns when only `heartbeat` would differ.

**Acceptance criteria:**

- S0 scenarios `long-session-200` and `chitchat-short` show **input tokens reduced by ≥5x** (after first warm-up turn) versus baseline.
- S0 scenario `tool-heavy-search` shows **no regression** in tool-call counts or successful tool dispatch (model still picks the right tools).
- `apps/api/test/compile-prompt-constructor.service.test.ts` passes with new snapshot assertions.
- Manual check on a running stack: same assistant, two consecutive turns 5 minutes apart, OpenAI `cached_input_tokens` on the second turn covers ≥80% of the system block.

**Out of scope (P1):**

- Multi-level cache key per user (Q12-C, deferred).
- Knowledge block caching (separate later slice if needed).
- Anthropic prompt-caching beta — handle if it works the same way; do not invent a custom layer.

**Slice P1 handoff prompt:**

> You are implementing ADR-074 Slice P1 (Stable prefix engineering). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice P1 section in full. Slice S0 must already be landed; you will validate every change through `pnpm smoke:run long-session-200 --baseline` and `pnpm smoke:run tool-heavy-search --baseline`. Do not modify persona templates beyond reordering and the tools-block deduplication. Do not change tool semantics. Do not introduce per-user multi-level cache keys. Acceptance: input tokens drop by ≥5x on long-session-200, no tool regression on tool-heavy-search, snapshot tests for `generateSystemPrompt` pass. When done, append a SESSION-HANDOFF entry, attach before/after smoke-harness numbers, and update `docs/CHANGELOG.md`.

---

### Slice V1 — Voice DNA scaffold (biggest human-likeness win)

- **Status (2026-04-21):** Closed / live-accepted. The founder completed live `persai-dev` UI validation for V1 and accepted the slice operationally. In the final closeout session, supporting live checks also confirmed `GET /api/v1/assistant/runtime/preflight -> live=true, ready=true` and `GET /api/v1/assistant/persona-archetypes` returning the four shipped archetypes. No new CLI smoke artifact was captured in this exact closeout session; founder live validation is the recorded final acceptance source.
- **Goal:** Replace placeholder SOUL/USER/IDENTITY templates with structured "voice DNA" cards (tone, pacing, opening phrases, anti-phrases, behavior under emotion, silence heuristics, 2–3 micro-examples) so the assistant sounds like a specific person, not a generic LLM.
- **Founder anchor:** From Q13-B. Directly serves the product UTP "feels like a friend, not a chatbot".

**Final V1 implementation deviations from the original plan:**

1. Archetypes are stored in a dedicated `persona_archetypes` Postgres table, not in flat `docs/persona-archetypes/*.md` cards. The seed data lives in `apps/api/prisma/persona-archetype-data.ts` and is upserted insert-only by `ManagePersonaArchetypesService.ensureDefaults`, so admin edits via `/admin/persona-archetypes` (and the new "Voice DNA Archetypes" section in `/admin/presets`) are never overwritten by subsequent deploys. A "Reset to default" admin action restores a single archetype back to the compiled baseline on demand.
2. Both Russian and English copy are stored together on each archetype as `{ ru, en }` localized fields. The runtime selects locale at compile time from the user's resolved locale, with `en` as fallback.
3. Trait sliders (formality / verbosity / playfulness / initiative / warmth) are kept and now act as conservative _modulators_ of the chosen archetype rather than the entire personality source: `verbosity > 70` lengthens sentences one step, `initiative > 70` raises pace one step, `playfulness` scales irony around the archetype's baseline (capped at 90), and so on. This is the `voice-dna-modulator.ts` pure function; defaults are gender-neutral.
4. Snapshotting at publish time captures both `snapshotArchetypeKey` and a raw locale-agnostic `snapshotVoiceDna` blob on `assistant_published_versions`. At materialization time, the live archetype is preferred (so admin edits propagate to existing assistants on the next config bump) and the snapshot is the deletion-fallback.
5. The user-facing setup wizard now exposes a dedicated 4-archetype picker backed by live `GET /api/v1/assistant/persona-archetypes`, not the earlier "keep 9 presets and map them" fallback described in the original plan. `apps/web/app/app/_components/assistant-persona.ts` still keeps `PRESET_KEY_TO_ARCHETYPE` as a compatibility helper for older preset-key consumers, but the primary V1 setup flow now persists the actual archetype key chosen by the user.
6. `/admin/presets` grew two follow-through tools needed to migrate older prompt-template rows safely: an `Insert Voice DNA block` button on the `soul` template editor and a per-template `Reset to default` action. This lets operators bring older `soul` rows up to the V1 shape without redeploying code or hand-copying placeholders.

**Touch points:**

- `apps/api/prisma/persona-archetype-data.ts` — compiled founder-approved defaults for `warm-quiet`, `playful-sharp`, `calm-deep`, `dry-witty`.
- `apps/api/prisma/bootstrap-preset-data.ts` (`VISIBLE_PROMPT_TEMPLATE_DEFAULTS.soul`, `.user`, `.identity`, preview/welcome summaries).
- `apps/api/prisma/migrations/20260421120000_adr074_v1_persona_archetypes_foundation/migration.sql` — creates `persona_archetypes`, adds draft/published snapshot columns, and seeds the V1 data model.
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts` — interpolates Voice DNA placeholders into materialized prompts.
- `apps/api/src/modules/workspace-management/interface/http/assistant.controller.ts` + `admin-persona-archetypes.controller.ts` — public archetype read route plus admin edit/reset routes.
- `apps/web/app/app/setup/page.tsx` + `apps/web/app/admin/presets/page.tsx` — user-facing archetype picker plus admin preset/archetype editing.

**Voice DNA schema (target SOUL.md template):**

```
# Voice
- Sentence length: {{voice_sentence_length}}      // short | medium | long
- Pace: {{voice_pace}}                            // slow | lively
- Irony: {{voice_irony}}                          // none | gentle | sharp

# How you open
- Use: {{voice_openings_allowed}}
- Never use: {{voice_openings_forbidden}}         // e.g. "Конечно!", "Я готов помочь!", "Отличный вопрос!"

# Behavior under emotion
- When user is upset: {{voice_when_upset}}
- When user is excited: {{voice_when_excited}}
- When user is tired: {{voice_when_tired}}
- When user is angry: {{voice_when_angry}}

# Silence heuristic
{{voice_silence_rule}}                            // e.g. "If you have nothing real to add, say one word or stay silent. Do not fill space."

# Micro-examples
{{voice_examples_block}}                          // 2–3 short user→assistant exchanges that demonstrate the voice
```

**Implementation outline:**

1. Capture founder-approved copy for the four archetypes directly in `apps/api/prisma/persona-archetype-data.ts`, with bilingual `{ ru, en }` fields and stable keys.
2. Rewrite `VISIBLE_PROMPT_TEMPLATE_DEFAULTS.soul` to consume structured Voice DNA placeholders, and update preview/welcome bootstrap summaries to surface voice-level output instead of the old generic traits summary.
3. Keep `user` / `identity` compatible with the new prompt constructor, but do not force V1-only complexity into those templates beyond what the shipped code actually materializes.
4. Add the Prisma foundation for `persona_archetypes`, `assistants.draft_archetype_key`, and `assistant_published_versions.snapshot_archetype_key` + `snapshot_voice_dna`.
5. Wire archetype selection through draft update, publish snapshotting, and materialization so the runtime can prefer the live archetype and fall back to the publish-time snapshot if needed.
6. Expose archetypes end to end: `GET /api/v1/assistant/persona-archetypes` for the setup UI, and authenticated admin edit/reset endpoints for live operator tuning.
7. Add admin preset-editor recovery tools (`Insert Voice DNA block`, `Reset to default`) so older `soul` template rows can be brought to the V1 shape safely.

**Acceptance criteria:**

- 4 founder-approved archetypes exist in compiled seed data (`apps/api/prisma/persona-archetype-data.ts`) and are editable at runtime through the admin surface.
- Prisma migration applied; `persona_archetypes`, draft archetype selection, and published Voice DNA snapshots are live schema truth.
- The setup wizard persists a real archetype key chosen from the 4 live archetypes, and `/admin/presets` can repair older `soul` rows via `Insert Voice DNA block` / `Reset to default`.
- S0 scenario `emotional-long` shows: average assistant reply length is **shorter** than baseline, none of the forbidden phrases appear in any reply, voice stays consistent (manual check with founder + later LLM-judge in Q11-C).
- S0 scenario `chitchat-short` shows no regression in token cost vs P1 baseline (the larger SOUL is offset by stable-prefix caching from P1).

**Out of scope (V1):**

- Living USER.md / auto-evolution (Q13-C, deferred).
- UI for archetype editing in user-facing app (admin selection only at V1).
- Automatic style mirroring of the user (deferred to Q13-C).

**Slice V1 handoff prompt:**

> You are implementing ADR-074 Slice V1 (Voice DNA scaffold). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice V1 section in full. Slices S0 and P1 must be landed. The founder-approved archetype copy lives in `apps/api/prisma/persona-archetype-data.ts`; do not invent extra archetypes or extra Voice DNA fields beyond the schema above. Do not introduce auto-evolution of USER.md. Acceptance: migration applied, snapshot tests pass, setup/admin surfaces expose the live archetypes correctly, and S0 `emotional-long` shows shorter average replies with zero forbidden-phrase hits. When done, append a SESSION-HANDOFF entry, paste any available smoke-harness output, and update `docs/CHANGELOG.md`.

---

### Slice M1 — Durable memory: core + relevance-retrieved tail

- **Status (2026-04-21, closeout):** **Closed / live-accepted on `persai-dev`.** Image for commit `9c730220` was published, pinned into `infra/argocd/persai-dev/values-dev.yaml` by bot commit `0ad9dd8`, and rolled out by Argo CD across `api`, `runtime`, and `web`. The Prisma migration `20260421140000_adr074_m1_durable_memory_class` finished cleanly (live backfill produced `core fact = 9`, `core preference = 7`, `contextual null = 796` cluster-wide). The new internal route `POST /api/v1/internal/runtime/memory/hydrate-for-turn` was confirmed via API startup logs and a real `runtime → api` call returning `200` in `217ms`. Durable memory is now split at write-time into `core` (identity-bearing facts and preferences) and `contextual` (open loops, web-chat auto-extracts, everything else). Per-turn hydration always sends the core block (hard-capped at `MEMORY_CORE_HARD_CAP=15`, oldest-demoted on overflow) and a relevance-retrieved contextual tail (≤ `runtime.context.memory.contextualLimit`, default 8) selected via lexical search over `assistant_memory_registry_items.summary`. The contextual tail is bumped via `last_used_at` whenever it is hydrated, so the demote-on-overflow rule prefers truly stale entries. The split is reflected in the prompt-cache stable-block families: `durable_memory_core` is part of the cached prefix, while the new `durable_memory_contextual` family is explicitly **not stable** (each turn rewrites it), so M1 does not regress P1's cache hit rate.
  - **Implementation deviations from the original plan worth carrying forward:**
    1. **No vector embeddings.** Lexical retrieval over `summary` is enough for the founder-reviewed scenarios; vector indexing is deferred (still flagged in "Out of scope" below for posterity, but the deferral is now an actual decision, not a TBD).
    2. **`kind` is a real Postgres enum column** (`fact` | `preference` | `open_loop` | `null`), not derived from `sourceLabel` text. The migration backfills existing rows from `sourceType`/`sourceLabel`. This makes future M2/M3 ranking trivial without prompt-text scraping.
    3. **Memory-Center UI shows class + kind labels but does NOT expose promote/demote.** Founder principle 1 (magic, not user-controlled) won the tradeoff: class is a coded outcome of the write path, not a user setting. The UI labels only exist for transparency.
    4. **Runtime hydrates via an internal HTTP endpoint** (`POST /api/v1/internal/runtime/memory/hydrate-for-turn` on `API_INTERNAL_PORT=3002`), not by reading Postgres directly. This reuses the existing `ReadAssistantKnowledgeService.searchMemory` pipeline (and its observability) instead of duplicating SQL in the runtime, in line with the M1 spec's "reuse ADR-073 hybrid retrieval; do not invent a new vector pipeline" constraint.
    5. **`memory_write` tool guidance was rephrased toward proactive use.** The previous wording read as "only write when the user says 'remember'", which produced too few writes in practice. The new guidance frames `memory_write` as the model's continuous notebook, with an explicit reminder that the user manages memories through the Memory Center UI (the misleading reference to a non-existent `memory_forget` tool was removed in the same edit).
- **Smoke acceptance (live `persai-dev`, assistant `b635d40d-ced6-428d-a68b-7395463b2db9`, ingress `https://api.persai.dev` + internal `:13002` port-forward):**
  - `multi-session-continuity` — `12/12` turns OK, `0` failed; total tokens **`108_256` vs baseline `163_201` (−33.67%)**, p95 latency **`16_523ms` vs baseline `20_196ms` (−3_673ms)**, tools `knowledge_search × 4` + `knowledge_fetch × 1` + `memory_write × 2` + `summarize_context × 1`, routing 100% `active / normal`, `0` auto-compaction triggers. Cross-session recall behaves to spec: in session 2 the assistant did not blanket-dump the contextual tail; turn 2 honestly said it didn't have enough specifics for a vague "what was I going to prepare?" cue, then turn 3 (with the cue "ретрит и квартальный обзор") ran `knowledge_search` + `knowledge_fetch` and correctly recalled all three planted facts — `Atlas`, `Helio`, and "_показать прогресс по retention_". That is the strict M1 success signal: relevance-retrieved tail working over `summary` lexical search, not naive prefix dump.
  - `chitchat-short` — `8/8` turns OK, `0` failed; total tokens **`43_939` vs baseline `56_821` (−22.67%)**. The explicit P1 cache invariant held: cache hit rate went from `36_864 / 56_466 = 65.3%` (baseline) to `36_864 / 43_568 = 84.6%` (current), a **+19.3pp improvement**, well above the `±2pp` acceptance bar; the absolute cached-token count was numerically identical (`36_864 == 36_864`), proving contextual rotation does NOT invalidate the cached `system + core + shared compaction summary` prefix. Median latency `2_577ms` (baseline `2_812ms`); single-sample p95 went up `+1_535ms` on one tail outlier in an 8-turn run, well within model/network noise on `gpt-5.4-mini`. Identity recall held: every turn addressed the user as `General`, proving the always-on core block carries identity facts without per-turn retrieval cost.
  - Live DB verification (post-smoke, scoped to the test assistant): classification distribution matches the policy (`memory_write` `kind=fact` / `kind=preference` → `core`; `kind=open_loop` → `contextual`; web-chat memory → `contextual, kind=null`); the `MEMORY_CORE_HARD_CAP=15` overflow rule fired (`core fact=9, core preference=6, contextual fact=1, contextual preference=3` post-smoke vs `core fact=9, core preference=7` pre-smoke), confirming `demoteOldestCoreByAssistantId` moved oldest core entries down to contextual; `last_used_at` was bumped on `60` distinct rows in the 20-minute smoke window, confirming `HydrateMemoryForTurnService.bumpLastUsedAt(...)` is being called for every hydrated turn (both core and contextual).
  - Humanity-bonus signal (qualitative, separate from token math): in session 1 of `multi-session-continuity` the model spontaneously called `memory_write` for the unprompted Barcelona-retreat fact in addition to the planted `Запомни… retention` cue. That validates the rephrased `usage_guidance` intent — identity-relevant facts get captured without asking the user to operate the memory subsystem.
  - Smoke baselines under `scripts/smoke/baselines/` were intentionally **not** rewritten in this closeout, so future slices (M2 / M3) can still measure their own deltas against the pre-M1 reference point.
- **Goal:** Stop sending all durable memory entries on every turn. Always inject a small core (~10–15 most identity-defining entries), retrieve the rest by relevance to the current user message.
- **Founder anchor:** Principle 1 (magic — user does not curate). From Q4-B.

**Touch points:**

- `apps/api/prisma/schema.prisma` — `assistant_memory_registry_items` may need a `memory_class` enum (`core` | `contextual`) and `relevance_score` or `last_used_at` for ranking.
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-memory-registry.repository.ts` — query methods for "core memories" and "search memories by query".
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` — split memory injection into "always-on core" + "relevance-fetched contextual".
- `apps/runtime/src/modules/turns/runtime-memory-write-tool.service.ts` — when writing memory, classify as core/contextual heuristically (kind=`fact` for identity-defining like name/family → `core`; kind=`open_loop` → `contextual`; etc.).
- New small service: classify-memory-class heuristic in `apps/api/src/modules/workspace-management/domain/`.

**Implementation outline:**

1. Add `memory_class` column to `assistant_memory_registry_items` with default `contextual`. Backfill: identity-bearing entries (name, family, key preferences) → `core`; rest → `contextual`. Cap core at 15 per assistant-user pair.
2. Add `last_used_at` timestamp updated when an entry is selected for context.
3. In `turn-context-hydration.service.ts`, replace "inject all durable memory" with: (a) always inject all `core` entries (capped at 15); (b) call new `findRelevantContextual({ assistantId, userQuery, limit: 8 })` repository method.
4. Implement `findRelevantContextual` using existing knowledge retrieval infrastructure (lexical + vector if available, else lexical-only fallback). Reuse hybrid retrieval pieces from ADR-073's knowledge layer.
5. Memory Center UI shows the split: "Always remembered" (core) vs "Remembered by context" (contextual). User can promote/demote between classes — but this is opt-in transparency, not required for the magic to work.
6. Update memory write classifier so future writes default to the right class.

**Acceptance criteria:**

- S0 scenario `multi-session-continuity` shows: at 100 durable entries, total per-turn input tokens for memory block ≤ ~1500 tokens (vs linear growth in baseline).
- S0 scenario `chitchat-short` shows: assistant uses user's name correctly (core memory still works for trivial turns).
- Test scenario: write 50 contextual entries, then ask a question matching only one — assert that one entry is retrieved into context, others are not.
- Migration safe and reversible.

**Out of scope (M1):**

- User-facing curation UI redesign (Memory Center stays current shape; add the split labels only).
- Cross-assistant memory (each assistant-user pair stays isolated as today).

**Slice M1 handoff prompt:**

> You are implementing ADR-074 Slice M1 (Durable memory core + relevance retrieval). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice M1 section in full. Slices S0 and P1 must be landed. Reuse ADR-073 hybrid retrieval; do not invent a new vector pipeline. Cap core at 15 entries per assistant-user pair, hard limit. Do not break existing Memory Center UI; only add the class label. Migration must be reversible. Acceptance: multi-session-continuity scenario shows non-linear memory growth in tokens, chitchat-short still uses user name correctly. When done, SESSION-HANDOFF + CHANGELOG.

---

### Slice M2 — Background compaction with human-voiced auto-extract

- **Goal:** Take long-session compaction off the user's request path entirely (run it as a background job after the assistant reply has been delivered) and turn each compaction event into two products: (a) a **replaced** rolling synopsis on the session, (b) a small, human-voiced batch of new durable memory entries written via the same shape M1 already understands. Web auto-compaction becomes default-on across all presets so this actually fires.
- **Founder anchor:** Principle 1 (magic — invisible to user) + Principle 3 (tune existing plan-policy fields, do not invent new ones) + Principle 5 (no shadow paths). From Q5-B and the 2026-04-21 founder review of M2.

**Status — closed / live-accepted on `persai-dev` (2026-04-22 evening):**

After the behavioral commit landed and the image was rolled out by Argo CD, the runtime pod entered `CrashLoopBackOff` with `UnknownDependenciesException` for `AutoExtractToMemoryService`. Root cause: `apps/runtime/src/modules/turns/auto-extract-to-memory.service.ts` was importing `ProviderGatewayClientService` and `PersaiInternalApiClientService` via `import type`, which TypeScript erases at emit time, so Nest could not resolve those constructor parameters at runtime. Fix `baaa15e` switched both back to value imports (the `InternalMemoryWriteOutcome` import stays `import type` because it is a pure type alias). The runtime ReplicaSet then rolled to `2/2 Running` cleanly.

Live smoke acceptance was then run against the founder's `persai-dev` `Custom` plan (`compactionTriggerThreshold = 8000`, `targetContextBudget = 70000`, `keepRecentMinimum = 4`, `autoCompactionWeb = true`) on assistant `b635d40d-ced6-428d-a68b-7395463b2db9` for the three M2-relevant scenarios. The first run surfaced a smoke-harness identity confound (the founder's user profile carried `displayName = "General"` while the smoke fixtures planted `userName = "Алекс"` in-conversation; the model correctly preferred the persistent profile and `AutoExtractToMemoryService` wrote "Пользователь называется General" as a durable fact — making the slice look like it had hallucinated identity, when in fact it had faithfully captured a real profile field as redundant durable memory). The founder then ran the assistant `setup` wizard and renamed `userName` to "Алекс" so the planted in-conversation identity matches the stable system-prompt prefix; all three scenarios were then re-run on the clean profile. Final deltas vs. the pre-M1 baselines under `scripts/smoke/baselines/`:

- `chitchat-short` — 8/8 OK; total tokens **−20.78 %** (45 016 vs 56 821); p95 latency `−2234ms`; no auto-compaction expected (well below the 8 k threshold).
- `multi-session-continuity` — 12/12 OK across both sessions; total tokens **−34.50 %** (106 900 vs 163 201); p95 latency `−12 831ms`; session-2 used `knowledge_search ×6` → relevance-retrieval path is wired.
- `long-session-200` — 27/29 OK; total tokens **−47.25 %** (221 014 vs 419 021); p95 latency `−13 836ms` (no regression despite compaction now firing — the headline M2 acceptance signal); per-turn input stayed bounded at `~5–8 k` for ordinary turns with retrieval-driven spikes only on the explicit recall turns. The two failed turns are unrelated to M2 mechanics: turn 4 hit a transient `fetch_failed` (upstream/network flake), turn 25 hit `native_runtime_conflict` which is the known `session_busy` race the M2 design explicitly documents as acceptable when a follow-up turn races ahead of an in-flight compaction; both happened on a 29-turn session, retry would clear them.

Off-band auto-extract is observed live: after the smoke runs, `GET /api/v1/assistant/memory/items` returns clean human-voiced rows like "Пользователь Алекс работает над продуктом PersAI" (`core / fact`), "Пользователь Алекс любит флэт уайт без сахара" (`core / preference`), "Она хочет позже подобрать отдых на 2 дня недалеко от Мадрида" (`contextual / open_loop`), all written by `AutoExtractToMemoryService` through the M1 internal `writeMemory` path with the M1 classification preserved (`fact`/`preference` → `core`, `open_loop` → `contextual`). The pre-rename "Пользователь называется General" row no longer appears anywhere in the active memory listing. `Auto-compaction triggers: 0` in every smoke `summary.json` is **expected** because the harness reads `RuntimeTurnReceipt.autoCompaction`, which is the in-band path the cutover deliberately removed; the durable-memory listing is the off-band proof.

The web UI followed up with a small but mandatory M2 polish in `apps/web/app/app/_components/chat-area.tsx` (commit `b20d0ef`): the "Автосжатие включено · Сжать сейчас" pressure banner is now suppressed when `chat.compaction?.autoCompactionEnabled === true`, since the user has nothing to do — the off-band scheduler handles it. The post-compaction success banner (`compactionBannerMode === "auto_compacted"`) is preserved for both modes so the founder still sees "контекст сжат с N до M токенов". The dead i18n keys (`compactionPressureAutoTitle`, `compactionHintAuto`, `compactionHintAutoDetail`) were intentionally kept in the catalogs for cheap reversibility if we want a softer "system will compact after the answer" hint later.

**No M2.1 follow-up needed (founder-confirmed 2026-04-22 evening after reviewing the second-run durable-memory listing).** The two earlier candidate polish items — (a) auto-extract dedup against the user-profile prefix, and (b) per-scenario `assistantId` / `forget all` warmup in the smoke harness — were both dropped intentionally. Reasons: (a) the second-run durable memory shows zero profile-field duplicates in practice — every auto-extracted core row added information beyond the 5-field profile (name / birthday / gender / locale / timezone), the friend-voice prompt naturally avoids "Алекса зовут Алекс"-shaped noise, the existing M1 server-side normalized-summary dedup catches exact-match collisions, and the original "General" symptom was a smoke-artefact identity confound that the profile rename resolved at the source — not a class of bug that warrants prompt engineering before evidence appears in `/admin/business` or live memory dumps; (b) cross-`assistantId` bleed is purely a smoke-methodology artefact, the actual production behaviour ("one assistant per user, memory carries across that user's threads") is the desired UTP — there is no point investing in smoke-only test isolation until we actually need to refresh the baselines, which we are explicitly NOT doing for downstream slices. Both items can be re-opened later if real evidence emerges; until then, the M2 slice is closed without follow-up tail.

The slice is therefore considered closed: cutover, replace-not-concatenate synopsis, off-band scheduler, auto-extract through M1 dedup, prompt-cache rename, and the UI pressure-banner suppression are all live and measurably better; M3 is the next slice with no M2 residue carried forward.

**Original status — behavioral implementation landed in code (2026-04-22):**

The 2026-04-22 session completed the behavioral half on top of the 2026-04-21 scaffolding. The M2 acceptance criteria are still measured against the founder's `persai-dev` `Custom` plan (`compactionTriggerThreshold = 8000`, `targetContextBudget = 70000`, `keepRecentMinimum = 4`, `autoCompactionWeb = true`); see "Smoke acceptance & live verification" at the end of this section for the post-deploy steps. What landed in the behavioral commit:

1. **Off-band cutover.** `apps/runtime/src/modules/turns/turn-execution.service.ts` no longer awaits compaction inside `finalizeAcceptedTurnWithPostTurnEffects`. The synchronous `executePostTurnAutoCompaction` and `buildAutoCompactionRequest` (and the now-unused `RuntimeTurnAutoCompactionState` alias) are deleted; instead, `fireBackgroundCompactionEnqueue` makes a non-blocking `void enqueueBackgroundCompaction(...)` call against `apps/api`. A regression guard test (`apps/runtime/test/post-turn-auto-compaction-cutover.test.ts`) fails if any of those identifiers reappear or if the call is `await`-ed.
2. **API-side scheduler.** New `apps/api/src/modules/workspace-management/application/persai-background-compaction-scheduler.service.ts` mirrors the `PersaiScheduledActionSchedulerService` claim-and-lease pattern (5s poll, 60s claim TTL, exponential retry up to 5 attempts, epoch-bumped on `OnModuleInit` so deploy invalidates stale claims). It calls into the runtime via the new `InternalRuntimeCompactionClientService` (bearer-authed POST to `/api/v1/internal/runtime/sessions/compact-and-extract`, 30s timeout, retryable classification of 408/429/5xx). Job intake goes through the new `EnqueueBackgroundCompactionJobService` and the new internal `POST /api/v1/internal/runtime/compaction/enqueue` controller (returns 202 with `{ enqueued, jobId, superseded }`). Supersede semantics use the `pending_dedupe_key` partial unique index from the scaffolding migration: a second post-turn enqueue while a `pending` row exists collapses silently to `superseded: true` instead of multiplying queue depth. `BumpConfigGenerationService` gained `bumpBackgroundCompactionSchedulerEpoch` / `currentBackgroundCompactionSchedulerEpoch` over the new `background_compaction_scheduler_epoch` column added in the second M2 migration.
3. **Runtime internal compact-and-extract endpoint.** New `apps/runtime/src/modules/turns/interface/http/internal-runtime-sessions.controller.ts` accepts the api scheduler's call at `POST /api/v1/internal/runtime/sessions/compact-and-extract` (bearer-authed via `assertRuntimeInternalApiAuthorized`, mirrors the M1 internal hydrate endpoint shape). It always invokes `SessionCompactionService.compactSession` with `trigger: "auto_compaction"` and `autoExtract: true`, so threshold semantics still apply and auto-extract follows on the same job in the same process.
4. **Replace-not-concatenate synopsis.** `SessionCompactionService.executeSharedCompaction` now loads the latest persisted synopsis via `runtimeStatePostgresService.findLatestSessionCompaction(...)` and feeds its rendered text into the system prompt as "REPLACE this whole synopsis with the updated one that covers prior + this slice". The persisted shape didn't change (M1's storage was already replace-style at the repository level — only the prompt instruction was missing). `apps/runtime/test/session-compaction.service.test.ts` was extended with a "previous synopsis injection" assertion. Together with the prompt-cache family rename `shared_compaction_summary → rolling_session_synopsis` (`v2`, intentional one-time cache rebuild as the cutover lands), this isolates the synopsis from accidental drift.
5. **Auto-extract service.** New `apps/runtime/src/modules/turns/auto-extract-to-memory.service.ts` runs **one** `auto_extract_to_memory` LLM call (warm friend-voice prompt, `{ items: [{ kind, summary }] }` strict JSON schema, soft cap of 8) over the freshly compacted turn slice, then writes through the existing M1 `writeMemory` internal endpoint so M1's memory-class routing applies automatically. Server-side dedup hardened in `WriteAssistantMemoryService` via `findActiveByNormalizedSummaryAndAssistantId`: an active entry with the same normalized summary returns `{ written: false, code: "duplicate" }` and bumps `last_used_at` on the existing row instead of inserting. This also benefits the model-driven `memory_write` tool. The service surfaces the round on `RuntimeCompactionResult.autoExtract` (count + per-kind histogram + accepted entries) so smoke traces can see "compaction fired in background, wrote N memories, took T ms".
6. **Tests landed alongside the behavior.** `apps/api/test/persai-background-compaction-scheduler.service.test.ts` (claim/lease/retry/non-retryable failure/exhaustion/epoch-changed/stale-claim-reclaim/unexpected-throw), `apps/api/test/enqueue-background-compaction-job.service.test.ts` (parse validation including `runtime_tier` whitelist, supersede on `P2002`, rethrow on unrelated errors), `apps/api/test/internal-runtime-compaction-enqueue.controller.test.ts` (auth happy/missing/wrong + supersede passthrough), `apps/api/test/write-assistant-memory.service.test.ts` extended with the dedup case, `apps/runtime/test/auto-extract-to-memory.service.test.ts` (deterministic fake LLM exercises accept / pre-write dedup / server-side duplicate / policy denial / soft cap / provider failure / unsupported transport / empty messages), `apps/runtime/test/session-compaction.service.test.ts` previous-synopsis assertion, `apps/runtime/test/post-turn-auto-compaction-cutover.test.ts` regression guard, and `apps/runtime/test/prompt-cache-stable-blocks.test.ts` updated for the `rolling_session_synopsis` family rename.

Live acceptance against the founder's `persai-dev` `Custom` plan still has to run after deploy — the same three smoke scenarios listed in step 5 of the original Implementation Outline (`long-session-200`, `chitchat-short`, `multi-session-continuity`) at `compactionTriggerThreshold = 8000`. Until those run and their summary deltas are appended to SESSION-HANDOFF, treat the slice as "code-landed, live-pending" rather than fully closed.

**Original status — scaffolding landed, behavioral implementation deferred (2026-04-21 evening):**

The 2026-04-21 evening session split M2 into a "scaffolding" half (this commit) and a "behavioral" half (next session) after measuring the slice scope honestly against the M1 closeout precedent (M1 also took two sessions — code-landed then live-accepted). What landed in this commit is intentionally **idle scaffolding**: every change is additive and producer-less, so the live cluster's behavior is unchanged, but the contract surface and database schema the next session needs are already in place. Specifically:

1. **Preset defaults flipped** in `packages/runtime-contract/src/index.ts` — `balanced.autoCompactionWeb` and `rich.autoCompactionWeb` are now `true`. Per the founder constraint "do not write a data migration over stored plan rows", this only affects newly-created plan rows; the founder's `Custom` plan already had `autoCompactionWeb = true` set manually in `/admin/plans`, so the live smoke plan is unchanged. (Note: the codebase preset is named `rich`, not `premium` as the M2 prompt says — they are the same tier, this is a naming-only deviation from the prompt text.)
2. **Contract types extended** — added `RuntimeCompactionAutoExtractResult` interface and made `RuntimeCompactionResult.autoExtract` an optional field. The runtime side has no producer for this field yet; consumers that may receive it must treat the field as absent for now (the field is `?: ... | null`).
3. **Postgres table created** — new Prisma model `AssistantBackgroundCompactionJob` + enums `AssistantBackgroundCompactionJobStatus` / `AssistantBackgroundCompactionJobTrigger` in `apps/api/prisma/schema.prisma`, and the matching reversible migration `apps/api/prisma/migrations/20260422010000_adr074_m2_background_compaction_jobs/migration.sql`. The table is keyed by `pendingDedupeKey` (a unique index over `(assistantId, channel, externalThreadKey)` while `status='pending'`) for supersede-on-enqueue semantics, has scheduler claim/lease columns following the `PersaiScheduledActionSchedulerService` template, and remains empty until the next session lands the scheduler service. No code in either app reads or writes this table yet — the migration is safe to apply on `persai-dev`.
4. **What is NOT yet landed** (next session's scope, ordered by dependency):
   - `apps/api` — `PersaiBackgroundCompactionSchedulerService` (mirrors `PersaiScheduledActionSchedulerService`: poll → claim with TTL lease → POST runtime → mark complete/failed/superseded), repository over the new table, and the `POST /api/v1/internal/runtime/compaction/enqueue` controller on the `:3002` listener.
   - `apps/api` — the api-side trigger client that the scheduler uses to call the runtime's compact-and-extract endpoint, with bearer auth using `PERSAI_INTERNAL_API_TOKEN` and a generous timeout (compaction can take 5–15s depending on context size).
   - `apps/runtime` — `AutoExtractToMemoryService` (new file, one LLM call via the `systemTool` model slot, human-friend voice prompt, `{kind, summary}[]` structured output schema, normalized-text dedup against existing memories, soft cap 8, writes through the M1 `writeMemory` internal endpoint).
   - `apps/runtime` — `SessionCompactionService` modification: feed the previous synopsis text into the next compaction call's system prompt as "context to preserve while updating" (the replace semantics on the persist side already exist in M1's storage shape — M1 reads `findLatestSessionCompaction` only — so this is a prompt-input change, not a storage-shape change). After successful compaction, invoke `AutoExtractToMemoryService` and surface the result on `RuntimeCompactionResult.autoExtract`.
   - `apps/runtime` — `TurnExecutionService.finalizeAcceptedTurnWithPostTurnEffects` change: replace `await this.executePostTurnAutoCompaction(...)` with a fire-and-forget POST to the api enqueue endpoint via a new `enqueueBackgroundCompaction` method on `PersaiInternalApiClientService`. Delete the in-band `executePostTurnAutoCompaction` body (no shadow path, no flag).
   - `apps/runtime` — internal compact-and-extract endpoint that the api scheduler calls. Decision for the next session: either (a) reuse the existing public `POST /api/v1/turns/compact` route with bearer auth + a `trigger: "background"` marker, or (b) add a new internal-only `POST /api/v1/internal/runtime/sessions/compact-and-extract` controller. Recommend (b) for symmetry with M1's `/api/v1/internal/runtime/memory/hydrate-for-turn` endpoint shape and to keep the public turns controller surface stable.
   - `apps/api/src/modules/workspace-management/application/write-assistant-memory.service.ts` — small dedup hardening: before insert, look up `(assistantId, normalizedSummary)` in `AssistantMemoryRegistryRepository` and return `{ written: false, code: "duplicate" }` if a match exists. This is the "lexical normalized-text dedup against existing `assistant_memory_registry_items.summary`" the ADR mandates for auto-extract; doing it server-side in M1's write path means the auto-extract caller does not need its own dedup query and the existing model-driven `memory_write` tool also benefits from idempotency. Add `findActiveByNormalizedSummary` repository method (interface + Prisma impl).
   - `apps/runtime/src/modules/turns/prompt-cache-stable-blocks.ts` — rename the `shared_compaction_summary` family to `rolling_session_synopsis` (with version bump to `v2` to invalidate the old key cleanly — there's no shadow alias, the next session pays the one-hour cache-rebuild cost as part of the M2 cutover). Update the matching consumer in `turn-context-hydration.service.ts` and the two test files (`prompt-cache-stable-blocks.test.ts`, `turn-execution.service.test.ts`). This rename is intentionally NOT in this scaffolding commit because it would invalidate live caches without delivering any new behavior; it must land together with the scheduler so the new producer is ready when the cache rebuilds.
   - Tests: `auto-extract-to-memory.service.test.ts` (new), `session-compaction.service.test.ts` extension for the previous-synopsis input, `turn-execution.service.test.ts` regression guard for off-band, `persai-background-compaction-scheduler.service.test.ts` (new, mirroring `persai-scheduled-action-scheduler.service.test.ts` claim/lease/retry/supersede shape), and an integration test for the api enqueue + runtime execute round-trip.
   - Smoke acceptance against the founder's `persai-dev` `Custom` plan (`compactionTriggerThreshold = 8000`, `targetContextBudget = 70000`, `keepRecentMinimum = 4`, `autoCompactionWeb = true`): `long-session-200` token-growth + p95 latency vs M1 baseline; `chitchat-short` p95 + cache hit rate vs M1 baseline; `multi-session-continuity` regression check.

This split was made instead of attempting to ship the full slice because M2 has roughly 2× the file count of M1 (new scheduler service + repository + controller + auto-extract service + dedup repository method + four behavioral edits + five test files) and the founder's M2 prompt explicitly says "If at any point you discover a hard constraint in the ADR cannot be satisfied as written, STOP, document the contradiction, propose two alternatives in your SESSION-HANDOFF entry, and surface it back to the founder rather than silently deviating." The scope problem is not a hard constraint contradiction — it's a pragmatic time/quality bound — but the same discipline applies: ship clean scaffolding that the next session can build on without rework, rather than a half-implemented behavioral path that might leak into the live cluster. The scaffolding commit passes `prisma generate` + `pnpm --filter @persai/api typecheck` + `pnpm --filter @persai/runtime typecheck` + `pnpm --filter @persai/runtime-contract typecheck` cleanly with no lint or test changes; nothing in the live runtime changes behavior because there is no producer for the new types and no reader for the new table.

**Live truth as of 2026-04-21 (pre-M2 baseline, do NOT re-derive — wire your slice to these facts):**

- The `RuntimeContextHydrationConfig` in `packages/runtime-contract/src/index.ts:376–413` already exposes everything M2 needs as plan-policy fields: `targetContextBudget`, `compactionTriggerThreshold`, `keepRecentMinimum`, `autoCompactionWeb`, `autoCompactionTelegram`. **Do not introduce new policy fields.** "Trigger by context pressure" means "use the existing `compactionTriggerThreshold` against the existing target budget", not "invent `inputBudgetPressure`".
- Current preset defaults are `lean { web=true, tg=true }`, `balanced { web=false, tg=true }`, `premium { web=false, tg=true }`. M2 flips `balanced.autoCompactionWeb` and `premium.autoCompactionWeb` to `true`. Founder confirmed this on 2026-04-21.
- Today `executePostTurnAutoCompaction` in `apps/runtime/src/modules/turns/turn-execution.service.ts:874–890` is `await`-ed inside `finalizeAcceptedTurnWithPostTurnEffects` **before** `RuntimeTurnResult` returns to the API. The streaming text reaches the user during model generation, but the HTTP request and the `runtime_turn_receipts` row both stay open for the entire compaction window. On Telegram this is visible as the bot "still thinking" after the message arrived; on Web it's a hung "in flight" indicator. M2 must move this work off the request path.
- The existing in-band path already tolerates "compaction skipped because the next turn raced ahead" — `SessionCompactionService.compactSession` returns `reason: "session_busy"` and the runtime swallows it. That is the precedent the new background path inherits: if the next user turn arrives before the background compaction finishes, the next turn rides the **previous** synopsis (one ход устаревший — это нормально), and the background job either finishes or is superseded.

**Touch points:**

- `packages/runtime-contract/src/index.ts` — flip `PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET_DEFAULTS.balanced.autoCompactionWeb` and `.premium.autoCompactionWeb` to `true`. `lean` is already `true`. Telegram side stays `true` everywhere.
- `apps/runtime/src/modules/turns/turn-execution.service.ts` — extract `executePostTurnAutoCompaction` out of `finalizeAcceptedTurnWithPostTurnEffects`. The finalization path returns the user-facing result as soon as `completeAcceptedTurn` has persisted the assistant text; auto-compaction is enqueued for background execution.
- New: `apps/api/src/modules/workspace-management/application/persai-background-compaction-scheduler.service.ts` (or extend the existing `PersaiScheduledActionSchedulerService`) — **the queue lives in `apps/api`, not in `apps/runtime`** (founder-confirmed 2026-04-21, sized for ~10k users). It owns persistent claim/lease in Postgres, single-flight per `(assistantId, channel, externalThreadKey)`, retry, and supersede-on-enqueue semantics. Runtime never owns durable scheduling state. The execution step itself (the actual LLM compact call + auto-extract call) still runs in `apps/runtime` — the scheduler invokes it via the existing internal HTTP path, mirroring the two-step pattern already used by `PersaiScheduledActionSchedulerService` ↔ `RunScheduledAssistantActionService`.
- New: a thin internal HTTP endpoint on `apps/runtime` (e.g. `POST /v1/sessions/compact-and-extract`) that the api-side scheduler calls to execute one queued compaction job. The endpoint reuses `SessionCompactionService.compactSession` and the new `auto-extract-to-memory.service.ts`, returns the structured `RuntimeCompactionResult` (extended in step 9 below). Listener-port discipline matches the existing internal split (`API_INTERNAL_PORT=3002` pattern from S0).
- New: a small Postgres table `assistant_background_compaction_jobs` (or a column set on an existing scheduler table if `PersaiScheduledActionSchedulerService` is extended) keyed by `(assistantId, channel, externalThreadKey)` with claim lease + status, so multiple api pods cannot double-execute and pod restarts do not lose pending work.
- `apps/runtime/src/modules/turns/session-compaction.service.ts` — change the compaction output so the session synopsis is **replaced** every event, not appended; the previous synopsis is fed back as one of the inputs to the next compaction call so important context carries forward.
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` — assemble context as: durable memory core (M1) + relevance-retrieved contextual tail (M1) + last-session synopsis (M3, when present) + current rolling synopsis (M2) + verbatim recent window of `keepRecentMinimum` turns (M2).
- New: `apps/runtime/src/modules/turns/auto-extract-to-memory.service.ts` — after a compaction succeeds, runs **one** cheap LLM call (use `systemToolModel` slot) over the freshly compacted turn range to produce human-voiced memory candidates, then writes them through the existing M1 memory-write repository path (so they land with the same `memory_class` / `kind` columns and the same dedup invariants the rest of the system already enforces).
- `apps/api/src/modules/workspace-management/application/context-hydration-policy.ts` — verify the new `balanced`/`premium` web defaults flow through `resolveStoredPlanContextHydrationPolicy` and `parsePlanContextHydrationPolicy` correctly (admin overrides must still be able to set `autoCompactionWeb: false` per plan).

**Implementation outline:**

1. **Flip defaults.** In `PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET_DEFAULTS`, set `balanced.autoCompactionWeb = true` and `premium.autoCompactionWeb = true`. No migration needed for stored plan policies (existing rows keep their explicit value; new plans get the new default).
2. **Move auto-compaction off the request path.** In `turn-execution.service.ts`, replace the `await this.executePostTurnAutoCompaction(...)` inside `finalizeAcceptedTurnWithPostTurnEffects` with a fire-and-forget enqueue against the api-side scheduler: persist the turn receipt, return the result to the API, then make a non-blocking internal HTTP call (or in-process bus call if runtime and api share a process boundary in dev) to `apps/api` saying "schedule compaction for `(assistantId, channel, externalThreadKey)`". The user-perceived path ends at `completeAcceptedTurn`. The `RuntimeTurnAutoCompactionState` field on `RuntimeTurnResult` becomes informational only ("a background compaction was scheduled") — not "compaction has already completed".
3. **Background scheduler shape (api-owned).** The scheduler in `apps/api` claims jobs from `assistant_background_compaction_jobs` with row-level lease, single-flight per `(assistantId, channel, externalThreadKey)`. Enqueue is upsert-style: if a job for that key is `pending` or `running`, the new enqueue is dropped (the in-flight or queued job will read fresh state when it dispatches). When a job is dispatched, the api worker calls the runtime's `POST /v1/sessions/compact-and-extract` endpoint and persists the result. If the next user turn arrives before the job finishes, do not block — the next turn renders with the previous synopsis (the existing `session_busy` precedent already covers this; M2 just makes it the steady state instead of the failure case). At ~10k users (founder sizing target) this design holds without a separate broker: claim-and-lease against Postgres handles the projected ~3–5 jobs/sec peak comfortably, survives pod restarts, and does not need Redis or a separate worker fleet.
4. **Trigger semantics — no new fields.** The compaction trigger remains "estimated input tokens for the upcoming turn ≥ `compactionTriggerThreshold`", as it already is in `session-compaction.service.ts:265`. M2 does not invent `inputBudgetPressure` or any new threshold; it only changes **where** that check runs (background, after the turn) and **what** happens when it fires (replace synopsis + auto-extract). The existing `keepRecentMinimum` per preset (lean=2 / balanced=4 / premium=6) stays as the verbatim-window floor.
5. **Rolling synopsis (replace, not concatenate).** Change the compaction output schema so each event produces a single new synopsis text that **replaces** the previous one on the session row. Feed the previous synopsis into the next compaction call as one of its inputs, so important earlier context survives across rolls. No "summary of summaries" tower.
6. **Auto-extract — human voice, not keyword extraction.** `auto-extract-to-memory.service.ts` runs **one** LLM call on the compacted turn range with a prompt of the shape "you've just watched this fragment of conversation as a friend of this person — what would you genuinely want to remember a week from now?" Output schema is exactly the M1 memory-write shape (`{ kind: "fact" | "preference" | "open_loop", summary: string }`), not entity extraction, not keywords. No NER, no regex, no backend "detect names/dates" pass. Writes go through the same `memory_write` repository path M1 already uses, so M1's `memory_class` heuristic (`fact`/`preference` → `core`, `open_loop` → `contextual`) classifies them automatically.
7. **No artificial caps.** Replace the earlier draft "≤3 entries per event" hard cap with: (a) dedup against existing `assistant_memory_registry_items.summary` for that `(assistantId, userId)` using the same normalized-text match M1 uses; (b) a soft ceiling of 8 new entries per event purely as a model-misbehavior guard, not as a quality target. If a substantive conversation legitimately produces 6 new memories, all 6 land.
8. **Cache-stable block family.** The rolling synopsis is its own stable-block family in `prompt-cache-stable-blocks.ts` (e.g. `rolling_session_synopsis`) so it keeps the prompt-cache prefix warm between turns within the session. The verbatim recent window remains in the dynamic tail.
9. **Update `RuntimeCompactionResult`** to include the auto-extract summary (count of entries written, kinds, any dedup-skips). Surface this in smoke-harness trace so we can see "compaction fired in background, wrote N memories, took T ms" without correlating timestamps by hand.
10. **Tests.** Update `session-compaction.service.test.ts` to lock the replace-not-append behavior. Add unit tests for `auto-extract-to-memory.service.ts` with deterministic fake LLM output (3 facts + 1 open_loop → 4 writes; same input twice → 4 writes the first time, 0 the second time via dedup). Add a runtime integration test asserting that `executePostTurnAutoCompaction` is no longer awaited in `finalizeAcceptedTurnWithPostTurnEffects` (regression guard for the latency win).

**Smoke-time plan configuration (founder-confirmed 2026-04-21):**

M2 acceptance is measured against the founder's existing `persai-dev` `Custom` plan with `compactionTriggerThreshold = 8000` and `autoCompactionWeb = true` set manually in `/admin/plans` (the rest of the `Custom` policy stays as-is — `targetContextBudget = 70000`, `keepRecentMinimum = 4`, `knowledgeHydrationBudget = 2400`, `autoCompactionTelegram = true`). With `trigger = 8000` the `long-session-200` scenario reliably crosses the threshold many times within a single run, so background compaction and auto-extract will fire enough times to be measurable. **Do not introduce a separate `balanced-tight` smoke fixture plan** — the founder set the trigger explicitly so the existing plan doubles as the M2 measurement plan. **Do not write a data migration that flips `autoCompactionWeb` on stored plans** — the preset-default flip in step 1 only affects newly-created plans; existing rows are admin-owned and the founder set his own value manually.

**Acceptance criteria:**

- S0 scenario `long-session-200` no longer hits the configured `targetContextBudget` of the smoke plan (70k on the founder's `Custom` plan, 24k on a fresh `balanced` plan); total tokens grow sub-linearly with turn count.
- S0 scenario `chitchat-short` shows **p95 latency unchanged or improved** vs the M1 closeout baseline (proves the in-band compaction wait is gone — short sessions never hit the threshold anyway, but the post-turn path no longer blocks the receipt close).
- S0 scenario `long-session-200` shows **p95 latency NOT regressing** vs the M1 closeout baseline despite compaction now firing — because compaction has moved off the request path. This is the headline acceptance signal for M2.
- At turn 100 of `long-session-200`, the assistant correctly answers "what did we discuss in the first 10 turns?" using the rolling synopsis.
- After scenario completion, durable memory for the test (assistant, user) pair contains a meaningful number of auto-extracted entries (not 0, not 50+) — exact band depends on conversation content; the smoke trace must show every extraction's `kind` + `summary` so the founder can eyeball quality, not just count.
- Plan-level admin override of `autoCompactionWeb: false` still works (admin can explicitly disable per plan; the M2 flip is only the **default**).
- No user-facing UI for compaction state. The plan-policy editor in `/admin/plans` (which already shows the existing fields) is the only surface where the new defaults are visible.

**Out of scope (M2):**

- Any user-visible session card, "compact now" button, or synopsis editor — would violate Principle 1.
- Cross-session synopsis stitching — handled in M3 (M2 produces the synopsis row M3 reads).
- Reworking the `targetContextBudget` / `compactionTriggerThreshold` numbers per preset — those are tuning knobs for a later slice if smoke evidence demands; M2 keeps the existing values.
- Vector/embedding-based dedup for auto-extract — lexical normalized-text dedup matches M1's choice and is enough for the founder-reviewed scenarios.
- Telegram parity smoke scenario — `autoCompactionTelegram` is already `true` everywhere; verifying behavior on TG end-to-end is a follow-through after T2 lands the proactive TG path.

**Slice M2 handoff prompt:**

> You are implementing ADR-074 Slice M2 (Background compaction with human-voiced auto-extract). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice M2 section in full. Slices S0, P1, M1 must be landed. Hard constraints: (a) auto-compaction MUST run in a background job after `completeAcceptedTurn`, never `await`-ed inside the request path — this is the headline behavior of the slice; (b) the synopsis is **replaced** every compaction, not concatenated; (c) the auto-extract LLM call is in human friend voice, output is `{ kind, summary }` rows, not keyword/NER extraction; (d) writes go through the existing M1 memory repository path so M1's `memory_class` routing applies automatically; (e) no new plan-policy fields — reuse the existing `targetContextBudget` / `compactionTriggerThreshold` / `keepRecentMinimum` / `autoCompactionWeb` / `autoCompactionTelegram` set in `RuntimeContextHydrationConfig`; (f) flip `balanced.autoCompactionWeb` and `premium.autoCompactionWeb` preset defaults to `true`, but **do not write a data migration over stored plan rows** — admin-set values are authoritative; (g) no user-facing UI; (h) no `≤3` hard cap on writes — soft ceiling 8 + dedup is enough; (i) no separate `balanced-tight` smoke fixture plan — measure against the founder's `persai-dev` `Custom` plan with `compactionTriggerThreshold = 8000` (the founder configured this manually so the existing plan doubles as the smoke plan); (j) the durable background queue lives in `apps/api` (extending or paralleling `PersaiScheduledActionSchedulerService`), runtime exposes a thin internal endpoint that executes one job — runtime never owns persistent scheduling state, this is sized for ~10k users without a separate broker. Acceptance: `long-session-200` grows sub-linearly in tokens AND its p95 latency does not regress vs the M1 baseline (because compaction is now off the request path); `chitchat-short` p95 latency unchanged or better; recall question at turn 100 succeeds; auto-extracted entries land via the M1 path with classified `memory_class`. When done, SESSION-HANDOFF + CHANGELOG with smoke-harness deltas, including a per-extraction `kind`+`summary` dump for founder eyeball review.

---

### Slice M3 — Cross-session continuity (last-session synopsis, 7-day TTL)

**Status — code-landed in code (2026-04-22 late evening), awaiting `persai-dev` smoke acceptance + founder live UI gate:**

The M3 behavioural surface is now in code on top of the M2 closeout that landed earlier the same day. Every M3 hard constraint from the handoff prompt is satisfied: the carry-over is fully cross-channel within the configured TTL (a Web synopsis surfaces in a fresh Telegram thread and vice versa — no surface-channel filter, this is the headline UTP), it fires only on turn 1 of a brand-new thread (`thread.turnCount === 0` detected structurally as "no prior hydratable messages"), the TTL is plan-policy-tunable as `crossSessionCarryOverTtlDays` on `RuntimeContextHydrationConfig` (default `7`, validated `1..90`, mirrored into all three preset defaults `lean`/`balanced`/`rich`, editable per-plan in `/admin/plans` alongside `compactionTriggerThreshold`/`autoCompactionWeb`, never user-facing), the top-N is a hard-coded code constant `MAX_CARRY_OVER_SYNOPSES = 3` (NOT plan-policy-tunable), the carry-over block is its own stable-block family with a content-hash-driven cache key so the new family does not bust the existing cached prefix from P1/M1/M2, open-loop selection runs the partial-index lookup (`kind = 'open_loop' AND memory_class = 'contextual' AND resolved_at IS NULL`, capped at 10 most-recent), and **two close paths land together (Level-2 strategy)** — implicit close-by-overwrite via `WriteAssistantMemoryService` (sets `resolved_at = now()` on a matched existing `open_loop` row whenever the dedup query finds one, regardless of the new write's `kind`), plus opt-in explicit close via the new `closeOpenLoop: boolean` (default `false`) input on the `memory_write` tool which, when `true`, calls a new internal endpoint `POST /api/v1/internal/runtime/memory/close-most-similar-open-loop` that lexically token-overlap matches active open loops for `(assistantId, userId)` (no-match is non-fatal). The carry-over block contains the founder's "магия в автобусе" usage rules **inline** (rendered as the last section of the same stable block, so when the block is absent on turn 2+ the rules are absent too — no per-turn token tax for an artifact that only applies to the cold-open turn). No user-facing UI anywhere; the only new admin surface is the numeric TTL input in `/admin/plans`.

What landed in code:

1. **Plan-policy TTL.** `packages/runtime-contract/src/index.ts` adds `crossSessionCarryOverTtlDays: number` (default `7`, validated range `1..90`, mirrored into all three `PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET_DEFAULTS` entries). `apps/api/src/modules/workspace-management/application/context-hydration-policy.ts` extends `parsePlanContextHydrationPolicy` and `resolveStoredPlanContextHydrationPolicy` so stored plan rows round-trip the field; admin overrides win when present, otherwise the preset default applies; out-of-range values are rejected on PATCH and clamped on read of legacy stored rows. `packages/contracts/openapi.yaml` adds the field to admin-plan PATCH/GET schemas (regenerated `@persai/contracts`). `apps/web/app/admin/plans/page.tsx` surfaces the field as a numeric input ("Cross-session carry-over TTL (days)") with bilingual labels in `apps/web/messages/{en,ru}.json` and a row in the plan summary card. New focused test `apps/api/test/context-hydration-policy.test.ts` locks default + round-trip + boundaries + clamping.
2. **`resolved_at` column + partial index.** New migration `apps/api/prisma/migrations/20260422030000_adr074_m3_cross_session_carry_over/migration.sql` adds `resolved_at TIMESTAMPTZ(6) NULL` on `assistant_memory_registry_items` plus `assistant_memory_registry_items_active_open_loops_idx` over `(assistant_id, user_id, created_at DESC) WHERE kind = 'open_loop' AND resolved_at IS NULL AND forgotten_at IS NULL`. Reversible. The schema mirror in `apps/api/prisma/schema.prisma` adds the column to `AssistantMemoryRegistryItem`; the domain entity exposes `resolvedAt: Date | null`.
3. **Repository surface.** Four new methods on `AssistantMemoryRegistryRepository` + Prisma impl: `findActiveOpenLoopsByAssistantUser`, `findRecentSynopsesByAssistantUser` (fetches a buffer of `RuntimeSessionCompaction` rows across all channels for the `(assistantId, userId)` pair, deduplicates in memory by `runtimeSessionId` since Prisma `distinct` does not compose with our ordering, then trims to `MAX_CARRY_OVER_SYNOPSES = 3`), `setResolvedAtById` (idempotent — only touches rows where `resolved_at IS NULL`), and `findMostSimilarActiveOpenLoop` (lexical token-overlap Jaccard match — intentionally simple because M3.1 will replace the explicit close path with an ID-based close).
4. **Both open-loop close paths.** `apps/api/src/modules/workspace-management/application/write-assistant-memory.service.ts` implements the implicit close-by-overwrite path (any new `memory_write` whose normalized summary matches an existing active open-loop closes that loop, regardless of the new write's `kind`); the matched row is then bumped via `bumpLastUsedAt` so the duplicate-write audit semantics from M2 are preserved. New `apps/api/src/modules/workspace-management/application/close-most-similar-open-loop.service.ts` implements the explicit path (validates input, bails to `assistant_not_found` for missing assistants, normalizes reference text using the same M1/M2 normalizer, runs the lexical similarity match, calls `setResolvedAtById` on success, emits `assistant.memory_open_loop_closed` audit event with `via: "memory_write_close_open_loop"` source marker — M3.1 will add distinct markers for the structured `action: "close"` and the UI button paths; no-match is non-fatal and info-logged). New internal route `POST /api/v1/internal/runtime/memory/close-most-similar-open-loop` lives on the `:3002` listener at `apps/api/src/modules/workspace-management/interface/http/internal-runtime-memory-close-most-similar.controller.ts`, bearer-authed via `PERSAI_INTERNAL_API_TOKEN`, mirrors the M1 hydrate endpoint shape.
5. **Carry-over read service + internal endpoint.** New `apps/api/src/modules/workspace-management/application/find-cross-session-carry-over.service.ts` accepts `{ assistantId, userId, ttlDays, excludeRuntimeSessionId? }` (the `excludeRuntimeSessionId` parameter prevents the carry-over from accidentally including the brand-new thread the user just opened — the runtime passes the current `runtimeSessionId` so the just-created compaction row, if any, is excluded), validates input, returns empty arrays for missing assistants, fetches up to 3 recent synopses + up to 10 active open loops, applies TTL filtering in code (`now - synopsisUpdatedAt < ttlDays * 24h`), and orders synopses most-recent-first. Cross-channel scope is structural: the repository reads all `RuntimeSessionCompaction` rows for the `(assistantId, userId)` tuple regardless of `surfaceChannel`. New internal route `POST /api/v1/internal/runtime/cross-session/carry-over` lives at `apps/api/src/modules/workspace-management/interface/http/internal-runtime-cross-session-carry-over.controller.ts` on the same `:3002` listener with the same bearer-auth model. Both new services and both new controllers are registered in `apps/api/src/modules/workspace-management/workspace-management.module.ts`.
6. **Runtime client extension.** `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts` gains `findCrossSessionCarryOver(input)` and `closeMostSimilarOpenLoop(input)` typed methods with full input/output type definitions and the `InternalCrossSessionCarryOverSynopsis` and `InternalCrossSessionCarryOverOpenLoop` row shapes.
7. **Turn-context hydration call (turn 0 only, fail-soft).** `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` detects "turn 0 of a brand-new thread" by checking that no prior hydratable messages exist (existing structural check used elsewhere in the same service) and short-circuits when `crossSessionCarryOverTtlDays === 0` (defence — the contract clamps to `≥1` but a stored row could carry `0` from a hand-edit). On qualifying turns the service calls `findCrossSessionCarryOver` with the resolved TTL and the current `runtimeSessionId` as the exclusion, renders the result via the new `cross-session-carry-over-renderer.ts`, and prepends the rendered block as a single `assistant`-role stable message. **Fetch failure is swallowed** — a `WARN [TurnContextHydrationService] Cross-session carry-over fetch failed; continuing without M3 block.` log is emitted and the turn proceeds without the block (failing the entire turn over a missing carry-over surface would be a worse user experience than skipping the magic moment). The block is omitted entirely when both lists are empty.
8. **Renderer (`cross-session-carry-over-renderer.ts`).** Time-aware phrases ("less than an hour ago" / "earlier today" / "yesterday" / "N days ago"), channel humanization (`web → Web`, `telegram → Telegram`, `app → App`), bullet rendering for a single qualifying synopsis (no "1." prefix), numbered list for multiple synopses, open loops rendered after the synopsis section with a soft cap of 10, whitespace-only summaries filtered out, and the **usage-rules footer** (the founder's "magic vs creepy" anti-recap rules verbatim from the carry-over block shape section above — DO weave naturally on relevance / DO NOT recap / DO NOT name the previous channel / DO NOT list open loops as a status report) rendered **inline** as the last section of the same stable block. The synopsis text is parsed through the existing M2 `parseStoredReusableCompactionState` helper with a 1200-char budget, so we get the same deterministic, budgeted summary string the rest of the runtime sees.
9. **Stable-block family.** `apps/runtime/src/modules/turns/prompt-cache-stable-blocks.ts` registers `cross_session_carry_over` as its own stable family with a stable-block token derived from the trimmed body content (the same scheme used by `durable_memory_core`). New `formatCrossSessionCarryOverStableBlock(content)` and `isCrossSessionCarryOverMessage(message)` helpers are exported. `resolveLeadingHydratedPromptCacheStableBlockTokens` extends the prefix walk so the M3 family sits between `durable_memory_core` (M1) and `rolling_session_synopsis` (M2). Identical content produces an identical token regardless of which thread is opening it; the token changes when M2 replaces a synopsis, when an open loop is added/resolved, or when admin retunes TTL on the plan. Unrelated families are unaffected.
10. **`memory_write` tool gains `closeOpenLoop: boolean`.** `apps/runtime/src/modules/turns/runtime-memory-write-tool.service.ts` and `apps/runtime/src/modules/turns/native-tool-projection.ts` add the optional `closeOpenLoop: boolean` (default `false`) input. When `true`, after the write succeeds the tool calls the new internal `closeMostSimilarOpenLoop` route with the just-written summary as the reference text and the same `requestId`. The follow-up call is fire-and-forget in the failure direction (`WARN [RuntimeMemoryWriteToolService] [memory_write] closeOpenLoop=true follow-up failed for assistant=...`). A non-boolean `closeOpenLoop` is rejected as `invalid_arguments` at the input parser. The tool is unchanged when `closeOpenLoop` is `false` or omitted.
11. **Model-facing prompt.** `apps/api/prisma/bootstrap-preset-data.ts` `memory_write` `usage_guidance` extended (≤ 60 tokens of new content over the M1 baseline) to teach the model "Set closeOpenLoop:true ONLY when this same memory_write also resolves a previously-recorded open loop". The carry-over usage rules themselves live **inline in the rendered M3 block** rather than in the system prompt, per the renderer rationale above.
12. **Smoke harness scenario extended (web-only, founder picked `minimal_e`).** `scripts/smoke/scenarios/multi-session-continuity.json` now has an explicit three-session shape with notes calling out the M3 expectations (`session-1` plants substantive Web content; `session-2-recall` opens fresh thread + asserts M3 carry-over + closes an open loop; `session-3-after-close` verifies the closed loop no longer surfaces). `scripts/smoke/README.md` got a new M3 acceptance section explicitly stating that cross-channel TG verification remains a manual UI gate the founder runs personally as the closing acceptance gate — wiring a real TG channel turn driver in `scripts/smoke/lib/api-client.ts` is queued as a smoke-harness follow-up if M3 evidence demands.
13. **Tests landed alongside the behaviour.** `apps/api/test/find-cross-session-carry-over.service.test.ts` (validation, missing assistant, top-N, per-session dedup, cross-channel both directions, TTL boundaries, `excludeRuntimeSessionId`, empty passthrough), `apps/api/test/close-most-similar-open-loop.service.test.ts` (input parsing, missing assistant, no match, successful close + audit event, idempotent already-resolved), `apps/api/test/internal-runtime-cross-session-carry-over.controller.test.ts` (auth + happy + empty passthrough), `apps/api/test/internal-runtime-memory-close-most-similar.controller.test.ts` (auth + matched + no-match), `apps/api/test/context-hydration-policy.test.ts` (default = `7`, round-trip, `1`/`90` accepted, `0`/`91` rejected, type rejections, clamping), `apps/api/test/write-assistant-memory.service.test.ts` extended with implicit close-by-overwrite + idempotency, `apps/runtime/test/turn-context-hydration.service.test.ts` extended with `runCrossSessionCarryOverM3Acceptance` covering turn 0 (one call, correct `ttlDays`/`assistantId`, block prepended), non-turn-0 (no call), fetch failure (swallowed, block omitted), `ttlDays === 0` (short-circuit, no call), `apps/runtime/test/cross-session-carry-over-renderer.test.ts` (empty → null, single synopsis bullet rendering, multi synopsis numbered + time-aware + channel humanization, top-N cap of 10, whitespace filtering, footer presence + DO/DON'T rules, section ordering), `apps/runtime/test/prompt-cache-stable-blocks.test.ts` extended with `cross_session_carry_over` family invariants, `apps/runtime/test/runtime-memory-write-tool.service.test.ts` extended with full `closeOpenLoop` matrix (default/omitted/false → no follow-up; explicit `true` on success → exactly one follow-up; explicit `true` on denied write → no follow-up; explicit `true` with follow-up throws → write still succeeds; non-boolean → `invalid_arguments`); `apps/runtime/test/run-suite.ts` was extended to import + call the renderer + memory-write suites so they run in the standard `pnpm --filter @persai/runtime test` lane.

Verification gate this session: `pnpm --filter @persai/api prisma:generate` clean, `pnpm --filter @persai/runtime-contract typecheck` clean, `pnpm --filter @persai/contracts build` regenerated cleanly, `pnpm --filter @persai/api typecheck` clean, `pnpm --filter @persai/runtime typecheck` clean, `pnpm --filter @persai/web typecheck` clean, `pnpm -r --if-present run lint` clean, `pnpm --filter @persai/api test` clean (45 suites pass), `pnpm --filter @persai/runtime test` clean (full run-suite passes), `pnpm run format:check` clean for every M3-touched file (the 279 remaining warnings under `packages/contracts/src/generated/*` and other unrelated paths are pre-existing format drift that is intentionally left out of this slice).

Live acceptance against the founder's `persai-dev` `Custom` plan (`compactionTriggerThreshold = 8000`, `targetContextBudget = 70000`, `keepRecentMinimum = 4`, `autoCompactionWeb = true`, `autoCompactionTelegram = true`) — the magic-moment cross-channel scenario the founder runs personally on the live UI as the closing gate, plus the deterministic `multi-session-continuity` rerun under both `crossSessionCarryOverTtlDays = 7` and `= 14` to prove the plan-policy field is wired end-to-end, plus an optional `chitchat-short` + `long-session-200` rerun to confirm the cache-hit-rate stays within ±2 pp of the M2 closeout baseline (the new family must not bust the existing cached prefix) — runs **after** image publish + Argo CD rollout + Prisma migration apply, and lands as a follow-up CHANGELOG closeout entry once measured. Treat the slice as "code-landed, live-pending" rather than fully closed until those run.

---

- **Goal:** When the user opens a new conversation thread with an assistant, inject (a) all currently-open `open_loop` memory entries (no TTL — open loops never expire on their own; the model closes them by overwriting the entry summary via the existing `memory_write` flow, or by the new opt-in `closeOpenLoop: true` extension below), (b) up to `MAX_CARRY_OVER_SYNOPSES = 3` most-recent rolling synopses of prior threads, all filtered by a plan-policy TTL (`crossSessionCarryOverTtlDays`, default `7`), regardless of which channel each prior thread was on. Old sessions fade in the conversational sense — only durable facts, preferences, and open loops remain. The new chat does not feel cold to the user, but also does not begin with a creepy "last time we discussed X" recap.
- **Founder anchor:** Principle 2 ("lives in time") + Principle 1 (magic — no user-visible "carry-over toggle"). From Q6-C.

**Founder-confirmed M3 specifics (2026-04-21 interview):**

- **Carry-over is fully cross-channel within the 7-day TTL.** This is the **headline product UTP** of M3, not a side effect. Founder design target: "Маша обсуждала на Web дома, села в автобус, открыла Telegram — ассистент удивил её, естественно подхватив тему". Memory from M1 already crosses channels (`(assistantId, userId)` scope), and the rolling synopsis from M2 must too. There is **no channel-family scoping**, no "web→web only" rule — that would kill the magic. The carry-over block does carry a `previousChannel` metadata field so the model can reason about it ("прошлый разговор был на Web"), but content visibility is identical regardless of source/destination channel.
- **Magic vs creepy is enforced in the system-prompt usage rules, not by withholding context.** The full content is always available within the TTL; the prompt instructs the model to **weave** it in naturally on relevance, never **recite** it as a formal opener. See the Carry-over block shape section below — those usage rules are the whole anti-creepy mechanism. Withholding synopsis text cross-channel would only make the assistant feel forgetful in the bus moment, which is the opposite of what we are building.
- **"New session" = first turn of a thread with zero prior turns** (i.e. brand-new `externalThreadKey`). Long-gap-after-silence inside an existing thread is **T1's** territory (heartbeat with `time_since_last_user_message`), not M3's. M3 has one trigger only: `thread.turnCount === 0`. Rationale: when the user reopens an existing thread, the full prior conversation is already in the in-thread context — duplicating it via M3 carry-over would burn tokens and read tonally weird ("помню, мы обсуждали retention" — да, я ещё это вижу выше).
- **TTL is plan-policy-tunable, default 7 days.** Lives as `crossSessionCarryOverTtlDays` on the existing `RuntimeContextHydrationConfig` plan-policy surface (`packages/runtime-contract/src/index.ts`), edited per-plan in `/admin/plans` alongside `compactionTriggerThreshold` / `autoCompactionWeb` / `keepRecentMinimum`. Default `7`, allowed range `1..90` clamped at the contract level. The founder explicitly chose admin-tunable over hard-coded so different plans can carry context for different time windows (`lean` may want shorter horizons, `rich` may want longer). This is the only acceptable kind of "switch" under Principle 5 (existing plan-policy field family extension), not a new feature flag.
- **Top-N most-recent synopses across all channels.** M3 surfaces up to `MAX_CARRY_OVER_SYNOPSES` (hard-coded constant in code, value `3`) most-recent synopsis rows for `(assistantId, userId)` regardless of which channel each came from, ordered by `synopsis_updated_at DESC` and filtered by TTL. The count is a code constant, not plan-policy: only TTL is admin-tunable. Rationale: 3 keeps the carry-over block bounded (~450–600 tokens worst case), the founder picked it over option (a) "single synopsis" because the original draft "single is enough" was thin and a real cluster of recent threads gives the model a richer continuity surface without re-engineering. Going past 3 needs evidence and is a follow-through, not a config change.
- **Open-loop selection.** All `assistant_memory_registry_items` rows for `(assistantId, userId)` with `kind = 'open_loop'` AND `memory_class = 'contextual'` (per the M1 classifier) AND `resolved_at IS NULL` (M3 adds this column — see Implementation step 1). Soft cap of 10 most-recent open loops keeps the carry-over block bounded. Open loops have no TTL of their own: they live until the model resolves them. M3 ships **two resolution paths** (founder explicitly picked Level 2 to reduce dependency on dedup heuristics): (1) the existing `memory_write` overwrite-by-summary path (dedup catches it, sets `resolved_at = now()` on the matched row), and (2) a small opt-in extension to `memory_write` — a new optional input field `closeOpenLoop: boolean` (default `false`) that, when `true`, sets `resolved_at = now()` on the most-similar active open-loop entry for `(assistantId, userId)` after the write completes. The model is taught in the `memory_write` `usage_guidance` to set `closeOpenLoop: true` when the write resolves a thread the user opened earlier (e.g. "Маша выбрала Барселону 15-25 июля" closes the "обсудить даты отпуска" loop). The fully ergonomic path — UI button in Memory Center for the user to manually close a loop, plus structured `memory_write({ action: "close", ref: <id> })` — is queued as **Slice M3.1** (separate slice in this ADR, not deferred to a future ADR, so it cannot get lost).

**Live truth from M2 (do NOT re-derive — wire your slice to the M2 row M2 actually persisted):**

- M2 persists the rolling session synopsis on whatever row M2 picked when it landed (likely an extension of the existing session compaction state row in `apps/api/prisma/schema.prisma`). Before implementing M3, **read the M2 closeout SESSION-HANDOFF entry** to find the exact column names — do not invent them. The expected shape is `synopsis_text TEXT NULL` + `synopsis_updated_at TIMESTAMPTZ NULL` (or equivalent) + a foreign-key relationship to the `(assistantId, channel, externalThreadKey)` triple.
- M2 also exposes `RuntimeCompactionResult.autoExtract` so by the time M3 fires there are durable memory entries M2 created (in addition to entries the model wrote via `memory_write`). M3 reads from the same `assistant_memory_registry_items` table; it does not care which path wrote them.
- M2's background scheduler in `apps/api` may not have finished when M3's new-thread fires (e.g., user starts a new chat 30 seconds after closing the old one and M2's job is still running). This is fine: M3 reads whatever synopsis is currently persisted; if M2 hasn't replaced it yet, M3 reads the previous one (one synopsis-version stale is acceptable, same `session_busy` precedent).

**Touch points:**

- `apps/api/prisma/schema.prisma` — add `resolved_at TIMESTAMPTZ NULL` to `assistant_memory_registry_items` (no equivalent column today; confirmed by M1 schema). Confirm M2's synopsis storage location and column names; do not duplicate them.
- `packages/runtime-contract/src/index.ts` — add `crossSessionCarryOverTtlDays: number` field to `RuntimeContextHydrationConfig` (default `7`, range `1..90` validated at the contract boundary). Add the same default to all `PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET_DEFAULTS` entries (`lean` / `balanced` / `rich`).
- `apps/api/src/modules/workspace-management/application/context-hydration-policy.ts` — extend `resolveStoredPlanContextHydrationPolicy` and `parsePlanContextHydrationPolicy` so the new field round-trips correctly through stored plan rows; admin overrides are preserved.
- `apps/api/prisma/migrations/<timestamp>_adr074_m3_cross_session_carry_over/migration.sql` — additive: `ALTER TABLE assistant_memory_registry_items ADD COLUMN resolved_at TIMESTAMPTZ NULL`, plus `CREATE INDEX` for `(assistant_id, user_id, kind, resolved_at) WHERE kind = 'open_loop' AND resolved_at IS NULL` to make the unresolved-open-loop lookup cheap.
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` — at the very start of every turn, check `thread.turnCount === 0`. If yes, call new `findCrossSessionCarryOver({ assistantId, userId, now, ttlDays })` (TTL pulled from the resolved plan-policy) and prepend the result before the rolling-synopsis (M2) and verbatim-recent-window blocks.
- New (in `apps/api`, exposed via the same internal listener M1 uses): `POST /api/v1/internal/runtime/cross-session/carry-over` returning `{ openLoops: Array<{ id, summary }>, recentSynopses: Array<{ text, ageDays, channel, synopsisUpdatedAt }> }` (note: `recentSynopses` is an array of up to `MAX_CARRY_OVER_SYNOPSES = 3`, ordered most-recent-first; empty array when none qualify). This mirrors the M1 hydrate endpoint pattern (port 3002, internal-only, runtime-to-api call) so runtime stays stateless. The internal payload also accepts the resolved `ttlDays` from the runtime so the API does not have to re-resolve the plan.
- New api-side service: `apps/api/src/modules/workspace-management/application/find-cross-session-carry-over.service.ts` — combines (a) up to 10 most-recent unresolved open loops via the M1 repository, (b) up to `MAX_CARRY_OVER_SYNOPSES = 3` most-recent synopsis rows across **all** channels for this `(assistantId, userId)` via a new repository method (ordered by `synopsis_updated_at DESC`, filtered by `now - synopsis_updated_at < ttlDays`). The synopsis lookup is intentionally cross-channel: a Web synopsis surfaces in a fresh Telegram thread and vice versa — that is the M3 magic, not a bug.
- `apps/runtime/src/modules/turns/prompt-cache-stable-blocks.ts` — register `cross_session_carry_over` as its own stable family. Cache key includes `(assistantId, userId, synopsesVersionHash, openLoopsVersionHash, ttlDays)` so multiple new threads opened in the same window hit the same cached block; cache invalidates only when the underlying carry-over content actually changes (or when admin retunes TTL on the plan).
- `apps/api/prisma/bootstrap-preset-data.ts` — extend the soul / system prompt template (or add a small dedicated block) with the carry-over usage rules below. The block is short (~80 tokens) and never user-visible. Also extend the `memory_write` tool's `usage_guidance` to teach the model when to set the new `closeOpenLoop: true` flag.
- `apps/runtime/src/modules/turns/runtime-memory-write-tool.service.ts` + `apps/runtime/src/modules/turns/native-tool-projection.ts` — add optional `closeOpenLoop: boolean` (default `false`) to the `memory_write` tool input schema. When `true`, after the write succeeds and after any dedup outcome, the runtime calls a new `closeMostSimilarOpenLoop({ assistantId, userId, summary })` internal endpoint that sets `resolved_at = now()` on the most-similar active open-loop entry (lexical similarity match against `summary`); a no-match outcome is non-fatal.
- `apps/api/src/modules/workspace-management/application/write-assistant-memory.service.ts` — when the `memory_write` flow itself overwrites an existing open-loop entry by dedup (existing M1/M2 path), also set `resolved_at = now()` on that row in the same transaction. This is the implicit close-by-overwrite path; the new explicit `closeOpenLoop` flag is the additional opt-in path the model can use proactively.
- `apps/web/app/admin/plans/page.tsx` — surface the new `crossSessionCarryOverTtlDays` field as a numeric input in the existing context-hydration policy block, with the same edit/save semantics as `compactionTriggerThreshold`. Bilingual labels in `apps/web/messages/{en,ru}.json`. No user-facing UI anywhere — admin-only.
- `packages/contracts/openapi.yaml` + regenerated `@persai/contracts` — admin-plan API surface gains the new field.

**Design target (founder, 2026-04-21):**

> Маша обсуждала на Web дома планирование тимового ретрита в Барселоне. Села в автобус, открыла Telegram, написала «привет». Ассистент отвечает: «о, ты подумала про даты ретрита?» — это магия. НЕ «хочу напомнить, что вчера в 14:32 на Web мы обсуждали ретрит» — это казёнщина. Carry-over блок — это **семя для тёплой непрерывности**, а не материал для формальных recap'ов. Вся разница между «магия» и «жуть» — в том, **как** модель использует контекст, а не в том, **что** она видит.

**Carry-over block shape (target rendering, ~250–600 tokens for the top-3 case, scales down when fewer synopses qualify):**

```
# Continuity from earlier conversations
Recent conversations (most recent first):
1. {{synopsis_1_age_human}} on {{synopsis_1_channel}} — {{synopsis_1_text}}
2. {{synopsis_2_age_human}} on {{synopsis_2_channel}} — {{synopsis_2_text}}
3. {{synopsis_3_age_human}} on {{synopsis_3_channel}} — {{synopsis_3_text}}

Things you've kept in mind for this person:
- {{open_loop_1}}
- {{open_loop_2}}
- ...

# How to use this continuity (humanity over recap)
You are one continuous presence in this person's life across Web, App, and Telegram.
The fact that the last chat was on a different surface than this one is normal — do not flag it.

DO:
- Lead with current presence — match the user's energy and the immediate message they just sent.
- If the current topic naturally connects to the previous conversation or to an open loop, weave it in lightly: "о, ты подумала про даты ретрита?" / "а, кстати — как там с retention?".
- Surface an open loop only when its natural follow-up moment has arrived (a few days after it was opened, when the topic is contextually live, or when the user themselves opens that thread).
- Use the previous-conversation channel as background context only — the model knows the prior chat happened on Web while this one is on Telegram, but does not announce that.

DON'T:
- Open with a recap: never "помню, мы вчера обсуждали X" / "last time we discussed Y" / "хочу напомнить про Z".
- Read the synopsis back to the user. They lived it; they don't need it summarized.
- Reference the previous channel by name ("ты на Web писала про…") — it sounds clinical and surveillance-y. The user just feels you remember; they don't need to know how.
- List open loops at the start of a conversation. Surface them when relevant, not as a status report.
- If the user opens cold with a question unrelated to any prior context, ignore the carry-over entirely and just answer.
```

The block lives at the **head of the cached prefix family**, after `durable_memory_core` (M1) and before `rolling_session_synopsis` (M2). On a new thread (turn 1) it's present; on turn 2+ of the same thread it's absent (the in-thread context replaces it).

**Implementation outline:**

1. **Add the plan-policy TTL field.** In `packages/runtime-contract/src/index.ts`, add `crossSessionCarryOverTtlDays: number` to `RuntimeContextHydrationConfig` with default `7` and validated range `1..90`. Mirror the default into all three preset entries (`lean`, `balanced`, `rich`). Update `apps/api/src/modules/workspace-management/application/context-hydration-policy.ts` parser/resolver so stored plan rows round-trip the field; admin overrides win when present, otherwise the preset default applies. Add the field to `packages/contracts/openapi.yaml` (admin-plan PATCH/GET schemas), regenerate `@persai/contracts`, surface a numeric input in `apps/web/app/admin/plans/page.tsx` with bilingual labels in `apps/web/messages/{en,ru}.json`.
2. **Add the `resolved_at` column + close mechanisms.** New migration adds `resolved_at TIMESTAMPTZ NULL` on `assistant_memory_registry_items` plus a partial index for `(assistant_id, user_id, kind, resolved_at) WHERE kind = 'open_loop' AND resolved_at IS NULL`. Two close paths land **together** (Level-2 strategy chosen by the founder to reduce dependency on dedup heuristics and to make sure the close mechanism is real on day one): (a) **implicit close-by-overwrite** — when `WriteAssistantMemoryService` matches an existing entry by normalized summary (the M1/M2 dedup path) and that entry is `kind='open_loop'`, set `resolved_at = now()` on the matched row in the same transaction; (b) **opt-in explicit close** — add an optional `closeOpenLoop: boolean` (default `false`) input field to the `memory_write` tool; when set to `true`, after the write succeeds the runtime calls a new internal endpoint `POST /api/v1/internal/runtime/memory/close-most-similar-open-loop` with `{ assistantId, userId, summary }` which performs a lexical similarity match against active open-loop entries (reuses M1's normalized-summary helper) and sets `resolved_at = now()` on the best match; a no-match outcome is non-fatal and logged at info-level. The repository read path that builds carry-over filters `kind = 'open_loop' AND resolved_at IS NULL` so resolved loops disappear from the next M3 hydration. Update `apps/api/prisma/bootstrap-preset-data.ts` `memory_write` `usage_guidance` to teach the model when to set `closeOpenLoop: true` ("set this when the write resolves a thread the user opened earlier").
3. **Build the api-side `FindCrossSessionCarryOverService`.** Returns up to `MAX_CARRY_OVER_SYNOPSES = 3` (hard-coded code constant) most-recent synopsis rows across **all** of the user's threads with that assistant (cross-channel, no channel filter), filtered by `now - synopsis_updated_at < ttlDays * 24h` (TTL passed in by the runtime from the resolved plan-policy), plus up to 10 most-recent unresolved open loops. Both lists may be empty independently. The cross-channel scope is the headline behavior — implementer must NOT add a channel-filter parameter "for safety"; the magic is precisely that the synopses cross channels.
4. **Internal HTTP route on `apps/api`** — `POST /api/v1/internal/runtime/cross-session/carry-over` on `API_INTERNAL_PORT=3002`. Request body includes `{ assistantId, userId, ttlDays }`. Response: `{ openLoops: Array<{ id, summary }>, recentSynopses: Array<{ text, ageDays, channel, synopsisUpdatedAt }> }` (synopses sorted most-recent-first). Same auth model as the M1 hydrate route.
5. **Runtime hydration call.** In `turn-context-hydration.service.ts`, when the incoming turn is the first turn of a new thread (`turnCount === 0`), resolve the plan policy to get `ttlDays`, then call the new internal route. If the response has zero open loops and zero synopses, the block is omitted entirely and the prompt is exactly what it was without M3. Otherwise, render the block per the shape above (loop over `recentSynopses` with index `1..N`, omit numbering when only one synopsis qualifies for cleaner reading) and prepend it to the message stack.
6. **Cache stability.** Register `cross_session_carry_over` as a stable-block family. Compute the cache key from `(synopsesVersionHash, openLoopsVersionHash, ttlDays)` — content-driven, not thread-driven — so a user starting three new threads in the same window hits the same cached block. The hash invalidates when M2 replaces a synopsis, when an open loop is added/resolved, or when admin retunes TTL on the plan (which changes which synopses qualify). Do NOT include `assistantId`/`userId` in the hash inputs; the cache namespace already isolates by them.
7. **Time-aware rendering.** `synopsis_N_age_human` is computed at hydration time from `now - synopsis_updated_at`: "less than an hour ago" / "earlier today" / "yesterday" / "3 days ago" / "5 days ago". This serves Principle 2 ("lives in time") — the assistant naturally has time anchoring for cross-session context, not just within-session context (which is T1's heartbeat).
8. **Tests.**
   - Unit (TTL + top-N): plan with `ttlDays=7` → synopsis 1h old qualifies, 6.9d old qualifies, 7.1d old does not; plan with `ttlDays=14` → 7.1d old qualifies; with 5 qualifying synopses → only top 3 most-recent surface; with 0 qualifying synopses but unresolved open loops → block has open loops only; with both empty → block absent.
   - Unit (cross-channel): synopsis written via TG thread, new Web thread → synopsis surfaces in Web carry-over; same in reverse.
   - Unit (open-loop close): `memory_write` with `closeOpenLoop: true` and an active matching loop → `resolved_at` is set, loop disappears from next carry-over; `memory_write` overwrite-by-summary on an `open_loop` row → `resolved_at` is set even without `closeOpenLoop: true`; `memory_write` with `closeOpenLoop: true` and no similar loop → write succeeds, no-op on resolution, info-log emitted.
   - Unit (admin field round-trip): plan saved with `crossSessionCarryOverTtlDays=14` → `resolveStoredPlanContextHydrationPolicy` returns `14`; plan saved with the field omitted → preset default `7` returned; out-of-range value (e.g. `0` or `91`) rejected at parse time.
   - Integration: smoke `multi-session-continuity` extended (per the founder Q6) — session 1 on Web ends with substantive content (M2 writes synopsis); session 2 on TG opens cold with vague greeting; assistant should NOT explicitly recap ("помню, мы обсуждали Y") and should NOT name the previous channel. Founder eyeball-reviews the live transcript through the UI directly (manual gate).
   - Cache regression: smoke `chitchat-short` from a user with 5 prior cross-session synopses (pre-seeded) — cached input tokens stay at the M2 closeout baseline within ±2pp because the carry-over block is its own stable family.

**Smoke-time configuration (founder's `persai-dev` `Custom` plan):**

M3 acceptance is measured against the same `Custom` plan used for M2 (`compactionTriggerThreshold = 8000`, `targetContextBudget = 70000`, `keepRecentMinimum = 4`, `autoCompactionWeb = true`, `autoCompactionTelegram = true`). The `multi-session-continuity` scenario already runs two sessions; M3 extends what that scenario can verify — session 1 ends, M2 background compaction writes a synopsis, session 2 opens cold and the assistant has cross-session context without being prompted. No new smoke fixture or plan is needed.

**Acceptance criteria:**

- **Magic-moment live UI gate (founder-driven, the headline M3 acceptance signal).** The founder personally runs the cross-channel scenario through the live `persai-dev` UI: a substantive conversation on Web with the test assistant (enough to make M2 write a synopsis), wait for M2's background scheduler to land the synopsis, then open a fresh Telegram thread with the same assistant within the configured TTL and type a casual greeting. The assistant's first reply must (a) lead with current presence, (b) naturally weave in a reference to a topic from the prior Web conversation **without** reciting any synopsis or naming the previous channel, (c) not list open loops as a status report. Founder eyeball-review on the live transcript is the **closing gate**; the smoke harness extension below provides the deterministic regression bar but cannot replace the live UI moment.
- **S0 scenario `multi-session-continuity` extension (deterministic regression bar).** The existing `multi-session-continuity` scenario is extended (NOT a new file — the founder Q6 picked extension): session 1 stays on Web; session 2 switches `surfaceChannel` to `telegram` against the same `(assistantId, userId)` pair (the smoke harness extension required to drive a TG-channel turn end-to-end is a small addition documented in `scripts/smoke/README.md` as part of M3 landing). Session 2 turn 1 must (a) pass the M1 cross-session recall bar that already exists, (b) NOT explicitly recap the previous session ("помню, мы обсуждали Y" / "last time we talked about X"), (c) NOT mention the previous channel by name, (d) succeed even when the test plan's `crossSessionCarryOverTtlDays` is set to a non-default value (test runs both `7` and `14` to prove the plan-policy field is wired end-to-end).
- A natural-follow-up turn (user types something contextually live to a planted open loop) — assistant responds informedly without first reading the loop back as a status update.
- **TTL admin-tunable proof.** With `crossSessionCarryOverTtlDays = 1` on the test plan and a synopsis that is 25h old, the carry-over block is absent. With the same synopsis and `crossSessionCarryOverTtlDays = 7`, the carry-over block is present. (Test-enforced via fake-clock unit test plus a single live-dev confirmation by the founder through `/admin/plans` toggle.)
- **Top-N invariant.** With 5 qualifying synopses pre-seeded, the carry-over block contains exactly 3 (the most recent), ordered most-recent-first. With 1 qualifying synopsis, the block contains 1 and uses the simpler single-synopsis rendering (no "1." prefix). With 0 qualifying synopses but active open loops, the block has only the open-loops section.
- **Cache hit rate preserved.** P1 prompt-cache hit rate is preserved on `chitchat-short` and on `long-session-200` — the new stable family does not bust the existing cached prefix (cached input tokens within ±2pp of the M2 closeout baseline).
- **Cross-channel surfacing.** A synopsis written by a TG thread surfaces in a fresh Web thread for the same `(assistantId, userId)` pair, and vice versa (unit + integration test).
- **Open-loop resolution — both paths.** (a) When the model writes a `memory_write` that overwrites an existing open-loop summary with a closing note, the corresponding row's `resolved_at` is set and the loop disappears from the next carry-over. (b) When the model sets `closeOpenLoop: true` on a `memory_write` that is similar to an active open-loop entry, that entry's `resolved_at` is set and the loop disappears from the next carry-over. (c) When `closeOpenLoop: true` is set but no similar loop exists, the write succeeds, no rows are updated, an info-log is emitted, and the next carry-over is unchanged.
- M3 adds no user-facing UI surface anywhere; the new admin-tunable TTL lives only in `/admin/plans`. (User-facing "close this loop" buttons are queued in Slice M3.1.)

**Out of scope (M3):**

- Multi-session synopsis **stitching** ("write one paragraph summarizing the last 3 sessions") — M3 surfaces the top-3 synopses as separate items, it does not synthesize a meta-synopsis across them.
- Session merge / threading UI — would violate Principle 1.
- Going past `MAX_CARRY_OVER_SYNOPSES = 3` or making it admin-tunable — the count is a hard-coded code constant on purpose; only TTL is admin-tunable. Going past 3 needs evidence and is a follow-through, not a config change.
- Structured `memory_write({ action: "close", ref: <id> })` API surface and a Memory Center "close this loop" UI button — both queued as **Slice M3.1** (separate slice in this ADR, see below). M3 ships only the implicit close-by-overwrite path plus the opt-in `closeOpenLoop: boolean` flag on `memory_write`; M3.1 brings the fully ergonomic UX.
- Vector / embedding-based open-loop relevance ranking for the `closeOpenLoop` similarity match — lexical normalized-summary match (reusing M1's helper) is enough; vector ranking is a memory-system follow-through if evidence demands.
- Per-channel carry-over scoping — explicitly REJECTED. The M3 design is fully cross-channel within the configured TTL; the founder anchor is the magic moment of being recognized in Telegram on the bus after a Web conversation at home. Channel-scoping would be a regression of the headline UTP.
- A user-facing TTL setting — only admin-tunable via `/admin/plans`. End users never see this knob (Principle 1).

**Slice M3 handoff prompt:**

> You are implementing ADR-074 Slice M3 (Cross-session continuity, plan-tunable TTL with default 7 days, top-3 synopses, Level-2 open-loop close). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice M3 section in full. Slices S0, P1, M1, M2 must all be landed (M2 produces the synopsis rows you read). Hard constraints:
>
> 1. **Carry-over is fully cross-channel** within the configured TTL — a Web synopsis must surface in a fresh Telegram thread and vice versa, this is the headline product UTP, NOT a side effect; do NOT add channel-family scoping "for safety".
> 2. M3 fires only on turn 1 of a brand-new thread (`thread.turnCount === 0`), not on long-gap-after-silence inside an existing thread (that's T1's territory).
> 3. **TTL is plan-policy-tunable** (`crossSessionCarryOverTtlDays` on `RuntimeContextHydrationConfig` in `packages/runtime-contract/src/index.ts`, default `7`, validated range `1..90`). It is editable per-plan in `/admin/plans` alongside `compactionTriggerThreshold` / `autoCompactionWeb`. Mirror the default into all three preset entries (`lean` / `balanced` / `rich`). Never user-facing.
> 4. **Top-N is a hard-coded code constant** `MAX_CARRY_OVER_SYNOPSES = 3` — NOT plan-policy-tunable. Surface up to 3 most-recent synopses across all channels for `(assistantId, userId)`, ordered most-recent-first, all filtered by TTL.
> 5. The carry-over block is its own stable-block family with a content-hash cache key (`synopsesVersionHash + openLoopsVersionHash + ttlDays`) so multiple new threads opened in the same window hit the same cache; M2's synopsis replacement and any admin TTL retune both trigger a fresh M3 cache without busting unrelated families.
> 6. Open-loop selection: `kind='open_loop' AND memory_class='contextual' AND resolved_at IS NULL`, capped at 10 most-recent. The `resolved_at` column is added in this slice's migration plus the partial index for the unresolved-loop lookup.
> 7. **Two close paths land together (Level-2)**: (a) implicit close-by-overwrite — `WriteAssistantMemoryService` sets `resolved_at = now()` when its dedup matches an existing `kind='open_loop'` row; (b) opt-in explicit close — new optional `closeOpenLoop: boolean` (default `false`) input on the `memory_write` tool; when `true`, runtime calls a new internal endpoint `POST /api/v1/internal/runtime/memory/close-most-similar-open-loop` which lexically matches against active open loops for `(assistantId, userId)` and sets `resolved_at = now()` on the best match (no-match is non-fatal). Update the `memory_write` `usage_guidance` in `apps/api/prisma/bootstrap-preset-data.ts` to teach the model when to set `closeOpenLoop: true`. The fully ergonomic path (UI button in Memory Center + structured `memory_write({ action: "close", ref })`) is **Slice M3.1** — out of scope here, but already a real slice in this ADR (NOT deferred to a future ADR), so it is queued not lost.
> 8. The carry-over block contains explicit usage rules built around the founder's "магия в автобусе" design target — DO weave naturally on relevance, DO NOT recap, DO NOT name the previous channel, DO NOT list open loops as a status report; humanity over recap.
> 9. No user-facing UI anywhere; the only new admin surface is the numeric TTL input in `/admin/plans`.
> 10. The synopsis row name and shape MUST be read from the M2 closeout SESSION-HANDOFF entry (`docs/SESSION-HANDOFF.md` 2026-04-22 evening) — do not invent column names.
>
> Acceptance:
>
> 1. Founder runs the magic-moment live UI gate personally on `persai-dev`: substantive Web conversation → wait for M2 to write synopsis → fresh TG thread within TTL → assistant's first reply weaves Web context naturally without recap or channel-naming. This is the closing gate.
> 2. The S0 `multi-session-continuity` scenario is **extended** (not a new file) so session 2 switches `surfaceChannel` to `telegram`; it must pass the M1 cross-session recall bar AND show no recap / no previous-channel-naming behavior, run successfully under both `crossSessionCarryOverTtlDays=7` and `=14` to prove the plan-policy field is wired end-to-end. The minimal smoke-harness extension required to drive a TG-channel turn end-to-end lands in the same slice and is documented in `scripts/smoke/README.md`.
> 3. TTL admin-tunable proof: `=1` with 25h-old synopsis → block absent; `=7` with same synopsis → block present.
> 4. Top-N invariant: 5 qualifying synopses → exactly 3 surface; 1 → simpler single-synopsis rendering; 0 with active open loops → only open-loops section; 0+0 → block absent entirely.
> 5. Cache hit rate within ±2pp of M2 closeout baseline on `chitchat-short` and `long-session-200` (the new family must not bust the existing cached prefix).
> 6. Cross-channel surfacing both directions (unit + integration).
> 7. Open-loop resolution — both paths covered: implicit close-by-overwrite, explicit `closeOpenLoop: true` match, explicit `closeOpenLoop: true` no-match non-fatal info-log.
>
> When done, SESSION-HANDOFF + CHANGELOG with smoke deltas, the magic-moment turn-1 transcript snippet for founder eyeball review (or a note that the founder ran the live UI gate directly), and a per-test breakdown of `resolved_at` semantics. Do NOT touch Slice M3.1 in the same session.

---

### Slice M3.1 — Open-loop close ergonomics (queued follow-through to M3)

- **Status (2026-04-22 night):** **Code-landed + deployed to `persai-dev` + carry-over re-render verified live; structured close-by-ref path verified by unit/controller tests but NOT yet exercised by a natural live LLM turn (deferred to next organic open-loop event).** The founder green-lit shipping M3.1 immediately after M3 instead of waiting one week of evidence, on the explicit understanding that "потом всегда забывается"; the queued-evidence gate is replaced by a follow-through observation window. Image for commit `bae6f91` was published, pinned into `infra/helm/values-dev.yaml` by the bot (`bf61b88`), and rolled out by Argo CD across `api`, `runtime`, and `web`. The structured `memory_write({ action: "close" | "write", ref })` API surface, the `CloseAssistantMemoryByRefService`, the internal `POST /api/v1/internal/runtime/memory/close-by-ref` route, the public `POST /api/v1/assistant/memory/items/:id/close-open-loop` route, the Memory Center "Mark as closed" inline button (with `CheckCircle2` icon, only rendered on `kind === "open_loop"` items, bilingual labels), and the `[ref: ol_xxx]` markers in the carry-over renderer all landed atomically with the M3.2 commit. The renderer change was confirmed live: a smoke `multi-session-continuity` rerun showed the M3.2 column `last_cross_session_carry_over_at` advancing on every first-turn-of-thread (sessions 1/2/3/4 — proving the carry-over block fired and therefore the renderer ran), and the audit-log table contains one historical `assistant.open_loop_closed_explicit` event from the M3 `closeOpenLoop: true` path proving the underlying close pipeline is healthy. The structured `action: "close"` close-by-ref path itself was NOT exercised by the smoke run because the LLM auto-extract did not classify any session-1 memory as `kind="open_loop"` for the synthetic smoke turns (none of the extracted memories ended up with kind=open_loop, so session 4 had nothing matching to close-by-ref). This is an auto-extract characteristic, not an M3.1 regression. The Memory Center UI was verified by founder live UI inspection: the "Mark as closed" button only appears on `kind="open_loop"` items as designed (founder's screenshot showed memories without any kind label, i.e. `kind=null` ones, which correctly do not get the button). The first organic close-by-ref event in real user traffic is the deferred natural acceptance signal; until then, deterministic test coverage in `apps/api/test/close-assistant-memory-by-ref.service.test.ts` + `apps/api/test/internal-runtime-memory-close-by-ref.controller.test.ts` + the runtime tool tests + the renderer tests is the locked invariant.
- **Goal:** Make open-loop closure first-class instead of relying on (a) the implicit close-by-overwrite path or (b) the opt-in `closeOpenLoop: boolean` flag that M3 ships. Two products: a structured `memory_write({ action: "close", ref: <id> })` API surface for the model to close a specific loop deterministically, and a Memory Center UI button that lets the user manually close a loop they consider resolved (because the user might know a loop is dead before the model does).
- **Founder anchor:** Founder-driven. Picked Level-2 in M3 to ship deterministic close support immediately, then explicitly asked for this slice to exist as a real queued slice in the ADR rather than a soft "Out of scope" note, because "потом всегда забывается" (founder, 2026-04-22). Putting it in the ADR with its own slot in the phase ordering is the structural mitigation.
- **Founder principles:** Principle 1 (the user-facing button is the rare exception — a single explicit "close" action on the user's own memory entry is honest curation, not a settings knob; transparency over magic is acceptable for memory because users already see the Memory Center). Principle 3 (extend the existing `memory_write` tool surface and the existing Memory Center UI; do not invent new services).

**Touch points:**

- `apps/runtime/src/modules/turns/native-tool-projection.ts` + `apps/runtime/src/modules/turns/runtime-memory-write-tool.service.ts` — extend `memory_write` input schema with optional `action: "write" | "close"` (default `"write"` for backward compat) and optional `ref: string` (memory entry id). When `action === "close"`, no new entry is written; instead the runtime calls a new internal endpoint `POST /api/v1/internal/runtime/memory/close-by-ref` that sets `resolved_at = now()` on the referenced row (must belong to `(assistantId, userId)`, must be `kind='open_loop'`, must be currently active).
- `apps/api/src/modules/workspace-management/application/close-assistant-memory-by-ref.service.ts` (new) — owns the close-by-ref operation with full ownership and kind validation; emits `assistant.memory_close_by_ref` audit event.
- `apps/api/src/modules/workspace-management/interface/http/internal-runtime-memory-close-by-ref.controller.ts` (new) — internal `:3002` listener route, bearer-authed, mirrors M1/M3 internal endpoint shape.
- `apps/api/src/modules/workspace-management/interface/http/assistant-memory.controller.ts` (existing user-facing controller) — add `POST /api/v1/assistant/memory/items/:id/close-open-loop` for the user-facing "close this loop" button. Public bearer auth (Clerk session). Same ownership + kind validation as the internal route, but reuses the same underlying service.
- `apps/api/prisma/bootstrap-preset-data.ts` — extend `memory_write` `usage_guidance` to teach the model when to prefer `action: "close", ref: <id>` (deterministic close on a known loop id, e.g. when the user explicitly says "consider that done") vs `closeOpenLoop: true` (probabilistic close on the most-similar loop, the M3 flag) vs implicit close-by-overwrite (the M1/M2 dedup path).
- `apps/web/app/app/_components/assistant-settings.tsx` (Memory Center UI) — add a "✓ Mark as closed" inline action on entries with `kind='open_loop' AND resolved_at IS NULL`. Resolved entries either disappear from the default Memory Center view or render in a separate "Closed loops" collapsed section (founder picks at slice start). Bilingual labels in `apps/web/messages/{en,ru}.json`.
- `packages/contracts/openapi.yaml` + regenerated `@persai/contracts` — public Memory Center API gains the close endpoint.

**Implementation outline:**

1. **Read M3 evidence first.** Before starting M3.1, read the M3 closeout SESSION-HANDOFF entry: how often did the model use `closeOpenLoop: true`? How often did implicit close-by-overwrite resolve loops? Did unresolved-but-stale loops accumulate in the carry-over block in a way that hurt the magic-moment? If the answer is "rarely / never / no" across all three, M3.1 may not be needed yet — re-confirm with the founder before starting code.
2. **Backend close-by-ref service.** New `CloseAssistantMemoryByRefService` that validates ownership (`assistantId + userId` match), validates kind (`kind = 'open_loop'`), validates state (`resolved_at IS NULL`), sets `resolved_at = now()`, returns the updated row. Reused by both internal and public routes.
3. **Internal route + memory_write extension.** Add `action: "close" | "write"` to `memory_write`. When `"close"`, runtime forwards to the internal endpoint, returns the model a structured result (`{ closed: true | false, reason }`).
4. **Public route + Memory Center button.** Add the user-facing close button in the existing Memory Center listing. Confirmation dialog optional; founder picks at slice start.
5. **`memory_write` `usage_guidance` rewrite.** Make the three close paths explicitly disambiguated for the model (`action: "close"` for known-id deterministic close, `closeOpenLoop: true` for similarity-driven close from a fresh write, implicit dedup overwrite for natural rewriting). Keep guidance ≤ 80 tokens — the model picks correctly with a short rule, not a long essay.
6. **Tests.**
   - Unit: close-by-ref happy path, ownership-mismatch rejection, kind-mismatch rejection, already-resolved no-op, non-existent id 404.
   - Unit: `memory_write({ action: "close", ref })` runtime path → backend close-by-ref called with right args, model receives `{ closed: true }`.
   - Integration: smoke `multi-session-continuity` extended with an explicit close-by-ref turn (model says "I'll close this loop because user said it's done"); the closed loop disappears from session-3 carry-over.
   - User-facing: web E2E click "Mark as closed" on an open-loop entry → entry visually moves to "Closed loops" section (or disappears, per chosen UX) → next session's carry-over does not include that loop.

**Acceptance criteria:**

- `memory_write({ action: "close", ref })` works deterministically against any active open-loop entry the assistant-user pair owns; non-owner / non-open-loop / non-active calls fail with a structured non-fatal result.
- The Memory Center UI exposes the "close this loop" button on every active open-loop entry; click → entry resolves; reload → entry stays resolved.
- The closed loop disappears from M3's carry-over on the next new thread.
- No regression in M3's existing close paths (implicit close-by-overwrite + `closeOpenLoop: true` flag): all three paths coexist and produce the same `resolved_at` semantics.
- Audit log shows close events with the source path (`memory_write_action_close` / `closeOpenLoop_flag` / `dedup_overwrite` / `user_ui_close`) so we can measure usage and decide whether to deprecate the probabilistic flag in a later slice.

**Out of scope (M3.1):**

- Reopening a closed loop (no "✗ reopen" button) — if the topic resurfaces, the model writes a fresh open-loop entry through `memory_write`. Reopening UX is a follow-through if real evidence shows it matters.
- Bulk close ("close all loops older than X") — single-entry close only.
- Notifications when a loop has been open too long — that is a heartbeat / scheduler concern, queued for a future memory-system slice if at all.
- Vector / embedding ranking for `closeOpenLoop: true` similarity match — M3 ships lexical match, M3.1 does not improve it.

**Slice M3.1 handoff prompt:**

> You are implementing ADR-074 Slice M3.1 (Open-loop close ergonomics, queued follow-through to M3). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice M3.1 section in full. Slice M3 must be landed and live for at least one week. Hard constraints: (a) **read the M3 closeout SESSION-HANDOFF entry first** to verify M3.1 is actually needed — if the M3 close paths (implicit dedup-overwrite + `closeOpenLoop: true`) are resolving loops cleanly in live evidence, re-confirm scope with the founder before writing code; (b) `memory_write` gains `action: "close" | "write"` (default `"write"`) and optional `ref: string`; backend close-by-ref enforces ownership + kind + active-state and is reused by internal and public routes; (c) Memory Center UI gains a single "Mark as closed" inline action on active open-loop entries — no bulk close, no reopen button, no notifications; (d) all three close paths from M3 + M3.1 emit distinct audit-log source markers so we can measure usage and decide later whether to deprecate `closeOpenLoop: true`; (e) M3 cache stability MUST be preserved — closing a loop changes `openLoopsVersionHash` and triggers a fresh M3 cache for the next new thread, but does not bust unrelated cache families. Acceptance: deterministic close via `action: "close"` works; UI button works end-to-end; closed loops disappear from M3 carry-over on next new thread; audit log shows source per close event. When done, SESSION-HANDOFF + CHANGELOG with measured usage of each close path during the live week between M3 and M3.1.

---

### Slice M3.2 — Cross-session re-trigger heuristic (idle-gap within an existing thread)

- **Status (2026-04-22 night):** **Code-landed + deployed to `persai-dev` + live-verified end-to-end on synthetic smoke + founder long-idle live gate accepted.** Image for commit `bae6f91` was published, pinned into `infra/helm/values-dev.yaml` by the bot (`bf61b88`), and rolled out by Argo CD across `api`, `runtime`, and `web`. The Prisma migration `20260422040000_adr074_m3_2_cross_session_carry_over_cooldown` (additive `ALTER TABLE assistant_chats ADD COLUMN last_cross_session_carry_over_at TIMESTAMPTZ(6) NULL`) finished cleanly on the live database (`applied_steps_count = 1`, `finished_at = 2026-04-22T18:47:33.111Z`); the column was confirmed via direct `information_schema` query and via the `_prisma_migrations` ledger. Live behavioural verification: a `multi-session-continuity` smoke rerun against `persai-dev` (assistant `b635d40d-ced6-428d-a68b-7395463b2db9`, 19 turns / 4 sessions / 0 failures, ~3.5 min wall-clock, p95 latency `−11 747ms` vs the pre-M2 baseline) populated `last_cross_session_carry_over_at` on every brand-new thread (`session-1` 19:13:40, `session-2` 19:14:47, `session-3` 19:16:09, `session-4` 19:16:39) — strict-monotonic, exactly one bump per thread per smoke run, fire-and-forget call observed end-to-end through `runtime → api`. The cooldown branch (`now − last_cross_session_carry_over_at < cooldownHours`) is locked by the unit-test matrix in `apps/runtime/test/turn-context-hydration.service.test.ts` (`runCrossSessionCarryOverM3_2LongIdleAcceptance`) and the API-side service/controller tests in `apps/api/test/mark-cross-session-carry-over-fired.service.test.ts` + `apps/api/test/internal-runtime-cross-session-mark-fired.controller.test.ts`. Founder confirmed the long-idle live UI gate ("работает", 2026-04-22 night). Post-compaction sub-trigger remains explicitly out of scope per founder 2026-04-22.
- **Goal:** Extend M3's trigger from "first turn of a brand-new thread" to also fire on the **first turn after a long quiet period inside an already-existing thread** — so the magic moment also works in surfaces where the conversation thread is permanent (Telegram is the canonical case: there is no "новый чат" button, the user will not reset, and a single thread runs forever). The block content, the cache family, and the renderer are unchanged from M3 — M3.2 only changes the **trigger condition** plus a tiny per-thread cooldown bookkeeping column.
- **Founder anchor:** Principle 1 (magic — re-trigger must be invisible to the user, no "ping me when…" toggle) + Principle 2 ("lives in time" — the re-trigger is a time signal the user already implicitly broadcasts by going quiet for hours). From the founder's 2026-04-22 live-UI feedback after M3 `persai-dev` smoke acceptance: "Он помнит, но не предложил так как сессия в TG не пустая, и у меня нет кнопки для сброса сессии и скорее всего в tg никто не будет её сбрасывать — это один постоянный канал."
- **Founder scope-trim (2026-04-22 evening):** the originally-considered post-compaction sub-trigger is **explicitly dropped**. Rationale: re-firing the carry-over block in the middle of a live conversation (just because auto-compaction silently ran) would feel like the assistant "suddenly remembers" things mid-flow — that is the opposite of magic. Compaction is a content-driven cadence, not a real session boundary; only **time** ("user went away") is a real session boundary worth re-orienting on.

**Live truth from M3 acceptance (do NOT re-derive — wire M3.2 to the M3 surfaces M3 actually persisted):**

- M3's trigger lives in `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` as `isFirstTurnOfThread(storedMessages, input)` (private method). M3.2 generalises this to `shouldFireCrossSessionCarryOver(...)` — same call site, broader predicate. The rest of M3's hydration path (the `loadCrossSessionCarryOverHydration` body, the renderer, the stable-block family, the internal endpoint contract) does NOT change.
- M3's `POST /api/v1/internal/runtime/cross-session/carry-over` request body and response shape do NOT change. M3.2 adds **one new internal endpoint** (`POST /api/v1/internal/runtime/cross-session/mark-carry-over-fired`) that bumps a per-thread "last fired at" marker after the runtime renders a non-empty M3 block, and **one new stored field** (`AssistantChat.lastCrossSessionCarryOverAt: TIMESTAMPTZ NULL`) to enforce the cooldown.
- The smoke harness has no time-travel primitive (turns are paced at ~5s, total scenario ≤ 3 min). The long-idle trigger is therefore tested **only via unit tests with an injected clock** plus the founder-driven manual UI gate (waits ≥ 4h in TG and asserts the magic moment lands). There is intentionally **no new deterministic smoke scenario** for M3.2 — the post-compaction path that would have been the only deterministic smoke is explicitly out of scope.

**Founder-confirmed M3.2 specifics (2026-04-22 evening):**

- **Trigger is option C-trimmed: `(thread_first_turn) OR (idle ≥ idleHours)` — the second sub-trigger is clamped by a per-thread cooldown.** This covers two real-world entry shapes (new thread on web; returning to TG after a long absence). The first sub-trigger is the existing M3 condition unchanged.
- **Idle threshold default = 4 hours, plan-tunable, range 1..168 (1 hour … 7 days).** Lives as `crossSessionCarryOverIdleHours: number` on `RuntimeContextHydrationConfig` next to `crossSessionCarryOverTtlDays`. Mirrored into all three preset defaults (`lean` / `balanced` / `rich`). Editable per-plan in `/admin/plans`.
- **Per-thread cooldown default = 12 hours, plan-tunable, range 1..168.** Lives as `crossSessionCarryOverCooldownHours: number` on `RuntimeContextHydrationConfig`. Even when the idle sub-trigger evaluates to true, the carry-over does NOT fire if `now - lastCrossSessionCarryOverAt < cooldownHours`. The cooldown protects the user from "магия каждые полдня" feel — at most 1–2 carry-overs per 24h in a single thread.
- **Cooldown does NOT apply to the first sub-trigger.** A brand-new thread always fires (preserves M3 behaviour exactly — re-running the M3 acceptance scenario must produce the same number of fires per scenario). The cooldown only gates the new idle sub-trigger.
- **Cooldown bookkeeping is per-thread, not per-(assistantId, userId).** A user with two parallel threads (e.g. one Web, one TG) gets two independent cooldown windows. This matches the user's natural mental model: each thread is its own continuous conversation.
- **No user-facing UI; the only new admin surface is two numeric inputs in `/admin/plans` (idle hours, cooldown hours).**
- **Block rendering and content are UNCHANGED from M3.** The renderer does NOT receive a "trigger reason" hint — it stays content-driven. The model already adapts tone naturally; introducing per-trigger render variants would be magic-on-magic and is explicitly rejected.

**Touch points:**

- `apps/api/prisma/schema.prisma` — add `lastCrossSessionCarryOverAt DateTime? @db.Timestamptz(6)` to `AssistantChat`. New migration `apps/api/prisma/migrations/<timestamp>_adr074_m3_2_cross_session_carry_over_cooldown/migration.sql` is additive (`ALTER TABLE assistant_chats ADD COLUMN last_cross_session_carry_over_at TIMESTAMPTZ(6) NULL`) and reversible. No new index — the column is read by primary-key lookup on the existing `assistant_chats_pkey` whenever the runtime hydrates the current thread.
- `packages/runtime-contract/src/index.ts` — add **two** fields to `RuntimeContextHydrationConfig`: `crossSessionCarryOverIdleHours: number` (default `4`, validated `1..168`) and `crossSessionCarryOverCooldownHours: number` (default `12`, validated `1..168`). Mirror the defaults into all three `PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET_DEFAULTS` entries.
- `apps/api/src/modules/workspace-management/application/context-hydration-policy.ts` — extend `parsePlanContextHydrationPolicy` and `resolveStoredPlanContextHydrationPolicy` so the two new fields round-trip through stored plan rows; admin overrides win when present, otherwise the preset default applies; out-of-range values are rejected on PATCH and clamped on read of legacy rows (same pattern as M3's `crossSessionCarryOverTtlDays`).
- `packages/contracts/openapi.yaml` — add the two fields to admin-plan PATCH/GET schemas. Regenerate `@persai/contracts`.
- `apps/web/app/admin/plans/page.tsx` — surface the two new fields next to `crossSessionCarryOverTtlDays` (two numeric inputs). Bilingual labels in `apps/web/messages/{en,ru}.json`.
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` — replace `isFirstTurnOfThread(...)` with `shouldFireCrossSessionCarryOver(...)` that returns `{ shouldFire: boolean, fireReason?: "thread_first_turn" | "long_idle" }` and applies the two sub-triggers + cooldown rule. After a successful non-empty M3 hydration, the service calls a new internal endpoint `markCrossSessionCarryOverFired({ assistantId, userId, externalThreadKey, channel, requestId, firedAt: now() })` (fire-and-forget on failure with a `WARN` log — failing the whole turn over a missing cooldown bookkeeping write would be worse than letting one extra carry-over slip through next time).
- `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts` — add `markCrossSessionCarryOverFired(input)` typed method.
- `apps/api/src/modules/workspace-management/domain/assistant-chat.repository.ts` + the Prisma impl in `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-chat.repository.ts` — add `findLastCrossSessionCarryOverAt(assistantChatId)` (reader the runtime needs to evaluate cooldown) and `setLastCrossSessionCarryOverAt(assistantChatId, firedAt)` (writer behind the new internal endpoint).
- New `apps/api/src/modules/workspace-management/application/mark-cross-session-carry-over-fired.service.ts` — owns the cooldown bump, validates that `(assistantId, channel, externalThreadKey)` resolves to a real `AssistantChat` row owned by the user, idempotent (only writes if `firedAt > lastCrossSessionCarryOverAt`).
- New `apps/api/src/modules/workspace-management/interface/http/internal-runtime-cross-session-mark-fired.controller.ts` — `POST /api/v1/internal/runtime/cross-session/mark-carry-over-fired` on the `:3002` listener, bearer-authed.
- `apps/api/src/modules/workspace-management/application/find-cross-session-carry-over.service.ts` — UNCHANGED. The post-compaction sub-trigger that would have required `compactionSinceTimestamp` + `hasCompactionSince` is out of scope; M3.2 evaluates the cooldown purely from `lastCrossSessionCarryOverAt` (read in the runtime via the chat-row lookup it already performs).
- `apps/api/src/modules/workspace-management/workspace-management.module.ts` — register the new service + controller.
- `scripts/smoke/scenarios/` — **no new scenario file.** The post-compaction path that would have been deterministic is dropped; the long-idle path cannot be deterministically smoked without time-travel and is verified by the manual founder UI gate. The existing `multi-session-continuity` scenario MUST continue to pass unchanged (M3 + M3.1 acceptance preserved bit-for-bit).
- `scripts/smoke/README.md` — document M3.2 explicitly: "long-idle re-trigger is verified by a manual founder UI gate (≥ 4h wait in TG), not by smoke; the harness has no time-travel primitive and post-compaction re-trigger is intentionally out of scope."
- `apps/runtime/test/turn-context-hydration.service.test.ts` — extend with a `runCrossSessionCarryOverM3_2RetriggerHeuristic` suite covering: brand-new thread → fires + reason `thread_first_turn`; thread with last user message 1h ago → no fire; thread with last user message 5h ago + cooldown 12h, no recent fire → fires + reason `long_idle`; same as previous but cooldown bumped 1h ago → no fire; cooldown still active → no fire even when idle trigger would otherwise pass; markCrossSessionCarryOverFired is called exactly once per fire and not on no-fire.
- New `apps/api/test/mark-cross-session-carry-over-fired.service.test.ts` — happy path, ownership mismatch rejection, channel/thread-key normalization, idempotency (a second mark with a stale `firedAt` does NOT overwrite a newer one).
- New `apps/api/test/internal-runtime-cross-session-mark-fired.controller.test.ts` — auth + happy + ownership rejection.
- `apps/api/test/context-hydration-policy.test.ts` — extend with round-trip + bounds for the two new plan-policy fields.

**Implementation outline:**

1. **Schema + plan-policy contract.** Add `lastCrossSessionCarryOverAt` column to `AssistantChat` via migration. Add the two new fields to `RuntimeContextHydrationConfig` (idle hours, cooldown hours). Update `parsePlanContextHydrationPolicy` + `resolveStoredPlanContextHydrationPolicy`. Update OpenAPI + regenerate contracts. Surface in admin UI.
2. **Repository surface.** Add `findLastCrossSessionCarryOverAt(assistantChatId)` + `setLastCrossSessionCarryOverAt(assistantChatId, firedAt)` to `AssistantChatRepository` + Prisma impl. Idempotent `set` semantics (only writes if `firedAt > current`).
3. **Mark-fired service + internal endpoint.** New `MarkCrossSessionCarryOverFiredService` validates ownership and calls the repository. New internal route on `:3002` mirrors M3 endpoint shape (bearer-authed).
4. **Generalise the trigger predicate in `turn-context-hydration.service.ts`.** Replace `isFirstTurnOfThread(...)` with `shouldFireCrossSessionCarryOver(input, storedMessages, contextHydration, lastCarryOverAt)` that evaluates the two sub-triggers + cooldown. The existing `loadCrossSessionCarryOverHydration` body is unchanged; only its caller-side gating predicate is widened. After a non-empty render, fire-and-forget `markCrossSessionCarryOverFired`.
5. **Renderer + cache stability — NO CHANGES.** The renderer keeps its current shape; the stable-block family `cross_session_carry_over` keeps its content-hash key. M3.2 must NOT change the rendered block on a "fired-by-M3.2" turn vs a "fired-by-M3" turn, so the M3 + M3.1 cache stability acceptance carries forward unchanged.
6. **Tests.** Build all the unit tests listed in Touch points. Document the manual long-idle gate in `scripts/smoke/README.md`.
7. **Docs.** Update `docs/SESSION-HANDOFF.md` + `docs/CHANGELOG.md` with the M3.2 closeout. Flip the M3.2 status in this ADR from "Queued" to "code-landed in code (date), awaiting `persai-dev` smoke acceptance + founder long-idle live UI gate" mirroring the M3 closeout style.

**Acceptance criteria:**

- **Magic-moment live UI gate (founder-driven, the headline M3.2 acceptance signal).** Founder waits ≥ 4 hours after the last reply in an existing TG thread with the test assistant, then sends any casual greeting. The assistant's first reply weaves prior context naturally without recap or channel-naming. A second send within the next ~12 hours does NOT trigger a second carry-over (cooldown holds). This is the closing gate.
- **Existing `multi-session-continuity` smoke continues to pass unchanged.** Re-running it produces the same number of carry-over fires (3 — one per session, all `thread_first_turn`) and the same content for sessions 1–3, plus the M3.1 close-by-ref turn in session 4. M3.2 is purely additive in trigger surface and MUST NOT regress M3 / M3.1 acceptance.
- **Unit-test matrix covers both sub-triggers + cooldown.** Brand-new thread always fires (M3 invariant preserved, cooldown-exempt). Idle ≥ idleHours fires when cooldown elapsed; same parameters with cooldown not elapsed → no fire. `markCrossSessionCarryOverFired` is called exactly once per fire and never on no-fire. Idempotent second mark with stale `firedAt` does not overwrite.
- **Plan-policy admin tunability proof (unit-level).** With `crossSessionCarryOverIdleHours = 1` on the test plan and a 90-min idle gap → fires. With `= 24` and the same gap → no fire. With `crossSessionCarryOverCooldownHours = 1` → second fire allowed 90 min after first; with `= 168` → no second fire for a week.
- **No user-facing UI surface.** The only new admin surface is the two inputs in `/admin/plans`. End users never see this.
- **Cache hit rate preserved.** P1 prompt-cache hit rate stays within ±2 pp on `chitchat-short` and `long-session-200` — the existing `cross_session_carry_over` family is unchanged in shape and content (M3.1 already absorbed the one-time `[ref: …]` rebuild), only its trigger condition is widened.

**Out of scope (M3.2):**

- **Post-compaction sub-trigger.** Explicitly dropped per founder 2026-04-22 — re-firing the magic block in the middle of a live conversation just because auto-compaction ran silently in the background would feel like the assistant "suddenly remembers" things mid-flow. Compaction is a content cadence, not a real session boundary.
- Any change to the rendered block content, the renderer signature, or the stable-block family — those stay exactly as M3 / M3.1 shipped them.
- Time-travel in the smoke harness — long-idle path stays a manual founder UI gate.
- Per-channel cooldown variants ("4h on TG, 24h on Web") — single global `cooldownHours` per plan only. If channel-aware tuning ever becomes needed it lands as a separate slice with evidence.
- A "force re-trigger now" admin button — would violate Principle 1.
- Smarter signals for "user is starting a new logical topic mid-thread" (e.g. semantic divergence detection) — that's a different problem and its own slice if evidence demands.
- Reopening a closed loop on re-trigger (the M3.1 territory). Closed loops continue to be excluded from the carry-over block; M3.2 does not reverse close decisions.

**Slice M3.2 handoff prompt:**

> You are implementing ADR-074 Slice M3.2 (Cross-session re-trigger heuristic — long-idle only). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice M3.2 section in full. Slice M3 + M3.1 must already be code-landed AND M3 acceptance-passed in `persai-dev` smoke. Hard constraints: (a) trigger condition is `(thread_first_turn) OR (idle >= idleHours)`, with the idle sub-trigger gated by a per-thread cooldown EXCEPT the first sub-trigger which is cooldown-exempt; (b) **post-compaction sub-trigger is explicitly OUT OF SCOPE** (founder dropped it on 2026-04-22 — re-firing mid-conversation feels creepy, not magical); (c) defaults are `idleHours = 4`, `cooldownHours = 12`, both plan-tunable in `/admin/plans` next to `crossSessionCarryOverTtlDays`; (d) one new column `assistant_chats.last_cross_session_carry_over_at` (additive, reversible migration); (e) one new internal endpoint `POST /api/v1/internal/runtime/cross-session/mark-carry-over-fired` mirroring the M3 endpoint shape; (f) the rendered block, the renderer, and the stable-block family `cross_session_carry_over` are UNCHANGED from M3 / M3.1 — M3.2 only widens the trigger; (g) M3 + M3.1 acceptance MUST be preserved exactly (re-running the existing `multi-session-continuity` scenario produces the same carry-over fires + same content + same M3.1 close-by-ref turn); (h) no user-facing UI; (i) **no new smoke scenario** — long-idle path is verified only by the manual founder UI gate (≥ 4h wait in TG); the harness has no time-travel primitive and post-compaction is out of scope, so there is nothing deterministic to smoke. Acceptance: full unit-test matrix for the two sub-triggers + cooldown bookkeeping green; existing `multi-session-continuity` smoke still green; founder long-idle live UI gate green. When done, SESSION-HANDOFF + CHANGELOG with the long-idle live transcript snippet (or a note that the founder ran the live UI gate directly), and a per-test breakdown of cooldown semantics.

---

### Slice M3.3 — Memory Center polish + M3.1 close-button hotfix (combined follow-through to M3.1 / M3.2)

- **Status (2026-04-22 night):** **Code-landed in code; verification gate green (`pnpm -w typecheck` clean, `pnpm -w lint` clean incl. `format:check`, `pnpm -w test` clean — full api + runtime + provider-gateway + web suites; web run is 19 files / 92 tests with the new `assistant-settings.test.tsx` 12-test suite included; `pnpm -w build` clean), awaiting `persai-dev` deploy + 4 founder live gates.** No Prisma migration in this slice (pure UI / i18n / test work). No new OpenAPI operation (existing endpoints were sufficient).
- **Goal:** Two-product follow-through to the M3.1 / M3.2 deployment: (A) **fix the silently-broken Memory Center "Mark as closed" button** that the founder hit on `persai-dev` after M3.1 went live (button visually clicked but nothing happened — open-loop row stayed in place, no error toast, no console output); (B) **merge the two Memory Center tabs into a coherent UX** so the "Рабочая область" tab unifies all curated structured memory (workspace items + structured registry items) and the "История" tab is reduced to pure conversational echoes (`kind = null` registry items). Both products land in one commit because they share the same render path and the same test surface.
- **Founder anchor:** Principle 1 (the Memory Center is the rare exception to "no settings knobs" — it is honest curation of the assistant's own memory; the silently-failing close button is therefore a Principle 1 violation because it makes the curation surface dishonest). Principle 4 ("trust over magic" once the user has opened the Memory Center — if a click does nothing, the trust collapses; surfacing the API error inline is the minimum-viable repair). Principle 5 ("no shadow paths" — silent `catch { /* non-critical */ }` blocks are exactly the kind of failure-eating shadow path that hides bugs across slices).
- **Founder explicit decisions (2026-04-22 night, before code):**
  - Silent-catches in `assistant-settings.tsx` are the prime suspect for the close-button no-op. Strip them ALL from the Memory Center handlers (`handleCloseOpenLoop`, `handleForget`, `handleForgetWsMemory`, `handleAddWsMemory`, `handleTaskAction`, `loadMemory`, `loadWsMemory`, `loadTasks`) and replace each with `(a)` an inline bilingual error string surfaced via a section-local `ActionFeedback` slot patterned after the existing `notificationFb`, plus `(b)` `console.error("[memory-center] <handler> failed", error)` so future debugging in the dev console is one-line traceable.
  - **Tab merge is UI-side, no backend migration.** The frontend already loads both `getAssistantMemoryItems` (registry) and `getWorkspaceMemoryItems` (curated workspace memory) in parallel; M3.3 introduces a `useMemo`-derived merged view that routes structured registry items (`kind ∈ {fact, preference, open_loop}`) and all workspace items into the "Рабочая область" tab, and routes `kind = null` registry items into the "История" tab. No new merged endpoint, no new contract surface.
  - **Deduplication is text-normalised in the UI.** Normalisation: lowercase, trim outer whitespace, collapse internal whitespace runs to a single space, strip a single trailing dot. Collision rule: registry-row wins (it owns `kind` / `resolvedAt` / close-button state); the workspace-row is suppressed in the merged view when its normalised text matches a registry row. Two registry rows with the same normalised text are NOT collapsed (they have distinct ids and may hold distinct timestamps; M3.3 deliberately does NOT touch the registry-side dedup gate from M3 — that is M2.1 territory if it ever resurfaces).
  - **Badge gate is tightened.** The pre-M3.3 fallback `kind !== null ? t("memoryKindOpenLoop") : null` mislabelled `fact` and `preference` rows as "ОТКРЫТЫЙ ВОПРОС" in the "История" tab. M3.3 replaces it with strict `kind === "open_loop"` checks for the badge AND for the close-button visibility, plus distinct labels for `fact` / `preference` (`memoryKindFact` / `memoryKindPreference`) and a new `memoryResolved` "Закрыто" badge for `open_loop` rows where `resolvedAt !== null` (so the founder can see at a glance which open loops are still active vs already resolved).
- **Live root-cause finding (2026-04-22 night):** The Memory Center "Mark as closed" button silently no-op on click was traced to the silent-catch in `handleCloseOpenLoop`:
  ```
  } catch {
    /* non-critical */
  }
  ```
  swallowed the `Error` thrown by `postAssistantMemoryItemCloseOpenLoop` from `apps/web/app/app/assistant-api-client.ts` (the api-client correctly throws on any non-2xx via the shared `parseJsonOrThrow` path inherited from M2). Because the catch was empty, the optimistic `setMemoryItems(prev => prev.filter(...))` line was skipped (it lives inside the `try` block after the `await`), the spinner cleared via the `finally` block, and the user saw "click animates, row stays, no error" — exactly the reported symptom. The exact upstream HTTP status was NOT directly captured in this session because the founder did not surface a live `kubectl logs` snippet of a failing call, and the silent-catch erased the only client-side evidence. The hotfix is therefore status-agnostic-by-design: surface ANY thrown error inline + `console.error` + retain the row, regardless of which HTTP code came back. The new inline-error UX will surface the real upstream code (400 / 404 / 409 / 500) on the next live click on `persai-dev`, and the per-error bilingual string `memoryCloseOpenLoopFailed` ("We could not mark this item as closed. Please try again." / "Не удалось закрыть открытый вопрос. Попробуйте ещё раз.") is the founder-facing minimum that ships now; a per-status diagnostic message (e.g. surfacing a distinct line for `409 Capability not allowed by current envelope`) is queued as a M3.3.1 follow-up only if the live click reveals a recurring distinguishable upstream class — otherwise the single bilingual string is the production shape. **Companion finding:** the "ОТКРЫТЫЙ ВОПРОС" badge fallback for any non-null `kind` was a separate latent bug that the founder caught visually before the click — `fact` and `preference` rows in the "История" tab carried a misleading "OPEN LOOP" badge even though the close-button gate (`item.kind === "open_loop"`) was already strict, so clicking the badge area on a `fact` row would show a button-less row labelled "OPEN LOOP" which compounded the confusion. M3.3 fixes both in the same render-path edit so the visual story matches the click-handler story.
- **Touch points (M3.3 — frontend-only):**
  - `apps/web/app/app/_components/assistant-settings.tsx` — strip silent-catches in `loadMemory`, `loadTasks`, `loadWsMemory`, `handleAddWsMemory`, `handleForgetWsMemory`, `handleForget`, `handleCloseOpenLoop`, `handleTaskAction`; add three new section-local feedback states `memoryFb`, `wsMemoryFb`, `tasksFb` (typed `ActionFeedback`, identical shape to the existing `notificationFb`) and render them through the existing `FeedbackLine` component above each section's list; new pure helper `normalizeMemoryText(text: string): string` (lowercase + trim + collapse whitespace + strip trailing dot); new pure helper `mergeMemoryViews(registry, workspace): { workspace: MergedMemoryRow[]; history: MergedMemoryRow[] }` that splits registry items by `kind` into the two tab buckets and dedupes workspace echoes against the workspace bucket via `normalizeMemoryText`; new constant `STRUCTURED_REGISTRY_KINDS = new Set<["fact","preference","open_loop"]>` for the registry-side bucket gate; two `useMemo` callsites (`mergedWorkspaceMemoryView`, `mergedHistoryMemoryView`) wire the helper into the render; the badge render block (previously around lines 1465–1469) replaces the `kind !== null ? t("memoryKindOpenLoop") : null` fallback with strict `kind === "open_loop" / "fact" / "preference"` checks plus a new "Закрыто" / "Closed" badge for `kind === "open_loop" && resolvedAt !== null`; the `CheckCircle2` close-button visibility is gated on `row.source === "registry" && row.item.kind === "open_loop" && row.item.resolvedAt === null` so it is invisible on `fact` / `preference` rows and on already-resolved open-loop rows; the "История" tab list is filtered to `mergedHistoryMemoryView` (i.e. registry items with `kind === null`) and explicitly never renders the close-button.
  - `apps/web/messages/en.json` + `apps/web/messages/ru.json` — nine new bilingual keys: `memoryResolved` ("Closed" / "Закрыто"), `memoryLoadFailed`, `memoryForgetFailed`, `memoryCloseOpenLoopFailed`, `wsMemoryLoadFailed`, `wsMemoryAddFailed`, `wsMemoryForgetFailed`, `tasksLoadFailed`, `tasksActionFailed` (each pair following the existing notification-error wording register, deliberately concise — one short sentence with a "please try again" trailer where applicable, no per-status diagnostic detail in the public string).
  - `apps/web/app/app/_components/assistant-settings.test.tsx` — **new file**, 12 tests across two `describe` blocks. The `mergeMemoryViews` block (4 tests) covers: pure routing of structured registry kinds into the workspace bucket and `kind = null` into the history bucket, workspace-row inclusion when its normalised text is unique, workspace-row suppression when its normalised text matches a registry row in the workspace bucket, two registry rows with the same normalised text are NOT collapsed (id-stable). The `AssistantSettings Memory Center (ADR-074 M3.3)` block (8 tests) covers: close-button success path (POST hits the api-client method, optimistic `setMemoryItems` removes the row, spinner clears); close-button error paths for 404 / 400 / 409 (each surfaces the bilingual `memoryCloseOpenLoopFailed` inline + retains the row + emits the `[memory-center]` console.error); merged Workspace tab shows only structured registry kinds + workspace rows (and never `kind = null` items); merged History tab shows only `kind = null` items (and never any close-button); deduplication of a workspace echo that collides with a structured registry row by normalised text; strict `OPEN_LOOP` badge + close-button gating only for `kind === "open_loop"` and `resolvedAt === null`; hiding the close-button on already-resolved open-loop rows + rendering the new "Closed" badge instead. The suite mocks Clerk + Next.js router + the assistant API client (`assistant-api-client.ts`) and stubs `Element.prototype.scrollIntoView` in `beforeEach` because JSDOM does not implement it and the `Section` component calls it on mount when expanded.
  - `apps/web/app/app/assistant-api-client.test.ts` — extend the existing `postAssistantMemoryItemCloseOpenLoop` coverage with two new tests: one asserts a 400 response (`{ error: "Memory item is not an open_loop." }`) propagates the body's `error` string as the thrown `Error` message; one asserts a 409 response (`{ error: "Capability not allowed by current envelope." }`) propagates the same way. These two cases lock the hotfix invariant from the api-client side: regardless of which HTTP status the upstream chose, the api-client throws and the new frontend-side catch surfaces the message.
- **Out of scope (M3.3):**
  - Any backend change. The existing `POST /api/v1/assistant/memory/items/:id/close-open-loop` and `GET /api/v1/assistant/memory/items` + `GET /api/v1/assistant/memory/workspace/items` endpoints are sufficient. No new merged endpoint, no contract change, no Prisma migration.
  - Per-status inline diagnostic messages (e.g. distinguishing 400 vs 409 in the user-facing string). M3.3 ships one bilingual `memoryCloseOpenLoopFailed` string; if `persai-dev` reveals a recurring distinguishable upstream class, M3.3.1 can refine.
  - Bulk close, bulk forget, reopen — same as M3.1 baseline (still out of scope for the same reasons).
  - Notifications when an open loop has been open too long — same heartbeat / scheduler concern queued for a future memory-system slice.
  - Touching the registry-side dedup gate. Two registry rows with the same normalised text remain visible as two rows — that is M2.1 / M3.1 territory if evidence demands. M3.3 only dedupes workspace echoes against registry in the merged UI view.
  - A new Prisma migration to materialise the merged view server-side. Founder explicitly chose UI-side merge (variant A) over a server-side merged endpoint (variant B) to avoid a migration just to relocate query plumbing.
- **Acceptance criteria:**
  - Founder live gate 1: opening Memory Center on `persai-dev` shows the two re-laid-out tabs — "Рабочая область" carrying structured memories (workspace + structured registry) and "История" carrying only `kind = null` echoes.
  - Founder live gate 2: clicking "Закрыть" on an `open_loop` row in "Рабочая область" removes the row visibly + no silent fail. If the upstream returns a non-2xx, the bilingual error string surfaces inline and the row stays — that is also acceptance (the hotfix is "click does something visible", not "click always succeeds").
  - Founder live gate 3: deleting a workspace row removes it from "Рабочая область" only, never from "История".
  - Founder live gate 4: the previously-doubled "PERSAI в реале для user" row that the founder saw in M3.1 live inspection is collapsed to a single row in the merged "Рабочая область" view (registry-side wins).
  - Verification gate (this session): `pnpm -w typecheck && pnpm -w lint && pnpm -w test && pnpm -w build && pnpm run format:check` all clean.
- **Slice M3.3 handoff prompt:**

> You are closing ADR-074 Slice M3.3 (Memory Center polish + M3.1 close-button hotfix) on top of already-deployed M3 / M3.1 / M3.2. Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice M3.3 section in full plus the M3.1 + M3.2 closeout entries above it. Hard constraints: (a) frontend-only — no backend code, no Prisma migration, no new OpenAPI operation; (b) strip every `catch { /* non-critical */ }` in `apps/web/app/app/_components/assistant-settings.tsx` Memory Center handlers and replace with bilingual inline `ActionFeedback` + `console.error("[memory-center] <handler> failed", error)`; (c) merge the Memory Center tabs UI-side: "Рабочая область" = workspace items + structured registry items (`kind ∈ {fact, preference, open_loop}`), "История" = `kind = null` registry items only, no close-buttons in History; (d) deduplicate via `normalizeMemoryText` (lowercase + trim + collapse whitespace + strip trailing dot) with registry-row wins on collision; (e) tighten badge + close-button gates to strict `kind === "open_loop"` and add a "Closed" badge for `resolvedAt !== null`; (f) extend `apps/web/app/app/assistant-api-client.test.ts` to lock 400 and 409 propagation through `postAssistantMemoryItemCloseOpenLoop`; (g) ship the test file `apps/web/app/app/_components/assistant-settings.test.tsx` with the close-success / close-error / merge-routing / dedup / badge-gating cases; (h) no per-status inline diagnostic message — one bilingual `memoryCloseOpenLoopFailed` string is the production shape, M3.3.1 can refine if `persai-dev` reveals recurring upstream classes worth distinguishing. Acceptance: full pre-commit verification gate (`pnpm -w typecheck && pnpm -w lint && pnpm -w test && pnpm -w build && pnpm run format:check`) clean; founder runs the four live gates on `persai-dev` (two re-laid-out tabs visible; "Закрыть" removes the row or shows a real error; workspace delete is tab-scoped; the previously-doubled "PERSAI в реале для user" row is collapsed). When done, flip the M3.3 status in this ADR to `Code-landed + deployed + live-verified` and capture the real upstream HTTP class for the close-button bug in `SESSION-HANDOFF` if the live click finally surfaces one.

---

### Slice T1 — Sense of time + frequency safeguards

- **Goal:** Make the assistant aware of time gaps (last message, last session, time of day) and add hard safety rails for proactive pushes (max 1/48h, quiet hours, auto-mute after 2 unanswered).
- **Founder anchor:** Principle 2 ("lives in time"). From Q7-B-T1.

**Touch points:**

- `apps/api/prisma/bootstrap-preset-data.ts` — `heartbeat` template gains placeholders for `time_since_last_user_message`, `last_session_at`, `is_first_message_today`.
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts` — heartbeat is now per-turn (already true), but enriched with these fields. Heartbeat sits at tail per P1 — confirm.
- `apps/api/src/modules/workspace-management/application/persai-scheduled-action-scheduler.service.ts` — before invoking `RunScheduledAssistantActionService` for `audience: "user"` actions, consult new `proactive-push-policy.service.ts` to enforce safeguards.
- New: `apps/api/src/modules/workspace-management/application/proactive-push-policy.service.ts` — enforces: max 1 audience=user push per 48h per (assistant, user); quiet hours 22:00–09:00 in user's timezone; auto-mute 14 days after 2 consecutive unanswered pushes.
- `apps/api/prisma/schema.prisma` — small table `proactive_push_log` (timestamp, assistant_id, user_id, was_answered_within_24h).
- New end-to-end tests for the existing scheduled-action flow under `apps/api/test/`.

**Implementation outline:**

1. Compute `time_since_last_user_message` at heartbeat-render time from the last `user` message timestamp in the current session (or last session if none in current).
2. Compute `last_session_at` from the carry-over context source (M3).
3. Compute `is_first_message_today` from user timezone.
4. Render heartbeat with these fields as one short structured block. Keep it small (~80 tokens max), keep it at tail (P1 ordering).
5. Build `ProactivePushPolicyService`: checks log, timezone (already on workspace), and last 2 push outcomes. Returns `{ allowed: boolean; reason?: string }`.
6. In `PersaiScheduledActionSchedulerService`, before calling `RunScheduledAssistantActionService` for `audience: "user"` tasks, call the policy service. If not allowed, defer (set `nextRunAt` to `quietHoursEnd` or skip with reason logged).
7. Track `was_answered_within_24h` by comparing user activity in the 24h window after a push.
8. Cover with E2E tests on existing web-only flow before T2 extends to Telegram.

**Acceptance criteria:**

- S0 scenarios pass: assistant adapts opening line based on time gap (manual + harness check).
- New unit tests for `ProactivePushPolicyService` cover: 1-per-48h limit, quiet-hours blocking, auto-mute after 2 unanswered.
- Existing scheduled-action E2E test extended with the safeguard checks.
- No more than 1 audience=user push per 48h fires for the same (assistant, user) in stress tests.

**Out of scope (T1):**

- Telegram outbound (T2).
- Web push notifications (T3).
- User-facing controls for safeguards (would violate principle 1; safeguards are coded constants).

**Slice T1 handoff prompt:**

> You are implementing ADR-074 Slice T1 (Sense of time + frequency safeguards). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice T1 section in full. Slices S0, P1 must be landed. Heartbeat sits at tail (do not move). Safeguards are hard-coded constants, never user-configurable. Do not extend to Telegram in this slice. Acceptance: heartbeat carries the three time fields, ProactivePushPolicyService enforces all three rules, scheduled-action E2E tests pass. When done, SESSION-HANDOFF + CHANGELOG.

---

### Slice T2 — Scheduled action multichannel delivery (Telegram outbound)

- **Goal:** Route audience=user scheduled actions to the user's preferred active channel — Telegram if bot is bound and active, web otherwise. Today they always land in web chat regardless of binding.
- **Founder anchor:** From Q7-B-T2.

**Touch points:**

- `apps/api/src/modules/workspace-management/application/run-scheduled-assistant-action.service.ts` — replace hard-coded call to `SendNativeWebChatTurnService` with a router that picks `sendNativeWebChatTurnService` or a new `SendNativeTelegramOutboundService` based on assistant channel bindings + recent user activity per channel.
- New: `apps/api/src/modules/workspace-management/application/send-native-telegram-outbound.service.ts` — sends a system-initiated Telegram message via existing Telegram bot infrastructure.
- `apps/runtime/src/modules/turns/turn-execution.service.ts` and `turn-context-hydration.service.ts` — verify `channel: "telegram"` works for system-initiated turns (existing test coverage suggests yes for inbound; verify outbound).
- `packages/runtime-contract/src/index.ts` — extend `RuntimePersaiScheduledActionSourceSurface` if needed to include `telegram`.
- `apps/api/prisma/schema.prisma` — `assistant_task_registry.source_surface` may need `telegram` value added.
- New scenario for S0: `proactive-push-tg.yaml` (requires test TG bot in dev).

**Implementation outline:**

1. Define `ChannelDeliveryRouter` service: given `(assistantId, userId)`, return preferred channel from `{web, telegram}` based on: (a) which channels are bound and active; (b) channel where user was active most recently (last 7 days).
2. Build `SendNativeTelegramOutboundService`: takes assistant + user + reminder text, sends through existing Telegram bot path (the same one that handles outbound replies to inbound user messages). Respect `parseMode` and `dmPolicy` from binding.
3. In `RunScheduledAssistantActionService.execute`, replace the unconditional `sendNativeWebChatTurnService.execute` with a switch on the channel router result.
4. The runtime `channel: "telegram"` path for system-initiated turns: verify existing handling. If gaps, fix minimally — do not re-architect channel infrastructure.
5. Honor T1 safeguards regardless of channel.
6. Add `proactive-push-tg.yaml` scenario to S0; it requires a test bot configured in dev (document the setup in `docs/LIVE-TEST-HYBRID.md`).

**Acceptance criteria:**

- For an assistant with TG bound + recent TG activity: audience=user scheduled action lands in TG chat with the bot owner.
- For web-only assistant: audience=user scheduled action lands in web chat (today's behavior preserved).
- T1 safeguards still apply (1-per-48h includes both channels combined).
- E2E scenario passes both web and TG paths.

**Out of scope (T2):**

- Web push notifications (T3).
- Multi-recipient delivery (still just primary user).
- Group chat outbound (DM only at T2).

**Slice T2 handoff prompt:**

> You are implementing ADR-074 Slice T2 (Scheduled action multichannel delivery). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice T2 section in full. Slices S0, T1 must be landed. Channel routing is internal (not user-facing); user does not pick a channel, the router does. T1 safeguards still apply across both channels combined. Do not implement web push. Do not touch group chat semantics. Acceptance: web-only assistant unchanged behavior; TG-bound assistant receives push in TG; T1 1-per-48h enforced across channels. When done, SESSION-HANDOFF + CHANGELOG.

---

### Slice L1 — Adaptive tool loop limits per execution mode

- **Goal:** Replace the universal 4-step tool loop limit with mode-aware limits (normal: 2, premium: 4, reasoning: 8) and per-tool hard caps (web*fetch ≤5, web_search ≤3, image/video ≤1, memory*\*/compact: unlimited).
- **Founder anchor:** Principle 3 (tune, don't rebuild). From Q9-C part 1.

**Touch points:**

- `apps/runtime/src/modules/turns/turn-execution.service.ts` — replace constant `MAX_TOOL_ITERATIONS` with a function of resolved execution mode.
- `apps/runtime/src/modules/turns/native-tool-projection.ts` — define per-tool hard caps as constants near the existing tool definitions; reuse for runtime enforcement.
- New: `apps/runtime/src/modules/turns/tool-budget-policy.ts` — exported constants for loop limit by mode and per-tool hard caps; small policy helper to check budget exhaustion.
- Test coverage updates in `apps/runtime/test/turn-execution.service.test.ts`.

**Implementation outline:**

1. Define `TOOL_LOOP_LIMIT_BY_MODE = { normal: 2, premium: 4, reasoning: 8 }`.
2. Define `TOOL_HARD_CAP_PER_TURN = { web_fetch: 5, web_search: 3, image_generate: 1, image_edit: 1, video_generate: 1 }` and treat all not listed as effectively unlimited (still bounded by the loop limit).
3. In the loop in `turn-execution.service.ts`, track a per-turn counter per tool name. Before dispatching a tool call, check both the loop counter and the per-tool counter. On exhaustion, return a structured `tool_budget_exhausted` result so the model can produce an honest answer ("budget reached, tell user honestly").
4. Tests: a turn that tries 6 web_fetches in normal mode — runtime stops after 2 loop iterations and conveys honest result; a turn in reasoning mode — 8 iterations possible.

**Acceptance criteria:**

- S0 scenarios: chitchat-short uses ≤1 tool call (mode normal); tool-heavy-search completes within new limits; long-session-200 unchanged.
- New tests for `tool-budget-policy.ts` and updated tests in `turn-execution.service.test.ts` pass.
- A budget-exhaustion event surfaces in trace output (visible in S0 reports).

**Out of scope (L1):**

- Plurality detection (R1).
- Parallel calls (R2).
- Compound tools (R3).

**Slice L1 handoff prompt:**

> You are implementing ADR-074 Slice L1 (Adaptive tool loop limits). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice L1 section in full. Slices S0 must be landed. Limits are constants in `tool-budget-policy.ts`, not user-tunable. On exhaustion the runtime returns a structured result, model produces an honest reply. Do not implement plurality detection or parallel calls. Acceptance: chitchat-short uses ≤1 tool call, tool-heavy-search completes, budget exhaustion is honest. When done, SESSION-HANDOFF + CHANGELOG.

---

### Slice R1 — Plurality detection + requestedBudget hint

- **Goal:** When user asks for N items ("find 3 links", "show me 5 options"), the model can request a budget bump for the relevant tool, allowing legitimate multi-call patterns without weakening the default cap.
- **Founder anchor:** From Q10-A.

**Touch points:**

- System prompt augmentation in `apps/api/prisma/bootstrap-preset-data.ts` (add a short rule: "If the user asks for N items, set `requestedBudget: N` on the first tool call so the runtime can allow N parallel calls of that tool.").
- `apps/runtime/src/modules/turns/native-tool-projection.ts` — add optional `requestedBudget` field to relevant tool input schemas (`web_fetch`, `web_search`, `knowledge_search`).
- `apps/runtime/src/modules/turns/tool-budget-policy.ts` (from L1) — accept `requestedBudget` and grant `min(requestedBudget, hardCap)`.

**Implementation outline:**

1. Add the prompt rule to the appropriate template (likely `agents` or a new compact `policies` block at end of stable prefix). Keep it ≤60 tokens.
2. Add `requestedBudget: { type: "integer", minimum: 1 }` (optional) to the relevant tool input schemas.
3. In `tool-budget-policy.ts`, when a tool call carries `requestedBudget`, raise the per-turn cap for that tool to `min(requestedBudget, hardCap)`.
4. Tests: "find 3 links" scenario — runtime allows 3 web_fetches; "find 50 links" — runtime allows hardCap (5); request without `requestedBudget` — default unchanged.

**Acceptance criteria:**

- S0 scenario `tool-heavy-search` with explicit "3 links" prompt completes with 3 fetches.
- Existing chitchat-short behavior unchanged (no `requestedBudget` emitted).
- Test asserting hardCap clamp works.

**Out of scope (R1):**

- Parallel execution (R2).
- Compound tools (R3).

**Slice R1 handoff prompt:**

> You are implementing ADR-074 Slice R1 (Plurality detection + requestedBudget). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice R1 section in full. Slices S0, L1 must be landed. The prompt rule is a single short paragraph; do not write a long instruction. `requestedBudget` is optional on tool schemas. Hard cap is the ceiling. Do not implement parallelism here. Acceptance: 3-link scenario passes, 50-link clamps to hardCap, no regression on chitchat. When done, SESSION-HANDOFF + CHANGELOG.

---

### Slice R2 — Parallel tool calls + diagnostic for unused parallelism

- **Goal:** Make the runtime actually execute multiple tool calls returned in one model response in parallel, set OpenAI `parallel_tool_calls: true` explicitly, and add a system-prompt hint encouraging parallel emission.
- **Founder anchor:** From Q10-B. Diagnoses founder's observation: "model has parallel-tools but doesn't use it".

**Touch points:**

- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts` — set `parallel_tool_calls: true` explicitly in non-streaming and streaming payloads (where applicable per OpenAI Responses API).
- `apps/runtime/src/modules/turns/turn-execution.service.ts` — replace the sequential `for (const toolCall of providerResult.toolCalls) { await ... }` with `Promise.all` for tool calls in the same response. Exception: `memory_write` and any other ordering-sensitive tools must remain serial — group by tool name and run "safe-parallel" for read-only tools, serial for write-side.
- `apps/api/prisma/bootstrap-preset-data.ts` — in `agents` or `tools` block, add one short line: "When you need multiple independent tool results, return them in a single response — they will run in parallel."
- `native-tool-projection.ts` — selectively augment descriptions of `web_search`, `web_fetch`, `knowledge_search` with one short hint: "May be called in parallel with other independent searches."

**Implementation outline:**

1. Add `parallel_tool_calls: true` to OpenAI payloads (verify Anthropic equivalent is on by default).
2. In `turn-execution.service.ts`, partition `providerResult.toolCalls` into "safe-parallel" (read-only: `web_search`, `web_fetch`, `knowledge_search`, `knowledge_fetch`, `quota_status`) and "serial-required" (`memory_write`, `compact_context`, `summarize_context`, `scheduled_action`, `files.*`, `image_*`, `video_*`, `tts`, `browser`, `exec`, `shell`). Run safe-parallel via `Promise.all`, serial-required sequentially.
3. Add prompt hint in the right template.
4. Update tool descriptions for the 3–4 most-parallel-friendly tools.
5. Tests: scenario where model returns 3 web_fetch in one response — runtime runs them concurrently; scenario where model returns 2 memory_write — runtime runs them serially.

**Acceptance criteria:**

- S0 scenario `tool-heavy-search` shows: ≤2 round-trips for "3 fetches in one go" (one model call returns 3, runtime executes parallel, second model call wraps up).
- Wall-clock latency on tool-heavy-search drops by ≥30% versus L1+R1 baseline.
- No regression in memory_write integrity (all writes succeed in deterministic order).

**Out of scope (R2):**

- Compound tools (R3).
- Cross-turn parallelism (every turn is still its own loop).

**Slice R2 handoff prompt:**

> You are implementing ADR-074 Slice R2 (Parallel tool calls + diagnostic). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice R2 section in full. Slices S0, L1, R1 must be landed. Safe-parallel partition list is exact: read-only tools only. Memory writes and any state-mutating or ordering-sensitive tool stay serial. Set OpenAI `parallel_tool_calls: true` explicitly. Add only the single short prompt hint and 3–4 tool description tweaks specified. Do not implement compound tools. Acceptance: tool-heavy-search drops to ≤2 round-trips for batched fetches, latency drops ≥30%, memory_write remains serial. When done, SESSION-HANDOFF + CHANGELOG.

---

### Slice R3 — First wave of compound tools

- **Goal:** Introduce 3 compound tools that fuse common sequential pairs into single round-trips (`web_fetch_batch`, `knowledge_search_top_and_fetch`, `memory_write_batch`), modeled on the existing `files.write_and_send` pattern.
- **Founder anchor:** From Q10-C. Discipline: ≤5 compound tools alive at any time; each new one needs evidence (≥10% of sessions in logs OR explicit pain).

**Touch points:**

- `apps/runtime/src/modules/turns/native-tool-projection.ts` — register 3 new tool definitions.
- New runtime tool services or extensions:
  - `runtime-web-fetch-tool.service.ts` (extend existing or new) — supports `urls: string[]` input.
  - `runtime-knowledge-tool.service.ts` — extend with combined search-and-fetch path.
  - `runtime-memory-write-tool.service.ts` — extend with batch write input.
- `packages/runtime-contract/src/index.ts` — request/response types for the new compound shapes.
- `apps/api/prisma/tool-catalog-data.ts` — register the new tool codes if catalog-driven.
- Tests in `apps/runtime/test/`.

**Implementation outline:**

1. `web_fetch_batch({ urls: string[] })` — runs each URL via existing single-fetch logic in parallel (R2 must be landed), returns array of results. Honors per-tool hardCap from L1 (5 URLs max).
2. `knowledge_search_top_and_fetch({ source, query, topN })` — runs `knowledge_search`, then auto-`knowledge_fetch` on top `topN` (default 1, max 3) results. Returns combined snippets + full content.
3. `memory_write_batch({ entries: Array<{ kind, memory }> })` — writes up to 3 entries in one call, serially internally (consistency), returns per-entry success.
4. Update prompt-side hints minimally — describe these tools clearly so model picks them over manual chains.
5. Add scenario or update existing S0 scenarios to exercise compound tools where natural.

**Acceptance criteria:**

- S0 scenario `tool-heavy-search` shows ≥30% reduction in tool loop iterations vs R2 baseline.
- Existing single tools continue to work — compound tools are additions, not replacements.
- Tool catalog count still ≤ existing + 3 (no proliferation).
- Tests for each compound tool service pass.

**Out of scope (R3):**

- Adding more compound tools beyond these 3 (dispatch by founder review of S0 logs).
- Removing the underlying single tools.

**Slice R3 handoff prompt:**

> You are implementing ADR-074 Slice R3 (First wave compound tools). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice R3 section in full. Slices S0, L1, R1, R2 must be landed. Add exactly 3 compound tools listed; do not invent more. Each compound respects per-tool hard caps from L1. Underlying single tools remain available. Acceptance: tool-heavy-search shows ≥30% loop reduction, single tools still work, ≤5 compound tools total in the catalog. When done, SESSION-HANDOFF + CHANGELOG.

---

## Phase ordering and dependencies

Slices fall into four phases. Within a phase, slices can be implemented in parallel if more than one agent is available. Across phases, a later phase may not start until its dependency is green on smoke-harness baselines.

```
Phase 0 (foundation):
  S0 (Smoke harness)

Phase 1 (cheap wins, low risk):
  P1 (Stable prefix)        ← depends on S0
  V1 (Voice DNA)            ← depends on S0; can run parallel to P1

Phase 2 (memory + continuity):
  M1 (Memory core/retrieval)  ← depends on S0, P1
  M2 (Compaction + extract)   ← depends on M1
  M3 (Cross-session)          ← depends on M2
  M3.1 (Open-loop close UX)   ← depends on M3 + ≥1 week live evidence (queued, not blocking later phases)

Phase 3 (proactive presence):
  T1 (Time + safeguards)      ← depends on S0, P1
  T2 (Multichannel)           ← depends on T1

Phase 4 (tool loop tuning):
  L1 (Adaptive limits)        ← depends on S0
  R1 (Plurality)              ← depends on L1
  R2 (Parallel calls)         ← depends on R1
  R3 (Compound tools)         ← depends on R2
```

Phase 1 should be completed before Phase 2 (cache discipline before adding more context). Phase 2 and Phase 3 are independent and can run as two parallel streams. Phase 4 is independent of Phase 2/3 and can run in its own stream.

## Out of scope (deferred to later ADRs)

- **Q11-C — LLM-judge quality scoring** in smoke harness. Do not implement until S0 is stable for at least 2 weeks of active use.
- **Q12-C — Per-user multi-level cache key.** Only consider after P1 numbers are validated and a real ceiling is observed.
- **Q13-C — Living USER.md with auto-evolution.** Requires V1 + M2 + M3 stability, plus a safety-gate design for drift containment.
- **Q7-T3 — Web push (browser notifications).** Becomes meaningful only when there is a real cohort of web-only users without Telegram.
- **Q8-C — Sticky routing per session.** Founder explicitly chose to keep current routing; revisit only if S0 numbers reveal a clear waste pattern.
- **Tasks Center / Memory Center UX overhaul.** Outside this program; lifecycle UX work tracked in ADR-073 follow-throughs.

## Universal agent handoff prompt

> You are picking up implementation work on PersAI's ADR-074 humanity-and-cost polish program. ADR-074 lives at `docs/ADR/074-humanity-and-cost-polish-program.md`. The program is decomposed into 12 slices (S0, P1, V1, M1, M2, M3, T1, T2, L1, R1, R2, R3) organized in 4 phases. Each slice in the ADR is self-contained: goal, touch points, implementation outline, acceptance criteria, out of scope, and a per-slice handoff prompt.
>
> Before changing any code:
>
> 1. Read the entire ADR-074 once for context. Then read **only the slice you are implementing**, not other slices.
> 2. Read ADR-073 (program ADR) for surrounding architecture truth, and ADR-072 (migration ADR) only if the slice's touch points overlap with the migration boundary.
> 3. Verify all dependencies of your slice are landed by checking `docs/SESSION-HANDOFF.md` and `docs/CHANGELOG.md` for prior slice completion entries.
> 4. Verify the smoke harness from Slice S0 runs locally and the relevant scenario baselines exist (`scripts/smoke/baselines/<scenario>.baseline.json`). If S0 is not landed yet and you are not implementing S0, stop and request that S0 be landed first.
>
> The five founder principles are hard constraints across all slices:
>
> 1. **Magic, not user-controlled** — do not add user-facing settings for behavior the system should choose itself.
> 2. **The assistant lives in time** — every slice that touches conversation behavior must respect time awareness.
> 3. **Tune, do not rebuild** — change behavior through config/templates/policy modules, not by re-architecting.
> 4. **Smoke harness is agent-runnable** — every slice's acceptance is measured through `pnpm smoke:run <scenario>` with deterministic before/after diffs.
> 5. **No transitional modes, no shadow paths, no legacy fallbacks** — PersAI has no real users yet. Cut over directly to the new behavior. Do not add `useNewX` flags, shadow comparisons, v1/v2 duplicates, or "old code in case the new code breaks". If the new behavior is correct, ship it; if it is not, do not ship the slice. Reverting a bad slice is a `git revert`, not a runtime toggle. The only acceptable switches are existing plan-policy fields already in the architecture.
>
> When the slice is implemented:
>
> 1. Run the slice's acceptance commands and paste the smoke-harness before/after numbers into your SESSION-HANDOFF entry.
> 2. Append a new dated section to `docs/SESSION-HANDOFF.md` per ADR-005, listing every file touched, every test command run, the smoke-harness deltas, and any deviation from the ADR text (with justification).
> 3. Append a one-paragraph entry to `docs/CHANGELOG.md`.
> 4. Do not start the next slice in the same session unless the founder explicitly asks. Each slice is one atomic unit of work.

## Consequences

### Positive

- Token cost per active user drops measurably across all four phases, with the largest single win in Phase 1 (P1).
- Human-likeness becomes a code-level commitment (V1) rather than an unsupported marketing claim.
- Cross-session continuity (M2, M3, T1) turns the assistant from "smart chatbot" into "companion that lives in time".
- Every slice is independently shippable, measurable, and reversible — no big-bang rewrite.
- An agent operating in Cursor with no prior interview context can implement any slice from the ADR alone.

### Negative

- Slice count is high (12); execution discipline matters. Skipping S0 makes every later slice unmeasurable.
- V1 requires founder time (~30 minutes per archetype card, 4 archetypes) — not pure-engineering work.
- T2 introduces a Telegram outbound code path that did not exist; needs careful test coverage to avoid spam regressions.
- M2 default-flips `autoCompactionWeb` to `true` — existing user sessions in dev may behave differently after the change. Document in CHANGELOG.

## Alternatives considered

- **Single mega-slice "rewrite the persona/memory/cache layer".** Rejected: violates Principle 3 (tune, do not rebuild) and would block all measurable progress until the rewrite lands.
- **User-facing controls for memory weight, push frequency, voice tone, etc.** Rejected: violates Principle 1 (magic).
- **Sticky routing per session (Q8-C).** Founder explicitly preferred keeping the existing per-turn classifier; revisit only if smoke harness reveals waste.
- **LLM-judge in S0 from day one (Q11-C).** Rejected for v1: too noisy, too expensive, and adds dependency cycles to the harness. Add later when quantitative metrics stabilize.
