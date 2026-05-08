# ADR-088: Unified notification platform, control plane, and delivery architecture

## Status

Accepted (revised 2026-05-08 with concrete schema, escalation, quiet hours, email provider, observability contract after PROD audit)

## Date

2026-05-08

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

### 4. Channel registry, capabilities, and dumb adapters

Channel adapters deliver notifications. They do not own product policy, dedupe, or escalation logic.

Target-state channel registry includes:

- `telegram_thread` (rich text, media, in active assistant chat)
- `web_thread` (rich text, media, in active assistant chat)
- `web_notification_center` (in-app system thread `system:notifications`, today's web fallback)
- `email` (transactional only, Postmark)
- `admin_webhook` (operational/administrative outbound HTTPS with HMAC)
- `web_push` (browser push, future)
- `mobile_push` (FCM/APNs via Capacitor shell, future)

Per channel: `enabled`, `config` (endpoint, credentials secret ref), `healthStatus` (`healthy`, `degraded`, `down`), `lastDeliveryAt`, `lastFailureAt`, `consecutiveFailures`. Health status is updated by the delivery worker and consumed by routing.

`whatsapp` channel preference is removed from `AssistantPreferredNotificationChannel` until a real adapter exists (no half-implemented options in user-facing settings).

### 5. Policy-driven routing with explicit timing semantics

Routing resolves per intent:

- whether the type is enabled for this workspace
- which channels are allowed and in which order
- whether fallback is allowed
- whether escalation is required and to which channel after how many minutes
- whether quiet hours apply for this type
- whether per-source/global rate caps allow delivery now
- whether the intent is immediate, scheduled, digest, or skippable

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

### 7. Quiet hours are timezone-aware, admin-configurable, per-source

Quiet hours apply per workspace, configured in `Admin > Notifications`:

- `quietHoursEnabled` (boolean)
- `quietHoursStart` (local time)
- `quietHoursEnd` (local time)
- `timezoneSource` (`workspace_default` or `per_user_resolved`)
- `appliesToSources` (multi-select source codes; reminders excluded by default)

When a non-immediate intent is created and falls inside quiet hours for the resolved timezone, routing defers it to the next allowed window with `lifecycleStatus = "deferred_quiet_hours"`. `immediate` priority always overrides quiet hours and is logged as an override.

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

`assistant_notification_outbox`, `billing_lifecycle_notification_jobs`, and `admin_notification_deliveries` are predecessors and are replaced by the unified backbone in their respective migration slices. Until each slice lands, the legacy table coexists transitionally; once a slice lands, the legacy table is dropped or repurposed.

### 10. Email delivery is real

Email channel uses Postmark as the transactional provider:

- sending domain `notifications.persai.dev` (SPF, DKIM, DMARC verified before Slice 3 ships)
- templates stored as versioned MJML assets compiled to HTML at build time, addressable by template id
- one `EmailChannelAdapter` service in `apps/api/src/modules/workspace-management/infrastructure/notifications/email-channel.adapter.ts`
- bounce/complaint webhook ingress at `POST /api/v1/internal/notifications/postmark-webhook` (HMAC verified) marks the user/channel `degraded` and increments `consecutiveFailures`
- transactional emails carry `List-Unsubscribe` and `List-Unsubscribe-Post` headers for one-click unsubscribe; user-level transactional opt-out is not exposed yet (no real users)

Postmark API key is stored as Kubernetes secret `persai-api-secrets` key `POSTMARK_SERVER_TOKEN`, optional in non-prod.

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

### 12. Admin > Notifications is the canonical operator control plane

`Admin > Notifications` (founder/operator-only, single-user assumption today) owns:

- channel registry view (status, config, health, test-send)
- per-source/family policy editor (enabled, channels, cooldown, escalation, quiet hours opt-in, render instruction)
- delivery history with filters (paginated, last 30 days)
- dead-letter list with replay/discard controls
- preview/test-send for grounded_llm and template renderers

This page replaces today's three-island UX (`Admin > Notifications` partial, `Admin > Billing Settings` for lifecycle policy, `Admin > Ops` for delivery glimpse).

### 13. No new direct-send paths

After Slice 1 lands, new notification features must not create fresh direct-send paths. Each landed migration slice deletes the superseded legacy path in the touched area.

## Target data model

The following Prisma models replace the legacy notification tables. Names are normative; agents implementing slices use these exactly unless a follow-up ADR changes them.

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

### `notification_channel_registry`

- `id` UUID PK
- `workspaceId` FK
- `channelType` enum `NotificationChannelType` (`telegram_thread`, `web_thread`, `web_notification_center`, `email`, `admin_webhook`, `web_push`, `mobile_push`)
- `enabled` boolean
- `config` jsonb (endpoint, credentials secret ref, locale)
- `healthStatus` enum `NotificationChannelHealth` (`healthy`, `degraded`, `down`, `unconfigured`)
- `consecutiveFailures` int default 0
- `lastDeliveryAt`, `lastFailureAt` timestamptz nullable
- `updatedAt`, `createdAt` timestamptz

### `notification_policies`

Replaces `workspace_notification_policies` and the embedded `BillingLifecycleSettings.metadata` notification policy.

- `id` UUID PK
- `workspaceId` FK
- `source` enum `NotificationSource`
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
- `config` jsonb (source-specific: `idleHours`, `offsetDays`, `assistantPushEnabled`, etc.)
- `updatedAt`, `createdAt` timestamptz

### `notification_quiet_hours`

- `id` UUID PK
- `workspaceId` FK unique
- `enabled` boolean
- `startLocal` text (HH:MM)
- `endLocal` text (HH:MM)
- `timezoneMode` enum `NotificationQuietHoursTimezoneMode` (`workspace_default`, `per_user_resolved`)
- `defaultTimezone` text nullable (used when `workspace_default` and per-recipient unknown)
- `appliesToSources` text[] (selected `NotificationSource` values; `reminder` excluded by default)
- `updatedAt`, `createdAt` timestamptz

### `notification_dead_letters`

- `id` UUID PK
- `intentId` FK
- `workspaceId` FK
- `lastError` jsonb
- `escalationAttempts` int
- `claimedForReplayAt` timestamptz nullable
- `resolvedAt` timestamptz nullable (replay succeeded or operator dismissed)
- `createdAt` timestamptz

Legacy tables to drop or repurpose per slice: `assistant_notification_outbox`, `assistant_quota_advisory_states`, `billing_lifecycle_notification_jobs`, `workspace_notification_policies`, `workspace_admin_notification_channels`, `admin_notification_deliveries`. Each slice that absorbs a producer drops the corresponding legacy table; the very last legacy table is dropped at end of Slice 4.

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

Operator-only single-user surface. Sections:

1. **Channels** — registry view; per channel: enabled toggle, config form (endpoint URL + signing secret for webhook, sender domain for email, etc.), health indicator, last delivery, optional test-send button.
2. **Policies** — per source row: enabled, channels (drag to reorder), cooldown, max per day, escalation, render strategy, render instruction id / template id, respect-quiet-hours flag.
3. **Quiet hours** — single workspace-level form: enabled, start, end, timezone mode, applies-to-sources multiselect.
4. **Delivery history** — paginated, filters by source, class, channel, status, date range; includes intent id, dedupe key, attempts, latency, outcome.
5. **Dead letters** — list of stuck/failed intents with replay (re-attempt) or discard (mark resolved without sending) actions; replay creates a new delivery attempt under the same intent.
6. **Preview / test-send** — for any policy, render with sample factPayload (template) or live-call grounded_llm renderer with sample facts; never persists or sends to real recipients.

API surface under `/api/v1/admin/notifications/`:

- `GET /channels` / `PATCH /channels/:type`
- `GET /policies` / `PATCH /policies/:source`
- `GET /quiet-hours` / `PATCH /quiet-hours`
- `GET /deliveries` (paginated, filters)
- `GET /dead-letters` / `POST /dead-letters/:id/replay` / `POST /dead-letters/:id/discard`
- `POST /preview` (renderer dry-run)

All admin notification endpoints go through the generated `@persai/contracts` client. Hand-rolled `fetch` calls (e.g. current quota-advisory policy fetch) are removed in Slice 1.

## Migration plan

Four bounded slices. Each slice is large enough to be a coherent product step and small enough to ship and verify in one focused session. Each slice ends with the legacy paths it absorbed deleted from the codebase.

### Slice 1 — Foundation, adapters, email sender, observability

Goal: make the unified platform exist end-to-end with all enums, tables, services, channel adapters, structured logs, and a real email sender — but do not migrate producers yet.

In scope:

- Prisma migration adding all target-state tables and enums listed above
- `NotificationIntentService`, `NotificationRoutingService`, `NotificationDeliveryWorkerService`
- All channel adapters except `web_push` and `mobile_push` (stub interfaces only)
- Postmark `EmailChannelAdapter` with verified sending domain configured in Helm values for `persai-dev`; first MJML template (`billing.payment_recovered`) compiled and addressable
- Postmark bounce webhook ingress controller and channel health update path
- Channel registry seed for `persai-dev`: `telegram_thread`, `web_thread`, `web_notification_center`, `email`, `admin_webhook` (others stay `unconfigured`)
- Admin notification controllers: channel CRUD, policy CRUD, quiet hours CRUD, deliveries list (read-only), dead-letter list/replay/discard, preview
- Generated contracts regenerated; web admin client uses generated client only (no hand-rolled fetch)
- Structured log fields and event names wired into intent service and worker
- ADR-088 entries in `ARCHITECTURE.md`, `API-BOUNDARY.md`, `DATA-MODEL.md`, `TEST-PLAN.md` updated to point at the now-real architecture

Out of scope: migrating any current producer.

Acceptance: a synthetic admin-only `POST /api/v1/admin/notifications/preview` round-trip works for both `template` (Postmark sandbox / dev domain) and `grounded_llm` (LLM dry-run); admin > notifications page reflects channel registry; no production user notification path uses the new platform yet.

### Slice 2 — Conversational migration

Goal: migrate every assistant-authored conversational notification to the unified platform and delete the legacy assistant outbox.

In scope:

- Replace `AssistantNotificationOutboxService` callers with `NotificationIntentService.createIntent({ class: "conversational", ... })`:
  - idle reengagement scheduler
  - background task scheduler push
  - internal cron reminder fire
  - quota advisory follow-up (ADR-087) — `QuotaAdvisoryFollowUpService` becomes a thin renderer that hands an intent to the platform; per-thread dedupe moves to `notification_intents.dedupeKey`; delivery happens via routing instead of a direct chat-message write
- `AssistantNotificationDeliveryService` is replaced by the new worker + channel adapters
- `assistant_notification_outbox`, `assistant_quota_advisory_states`, `workspace_notification_policies` (idle + quota rows) are dropped after data migration into `notification_intents` / `notification_policies`
- `whatsapp` is removed from `AssistantPreferredNotificationChannel` (no real adapter)
- `system_event` source becomes a real producer hook (used by Slice 4) and stops being dead enum
- Quiet hours actually applied for non-reminder conversational sources

Out of scope: billing lifecycle, admin webhook, push channels.

Acceptance: idle, quota advisory, reminder, and background task notifications flow only through `notification_intents`; no `assistant_notification_outbox` row creation in code or database after migration; ADR-087 active-thread quota advisory delivery still works end-to-end on web and Telegram, with policy/dedupe coming from the unified platform.

### Slice 3 — Transactional migration

Goal: migrate billing lifecycle to the unified platform with real email delivery.

In scope:

- Replace `ScheduleBillingLifecycleNotificationsService` with a producer that creates `notification_intents` (`class: "transactional"`, `priority: "scheduled"`, `renderStrategy: "template"`)
- Email path goes through the Postmark adapter created in Slice 1; all six billing rules (`trial_ending`, `trial_expired`, `renewal_failed`, `grace_ending`, `grace_expired`, `payment_recovered`) get MJML templates
- Optional assistant push is created as a second intent (`class: "conversational"`, `templateId` for a deterministic short message; not `grounded_llm` because billing facts must remain deterministic)
- `billing_lifecycle_notification_jobs` is dropped after data migration
- Billing lifecycle policy moves out of `BillingLifecycleSettings.metadata` and into `notification_policies` rows; admin billing settings page consumes the same unified policy editor lens (or links to `Admin > Notifications`)

Acceptance: real email to a verified test inbox for at least one billing rule in `persai-dev`; `Admin > Notifications` shows the delivery in history; `billing_lifecycle_notification_jobs` table is gone.

### Slice 4 — Operational/admin migration and admin surface completion

Goal: migrate admin webhook deliveries and finish the admin surface.

In scope:

- `DeliverAdminSystemNotificationService` becomes a producer that creates `notification_intents` (`class: "operational"` for delivery failures / `class: "administrative"` for audit-driven alerts)
- `WorkspaceAdminNotificationChannel` is replaced by `notification_channel_registry` rows
- `admin_notification_deliveries` is replaced by `notification_delivery_attempts`
- `Admin > Notifications` gets the full surface listed above (history filters, dead-letter replay/discard, preview/test-send working for all channels, channel test-send buttons)
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

- This ADR is the source of truth for all notification work after 2026-05-08. Any drift between an implemented slice and this document must update the document or be reverted.
- Each slice ends with the legacy table(s) it absorbs dropped. If a slice cannot drop its target legacy table cleanly, the slice is incomplete.
- New notification features started after Slice 1 are forbidden from creating new direct-send services. Use `NotificationIntentService.createIntent(...)`.
- All names in this document (table names, enum values, service names, file paths, admin API paths) are normative. Use them exactly. Pick a different name only with a follow-up ADR.
