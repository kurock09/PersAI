# ADR-092: SBP recurring migration, split billing payment-method truth, and PROD billing communications

## Status

**Accepted** — normative architecture and implementation truth. The bounded implementation slices for split billing truth, payment-success notifications, Admin > Notifications visibility, and recurring-migration UX landed on 2026-05-10; future product changes should extend this ADR only via a new explicit ADR if the long-term contract changes.

## Date

2026-05-10

## Relates to

ADR-083 (subscription lifecycle), ADR-084 (billing provider / checkout / intents), ADR-088 (unified notification platform), ADR-082 (quota accounting)

## Context

### Problem statement

Production behavior and user perception diverged for a concrete scenario:

- A user with **provider-managed recurring** (card-backed at CloudPayments) performs a **managed upgrade** paid via **SBP** (QR / faster payments).
- PersAI may record the **one-time** SBP success and surface **SBP** in settings, while **the next automatic charge** may still be bound to the **prior card token** at the provider.
- Provider-side **amount and period dates** can update while **human-readable plan / subscription description** at the provider lags, causing mismatch between PersAI plan truth and what the provider dashboard shows.

Root cause class (implementation-agnostic):

1. **CloudPayments models SBP and card recurring on different mechanics.** SBP uses dedicated payment / QR flows; recurring subscriptions are a distinct API surface tied to tokenized card recurring unless the product implements an explicit, provider-documented path to move recurring to SBP (or equivalent). This is an **external invariant**: PersAI must not assume “SBP payment succeeded” implies “next renewal is SBP” without a **provider-confirmed** migration.
2. **PersAI today can represent “last successful checkout method” and “what will actually renew” ambiguously** when a single UI field is derived from recent billing events or intents rather than from **canonical auto-renew instrument truth**.
3. **Managed upgrade + webhook + `subscriptions/update`** paths can change **price and schedule** without always pushing a **synchronized description/name** to the provider.

### Product decision (normative)

For **PROD**:

- **SBP must be a real auto-renew path** when the product offers it — not only a one-time upgrade rail that leaves card recurring as hidden truth.
- If the product requires that **“upgrade via SBP moves auto-renew to SBP”**, the backend MUST run an **explicit, checkable, provider-consistent migration flow** with **no** long-lived ambiguous state where UI implies SBP renewal but the provider still charges the card.
- **User-facing settings MUST separate:**
  - **Last successful payment method** (one-time or last capture), and
  - **Auto-renew method** (the instrument the provider will use for the next recurring charge, or `none` / explicit not-configured when auto-renew is off or not provider-managed).
- **No legacy or transitional architecture**: no dual-read truth, no “temporary” mixed field as compatibility source of truth, no feature flag that keeps two semantics alive in PROD.

### Documentation / code anchors (reference only)

Implementation work for the landed slices touched these areas; this ADR still does not prescribe line-by-line patches:

| Area | Location |
|------|----------|
| Subscription read model / labels | `apps/api/src/modules/workspace-management/application/manage-assistant-billing-subscription.service.ts` |
| Payment intent creation / recurring vs one-time | `apps/api/src/modules/workspace-management/application/manage-assistant-payment-intents.service.ts` |
| Webhook → billing events → lifecycle | `apps/api/src/modules/workspace-management/application/handle-cloudpayments-webhook.service.ts` |
| Provider mutation on billing events | `apps/api/src/modules/workspace-management/application/apply-workspace-subscription-billing-event.service.ts` |
| CloudPayments API adapter | `apps/api/src/modules/workspace-management/infrastructure/billing/cloudpayments-constructor-billing-provider.adapter.ts` |
| Billing → notification intents | `apps/api/src/modules/workspace-management/application/billing-lifecycle-producer.service.ts` |
| Notification platform | `apps/api/src/modules/workspace-management/application/notifications/manage-notification-platform.service.ts` |
| Email adapter | `apps/api/src/modules/workspace-management/infrastructure/notifications/channel-adapters/email-channel.adapter.ts` |
| Billing templates | `apps/api/src/modules/workspace-management/application/notifications/templates/billing/` |
| User settings UI | `apps/web/app/app/_components/assistant-settings.tsx` |
| Public API contract | `packages/contracts/openapi.yaml` (`AssistantBillingSubscriptionManagementState`) |

---

## Decision

### D1 — Two billing truths (mandatory)

Introduce and enforce **two distinct** product concepts everywhere (API, DB projection, UI copy):

