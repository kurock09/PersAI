# DATA-MODEL

## Foundation phase database

Postgres with Prisma.

## Initial entities

### app_users

- id (UUID)
- clerk_user_id (unique)
- email
- display_name
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
- secret_refs (jsonb, nullable)
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
    - secret refs
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
