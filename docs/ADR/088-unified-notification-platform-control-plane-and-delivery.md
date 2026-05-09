# ADR-088: Unified notification platform, control plane, and delivery architecture

## Status

Accepted — Slice 1 landed 2026-05-08; Slice 2 landed 2026-05-08; Slice 3 landed 2026-05-08; **Slice 2.5 (multi-user correction) landed 2026-05-09** — global singletons, resolver service, Postmark credential store migration, env fallback removal, seed cleanup, and compact Admin > Notifications UI. Slice 4 pending.

## Date

2026-05-08 (revised 2026-05-09 with multi-user correction)

## Post-mortem (2026-05-09): per-workspace notification-config flaw

Slices 1–3 modelled `notification_channel_registry`, `notification_policies`, and `notification_quiet_hours` as **per-workspace** rows. This was wrong for PersAI:

- PersAI is a multi-user product with one operator (founder) and many self-service users.
- Operator settings (which sources are enabled, channel order, quiet hours, render instructions, etc.) are **global** by product design — there is no per-user notification configuration UI and no plan for one.
- Per-workspace rows forced new-user registration to write notification-config rows or fall through to "channel not configured" failures, which led to a `seed.ts`-on-every-deploy hack and a (later reverted) onboarding-time auto-provision commit.

Slice 2.5 (landed 2026-05-09) corrected this. The target state:

- `notification_channel_registry`, `notification_policies`, `notification_quiet_hours` become **global singletons** (no `workspaceId` column). Operator edits one row per source / per channel / one quiet-hours row in `Admin > Notifications`. Defaults live in code so a fresh DB works without seed.
- Per-workspace channel availability is **auto-derived at delivery time** from existing PersAI sources (no notification-only rows): email from `AppUser.email` of the workspace owner, telegram from `AssistantChannelSurfaceBinding`, web from intent context (`chatId`, `surfaceThreadKey`).
- Postmark API key and webhook token move to `Admin > Tools` (existing operator-owned credential pattern), not Kubernetes secrets.
- `notification_intents`, `notification_delivery_attempts`, `notification_dead_letters` **keep `workspaceId`** — they describe individual user events, not config.
- `seed.ts` writes zero notification rows. `UpsertOnboardingService` writes zero notification rows. Both kept this way permanently.

All sections below reflect the corrected target state, which is now the landed on-disk reality as of Slice 2.5 (2026-05-09). Slice 1–3 acceptance text is preserved as-is for historical accuracy.

## Relates to

ADR-041, ADR-056, ADR-074, ADR-077, ADR-083, ADR-084, ADR-087

## Context

PersAI now has several real notification-producing systems split by product area and delivery style:

- assistant conversational follow-ups in active chat/thread surfaces (web, Telegram)
- assistant notification outbox delivery for reminders, background tasks, idle reengagement, billing assistant pushes
- billing lifecycle notification jobs with intended email delivery (sender not implemented) and optional assistant push
- admin notification webhook channels and delivery logs
- workspace-scoped notification policy rows for selected sources (`idle_reengagement`, `quota_advisory`)
- billing lifecycle notification policy stored separately inside `BillingLifecycleSettings.metadata`

Concrete repo truth audited 2026-05-08:

- `assistant_notification_outbox` + `AssistantNotificationOutboxSchedulerService` + `AssistantNotificationDeliveryService` are the most mature backbone today and own durable assistant push for reminder/background-task/idle-reengagement/billing-assistant notifications
- `billing_lifecycle_notification_jobs` is a separate transactional notification queue; its `channel: "email"` rows are created and persisted but no email sender implementation exists in `apps/api/src`
- `WorkspaceAdminNotificationChannel` + `AdminNotificationDelivery` are a separate webhook delivery path (`DeliverAdminSystemNotificationService`) with its own retry, audit, and signal allowlist
- `QuotaAdvisoryFollowUpService` (ADR-087) writes follow-up assistant messages directly to the active thread without going through the assistant notification outbox, with its own dedupe state in `assistant_quota_advisory_states`
- `WhatsApp` is in `AssistantPreferredNotificationChannel` enum but `AssistantNotificationDeliveryService` has no WhatsApp branch and falls back to web
- `system_event` source is defined in `AssistantNotificationOutboxSource` but no producer enqueues it
- `Admin > Notifications` (`apps/web/app/admin/notifications/page.tsx`) is a partial control surface: webhook channel + idle reengagement + quota advisory only; billing lifecycle policy lives in `Admin > Billing Settings`; latest delivery view lives in `Admin > Ops`
- Quiet hours, per-type escalation, channel rate limiting, structured observability fields, and email/push delivery do not exist yet

This split is no longer sufficient. Continuing feature-by-feature growth will multiply duplicated routing, duplicated rendering, duplicated dedupe/cooldown logic, and incompatible admin surfaces.

There are no real users yet, so the cost of consolidating now is small and the value of doing it cleanly is large: every future notification feature will land on a stable foundation instead of growing the existing tangle.

## Decision

PersAI adopts one unified notification platform with a single control-plane model for notification intents, policy resolution, channel routing, rendering strategy, durable delivery, observability, and audit. All current notification subsystems converge under this platform. No new notification feature may bypass it after Slice 1 lands.

## Core principles

### 1. Notification intent is the product-level source of truth

Every user/admin/system notification is created as a notification intent, not as a channel-specific side effect. Direct channel sends are never target-state product truth.

A notification intent envelope expresses:

- `source` (idle_reengagement, quota_advisory, reminder, background_task, billing_lifecycle, admin_system, future)
- `class` (`conversational`, `transactional`, `operational`, `administrative`)
- `priority` (`immediate`, `scheduled`, `digest`, `skippable`)
- ownership (`workspaceId`, `assistantId?`, `userId?`, optional active-thread context: `surface`, `surfaceThreadKey`, `chatId`)
- `factPayload` (structured facts for renderer)
- `policySnapshot` (resolved policy at intent creation time)
- `renderStrategy` (`grounded_llm`, `template`, `static_fallback`)
- `renderInstruction?` (admin-owned LLM instruction id or template id)
- `allowedChannels` (ordered preference list)
- `escalationPolicy?` (after-minutes, target channel)
- `dedupeKey?` (unique business key)
- `scheduledAt?` (deferred/scheduled delivery)
- `respectQuietHours` (boolean; default true except for explicit user-chosen reminder times)
- `lifecycleStatus` (intent state machine, see below)

### 2. Four notification classes

1. `conversational` — active-thread assistant follow-ups (quota advisories, idle reengagement nudges, future soft in-thread warnings)
2. `transactional` — payment success, renewal failure, grace/fallback lifecycle, checkout state, receipts, deterministic account notifications
3. `operational` — delivery failures, channel disconnects, webhook failures, dead-letter growth, provider degradation
4. `administrative` — admin/operator/founder alerts, support escalations, policy misconfiguration warnings

