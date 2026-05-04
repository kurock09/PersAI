# ADR-083: Subscription lifecycle, trial fallback, renewal notifications, and billing ops

## Status

Accepted; implementation completed through Slice 7.

Current continuation state:

- **Completed through:** Slice 7 — billing provider integration readiness.
- **Next active item:** ADR-084 Slice 3 — payment intent and provider port.
- **Production posture:** no transitional or legacy billing lifecycle mode. Every workspace must always resolve to one clear effective state and plan.
- **Primary admin surface:** `Admin > Ops Cockpit` for user/workspace subscription inspection and support actions; `Admin > Plans` for plan-level trial/fallback policy; a future admin billing/settings surface may own global lifecycle settings.

## Date

2026-05-03

## Relates to

ADR-024, ADR-025, ADR-026, ADR-027, ADR-028, ADR-029, ADR-030, ADR-039, ADR-040, ADR-050, ADR-051, ADR-077, ADR-082

## Context

ADR-082 makes quota accounting suitable for paid usage: Credits/token budget becomes period-scoped and provider-weighted, media generation becomes monthly and delivery-confirmed, and the subscription billing period becomes the shared reset boundary for paid recurring quota.

That is necessary but not sufficient for a production billing launch. PersAI also needs a clear subscription lifecycle:

- what a new user gets after registration
- how trial plans end
- how a user moves from trial to paid
- what happens when trial ends without payment
- what happens when a paid subscription fails to renew
- how long paid access remains during payment recovery
- how the user is warned before trial end, renewal, failed payment, grace end, and fallback
- how admins understand and repair subscription state without reading raw database rows

The current admin surfaces already have plan catalog, plan overrides, workspace subscription controls, quota visibility, and Ops/Business cockpits. The missing product truth is the lifecycle policy that ties those pieces into one production subscription state machine.

Founder decisions for this ADR:

- registration should enter the product through a real plan state, normally trial when enabled
- trial plans must define which plan the workspace falls back to when trial ends without payment
- the trial fallback plan is selected by the admin in the trial plan card, not hard-coded to Free
- paid subscription renewal failures use a global grace period setting
- during grace, paid access and paid limits remain active
- trial/renewal notifications are admin-configurable
- email is required for billing/trial notifications
- assistant push/Telegram notification is optional when the user has an assistant notification channel
- assistant push may be LLM-written, but must follow strict guardrails and required billing facts
- Ops Cockpit top table should stay overview-only; detailed plan, lifecycle, quota, and actions belong in the selected user/workspace detail area
- design for production now, not a legacy compatibility layer

## Decision

PersAI will implement a production subscription lifecycle with explicit states, billing-period truth, admin-configurable notifications, and admin-friendly operations.

Core decisions:

1. Every workspace always has an effective subscription outcome: trial, paid, grace, free/fallback, cancelled/expired with fallback, or admin override.
2. New registrations use the configured registration/default plan. If that plan is a trial plan, the trial receives a real period start/end immediately.
3. Trial plans must carry an admin-selected fallback plan for trial expiry without payment.
4. Paid subscription renewal failure enters a global grace period.
5. During grace, the user keeps paid access and paid limits until grace expires.
6. After grace expires without recovery, the workspace falls back to the configured fallback/free plan.
7. When payment recovers, the workspace returns to the paid plan, receives a fresh provider billing period, and paid recurring quotas reset on that period boundary.
8. Billing/trial lifecycle notifications are scheduled from subscription period facts, not ad hoc UI timers.
9. Admin Ops Cockpit becomes the primary support surface for understanding and repairing a user/workspace subscription state.

## Lifecycle states

### Registration

On registration, PersAI assigns the configured default registration plan.

If the default plan is a trial plan:

- create or resolve a workspace subscription state with `trialing` semantics
- set `currentPeriodStartedAt`
- set `currentPeriodEndsAt` to the trial end date
- set the plan's configured trial fallback plan as the fallback target
- expose trial end in user and admin visibility

If the default plan is not a trial plan:

- resolve the configured free or paid default according to admin policy
- still ensure the workspace has an effective plan and clear quota boundaries

### Trial

Trial is not a fake state. It is a real plan period with real limits.

Trial workspaces receive the trial plan's:

