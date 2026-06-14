# ADR-082: Billing quota and delivery-confirmed media accounting

## Status

Accepted; implementation completed through launch cleanup and production risk closure.

Current continuation state:

- **Completed:** Slice 1 — ADR/audit and policy decisions.
- **Completed prerequisite polish:** per-plan `activeWebChatsLimit` was restored to `Admin > Plans` and effective-plan enforcement on 2026-05-03. This is not the media-monthly work, but it fixed a missing plan quota control needed before billing launch.
- **Completed:** Slice 2 — provider/model token profiles in `Admin > Runtime`.
- **Completed:** Slice 3 — weighted token accounting from runtime/provider `usageAccounting.entries`.
- **Completed:** Slice 4 — monthly media quota model.
- **Completed:** Slice 5 — delivery-confirmed media settlement.
- **Completed:** Slice 6 — product cleanup and launch hardening.
- **Completed production risk closure:** Credits/token budget now writes and reads period-scoped counters, and API-side media delivery entry points mark reserved generated artifacts for reconciliation when delivery is not reached.
- **Next active step:** continue ADR-083/ADR-084 billing lifecycle/provider implementation when directed; ADR-082 quota/media accounting is ready for that dependency.

## Date

2026-05-03

## Relates to

ADR-024, ADR-025, ADR-026, ADR-027, ADR-028, ADR-029, ADR-030, ADR-036, ADR-050, ADR-051, ADR-074, ADR-081

## Context

PersAI already has a serious provider-agnostic commercial control plane:

- plan catalog and entitlements (`PlanCatalogPlan`, `PlanCatalogEntitlement`)
- workspace subscription state (`WorkspaceSubscription`)
- effective subscription and capability resolution
- quota accounting state/events (`WorkspaceQuotaAccountingState`, `WorkspaceQuotaUsageEvent`)
- per-tool daily counters (`WorkspaceToolUsageDailyCounter`)
- admin plan editing, user plan visibility, admin visibility, and inbound quota enforcement
- runtime/provider usage snapshots in `usageAccounting`

This is enough for internal/admin-controlled trials, but it is not yet safe for mass paid usage.

Two production risks are now explicit:

1. Token quota is currently recorded from final text with the deterministic `chars_div_4_ceil_v1` estimator, even though provider/runtime usage snapshots already carry real input/output/cache token data. This under-models actual provider economics, especially when a turn uses router calls, retrieval helpers, tool/system model calls, cached input, or different providers.
2. Image/video generation and image editing currently consume tool quota before the provider call and before user-visible delivery. If the provider call times out, runtime fails, API delivery fails, or the web stream stalls after an artifact is created, a user can lose quota without receiving the generated media. That is unacceptable for paid launch and creates direct refund/support risk.

The founder decisions for this ADR are:

- prepare billing/quota semantics for mass rollout now, not as a later compatibility layer
- all model usage entries inside a user turn should count toward token budget
- token quota may stay user-visible as a single simple metric, but it must be based on provider/model economics
- provider/model token weights belong in `Admin > Runtime`, not in plan rows
- media generation/editing limits belong in plans and should be monthly, not daily
- media generation/editing quota must not be charged until the user actually receives the media
- if media generation/provider cost happens but delivery fails, do not charge user quota; write an admin reconciliation signal
- token over-limit may degrade/fallback to a cheaper model; media over-limit is a hard block with a calm assistant explanation

## Decision

PersAI will replace estimator-only token quota and daily media tool caps with production-ready accounting:

1. Token budget becomes a single user-facing quota metric backed by weighted provider/model usage entries.
2. `Admin > Runtime` becomes the source of truth for provider/model token cost profiles.
3. Every model usage entry in a user turn contributes to the token quota total.
4. Image generation, image editing, and video generation move from daily caps to plan-owned monthly limits.
5. Media generation/editing monthly quota is settled only after user-visible delivery succeeds.
6. Failed delivery after provider cost is recorded for admin reconciliation, not charged to the user quota.

## Product semantics

### User-facing token metric

The user should continue to see one calm quota metric. The user-facing label should be `Credits`; the quiet info affordance should explain that credits are based on model token usage, including input/output/cache and service calls needed to answer.

