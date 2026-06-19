# ADR-121: Two-dimensional execution routing — task `level` separated from `(model, thinking budget)`

## Status

Accepted — 2026-06-19 (founder go; implementation by bounded slices)

> Open program ADR. Implemented in five bounded slices (see Work plan). Each slice ends green per the `AGENTS.md` verification gate; the final slice runs full-repository verification before any push/deploy.

## Date

2026-06-19

## Relates to

ADR-100 (project chat mode and B2B analysis profile), ADR-117 (tool instruction single seat), ADR-119 (prompt architecture and 2026 context engineering), ADR-120 (RAG / knowledge unification)

---

## Context

### The one-dimensional problem

The runtime router today outputs a single value `executionMode: "normal" | "premium" | "reasoning"` (type `RoutingExecutionMode`, `apps/runtime/src/modules/turns/turn-routing.service.ts:27`). This field conflates two orthogonal questions:

1. **How heavy is this task?** (cognitive load, evidence required, replanning depth)
2. **Which model should handle it, and how long should it think?** (model slot selection, inference-time compute budget)

A 1-D scale cannot express the distinction between a task that is heavy but does not require a dedicated reasoning model, and a task that does. The existing three values must simultaneously name a task weight and select a model, leaving no room to say "use the premium model but think for 8k tokens" independently of "use the premium model with no thinking at all". This is the root cause of two production hardcodes described below.

### Hardcode 1: `project` mode always routes to `reasoning`

`apps/runtime/src/modules/turns/project-execution-profile.ts:72` unconditionally returns `executionMode: "reasoning"` for every project-mode turn:

```
return {
  executionMode: "reasoning",   // line 72 — hardcoded, bypasses the classifier
  ...
};
```

Project mode needs deep, multi-pass execution with retrieval, tools, and a staged profile. It does not always need the reasoning-model slot. The hardcode exists because the 1-D ladder has no "heavy with tools, without switching models" position.

### Hardcode 2: `deepMode` ("smarter") is hard-capped at `premium`

The router contains seven explicit deepMode ternaries, all of the same form:

```
executionMode: input.request.deepMode === true ? "premium" : "normal"
// lines 554, 576, 598, 637, 707, 735, 751
```

The `premium_writing` branch has the degenerate form:

```
executionMode: input.request.deepMode === true ? "premium" : "premium"   // line 683
```

The `coerceExecutionMode` helper (`turn-routing.service.ts:1223–1231`) caps any deepMode upgrade at `premium`:

```typescript
private coerceExecutionMode(executionMode, deepModeEnabled): RoutingExecutionMode {
  if (deepModeEnabled && executionMode === "normal") {
    return "premium";
  }
  return executionMode;   // never reaches "reasoning" from deepMode
}
```

"Smarter" is therefore permanently capped at the premium model slot and never sets any thinking budget. A user choosing "smarter" cannot reach deep inference-time thinking regardless of task complexity.

### Classifier schema carries `executionMode` directly

The `router_classifier` LLM schema (`turn-routing.service.ts:108–110`) outputs:

```json
"executionMode": { "type": "string", "enum": ["normal", "premium", "reasoning"] }
```

The model is asked to make a model-selection decision rather than a task-weight decision. This conflation means the classifier mixes domain reasoning ("how hard is this?") with operational policy ("which model slot?"), making it harder to tune, harder to override per plan, and harder to unit-test.

### Contract and downstream wiring

`packages/runtime-contract/src/index.ts:2923–2929` — `RuntimeTurnRoutingSnapshot` persists `executionMode`:

```typescript
export interface RuntimeTurnRoutingSnapshot {
  mode: "shadow" | "active";
  executionMode: "normal" | "premium" | "reasoning";
  source: "precheck" | "llm" | "fallback";
  retrievalPlan?: RuntimeRetrievalPlan;
  skillState?: RuntimeSkillDecisionState | null;
}
```

