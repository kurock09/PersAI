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

### Slice M2 — Multi-level session compaction with auto-extract

- **Goal:** Enable web auto-compaction by default. Build a three-layer long-session memory: rolling synopsis (compact summary that gets refreshed, not appended), verbatim recent window (6–8 latest turns), and auto-extraction of important facts into durable memory.
- **Founder anchor:** Principle 1 (magic — invisible to user). From Q5-B.

**Touch points:**

- `packages/runtime-contract/src/index.ts` — `PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET_DEFAULTS.balanced.autoCompactionWeb` flips to `true`. Same for `lean` if not already.
- `apps/runtime/src/modules/turns/session-compaction.service.ts` — extend to support **rolling synopsis** mode (replace previous synopsis on each compaction, do not concatenate).
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` — assemble context as: durable memory core + last-session synopsis (if applicable, M3) + rolling synopsis + verbatim recent window.
- New: `apps/runtime/src/modules/turns/auto-extract-to-memory.service.ts` — after each compaction, extract candidate facts/preferences/open_loops from compacted turns and write to durable memory (idempotent, dedup against existing entries).
- `apps/api/src/modules/workspace-management/application/context-hydration-policy.ts` — verify `autoCompactionWeb: true` flows through plan policy override correctly.

**Implementation outline:**

1. Flip default `autoCompactionWeb` to `true` in `PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET_DEFAULTS` for `balanced` (and `lean` if currently false).
2. In `session-compaction.service.ts`, change the compaction output schema so the **session summary is replaced**, not appended. The "previous synopsis" is one of the inputs to the next compaction call (so the new synopsis can carry forward important context). Keep `keepRecentMinimum` at 6 (raise from 4 if currently 4).
3. Build `auto-extract-to-memory.service.ts`: after a compaction succeeds, run one extra cheap LLM call (use `systemToolModel` slot) on the compacted turn range with a structured-output prompt: "extract durable facts, preferences, and open_loops from this conversation excerpt". Dedup against existing memory by simple normalized-text match before writing. Hard cap: ≤3 new entries per compaction event.
4. Update `RuntimeCompactionResult` to include the auto-extract summary (count of entries written, IDs).
5. Update unit tests for `session-compaction.service.ts` to lock rolling-synopsis behavior. Add a test for the auto-extract path with deterministic fake LLM output.

**Acceptance criteria:**

- S0 scenario `long-session-200` no longer hits the 24k context budget; total tokens grow sub-linearly with turn count.
- At turn 100, assistant correctly answers "what did we discuss in the first 10 turns?" using the rolling synopsis.
- After scenario completion, durable memory contains 5–15 new auto-extracted entries (not 0, not 50+).
- Plan-level policy override of `autoCompactionWeb: false` still works for compatibility with admin overrides.

**Out of scope (M2):**

- User-visible session card / synopsis editor (would violate principle 1).
- Cross-session summary stitching (handled in M3).

**Slice M2 handoff prompt:**

> You are implementing ADR-074 Slice M2 (Multi-level session compaction with auto-extract). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice M2 section in full. Slices S0, P1, M1 must be landed. The synopsis is **replaced** every compaction, not concatenated. Auto-extract uses `systemToolModel` slot, hard cap 3 new entries per event. Do not surface compaction state to the user — no UI changes. Acceptance: long-session-200 grows sub-linearly in tokens, recall question at turn 100 succeeds, 5–15 auto-extracted memory entries land. When done, SESSION-HANDOFF + CHANGELOG with smoke-harness deltas.

---

### Slice M3 — Cross-session continuity (last-session synopsis, 7-day TTL)

- **Goal:** When the user opens a new chat with an assistant, inject (a) all open_loop memory entries, (b) the rolling synopsis of the last session if it is younger than 7 days. Old sessions fade — only facts and open loops remain.
- **Founder anchor:** Principle 2 ("lives in time") + Principle 1 (magic). From Q6-C.

**Touch points:**

- `apps/api/prisma/schema.prisma` — runtime session table needs `synopsis_text` and `synopsis_updated_at` columns (or wherever the rolling synopsis from M2 is persisted).
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` — at session start (no prior turns in session), call new method `findCarryOverContext({ assistantId, userId, ttlDays: 7 })`.
- New repository method or service: locate most recent session for the (assistant, user) pair, return synopsis if `now - synopsis_updated_at < 7 days`.
- The injected carry-over block is a **dedicated cache-stable family** in `prompt-cache-stable-blocks.ts` (e.g. `last_session_synopsis`), so it caches across multiple new chats started in the same week.

**Implementation outline:**

1. Persist the rolling synopsis from M2 onto the session row (or its compaction state row), with `synopsis_updated_at`.
2. Add `findCarryOverContext` that returns: latest open_loop memory entries (always) + latest synopsis if within 7-day TTL.
3. In `turn-context-hydration.service.ts`, when assembling context for a session with zero prior turns, prepend the carry-over block.
4. Add to the system prompt template (or as a separate developer message) a brief instruction: "If a 'Previous session memory' block is present, you may reference it naturally but do not announce 'last time we talked about X' unless the user opens that thread."
5. Register `last_session_synopsis` as a stable-block family in `prompt-cache-stable-blocks.ts` so it caches.
6. Tests: simulate session 1 ends with synopsis, session 2 starts within 24h → carry-over present; session 2 starts after 8 days → only open_loops present; no prior session → block absent.

**Acceptance criteria:**

- S0 scenario `multi-session-continuity` passes: in session 2, assistant proactively (or on natural opening) references the open_loop from session 1.
- Carry-over block does not appear when last session is older than 7 days (enforced by test).
- Prompt cache hit rate is preserved (verify via OpenAI `cached_input_tokens`).

**Out of scope (M3):**

- Session merge / threading UI.
- Multi-session synopsis stitching beyond "most recent within TTL".

**Slice M3 handoff prompt:**

> You are implementing ADR-074 Slice M3 (Cross-session continuity, 7-day TTL). Read `docs/ADR/074-humanity-and-cost-polish-program.md` Slice M3 section in full. Slices S0, P1, M1, M2 must be landed (M2 produces the synopsis you persist). 7-day TTL is hard-coded; do not expose to user or admin. Carry-over block is its own stable-block family for caching. Do not introduce session merging UI. Acceptance: multi-session-continuity scenario passes, TTL boundary respected, cache hit rate preserved. When done, SESSION-HANDOFF + CHANGELOG.

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
