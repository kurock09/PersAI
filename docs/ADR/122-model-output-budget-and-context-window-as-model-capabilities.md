# ADR-122: Output budget and context window as first-class model capabilities (+ truncation guard)

## Status

Accepted — 2026-06-20 (open program; three bounded slices — see Work plan)

> Open orchestration ADR. New long-term system rule: a model's output ceiling and context window are admin-managed capability fields on the model catalog, and the per-request output budget is computed by one resolver instead of scattered magic numbers. Do not treat closed program ADRs as backlog for this work.

## Date

2026-06-20

## Relates to

ADR-050 (runtime provider profile baseline), ADR-099 (provider pricing catalog and unified model cost ledger), ADR-106 (video provider catalog and execution routing), ADR-110 (model resolution fallback and prompt-cache orchestration), ADR-121 (two-dimensional execution routing — `thinkingBudget` plumbing this ADR must not break)

---

## Context

### Symptom (user-visible)

1. Long Anthropic answers (especially Russian audits / markdown tables) are cut off mid-sentence.
2. After a cut-off, a short user reply ("спасибо") makes the model *continue* the truncated previous answer (writes "шаг 6…") instead of reacting to the new message.

### Live evidence (persai-dev, 2026-06-20)

`provider-gateway` logs show three turns terminating with `stopReason=max_tokens outputTokens=1024`, and the captured response dumps are Russian landing-page audits whose markdown tables are cut mid-row (`… | Social `, `… конкретнее заго`, `… клиентов `). All observed truncations in the sampled window were `classification=tool_loop_followup` (the answer written after a `browser` tool call); `main_turn` answers in the window were short and ended with `end_turn`. The root cause below applies identically to both `main_turn` and `tool_loop_followup`.

### Confirmed root cause (independently re-verified, file:line)

**A — the truncation is a `max_tokens` ceiling of 1024.**

- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts:156` (`generateText`) and `:286` (`streamText`): `max_tokens: input.maxOutputTokens ?? 1_024`. These are the only `?? 1_024` literals in the repository.
- `apps/runtime/src/modules/turns/turn-execution.service.ts` `buildProviderRequest` (~`:1686`) never sets `maxOutputTokens` on the returned `ProviderGatewayTextGenerateRequest`. Its call sites (initial main turn, mid-turn context refresh) and `buildToolLoopProviderRequest` (which spreads the base request unchanged) also never set it. The main chat turn and the tool-loop continuation therefore reach the provider with no budget → the Anthropic client silently clamps to 1024.
- OpenAI has no hardcoded fallback: it omits `max_output_tokens` when absent and the model uses its own ceiling. The 1024 truncation is an Anthropic-path defect.
- Thinking interaction (must be preserved): `anthropic-provider.client.ts:183`/`:309` set `max_tokens = (input.maxOutputTokens ?? 1_024) + input.thinkingBudget`, guarded by `thinkingBudget >= 1024` and a capable-model regex. The output-budget resolver returns the **answer** budget; the provider client keeps adding the thinking budget on top.

**B — a truncated answer is indistinguishable from a complete one, so the model continues it.**

- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` reads message `metadata` only for `discoveredFileRefIds` and Telegram sender; `isHydratableCanonicalMessage` (~`:1237`) does not inspect any truncation/status signal. A truncated assistant message is hydrated as a normal `role:"assistant"` turn.
- `metadata.status="partial"` is written today only for **client abort** (`stream-web-chat-turn.service.ts:1740`) and **stall / no `done` chunk** (`:697`). It is never written for `max_tokens`.
- The provider clients hardcode `stopReason: "completed"` even when `stop_reason === "max_tokens"` (`anthropic-provider.client.ts:509`, `openai-provider.client.ts:1157`). The contract `ProviderGatewayTextGenerateResult.stopReason` is a closed union `"completed" | "tool_calls"` (no `max_tokens`), and `RuntimeTurnResult` has no stop-reason field at all. The truncation signal is dropped at the provider boundary and never persisted. No server-side reader of `metadata.status` exists in the hydration/runtime path.