The product must not show normal users a noisy raw breakdown by provider, router, helper, cache, or output tokens.

Admin/business surfaces may show the breakdown.

### Token budget scope

For a user turn, token budget includes all runtime/provider usage entries that occur as part of satisfying that turn:

- early smart router / classifier calls
- main reply calls
- premium/reasoning reply calls
- retrieval helper/rerank/grounding model calls
- tool/system model calls
- media/tool provider calls when providers expose token usage
- fallback/recovery calls

The unit charged to quota is not raw provider tokens. It is weighted token units.

### Token quota formula

Each usage entry has:

- `providerKey`
- `modelKey`
- `modelRole`
- `inputTokens`
- `cachedInputTokens`
- `outputTokens`
- `totalTokens` when exposed by the provider

The accounting service resolves the matching provider/model cost profile and computes:

```text
weightedTokenUnits =
  max(inputTokens - cachedInputTokens, 0) * inputTokenWeight
+ cachedInputTokens * cachedInputTokenWeight
+ outputTokens * outputTokenWeight
```

If a provider reports `totalTokens` but not a reliable input/output split, PersAI may use a conservative fallback profile for that model and write the reason into event metadata.

If provider usage is missing completely, PersAI may use the existing `chars_div_4_ceil_v1` estimator as a fallback only. Estimator-based events must be marked as estimated so admin reconciliation can distinguish them from provider-metered usage.

### Provider/model cost profiles

Provider/model token weights belong in the global runtime provider settings surface (`Admin > Runtime`).

The existing model catalog shape should be extended from plain model id lists toward model profile rows. A model profile should support, at minimum:

- provider key (`openai`, `anthropic`, future providers)
- model key
- capabilities (`chat`, `image`, `video`, and future categories)
- input token weight
- cached input token weight
- output token weight
- optional display label
- optional notes
- optional provider price metadata for admin reference

The weight profile is quota policy, not an invoice. It converts heterogeneous provider usage into PersAI quota units. The values can intentionally include margin, operational overhead, or risk buffers.

`Normal reply`, `Premium reply`, and `Reasoning` remain routing/model-role concepts. They should show an effective token-cost preview in `Admin > Runtime`, but their cost comes from the selected model profiles, not from separate mode-only coefficients.

### Token quota limits

Plan rows continue to own how many token units a workspace receives in a subscription period. The existing `quotaAccounting.tokenBudgetLimit` concept remains the plan-level limit.

The value now means weighted token units, not raw provider tokens.

Token/Credits usage must reset on the same billing-period boundary as every other paid subscription quota. The reset boundary is not token-specific UI state and not a daily counter; it is the effective workspace billing period.

User-facing plan visibility should continue to show one percentage:

```text
weightedTokenUnitsUsed / tokenBudgetLimit
```

Admin surfaces may show raw and weighted values.

### Token over-limit behavior

When weighted token budget is exhausted:

- inbound enforcement may allow a degraded turn using the configured cheaper fallback model
- the runtime/API should mark the turn as quota-degraded in transport metadata
- if no safe fallback route is available, the turn is blocked with a clear quota message

This preserves the current product direction: text can often degrade gracefully; expensive media generation cannot.

## Media monthly limits

### Scope

These tools move from daily quota enforcement to monthly plan limits:

- `image_generate`
- `image_edit`
- `video_generate`

The old daily limit language and enforcement must be removed from the active product path for these media tools.

Per-turn caps remain valid. A per-turn cap protects the runtime/model loop from one turn asking for too many outputs. It is not a billing-period quota.

### Per-tool monthly counters

The first target-state shape is separate monthly limits per tool:

- monthly `image_generate` units
- monthly `image_edit` units
- monthly `video_generate` units

This matches the current Admin Plans mental model where media generation/editing are plan features and are naturally counted by units, not by token economics.

`image_generate` unit count equals delivered image count.

`image_edit` unit count equals delivered edited image count. If future providers return multiple edited images in one call, each delivered image is one unit unless plan policy later defines a different weight.

`video_generate` unit count equals delivered video count in the first version. Future ADRs or follow-up slices may add duration/quality weights if provider economics require it.

