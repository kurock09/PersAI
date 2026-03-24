# DATA-MODEL

## Foundation phase database

Postgres with Prisma.

## Initial entities

### app_users

- id (UUID)
- clerk_user_id (unique)
- email
- display_name
- terms_of_service_accepted_at (nullable)
- terms_of_service_version (nullable)
- privacy_policy_accepted_at (nullable)
- privacy_policy_version (nullable)
- created_at
- updated_at

### workspaces

- id (UUID)
- name
- locale
- timezone
- status
- created_at
- updated_at

### workspace_members

- id (UUID)
- workspace_id
- user_id
- role
- created_at

### assistants (Step 3 A1 baseline)

- id (UUID)
- user_id (unique)
- workspace_id
- draft_display_name (nullable)
- draft_instructions (nullable)
- draft_updated_at (nullable)
- apply_status (`not_requested|pending|in_progress|succeeded|failed|degraded`)
- apply_target_version_id (nullable)
- apply_applied_version_id (nullable)
- apply_requested_at (nullable)
- apply_started_at (nullable)
- apply_finished_at (nullable)
- apply_error_code (nullable)
- apply_error_message (nullable)
- created_at
- updated_at
- Step 10 G3 ownership transfer/recovery semantics:
  - `user_id` can be admin-rebound under governed transfer/recovery flow
  - one-user-one-assistant uniqueness remains enforced (`user_id` unique)
  - ownership rebind is not reset/delete and does not mutate published version history

### assistant_published_versions (Step 3 A3 baseline)

- id (UUID)
- assistant_id
- version (integer, per-assistant sequential)
- snapshot_display_name (nullable)
- snapshot_instructions (nullable)
- published_by_user_id
- created_at

### assistant_governance (Step 3 A6 baseline)

- id (UUID)
- assistant_id (unique)
- capability_envelope (jsonb, nullable)
- secret_refs (jsonb, nullable) — Step 10 G1 canonical managed SecretRef lifecycle envelope (`persai.secretRefs.v1` baseline; no secret values), including Telegram `refs.telegram_bot_token` metadata: `refKey`, `version`, `status`, `rotatedAt`, `expiresAt`, `revokedAt`, `emergencyRevokedAt`, `revokeReason`, and non-sensitive hints
- policy_envelope (jsonb, nullable)
- memory_control (jsonb, nullable) — Step 6 D1/D3: canonical memory control-plane envelope (`persai.memoryControl.v1` baseline), including `policy` (read/write surfaces, deny group-sourced global writes, trusted 1:1 write surfaces) and `sourceClassification` (named trust classes for global registry; D3)
- tasks_control (jsonb, nullable) — Step 6 D4: canonical tasks/reminders/triggers control-plane envelope (`persai.tasksControl.v1` baseline: ownership, source/surface hooks, control lifecycle labels, enablement/cancellation, commercial quota exclusion for tasks, audit routing)
- quota_plan_code (nullable)
- quota_hook (jsonb, nullable)
- audit_hook (jsonb, nullable)
- created_at
- updated_at

### assistant_materialized_specs (Step 3 A7 baseline)

- id (UUID)
- assistant_id
- published_version_id (unique)
- source_action (`publish|rollback|reset`)
- algorithm_version
- layers (jsonb)
- openclaw_bootstrap (jsonb)
- openclaw_workspace (jsonb)
- layers_document (text)
- openclaw_bootstrap_document (text)
- openclaw_workspace_document (text)
- content_hash
- created_at

### assistant_chats (Step 5 C1 baseline)

- id (UUID)
- assistant_id
- user_id
- workspace_id
- surface (`web`)
- surface_thread_key (opaque per-surface thread identity key)
- title (nullable)
- archived_at (nullable)
- last_message_at (nullable)
- created_at
- updated_at

### assistant_chat_messages (Step 5 C1 baseline)

- id (UUID)
- chat_id
- assistant_id
- author (`user|assistant|system`)
- content
- created_at

### assistant_memory_registry_items (Step 6 D2 baseline)

- id (UUID)
- assistant_id, user_id, workspace_id (scoped like chats)
- chat_id (nullable)
- related_user_message_id, related_assistant_message_id (nullable UUIDs, correlation only)
- summary (varchar 500) — user-facing one-line summary
- source_type (`web_chat`)
- source_label (nullable)
- forgotten_at (nullable) — soft-remove from Memory Center list
- created_at

### assistant_task_registry_items (Step 6 D5 baseline)