| Term | Meaning |
|------|---------|
| **One-time payment method** | Class + optional display hints for a **single** successful capture (upgrade, first purchase, package, manual one-shot). |
| **Recurring payment method** | The **provider-bound** instrument used for **next and subsequent** automatic charges while auto-renew is active (e.g. card token, or SBP-backed recurring **only** if provider API + PersAI state say so). |
| **Last payment method** | The method class (and safe labels) for the **most recent successful** user-initiated or provider-settled payment that the product considers “last payment” for support UX. |
| **Auto-renew method** | The method class (and safe labels) for **what will renew**; if auto-renew is disabled or not provider-managed, this MUST be `null` or an explicit `not_applicable` / `none` — never borrowed from “last payment”. |
| **Recurring migration state** | PersAI-owned enum/state machine for **in-progress or failed** moves between recurring instruments (e.g. card → SBP). |
| **Provider-confirmed migration** | Migration is **complete** only when PersAI has **both**: (a) persisted canonical fields matching target instrument, and (b) **positive confirmation** from provider callbacks/API fields required by the chosen integration (not inferred from a single one-time SBP success alone). |

**Forbidden:** using one ambiguous `paymentMethodLabel` (or any single string) as **long-term** source of truth for both last payment and auto-renew. The OpenAPI field `paymentMethodLabel` MUST be **replaced in one bounded contract change** with explicit fields (see §D2). Partial renames or dual semantics are not allowed.

### D2 — Canonical data model and API contract

**PersAI-owned canonical fields** (exact column placement is an implementation detail; options include `workspace_subscriptions` columns and/or structured `metadata` with a strict schema — the ADR requires **one** canonical store, not split competing truths):

- `lastPaymentMethodClass` + optional `lastPaymentMethodDetail` (non-PCI, display-safe)
- `autoRenewMethodClass` + optional `autoRenewMethodDetail`
- `recurringMigrationStatus` + `recurringMigrationUpdatedAt` (+ optional error code/message for failed migration)
- `providerRecurringDescriptor` (string mirrored to provider `Description` / name fields when supported)

**OpenAPI:** extend `AssistantBillingSubscriptionManagementState` to require, at minimum:

- `lastPaymentMethodLabel` or structured `{ class, label }` for last payment
- `autoRenewMethodLabel` or structured `{ class, label }` for auto-renew
- `recurringMigration` object: `{ status, targetMethodClass?, failureReason?, updatedAt }` (exact shape to be finalized in the implementation plan)

**Rule:** confirmed **auto-renew method** MUST be readable from canonical fields **without** recomputing from “latest billing event” alone. Events and webhooks **feed** state transitions; they do not remain the sole store for “what charges next”.

### D3 — Provider migration flow (CloudPayments / SBP)

**External invariant (non-normative API listing):** CloudPayments documents SBP under a dedicated flow (e.g. QR / link generation) and recurring under `subscriptions/*`. Agents MUST read the **current** provider documentation before coding and cite the exact methods/flags used in the implementation PR.

**Normative product rules:**

1. **Managed recurring upgrade paid with SBP** MUST end in either:
   - **A completed provider-confirmed migration** to SBP-backed recurring (auto-renew method = SBP), or
   - **A failed migration** with explicit user-visible error and support-safe logs, and **auto-renew method** remains **card** (or prior recurring instrument) — **never** SBP in UI unless confirmed.
2. If the provider requires a **separate user-facing confirmation step** (e.g. binding, tokenization, or second redirect), that step is **part of PROD flow**, not an operator manual tail.
3. **Webhook replay and duplicate events** MUST be idempotent: migration state MUST NOT oscillate or corrupt on retries.
4. **Card recurring flows** that do not involve SBP MUST remain correct; no regression on existing `card` recurring-start and renewals.

**Implementation note:** `apply-workspace-subscription-billing-event.service.ts` and `cloudpayments-constructor-billing-provider.adapter.ts` MUST gain explicit hooks to:
- run migration steps in order,
- persist migration state transitions,
- call provider APIs with the parameters documentation requires for SBP recurring (exact calls are **not** fixed in this ADR).

### D4 — Provider name / description consistency

Whenever PersAI updates provider recurring **Amount**, **Period**, **StartDate**, **Interval**, or plan identity that maps to user-visible tariff naming, the adapter MUST also send **Description** (or equivalent provider field) so **provider dashboard name** stays aligned with PersAI `planDisplayName` / plan code mapping.

**Acceptance:** if PersAI shows an upgraded plan name, the provider subscription description MUST not remain stuck on an old tariff label after the same upgrade event is applied.

### D5 — User-facing billing settings (UI contract)

`assistant-settings.tsx` (and any other surface showing payment method) MUST:

- Show **“Last payment”** and **“Auto-renew”** (or i18n equivalents) as **separate** rows.
- **Remove** ambiguous **“Payment method”** copy when it could mean either.
- If `recurringMigrationStatus` is `in_progress` or `failed`, show **clear** status (spinner + explanation / retry CTA per product).
- If auto-renew is off: auto-renew row shows **not active**, not the last payment method.

### D6 — Billing notifications, payment success email, and receipt policy

**PROD scope:** billing communications are **not** optional polish.

