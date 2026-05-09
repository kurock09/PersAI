# ADR-089: Media package add-ons (one-time purchasable quota boosts)

## Status

Accepted; implementation in progress.

## Date

2026-05-09

## Relates to

ADR-082, ADR-083, ADR-084, ADR-086, ADR-087

## Context

PersAI's monthly media quota (`image_generate`, `image_edit`, `video_generate`) is plan-owned truth.
When a user exhausts their monthly limit, the only current upgrade path is a full plan upgrade.

Founder decision: introduce one-time purchasable media packages that add temporary extra quota on
top of the user's current plan without touching the subscription or plan state. Three package types
match the three media tools. Each type has admin-configured presets (e.g. `10 units = 100 RUB`,
`100 units = 700 RUB`). Packages are period-scoped — they expire when the subscription period resets.

Billing flow: non-recurring one-time CloudPayments checkout, identical mechanical spine to the
existing `plan_purchase` one-time path. After webhook success, a new `media_package_purchase`
fulfillment path writes a quota grant row instead of activating a paid subscription lifecycle state.

Currency: only `RUB` and `USD` are supported for packages and for plan pricing cards. Free-text
currency input in the admin plans UI is replaced with a controlled two-option select.

## Decision

### 1. Package catalog — separate from PlanCatalogPlan

A new `media_package_catalog` table stores admin-configured package presets. Fields:

- `id` — uuid
- `packageType` — enum `image_generate | image_edit | video_generate`
- `units` — positive integer
- `amountMinor` — price in minor currency units (kopecks / cents)
- `currency` — varchar(3), `RUB` or `USD` only
- `isActive` — boolean, controls public visibility
- `displayOrder` — integer
- `titleRu` / `titleEn` — localized marketing title
- `subtitleRu` / `subtitleEn` — localized subtitle
- `badgeRu` / `badgeEn` — optional quiet badge label
- `ctaLabelRu` / `ctaLabelEn` — optional CTA override
- `createdAt` / `updatedAt`

Packages are never mixed with plan lifecycle truth. They have no `planCode`, no `lifecyclePolicy`,
no subscription period boundaries of their own. Their expiry is derived at read time from the
workspace's effective subscription period.

### 2. Workspace package grants

A new `workspace_media_package_grants` table stores post-payment quota grants. Fields:

- `id` — uuid
- `workspaceId`
- `packageCatalogItemId` — FK to catalog preset
- `toolCode` — denormalized for fast quota reads
- `grantedUnits` — units from the preset at purchase time
- `amountMinorSnapshot` — price snapshot
- `currencySnapshot` — currency snapshot
- `paymentIntentId` — FK to `workspace_payment_intents`
- `periodStartedAt` — snapshot of subscription period start at purchase time
- `periodEndsAt` — snapshot of subscription period end at purchase time (expiry boundary)
- `status` — `active | expired_period | reversed`
- `createdAt` / `updatedAt`

Grant rows are never deleted. On period rollover or subscription event they are logically expired
by comparing `periodEndsAt` to the effective period. No cron/backfill is needed: the read path
filters by `status = active AND periodEndsAt > now()`.

### 3. Quota truth: base + bonus + effective

The monthly media quota context gains three values per tool:

- `baseLimitUnits` — derived from current plan hints (existing truth, unchanged)
- `bonusLimitUnits` — sum of `grantedUnits` across all active grants for this workspace + tool + current period
- `effectiveLimitUnits` — `base + bonus`, or `null` when base is null (unlimited plan)

Enforcement reads `effectiveLimitUnits`. The existing counter row's `limitUnits` snapshot continues
to be the enforcement value stamped at reservation time; the read path must recompute it from the
overlay before each reservation.

A base that is `null` (unlimited) stays unlimited regardless of bonus grants. A base of `0` or
missing remains `0`; bonus units are additive on top.

### 4. Payment intent purpose and webhook fulfillment

New intent purpose: `media_package_purchase`.

`CreateAssistantPackagePaymentIntentInput`:
- `packageItemIds: string[]` — one or more catalog item IDs from the same or different types
- `paymentMethodClass`
- `idempotencyKey`
- `returnUrl`

