# ADR-088: Unified notification platform, control plane, and delivery architecture

## Status
Accepted

## Date
2026-05-08

## Relates to
ADR-041, ADR-056, ADR-077, ADR-083, ADR-084, ADR-087

## Context

PersAI now has several real notification-producing systems, but they are still split by product area and delivery style:

- assistant conversational follow-ups in active chat/thread surfaces
- assistant notification outbox delivery for reminders, background tasks, and idle reengagement
- billing lifecycle notification jobs with required email and optional assistant push
- admin notification webhook channels and delivery logs
- workspace-scoped notification policy rows for selected sources such as `idle_reengagement` and `quota_advisory`

This means the repo already contains durable notification infrastructure, but not one unified product architecture.

Current state in repo truth:

- `assistant_notification_outbox` + `AssistantNotificationOutboxSchedulerService` own durable assistant push delivery for reminder/background-task/idle-reengagement/billing assistant notifications
- `AssistantNotificationDeliveryService` resolves Telegram vs web fallback and persists delivered artifacts/messages
- `billing_lifecycle_notification_jobs` is a separate transactional notification queue with its own scheduling logic, required email semantics, and optional assistant push enqueue into the assistant outbox
- admin system notifications use `workspace_admin_notification_channels` and `admin_notification_deliveries`, currently centered on webhook delivery for high-signal admin/system events
- `workspace_notification_policies` stores source-specific policy rows, currently including `idle_reengagement` and `quota_advisory`
- `Admin > Notifications` already exists, but today it is still a partial control surface rather than the canonical home for all notification classes and channels

That split is no longer sufficient.

PersAI needs one notification architecture that can describe and deliver:

- user conversational warnings and nudges in the active surface
- user transactional billing/trial/subscription notifications
- email notifications
- push notifications
- webhook/admin/system notifications
- admin/operator delivery health, policy, audit, and replay

Founder/product constraints already visible in current ADRs:

- conversational user warnings may be assistant-authored, but only from grounded facts (`ADR-087`)
- billing/trial/subscription notifications are policy-driven, durable, and must remain PersAI-owned truth (`ADR-083`, `ADR-084`)
- reminders/tasks/background actions are PersAI-owned product behavior, not native runtime truth (`ADR-056`, `ADR-077`)
- admin notifications must remain system/admin oriented and not collapse admin workflows into pseudo-chat messaging (`ADR-041`)

If PersAI continues to grow notification behavior feature-by-feature, the result will be duplicated routing, duplicated rendering, duplicated dedupe/cooldown logic, and incompatible admin surfaces.

## Decision

PersAI will adopt one unified notification platform with a single control-plane model for notification intents, policy resolution, channel routing, rendering strategy, durable delivery, and audit.

## Core decisions

### 1. Notification intent becomes the product-level source of truth

PersAI will treat every user/admin/system notification as a notification intent, not as a channel-specific side effect.

The target-state notification intent envelope must be able to express:

- source domain
- notification type
- audience
- class
- workspace/user/assistant ownership
- optional active-thread context
- required facts payload
- policy snapshot
- rendering strategy
- allowed/preferred channels
- idempotency/dedupe key
- priority

Direct channel sends are not target-state product truth.

### 2. One platform serves multiple notification classes

PersAI notifications are divided into four explicit classes:

1. `conversational`
   - active-thread assistant follow-ups such as quota advisories, idle reengagement, reminder nudges, and future soft in-thread warnings

2. `transactional`
   - payment success, renewal failure, grace/fallback lifecycle notices, checkout/billing state changes, receipts, and other deterministic user/account notifications

3. `operational`
   - delivery failures, channel disconnects, webhook failures, dead-letter growth, provider degradation signals, and other system/ops alerts

4. `administrative`
   - admin/operator/founder alerts, support escalations, policy misconfiguration warnings, and other control-plane notifications

Every notification type must declare its class explicitly. The class determines allowed renderers, allowed channels, and policy semantics.

### 3. Rendering strategy is explicit, not implied by source

PersAI supports three rendering strategies:

1. `grounded_llm`
   - allowed only for conversational notification classes
   - must be based on structured facts
   - must obey source-specific policy and guardrails

2. `template`
   - required for transactional, operational, and administrative notifications unless a later ADR explicitly expands grounded rendering
   - localized, deterministic, and audit-safe

3. `static_fallback`
   - emergency fallback only when the intended renderer cannot produce deliverable output

Billing lifecycle, legal-ish confirmations, receipts, admin alerts, and ops messages must not depend on assistant-style freeform generation.

### 4. Channel routing is policy-driven and channel adapters stay dumb

Channel adapters may deliver notifications, but they do not own product policy.

Routing decisions belong to a shared notification routing layer that resolves:

- whether this notification is enabled
- whether it is immediate, scheduled, digestable, or skippable
- whether it is allowed in active chat/thread
- which channels are allowed and preferred
- whether fallback between channels is allowed
- whether escalation is required

Current and future channels include:

- active web chat thread
- active Telegram thread
- web notification center / system notifications thread
- email
- mobile/web push
- admin webhook
- future admin inbox / ops center surfaces

### 5. Durable delivery uses one shared backbone

PersAI keeps durable delivery as control-plane truth.

Target-state backbone responsibilities:

- enqueue notification intents/jobs durably
- dedupe/idempotency
- claim/retry/dead-letter
- channel delivery attempt tracking
- delivery result audit
- replay/manual resend for permitted notification classes

The existing `assistant_notification_outbox` path is part of this backbone, but it is not sufficient as the only current-state model because billing lifecycle jobs and admin webhook deliveries remain separate today.