1. **Billing lifecycle templates** (trial ending, renewal failed, grace, etc.) are **necessary but insufficient**. Add a dedicated **payment success** communication path for user-initiated checkouts (distinct copy from generic lifecycle recovery where needed).
2. **Receipt / fiscal check:**
   - CloudPayments (and connected cash-register integrations) can emit checks and may email the buyer when `Email` / `receipt` / `CustomerReceipt` (or successor fields) are set per **current** docs. Implementation MUST read provider docs and decide the exact payload shape.
3. **Product policy (founder-selected):**
   - PersAI sends the **primary** payment confirmation email in **PersAI branded** style (via notification platform + Postmark path per ADR-088).
   - That email is **not** presented as the official fiscal receipt.
   - The email MUST include a **footer block** with a **link to the official receipt / provider or cash-register receipt URL** when the provider returns one; if no URL is available, the footer MUST state where to obtain it (support path) without fabricating a document.
4. **Separation:** receipt delivery **supplements** billing notification; it does **not** replace lifecycle or payment-success notifications.

**Ownership clarity:** Persist provider receipt identifiers / URLs on the PersAI side when the webhook or API exposes them, so support and the email template can reference the same truth.

### D7 — Admin Notifications: billing history audit (PROD bug class)

**Observation:** Billing lifecycle traffic should appear in **`Admin > Notifications`** delivery history. If billing intents do not **persist and list** correctly after delivery or filtering, that is a **PROD acceptance** failure.

**Mandatory audit checklist** (implementation slice must close with evidence):

| Hypothesis class | What to verify |
|------------------|----------------|
| Intent not created | `BillingLifecycleProducerService` / payment-success producer paths actually call `NotificationIntentService.createIntent` |
| Intent not listed | `ManageNotificationPlatformService.listDeliveries` joins and filters include `source=billing_lifecycle` and new payment-success source if added |
| Filter excludes rows | Admin UI filters default to showing billing rows; server accepts `source` filter values |
| Lifecycle hides history | Intent rows are not deleted or over-written; `lifecycle_status` transitions remain queryable for history |
| Bypass unified platform | No billing email path sends “around” `notification_intents` |

**Acceptance:** After a successful billing notification delivery, operators can see the intent and attempts in **`Admin > Notifications`** history; replay/webhook storms do not remove history.

---

## Execution rules for Cursor agents

1. **One bounded slice per session** (align with `AGENTS.md` + workspace rules).
2. **No silent architecture changes** — if this ADR and code disagree, stop and reconcile docs.
3. **No legacy / transitional modes:** no dual-read, no long-lived feature flag splitting semantics, no “temporary” wrong UI.
4. **Do not partially rename `paymentMethodLabel` semantics** — replace the contract in **one** OpenAPI + client + API release slice.
5. **Tests before or with code:** each slice adds **focused** tests listed below before merge.
6. **Do not break existing card recurring** flows.
7. **No hidden fallback** that merges last payment and auto-renew labels again.
8. Future follow-through should extend this area via a bounded implementation plan or a new ADR when long-term product truth changes; do not rewrite ADR-092 ad hoc during coding.

---

## Mandatory focused tests (acceptance-oriented)

Future implementation MUST include automated coverage for:

1. **Card subscription + SBP upgrade + no confirmed recurring migration** → `lastPaymentMethod = SBP`, `autoRenewMethod = card` (or prior recurring class).
2. **Card subscription + confirmed SBP migration** → `autoRenewMethod = SBP`.
3. **Provider amount/date updated** → provider **Description/name** updated in the same logical operation.
4. **UI** never shows SBP as auto-renew when only one-time SBP succeeded.
5. **Webhook replay / duplicates** do not corrupt migration state.
6. **Payment success** flow records expected notification intent + email outcome (or honest failure).
7. **Provider receipt path** configured and verifiable on successful payment (staging or sandbox).
8. **Billing notifications** remain visible in `Admin > Notifications` after delivery and under typical filters.
9. **No billing email** sends outside the unified notification platform path.

---

## Implementation sequencing (informative)

Suggested order for a **future** execution plan (not this ADR session):

1. Schema + OpenAPI contract for split fields + migration state.
2. Webhook + billing-event state machine for provider-confirmed migration.
3. Provider adapter: SBP recurring + description sync.
4. UI: split labels + migration UX.
5. Payment success notification + receipt footer + provider payload.
6. Admin notifications audit fixes + tests.
7. Repair script / admin tool for historical mismatches (method/descriptor).

---

## Consequences

- **Positive:** User trust, support clarity, alignment with CloudPayments’ actual SBP vs recurring model, cleaner Ops visibility.
- **Negative:** Larger contract churn (web + mobile clients must consume new fields), careful migration for existing subscribers.
- **Risks:** Provider API gaps or regional constraints; must be discovered during implementation and either resolved or explicitly product-scoped with founder sign-off (not silent downgrade).
