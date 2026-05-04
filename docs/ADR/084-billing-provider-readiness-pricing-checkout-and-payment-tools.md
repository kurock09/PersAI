# ADR-084: Billing provider readiness, pricing page, checkout, and payment tools

## Status

Accepted; implementation completed through Slice 8, with Slice 9 CloudPayments widget-first wiring landed pending live credential validation.

Current continuation state:

- **Purpose:** finish the PersAI-owned billing/provider boundary so only concrete provider adapter wiring remains for YooKassa, CloudPayments, Stripe, or another provider.
- **Completed through:** Slice 8 — assistant billing capability through the existing `quota_status` tool.
- **Next active item:** Slice 9 — live credential validation and final hardening of the concrete provider adapter.
- **Do not implement before:** ADR-082 delivery-confirmed quota accounting and ADR-083 subscription lifecycle foundations are far enough that payment success can safely activate real plan/subscription state.
- **Production posture:** no fake long-term billing mode. Test/manual adapters are for development and admin recovery only.

## Date

2026-05-03

## Relates to

ADR-024, ADR-025, ADR-026, ADR-027, ADR-028, ADR-029, ADR-030, ADR-039, ADR-040, ADR-050, ADR-051, ADR-082, ADR-083

## Context

ADR-082 makes paid quota accounting defensible. ADR-083 defines the subscription lifecycle: registration, trial, paid, grace, fallback/free, notifications, and Ops Cockpit support.

After those pieces, PersAI still needs the payment-provider readiness layer:

- public/user pricing page generated from Admin Plans
- checkout/payment intent owned by PersAI before contacting a provider
- a provider-independent billing port
- webhook ingestion that updates PersAI lifecycle state, not product UI directly
- card and SBP QR payment paths for the first production contour
- customer plan/payment UX in Settings and chat
- assistant billing tool that can explain plans and create payment links/QR only after explicit confirmation
- admin manual payment activation for support/offline cases
- immediate plan activation/materialization after successful upgrade

Founder decisions for this ADR:

- one universal pricing page serves both guests and logged-in users
- pricing cards are generated from `Admin > Plans`; admin chooses which plans appear
- first production payment methods are bank card and SBP QR
- if a guest selected a plan before login, do not force checkout after registration; the user enters trial/system and buys intentionally from inside the product
- after successful payment, return the user to chat with a clear "plan activated" banner
- if payment fails, the assistant should calmly explain and offer retry
- admin can manually mark payment and activate paid access
- assistant billing tool may create payment link/QR only after explicit user confirmation
- upgrades activate immediately; downgrades and cancellation take effect at the end of the current paid period
- refund/chargeback applies immediate fallback/free
- `Admin > Ops > Plan Control` remains tester/admin override and is not billing/subscription truth

## Decision

PersAI will add a provider-ready billing layer that keeps product/subscription truth inside PersAI and treats the payment provider as transport for money movement.

Core decisions:

1. Pricing/tariff cards are generated from selected Admin Plans.
2. Checkout starts by creating a PersAI payment intent.
3. Payment providers receive provider-neutral intent data and return payment sessions, links, or SBP QR payloads.
4. Webhooks update PersAI payment intent and subscription lifecycle state.
5. Product surfaces read PersAI lifecycle state, not raw provider status.
6. Admin Plan Control tester overrides remain separate from billing and invoices.
7. Successful upgrade triggers immediate subscription activation and assistant/runtime materialization.
8. Downgrade and cancellation are scheduled for the current period end.
9. Assistant billing tool can explain plans and create payment links/QR only after explicit confirmation.

## Product flow

### Universal pricing page

There is one pricing page.

For guests:

- show public tariff cards
- selecting a paid plan sends the user to login/registration
- after registration, the user enters the normal product/trial path
- the user can buy/upgrade again intentionally from inside the product

For logged-in users:

- show the same tariff cards
- current plan is marked as current
- free/trial users see connect/upgrade actions
- paid users see upgrade/downgrade/change actions according to policy
- Settings can link to the same page in logged-in mode

The page should not be manually maintained separately from plans.

### Pricing cards from Admin Plans

`Admin > Plans` owns which plans appear on the pricing page.

Plan presentation fields should include:

