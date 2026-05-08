# ADR-087: Unified quota advisories and paid light mode

## Status

Accepted

Current execution state:

- Completed: Slice 1 — Admin/operator groundwork
- Completed: Slice 2 — Quota truth and advisory contract groundwork
- Completed: Slice 3 — Paid token light mode
- Completed: Slice 4 — Active-surface advisory delivery and hard-stop cleanup
- Slice 2 landed: advisory/reset-window truth on plan visibility and `quota_status`; thread-aware advisory candidates in assistant-facing `quota_status`; durable advisory dedupe persistence keyed by assistant/workspace + active thread + limit + threshold + reset window; generated contract/runtime shape sync; and removal of token-budget-driven abuse slowdown/block from the primary user path
- Slice 3 landed: paid token-budget exhaustion now stays on the safe degrade path only for non-free plans; free/zero-price plans remain explicit stop-path users; and web now exposes a quiet sidebar `Light mode` marker from grounded `plan.advisories.tokenBudget.paidLightModeActive` truth
- Slice 4 landed fully: web sync/stream turns and Telegram turns append grounded follow-up advisories in the active thread after the main reply; admin `Notifications` stores a live `quota_advisory` LLM instruction; non-token 100%-limit hard stops now flow through the same shared quota-truth-backed explanation path for runtime/tool/web/Telegram surfaces; the chat-surface `Fallback mode active` artifact has been removed so paid token fallback is sidebar-only again; and the final self-audit/cleanup pass plus strict post-audit hardening closed the remaining user-facing chat/Telegram fallback tails in the touched area
- Next active step: no remaining implementation slice inside ADR-087; continue with live validation and then move to the next ADR-078 continuation item

## Date

2026-05-08

## Relates to

ADR-024, ADR-025, ADR-028, ADR-030, ADR-044, ADR-082, ADR-084

## Context

PersAI already has real quota/accounting primitives:

- period-scoped token/Credits counters
- period-scoped monthly media counters
- day-scoped tool counters
- plan visibility and assistant-facing `quota_status`
- request-time token-budget degrade routing through `cost_driving_restricted`

But the current user experience is fragmented.

Today, near or exhausted limits can surface as a mix of:

- hardcoded `rate_limited` / `token_budget_exhausted` API errors
- web issue banners outside the chat transcript
- transport-only quota-fallback metadata
- Telegram-specific fixed error copy
- quota-pressure slowdown/block behavior that overlaps with token-budget fallback semantics

This creates three product problems:

1. the user gets technical quota/rate-limit behavior instead of one calm system
2. token-budget fallback and quota-pressure blocking fight each other at the same threshold
3. limit awareness is not delivered in the same conversational surface where the user is already talking to the assistant

Founder decisions for this ADR:

- limit communication should become one unified product system
- 90% of a finite limit should trigger a calm assistant follow-up in the active user surface, not a hardcoded transport error
- that follow-up must be assistant-authored from real quota/tool data, not fixed copy invented outside runtime truth
- for token budget, paid plans should enter a persistent light mode until the current quota period resets instead of hard-stopping text chat
- free/zero-price plans may receive warnings, but they must not enter paid light mode
- upgrade nudges should appear only when a higher paid plan still exists
- the quiet UI marker for active light mode should live in the left sidebar beside plan/usage, not as a noisy full-width warning

## Decision

PersAI will replace the current split quota-pressure / hardcoded-error behavior with one unified quota advisory and paid light-mode policy.

## Product semantics

### 1. Universal advisory scope

The universal advisory system applies to finite user-facing limits only.

Initial in-scope limits:

- token / Credits budget
- monthly media limits (`image_generate`, `image_edit`, `video_generate`)
- tool daily limits
- storage limits (`media_storage_bytes`, `knowledge_storage_bytes`, `workspace_storage_bytes`)

Out of scope for ADR-087:

- `activeWebChatsLimit`
- `messagesPerChat`

Those limits keep their existing product-specific gating and messaging until a later ADR explicitly unifies them.

Unlimited limits must not generate 90% warnings.

### 2. 90% advisory behavior

When an in-scope finite limit reaches 90% or more of its active limit:

- the primary assistant response for the user turn should still complete normally when the turn itself is otherwise allowed
- after that response, PersAI may append one additional assistant message in the same active user surface/thread
- the follow-up message must be generated from real quota/plan/tool facts, not from hardcoded surface copy
- the advisory is deduplicated once per chat/thread per limit per reset window

Active surface means the same place where the user is already interacting:

- web chat -> same web chat thread
- Telegram -> same Telegram thread

The advisory may include a calm upgrade suggestion when a higher paid plan exists.

### 3. Upgrade hint eligibility

Upgrade messaging is allowed when the user is not already on the maximum visible paid plan.

For ADR-087, the maximum plan is defined as:

- the active visible paid plan with the highest price

This rule is intentionally explicit so model-grounded advisory text does not guess from plan names such as `PRO`, `MAX`, or `ULTIMATE`.

### 4. Free-plan policy

Zero-price / free plans may receive 90% limit advisories.

They must not enter the paid light-mode behavior defined below.

For ADR-087, free-plan classification should resolve from effective plan truth rather than plan-name heuristics. The product source of truth is the effective plan's zero-price state, not a string match on `FREE`.

### 5. Token budget at 100% for paid plans

When a non-free plan reaches 100% of token/Credits budget:

- PersAI must not surface quota-pressure slowdown or budget-driven hard-stop behavior as the primary product path for ordinary text chat
- instead, the assistant enters paid light mode until the current token/quota period resets
- the same active conversation surface receives an assistant-authored explanation message grounded in live quota facts
- the explanation should say that the paid token budget is exhausted for the current period and that chat continues in a lighter mode until reset