The target state is not necessarily one physical table immediately, but one coherent platform model. Any parallel queues that remain during migration are transitional only.

### 6. `Admin > Notifications` becomes the canonical control plane

`Admin > Notifications` is the canonical operator surface for notification governance.

The target-state admin surface owns:

- channel configuration and health
- per-type policy and routing
- render strategy and operator instructions
- cooldown/dedupe/escalation controls
- delivery history
- dead-letter/retry/replay controls
- future previews/test-send tooling

This page must stop being a collection of feature-specific cards and become the control plane for all PersAI notification classes.

### 7. Conversational notifications stay active-surface aware

When a notification is conversational:

- active web and Telegram thread delivery is first-class product behavior
- the notification may appear as an assistant-authored message or follow-up in the active surface when policy allows
- active-thread delivery still belongs to the unified notification platform, not a separate special-case architecture

`ADR-087` quota advisories are therefore one notification type inside the future platform, not a standalone permanent subsystem.

### 8. Transactional billing notifications stay PersAI-owned and deterministic

Billing lifecycle notifications remain PersAI-owned truth:

- event-driven from subscription/payment lifecycle state
- required email remains required
- assistant push remains optional policy-driven delivery
- content remains deterministic/template-based unless a later ADR explicitly changes that

The future unified platform must absorb current `billing_lifecycle_notification_jobs` into the common model without weakening email requirements or lifecycle truth.

### 9. No new direct-send paths

After ADR-088 slices start landing, new notification features must not create fresh direct-send paths that bypass:

- notification intent creation
- policy resolution
- routing
- durable delivery/audit

The migration rule is strict: each landed slice must delete the superseded legacy path in the touched area.

## Admin control-plane target shape

`Admin > Notifications` should converge on six bounded sections.

### 1. Channels

Canonical channel registry and health for:

- webhook
- email
- active-thread assistant push
- web notification center
- mobile/web push
- future channels

Per channel:

- enabled state
- config/credentials presence
- health/last delivery
- failure status
- optional test-send

### 2. Policies

Per notification type or grouped family:

- idle reengagement
- quota advisory
- reminder/user nudge
- billing lifecycle
- payment success/failure
- admin/system alerts
- future operational alerts

Policy controls:

- enabled
- delivery channels
- cooldown/dedupe
- timing rules
- escalation rules
- active-thread eligibility

### 3. Rendering

Per notification type:

- render strategy
- template or instruction source
- preview/guardrails
- locale behavior

### 4. Audience and preference rules

Controls for:

- user eligibility
- assistant availability
- workspace-level defaults
- admin-only / founder-only routing
- future user-facing notification preferences

### 5. Delivery history

Durable audit surface for:

- intent created
- policy chosen
- renderer used
- channel selected
- attempts
- result
- dedupe/skip reason

### 6. Dead letters and replay

Operational controls for:

- failed notifications
- stuck notifications
- replay/resend where safe
- channel health investigation

## Migration truth from current state

Current repo paths should be treated as partial predecessors of the target-state platform:

- `assistant_notification_outbox` + scheduler + delivery service
- `workspace_notification_policies`
- `workspace_admin_notification_channels`
- `admin_notification_deliveries`
- `billing_lifecycle_notification_jobs`
- `Admin > Notifications`

ADR-088 does not say all of these are wrong. It says they are incomplete and must be unified under one notification architecture.

## Non-goals

ADR-088 does not:

- replace admin console workflows with notification workflows
- make every notification assistant-authored
- introduce freeform LLM rendering for billing/admin/ops content
- require one giant all-at-once migration
- promise every future channel immediately

## Execution slices

### Slice 1 - Inventory and target model

- inventory every notification producer in repo
- classify by source, audience, class, channel, renderer, and durability
- define target notification intent model and migration rules
- document what current tables/services remain transitional

### Slice 2 - Unified control-plane schema and policy model

- converge source-specific notification policy islands into one coherent model
- define channel registry/health model
- define notification intent/job model
- define audit/delivery attempt model

### Slice 3 - Transactional and admin migration

- migrate billing lifecycle jobs/email/assistant push under the shared platform model
- migrate admin/system webhook notifications under the same control plane
- keep deterministic template rendering

### Slice 4 - Conversational migration

- migrate idle reengagement, reminders, quota advisories, and future in-thread user warnings
- reuse shared intent/policy/routing model
- keep grounded active-thread delivery where appropriate

### Slice 5 - Admin surface completion

- turn `Admin > Notifications` into the full notification control plane
- add history/dead-letter/replay/preview/test-send/operator tooling

## Consequences

### Positive

- one notification architecture replaces multiple partial subsystems
- channel decisions, rendering decisions, and delivery audit become explicit
- conversational, transactional, admin, and ops notifications stop drifting apart
- `Admin > Notifications` becomes the real operator surface instead of a feature-specific settings page
- future channels and notification types become migration exercises, not fresh architecture decisions every time

### Negative

- the migration spans API, web, data model, billing, reminder/background-task, and admin surfaces
- some current services and tables will temporarily coexist during migration
- transactional and conversational notifications cannot be naively merged without explicit class boundaries and renderer rules

## Alternatives considered

- Keep adding notification features per domain (`quota`, `billing`, `reminders`, `admin`) with local senders: rejected because drift is already visible and would get worse.
- Make all notifications assistant-authored from LLM output: rejected because billing/admin/ops notifications need deterministic factual rendering.
- Keep `Admin > Notifications` bounded only to reminder/quota feature cards: rejected because the product already has multiple notification systems that need one control plane.