- id (UUID)
- assistant_id, user_id, workspace_id (scoped like chats / memory registry)
- title (varchar 500) — user-facing line for Tasks Center
- source_surface (`web` in MVP)
- source_label (nullable)
- control_status (`active|disabled|cancelled`) — user-facing control state
- next_run_at (nullable) — optional schedule hint for UX (not backend scheduling)
- disabled_at, cancelled_at (nullable)
- external_ref (nullable) — optional correlation to runtime (not exposed in product API)
- created_at, updated_at

### plan_catalog_plans (Step 7 P1 baseline)

- id (UUID)
- code (varchar 64, unique)
- display_name (varchar 120)
- description (nullable text)
- status (`active|inactive`)
- is_default_first_registration_plan (bool)
- is_trial_plan (bool)
- trial_duration_days (nullable int; required and >0 when `is_trial_plan=true`)
- billing_provider_hints (nullable jsonb, provider-agnostic metadata only)
- created_at
- updated_at

### plan_catalog_entitlements (Step 7 P1 baseline)

- id (UUID)
- plan_id (UUID, unique FK -> `plan_catalog_plans.id`)
- schema_version (int)
- capabilities (jsonb array)
- tool_classes (jsonb array)
- channels_and_surfaces (jsonb array)
- limits_permissions (jsonb array)
- created_at
- updated_at

### tool_catalog_tools (Step 8 E1 baseline)

- id (UUID)
- code (varchar 64, unique)
- display_name (varchar 120)
- description (nullable text)
- capability_group (`knowledge|automation|communication|workspace_ops`)
- tool_class (`cost_driving|utility`)
- status (`active|inactive`)
- provider_hints (nullable jsonb, provider-agnostic metadata)
- created_at
- updated_at

### plan_catalog_tool_activations (Step 8 E1 baseline)

- id (UUID)
- plan_id (UUID FK -> `plan_catalog_plans.id`)
- tool_id (UUID FK -> `tool_catalog_tools.id`)
- activation_status (`active|inactive`)
- created_at
- updated_at

### assistant_channel_surface_bindings (Step 8 E4 baseline)

- id (UUID)
- assistant_id (UUID FK -> `assistants.id`)
- provider_key (`web_internal|telegram|whatsapp|max|system_notifications`)
- surface_type (`web_chat|telegram_bot|whatsapp_business|max_bot|max_mini_app|system_notification`)
- binding_state (`active|inactive|unconfigured`)
- token_fingerprint (nullable varchar 128) — control-plane fingerprint hint, not raw token exposure
- token_last_four (nullable varchar 4)
- policy (nullable jsonb)
- config (nullable jsonb)
- metadata (nullable jsonb)
- connected_at (nullable timestamptz)
- disconnected_at (nullable timestamptz)
- created_at
- updated_at

### assistant_audit_events (Step 9 F1 baseline)

- id (UUID)
- workspace_id (nullable UUID FK -> `workspaces.id`)
- assistant_id (nullable UUID FK -> `assistants.id`)
- actor_user_id (nullable UUID FK -> `app_users.id`)
- event_category (varchar 64)
- event_code (varchar 128)
- outcome (varchar 24; baseline `succeeded|failed|degraded|denied`)
- summary (varchar 255)
- details (jsonb; bounded event metadata)
- created_at

### app_user_admin_roles (Step 9 F2 baseline)

- id (UUID)
- user_id (UUID FK -> `app_users.id`)
- workspace_id (nullable UUID FK -> `workspaces.id`; `null` means global role scope)
- role_code (`ops_admin|business_admin|security_admin|super_admin`)
- created_at
- updated_at

### workspace_admin_notification_channels (Step 9 F5 baseline)

- id (UUID)
- workspace_id (UUID FK -> `workspaces.id`)
- channel_type (`webhook`)
- status (`active|inactive`)
- endpoint_url (nullable varchar 512)
- signing_secret (nullable varchar 256)
- created_by_user_id (nullable UUID FK -> `app_users.id`)
- created_at
- updated_at

### admin_notification_deliveries (Step 9 F5 baseline)

- id (UUID)
- workspace_id (UUID FK -> `workspaces.id`)
- channel_id (UUID FK -> `workspace_admin_notification_channels.id`)
- signal_code (varchar 128)
- delivery_status (`succeeded|failed|skipped`)
- payload (jsonb)
- error_message (nullable varchar 512)
- attempted_at

