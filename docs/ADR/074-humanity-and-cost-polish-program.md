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
| Q6  | Cross-session continuity        | Open-loops always + last-session synopsis (TTL 7 days)                           | M3         | —                             |
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
3. Trait sliders (formality / verbosity / playfulness / initiative / warmth) are kept and now act as conservative *modulators* of the chosen archetype rather than the entire personality source: `verbosity > 70` lengthens sentences one step, `initiative > 70` raises pace one step, `playfulness` scales irony around the archetype's baseline (capped at 90), and so on. This is the `voice-dna-modulator.ts` pure function; defaults are gender-neutral.
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
  - `multi-session-continuity` — `12/12` turns OK, `0` failed; total tokens **`108_256` vs baseline `163_201` (−33.67%)**, p95 latency **`16_523ms` vs baseline `20_196ms` (−3_673ms)**, tools `knowledge_search × 4` + `knowledge_fetch × 1` + `memory_write × 2` + `summarize_context × 1`, routing 100% `active / normal`, `0` auto-compaction triggers. Cross-session recall behaves to spec: in session 2 the assistant did not blanket-dump the contextual tail; turn 2 honestly said it didn't have enough specifics for a vague "what was I going to prepare?" cue, then turn 3 (with the cue "ретрит и квартальный обзор") ran `knowledge_search` + `knowledge_fetch` and correctly recalled all three planted facts — `Atlas`, `Helio`, and "*показать прогресс по retention*". That is the strict M1 success signal: relevance-retrieved tail working over `summary` lexical search, not naive prefix dump.
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

- **Goal:** When the user opens a new conversation thread with an assistant, inject (a) all currently-open `open_loop` memory entries (no TTL — open loops never expire on their own; the model closes them via `memory_write` when resolved), (b) the rolling synopsis of the most recent prior thread if it is younger than 7 days, regardless of which channel the prior thread was on. Old sessions fade in the conversational sense — only durable facts, preferences, and open loops remain. The new chat does not feel cold to the user, but also does not begin with a creepy "last time we discussed X" recap.
- **Founder anchor:** Principle 2 ("lives in time") + Principle 1 (magic — no user-visible "carry-over toggle"). From Q6-C.

**Founder-confirmed M3 specifics (2026-04-21 interview):**

- **Carry-over is fully cross-channel within the 7-day TTL.** This is the **headline product UTP** of M3, not a side effect. Founder design target: "Маша обсуждала на Web дома, села в автобус, открыла Telegram — ассистент удивил её, естественно подхватив тему". Memory from M1 already crosses channels (`(assistantId, userId)` scope), and the rolling synopsis from M2 must too. There is **no channel-family scoping**, no "web→web only" rule — that would kill the magic. The carry-over block does carry a `previousChannel` metadata field so the model can reason about it ("прошлый разговор был на Web"), but content visibility is identical regardless of source/destination channel.
- **Magic vs creepy is enforced in the system-prompt usage rules, not by withholding context.** The full content is always available within the TTL; the prompt instructs the model to **weave** it in naturally on relevance, never **recite** it as a formal opener. See the Carry-over block shape section below — those usage rules are the whole anti-creepy mechanism. Withholding synopsis text cross-channel would only make the assistant feel forgetful in the bus moment, which is the opposite of what we are building.
- **"New session" = first turn of a thread with zero prior turns** (i.e. brand-new `externalThreadKey`). Long-gap-after-silence inside an existing thread is **T1's** territory (heartbeat with `time_since_last_user_message`), not M3's. M3 has one trigger only: `thread.turnCount === 0`. Rationale: when the user reopens an existing thread, the full prior conversation is already in the in-thread context — duplicating it via M3 carry-over would burn tokens and read tonally weird ("помню, мы обсуждали retention" — да, я ещё это вижу выше).
- **7-day TTL is hard-coded, not plan-policy-tunable.** Principle 1 / Principle 3: tuning constant, not admin knob. If smoke evidence ever shows 7 days is wrong, the constant changes in a follow-up slice, not in the admin UI.
- **Single most-recent synopsis across all channels (option a).** M3 surfaces the **one** most-recent synopsis row for `(assistantId, userId)` regardless of which channel it came from, ordered by `synopsis_updated_at DESC`. We deliberately do NOT pull the top-N most recent across multiple threads in V1 — keeps the carry-over block bounded and the implementation simple. The 1→3 extension ("you also recently discussed X with this assistant") is a follow-through if smoke evidence shows one synopsis isn't enough; it is **out of scope for M3** initially.
- **Open-loop selection.** All `assistant_memory_registry_items` rows for `(assistantId, userId)` with `kind = 'open_loop'` AND `memory_class = 'contextual'` (per the M1 classifier) AND `resolved_at IS NULL` (M3 adds this column — see Implementation step 1). Soft cap of 10 most-recent open loops keeps the carry-over block bounded. Open loops have no TTL of their own: they live until the model resolves them via `memory_write` (which sets `resolved_at` to now). If a real user accumulates more than 10 active loops, the recency cap kicks in — older loops remain in the database and are still searchable via `knowledge_search`, they just don't live in the always-on carry-over block.