Light mode means:

- request-time text turns continue
- expensive paid token-routing should degrade onto the safe route represented by `runtime.runtimeProviderRouting.fallbackMatrix[trigger="cost_driving_restricted"]`
- the effective light-mode route must be derived from runtime/provider policy and plan/runtime truth, not from plan-name heuristics

If the current runtime/provider policy does not expose a safe `cost_driving_restricted` route, implementation must add one as part of the rollout; “paid light mode” is the product truth, not an optional best-effort behavior.

### 6. Non-token limits at 100%

For non-token finite limits, capability-specific blocking remains valid.

Examples:

- exhausted monthly media generation/editing limits may block new media generation requests
- exhausted daily tool limits may block that specific tool path
- exhausted storage limits may block new uploads/persistence

But the user-facing explanation should follow the same unified advisory model:

- calm assistant-authored explanation in the active surface
- grounded by real quota/plan/tool facts
- may mention package or upgrade options when such options are exposed by quota/plan truth

This ADR intentionally leaves room for future paid media packages. Product text may mention package purchase only when the underlying quota/tool context actually exposes such an option.

### 7. Rate limiting vs quota behavior

Budget exhaustion must not masquerade as generic `rate_limited`.

`rate_limited` remains reserved for true abuse / anti-spam / transport throttling behavior.

Quota-driven 90% warnings, paid token light mode, and finite-limit exhaustion explanations belong to the quota/advisory system, not to the abuse system.

## Architecture consequences

### Assistant-authored quota advisories

`quota_status` remains the canonical assistant-facing quota/plan surface, but it must become sufficient for grounded advisories.

The quota/advisory path must expose enough structured truth for assistant-authored follow-ups, including as needed:

- finite vs unlimited classification
- current used / limit / percent
- current reset window
- effective plan and higher-plan availability
- package/upgrade options when applicable
- active light-mode state for token exhaustion

### Durable advisory dedupe

PersAI should persist durable advisory delivery/dedupe state so that 90% warnings are not resent on every turn.

Target-state ownership:

- API/control plane owns advisory threshold evaluation and dedupe state
- the dedupe key is scoped by assistant/workspace + active thread/chat + limit kind + threshold kind + reset window

Light mode itself may be derived from live quota + effective plan + current period, but advisory dedupe should be durable.

### Quiet UI state

When paid light mode is active, web should show a quiet non-banner marker in the left sidebar beside the current plan and usage summary.

This indicator is a secondary confirmation of current mode, not the primary explanatory surface. The primary explanation still belongs in the chat thread via assistant-authored message.

## Execution rules

ADR-087 is executed by Cursor Agent in explicit, reviewable implementation slices.

Execution constraints:

- do not preserve legacy quota-pressure UX, dead banners, duplicate copy paths, or compatibility scaffolding once the replacement path is landed
- do not add parallel “old vs new” product truth for token-budget handling on the active path longer than the slice strictly requires
- each slice must end with cleanup of superseded code/state, not only additive wiring
- each slice must end with a self-audit against ADR-087 to confirm there is no leftover legacy/musor in the touched area
- prefer bounded but meaningful slices over tiny partial UI-only or backend-only fragments that cannot express the intended product truth

## Execution slices

### Slice 1 — Admin/operator groundwork

- add a dedicated `Quota advisories and light mode` block to `Admin > Notifications`
- make `Idle reengagement` significantly more compact/minimal so the notifications page stays readable
- expose the ADR-087 policy/operator truth on the admin page without introducing temporary fake runtime behavior

### Slice 2 — Quota truth and advisory contract groundwork

- enrich quota/plan truth so advisories can be grounded in real finite-limit facts, reset windows, paid/free state, and higher-plan availability
- add durable advisory dedupe state keyed by assistant/workspace + active chat/thread + limit + reset window

### Slice 3 — Paid token light mode

- remove token-budget-driven abuse slowdown/block from the user-facing quota path
- make non-free token-budget exhaustion continue via the safe `cost_driving_restricted` route until period reset
- expose quiet light-mode state for web UI

### Slice 4 — Active-surface advisory delivery

- append assistant-authored follow-up warnings at 90% in web chat
- extend the same advisory behavior to Telegram in the active thread
- keep non-token 100% capability-specific blocks but route user-facing explanation through the same grounded advisory system

## Consequences

### Positive

- one coherent limit system replaces the current mix of banners, hardcoded error copy, and quota-pressure throttling
- near-limit communication moves into the same surface where the user is already talking to the assistant
- paid token exhaustion becomes a calmer degrade-to-light-mode experience instead of a blunt stop
- free plans can still receive conversion-oriented warning messages without activating paid light-mode semantics
- upgrade hints become grounded in explicit catalog truth rather than plan-name guesses

### Negative

- `quota_status` and related quota/plan visibility contracts will need richer structured fields
- API/runtime will need new advisory orchestration and durable dedupe behavior
- token-budget enforcement and abuse/rate-limit code paths must be untangled carefully to avoid regressions
- Telegram/web parity will require explicit follow-up delivery handling, not just API error normalization

## Alternatives considered

- Keep the current quota-pressure slowdown/block path and only polish copy: rejected because it still produces product-confusing `rate_limited` / `token_budget_exhausted` behavior.
- Hardcode warning templates outside assistant/runtime flow: rejected because the founder explicitly wants assistant-authored, data-grounded messages.
- Keep paid token exhaustion as a full hard stop: rejected in favor of calmer paid light mode until the quota period resets.