**C — the model's output ceiling and context window are not modeled; they are scattered magic numbers.**

- `apps/api/.../runtime-provider-profile.ts:148` `RuntimeProviderModelProfile` carries capabilities, billing mode, token weights, pricing, `displayLabel`, `videoModelParameters` — but **no** `contextWindow` and **no** `maxOutputTokens`.
- `apps/api/.../runtime-provider-routing.types.ts:9` `modelSlots.*` carry only `{ providerKey, modelKey }`.
- `apps/runtime/.../runtime-document-provider-adapter.service.ts:2691` `resolveMaxOutputTokens` reads `slot.maxOutputTokens`, which does not exist on the slot type, so it always falls back to the module constant `DEFENSIVE_OUTPUT_TOKEN_CAP = 64_000` (`:145`). The slot read is dead code labeled "future admin-configured per-model capability".
- The admin web UI has zero inputs for `maxOutputTokens` / `contextWindow`.
- The model catalog rides into the runtime bundle as opaque `unknown` JSON (`runtimeProviderProfile` / `runtimeProviderRouting`); the runtime reads the routing slots, not the catalog profile, at turn time.

**Conclusion:** 1024 is a symptom. The root is that "how many tokens may this model emit" and "how large is this model's context" are not properties of the model in the admin-managed catalog; they live as scattered constants (`?? 1_024`, `DEFENSIVE_OUTPUT_TOKEN_CAP`) and one dead slot read.

## Decision

Make **output budget** and **context window** first-class, admin-managed capability fields on the existing model catalog, and compute the effective per-request output budget through **one resolver** used by every generation path. Add a **truncation guard** so a cut-off answer (real client abort, or any residual budget hit) is no longer silently continued by the model on the next turn.

This is not a magic-number bump and not an env-variable. The fields are catalog truth; the constants `?? 1_024` and `DEFENSIVE_OUTPUT_TOKEN_CAP` are demoted to a named last-resort sanity clamp only.

### D1 — Model capability fields

Add to `RuntimeProviderModelProfile` (and its normalized read/write path):

- `maxOutputTokens: number | null` — admin-set max answer tokens for the model; `null` ⇒ resolver uses the sanity clamp.
- `contextWindow: number | null` — admin-set total context window; `null` ⇒ context-window guard is skipped (output clamp still applies).

Validation in `normalizeModelProfiles()` (`platform-runtime-provider-settings.ts`): positive integers within sane bounds, `null` allowed. Both admin-save validation and read-side coercion share this single normalization seat.

**Family-default fold-in (PROD correctness).** Because these are brand-new fields, every catalog row already persisted in PROD has them as `null`. A synthesis-only default would therefore not fix existing rows. The default table `MODEL_CAPABILITY_DEFAULTS` (keyed by model key) is folded in at **both READ (`parseRuntimeProviderModelProfiles`) and WRITE (`normalizeModelProfiles`) normalization**, not only at legacy synthesis: for a **known** model an explicit admin value always wins, a blank/`null` is coerced to the published ceiling; for an **unknown** model the field stays `null` and the runtime resolver applies a safe fallback. This makes existing PROD rows correct without a manual save, idempotently. This deliberately supersedes a strict "null round-trips" rule for known models: coercing a known-model null to its real ceiling is the chosen behavior so PROD never hits the fallback for a model we actually know.

### D2 — Carry the resolved capability onto the routing slot

`modelSlots.*` gains optional `maxOutputTokens?: number | null` and `contextWindow?: number | null`. `ResolveRuntimeProviderRoutingService` looks up the active catalog profile for each slot's resolved model key and attaches the two capability numbers to the slot. The slot becomes the runtime-facing "resolved model capability" carrier. The bundle wire shape (`runtimeProviderRouting: unknown`) is unchanged — the JSON simply carries two more fields.

### D3 — One output-budget resolver

A single pure helper in the runtime:

```
resolveModelOutputBudget(
  capability: { maxOutputTokens: number | null; contextWindow: number | null },
  ctx: { inputTokensEstimate: number | null; thinkingBudget: number }
): number
```