### Subscription period

Monthly media limits must be tied to the workspace billing period, not to a rolling day.

This period is a shared billing primitive for all paid recurring quota, not only media:

- Credits / weighted token budget
- monthly image generation, image edit, and video generation limits
- future paid usage limits
- renewal/reset visibility
- future billing-provider events, renewal reminders, failed-payment notifications, push reminders, and subscription lifecycle automation

Daily counters may remain only for true day-scoped safety/rate-limit controls. They must not be used as the reset truth for paid plan quota.

Target period resolution:

1. Use `WorkspaceSubscription.currentPeriodStartedAt` and `currentPeriodEndsAt` when present.
2. If a workspace has no subscription period yet, use the effective plan's period policy fallback.
3. For local/dev/manual trials without provider periods, use a calendar-month UTC fallback only as a deliberate compatibility fallback.

Paid production workspaces should have explicit subscription periods before money is accepted.

When a new billing period starts, period-scoped counters must reset by naturally writing into a new period bucket or by recomputing period usage from events. Do not mutate historical usage events to fake a reset.

## Delivery-confirmed media accounting

### Charge point

Media monthly quota is charged only after successful user-visible delivery, except for explicit user Stop after generated artifacts already returned from runtime. In that explicit user-stop case, PersAI treats the generated artifacts as user-caused provider cost and settles the reserved units even if delivery was not committed.

For web chat, successful delivery means:

- a chat attachment row was persisted for the assistant message
- the attachment is linked to a canonical `AssistantFile` when a `fileRef` exists
- the response returned to the client includes the attachment state or the committed message history can show it

For Telegram and future external channels, successful delivery means:

- the channel adapter successfully sent the media to the target channel, and
- PersAI persisted the corresponding canonical message/attachment state needed for audit and replay

Files persistence alone is not enough to charge media generation quota if the requested product action was "generate/send this to me" and the chat/channel did not receive it.

### Provider cost vs user quota

Provider cost and user quota are separate facts.

A provider may charge PersAI even if PersAI fails to deliver the artifact to the user. In that case:

- do not consume user-visible media quota
- record an admin reconciliation event with enough metadata to investigate provider cost leakage
- keep any recoverable artifact in canonical Files only if the product can make it visible/retryable without surprising the user

The platform may later add automatic retry, but this ADR does not require retry delivery as the first implementation.

### Reservation

PersAI may reserve media quota before starting a provider call to prevent obvious over-limit abuse and concurrent double-spend. A reservation is not final user charging.

Reservation semantics:

- reserve before provider execution when enforcing monthly media limits
- settle the reservation after delivery success, or after explicit user Stop when generated artifacts already exist
- release or expire reservation on provider failure, timeout, runtime interruption, delivery failure, passive disconnect, or client-aborted turns without generated artifacts
- write reconciliation metadata when provider cost likely happened but user quota was released

The implementation may choose a direct check-then-settle flow for the first slice if concurrency is controlled, but the target state should support reservations because media generation is expensive and long-running.

### No hidden charge on timeout

Timeout, stream stall, passive client disconnect, provider error, failed artifact download, failed validation, failed chat attachment persistence, or failed channel adapter delivery must not consume final media quota.

Explicit user Stop is different from passive disconnect. If the user explicitly stops after the media provider work has produced artifacts, PersAI may settle the reserved media units because provider cost was user-caused. If no artifact exists yet, or the failure is server/provider/delivery-caused rather than explicit user stop, quota follows the no-delivery reconciliation/release rule.

If the assistant text claimed that media was sent but delivery failed, the existing delivery-honesty correction remains required. Quota accounting must follow the same truth: no delivered artifact, no media quota charge.

## Data model direction

The implementation should add period-scoped quota primitives instead of extending the existing daily counter table.

Recommended target entities or equivalent persistence:

### Model cost profiles

Provider/model token cost profiles can be stored in the existing `platform_runtime_provider_settings` JSON boundary, most likely by extending `available_model_catalog_by_provider` from plain model lists to structured model profile rows.

The code should preserve contracts-first typing so admin UI, API validation, materialization, and quota accounting agree on the profile shape.

### Token usage events

