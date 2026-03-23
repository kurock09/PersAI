# ADR-041: Admin system-notification channel baseline (Step 9 F5)

## Status
Accepted

## Context

F3/F4 established admin ops and business cockpits in web UI, but critical platform/admin signals still lacked mandatory delivery outside web surface.

F5 requires a baseline admin notification channel that is system-oriented, keeps web as primary workspace, and does not collapse admin console workflow into notifications.

## Decision

1. Add explicit workspace-scoped admin notification channel model:
   - `workspace_admin_notification_channels`
   - baseline channel type: `webhook`
   - status + endpoint + optional signing secret.

2. Add delivery log model:
   - `admin_notification_deliveries`
   - append-only delivery outcomes for observability (`succeeded|failed|skipped`).

3. Add admin API surface for channel management:
   - `GET /api/v1/admin/notifications/channels`
   - `PATCH /api/v1/admin/notifications/channels/webhook`
   - role model:
     - read: existing admin read roles
     - channel write/manage: `ops_admin|security_admin|super_admin` (+ narrow legacy owner fallback).

4. Add best-effort webhook delivery path from selected high-signal audit events:
   - runtime apply outcomes: failed/degraded/succeeded
   - admin plan changes: created/updated
   - delivery is non-blocking to primary control-plane actions.

5. Keep boundary strict:
   - notifications are system/admin oriented and read-only transport artifacts
   - web remains primary control workspace
   - no persona-style messaging requirement in F5.

## Consequences

### Positive
- Critical admin signals can reach administrators outside web UI.
- Existing RBAC and append-only audit assumptions remain intact.
- Delivery visibility exists via explicit delivery logs and admin channel state.

### Negative
- F5 does not include multi-provider routing, batching/digesting, or escalation policies.
- Notification triggers remain intentionally bounded to selected high-signal events.

## Out of scope (F5)
- replacing admin console workflows with notification workflows
- coupling alerts to personal assistant persona behavior
- heavy incident management/escalation platform features