Formula (thinking-aware — the Anthropic gateway counts thinking tokens inside `max_tokens`, so the resolver reserves the thinking budget within the ceiling so `answer + thinking` never exceeds the model ceiling):

```
totalCeiling = min(capability.maxOutputTokens ?? OUTPUT_BUDGET_FALLBACK, OUTPUT_BUDGET_MAX)
totalRoom    = (capability.contextWindow != null && inputTokensEstimate != null)
                 ? min(totalCeiling, capability.contextWindow - inputTokensEstimate - CONTEXT_SAFETY_RESERVE)
                 : totalCeiling
answer       = totalRoom - thinkingBudget
return clamp(answer, OUTPUT_BUDGET_FLOOR, OUTPUT_BUDGET_MAX)
```

So the gateway's `max_tokens = answer + thinkingBudget = totalRoom ≤ totalCeiling ≤ model ceiling` and `≤ contextWindow - input - reserve`. This eliminates the latent overflow where `opus answer(128k) + thinking(32768) = 160768 > 128000` would 400.

- The resolver returns the **answer** budget only; the Anthropic client keeps `max_tokens = answerBudget + thinkingBudget` (ADR-121 semantics preserved). The resolver subtracts `thinkingBudget` so the sum lands on the ceiling, never above it.
- `inputTokensEstimate` is a cheap char-based estimate (`≈3 bytes/token`) of the already-assembled provider request, so no new cross-cutting plumbing is introduced. No estimate ⇒ context-window guard skipped, ceiling governs.
- Constants: `OUTPUT_BUDGET_MAX = 128_000` (absolute upper bound on final `max_tokens`; the largest real model output ceiling — bounds absurd admin input without truncating any legitimate value). `OUTPUT_BUDGET_FALLBACK = 8_192` (conservative base for an **unknown/unseeded** model — never 400s on any mainstream chat model and 8× the old 1_024). `OUTPUT_BUDGET_FLOOR = 1_024`, `CONTEXT_SAFETY_RESERVE = 4_096`. The old `DEFENSIVE_OUTPUT_TOKEN_CAP = 64_000` is removed.

### D4 — Use the resolver on every generation path (both providers)

Wire `resolveModelOutputBudget` into the main chat turn (`buildProviderRequest`, reading the selected slot resolved at `resolveModelSlotSelection`), the tool-loop continuation, and the document/HTML adapter (`resolveMaxOutputTokens` refactored to delegate). `buildProviderRequest` sets `maxOutputTokens` **provider-agnostically**, so the OpenAI path (which previously omitted the field and silently used the model ceiling) now also gets an explicit, model-aware budget. The OpenAI Responses API sends `max_output_tokens` verbatim with no clamp, so seeding real OpenAI ceilings (D5) plus the safe fallback is what prevents 400s. Bounded-small callers (classifiers, extractors, compaction, media/vision completion, background-task evaluation) already pass explicit named budgets and are intentionally left as-is. The provider-client `?? 1_024` is replaced by a single named last-resort constant (`PROVIDER_FALLBACK_MAX_OUTPUT_TOKENS = 4_096`), only reachable when a caller omits the field entirely.

### D5 — Seed real values idempotently (Anthropic + OpenAI)

`MODEL_CAPABILITY_DEFAULTS` seeds both providers' active models, folded in at read/write/synthesis (D1). Anthropic (official docs, 2026-06-20): Sonnet/Haiku 4.x → context 200_000 / output 64_000; Opus 4.6/4.7/4.8 → 200_000 / 128_000 (context seeded at the non-premium 200k tier since real inputs are ≪200k). OpenAI (official limits, 2026-06): gpt-5.x family → 400_000 / 128_000; gpt-4o / gpt-4o-mini → 128_000 / 16_384. Any model key not listed resolves to `OUTPUT_BUDGET_FALLBACK` and is admin-tunable via the runtime UI. The fold-in is idempotent — existing PROD rows become correct on next read without a manual save and without a separate migration.