### assistant_platform_rollouts (Step 9 F6 baseline)

- id (UUID)
- workspace_id (UUID FK -> `workspaces.id`)
- created_by_user_id (nullable UUID FK -> `app_users.id`)
- status (`in_progress|applied|rolled_back|failed`)
- rollout_percent (int)
- target_patch (jsonb) — bounded platform-managed governance patch payload
- total_assistants (int)
- targeted_assistants (int)
- apply_succeeded_count (int)
- apply_degraded_count (int)
- apply_failed_count (int)
- rolled_back_at (nullable timestamptz)
- created_at
- updated_at

### assistant_platform_rollout_items (Step 9 F6 baseline)

- id (UUID)
- rollout_id (UUID FK -> `assistant_platform_rollouts.id`)
- assistant_id (UUID FK -> `assistants.id`)
- user_id (UUID FK -> `app_users.id`)
- previous_governance (jsonb) — pre-rollout snapshot for rollback restore
- updated_governance (jsonb) — post-rollout platform-managed governance state
- apply_outcome (`pending|succeeded|degraded|failed|skipped`)
- rollback_outcome (`pending|succeeded|degraded|failed|skipped`)
- apply_status (nullable assistant apply status enum)
- apply_error_code / apply_error_message (nullable)
- rollback_status (nullable assistant apply status enum)
- rollback_error_code / rollback_error_message (nullable)
- applied_at (nullable timestamptz)
- rolled_back_at (nullable timestamptz)
- created_at

### assistant_abuse_guard_states (Step 10 G2 baseline)

- id (UUID)
- assistant_id, user_id, workspace_id (ownership/scope constrained)
- surface (`web_chat|telegram|whatsapp|max`)
- window_started_at
- request_count
- slowed_until (nullable)
- blocked_until (nullable)
- block_reason (nullable)
- admin_override_until (nullable)
- last_seen_at
- created_at
- updated_at

### assistant_abuse_assistant_states (Step 10 G2 baseline)

- id (UUID)
- assistant_id
- surface (`web_chat|telegram|whatsapp|max`)
- window_started_at
- request_count
- slowed_until (nullable)
- blocked_until (nullable)
- block_reason (nullable)
- admin_override_until (nullable)
- last_seen_at
- created_at
- updated_at

### workspace_subscriptions (Step 7 P3 baseline)

- id (UUID)
- workspace_id (UUID, unique FK -> `workspaces.id`)
- plan_code (varchar 64)
- status (`trialing|active|grace_period|past_due|paused|canceled|expired`)
- trial_started_at (nullable timestamptz)
- trial_ends_at (nullable timestamptz)
- current_period_started_at (nullable timestamptz)
- current_period_ends_at (nullable timestamptz)
- cancel_at_period_end (bool)
- billing_provider (nullable varchar 64)
- provider_customer_ref (nullable varchar 128)
- provider_subscription_ref (nullable varchar 128)
- metadata (nullable jsonb)
- created_at
- updated_at

### workspace_quota_accounting_state (Step 7 P5 baseline)

- id (UUID)
- workspace_id (UUID, unique FK -> `workspaces.id`)
- token_budget_used (bigint)
- token_budget_limit (nullable bigint)
- cost_or_token_driving_tool_class_units_used (int)
- cost_or_token_driving_tool_class_units_limit (nullable int)
- active_web_chats_current (int)
- active_web_chats_limit (nullable int)
- last_computed_at (timestamptz)
- created_at
- updated_at

### workspace_quota_usage_events (Step 7 P5 baseline)

- id (UUID)
- workspace_id (UUID FK -> `workspaces.id`)
- assistant_id (nullable UUID)
- user_id (nullable UUID)
- dimension (`token_budget|cost_or_token_driving_tool_class|active_web_chats_cap`)
- delta (bigint)
- current_value (nullable bigint)
- limit_value (nullable bigint)
- source (varchar 64)
- metadata (nullable jsonb)
- created_at

## Prisma baseline (Step 1 slice 5)

- `app_users`:
  - primary key: `id`
  - unique: `clerk_user_id`, `email`
- `workspaces`:
  - primary key: `id`
  - `status` enum: `active | inactive`
- `workspace_members`:
  - primary key: `id`
  - foreign keys: `workspace_id -> workspaces.id`, `user_id -> app_users.id`
  - `role` enum: `owner | member`
  - unique membership pair: `(workspace_id, user_id)`
