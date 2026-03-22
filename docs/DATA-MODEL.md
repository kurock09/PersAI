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

## Rules
- snake_case in DB
- UUID everywhere
- one active workspace in product behavior for phase 1
- membership model exists from day one
- no OpenClaw runtime fields in domain tables
- no manual schema changes; Prisma migrations only