- show on pricing page
- card order
- public title
- short subtitle
- price label
- billing period label
- highlighted/popular marker
- call-to-action label
- concise feature bullets
- limit highlights derived from real plan limits where possible

For the active PersAI implementation path, these fields should live on the admin plan surface itself (currently persisted in plan billing hints as a dedicated presentation block), so the pricing page reads admin-managed plan truth rather than a separate marketing-only table.

The source plan remains the contract. Marketing text cannot promise features or limits that the plan does not grant.

If four plans are marked visible, the pricing page renders four cards. If fewer or more are visible, the page follows admin selection/order.

### Checkout

When a logged-in user chooses a paid plan:

1. PersAI creates a payment intent.
2. PersAI asks the active billing provider adapter to create a checkout/payment session.
3. The user completes card or SBP QR payment.
4. Provider redirects or webhook reports the result.
5. PersAI updates payment intent and subscription lifecycle state.
6. The user returns to chat with a "plan activated" banner when payment succeeded.

If payment fails:

- preserve the current plan
- show a calm explanation
- let the assistant offer retry
- do not partially activate paid access

### Transition order and sources of truth

Payment integration must update PersAI in one strict order so billing does not split into competing truths:

1. trusted provider/admin payment event
2. PersAI payment intent status
3. ADR-083 `WorkspaceSubscription` lifecycle state
4. effective plan resolution
5. ADR-082 quota/accounting period snapshots
6. config generation bump and assistant/runtime materialization
7. user/admin UI and next paid-sensitive turn visibility
8. lifecycle-derived notifications

Payment intent, provider status, effective resolver output, quota snapshot, and materialized runtime config are not peer sources of truth. They are stages derived from the PersAI subscription lifecycle transition.

If a transition cannot complete materialization before the next paid-sensitive turn, API/runtime should block, await safe apply, or return a clear activation-in-progress state rather than serving stale paid limits/model policy as if activation were complete.

### Upgrade, downgrade, cancellation

Upgrade rule:

- successful upgrade activates immediately
- paid period starts from the successful upgrade/payment moment unless provider proration says otherwise
- paid quotas and runtime/model policy become available immediately
- materialization starts immediately

Downgrade rule:

- downgrade is scheduled for the end of the current paid period
- current paid access remains until period end
- user/admin visibility shows the pending downgrade

Cancellation rule:

- cancellation keeps paid access until the end of the paid period
- at period end, ADR-083 fallback/free applies

Remaining paid period/proration:

- if the billing provider supports proration/credit, PersAI may use it
- if not, PersAI must show clear confirmation that the new plan replaces the current plan immediately
- do not silently discard paid value without explanation

Refund/chargeback:

- provider-reported refund or chargeback immediately applies fallback/free
- admin audit event records the reason
- future recovery requires a new successful payment or admin action
- already consumed paid-period Credits/media are not silently rolled back as quota state in this ADR
- Ops should retain audit/risk context for reversed-payment usage so future finance/support policy can decide whether to mark debt, risk, or audit-only history

## Billing provider boundary

PersAI owns a provider-independent billing provider port.

The port should support:

- create checkout/payment session
- create SBP QR or provider payment link when supported
- create/manage customer portal or manage-payment link
- fetch payment/subscription status when needed
- cancel subscription
- resume subscription when provider supports it
- parse/verify webhook
- map provider events into PersAI payment/lifecycle events

Provider adapters must not directly mutate plan or quota state. They return normalized outcomes to PersAI services.

## PersAI payment intent

Before calling a provider, PersAI creates a payment intent.

The intent should store:

- user id
- workspace id
- selected plan code
- action: upgrade, new purchase, renewal, manual/admin payment, or other supported action
- amount
- currency
- billing period policy
- status
- idempotency key
- return URL
- provider key
- provider session/payment id when available
- selected payment method class, such as card or SBP QR
- expiration
- created/updated timestamps

Payment intents give PersAI auditability even when provider redirects fail or webhooks arrive late.

## Webhooks and lifecycle

Provider webhooks update PersAI state in this order:

1. verify provider signature
2. find or create the matching PersAI payment/subscription event
3. update payment intent status
4. update ADR-083 subscription lifecycle state
5. trigger materialization when effective plan changes
6. enqueue user/admin notifications when needed

Webhook events should be idempotent.