- `assistants`:
  - primary key: `id`
  - unique: `user_id` (**enforces MVP: 1 user = 1 assistant**)
  - foreign keys: `user_id -> app_users.id`, `workspace_id -> workspaces.id`
  - scoped-membership FK: `(workspace_id, user_id) -> workspace_members(workspace_id, user_id)`
  - unique pair: `(workspace_id, user_id)` to keep assistant bound to one concrete user-workspace membership record
  - A2 draft columns (all nullable): `draft_display_name`, `draft_instructions`, `draft_updated_at`
  - A5 apply-state columns:
    - `apply_status` (enum)
    - `apply_target_version_id` (nullable FK -> `assistant_published_versions.id`)
    - `apply_applied_version_id` (nullable FK -> `assistant_published_versions.id`)
    - `apply_requested_at`, `apply_started_at`, `apply_finished_at` (nullable timestamps)
    - `apply_error_code`, `apply_error_message` (nullable)
- `assistant_published_versions`:
  - primary key: `id`
  - foreign keys: `assistant_id -> assistants.id`, `published_by_user_id -> app_users.id`
  - unique per-assistant version: `(assistant_id, version)`
  - immutable snapshot fields: `snapshot_display_name`, `snapshot_instructions`
  - immutable row policy enforced by DB trigger (no UPDATE, no DELETE)
- `assistant_governance`:
  - primary key: `id`
  - unique: `assistant_id` (1 governance row per assistant)
  - foreign key: `assistant_id -> assistants.id`
  - platform-managed governance envelopes/hooks:
    - capability envelope
    - secret refs with managed lifecycle metadata (rotation/revoke/TTL/audit-ready metadata; no secret value payload)
    - policy envelope
    - memory control envelope (policy, provenance hooks, visibility hooks, forget-request markers, audit routing)
    - tasks control envelope (ownership, source/surface hooks, control lifecycle labels, enablement/cancellation, tasks excluded from commercial quotas, audit routing)
    - quota plan/hook placeholders
    - audit hook placeholder
- `assistant_materialized_specs`:
  - primary key: `id`
  - foreign keys:
    - `assistant_id -> assistants.id`
    - `published_version_id -> assistant_published_versions.id`
  - unique: `published_version_id` (one deterministic materialization per published version)
  - stores:
    - layered materialization structure (`layers`)
    - OpenClaw-native outputs (`openclaw_bootstrap`, `openclaw_workspace`)
    - deterministic diff documents (`*_document`)
    - integrity hash (`content_hash`)
- `assistant_chats`:
  - primary key: `id`
  - unique per-assistant/per-surface thread identity:
    - `(assistant_id, surface, surface_thread_key)`
  - composite ownership constraints:
    - `(assistant_id, user_id) -> assistants(id, user_id)`
    - `(workspace_id, user_id) -> workspace_members(workspace_id, user_id)`
  - record-layer fields include:
    - archive marker (`archived_at`)
    - latest-message pointer time (`last_message_at`)
- `assistant_chat_messages`:
  - primary key: `id`
  - foreign keys:
    - `(chat_id, assistant_id) -> assistant_chats(id, assistant_id)`
    - `assistant_id -> assistants.id`
  - sorted-history index:
    - `(chat_id, created_at)`
- `assistant_memory_registry_items`:
  - primary key: `id`
  - composite ownership:
    - `(assistant_id, user_id) -> assistants(id, user_id)`
    - `(workspace_id, user_id) -> workspace_members(workspace_id, user_id)`
  - optional correlation fields: `chat_id`, `related_user_message_id`, `related_assistant_message_id` (no FK to messages in D2)
  - `forgotten_at` null = visible in Memory Center
- `assistant_task_registry_items`:
  - primary key: `id`
  - composite ownership:
    - `(assistant_id, user_id) -> assistants(id, user_id)`
    - `(workspace_id, user_id) -> workspace_members(workspace_id, user_id)`
  - Tasks Center visibility: `control_status` drives Active vs Inactive UX; `external_ref` is not returned by Tasks APIs
- `plan_catalog_plans`:
  - primary key: `id`
  - unique: `code`
  - partial unique: single plan may have `is_default_first_registration_plan=true`
  - check: trial duration must be null for non-trial plans, and >0 for trial plans
- `plan_catalog_entitlements`:
  - primary key: `id`
  - unique FK: `plan_id -> plan_catalog_plans.id` (1:1 model)
  - grouped entitlement JSON arrays: capabilities, tool classes, channels/surfaces, limits permissions