- Credits/token budget
- active chat cap
- storage/knowledge limits
- enabled Skills limit
- media limits when enabled by the plan
- model/runtime tier policy
- notification lifecycle schedule

Trial end without payment does not leave the workspace unconfigured. It falls back to the trial plan's configured fallback plan.

### Trial to paid

When the user pays before trial end:

- billing provider subscription becomes the source of paid period truth
- paid plan becomes the effective plan
- `currentPeriodStartedAt/currentPeriodEndsAt` are updated from the provider period
- paid recurring quotas reset on the paid period boundary
- trial fallback policy no longer applies while the paid subscription is active

### Trial expiry without payment

When trial expires and no paid subscription exists:

- workspace moves to the trial plan's selected fallback plan
- user-visible status becomes trial expired / fallback active
- paid/trial-only features are reduced according to the fallback plan
- no workspace should remain in an unconfigured state
- user receives a calm explanation and upgrade path

The fallback plan is selected in the trial plan card. It may be Free or another admin-approved plan.

### Paid renewal success

When billing provider renewal succeeds:

- keep the paid plan effective
- update period start/end from provider truth
- reset paid recurring quota aggregates for the new billing period
- record a lifecycle event for admin/user visibility

### Paid renewal failure

When a paid renewal fails:

- workspace enters `grace`
- paid access and paid limits remain active during grace
- grace duration is global admin policy
- the user receives configured failed-payment and grace-end notifications
- admin Ops Cockpit shows the workspace as paid in grace, not as ordinary paid

Grace is not a free downgrade. It is a payment recovery window.

### Grace expiry without recovery

When grace expires and payment has not recovered:

- workspace falls back to the configured fallback/free plan
- paid access ends
- paid recurring quotas no longer apply
- user receives a clear explanation of the fallback and how to restore paid access
- admin Ops Cockpit records and surfaces the fallback event

### Payment recovery

When payment recovers during or after grace:

- paid plan becomes effective again
- provider period becomes period truth
- paid recurring quotas reset according to the provider billing period
- user and admin lifecycle views show recovery

## Billing-period truth

`WorkspaceSubscription.currentPeriodStartedAt/currentPeriodEndsAt` is the shared period boundary for all paid recurring quota and lifecycle automation.

It drives:

- Credits/token budget reset
- monthly media quota reset
- future paid quotas
- renewal date visibility
- trial end visibility
- next billing date visibility
- failed-payment notification timing
- grace end timing
- future email/push/assistant reminder scheduling

Daily counters are allowed only for true day-scoped safety/rate-limit controls. They must not represent paid plan renewal/reset truth.

## Cross-ADR transition invariants

ADR-083, ADR-084, and ADR-082 must share one strict transition order. Billing, lifecycle, quota, runtime, and notification code must not each invent a separate "current plan" truth.

The production order for paid-sensitive transitions is:

1. trusted payment/provider/admin event is accepted
2. PersAI payment intent or manual payment record is updated when applicable
3. `WorkspaceSubscription` lifecycle state is updated as PersAI-owned truth
4. effective subscription/plan resolution reads the new lifecycle state
5. quota/accounting snapshots use the resolved effective plan and billing period
6. config generation is bumped and assistant/runtime materialization is marked dirty or applied
7. user/admin UI and the next paid-sensitive turn read the resolved PersAI truth
8. notifications are enqueued from lifecycle facts/events

No product surface should treat payment intent, provider state, resolver output, quota snapshot, or materialized runtime config as an independent source of subscription truth.

Materialization is part of the transition, not optional UI polish. After a lifecycle change that affects paid access, limits, or model/runtime policy, the next paid-sensitive turn must see the new effective truth or be held behind a clear activating/retry state.

Notification scheduling is strictly secondary to lifecycle truth. Email, assistant push, Telegram, and admin reminders must be derived from lifecycle events and period facts, not from UI timers, process-local jobs, or raw provider callbacks.

## Plan policy

### Trial plans

Trial plan cards must expose:

- trial enabled
- trial duration
- fallback plan after trial expiry

The fallback plan field is required when a plan is configured as a trial plan.

The fallback plan must reference an active plan that can safely receive expired trial users.

### Paid plans

Paid plan cards may expose plan-specific product limits and model/runtime policy, but grace duration is global in this ADR.