`apps/api/src/modules/workspace-management/application/resolve-runtime-provider-routing.service.ts:135–155` maps `executionMode` to model slots `normalReply` / `premiumReply` / `reasoning`, resolved from plan keys `primaryModelKey` / `premiumModelKey` / `reasoningModelKey`.

`apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts:166–171` — the plan config already carries the three model keys. This is where `thinkingBudget` configuration will live alongside them.

`ProviderGatewayTextGenerateRequest` (`packages/runtime-contract/src/index.ts:3172–3219`) does not carry a `thinkingBudget` field today; the anthropic and openai provider clients contain no `thinking.budget_tokens` or `reasoning_effort` plumbing for live text generation (confirmed: no matches in `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts` or `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`; the only `thinking` reference in the provider-gateway test tree is a mock fixture in `apps/provider-gateway/test/anthropic-empty-completion.test.ts:80` for testing empty-completion handling).

### The medium/heavy insight

The premium model and the reasoning model are already distinct slots (plan keys: `premiumModelKey`, `reasoningModelKey`). The gap is between "use the premium model with no thinking" and "use the premium model with moderate thinking". These two behaviors select the **same model slot** but differ only in inference-time thinking budget. This cannot be expressed on a 3-value model ladder. It requires a second independent axis.

---

## Decision

### D1 — `level` is the single semantic output of the router

The router's sole output becomes `level: "light" | "medium" | "heavy" | "deep"`. This is the "how heavy is the task" axis. It names cognitive load and evidence requirements, not model identity. Both the precheck heuristics and the `router_classifier` LLM emit `level`.

Semantic intent:

| level | Typical tasks |
|-------|---------------|
| `light` | Short conversational replies, continuations, simple factual questions |
| `medium` | Writing-quality tasks, moderate analysis, standard retrieval, tool-assisted answers |
| `heavy` | Multi-source analysis, code review, project-file work, deep document comparison |
| `deep` | Architectural reasoning, root-cause analysis, multi-pass synthesis requiring persistent scratchpad thinking |

### D2 — One centralized resolver `level → ExecutionProfile { modelRole, thinkingBudget }`

A single pure function (no side effects, fully unit-testable) maps `level` to an `ExecutionProfile`:

| level  | modelRole (`PersaiRuntimeModelRole`) | derived `executionMode` | thinkingBudget |
|--------|------------------|------------------|----------------|
| `light`  | `normal_reply`   | `normal`   | `0` (off)       |
| `medium` | `premium_reply`  | `premium`  | `0` (off)       |
| `heavy`  | `premium_reply`  | `premium`  | `~8 192 tokens` |
| `deep`   | `reasoning`      | `reasoning`| `~32 768 tokens` |

The resolver grid lives in one place. Thinking budgets are configurable per-plan (D8). The exact default token values are initial targets; plans override them. (`modelRole` values are the existing `PERSAI_RUNTIME_MODEL_ROLES`; `executionMode` is derived via the existing `mapExecutionModeToModelRole` correspondence in `turn-execution.service.ts`.)

**Critical rationale**: `medium` and `heavy` map to the **same model slot** (`premium_reply`) but differ only in thinking budget. This is precisely why a second independent axis is required and why a 1-D model ladder cannot express the difference. The model ladder stays 3-tier (primary / premium / reasoning, already in plans); the 4 levels fold onto it via thinking budget. The `reasoning` slot is reserved for `deep` only; it is not used for every complex turn.

### D3 — `executionMode` is retained but demoted to a derived token

`executionMode` is wired into model resolution in approximately six places (runtime contract, turn-execution service, Telegram and web stream clients, Prisma binding on the turn record, admin analytics). These are mechanical plumbing points, not policy seats.

This ADR does **not** rip out `executionMode`. Instead:

