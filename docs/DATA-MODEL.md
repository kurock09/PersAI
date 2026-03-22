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