Global grace policy avoids inconsistent user treatment during the first production billing rollout.

### Free/fallback plans

Fallback plans should be normal plans with explicit limits, not hidden hard-coded behavior.

They should be suitable for:

- expired trial users
- cancelled paid users
- failed-renewal users after grace
- admin support fallback

## Notification policy

### Admin-configurable schedule

Billing lifecycle notifications must be admin-configurable.

Target notification moments include:

- before trial end
- on trial end/fallback
- before renewal
- on renewal success when useful
- on renewal failure
- before grace expiry
- on grace expiry/fallback
- on payment recovery

The implementation can start with a compact configurable schedule, but the target state is not hard-coded `7/3/1` day logic.

### Channels

Email is required for billing/trial lifecycle notifications.

Assistant push/Telegram is optional and sent only when:

- the user has a configured assistant notification channel
- admin policy allows assistant lifecycle notifications
- the event is appropriate for assistant delivery

If assistant push is unavailable, email remains the required channel.

### Assistant-generated billing messages

Assistant push may be LLM-generated, but only with strict guardrails.

Required guardrails:

- system-provided facts are authoritative
- the model must not invent price, plan, renewal, payment, or support details
- required facts must be included exactly: plan name, relevant date, status, and next action
- tone may be personalized to the assistant, but the legal/commercial meaning must remain fixed
- generation output must be short and calm
- failed generation falls back to a safe static template

Billing email may use templates first. Later, LLM-assisted copy can be added only if the same required-facts guardrails apply.

## Admin Ops Cockpit direction

`Admin > Ops Cockpit` should become admin-friendly for subscription support.

### Layout

The Ops page should use the available width instead of keeping the core blocks cramped.

The top `User Directory` table should be an overview/search table, not a full billing spreadsheet.

Recommended top table columns:

- Email
- Plan
- Status
- Next billing / trial end
- Short usage risk
- Actions

Remove low-value columns from the top overview:

- Assistant
- Gender
- Published

Those details can remain elsewhere if useful, but they are not the primary billing/support scan.

### Selected user/workspace detail

The lower detail area should show the operational truth for the selected user/workspace:

- current plan
- plan source
- subscription status
- trial start/end
- paid period start/end
- next billing date
- grace state and grace end
- fallback plan
- admin override state
- billing provider status when connected
- Credits used/limit/current period
- active chats used/limit
- media monthly usage/limits
- storage/knowledge usage/limits
- enabled Skills limit
- notification channels
- latest billing lifecycle events
- latest notification delivery outcomes

### Admin actions

The first production surface should support all required support actions, not a temporary subset:

- apply/change plan
- reset to fallback/free
- extend trial
- grant or extend grace
- send billing reminder
- open user/workspace details
- clear or replace admin override when needed

Actions must write audit/lifecycle events.

## Data model direction

The exact table names can be chosen during implementation, but the model needs first-class lifecycle truth.

Recommended persisted concepts:

### Subscription lifecycle state

Extend or complement `WorkspaceSubscription` with:

- effective lifecycle status
- trial start/end
- trial fallback plan code
- grace start/end
- fallback reason
- billing provider subscription id/status
- last renewal attempt outcome
- current period start/end
- cancellation/end state

### Global billing lifecycle settings

Persist admin-owned global settings for:

- grace period duration
- notification schedule
- enabled notification channels
- assistant notification policy
- default billing support copy/links

### Lifecycle events

Persist append-only events for:

- trial started
- trial warning sent
- trial expired
- fallback applied
- paid subscription started
- renewal succeeded
- renewal failed
- grace started
- grace warning sent
- grace expired
- payment recovered
- admin plan change
- admin trial extension
- admin grace extension
- admin reminder sent

Events should be visible in admin detail views and usable for future support/audit.

### Notification outbox integration

Lifecycle notifications should use a durable notification/outbox path, not process-local timers.

Email delivery and assistant push/Telegram delivery can use separate adapters, but the scheduling truth should be one lifecycle event/notification plan.

## API and boundary direction

`apps/api` owns subscription lifecycle truth.

Billing provider integrations should sync external provider truth into PersAI state, but provider state must not be read directly by product surfaces at request time.

Product and admin UI should read PersAI-resolved lifecycle state:

- effective plan
- lifecycle status
- current period
- next billing/trial end
- grace/fallback state
- quota snapshots
- notification/audit events