- The router stops *deciding* `executionMode`. It outputs `level`.
- The resolver in D2 *derives* `executionMode` from `level` (trivially: `light → "normal"`, `medium → "premium"`, `heavy → "premium"`, `deep → "reasoning"`).
- All six downstream consumers of `executionMode` are unchanged.
- `RuntimeTurnRoutingSnapshot` gains `level` and `thinkingBudget` as additive fields; `executionMode` is kept for back-compat and model-slot derivation.

Downstream model resolution is unchanged. Blast radius is minimal.

### D4 — `thinkingBudget` is a new field plumbed contract → provider-gateway

`ProviderGatewayTextGenerateRequest` gains a new optional field `thinkingBudget?: number`. This is the unified semantic: "how long to think, in tokens". The value `0` (or absent) means no thinking parameters are sent, preserving current behavior.

Provider-specific mappings:

- **Anthropic Extended Thinking**: `thinking: { type: "enabled", budget_tokens: thinkingBudget }` on the messages API call. Sent only when `thinkingBudget > 0`.
- **OpenAI o-series**: `reasoning_effort` bucketed from `thinkingBudget` (e.g., 0 → omit, 1–10k → `"low"`, 10k–25k → `"medium"`, >25k → `"high"`). Only emitted when the resolved model is an o-series model.
- **Non-thinking models** (non-Anthropic-extended, non-o-series): the field is present on the request but the provider client ignores it gracefully.

Semantics are unified. The caller expresses intent ("this many tokens of thinking"); the provider client maps to provider-native parameters. The runtime does not need to know which provider it is routing to when it sets the budget.

### D5 — Remove both hardcodes; `project` and `deepMode` become weighted signals

`buildProjectModePrecheckDecision` (`apps/runtime/src/modules/turns/project-execution-profile.ts:50–86`) currently returns a hardcoded `executionMode: "reasoning"` (line 72). Under this ADR, `chatMode === "project"` becomes a strong signal that typically resolves to `level: "heavy"`, not `level: "deep"`. Project mode uses the premium model with extended thinking — not the reasoning-model slot — unless other signals (task complexity, explicit depth cues) push the level to `deep`.

`deepMode === true` ("smarter") becomes a +1-level nudge applied to the same level decision, not a separate code path:

| base level | with deepMode nudge |
|------------|---------------------|
| `light`    | `medium`            |
| `medium`   | `heavy`             |
| `heavy`    | `deep`              |
| `deep`     | `deep` (saturated)  |

The seven deepMode ternaries in `turn-routing.service.ts` (lines 554, 576, 598, 637, 683, 707, 735, 751) and the `coerceExecutionMode` helper (lines 1223–1231) are replaced by a single pre-classification nudge applied to `level`. One system; behavior differs only by where the signals push the level — exactly the founder's stated intent (ADR-100 §8).

### D6 — Classification signals enriched

The level decision considers all of the following:

- Existing admin-editable precheck term lists (`DEFAULT_CONTINUE_TERMS`, `DEFAULT_RETRIEVAL_TERMS`, `DEFAULT_REASONING_TERMS`, `DEFAULT_TOOL_TERMS`, `DEFAULT_PREMIUM_WRITING_TERMS`, `turn-routing.service.ts:167–258`), overridable via `input.policy.precheckRuleOverrides?.*Terms`.
- Request length (character count of the normalized message text).
- Presence of attachments (any non-trivial file or PDF attachment is a heavy-signal contributor).
- Active Skill (a running scenario is a medium-or-higher signal).
- `chatMode` (project is a heavy-level prior; ordinary and smart chat are unaffected).
- Keyword cues: "think hard", "think carefully", "проанализируй", "разбери подробно" are heavy-level contributors.
- KB availability (retrieval-capable context lowers the bar for `heavy` by removing guesswork).

Heuristics decide on high-confidence paths; on genuine ambiguity the `router_classifier` is invoked and its output schema switches from `executionMode` enum to `level` enum. The existing admin-editable `precheckRuleOverrides` mechanism is preserved and extended.

