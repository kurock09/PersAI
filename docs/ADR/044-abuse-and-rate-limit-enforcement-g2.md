# ADR-044: Abuse and rate-limit enforcement (Step 10 G2)

## Status
Accepted

## Context

Prior slices enforce capabilities, quotas, and lifecycle truth, but abuse protection remained incomplete as a finalized multi-layer model.

G2 requires explicit layered protection that:

- does not collapse into one backend-only rule
- preserves valid user flows
- stays aligned with quota and entitlement truth
- includes channel-aware anti-flood hooks
- supports admin override/unblock operations
- avoids widening into unrelated moderation systems

## Decision

1. Add canonical abuse state persistence:
   - `assistant_abuse_guard_states` (per assistant + user + surface)
   - `assistant_abuse_assistant_states` (per assistant + surface aggregate)
   - surface enum baseline: `web_chat|telegram|whatsapp|max`

2. Add centralized abuse/rate-limit enforcement service at control-plane entry boundaries:
   - enforced at:
     - `POST /assistant/chat/web`
     - `POST /assistant/chat/web/stream` (prepare path)
   - layered decisions:
     - per-user-per-assistant request window thresholds
     - per-assistant aggregate request window thresholds
     - quota-pressure-aware slowdown/temporary block thresholds
   - outcomes:
     - temporary slowdown (429)
     - temporary block (429)

3. Keep channel-aware anti-flood hooks explicit:
   - enforcement API is surface-aware (G2 active on `web_chat`)
   - model is ready for future Telegram/WhatsApp/MAX runtime paths without redesign

4. Add admin override/unblock capability:
   - endpoint: `POST /api/v1/admin/abuse-controls/unblock`
   - role gate: `ops_admin|security_admin|super_admin` (+ narrow owner fallback)
   - behavior:
     - clears active slowdown/block state
     - applies temporary admin override window
   - audit event:
     - `admin.abuse_unblock_applied`

5. Preserve existing control-plane boundaries:
   - capability/quota enforcement stays active and unchanged in purpose
   - abuse enforcement complements existing guards; it does not bypass entitlement/quota checks

## Consequences

### Positive

- Abuse protection is now explicitly multi-layered and stateful.
- Valid traffic remains protected via bounded windows and temporary controls, not permanent lockouts.
- Admin operators can safely recover from false positives via audited unblock override.

### Negative

- G2 introduces additional state and thresholds that require operational tuning over time.
- Telegram/WhatsApp/MAX anti-flood execution remains future runtime-path activation work.

## Out of scope (G2)

- content moderation, semantic abuse classification, policy engines
- provider-specific anti-abuse heuristics in runtime behavior plane
- broad trust/safety product workflows beyond rate-limit/abuse throttling