The intent is created with a combined `amountMinor` equal to the sum of selected presets. `targetPlanCode`
is set to the sentinel value `"__media_package__"` (no plan code is needed) or the field is made
nullable via a new optional column `targetPackageItems: Json`. The webhook handler branches on
`purpose === "media_package_purchase"` and instead of calling plan lifecycle services, writes
one grant row per selected package item.

Cross-currency selection is rejected at intent creation time: all selected presets must share the
same currency.

### 5. Currency constraint

Billing paths for packages and plan pricing cards accept only `RUB` and `USD`. The admin plans
page replaces the free-text currency input with a `<select>` with two options. Backend validation
on plan pricing write paths and package preset write paths enforces the same constraint.

Existing plan rows that already store other currency codes remain valid and continue to work on
the checkout and pricing-page rendering path. The constraint applies only to new writes.

### 6. Quota tool facts for packages

`quota_status` exposed to the runtime includes per-tool media quota facts enriched with:

- `baseLimitUnits`
- `bonusUnits`
- `effectiveLimitUnits`
- `packagesAvailable` — boolean, true when at least one active public package preset exists for this tool
- `packagesBonusExpiresAt` — ISO date of the latest grant `periodEndsAt` when bonus > 0

The advisory LLM instruction and `quota-grounded-limit-copy.service.ts` must only mention package
purchase when `packagesAvailable` is true. The bonus expiry reminder is surfaced in a quiet subline,
not as a banner or notification.

### 7. User-facing quota UX rule

The assistant settings limits section shows each media tool as one card:

- main value: `used / effectiveTotal`
- quiet subline visible only when `bonusUnits > 0`:
  `plan: X + pkg: Y`
- if `bonusUnits === 0`, subline is hidden
- a small accent indicator (not warning-red) marks the card when a bonus is active
- expiry copy appears once during package purchase confirmation and in a tooltip on the subline,
  not as a standing banner

This keeps the mobile/Capacitor layout clean while being honest about the quota composition.

### 8. Package selection and purchase page

A new app route `/app/packages` shows package cards per type. Design direction:

- cards sized and composed similarly to pricing plan cards
- each card has: units headline, quiet price anchor, localized title, optional badge
- card background carries a type watermark (image/edit/video shape token)
- watermark opacity increases on hover — no glow, no neon
- multi-select: user may select cards across different types; total price accumulates
- single `Купить` button opens the existing embedded checkout for a combined intent
- quiet notice: "This package is active until the end of your current period."
- entry points: quiet link on the pricing page, and an entry card in assistant settings

### 9. Admin UI

On `Admin > Plans`, a second major block below the plans list: `Media packages`.

- three sub-sections: Image generate, Image edit, Video generate
- each sub-section lists configurable presets as compact rows
- preset fields: units, amount, currency (RUB/USD select), title ru/en, badge ru/en, active flag, display order
- same visual language as plan admin cards, but more compact
- admin may add/edit/delete presets within each type
- no plan-lifecycle fields (no trial duration, fallback, subscription hooks)

## Architecture consequences

- `WorkspacePaymentIntent.targetPlanCode` remains NOT NULL for backwards compatibility; package
  intents use the sentinel `"__media_package__"` and store the selected items in `metadata.packageItems`.
- `HandleCloudpaymentsWebhookService` gains a new fulfillment branch guarded by
  `purpose === "media_package_purchase"`.
- The quota accounting reservation path (`TrackWorkspaceQuotaUsageService`, 
  `ReserveInternalRuntimeMonthlyMediaQuotaService`) is extended to accept the overlay context and
  enforce `effectiveLimitUnits` instead of raw plan limit.
- `ResolvePlanVisibilityService` and `ReadInternalRuntimeQuotaStatusService` are extended to include
  bonus/effective facts and `packagesAvailable`.
- No materialization or runtime bundle changes are required; quota truth flows through existing
  `quota_status` tool boundary.

## Constraints

- Packages are additive, never replacing plan limits.
- Base unlimited plans stay unlimited — bonus units have no effect on quota enforcement for those plans.
- Package grants cannot outlive the subscription period in which they were purchased.
- All public package prices must use `RUB` or `USD`.
- The one-time billing path is not extended to recurring; no auto-renewal of packages.

## Out of scope

- Package gifting or admin-issued manual grants (future ADR).
- Package refund automation (manual ops action in Ops Cockpit, same as plan payment reversal).
- Currency auto-conversion or multi-currency cart.
- Per-package promotional codes.