Provider state must not be shown directly as product truth. Product surfaces show PersAI's resolved lifecycle status.

## Manual/admin payments

Admin can manually mark payment and activate paid access for support/offline cases.

Manual activation must:

- require admin authorization
- write audit/lifecycle events
- set plan/subscription period explicitly
- not pretend a provider invoice exists
- show source as manual/admin payment in Ops Cockpit

This supports real-world cases such as invoice/bank transfer or provider outage, without making manual payment the default product flow.

## Plan Control remains separate

`Admin > Ops > Plan Control` remains tester/manual routing override.

It must not:

- create payment intents
- create subscriptions
- affect invoices
- count as provider payment
- hide lifecycle status

When enabled, it is visibly an admin override.

`Reset to normal` returns resolution to the regular chain:

```text
billing/subscription lifecycle -> trial/paid/grace/fallback/free -> effective plan
```

Plan Control is useful for tests and support. It is not billing.

## Immediate activation and materialization

After successful upgrade or admin-paid activation:

1. update subscription lifecycle state
2. resolve the new effective plan
3. bump config generation
4. mark assistant materialization dirty
5. trigger immediate materialization/background apply
6. return the user to chat with an activation banner
7. ensure the next turn uses the new limits/model/runtime policy

If materialization is still running:

- UI may show "plan is activating"
- API should force or await safe apply before the next paid-sensitive turn when possible
- the user should not need to wait minutes or refresh manually

Slice 6 implementation note, 2026-05-04:

- trusted paid-success transitions now trigger immediate assistant rematerialization and runtime/provider warmup for published assistants in the workspace instead of only setting `configDirtyAt`
- the chat return path now reloads server truth from the persisted payment intent / bootstrap boundary so a post-checkout navigation can pick up the newly activated plan without depending on a later random refresh

Slice 7 implementation note, 2026-05-04:

- `Admin > Ops` manual payment support now uses an explicit manual/admin paid activation path with selected paid plan plus selected billing period instead of copying the last paid period implicitly from fallback history
- the action still writes through PersAI lifecycle truth (`source=admin`, `eventCode=payment_activated`) and stores manual-payment context in lifecycle metadata rather than pretending a provider invoice/session exists
- Ops Cockpit now surfaces the latest paid activation source directly, so manual/admin paid activation remains visible as product truth rather than being confused with provider billing

Pre-Slice 8 hardening note, 2026-05-04:

- trusted provider payment activation now tolerates a missing `workspace_subscription` row on first paid success by letting the lifecycle activation path create the row instead of failing early in billing-event apply
- user payment-intent creation now resolves billing truth from the real workspace subscription / default-registration initialization path and explicitly ignores `Admin > Ops > Plan Control` override state so tester overrides do not leak into user billing decisions

Slice 8 implementation note, 2026-05-05:

- PersAI did not add a separate new billing tool; the existing `quota_status` tool now exposes current/public pricing-plan context so the assistant can explain upgrades from the same quota/governance surface it already used for limits
- `quota_status` may now create checkout only after explicit confirmation, and the guarded runtime/API path creates a normal PersAI payment intent plus returns the existing `/app/billing/checkout/:paymentIntentId` path instead of bypassing product checkout state
- the tool still cannot activate subscriptions directly; paid access remains webhook/trusted-server lifecycle truth only

Slice 9 implementation note, 2026-05-05:

- the default billing-provider adapter is now a real `CloudPayments widget-first` adapter: it reads the encrypted API Secret plus widget public terminal id from `Admin > Tools`, returns `checkout.mode=widget`, and builds the widget payload from the persisted PersAI payment intent instead of a temporary `manual_test` session
- `/app/billing/checkout/:paymentIntentId` now launches `cloudpayments.js` from the persisted payment-intent payload and returns the user back to chat with the same `success` / `failed` / `pending` envelope while still waiting for trusted server confirmation before activating paid access
- CloudPayments webhook resolution now accepts widget-style `externalId` plus `metadata/data` in addition to the older `invoiceId` path so widget-originated payments reconcile back to the correct PersAI payment intent
- live provider smoke is still required before this slice can be treated as fully closed in production operations

## Customer UX

### Settings / Plan and Limits

Inside the product, Settings should expose a user-friendly Plan and Limits area:

- current plan
- trial/paid/grace/fallback state
- next payment or trial end
- Credits progress
- active chat limit
- media limits
- storage/knowledge limits
- enabled Skills limit
- upgrade/manage payment entry points

This area should link to the universal pricing page.

### Chat return after payment

After successful payment, return to chat with:

- success banner
- current plan name
- short note that limits/features are activating or already active

If payment fails, return with assistant-readable state so the assistant can explain calmly and offer retry.

## Assistant billing tool

An assistant-facing PersAI billing capability should reuse the existing `quota_status` tool rather than creating a second parallel billing tool surface.

Allowed behavior:

- explain current plan and limits
- compare visible plans from pricing cards
- answer "what changes if I upgrade?"
- ask for explicit confirmation before creating payment
- create payment link or SBP QR after confirmation

Forbidden behavior:

- changing plan without explicit confirmation
- claiming payment success before provider/PersAI confirmation
- inventing price, discount, renewal, or refund details
- bypassing PersAI payment intent
- using admin tester override as payment

The tool should reuse existing tool quota/governance mechanisms where appropriate. It is still a billing-sensitive tool and must be guarded.

## Admin billing settings

A future admin billing/settings surface should own:

- active provider
- provider health/webhook status
- enabled payment methods
- currency
- public return URLs
- support/contact links
- checkout expiration policy
- manual payment policy
- provider secret references

Provider secrets remain PersAI-managed secrets, not plan fields.

## Implementation plan and status

Implement in production-grade slices.

| Slice                                   | Status      | Purpose                                                                      | Main affected areas                                                                      | Completion criteria                                                                                                                                                                   |
| --------------------------------------- | ----------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. ADR and provider-readiness policy    | Completed   | Lock product/payment boundary decisions.                                     | `docs/ADR/084-*`, handoff, changelog                                                     | ADR accepted with pricing page, checkout, provider port, webhook, Plan Control separation, assistant tool, and activation decisions.                                                  |
| 2. Pricing cards from Admin Plans       | Completed   | Generate public/logged-in tariff page from selected plans.                   | `Admin > Plans`, pricing API, pricing page, Settings link                                | Admin selects visible pricing plans/order; universal pricing page renders current plan and correct CTA states.                                                                        |
| 3. Payment intent and provider port     | Completed   | Add PersAI-owned payment intent and provider-neutral adapter boundary.       | Prisma/data model, API services, billing provider port, test/manual adapter              | PersAI can create/audit payment intents and provider sessions without concrete provider lock-in.                                                                                      |
| 4. Checkout and payment return flow     | Completed   | Let logged-in users buy/upgrade from pricing page.                           | Web pricing page, checkout endpoints, chat return banner                                 | Card/SBP-capable flow can be simulated through test/manual adapter; success returns to chat and failure returns with retry/explanation state.                                         |
| 5. Webhook to lifecycle integration     | Completed   | Route provider outcomes into ADR-083 lifecycle.                              | Webhook controller, lifecycle service, idempotency, audit events                         | Payment success/failure/refund/chargeback update PersAI payment intent and subscription lifecycle deterministically.                                                                  |
| 6. Immediate activation/materialization | Completed   | Ensure upgrades feel instant.                                                | subscription services, config generation, materialization/apply, runtime pre-turn safety | Trusted paid success now rematerializes/warms published assistants immediately enough that chat/bootstrap can pick up the activated plan without waiting for a later random refresh.  |
| 7. Admin manual payment and Ops support | Completed   | Support manual/offline activation without pretending it is provider billing. | Ops Cockpit, admin APIs, audit/lifecycle events                                          | Admin can mark paid with explicit period/source; state shows manual/admin source and remains separate from provider invoices.                                                         |
| 8. Assistant billing tool               | Completed   | Let assistant explain plans and create payment link/QR after confirmation.   | tool catalog, runtime/API tool boundary, payment intent API, guardrails                  | Assistant can create payment link/QR only after explicit confirmation and cannot mutate subscription directly.                                                                        |
| 9. Concrete provider adapter            | In progress | Wire real provider.                                                          | CloudPayments widget adapter, admin billing secrets, webhook verification, live smoke    | Widget payload is now created from persisted PersAI payment intents and trusted webhooks can reconcile widget-originated payments; live smoke and credential validation still remain. |

### Execution rules