Class is declared per notification type, not derived. Class determines allowed renderers, allowed channels, and policy semantics.

### 3. Three explicit rendering strategies

1. `grounded_llm` — only allowed for `conversational`; must be based on structured facts and obey admin-owned instruction; never used for billing/admin/ops content
2. `template` — required for `transactional`, `operational`, `administrative`; localized, deterministic, audit-safe
3. `static_fallback` — emergency fallback only when the intended renderer cannot produce deliverable output

### 4. Channel registry is global; per-workspace channel availability is auto-derived

Channel adapters deliver notifications. They do not own product policy, dedupe, or escalation logic.

The channel registry is a **global singleton** owned by the operator. There is exactly **one** `notification_channel_registry` row per `channelType` for the whole platform. No `workspaceId` column. The operator edits these rows in `Admin > Notifications`. They describe operator-level wiring (sender domain for email, signing secret for admin webhook, default templates per channel, health) — never per-user state.

Channel types:

- `telegram_thread` (rich text, media, in active assistant chat)
- `web_thread` (rich text, media, in active assistant chat)
- `web_notification_center` (in-app system thread `system:notifications`, today's web fallback)
- `email` (transactional only, Postmark)
- `admin_webhook` (operational/administrative outbound HTTPS with HMAC)
- `web_push` (browser push, future)
- `mobile_push` (FCM/APNs via Capacitor shell, future)

Per registry row: `channelType` (PK / unique), `enabled`, `config` (sender domain, signing secret reference, locale, etc.), `healthStatus` (`healthy`, `degraded`, `down`, `unconfigured`), `lastDeliveryAt`, `lastFailureAt`, `consecutiveFailures`. Health is updated by the delivery worker and consumed by routing.

**Per-workspace channel availability** for a given intent is computed at delivery time by `ResolveWorkspaceNotificationChannelsService.resolveChannel(workspaceId, channelType)`. The service reads existing PersAI truth and returns a `ResolvedChannel | null`:

| channelType               | resolved how                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web_thread`              | always available; `chatId` from `intent.chatId`, `threadKey` from `intent.surfaceThreadKey`                                                                          |
| `web_notification_center` | always available; `chatId` resolved via `AssistantChatRepository.findOrCreateChatBySurfaceThread(surfaceThreadKey="system:notifications")`                           |
| `telegram_thread`         | available iff `AssistantChannelSurfaceBinding` row exists for the workspace with `kind="telegram"` and is healthy; chatId from binding                               |
| `email`                   | available iff `Workspace.owner.AppUser.email` is non-empty; sender from global registry row's `config.sendingDomain`; Postmark token from credential store (see §10) |
| `admin_webhook`           | available iff the global registry row has `config.webhookUrl` + `config.signingSecret`; the same single webhook serves all admin alerts                              |
| `web_push`, `mobile_push` | `null` until configured (future ADR)                                                                                                                                 |

A `null` result from the resolver is a deliverable failure (`channel_not_configured:<type>` with reason `auto_derive_unavailable`). Onboarding writes nothing into notification tables. Seed writes nothing into notification tables.

`whatsapp` channel preference is removed from `AssistantPreferredNotificationChannel` until a real adapter exists (no half-implemented options in user-facing settings).

### 5. Policy-driven routing with explicit timing semantics — global policy, per-event delivery

`notification_policies` is a **global singleton** table: exactly one row per `source`, no `workspaceId` column. The operator edits one row per source in `Admin > Notifications`. Code-level defaults (`apps/api/src/modules/workspace-management/application/notifications/defaults/notification-defaults.ts`) cover any source missing a DB row, so a fresh DB works without seed.

Per-workspace routing is per-event, not per-config:

- routing resolves per intent (delivery time):
  - whether the source is globally enabled
  - which channels are allowed and in which order (from the global policy)
  - which of those channels are actually available for this workspace (via the resolver from §4)
  - whether quiet hours apply (from the global quiet-hours singleton, see §7)
  - whether per-source rate caps / dedupe allow delivery now
  - whether the intent is immediate, scheduled, digest, or skippable
- routing never reads per-workspace policy/channel/quiet-hours rows because no such rows exist

Producers may pass `allowedChannels` on `createIntent` to override the global policy's channel list for a single event (used by `QuotaAdvisoryFollowUpService` to pin advisory delivery to the surface the user is currently on). This is a per-event override, not stored config.

`priority` semantics:

- `immediate` — must attempt delivery now (quota advisory in active turn, payment failure)
- `scheduled` — deliver at `scheduledAt` (trial ending in N days, user reminder at user-chosen time)
- `digest` — collected and delivered as periodic summary (future, not in initial slices)
- `skippable` — auto-skip if user is currently active or quiet hours block (idle reengagement)

### 6. User reminders stay in the platform but opt out of platform timing controls

User reminders are notification intents (source `reminder`). The user picks the exact fire time in conversation. Reminders therefore:

- enter the unified platform like any other notification (durable, audited, dedupe-safe)
- have `respectQuietHours: false` by default
- are excluded from per-source rate cap and skippable behavior
- still respect channel preference and escalation if configured

Admin > Notifications quiet hours configuration must let the operator decide which sources quiet hours apply to. Reminders are off by default in that selection; the operator can opt them in if they want.

### 7. Quiet hours are timezone-aware, admin-configurable, per-source — and global

Quiet hours are a **global singleton** row in `notification_quiet_hours` (no `workspaceId` column). The operator configures them once in `Admin > Notifications`:

- `enabled` (boolean)
- `startLocal` (HH:MM)
- `endLocal` (HH:MM)
- `timezoneMode` (`workspace_default` resolves per-recipient via `Workspace.timezone`; `per_user_resolved` reserved for future per-user-tz support)
- `defaultTimezone` (fallback when `Workspace.timezone` is null)
- `appliesToSources` (multi-select; `reminder` excluded by default)

When a non-immediate intent is created and falls inside quiet hours for the resolved per-recipient timezone, routing defers it to the next allowed window with `lifecycleStatus = "deferred_quiet_hours"`. `immediate` priority always overrides quiet hours and is logged as an override.

The legacy compile-time hardcoded quiet windows are removed; only admin-configured truth applies.

### 8. Escalation is policy-driven and bounded

Each policy may define:

- `escalationAfterMinutes` (defer between primary attempt failure and escalation)
- `escalationChannel` (single fallback channel from registry)
- `maxEscalationHops` (default 1; never recursive)

When primary delivery fails or remains unconfirmed past `escalationAfterMinutes`, the worker creates a new delivery attempt on the escalation channel, linked to the same intent. Successful escalation marks the intent delivered. Two failed channels in a row mark the intent dead-letter.

### 9. Durable delivery uses one shared backbone

All notification intents use one durable persistence model:

- intent enqueue with idempotent dedupe
- claim/retry/dead-letter
- per-channel delivery attempt tracking
- delivery result audit
- replay/manual resend for permitted classes

`assistant_notification_outbox`, `billing_lifecycle_notification_jobs`, and `admin_notification_deliveries` are predecessors and are replaced by the unified backbone in their respective migration slices. Until each slice lands, the legacy table coexists transitionally; once a slice lands, the legacy table is dropped, not repurposed. No legacy notification table survives past the slice that absorbs it.

### 10. Email delivery is real, with operator-owned credentials in Admin > Tools

Email channel uses Postmark as the transactional provider:

- sending domain `notifications.persai.dev` (SPF, DKIM, DMARC verified before Slice 3 traffic). Stored in the global `notification_channel_registry` email row's `config.sendingDomain`, editable in `Admin > Notifications` channel registry section.
- templates are deterministic TypeScript modules that return `{ subject, html, plainText }`, addressable by template id; MJML compilation at build time is a future improvement.
- one `EmailChannelAdapter` service in `apps/api/src/modules/workspace-management/infrastructure/notifications/email-channel.adapter.ts`. Recipient address resolves at delivery time from `Workspace.owner.AppUser.email`.
- bounce/complaint webhook ingress at `POST /api/v1/internal/notifications/postmark-webhook` (HMAC verified) marks the global email channel `degraded` (≥2 consecutive failures) or `down` (≥5) and increments `consecutiveFailures`.
- transactional emails carry `List-Unsubscribe` and `List-Unsubscribe-Post` headers for one-click unsubscribe.

**Credentials live in the operator credential store (`Admin > Tools`), not in Kubernetes secrets:**

- `notification/email/postmark/api-key` — Postmark Server Token
- `notification/email/postmark/webhook-token` — Postmark webhook HMAC token

Both ids are added to `TOOL_CREDENTIAL_IDS` (`apps/api/src/modules/workspace-management/application/tool-credential-settings.ts`). `EmailChannelAdapter` and `HandlePostmarkWebhookService` resolve their secrets from `PlatformRuntimeProviderSecretStoreService` using these ids. The `Admin > Tools` page lists them under a "Notifications" group using the existing credential card pattern (the same pattern already used by document processing and TTS providers). No new admin UI scaffolding is needed for the keys themselves.

`POSTMARK_SERVER_TOKEN`, `POSTMARK_WEBHOOK_TOKEN`, and `POSTMARK_SENDER_DOMAIN` env / secretEnv slots in `infra/helm/values-dev.yaml` were removed in Slice 2.5. The only Postmark wiring lives in DB-backed credential store + `Admin > Tools` UI.

### 11. Observability is structured-logs-first

PersAI relies on structured logs as the primary observability substrate (no Datadog/Grafana/Prometheus in initial scope; GCP log explorer is the operator surface).

Every intent creation and every delivery attempt emits structured log events with stable fields:

- `event` (`notification.intent.created`, `notification.intent.deferred`, `notification.delivery.attempted`, `notification.delivery.delivered`, `notification.delivery.failed`, `notification.delivery.escalated`, `notification.intent.dead_letter`)
- `intentId`, `workspaceId`, `assistantId?`, `userId?`
- `source`, `class`, `priority`, `renderStrategy`
- `channel`, `attemptNumber`
- `latencyMs` (time since intent creation for delivery events)
- `outcome`, `errorCode?`
- `traceId` linking back to originating turn/job/cron

Future Datadog/Grafana adoption is non-blocking and consumes the same fields.

### 12. Admin > Notifications is the canonical operator control plane (edits global truth)

`Admin > Notifications` is operator-only (founder/operator). It edits **global** notification truth — the singleton channel registry, the per-source policy rows, the single quiet-hours row. It never edits per-user / per-workspace state, because no such state exists in the notification platform.

The page is laid out for an operator's daily glance, not as a wall:

- **Header strip (always visible):** one-line health badges per channel (healthy / degraded / down / unconfigured) with last delivery timestamp; one-line totals for the last 24h (`X intents, Y delivered, Z dead-letters`) with each metric clickable to scroll to the right section.
- **Channels section:** one compact card per `channelType` — enabled toggle, config (sender domain for email, webhook URL/secret for admin webhook), test-send button. Health/last-delivery details collapsed under an accordion to keep the strip dense.
- **Policies section:** one row per source, edit-in-place (enabled, channels with drag-to-reorder, cooldown, escalation, render strategy, render instruction id, respect-quiet-hours flag). The `billing_lifecycle` row expands to per-rule sub-policy (six rule codes) inline, not a separate page.
- **Quiet hours section:** single compact form — enabled, start, end, timezone mode, applies-to-sources multi-select.
- **Delivery history:** collapsed by default behind a `Show last 24h (X intents)` button. When expanded, server-side filtered + paginated table; one combined "copy id" popover per row (intent id, dedupe key, trace id) instead of per-column copy buttons.
- **Dead letters:** collapsed by default; header badge shows unresolved count (red if > 0). When expanded, list with inline replay/discard buttons; drawer for full payload.
- **Preview / test send:** one small card. Pick source → pick template/instruction id → fill sample fact payload → preview. Never charges quota, never sends to real recipients, clearly labelled dry-run.

This page replaces today's three-island UX (`Admin > Notifications` partial, `Admin > Billing Settings` for lifecycle policy, `Admin > Ops` for delivery glimpse). Postmark API key and webhook token live in `Admin > Tools` (per §10), not on this page.

### 13. No new direct-send paths and no transitional residue

After Slice 1 lands, new notification features must not create fresh direct-send paths. Each landed migration slice deletes the superseded legacy path in the touched area in full:

- legacy database tables are dropped, not repurposed
- legacy service classes (`AssistantNotificationOutboxService`, `AssistantNotificationOutboxSchedulerService`, `AssistantNotificationDeliveryService`, `DeliverAdminSystemNotificationService`, the assistant-push half of `ScheduleBillingLifecycleNotificationsService`, the direct chat-message write inside `QuotaAdvisoryFollowUpService`) are deleted, not deprecated
- legacy admin HTTP endpoints (`PATCH /api/v1/admin/notifications/policies/idle-reengagement`, `PATCH /api/v1/admin/notifications/policies/quota-advisory`, `PATCH /api/v1/admin/notifications/channels/webhook`) are removed and replaced with the unified `/api/v1/admin/notifications/...` shape from this ADR
- legacy contracts/types in `packages/contracts/src/generated/model/` (`adminNotificationChannel*`, `idleReengagementNotificationPolicy*`, `quotaAdvisoryNotificationPolicy*`, `adminBillingLifecycleNotification*`, `assistantNotificationOutbox*`) are regenerated against the new shapes; abandoned types are removed
- feature flags or env switches that toggle between the legacy and unified paths are explicitly forbidden; the migration is a hard cut per slice, gated only by the slice itself
- code comments referencing legacy notification subsystems are removed in the same slice that deletes the code

A slice that leaves any of the above residue is incomplete and must not be marked done.

## Target data model

The following Prisma models replace the legacy notification tables. Names are normative; agents implementing slices use these exactly unless a follow-up ADR changes them.

**Per-event tables (carry workspace via `notification_intents`):** `notification_intents` and `notification_dead_letters` keep their own `workspaceId` column so admin history / dead-letter queries can attribute every row to the right workspace without an extra join. `notification_delivery_attempts` deliberately does **not** have a `workspaceId` column — every attempt is anchored to its parent intent through `intentId` (cascade), and operator queries derive workspace through that join (see `ManageNotificationPlatformService.listDeliveries`). This matches the on-disk schema as of 2026-05-09 and keeps attempt rows small.

**Global singleton tables (no `workspaceId`):** `notification_channel_registry`, `notification_policies`, `notification_quiet_hours`. These describe operator-level wiring shared across all workspaces; uniqueness is on the natural key (`channelType`, `source`, or singleton row).

**Code defaults:** `apps/api/src/modules/workspace-management/application/notifications/defaults/notification-defaults.ts` exports `NOTIFICATION_POLICY_DEFAULTS`, `NOTIFICATION_QUIET_HOURS_DEFAULT`, and `NOTIFICATION_CHANNEL_REGISTRY_DEFAULTS` covering every value of `NotificationSource` and `NotificationChannelType`. The resolver and intent service import from this file; no inline copies are permitted elsewhere. A fresh DB therefore works without seed.

### `notification_intents`

- `id` UUID PK
- `workspaceId` FK → `Workspace`
- `assistantId` FK → `Assistant` nullable
- `userId` FK → `AppUser` nullable
- `source` enum `NotificationSource` (`idle_reengagement`, `quota_advisory`, `reminder`, `background_task_push`, `billing_lifecycle`, `admin_system`, `system_event`)
- `class` enum `NotificationClass` (`conversational`, `transactional`, `operational`, `administrative`)
- `priority` enum `NotificationPriority` (`immediate`, `scheduled`, `digest`, `skippable`)
- `lifecycleStatus` enum `NotificationLifecycleStatus` (`pending`, `claimed`, `delivered`, `failed`, `dead_letter`, `skipped`, `deferred_quiet_hours`, `deferred_rate_limit`)
- `renderStrategy` enum `NotificationRenderStrategy` (`grounded_llm`, `template`, `static_fallback`)
- `renderInstructionRef` text nullable
- `templateId` text nullable
- `factPayload` jsonb
- `policySnapshot` jsonb
- `allowedChannels` text[] (ordered)
- `escalationAfterMinutes` int nullable
- `escalationChannel` text nullable
- `dedupeKey` text nullable (unique with `workspaceId`)
- `scheduledAt` timestamptz nullable
- `respectQuietHours` boolean default true
- `surface` text nullable
- `surfaceThreadKey` text nullable
- `chatId` UUID nullable
- `traceId` text nullable
- `createdAt`, `claimedAt`, `deliveredAt`, `deadLetteredAt` timestamptz
- `failureReason` text nullable

### `notification_delivery_attempts`

- `id` UUID PK
- `intentId` FK → `notification_intents` (cascade)
- `attemptNumber` int
- `channel` text (matches channel registry)
- `status` enum `NotificationDeliveryAttemptStatus` (`pending`, `sent`, `delivered`, `failed`, `bounced`, `complaint`, `escalated`)
- `providerRef` text nullable
- `error` jsonb nullable
- `startedAt`, `completedAt` timestamptz
- `escalationOf` UUID nullable (links a follow-up attempt to the previous one)

### `notification_channel_registry` (global singleton — one row per `channelType`)

- `id` UUID PK
- `channelType` enum `NotificationChannelType` (`telegram_thread`, `web_thread`, `web_notification_center`, `email`, `admin_webhook`, `web_push`, `mobile_push`) — **UNIQUE**
- `enabled` boolean
- `config` jsonb (sender domain for email, webhook URL + signing-secret-ref for admin webhook, default locale, etc. — never user-specific data)
- `healthStatus` enum `NotificationChannelHealth` (`healthy`, `degraded`, `down`, `unconfigured`)
- `consecutiveFailures` int default 0
- `lastDeliveryAt`, `lastFailureAt` timestamptz nullable
- `updatedAt`, `createdAt` timestamptz

No `workspaceId` column. Per-workspace channel availability is auto-derived at delivery time (see §4).

### `notification_policies` (global singleton — one row per `source`)

Replaces `workspace_notification_policies` and the embedded `BillingLifecycleSettings.metadata` notification policy.

- `id` UUID PK
- `source` enum `NotificationSource` — **UNIQUE**
- `enabled` boolean
- `channels` text[] (ordered preference)
- `cooldownMinutes` int nullable
- `maxPerDay` int nullable
- `escalationAfterMinutes` int nullable
- `escalationChannel` text nullable
- `respectQuietHours` boolean default true (false for `reminder` by default)
- `renderStrategy` enum `NotificationRenderStrategy`
- `renderInstructionRef` text nullable
- `templateId` text nullable
- `config` jsonb (source-specific: `idleHours`, `offsetDays`, `assistantPushEnabled`; for `billing_lifecycle` the per-rule sub-policy lives at `config.rules.<ruleCode>`)
- `updatedAt`, `createdAt` timestamptz

No `workspaceId` column. Code-level defaults in `notification-defaults.ts` cover any source missing a DB row.

### `notification_quiet_hours` (global singleton — exactly one row)

- `id` UUID PK
- `enabled` boolean
- `startLocal` text (HH:MM)
- `endLocal` text (HH:MM)
- `timezoneMode` enum `NotificationQuietHoursTimezoneMode` (`workspace_default`, `per_user_resolved`)
- `defaultTimezone` text nullable (used when `workspace_default` and per-recipient timezone unknown)
- `appliesToSources` text[] (selected `NotificationSource` values; `reminder` excluded by default)
- `updatedAt`, `createdAt` timestamptz

No `workspaceId` column. Singleton enforced by a `singleton` boolean column with `UNIQUE`-on-`true` constraint, or by application-level "first row wins" logic — implementer's choice, but only one logical row.

### `notification_dead_letters`

- `id` UUID PK
- `intentId` FK
- `workspaceId` FK
- `lastError` jsonb
- `escalationAttempts` int
- `claimedForReplayAt` timestamptz nullable
- `resolvedAt` timestamptz nullable (replay succeeded or operator dismissed)
- `createdAt` timestamptz

Legacy tables to drop per slice (no repurposing): `assistant_notification_outbox`, `assistant_quota_advisory_states`, `billing_lifecycle_notification_jobs`, `workspace_notification_policies`, `workspace_admin_notification_channels`, `admin_notification_deliveries`. Each slice that absorbs a producer drops the corresponding legacy table immediately on landing; the very last legacy table is dropped at end of Slice 4. After Slice 4 lands, no row of the unified system depends on any of the legacy tables, and no `apps/api/src` code references them.

## Service architecture

Target-state services in `apps/api/src/modules/workspace-management/`:

- `application/notifications/notification-intent.service.ts` — single entry point: `createIntent(input): NotificationIntent`. Resolves policy, applies quiet hours, applies dedupe, persists to `notification_intents`. All producers call this and only this.
- `application/notifications/notification-routing.service.ts` — pure logic: given intent + policy + channel registry health, returns ordered channels and escalation plan.
- `application/notifications/notification-delivery-worker.service.ts` — single durable worker. Replaces `AssistantNotificationOutboxSchedulerService`, `ScheduleBillingLifecycleNotificationsService` (delivery half), `DeliverAdminSystemNotificationService` (delivery half). Claims pending/scheduled intents, runs delivery attempts, handles escalation, marks dead-letter.
- `infrastructure/notifications/channel-adapters/`
  - `telegram-thread-channel.adapter.ts`
  - `web-thread-channel.adapter.ts`
  - `web-notification-center-channel.adapter.ts`
  - `email-channel.adapter.ts` (Postmark)
  - `admin-webhook-channel.adapter.ts`
  - `web-push-channel.adapter.ts` (Slice 5+, stub interface in Slice 1)
  - `mobile-push-channel.adapter.ts` (Slice 5+, stub interface in Slice 1)
- `application/notifications/render/grounded-llm-renderer.service.ts` — used only for `conversational`
- `application/notifications/render/template-renderer.service.ts` — registry of MJML/text templates by id
- `application/notifications/render/static-fallback-renderer.service.ts`

All channel adapters implement the shared interface:

```
deliver(intent, renderedPayload, channelConfig): Promise<DeliveryResult>
```

`DeliveryResult` is `{ status: "delivered" | "failed" | "bounced" | "complaint", providerRef?, error? }`.

## Admin > Notifications target shape

Operator-only single-user surface. The current `apps/web/app/admin/notifications/page.tsx` is rewritten in Slice 1 (foundation) and grown in Slice 4 (full surface). The legacy notification UI living in `Admin > Billing Settings` (lifecycle notification block) and `Admin > Ops` (`latestNotificationJobs` card) is deleted, not relinked. There is one notification operator surface, and it is `Admin > Notifications`.

### Sections

1. **Channels** — registry view; per channel: enabled toggle, config form (endpoint URL + signing secret for webhook, sender domain for email, sender name for telegram, etc.), health indicator (`healthy` / `degraded` / `down` / `unconfigured`), last delivery and last failure timestamps, optional test-send button.
2. **Policies** — per source row: enabled, channels (drag to reorder), cooldown, max per day, escalation (after-minutes + target channel), render strategy, render instruction id / template id, respect-quiet-hours flag.
3. **Quiet hours** — single workspace-level form: enabled, start, end, timezone mode (`workspace_default` / `per_user_resolved`), default timezone, applies-to-sources multiselect (with `reminder` excluded by default and an explicit warning if the operator opts it in).
4. **Delivery history** — paginated, server-side filters by source, class, channel, status, date range; row contains intent id, dedupe key, attempts count, latency, outcome, channel; row click opens a detail drawer with full delivery attempt log and structured-log trace id.
5. **Dead letters** — list of stuck/failed intents; per row: replay (re-attempt with fresh delivery attempt under the same intent) or discard (mark resolved without sending); detail drawer shows last error, escalation history, and original fact payload.
6. **Preview / test-send** — for any policy, render with sample factPayload (template) or live-call grounded_llm renderer with sample facts; never persists, never sends to real recipients, never charges quota; clearly labeled as dry-run.

### API surface under `/api/v1/admin/notifications/`

- `GET /channels` / `PATCH /channels/:type` / `POST /channels/:type/test-send`
- `GET /policies` / `PATCH /policies/:source`
- `GET /quiet-hours` / `PATCH /quiet-hours`
- `GET /deliveries` (paginated, server-side filters: source, class, channel, status, dateFrom, dateTo)
- `GET /deliveries/:intentId` (detail with attempt log)
- `GET /dead-letters` / `POST /dead-letters/:id/replay` / `POST /dead-letters/:id/discard`
- `POST /preview` (renderer dry-run, never sends)

All admin notification endpoints go through the generated `@persai/contracts` client. Hand-rolled `fetch` calls (current quota-advisory policy fetch is the offender) are removed in Slice 1. The legacy split admin endpoints listed in principle 13 are removed.

### UI quality contract

The notification admin surface is the operator's daily tool, not a feature-card collection. Slice 1 establishes the shell and Slice 4 finishes the contents. Both slices honor:

- the page is split into real components in `apps/web/app/admin/notifications/_components/` (one component per section); the current single-file page is dissolved
- explicit `loading`, `empty`, and `error` states for every data-driven section (no silent blank panels)
- delivery history and dead-letter lists use server-side pagination and server-side filtering; client-only filtering is forbidden because the data set grows with usage
- forms use the same admin form patterns already used elsewhere in the admin surface (no ad-hoc styling)
- destructive actions (discard dead letter, reset channel config) require explicit confirmation
- the operator can copy intent id / dedupe key / trace id with one click for log correlation
- accessibility: keyboard navigation, focus management, semantic table markup
- all admin notification fetches go through generated contracts; no hand-rolled `fetch`

## Migration plan

Four bounded slices. Each slice is large enough to be a coherent product step and small enough to ship and verify in one focused session. Each slice ends with the legacy paths it absorbed deleted from the codebase.

### Slice 1 — Foundation, adapters, email sender, observability

Goal: make the unified platform exist end-to-end with all enums, tables, services, channel adapters, structured logs, and a real email sender — but do not migrate producers yet.

In scope:

- Prisma migration adding all target-state tables and enums listed above
- `NotificationIntentService`, `NotificationRoutingService`, `NotificationDeliveryWorkerService`
- All channel adapters wired into the DI graph: `email` (Postmark, real send), `admin_webhook` (real send); `telegram_thread`, `web_thread`, and `web_notification_center` are wired stubs that return `delivered` for any worker-driven intent — they become real in Slice 2 when their producers are migrated; `web_push` and `mobile_push` are stub interfaces only
- Postmark `EmailChannelAdapter` with verified sending domain configured in Helm values for `persai-dev`; first TS template module (`billing.payment_recovered`) addressable by template id
- Postmark bounce webhook ingress controller and channel health update path
- Channel registry seed for `persai-dev`: `telegram_thread`, `web_thread`, `web_notification_center`, `email`, `admin_webhook` (others stay `unconfigured`)
- Admin notification controllers: channel CRUD, policy CRUD, quiet hours CRUD, deliveries list (read-only), dead-letter list/replay/discard, preview
- Generated contracts regenerated; web admin client uses generated client only (no hand-rolled fetch)
- Structured log fields and event names wired into intent service and worker
- ADR-088 entries in `ARCHITECTURE.md`, `API-BOUNDARY.md`, `DATA-MODEL.md`, `TEST-PLAN.md` updated to point at the now-real architecture

Out of scope: migrating any current producer.

Acceptance: a synthetic admin-only `POST /api/v1/admin/notifications/preview` round-trip works for both `template` (Postmark sandbox / dev domain) and `grounded_llm` (LLM dry-run); admin > notifications page reflects channel registry; no production user notification path uses the new platform yet.

### Slice 2 — Conversational migration (LANDED 2026-05-08)

Goal: migrate every assistant-authored conversational notification to the unified platform and delete the legacy assistant outbox.

In scope:

- Replace `AssistantNotificationOutboxService` callers with `NotificationIntentService.createIntent({ class: "conversational", ... })`:
  - idle reengagement scheduler
  - background task scheduler push
  - internal cron reminder fire
  - quota advisory follow-up (ADR-087) — `QuotaAdvisoryFollowUpService` becomes a thin renderer that hands an intent to the platform; per-thread dedupe moves to `notification_intents.dedupeKey`; delivery happens via routing instead of a direct chat-message write
- `AssistantNotificationDeliveryService` is replaced by the new worker + channel adapters
- `TelegramThreadChannelAdapter`, `WebThreadChannelAdapter`, `WebNotificationCenterChannelAdapter` made real (no dry-run `delivered` stubs)
- `assistant_notification_outbox`, `assistant_quota_advisory_states`, `workspace_notification_policies` (idle + quota rows) dropped after data migration into `notification_intents` / `notification_policies`; `AssistantNotificationOutboxSource`, `AssistantNotificationOutboxStatus`, `WorkspaceNotificationPolicySource` enums removed
- `whatsapp` removed from `AssistantPreferredNotificationChannel` (no real adapter); `CONNECTABLE_PROVIDER_KEYS`, `AUTO_SELECTABLE_CHANNELS`, `ALLOWED_CHANNELS` constants cleaned up
- `system_event` source retained as enum-only with no producer call sites; documented in DATA-MODEL.md as reserved for Slice 4
- Quiet hours enforced in `NotificationIntentService` for non-immediate conversational sources
- `GroundedLlmRendererService` short-circuits on `factPayload.pushText` when pre-rendered text is supplied (used by `QuotaAdvisoryFollowUpService` to preserve in-turn LLM timing)
- `ScheduleBillingLifecycleNotificationsService` opportunistically migrated to `NotificationIntentService` (transactional class) since it depended on the deleted outbox service
- Legacy admin endpoints `GET/PATCH /admin/notifications/policies/idle-reengagement` and `GET/PATCH /admin/notifications/policies/quota-advisory` removed; `ManageAdminNotificationChannelsService` stripped to webhook-only methods
- OpenAPI schemas and generated contracts cleaned of all removed types
- Web admin client (`assistant-api-client.ts`) cleaned of all legacy policy function bindings

Out of scope: billing lifecycle email delivery, admin webhook, push channels.

Acceptance met 2026-05-08 (closed after 11-item audit 2026-05-08): idle, quota advisory, reminder, and background task notifications flow only through `notification_intents`; no `assistant_notification_outbox` row creation in code or database after migration; all legacy services deleted; verification gate (lint + format:check + both typechecks + full API test suite) green.

**Audit fixes applied in closeout (all 11):**

1. `QuotaAdvisoryFollowUpService.maybeCreateFollowUp` now passes `allowedChannels: ["telegram_thread"]` for `surface="telegram"` and `["web_thread"]` for `surface="web"` into `createIntent`, preventing policy-level channel list from routing an active-turn advisory to the wrong surface channel.
2. `PATCH /admin/notifications/channels/webhook` path and `PatchAdminNotificationWebhookChannel*` / `AdminNotificationChannelState` / `AdminNotificationChannelType` / `AdminNotificationChannelStatus` / `AdminNotificationDeliveryStatus` schemas removed from `openapi.yaml`; contracts regenerated; generated files prettier-formatted.
3. `AssistantPreferredNotificationChannel` in `apps/web/app/app/assistant-api-client.ts` narrowed to `"web" | "telegram"` (no `whatsapp`).
4. `patchAdminNotificationWebhookChannel` import, export, and wrapper function deleted from `assistant-api-client.ts`; `AdminNotificationChannelState` / `PatchAdminNotificationWebhookChannelRequest` type re-exports removed.
5. `ManageAdminNotificationChannelsService` import and `providers[]` entry removed from `workspace-management.module.ts`; service file and its test deleted (service had no constructor injection sites — pure dead provider).
6. Stale comment in `apps/api/test/sync-telegram-chat-target.service.test.ts` referencing `AssistantNotificationDeliveryService` updated to reference `TelegramThreadChannelAdapter`.
7. Three new focused adapter tests added: `telegram-thread-channel.adapter.test.ts`, `web-thread-channel.adapter.test.ts`, `web-notification-center-channel.adapter.test.ts` — all pass.
8. New `quota-advisory-follow-up.service.test.ts` added — covers web/telegram surface `allowedChannels`, `traceId` forwarding, `no_push` branch, and no-candidates early return.
9. `notification-delivery-worker.service.test.ts` extended with Part B: real worker instantiation, future `scheduledAt` not claimed, elapsed `scheduledAt` claimed, dedupe-collision at intent-service level (one row in store), primary failure → escalation success.
10. All producers now stamp `traceId` on `createIntent` per ADR §11: `QuotaAdvisoryFollowUpService` accepts `traceId` from callers; `SendWebChatTurnService`, `StreamWebChatTurnService`, `HandleInternalTelegramTurnService` forward `trace.getTraceId()`; `PersaiIdleReengagementSchedulerService` generates a per-batch UUID; `PersaiBackgroundTaskSchedulerService` generates a per-task UUID; `HandleInternalCronFireService` uses `input.jobId` as traceId.
11. `docs/TEST-PLAN.md` Slice 2 table updated with all four new test files and expanded worker row.

**Soft observation decisions made in closeout:**

- **Worker poll latency (0–10 s):** The 10 s poll interval is documented as an acceptable behavior change from the former synchronous direct-write path. `immediate` priority intents are claimed on the next poll cycle (within 10 s), which is sufficient for quota advisory and background task push use cases. If sub-second delivery is needed in a future slice, a notify-then-poll mechanism or a priority-queue push should be added. This is not in scope for Slice 2.
- **`reminder` and cron context:** `HandleInternalCronFireService` does not carry active-chat context (`surface`, `chatId`) — it fires from a system job. Operators must configure `reminder` policies to use `telegram_thread` only until a future enhancement threads chat context through the cron payload. This constraint is reflected in `Admin > Notifications` policy editor guidance. Adding chat context to the cron payload is deferred to Slice 3 or a separate ADR.
- **`reminder` quiet hours:** `notification_policies.respectQuietHours` defaults to `true` in Prisma schema; ADR §6 states reminders default to `false`. The producer call site passes `respectQuietHours: false` explicitly, which overrides the DB default per intent. Schema default and ADR remain technically inconsistent for the policy row, but the per-intent override makes runtime behavior correct. A clean fix (migration to set the seeded `reminder` policy row's `respectQuietHours = false`) is deferred to Slice 3 as a migration alongside the billing lifecycle work.

### Slice 3 — Transactional migration (LANDED 2026-05-08)

Goal: migrate billing lifecycle to the unified platform with real email delivery.

In scope:

- Replace `ScheduleBillingLifecycleNotificationsService` with a producer that creates `notification_intents` (`class: "transactional"`, `priority: "scheduled"`, `renderStrategy: "template"`)
- Email path goes through the Postmark adapter created in Slice 1; all six billing rules (`trial_ending`, `trial_expired`, `renewal_failed`, `grace_ending`, `grace_expired`, `payment_recovered`) have TypeScript deterministic template modules (inline HTML; MJML pipeline deferred to a future pass as noted in §10)
- Optional assistant push is created as a second intent (`class: "conversational"`, `templateId` for a deterministic short message; not `grounded_llm` because billing facts must remain deterministic; `allowedChannels: ["web_notification_center"]`)
- `billing_lifecycle_notification_jobs` DROPPED in migration `20260508233251_adr088_slice3_billing_policy`
- Billing lifecycle policy moved from `BillingLifecycleSettings.metadata` into `notification_policies` rows (one row per workspace, `source=billing_lifecycle`, per-rule sub-policy in `config` JSON); the notification policy block on `Admin > Billing Settings` is deleted; operator manages billing notification policy from `Admin > Notifications` only
- Legacy contract types `AdminBillingLifecycleNotificationCode/Rule/Policy` and `AdminOpsCockpitBillingNotificationJob` removed from `openapi.yaml` and generated contracts
- `latestNotificationJobs` removed from `AdminOpsCockpitBillingSupport` schema and ops cockpit UI (card now links to Admin > Notifications)
- `reminder` quiet-hours fix from Slice 2 notes applied: migration sets `respectQuietHours = false` for reminder policy rows

Closed must-fix items: ✓ Producer replaced, ✓ Table dropped, ✓ Policy migrated, ✓ Admin block removed, ✓ Contracts cleaned, ✓ All residue zero.

Acceptance status: gates green, residue zero. Live verification (S3.9 — real test inbox in persai-dev) pending deployment.

### Slice 2.5 — Multi-user correction (LANDED 2026-05-09, closeout 2026-05-09)

Goal: collapse `notification_channel_registry` / `notification_policies` / `notification_quiet_hours` from per-workspace rows to global singletons, auto-derive per-workspace channel availability from existing PersAI sources, move Postmark credentials to `Admin > Tools`, and remove the seed-on-deploy hack.

Delivered:

- Prisma migration `20260509000000_adr088_global_notification_truth`: aggregates existing per-workspace rows into one global row per channelType/source (aborts with `RAISE EXCEPTION` if divergence detected); drops `workspace_id` column + per-workspace unique index; adds `UNIQUE(channelType)` / `UNIQUE(source)` / singleton boolean; keeps `workspaceId` on `notification_intents` and `notification_dead_letters`. `notification_delivery_attempts` deliberately does NOT carry its own `workspaceId` — workspace is derived through the parent `intentId` join (see `ManageNotificationPlatformService.listDeliveries`); this matches the on-disk schema and avoids unnecessary churn.
- `ResolveWorkspaceNotificationChannelsService` with `resolveChannel(workspaceId, channelType)`, `resolvePolicy(source)`, and `resolveQuietHours()` reading global singletons with code-default fallback.
- `NotificationDeliveryWorkerService` and `NotificationIntentService` consume the resolver exclusively (not per-workspace registry lookup, no inline defaults).
- All code-level defaults moved to `apps/api/src/modules/workspace-management/application/notifications/defaults/notification-defaults.ts` (`NOTIFICATION_POLICY_DEFAULTS`, `NOTIFICATION_QUIET_HOURS_DEFAULT`, `NOTIFICATION_CHANNEL_REGISTRY_DEFAULTS`). Every `NotificationSource` and `NotificationChannelType` is covered.
- Postmark credentials migrated to `Admin > Tools` credential store (`notification/email/postmark/api-key`, `notification/email/postmark/webhook-token`); `EmailChannelAdapter` and `HandlePostmarkWebhookService` resolve exclusively via `PlatformRuntimeProviderSecretStoreService` — no `process.env["POSTMARK_*"]` fallbacks.
- `Admin > Tools` UI: new "Notifications" section listing both Postmark credential cards.
- `infra/helm/values-dev.yaml`: `POSTMARK_SERVER_TOKEN` / `POSTMARK_WEBHOOK_TOKEN` / `POSTMARK_SENDER_DOMAIN` slots removed.
- `seedNotificationChannelRegistry` and the "for all active workspaces" loop deleted from `seed.ts`. Seed writes zero notification rows.
- Timezone-aware `nextWindowEnd` bug fixed in `NotificationRoutingService`: UTC offset computed from `Intl.DateTimeFormat` rather than server local time.
- Admin > Notifications rebuilt as compact operator surface: channel health strip, summary line, collapsible delivery history and dead letters (default collapsed), per-section expand badges.
- Hard-cut residue greps all zero in `apps/api/src` + `apps/web/app` + `packages/contracts`.
- All 5 verification gates green (lint, format:check, API typecheck, web typecheck, API test suite).

**Closeout 2026-05-09 (audit follow-through):**

- Code residue cleared: `BillingLifecycleProducerService` JSDoc no longer names the deleted `ScheduleBillingLifecycleNotificationsService`.
- Resolver hardened: `telegram_thread` requires `AssistantChannelSurfaceBinding.bindingState=active`; `web_thread` and `web_notification_center` are always available per workspace (registry row is advisory, never a gate); return type changed from `ResolvedChannel | null` to a discriminated `ChannelResolution` union with explicit `reason` (`auto_derive_unavailable` / `channel_disabled_globally` / `channel_unhealthy`); every caller (`NotificationIntentService`, worker, routing/preview) updated to consume the new shape — no silent nulls.
- Defaults extracted: inline `POLICY_DEFAULTS` / `DEFAULT_QUIET_HOURS` were moved to `defaults/notification-defaults.ts`; resolver, worker, and intent service all import from one place. A fresh DB now works without seed.
- Schema decision (C1): `notification_delivery_attempts` keeps no `workspaceId` column; ADR + DATA-MODEL.md amended to declare workspace derivation via the `intentId` join. Less code churn, fully consistent with admin-cockpit query surface.
- Authz gap on `POST /admin/notifications/channels/:channelType/test-send` closed: `ManageNotificationPlatformService.assertAdminAccess` is now invoked before the dry-run payload is returned. Covered by `apps/api/test/admin-notifications.controller.authz.test.ts` (every notifications admin endpoint, including test-send, asserts `ForbiddenException` for non-admin user).
- Doc sync: `DATA-MODEL.md` rewritten to mark singletons as global, drop `billing_lifecycle_notification_jobs`, and document per-event vs. singleton split. `API-BOUNDARY.md` documents the Postmark credential ids in tool-credentials. `TEST-PLAN.md` adds a Slice 2.5 subsection with run commands and interpretation rules.

**Operator pre-deploy action (before merge to persai-dev):** paste the existing Postmark Server Token and Webhook Token into `Admin > Tools > Notifications` before the migration runs, so email delivery has zero downtime.

Acceptance: gates green, residue zero. Live verification (fresh workspace through resolver path) pending persai-dev deployment.

### Slice 4 — Operational/admin migration and admin surface completion

**Status: LANDED 2026-05-09 (commit 3f463b7c)**

Goal: migrate admin webhook deliveries and finish the admin surface.

In scope:

- `DeliverAdminSystemNotificationService` becomes a producer that creates `notification_intents` (`class: "operational"` for delivery failures / `class: "administrative"` for audit-driven alerts)
- `WorkspaceAdminNotificationChannel` is replaced by `notification_channel_registry` rows
- `admin_notification_deliveries` is replaced by `notification_delivery_attempts`
- `Admin > Notifications` gets the full surface listed above (history filters, dead-letter replay/discard, preview/test-send working for all channels, channel test-send buttons), built from the per-section components introduced in Slice 1
- the `latestNotificationJobs` card in `Admin > Ops` was deleted in Slice 3 (card now links to Admin > Notifications); no action needed in Slice 4
- Web push and mobile push channel registry slots become editable but remain `unconfigured` (real adapters land later, not in this ADR)

Acceptance: no notification path in `apps/api/src` writes to the legacy notification tables; legacy tables are dropped; admin operator can configure all policies, see delivery history, replay dead letters, preview templates, and run test-send on each configured channel.

### Out-of-ADR (future, separate ADRs)

- Web push and mobile push real adapters (Slice for FCM/APNs, service worker subscriptions, Capacitor permission UX)
- Digest priority semantics (collected daily/weekly summaries)
- Per-user transactional email opt-out beyond `List-Unsubscribe`
- Datadog/Grafana adoption layered on the existing structured-log fields

## Non-goals

ADR-088 does not:

- replace admin console workflows with notification workflows
- make every notification assistant-authored (conversational only)
- introduce freeform LLM rendering for billing/admin/ops content
- promise web/mobile push delivery in initial slices
- introduce per-type user opt-out preferences (channel preference only, since no real users exist yet)
- introduce a separate observability stack (structured logs only)

## Consequences

### Positive

- one notification architecture replaces six partial subsystems
- channel decisions, rendering decisions, escalation, and delivery audit become explicit and uniform
- conversational, transactional, admin, and ops notifications stop drifting apart
- real email becomes a working transport for the first time
- `Admin > Notifications` becomes the real operator surface
- future channels and notification types are migration exercises, not fresh architecture decisions
- structured log contract gives a clean upgrade path to Datadog/Grafana later without rewriting producers

### Negative

- Slice 1 is foundational and produces no user-visible feature on its own; it is necessary scaffolding
- some current services and tables temporarily coexist during migration, but never longer than one slice
- transactional and conversational notifications cannot be naively merged without explicit class boundaries and renderer rules — agents must follow the class/strategy matrix exactly

## Alternatives considered

- Keep adding notification features per domain with local senders. Rejected: drift is already visible and would compound.
- Make all notifications assistant-authored from LLM output. Rejected: billing/admin/ops content must be deterministic.
- Defer this until real users exist. Rejected: there is no user data to migrate yet, so the cost of consolidating is at its lowest right now.
- Adopt Datadog/Grafana before consolidating. Rejected: structured logs are sufficient for a single-operator surface, and the log contract makes future adoption non-blocking.

## Notes for implementing agents

- This ADR is the source of truth for all notification work after 2026-05-08 (revised 2026-05-09 with multi-user correction). Any drift between an implemented slice and this document must update the document or be reverted.
- **Multi-user invariant:** `notification_channel_registry`, `notification_policies`, `notification_quiet_hours` are GLOBAL singleton tables — no `workspaceId` column. Per-workspace channel availability is auto-derived at delivery time from existing PersAI truth (`AppUser.email`, `AssistantChannelSurfaceBinding`, intent context). `notification_intents`, `notification_delivery_attempts`, `notification_dead_letters` keep `workspaceId` because they describe individual user events. Never re-introduce per-workspace config rows. Never write notification-config rows from `seed.ts` or `UpsertOnboardingService` or any onboarding/registration path — a fresh user must work via code defaults + auto-derived channels alone.
- **Postmark credentials live in `Admin > Tools`** (`TOOL_CREDENTIAL_IDS` entries `notification/email/postmark/api-key` and `notification/email/postmark/webhook-token`), not in Helm secrets. `EmailChannelAdapter` and `HandlePostmarkWebhookService` resolve via `PlatformRuntimeProviderSecretStoreService`. Adding new email/notification credentials follows the same pattern.
- Each slice ends with the legacy table(s), legacy service class(es), legacy admin endpoint(s), legacy contracts type(s), and legacy admin UI block(s) it absorbs deleted. If a slice cannot delete cleanly, the slice is incomplete.
- No feature flag, env toggle, or `if (newPlatformEnabled)` switch is permitted to keep legacy and unified paths alive in parallel. Each slice is a hard cut for the area it covers.
- New notification features started after Slice 1 are forbidden from creating new direct-send services. Use `NotificationIntentService.createIntent(...)`.
- All names in this document (table names, enum values, service names, file paths, admin API paths, channel adapter names) are normative. Use them exactly. Pick a different name only with a follow-up ADR.
- The admin surface is rewritten as multi-component, not patched, and is laid out per §12 (compact header strip, collapsible delivery history and dead-letters, in-place policy editing). Do not put a wall of tables on the page.
- `infra/helm/values-dev.yaml` `global.images.tag` is GitOps-owned. Code changes never edit it. Adding/removing env or secretEnv slots is allowed when doing so reflects a real architectural change (e.g. removing `POSTMARK_*` slots in Slice 2.5).
- Verification gate is global (`corepack pnpm run format:check` over the whole repo, not just modified files). After any contract regeneration, run `corepack pnpm exec prettier --write "packages/contracts/src/generated/**/*.{ts,js}"`.
- API tests use the project pattern: top-level `void run()` IIFE + `node:assert/strict`, executed via tsx by `apps/api/test/run-suite.ts`. Not vitest.
- NestJS DI: required dependencies typed by concrete class, never `Pick<...>`. Optional dependencies use `@Optional()` explicitly.