### D7 — Persistence is additive

`RuntimeTurnRoutingSnapshot` gains `level` and `thinkingBudget` as optional additive fields alongside the existing `executionMode` (kept for back-compat and model-slot derivation):

```typescript
export interface RuntimeTurnRoutingSnapshot {
  mode: "shadow" | "active";
  executionMode: "normal" | "premium" | "reasoning";   // derived, kept for back-compat
  level?: "light" | "medium" | "heavy" | "deep";        // new — semantic task weight
  thinkingBudget?: number;                               // new — tokens, 0 = off
  source: "precheck" | "llm" | "fallback";
  retrievalPlan?: RuntimeRetrievalPlan;
  skillState?: RuntimeSkillDecisionState | null;
}
```

The `router_classifier` JSON schema switches its required output from `executionMode` enum to `level` enum. `executionMode` is no longer returned by the classifier; it is derived by the resolver (D2) and injected into the snapshot before persistence.

### D8 — Admin plan surface extended

The existing "level → model" plan editor surface is extended to "level → (model, thinkingBudget)". Per-plan thinking-budget defaults are stored alongside the existing model keys in `admin-plan-management.types.ts`. Thinking budgets are configurable per plan so that different plan tiers can grant more or less inference-time compute. The resolver grid defaults are the fallback when a plan has no explicit budget configured.

---

## Target architecture

### Before (current state)

```
User message
     │
     ▼
Precheck heuristics
 │ deepMode ternary × 7 ──────────────────── caps at "premium"
 │ project special-case ──────────────────── hardcodes "reasoning"
 │ reasoning_request ──────────────────────► "reasoning"
 │ confidence=low?
 │     └──► router_classifier (LLM)
 │              outputs {executionMode: "normal"|"premium"|"reasoning"}
     │
     ▼
TurnRouteDecision.executionMode
     │
     ▼
resolve-runtime-provider-routing.service.ts
  normalReply   ← executionMode="normal"
  premiumReply  ← executionMode="premium"
  reasoning     ← executionMode="reasoning"
     │
     ▼
ProviderGatewayTextGenerateRequest
  (no thinkingBudget field)
     │
     ▼
Provider client — no thinking params sent
```

### After (this ADR)

```
User message
     │
     ▼
Signal collection
  message length, attachments, chatMode, deepMode nudge,
  active Skill, keyword cues, KB availability, precheck terms
     │
     ▼
Heuristic level decision
  → "light" | "medium" | "heavy" | "deep"
  (high confidence → skip classifier)
     │ confidence=low?
     └──► router_classifier (LLM)
              outputs {level: "light"|"medium"|"heavy"|"deep"}
     │
     ▼
level → ExecutionProfile resolver (pure function, D2 grid)
  ExecutionProfile { modelRole, thinkingBudget }
     │
     ├──► executionMode (derived)  ──────────► unchanged downstream model-slot resolution
     │         "normal" | "premium" | "reasoning"
     │
     └──► thinkingBudget (new) ──────────────► ProviderGatewayTextGenerateRequest.thinkingBudget
                                                     │
                                          ┌──────────┴──────────┐
                                          ▼                     ▼
                               Anthropic client            OpenAI client
                           thinking.budget_tokens      reasoning_effort bucket
                           (when budget > 0)           (when o-series + budget > 0)
```

Key invariant: `executionMode` derivation is a mechanical projection. The policy seat is `level`. All downstream consumers see the same `executionMode` they always have.

---

## Work plan

### Slice 1 — Contract + resolver + plan config

**Goal**: establish the new types and the pure resolver function; no routing behavior changes yet.