Runtime should not own subscription lifecycle state. Runtime receives effective limits and model/runtime policy from API/materialized state.

## Implementation plan and status

Implement in production-grade slices.

| Slice                                         | Status    | Purpose                                                                                               | Main affected areas                                                                        | Completion criteria                                                                                                                                                                                           |
| --------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. ADR and lifecycle policy                   | Completed | Lock target-state lifecycle decisions before code.                                                    | `docs/ADR/083-*`, handoff, changelog                                                       | ADR accepted with trial fallback, global grace, notification, and Ops Cockpit decisions.                                                                                                                      |
| 2. Plan lifecycle policy fields               | Completed | Make trial fallback and plan lifecycle policy editable and persisted.                                 | `Admin > Plans`, plan contracts, API plan management, plan visibility                      | Trial plans require a fallback plan; plan reads/writes preserve fallback policy; invalid fallback references are rejected.                                                                                    |
| 3. Subscription lifecycle state machine       | Completed | Ensure every workspace resolves to a clear lifecycle outcome.                                         | `WorkspaceSubscription`, effective subscription resolution, lifecycle services, tests      | Registration/trial/paid/grace/fallback/recovery states resolve deterministically; no workspace remains unconfigured.                                                                                          |
| 4. Billing-period quota reset foundation      | Completed | Tie paid recurring quota snapshots to subscription period truth.                                      | quota accounting, subscription period handling, user/admin visibility                      | Credits and future paid quotas use the effective billing period boundary rather than all-time counters or daily counters.                                                                                     |
| 5. Notification settings and lifecycle outbox | Completed | Schedule email and optional assistant push around trial/renewal/grace events.                         | notification policy, email adapter boundary, assistant notification outbox, admin settings | Admin-configured schedules create durable notification work; email is required; assistant push uses required-facts guardrails with static fallback.                                                           |
| 6. Ops Cockpit billing support UX             | Completed | Make Ops Cockpit useful for real subscription support.                                                | `Admin > Ops Cockpit`, admin APIs/contracts, lifecycle events, quota detail views          | Top table is compact and full-width; selected detail shows plan/lifecycle/quota/notification truth; support actions write audit events.                                                                       |
| 7. Billing provider integration readiness     | Completed | Prepare clean integration points for provider checkout/webhooks without changing lifecycle semantics. | billing provider port/adapter, sync services, webhook handlers when introduced             | Trusted provider/admin payment inputs are snapshotted first, then applied through the lifecycle state machine so effective plan, quota, materialization, and notifications keep one PersAI-owned truth chain. |

### Execution rules

- Do not build a hidden legacy mode.
- Do not leave a user/workspace without an effective plan.
- Do not hard-code Free as the only trial fallback.
- Do not hard-code notification intervals as product truth.
- Do not let billing provider state bypass PersAI lifecycle resolution.
- Do not use daily counters for paid renewal/reset semantics.
- Keep ordinary user copy calm and simple; keep admin detail complete.

### Slice 3 implementation note

Slice 3 now owns a production subscription lifecycle state machine foundation. Effective
subscription resolution materializes a `WorkspaceSubscription` from the active default registration
plan when no workspace subscription exists. If the default plan is a trial, the resolver writes real
trial/current-period start and end timestamps from the plan-owned trial duration, appends
`trial_started`, and stores the plan-owned fallback truth.

Expired trial subscriptions resolve through the trial plan's
`lifecyclePolicy.trialFallbackPlanCode`: the resolver validates that fallback plan is active,
updates the workspace subscription to `expired_fallback`, appends `trial_expired` and
`fallback_applied`, and marks workspace assistants dirty so materialization/runtime-sensitive paths
see current subscription truth.

Paid renewal failure, grace expiry, and payment recovery now run through a dedicated lifecycle
service. Grace duration and the global fallback plan are persisted in admin-owned billing lifecycle
settings. Paid plans may also define `lifecyclePolicy.paidFallbackPlanCode`; grace expiry uses that
plan-level fallback first and falls back to the persisted global fallback. Lifecycle transitions
append durable subscription lifecycle events and never hard-code Free, grace duration, or plan
codes.

### Slice 4 implementation note

