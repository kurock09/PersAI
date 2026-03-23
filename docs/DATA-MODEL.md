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
- `assistant_published_versions`:
  - primary key: `id`
  - foreign keys: `assistant_id -> assistants.id`, `published_by_user_id -> app_users.id`
  - unique per-assistant version: `(assistant_id, version)`
  - immutable snapshot fields: `snapshot_display_name`, `snapshot_instructions`
  - immutable row policy enforced by DB trigger (no UPDATE, no DELETE)

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
- runtime apply, rollback/reset semantics, chat, channels, and integrations remain unsupported

## Step 2 onboarding write baseline (slice 3)

- onboarding write updates `app_users.display_name`
- onboarding write ensures caller has a `workspace_members` row
- when caller has no membership, creates one workspace (`status=active`) and one owner membership
- onboarding write updates current workspace profile fields (`name`, `locale`, `timezone`) idempotently