- Add `RoutingLevel = "light" | "medium" | "heavy" | "deep"` (exported from the runtime contract so both runtime and resolver share it).
- Add `level` and `thinkingBudget` optional fields to `RuntimeTurnRoutingSnapshot` in `packages/runtime-contract/src/index.ts`.
- Add `thinkingBudget?: number` to `ProviderGatewayTextGenerateRequest` in `packages/runtime-contract/src/index.ts`.
- Implement the `resolveExecutionProfile(level, overrides?) → ExecutionProfile { level, executionMode, modelRole, thinkingBudget }` pure function. It carries the built-in default grid (D2 table) and accepts an optional per-level budget override map; `executionMode` is derived (`light→"normal"`, `medium→"premium"`, `heavy→"premium"`, `deep→"reasoning"`). Unit tests cover all four levels, the default grid, and the override path.
- Acceptance: resolver unit tests cover all grid cells and the override path; verification gate green; no behavioral change to live routing (resolver not yet wired into the live path — that is Slice 2). The plan-level budget map is added and persisted in Slice 4 (admin), so no dormant plan field lands here.

**Verification gate** (all slices end with this):

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`
5. `corepack pnpm --filter @persai/runtime run typecheck` + `--filter @persai/provider-gateway run typecheck` + `--filter @persai/runtime-contract run typecheck`
6. Affected package tests.

### Slice 2 — Router: heuristics + classifier emit `level`; remove both hardcodes

**Goal**: the router outputs `level`; `project` and `deepMode` become weighted signals; both hardcodes deleted.

- Replace `executionMode` output with `level` output in `buildPrecheckDecision` and all precheck branches of `turn-routing.service.ts`.
- Remove the seven deepMode ternaries (lines 554, 576, 598, 637, 683, 707, 735, 751). Replace with a single `applyDeepModeNudge(level): level` helper.
- Remove `coerceExecutionMode` (lines 1223–1231).
- Delete the `executionMode: "reasoning"` hardcode in `buildProjectModePrecheckDecision` (`project-execution-profile.ts:72`). Replace with `level: "heavy"` (the default project-mode level); deepMode nudge may elevate it to `"deep"`.
- Update `ROUTER_OUTPUT_SCHEMA` so `executionMode` is removed from the LLM output; add `level` with `enum: ["light", "medium", "heavy", "deep"]`.
- Apply the D2 resolver after the level decision to derive `executionMode` before constructing `TurnRouteDecision`.
- Tests: signal-combination matrix (project mode × deepMode × task cues → expected level); golden test on the resolver grid (all four levels, two plan configs).
- Acceptance: both hardcodes gone; precheck branches compile without deepMode ternaries; golden tests pass; verification gate green.

### Slice 3 — Provider plumbing: Anthropic Extended Thinking + OpenAI reasoning_effort

**Goal**: `thinkingBudget` is read from `ProviderGatewayTextGenerateRequest` and mapped to provider-native parameters.

- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`: when `thinkingBudget > 0`, append `thinking: { type: "enabled", budget_tokens: thinkingBudget }` to the messages API call. When `0` or absent, send nothing (preserve current behavior).
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`: when `thinkingBudget > 0` and the model is an o-series model, map budget to `reasoning_effort` buckets (`"low"` / `"medium"` / `"high"`). When `0`, absent, or non-o-series model, send nothing.
- Pass `thinkingBudget` from `turn-execution.service.ts` to the provider client via the `ProviderGatewayTextGenerateRequest`.
- Tests: `anthropic-provider.client.test.ts` asserts `thinking` block emitted for budget > 0 and absent for budget 0; `openai-provider.client.test.ts` asserts `reasoning_effort` set correctly for o-series and absent for non-o-series.
- Acceptance: provider clients tested at both budget=0 and budget>0; no change to live traffic until Slice 2 land; verification gate green.

### Slice 4 — Admin UI: "level → (model, thinking)" plan editor

**Goal**: the existing admin plan editor surfaces thinking-budget fields alongside model keys.

- Add `thinkingBudgetByLevel: { light, medium, heavy, deep } | null` to the plan config type (`apps/api/src/modules/workspace-management/application/admin-plan-management.types.ts`) alongside the existing model keys, and materialize it into the runtime bundle the same way the model keys flow (`resolve-runtime-provider-routing.service.ts` → bundle), feeding the resolver's override param.
- Extend the admin plan form and backing API to accept and persist `thinkingBudgetByLevel` alongside the existing `primaryModelKey` / `premiumModelKey` / `reasoningModelKey` fields.
- Plan-level defaults displayed in the editor; zero or blank means "use resolver default".
- Acceptance: admin can save per-level thinking budgets; plan config round-trips through the admin API and reaches the resolver; verification gate green. Adding, persisting, materializing, and surfacing the field happen in this one slice so no dormant field exists between slices.

### Slice 5 — Tests: router signal-combination + resolver golden tests

**Goal**: full regression coverage before any production rollout.

- Router signal-combination tests: matrix of `chatMode × deepMode × message characteristics × KB availability → expected level`.
- Resolver golden tests: all four level values × three plan configs (no override, partial override, full override) → expected `{ modelRole, thinkingBudget, derivedExecutionMode }`.
- Snapshot test on `RuntimeTurnRoutingSnapshot` shape (both `level` and `executionMode` present for a heavy-level project-mode turn).
- Acceptance: all tests pass; verification gate green.

No infra changes in this ADR. No Helm / NetworkPolicy / RuntimeClass modifications are required. This ADR carries no cross-ADR infra dependency.

---

## Consequences

### Positive

- **Expressiveness**: medium and heavy tasks can now receive thinking without touching the reasoning-model slot. The 3-tier model ladder is preserved and correctly used.
- **Correctness**: project mode no longer forces the reasoning slot for every turn. Thinking budget is applied where appropriate, not as a side effect of a model-ladder climb.
- **"Smarter" is meaningful**: deepMode nudge now has somewhere to go above premium. A user choosing "smarter" on an already-medium task gets extended thinking, not the same model with no change.
- **Minimal blast radius**: `executionMode` and all six downstream consumers are unchanged. The resolver is the only new policy seat.
- **Testability**: the `level → ExecutionProfile` resolver is a pure function with no external dependencies; it can be exhaustively tested without a running server.
- **Admin control**: thinking budgets are per-plan, giving operators cost and quality control without code changes.
- **Classifier clarity**: the LLM now decides task weight ("how hard?"), not model identity ("which slot?"). The decision is more natural and more tunable.

### Negative

- **Migration surface**: `RuntimeTurnRoutingSnapshot` gains two new fields; existing persisted turn records lack them. Back-compat reads must treat absent `level` as `null` and not crash.
- **Provider thinking support is model-gated**: Extended Thinking requires specific Anthropic model versions; `reasoning_effort` requires o-series models. Plans that configure `heavy` or `deep` with non-supporting models must fall back gracefully (budget silently ignored).
- **Slice 2 is the highest-risk change**: replacing seven deepMode ternaries and deleting two hardcodes in the router touches the most frequently executed code path. The golden tests in Slice 5 must be completed before rollout, not after.
- **Admin complexity grows slightly**: the plan editor gains thinking-budget fields. Operators who do not configure them get sensible defaults and no behavior change.

### Out of scope

The following are explicitly **not** in scope for this ADR; each belongs in a separate ADR:

- **Memory JIT redesign** (move the always-on volatile memory block to on-demand tool retrieval) — separate founder-owned ADR.
- **Scenario step progression** (`activeStepNumber`, early-step tool guards) — see the ADR-119 founder acceptance closure note; requires a new ADR.
- **RAG / knowledge unification** — the ADR-120 line referenced by ADR-119 (not yet authored as a file).
- **Sandbox / shell execution model** (Claude-Code-style tools and isolation) — separate ADR.
- Changing the model ladder beyond the existing 3 tiers (primary / premium / reasoning).
- Per-request user-chosen model selection.
- Infra changes (Helm, NetworkPolicy, RuntimeClass).

---

## Alternatives considered

### Alternative A: keep 1-D `executionMode`; add `thinkingEnabled: boolean` as a separate flag

The simplest structural change: keep `executionMode` as today, add `thinkingEnabled` or `thinkingBudget` as an independent flag on the route decision and request contract, wired from the existing `deepMode` signal.

**Why rejected**: this does not fix the fundamental conflation; it adds a second hack on top of it. `deepMode` is still hard-capped at `premium`. `project` mode still hardcodes `reasoning`. The thinking flag becomes another inconsistently-populated field alongside the deepMode ternaries. Each new "mode" (project, smarter, future `focused` mode) continues to require its own special-case branch in the router. The root cause — a 1-D scale answering two orthogonal questions — is not addressed.

### Alternative B: replace `executionMode` with `level` everywhere across all ~6 call sites

The "clean sweep": rename `executionMode` to `level` everywhere, change the enum values, update all six consumers, update Prisma, update the streaming protocol.

**Why rejected**: the blast radius is unnecessary. The six consumers use `executionMode` as a mechanical model-slot picker. They do not need to understand `level` semantics; they only need a slot name. Updating all six consumers requires coordinated changes to the runtime contract, turn-execution service, API stream clients, Telegram client, and Prisma persistence — any one of which can introduce a silent regression. The chosen design (router outputs `level`, resolver derives `executionMode`, downstream unchanged) achieves the same policy clarity with one new pure function and two additive contract fields.

The "derive `executionMode` from `level` at the policy boundary" is a standard adapter pattern: it isolates the new semantic model from the existing operational wiring and allows the two to evolve independently.

---

## Rollout and safety

1. **Slices 1 and 3 first** (contract and provider plumbing) land without any behavioral change to live traffic. `thinkingBudget` is plumbed but never set to a non-zero value until Slice 2 ships.
2. **Slice 2** (router rewrite) is the highest-risk slice. The following mitigations apply:
   - All signal-combination golden tests (Slice 5) must pass before Slice 2 is merged.
   - Router mode (`shadow` / `active`) can gate the new path at the feature level; existing `RouterPolicy.mode` infrastructure already provides this control (`turn-routing.service.ts:26`).
   - Monitoring: `level` is logged in the routing snapshot; compare pre/post level distribution against the expected `executionMode` distribution via existing routing telemetry.
3. **No thinking tokens are sent to providers** until plans explicitly configure non-zero budgets in Slice 4. Default plan configs start with `thinkingBudgetByLevel: null`, which the resolver treats as "budget 0 for all levels". Current behavior is preserved.
4. **`executionMode` in persisted records**: existing records without `level` are read with `level: null` treated as unknown. No Prisma migration is required; the field is additive to the snapshot JSON.

---

## Open verification items

Decided at ADR acceptance:

- **`reasoning_request` precheck path** (`turn-routing.service.ts:657–678`, today returns `executionMode: "reasoning"` for reasoning-term / code matches): maps to **`level: "heavy"` by default** (premium model + moderate thinking), **not** `deep`. `level: "deep"` is reached only with an explicit depth signal — `deepMode` (the +1 nudge from `heavy`), explicit cues (`think hard`, `проанализируй`/`разбери подробно`), or a long multi-part request. Rationale: cheaper and lower false-positive rate than routing every code/debug message to the reasoning slot.

The following remain code-level spot-checks during implementation (do not block acceptance):

1. **Anthropic model version gating for Extended Thinking**: the provider client (Slice 3) must verify that the resolved model is Extended-Thinking-capable before emitting `thinking` params (model string prefix or capability lookup), confirmed against the live provider catalog.
2. **OpenAI `reasoning_effort` bucketing thresholds**: the budget-to-bucket mapping proposed in D4 (~1–10k → `"low"`, 10k–25k → `"medium"`, >25k → `"high"`) is a starting point; validate the exact boundaries against the active o-series model documentation before Slice 3 ships.
