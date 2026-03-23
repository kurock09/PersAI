# ADR-023: Tasks Center MVP (Step 6 D5)

## Status

Accepted

## Context

D4 introduced `tasks_control` and materialized `openclawWorkspace.tasksControl`, but users had no surface to inspect or influence reminders/tasks. OpenClaw remains the execution owner; PersAI must expose **control-plane registry** data and user actions without a workflow designer or raw runtime dumps.

## Decision

1. **Registry table** `assistant_task_registry_items` stores user-facing rows:
   - `title` (short human line), `sourceSurface` (MVP: `web`), optional `sourceLabel`
   - `controlStatus`: `active | disabled | cancelled`
   - `nextRunAt` optional (user-facing schedule hint; not a backend scheduler)
   - optional `externalRef` for future OpenClaw correlation (**not** exposed in API responses)

2. **APIs** (authenticated, assistant-scoped):
   - `GET /api/v1/assistant/tasks/items` — list items (sorted: active first by `nextRunAt`, then inactive by recency)
   - `POST .../items/{itemId}/disable` — pause (`active` → `disabled`)
   - `POST .../items/{itemId}/enable` — resume (`disabled` → `active`)
   - `POST .../items/{itemId}/cancel` — stop permanently (`active` or `disabled` → `cancelled`; idempotent if already cancelled)

3. **Policy**: actions respect `tasks_control` flags `userMayDisable`, `userMayEnable`, `userMayCancel` (defaults true). Denials return **409 Conflict**.

4. **Web Tasks Center** in assistant editor after Memory: **Active** / **Inactive** groups, source pill, next-run copy, Pause / Stop / Turn back on—warm, non-technical language.

5. **Population**: MVP does not add a PersAI writer for registry rows from web chat; rows are expected from future OpenClaw/sync or operational insert until then. Empty state explains this honestly.

## Consequences

### Positive

- Users get a credible Tasks Center aligned with hybrid control/execution split.
- Cancel/disable are explicit control-plane state; no backend orchestration added.

### Negative

- List may be empty until integration populates registry; execution in OpenClaw is not driven by these endpoints in D5.

## Out of scope (D5)

- Workflow designer, cron in `apps/api`, runtime routing, exposing `externalRef`, billing/quota on task counts (still excluded per D4).