`WorkspaceQuotaUsageEvent` should continue to exist, but token events need richer metadata or companion rows:

- raw input tokens
- raw cached input tokens
- raw output tokens
- weighted token units
- provider key
- model key
- model role
- usage source (`provider_metered`, `estimated_fallback`, `mixed`)
- turn/client identifiers where available

Credits/token budget usage is stored in `workspace_token_budget_period_counters` keyed by workspace and effective period boundaries. `WorkspaceQuotaAccountingState.tokenBudgetUsed` remains a compatibility snapshot of the current period, not lifetime billing truth.

### Media period usage

Add a period-scoped media/tool quota ledger. The exact table name can be chosen during implementation, but the model should include:

- workspace id
- assistant id when applicable
- user id when applicable
- plan code/effective subscription source
- subscription period start/end
- tool code (`image_generate`, `image_edit`, `video_generate`)
- reserved units
- settled/delivered units
- released units
- status (`reserved`, `settled`, `released`, `expired`, `reconciliation_required`)
- turn/client identifiers
- artifact ids / file refs / attachment ids where available
- provider/model metadata where available
- created/updated timestamps

Do not reuse `WorkspaceToolUsageDailyCounter` for monthly media enforcement. It is day-keyed by design and encodes the wrong product semantics.

## API and runtime boundary

### Runtime to API token accounting

Runtime already returns `usageAccounting` in turn results. API quota accounting should consume that provider-metered usage instead of estimating token usage from final text.

The API owns quota persistence and enforcement. Runtime should not directly mutate workspace quota tables.

### Runtime media generation

Runtime media tools should no longer call `consumeToolDailyLimit` before provider execution for `image_generate`, `image_edit`, or `video_generate`.

Instead, the flow should become:

1. API/runtime checks monthly media availability before exposing or executing media tools.
2. Runtime executes the provider call and persists artifacts as canonical runtime outputs/Files as it does today.
3. API receives media artifacts, attempts delivery, and knows the final delivered attachment count.
4. API settles monthly media quota for delivered artifacts only.
5. API writes reconciliation events for provider-cost/no-delivery cases.

This keeps user quota truth at the same boundary that knows whether the user actually received media.

### Internal endpoints

The existing internal tool quota endpoint is daily and named accordingly. It should not be expanded with hidden monthly behavior for media tools.

Add or replace internal/API services with names that reflect the target semantics, for example:

- `checkMonthlyMediaToolQuota`
- `reserveMonthlyMediaToolQuota`
- `settleDeliveredMediaToolQuota`
- `releaseMonthlyMediaToolQuota`

Exact route names are implementation detail, but the boundary must not pretend monthly delivery-confirmed accounting is the same thing as daily pre-call counting.

## Admin UI direction

### `Admin > Runtime`

Add provider/model cost profiles under runtime provider settings.

The UI should let admins edit token weights for each model profile:

- input
- cached input
- output

The Early Smart Router section can show an effective cost preview for:

- Normal reply
- Premium reply
- Reasoning

That preview should display the selected model and its token weights. It should not be a separate source of quota truth.

### `Admin > Plans`

Move image/video/edit billing-period controls into plans:

- monthly image generation units
- monthly image edit units
- monthly video generation units

Remove daily cap editing/enforcement for those media tools from the active product path.

Keep per-turn cap controls where useful; label them as per-turn safety limits, not billing quota.

### User UI

User sees:

- one credit budget metric
- quiet info text explaining that token usage reflects all model work needed for answers
- media generation unavailable/limit-reached messages when monthly media quota is exhausted

The user should not see raw provider economics.

## Implementation plan and status

This ADR should be implemented in large, reviewable slices. Do not split into tiny UI-only or API-only sessions unless a slice becomes too large to verify safely.