Slice 4 now makes the billing period the foundation for paid recurring quota snapshots and
enforcement. Credits/token budget and monthly media quota paths share one recurring period resolver:
`WorkspaceSubscription.currentPeriodStartedAt/currentPeriodEndsAt` wins when present and valid,
including payment-recovery periods created by Slice 3; UTC calendar-month fallback is used only when
subscription period truth is absent.

Current-period Credits reads now use `workspace_token_budget_period_counters` for user visibility,
inbound token-budget enforcement, abuse quota-pressure decisions, Ops Cockpit quota detail, and
Business Cockpit quota-pressure distribution. `WorkspaceQuotaAccountingState.tokenBudgetUsed` remains
a compatibility/current-period mirror updated by token writes, but paid-sensitive reads no longer use
it as independent reset truth.

### Slice 5 implementation note

Slice 5 now persists admin-owned lifecycle notification policy in Billing Settings. Email is required
policy truth, assistant push is optional, and rule enablement/offsets are stored with the settings row
rather than treated as code-only product constants.

Lifecycle transitions now derive durable notification work from append-only
`workspace_subscription_lifecycle_events`. `billing_lifecycle_notification_jobs` stores required email
jobs and optional assistant-notification jobs with dedupe keys, schedule times, static required-facts
copy, and enqueue/delivery status. Assistant push uses the existing `assistant_notification_outbox`
with source `billing_lifecycle`; email jobs remain pending until a real email adapter is introduced,
so the system does not pretend provider delivery happened before ADR-084/provider work exists.

### Slice 6 implementation note

Slice 6 makes `Admin > Ops Cockpit` a billing support surface instead of only an assistant/runtime
operator panel. The top user directory now shows compact support columns: email, effective plan,
billing status, next relevant trial/grace/current-period date, usage risk, and actions.

The selected detail now reads PersAI-owned support truth from `workspace_subscriptions`,
`workspace_subscription_lifecycle_events`, `billing_lifecycle_notification_jobs`, and current quota
period snapshots. It exposes subscription windows, provider support refs, latest lifecycle events, and
latest notification jobs without consulting billing-provider state directly at request time.

Post-slice live-test hardening closed the admin access and UI safety gaps found before handoff:
Billing Settings is explicitly registered with Clerk bearer middleware, the Ops user directory and
per-user reapply path enforce admin authorization, per-user reapply failures are surfaced in the UI,
and workspace subscription assignment no longer forces `status=active` so trial plans can apply the
service-owned trial defaults and fallback validation.

Slice 6 is now fully action-capable for real support work. `Admin > Ops` exposes dedicated admin
actions for extend trial, grant grace, extend grace, send billing reminder, apply fallback now, and
restore paid manually when the existing lifecycle history can safely supply the prior paid plan and
period shape. These actions write through the PersAI lifecycle/subscription services, append
`source=admin` lifecycle history, refresh the selected support detail immediately, and do not create
an admin-only second source of billing truth. Manual reminder work is created from lifecycle history
into the existing durable notification job pipeline instead of bypassing it with UI-local behavior.
For legacy assistants that still resolve only through the old assistant quota-plan fallback and have
no real `WorkspaceSubscription`, Ops now also exposes an explicit admin normalization action that
initializes lifecycle truth from the current registration policy using the current time. That action
creates the first real subscription row, clears the stale legacy fallback pointer, and makes the user
testable through the normal trial/grace/fallback support path.

### Slice 7 implementation note

Slice 7 adds an internal billing-event readiness layer ahead of concrete provider webhooks or checkout.
Trusted provider/admin/manual payment inputs are now recorded in
`workspace_subscription_billing_events` with apply status before they mutate
`workspace_subscriptions`.

Provider sync no longer deletes local subscription truth when the provider returns no snapshot. Instead,
provider/admin paid-state changes are normalized into PersAI lifecycle transitions:

- paid activation and renewal success update the workspace through the same active-paid lifecycle path
- renewal failure reuses `renewal_failed` -> `grace_started`
- payment recovery reuses `payment_recovered`
- refund/chargeback-style reversal reuses immediate fallback plus `fallback_applied`

This keeps the ADR-083 transition order intact: trusted payment/provider/admin event -> PersAI billing
event snapshot -> `WorkspaceSubscription` -> effective plan -> ADR-082 quota period -> materialization
/ visibility -> lifecycle-derived notifications.