- Do not let provider state bypass PersAI subscription lifecycle.
- Do not tie pricing cards to hand-coded marketing pages.
- Do not treat admin tester override as billing.
- Do not activate paid access from client return alone; require provider/webhook or trusted server verification.
- Do not generate payment links without a PersAI payment intent.
- Do not let the assistant create payment without explicit confirmation.
- Do not silently switch a paid user to a new plan without explaining immediate upgrade/downgrade timing.

### Prompt for a future implementation session

```text
Continue PersAI billing readiness from ADR-084.

Read before coding:
1. AGENTS.md
2. docs/SESSION-HANDOFF.md
3. docs/CHANGELOG.md
4. docs/ADR/084-billing-provider-readiness-pricing-checkout-and-payment-tools.md
5. docs/ADR/083-subscription-lifecycle-trial-fallback-and-billing-ops.md
6. docs/ADR/082-billing-quota-and-delivery-confirmed-media-accounting.md
7. docs/ARCHITECTURE.md
8. docs/API-BOUNDARY.md
9. docs/DATA-MODEL.md
10. docs/TEST-PLAN.md

Current active ADR-084 slice should be chosen from the Implementation plan and status table.

Production rules:
- one universal pricing page for guests and logged-in users
- pricing cards come from Admin Plans
- checkout starts with a PersAI payment intent
- provider webhook updates PersAI lifecycle state
- Plan Control remains tester/admin override, not billing
- upgrade activates immediately; downgrade/cancel apply at current period end
- assistant billing tool may create payment link/QR only after explicit confirmation

Before ending:
- run focused checks for changed code
- run AGENTS verification gates when code/contracts changed
- update docs/SESSION-HANDOFF.md and docs/CHANGELOG.md
- state the next recommended ADR-084 slice
```

## Verification requirements

Focused checks should prove:

1. Pricing page renders only plans selected in Admin Plans and respects ordering.
2. Guests selecting a plan are sent to registration/login without creating paid access.
3. Logged-in users can create payment intents for paid plans.
4. Payment intent creation is idempotent.
5. Payment success updates PersAI lifecycle only after trusted server/provider confirmation.
6. Payment failure leaves the current plan unchanged and provides retry/explanation state.
7. Upgrade activates immediately and triggers materialization.
8. Downgrade/cancel remains scheduled for period end.
9. Refund/chargeback applies immediate fallback/free and records audit.
10. Manual admin payment activation is clearly marked as manual/admin source.
11. Plan Control override does not create or mutate billing provider state.
12. Assistant billing tool requires explicit confirmation before payment link/QR creation.

## Non-goals

- No tax/accounting ledger implementation in this ADR.
- No final choice of one provider vendor in this ADR.
- No provider-specific webhook field mapping beyond normalized boundary requirements.
- No hidden legacy billing mode.
- No ordinary-user exposure of raw provider state.
- No replacing ADR-082 quota accounting or ADR-083 subscription lifecycle.

## Consequences

### Positive

- Real provider integration becomes a bounded adapter task.
- Pricing page stays aligned with Admin Plans.
- Users get one understandable path from tariff choice to payment and activation.
- Admin tester overrides remain useful without polluting billing truth.
- Assistant can help with payment while staying guarded by explicit confirmation and payment intents.

### Negative

- PersAI needs first-class payment intent and webhook idempotency.
- Immediate activation requires reliable materialization after subscription changes.
- Manual payment support adds admin responsibility and audit requirements.
- Refund/chargeback immediate fallback may be strict, but it avoids giving paid access after reversed payment.

## Current code audit notes

Current implementation observations that this ADR intentionally changes or formalizes:

- A provider port exists and now backs the real CloudPayments widget-first checkout path, but subscription lifecycle truth still must remain webhook/admin driven inside PersAI rather than coming from provider-side pull sync.
- Admin plan catalog already carries rich plan limits and can become the source for pricing cards.
- Ops Plan Control already exists for tester/manual override; ADR-084 keeps it separate from billing/payment truth.
- ADR-083 lifecycle state should own trial/paid/grace/fallback outcomes; ADR-084 provider events should update that state rather than creating a parallel source of truth.
- Existing assistant notification/tool governance is now reused by the existing `quota_status` billing path, and payment creation remains guarded by explicit confirmation plus PersAI payment intents.