| Slice                                   | Status    | Purpose                                                                                            | Main affected areas                                                                                                                                                          | Completion criteria                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | --------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Audit and target-state ADR           | Completed | Lock billing quota policy before code changes.                                                     | `docs/ADR/082-*`, Billing Readiness Audit canvas, quota/media/runtime code audit                                                                                             | ADR accepted; current estimator token path, pre-delivery media daily charging, and `MediaDeliveryService` delivery boundary documented.                                                                                                                                                                                              |
| 2. Provider/model token profiles        | Completed | Make `Admin > Runtime` own typed provider/model quota profiles before accounting changes.          | `packages/contracts/openapi.yaml`, generated contracts, `apps/api` runtime-provider settings validation, `apps/web/app/admin/runtime/page.tsx`, provider/model catalog types | Existing plain model id lists migrate or normalize into profile rows with `inputTokenWeight`, `cachedInputTokenWeight`, and `outputTokenWeight`; Admin Runtime shows token-weight previews from selected model profiles; API rejects invalid weights.                                                                                |
| 3. Weighted token accounting            | Completed | Replace estimator-first token quota with provider-metered weighted usage.                          | `apps/api` quota accounting services, web chat turn completion, runtime result handling, provider `usageAccounting`, quota visibility                                        | Completed turns sum all `usageAccounting.entries`; OpenAI/Anthropic profiles can differ; cached input uses cached weight; estimator fallback is explicit and marked as estimated; user sees one Credits metric.                                                                                                                      |
| 4. Monthly media quota model            | Completed | Add subscription-period plan limits and counter truth for media generation/editing.                | Prisma schema/migrations, quota repositories/services, `Admin > Plans`, contracts, user/admin plan visibility                                                                | Plans expose monthly `image_generate`, `image_edit`, and `video_generate` unit limits; `workspace_media_monthly_quota_counters` is period-scoped from `WorkspaceSubscription.currentPeriodStartedAt/currentPeriodEndsAt` with documented UTC calendar-month fallback; user/admin visibility can read the monthly allowance snapshot. |
| 5. Delivery-confirmed media settlement  | Completed | Charge media quota only when the user actually receives delivered media.                           | `apps/runtime` media tool execution, API internal quota services, `MediaDeliveryService`, web/Telegram delivery paths, reconciliation/audit events                           | Runtime no longer pre-consumes daily quota for media tools; API reserves monthly quota before provider work, settles monthly quota after delivered attachments/channel sends, and releases or reconciles no-delivery outcomes without charging user quota.                                                                           |
| 6. Product cleanup and launch hardening | Completed | Remove obsolete daily-media language and close billing-readiness gaps introduced by the migration. | Tool catalog prompts, Admin Plans labels, user quota copy, ops/admin visibility, docs/tests                                                                                  | Active UI no longer presents media generation/edit as daily paid quota; Settings shows monthly media allowances; Admin Plans treats daily caps as day-scoped safety controls and media paid usage as delivery-confirmed monthly quota; docs/handoff/changelog reflect final state.                                                   |
| 7. Production risk closure              | Completed | Close launch blockers found after Slice 6 review.                                                  | Credits/token quota persistence, quota snapshots, sync/stream web delivery, Telegram delivery                                                                                | Credits/token budget uses period-scoped counters tied to the same effective period as monthly media; generated media reservations are marked reconciliation-required when API receives artifacts but delivery is not reached or completed.                                                                                           |

### Execution rules for future sessions

- One session should normally complete exactly one slice.
- Slice 2 through Slice 7 are completed.
- Future work must not reintroduce daily media quota as paid billing truth.
- Do not preserve OpenClaw compatibility or filesystem-owned session state.
- Do not hide monthly media behavior behind the existing daily endpoint names.
- If docs and code disagree, stop and reconcile docs first.

### Prompt for a new session

Use this prompt when opening a fresh session for the next implementation slice:

```text
Continue PersAI billing readiness from ADR-082.

Read in order before coding:
1. AGENTS.md
2. docs/SESSION-HANDOFF.md
3. docs/CHANGELOG.md
4. docs/ADR/082-billing-quota-and-delivery-confirmed-media-accounting.md
5. docs/ARCHITECTURE.md
6. docs/API-BOUNDARY.md
7. docs/DATA-MODEL.md
8. docs/TEST-PLAN.md

Current active item: ADR-082 is completed through Slice 6.

Goal:
If continuing billing readiness, move to the next founder-selected ADR:
- ADR-083 subscription lifecycle/trial/fallback/billing ops, or
- ADR-084 billing provider readiness/pricing/checkout/payment tools.

Keep provider/model profiles in Admin > Runtime, not plan rows. Plans continue to own only quota limits such as token budget and media allowances.

ADR-082 invariant to preserve:
- token budget is weighted provider/runtime Credits
- monthly media quota is subscription-period and delivery-confirmed
- daily tool counters are safety/rate-limit state only, not paid media quota truth

Out of scope for this session:
- billing provider/payment integration
- reworking completed ADR-082 accounting mechanics unless a production defect is found

Before ending:
- read the chosen ADR and its handoff/changelog context
- run focused checks for changed code
- run AGENTS verification gates when code/contracts changed
- update docs/SESSION-HANDOFF.md and docs/CHANGELOG.md
```

