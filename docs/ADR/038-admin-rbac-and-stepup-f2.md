# ADR-038: Admin RBAC and dangerous-action step-up (Step 9 F2)

## Status
Accepted

## Context

F1 introduced append-only audit persistence, but admin authorization still depended on legacy owner-only checks and dangerous admin writes had no explicit step-up confirmation boundary.

F2 requires explicit admin roles and hardened dangerous-action protection without collapsing into a single broad admin role.

## Decision

1. Introduce explicit admin role model in backend control plane:
   - `app_user_admin_roles`
   - role codes:
     - `ops_admin`
     - `business_admin`
     - `security_admin`
     - `super_admin`
   - roles can be workspace-scoped and optionally global (`workspace_id = null`).

2. Keep a narrow compatibility fallback:
   - `workspace_members.role=owner` maps to implicit `business_admin` access for existing flows.
   - this preserves prior owner-based admin access while RBAC becomes explicit.

3. Read/admin visibility authorization:
   - `/api/v1/admin/plans` and `/api/v1/admin/plans/visibility` require one of:
     - `ops_admin`
     - `business_admin`
     - `security_admin`
     - `super_admin`
     - or legacy owner fallback.

4. Dangerous admin writes require both role and step-up:
   - actions:
     - `admin.plan.create`
     - `admin.plan.update`
   - role requirement:
     - `business_admin` or `super_admin` (or legacy owner fallback)
   - step-up requirement:
     - short-lived signed token from `POST /api/v1/admin/step-up/challenge`
     - token bound to actor, workspace, action, and expiry.

5. Audit role/actor context for admin and step-up flows:
   - `admin.step_up_challenge_issued`
   - admin write events include:
     - actor user
     - actor roles
     - legacy fallback flag
     - step-up verified flag

## Consequences

### Positive
- Admin access is role-based and non-collapsed.
- Dangerous writes are protected by explicit step-up confirmation.
- Audit trail includes role and actor context for admin actions.

### Negative
- F2 does not yet provide admin-role management APIs/UI.
- Step-up in F2 is challenge-token based and scoped to current dangerous admin actions only.

## Out of scope (F2)
- full admin-role lifecycle management UI/APIs
- step-up for non-admin user actions
- elevated session management and MFA orchestration policy engine