- `tool_catalog_tools`:
  - primary key: `id`
  - unique: `code`
  - index: `(tool_class, status)`
  - stores canonical governed tool metadata (class/group/status), not runtime execution logic
- `plan_catalog_tool_activations`:
  - primary key: `id`
  - unique pair: `(plan_id, tool_id)`
  - indexes: `(plan_id, activation_status)`
  - stores explicit plan-scoped activation truth for catalog tools
- `assistant_channel_surface_bindings`:
  - primary key: `id`
  - unique triplet: `(assistant_id, provider_key, surface_type)`
  - index: `(assistant_id, provider_key, binding_state)`
  - stores assistant-scoped provider/surface binding truth and light control-plane config/policy metadata
- `assistant_audit_events`:
  - primary key: `id`
  - indexes:
    - `(assistant_id, created_at DESC)`
    - `(workspace_id, created_at DESC)`
    - `(event_category, created_at DESC)`
  - immutable row policy enforced by DB trigger (no `UPDATE`, no `DELETE`)
  - stores high-signal append-only control-plane/runtime-transition audit events
- `app_user_admin_roles`:
  - primary key: `id`
  - unique tuple: `(user_id, workspace_id, role_code)`
  - index: `(workspace_id, role_code)`
  - stores explicit admin RBAC assignments without collapsing all admin surfaces into one broad role
- `workspace_admin_notification_channels`:
  - primary key: `id`
  - unique tuple: `(workspace_id, channel_type)`
  - index: `(workspace_id, status)`
  - stores workspace-scoped admin notification channel state for system-oriented delivery outside web UI
- `admin_notification_deliveries`:
  - primary key: `id`
  - indexes:
    - `(workspace_id, attempted_at DESC)`
    - `(channel_id, attempted_at DESC)`
  - stores append-only delivery outcomes per signal/channel attempt
- `assistant_platform_rollouts`:
  - primary key: `id`
  - index: `(workspace_id, created_at DESC)`
  - stores platform rollout operation envelope and aggregate apply outcome counters
- `assistant_platform_rollout_items`:
  - primary key: `id`
  - unique pair: `(rollout_id, assistant_id)`
  - index: `(assistant_id, created_at DESC)`
  - stores per-assistant governance snapshots + apply/rollback outcomes for explicit rollback support
- `assistant_abuse_guard_states`:
  - primary key: `id`
  - unique tuple: `(assistant_id, user_id, surface)`
  - indexes include workspace/surface/block visibility
  - stores per-user + per-assistant + per-surface abuse/rate-limit enforcement state and admin override window
- `assistant_abuse_assistant_states`:
  - primary key: `id`
  - unique tuple: `(assistant_id, surface)`
  - stores per-assistant aggregate abuse/rate-limit state and admin override window
- `workspace_subscriptions`:
  - primary key: `id`
  - unique: `workspace_id` (one current subscription state row per workspace in P3)
  - index: `(plan_code, status)`
  - provider references and metadata are optional/provider-agnostic in this slice
- `workspace_quota_accounting_state`:
  - primary key: `id`
  - unique: `workspace_id` (one latest quota accounting state row per workspace in P5)
  - stores normalized latest usage/limit state for percentage-based UI calculations
- `workspace_quota_usage_events`:
  - primary key: `id`
  - index: `(workspace_id, dimension, created_at)`
  - append-only event log for usage increments and snapshot refreshes by quota dimension

## Seed baseline (Step 1 slice 5)

- Deterministic seed inserts one baseline app user, one workspace, and one workspace membership.
- Seed is idempotent using fixed UUID identifiers.

## Rules