## Verification requirements

Focused checks should prove:

1. Token accounting uses provider `usageAccounting.entries` when available.
2. Token accounting falls back to estimator only when provider usage is missing and marks the event as estimated.
3. Multiple model calls in one turn are summed into one user-visible token budget metric.
4. Cached input tokens use the cached input weight, not the full input weight.
5. OpenAI and Anthropic entries can resolve different model cost profiles.
6. Image generation/edit/video generation no longer consume daily quota before provider execution.
7. Monthly media limit checks block over-limit media generation before expensive provider work.
8. Delivered media settles quota only for attachments/channel deliveries that actually succeeded.
9. Provider success followed by delivery failure does not charge user quota and creates an admin reconciliation signal.
10. Stream timeout/client abort after provider-side media cost does not charge user media quota unless delivery was committed.
11. User plan visibility still shows one token/credit budget metric.
12. Admin visibility can inspect raw vs weighted token usage and media reconciliation events.

## Non-goals

- No direct billing provider integration in this ADR.
- No invoices, tax, payments, checkout, customer portal, or webhook processing.
- No per-customer custom pricing.
- No exposing raw provider cost math to ordinary users.
- No retaining daily image/video/edit quota as active product truth.
- No charging users for media they did not receive.

## Consequences

### Positive

- Token quota becomes economically meaningful across providers and models.
- The user still sees one simple quota metric.
- Media billing becomes defensible: no delivery, no media quota charge.
- Admins can tune provider/model weights without editing plan rows.
- Plans can express monthly media allowances in product language.

### Negative

- Quota accounting becomes more complex because raw provider usage, weighted quota units, provider cost, and delivered user value are separate facts.
- Media generation may need reservation/settlement logic to avoid concurrency bugs.
- Existing tests and UI copy that assume daily media caps must be rewritten.
- Historical quota rows remain semantically different from new period-scoped usage.

## Current code audit notes

Historical implementation observations that this ADR intentionally changes or has changed:

- Slice 3 changed `TrackWorkspaceQuotaUsageService.recordInboundTurnUsage` so completed native turns use weighted runtime/provider `usageAccounting.entries`, with `chars_div_4_ceil_v1` only as marked fallback.
- Production risk closure added `WorkspaceTokenBudgetPeriodCounter` / `workspace_token_budget_period_counters`; token budget events now carry period boundaries and plan visibility reads the current period counter instead of lifetime workspace state.
- Slice 5 changed `RuntimeImageGenerateToolService`, `RuntimeImageEditToolService`, and `RuntimeVideoGenerateToolService` to reserve monthly media quota before provider execution instead of consuming daily media quota.
- Slice 4 added `WorkspaceMediaMonthlyQuotaCounter` for subscription-period media allowance truth; Slice 5 now mutates it through reserve, settle, release, and reconciliation-required operations. `WorkspaceToolUsageDailyCounter` remains day-keyed and cannot represent paid media billing periods.
- `MediaDeliveryService.deliver` is the API-side point that settles delivered monthly media units or marks provider-output/no-delivery cases for reconciliation.
- Sync web, stream web, and Telegram delivery flows now call the media reconciliation guard if runtime returned generated artifacts but the delivery boundary was not reached or completed.
- `applyFinalDeliveryHonestyCorrection` already treats attempted and delivered artifact counts separately for response truth.
- Slice 2 changed `platform_runtime_provider_settings.available_model_catalog_by_provider` into typed provider/model profile rows with capabilities and token quota weights.