### D7 — Correct the ADR-121 turn-0 thinking gap

Verified during this work: the initial main turn (`prepareTurnExecution`) never passed a thinking budget to `buildProviderRequest` (it defaulted to `0`); only the tool-loop refresh path applied the route's thinking budget. So deep/heavy turns with no tool calls never actually performed extended thinking on the answer. This is corrected here (the prepare path now passes the route's `thinkingBudget` to both the provider request and the resolver, consistent with the refresh path). It is safe: the gateway stream timeout is an **idle** timer that resets on every stream event including thinking deltas (`PROVIDER_GATEWAY_STREAM_TIMEOUT_MS = 90_000`), and the cadence watchdogs are disabled for web chat. Fixed here rather than deferred because the gap surfaced directly from this slice's wiring and leaving it would be a known-broken tail.

### D6 — Truncation guard (full root)

Propagate the truncation truth end to end:

- Extend `ProviderGatewayTextGenerateResult.stopReason` to include the truncated case (e.g. `"max_tokens"`); stop hardcoding `"completed"` when the provider reported a length stop.
- Carry it on `RuntimeTurnResult` and persist it on the assistant message (`metadata.status` "truncated" or an equivalent flag) alongside the existing `"partial"`.
- In `turn-context-hydration.service.ts`, mark prior assistant messages flagged truncated **or** `partial` so the model does not continue them (a short trailing marker such as "[ответ был прерван]" / exclusion from continuation). After fix A, `max_tokens` truncation on ordinary long answers largely disappears; the guard remains correct for real client aborts and any residual budget hit.

## Work plan

Three bounded slices, gated by the `AGENTS.md` verification gate between slices, committed as they land, **pushed only at the very end** (push triggers deploy).

- **Slice 1 — capability fields + admin + seed.** D1 + D2 + D5: add `maxOutputTokens`/`contextWindow` to the model profile type and normalization; enrich routing slots; add the two admin numeric inputs in Runtime provider settings; idempotent seed of real values; regenerate contracts if the profile is exposed outward. Unit tests for normalization/validation (positive int, bounds, null).
- **Slice 2 — unified resolver.** D3 + D4: `resolveModelOutputBudget` helper with unit tests (null fields, context-window-bound case, thinking budget, sanity clamp, floor); wire into all generation paths; demote `DEFENSIVE_OUTPUT_TOKEN_CAP` → `OUTPUT_BUDGET_SANITY_CAP`; remove `?? 1_024`. Preserve thinking semantics.
- **Slice 3 — truncation guard.** D6: contract → runtime → persist → hydration. Unit tests for the hydration marker and the persisted truncated flag.

## Consequences

### Positive

- Long answers complete; `main_turn` and `tool_loop_followup` no longer truncate at 1024.
- Output ceiling and context window are admin truth in one catalog, editable without code changes.
- One resolver replaces three scattered output-token decisions; the dead slot read becomes live.
- The model stops continuing cut-off answers after the next user message.

### Negative / risks

- Larger `max_tokens` raises worst-case latency and provider cost on long turns; the sanity clamp and context-window guard bound this.
- The `stopReason` union widening touches the provider/runtime contract — escalates to the integration matrix per `docs/TEST-PLAN.md`; consumers that narrow on the union must handle the new value.
- Char-based input-token estimate is approximate; the context-window guard uses a safety reserve to stay conservative.

## Alternatives considered

- **Raise the literal to 16000 / add an env var.** Rejected by mandate — a magic number / env var is not catalog truth and does not fix the scattered-constants root.
- **Keep budget on the document adapter only.** Rejected — the main chat turn is the broken path; the adapter is already (dead-)wired. One resolver must serve both.
- **Static per-model registry in code.** Rejected — duplicates the catalog and is not admin-editable; ADR-099/106 already make the catalog the model-truth seat.
- **Hydration-only guard reading the existing `partial`.** Rejected by founder — `max_tokens` truncation is currently dropped entirely, so the honest fix propagates it through the contract (chosen: full root).