**Live truth from M2 (do NOT re-derive — wire your slice to the M2 row M2 actually persisted):**

- M2 persists the rolling session synopsis on whatever row M2 picked when it landed (likely an extension of the existing session compaction state row in `apps/api/prisma/schema.prisma`). Before implementing M3, **read the M2 closeout SESSION-HANDOFF entry** to find the exact column names — do not invent them. The expected shape is `synopsis_text TEXT NULL` + `synopsis_updated_at TIMESTAMPTZ NULL` (or equivalent) + a foreign-key relationship to the `(assistantId, channel, externalThreadKey)` triple.
- M2 also exposes `RuntimeCompactionResult.autoExtract` so by the time M3 fires there are durable memory entries M2 created (in addition to entries the model wrote via `memory_write`). M3 reads from the same `assistant_memory_registry_items` table; it does not care which path wrote them.
- M2's background scheduler in `apps/api` may not have finished when M3's new-thread fires (e.g., user starts a new chat 30 seconds after closing the old one and M2's job is still running). This is fine: M3 reads whatever synopsis is currently persisted; if M2 hasn't replaced it yet, M3 reads the previous one (one synopsis-version stale is acceptable, same `session_busy` precedent).

**Touch points:**

- `apps/api/prisma/schema.prisma` — possibly add `resolved_at TIMESTAMPTZ NULL` to `assistant_memory_registry_items` if no equivalent column exists for closing open loops. Confirm M2's synopsis storage location and column names; do not duplicate them.
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` — at the very start of every turn, check `thread.turnCount === 0`. If yes, call new `findCrossSessionCarryOver({ assistantId, userId, now })` and prepend the result before the rolling-synopsis (M2) and verbatim-recent-window blocks.
- New (in `apps/api`, exposed via the same internal listener M1 uses): `POST /api/v1/internal/runtime/cross-session/carry-over` returning `{ openLoops: Array<{ summary }>, lastSessionSynopsis: { text, ageDays, channel } | null }`. This mirrors the M1 hydrate endpoint pattern (port 3002, internal-only, runtime-to-api call) so runtime stays stateless.
- New api-side service: `apps/api/src/modules/workspace-management/application/find-cross-session-carry-over.service.ts` — combines (a) up to 10 most-recent unresolved open loops via the M1 repository, (b) the single most-recent synopsis row across **all** channels for this `(assistantId, userId)`, via a new repository method (ordered by `synopsis_updated_at DESC`, filtered by `now - synopsis_updated_at < 7 days`). The synopsis lookup is intentionally cross-channel: a Web synopsis surfaces in a fresh Telegram thread and vice versa — that is the M3 magic, not a bug.
- `apps/runtime/src/modules/turns/prompt-cache-stable-blocks.ts` (or wherever P1's stable-block families live) — register `cross_session_carry_over` as its own stable family. Cache key includes `(assistantId, userId, synopsisVersionHash, openLoopsVersionHash)` so multiple new threads opened in the same week hit the same cached block; cache invalidates only when the underlying carry-over content actually changes.
- `apps/api/prisma/bootstrap-preset-data.ts` — extend the soul / system prompt template (or add a small dedicated block) with the carry-over usage rules below. The block is short (~80 tokens) and never user-visible.

**Design target (founder, 2026-04-21):**

> Маша обсуждала на Web дома планирование тимового ретрита в Барселоне. Села в автобус, открыла Telegram, написала «привет». Ассистент отвечает: «о, ты подумала про даты ретрита?» — это магия. НЕ «хочу напомнить, что вчера в 14:32 на Web мы обсуждали ретрит» — это казёнщина. Carry-over блок — это **семя для тёплой непрерывности**, а не материал для формальных recap'ов. Вся разница между «магия» и «жуть» — в том, **как** модель использует контекст, а не в том, **что** она видит.

**Carry-over block shape (target rendering, ~150–230 tokens):**

```
# Continuity from earlier conversations
Last conversation: {{cross_session_age_human}} on {{cross_session_channel}}
What you talked about: {{cross_session_synopsis_text}}

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

1. **Find or add the open-loop close mechanism.** Read the M1 schema. If there is no existing way to mark an `open_loop` entry as resolved, add `resolved_at TIMESTAMPTZ NULL` to `assistant_memory_registry_items` and have the repository method filter `kind = 'open_loop' AND resolved_at IS NULL`. The model can resolve open loops via the existing `memory_write` flow with a small extension (e.g. `memory_write({ kind: "open_loop", action: "close", ref: <id> })`) — but this extension is **out of scope for M3**; for now just expose the read path that filters unresolved open loops and let resolution be a model-issued `memory_write` follow-up that overwrites the same summary, picked up by dedup.
2. **Build the api-side `FindCrossSessionCarryOverService`.** Returns the **single** most-recent synopsis across **all** of the user's threads with that assistant (cross-channel, no channel filter) if `now - synopsis_updated_at < 7 days`, plus up to 10 most-recent unresolved open loops. The cross-channel scope is the headline behavior — implementer must NOT add a channel-filter parameter "for safety"; the magic is precisely that the synopsis crosses channels.
3. **Internal HTTP route on `apps/api`** — `POST /api/v1/internal/runtime/cross-session/carry-over` on `API_INTERNAL_PORT=3002`. Same auth model as the M1 hydrate route.
4. **Runtime hydration call.** In `turn-context-hydration.service.ts`, when the incoming turn is the first turn of a new thread (`turnCount === 0`), call the new internal route. If carry-over returns null (no prior session within TTL and no open loops), the block is omitted entirely and the prompt is exactly what it was without M3. If carry-over returns content, render the block per the shape above and prepend it to the message stack.
5. **Cache stability.** Register `cross_session_carry_over` as a stable-block family. Compute the cache key from the carry-over content hash, not from the thread id, so a user starting three new threads in the same week hits the same cached block. The hash invalidates when the synopsis is replaced (M2 background job runs) or open-loops list changes.
6. **Time-aware rendering.** `cross_session_age_human` is computed at hydration time from `now - synopsis_updated_at`: "less than an hour ago" / "earlier today" / "yesterday" / "3 days ago" / "5 days ago". This serves Principle 2 ("lives in time") — the assistant naturally has time anchoring for cross-session context, not just within-session context (which is T1's heartbeat).
7. **Tests.**
   - Unit: synopsis 1h old → carry-over present with "less than an hour ago"; synopsis 6.9 days old → carry-over present with "6 days ago"; synopsis 7.1 days old → synopsis absent but open loops still present; no prior session and no open loops → carry-over null, block absent.
   - Unit: cross-channel — synopsis written via TG thread, new Web thread → synopsis surfaces in Web carry-over.
   - Integration: smoke `multi-session-continuity` — session 2 opens cold with vague greeting; assistant should NOT announce "last time we talked about X"; smoke `multi-session-continuity` extended with a turn that natural-references the open loop (e.g., user types "ну как там по retention?" — assistant should pick up the open loop and respond informedly without first reciting it).
   - Cache regression: smoke `chitchat-short` from a user with 5 prior cross-session synopses (pre-seeded) — cached input tokens stay at the P1 baseline within ±2pp because the carry-over block is its own stable family.

**Smoke-time configuration (founder's `persai-dev` `Custom` plan):**

M3 acceptance is measured against the same `Custom` plan used for M2 (`compactionTriggerThreshold = 8000`, `targetContextBudget = 70000`, `keepRecentMinimum = 4`, `autoCompactionWeb = true`, `autoCompactionTelegram = true`). The `multi-session-continuity` scenario already runs two sessions; M3 extends what that scenario can verify — session 1 ends, M2 background compaction writes a synopsis, session 2 opens cold and the assistant has cross-session context without being prompted. No new smoke fixture or plan is needed.

**Acceptance criteria:**

- **Magic-moment scenario (the headline M3 acceptance signal).** New smoke scenario `cross-channel-magic.json` (or extension of `multi-session-continuity`): session 1 on Web ends with a substantive conversation that produces a synopsis (M2 background compaction fires, synopsis row written). A fresh Telegram thread for the same `(assistantId, userId)` opens within 24h with the user typing a casual greeting ("привет"). The assistant's first reply must (a) lead with current presence, (b) naturally weave in a reference to a topic from the prior Web conversation **without** reciting the synopsis or naming the previous channel, (c) not list open loops as a status report. Founder eyeball-review on the live transcript is the closing gate; the smoke harness records the assistant's first-turn text for that review.
- S0 scenario `multi-session-continuity` passes the M1 cross-session recall bar AND, in session 2 turn 1, the assistant's opening line does NOT explicitly recap the previous session ("помню, мы обсуждали Y" / "last time we talked about X") and does NOT mention the previous channel by name.
- A natural-follow-up turn (user types something contextually live to a planted open loop) — assistant responds informedly without first reading the loop back as a status update.
- Carry-over block does not appear when the most-recent synopsis is older than 7 days (test-enforced via fake-clock).
- P1 prompt cache hit rate is preserved on `chitchat-short` and on `long-session-200` — the new stable family does not bust the existing cached prefix (cached input tokens within ±2pp of M2 closeout baseline).
- Cross-channel surfacing test: a synopsis written by a TG thread surfaces in a fresh Web thread for the same `(assistantId, userId)` pair, and vice versa (unit + integration test).
- Open-loop resolution: when the model writes a `memory_write` that overwrites an existing open-loop summary with a closing note, the corresponding row's `resolved_at` is set and the loop disappears from the next carry-over (covered by an integration test, even though the model-driven close UX is a follow-through slice).
- M3 adds no user-facing UI surface anywhere.

**Out of scope (M3):**

- Multi-session synopsis stitching ("summarize the last 3 sessions") — only the most recent within TTL.
- Session merge / threading UI — would violate Principle 1.
- A model-issued `memory_write({ action: "close" })` to resolve open loops cleanly — for M3 the model resolves loops by overwriting the open-loop entry with an updated summary that the dedup picks up; cleaner resolution semantics is a later memory-system slice.
- Vector / embedding-based open-loop relevance ranking — recency + open-loop kind filter is enough.
- Per-channel carry-over scoping — explicitly REJECTED. The M3 design is fully cross-channel within the 7-day TTL; the founder anchor is the magic moment of being recognized in Telegram on the bus after a Web conversation at home. Channel-scoping would be a regression of the headline UTP.
- Top-N most-recent synopses (option (b) from the founder Q&A) — V1 ships with the single most-recent synopsis. Multi-synopsis carry-over is a follow-through if smoke evidence shows one is too thin.
- Any user-tunable TTL — hard-coded 7 days.

**Slice M3 handoff prompt:**

> You are implementing ADR-074 Slice M3 (Cross-session continuity, 7-day TTL). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice M3 section in full. Slices S0, P1, M1, M2 must all be landed (M2 produces the synopsis row you read). Hard constraints: (a) **carry-over is fully cross-channel** within the 7-day TTL — a Web synopsis must surface in a fresh Telegram thread and vice versa, this is the headline product UTP, NOT a side effect; do NOT add channel-family scoping "for safety"; (b) M3 fires only on turn 1 of a brand-new thread (`thread.turnCount === 0`), not on long-gap-after-silence inside an existing thread (that's T1's territory); (c) 7-day TTL is a hard-coded constant, never user-tunable, never plan-policy-tunable; (d) the carry-over block is its own stable-block family with a content-hash cache key (`synopsisVersionHash + openLoopsVersionHash`) so multiple new threads opened in the same week hit the same cache and M2's background synopsis replacement triggers a fresh M3 cache without busting unrelated families; (e) open-loop selection is `kind='open_loop' AND memory_class='contextual' AND resolved_at IS NULL` capped at 10 most-recent; the `resolved_at` column is added minimally in this slice; (f) the carry-over block contains explicit usage rules built around the founder's "магия в автобусе" design target — DO weave naturally on relevance, DO NOT recap, DO NOT name the previous channel, DO NOT list open loops as a status report; humanity over recap; (g) no user-facing UI anywhere; (h) the synopsis row name and shape MUST be read from the M2 closeout SESSION-HANDOFF entry — do not invent column names; (i) V1 ships the single most-recent synopsis across all channels — no top-N multi-synopsis carry-over, that is a follow-through. Acceptance: the magic-moment scenario (`cross-channel-magic` or extension of `multi-session-continuity`) shows a Telegram-on-the-bus opener that naturally weaves Web context without recap or channel-naming (founder eyeball review on transcript); cross-channel surfacing works both directions; carry-over absent past 7 days (fake-clock test); P1 cache rate preserved within ±2pp on `chitchat-short`; open-loop resolution via `memory_write` correctly sets `resolved_at` and removes the loop from next carry-over. When done, SESSION-HANDOFF + CHANGELOG with smoke deltas, the magic-moment turn-1 transcript snippet for founder eyeball review, and a per-test breakdown of `resolved_at` semantics.

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