### Prompt for a future implementation session

```text
Continue PersAI billing readiness from ADR-084.

Read before coding:
1. AGENTS.md
2. docs/SESSION-HANDOFF.md
3. docs/CHANGELOG.md
4. docs/ADR/083-subscription-lifecycle-trial-fallback-and-billing-ops.md
5. docs/ADR/082-billing-quota-and-delivery-confirmed-media-accounting.md
6. docs/ARCHITECTURE.md
7. docs/API-BOUNDARY.md
8. docs/DATA-MODEL.md
9. docs/TEST-PLAN.md

ADR-083 is completed through Slice 7. Continue with the next pending ADR-084 slice instead of reopening ADR-083 unless verification fails or code/docs disagree.

Production rules:
- no transitional or legacy billing lifecycle mode
- every workspace must resolve to trial, paid, grace, fallback/free, cancelled/expired with fallback, or admin override
- trial plans must have an admin-selected fallback plan
- grace period is global
- paid access and limits remain active during grace
- email is required for lifecycle notifications
- assistant push/Telegram is optional and must use required-facts guardrails
- Ops Cockpit top table stays compact; selected detail owns full lifecycle/quota/support truth

Before ending:
- run focused checks for changed code
- run AGENTS verification gates when code/contracts changed
- update docs/SESSION-HANDOFF.md and docs/CHANGELOG.md
- state the next recommended ADR-084 slice
```

## Verification requirements

Focused checks should prove:

1. Trial plans cannot be saved without a valid fallback plan.
2. New trial workspaces receive period start/end and fallback plan truth.
3. Trial expiry without payment applies the configured fallback plan.
4. Paid renewal failure enters global grace and keeps paid access/limits.
5. Grace expiry without recovery applies fallback/free state.
6. Payment recovery restores paid plan and provider billing period truth.
7. Effective subscription resolution never returns an ambiguous/no-plan state for normal product use.
8. Billing-period dates drive paid quota reset visibility.
9. Notification schedules are admin-configurable, not hard-coded product truth.
10. Email notification work is created for required lifecycle events.
11. Assistant push uses required-facts guardrails and static fallback on generation failure.
12. Ops Cockpit top table stays compact while selected detail exposes full plan/lifecycle/quota/support truth.
13. Admin lifecycle actions write audit/lifecycle events.

## Non-goals

- No checkout UI design in this ADR.
- No tax, invoices, receipts, or accounting ledger design.
- No provider-specific webhook implementation details beyond lifecycle integration requirements.
- No ordinary-user exposure of raw billing provider state.
- No legacy subscription fallback mode.
- No replacing ADR-082 quota accounting decisions.

## Consequences

### Positive

- Registration, trial, paid renewal, failed payment, grace, and fallback behavior become predictable.
- Users are not stranded in unconfigured states.
- Admins can support real users without database inspection.
- Future billing provider integration has a clean state machine to update.
- Notification and push work can build on lifecycle truth instead of one-off timers.

### Negative

- Subscription lifecycle becomes a first-class product system, not just plan fields.
- Ops Cockpit must become more opinionated and billing-aware.
- LLM-written assistant billing notifications require strict guardrails and fallback templates.
- Existing subscription sync behavior may need replacement where it deletes or hides local truth too aggressively.

## Current code audit notes

Current implementation observations that this ADR intentionally changes or formalizes:

- `WorkspaceSubscription` already has period fields and provider identifiers, but production lifecycle policy is not yet complete.
- Earlier provider-pull sync experiments treated missing provider state as a local deletion path; the active production billing lifecycle should stay webhook/admin driven so fallback/grace/cancelled truth is never hidden by a no-op provider snapshot pull.
- `ResolveEffectiveSubscriptionStateService` can resolve fallback plan state, but ADR-083 requires an explicit lifecycle state machine and no ambiguous normal product state.
- `Admin > Plans` already owns trial flags/duration and plan limits; it should also own trial fallback plan selection.
- `Admin > Ops Cockpit` already has plan control and workspace subscription controls, but the top table should be compact and the selected detail should own billing support truth.
- Notification infrastructure already exists for assistant/user notifications; billing lifecycle notifications should use durable scheduling/outbox semantics rather than process-local reminders.