- snake_case in DB
- UUID everywhere
- one active workspace in product behavior for phase 1
- membership model exists from day one
- no OpenClaw runtime fields in domain tables
- no manual schema changes; Prisma migrations only
- assistant is a first-class domain entity (not embedded in `app_users` or `workspaces`)
- A2 supports assistant create/get/draft-update control-plane entrypoints only
- A3 adds publish/version snapshot model only (control-plane)
- A4 adds rollback/reset actions over existing A3 model without deleting attachment layers
- A5 adds runtime apply state tracking model only (no runtime call execution)
- A6 adds platform-managed governance layer separate from user-owned draft/version truth
- A7 adds deterministic materialization layer from user-owned + governance inputs to OpenClaw-native outputs
- A8 executes runtime apply/reapply via infrastructure adapter using A7 materialized outputs and persists coarse apply error state
- D1 adds first-class `memory_control` JSON on `assistant_governance` for memory policy/hooks/markers; runtime memory behavior stays outside backend tables
- D2 adds `assistant_memory_registry_items` for Memory Center summaries (web chat derived); not a dump of OpenClaw runtime memory
- D3 adds explicit `sourceClassification` + `trustedOneToOneGlobalWriteSurfaces` in the envelope (with SQL backfill) and server-side evaluation of global registry read/write policy
- D4 adds first-class `tasks_control` JSON on `assistant_governance` for task/reminder/trigger **control** metadata; execution and scheduling remain outside PersAI backend
- D5 adds `assistant_task_registry_items` for Tasks Center rows (control plane); population from OpenClaw/sync is integration follow-up—MVP APIs + UI are honest when the list is empty
- P1 adds canonical `plan_catalog_plans` + `plan_catalog_entitlements`; billing-vendor lifecycle and entitlement enforcement remain out of scope
- P2 adds owner-gated admin create/edit surfaces over the same P1 tables; no new plan schema tables are added in P2
- P3 adds canonical `workspace_subscriptions` and provider-agnostic billing abstraction hooks; no concrete billing vendor integration is added
- P4 adds centralized capability resolution service from P1-P3 models + governance; no new persistence table in P4
- P5 adds canonical quota accounting state + usage event tables for token budget, cost/token-driving tool class usage, and active web chats cap; tasks/reminders remain intentionally non-commercial-quota dimensions
- P6 adds centralized enforcement points over existing P1-P5 models and materializes explicit `toolAvailability` for OpenClaw; no new persistence table in P6
- E1 adds canonical tool catalog + plan activation persistence and upgrades materialized tool availability to include per-tool activation truth; backend still does not route tool execution behavior
- E2 hardens materialized OpenClaw capability envelope with explicit allow/deny and suppression truth; no new persistence table in E2
- E3 hardens materialized channel/surface binding model (`openclawChannelSurfaceBindings`) with provider+surface+assistant-binding structure; no new persistence table in E3
- E4 adds canonical assistant-scoped provider/surface binding persistence for Telegram connect/config (`assistant_channel_surface_bindings`) and keeps web as primary control-plane surface
- F1 adds append-only `assistant_audit_events` with immutable rows for critical lifecycle/runtime/admin/policy/binding transitions only (no unbounded raw event dump)
- F2 adds explicit `app_user_admin_roles` RBAC model and dangerous-action step-up gating for admin writes; legacy owner fallback remains narrow compatibility path
- F5 adds workspace-scoped admin system-notification channel and delivery-log tables; delivery is system-oriented and does not replace admin console workflows
- F6 adds explicit platform rollout operation tables with per-assistant governance snapshots so progressive rollout and rollback remain platform-managed and do not mutate user-owned draft/published-version truth
- G1 hardens assistant managed SecretRef lifecycle in `assistant_governance.secret_refs` with rotation/revoke/emergency-revoke metadata and TTL-derived expiration status; secret values remain out of broad domain/UI surfaces
- G3 adds governed ownership transfer/recovery flow over `assistants.user_id` with explicit resource-consequence policy:
  - memory/chat/task owner-scoped links rebind through assistant ownership relation
  - channel bindings and `assistant_governance.secret_refs` remain assistant-attached
  - prior audit rows remain immutable; transfer/recovery adds append-only admin-action events
- G2 adds canonical abuse/rate-limit state tables for per-user/per-assistant throttles, channel-aware hooks, temporary slowdown/block windows, and admin unblock override tracking
- G4 adds explicit legal-acceptance and compliance baseline persistence on `app_users` for MVP ToS/Privacy acceptance state; onboarding completion now depends on workspace membership + required legal acceptance
- G4 retains explicit action-based delete model and no hidden TTL auto-purge behavior for chat/memory/task registry records in MVP
- Step 5 C1 introduces canonical backend chat/message records only (web surface baseline)
- runtime conversational/session context remains outside chat domain and is owned by OpenClaw
- no streaming transport in C1
- Telegram chat domain remains out of scope in C1
- channels and integrations remain unsupported

## Step 2 onboarding write baseline (slice 3)

- onboarding write updates `app_users.display_name`
- onboarding write ensures caller has a `workspace_members` row
- when caller has no membership, creates one workspace (`status=active`) and one owner membership
- onboarding write updates current workspace profile fields (`name`, `locale`, `timezone`) idempotently
