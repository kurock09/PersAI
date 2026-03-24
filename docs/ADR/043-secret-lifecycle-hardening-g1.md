# ADR-043: Secret lifecycle hardening (Step 10 G1)

## Status
Accepted

## Context

Prior slices established secret-adjacent behavior (Telegram token fingerprint audit and SecretRef projection fields), but did not provide a full managed secret lifecycle:

- no explicit rotate/revoke/emergency revoke operations
- no TTL-driven lifecycle status
- no canonical managed lifecycle state surfaced for integrations
- no compatibility bridge for pre-G1 bindings without managed SecretRefs

Step 10 G1 requires hardening without redesigning the model from scratch and without exposing secret values in product surfaces.

## Decision

1. Keep `assistant_governance.secret_refs` as the canonical assistant secret-reference container and harden it with a versioned lifecycle envelope:
   - schema: `persai.secretRefs.v1`
   - managed entry baseline in G1:
     - `refs.telegram_bot_token`
   - lifecycle metadata:
     - `version`
     - `status` (`active|revoked|emergency_revoked`)
     - `rotatedAt`
     - `expiresAt` (TTL)
     - `revokedAt`
     - `emergencyRevokedAt`
     - `revokeReason`

2. Add Telegram lifecycle operations (assistant-scoped, authenticated):
   - connect/rotate path writes managed SecretRef metadata and keeps secret value out of response payloads
   - `POST /assistant/integrations/telegram/rotate`
   - `POST /assistant/integrations/telegram/revoke`
   - `POST /assistant/integrations/telegram/emergency-revoke`

3. Enforce lifecycle in control-plane read/projection:
   - integration read model now includes non-sensitive `secretLifecycle` state
   - OpenClaw channel/surface provider readiness considers SecretRef lifecycle status, with a narrow `legacy_unmanaged` compatibility fallback for pre-G1 active Telegram bindings

4. Keep secret delivery discipline:
   - backend policy remains source of truth for lifecycle metadata
   - runtime still consumes SecretRef-based availability/projection, not raw secret values from broad domain/UI surfaces

5. Add explicit audit coverage:
   - `assistant.secret_ref_rotated`
   - `assistant.secret_ref_revoked`
   - `assistant.secret_ref_emergency_revoked`
   - existing Telegram token-fingerprint audit remains intact

## Consequences

### Positive

- Secret lifecycle now supports rotation, revoke, emergency revoke, TTL state, and audit at the control-plane boundary.
- Existing architecture is preserved (no backend behavior-routing expansion, no runtime-secret value exposure).
- Pre-G1 bindings continue working via explicit compatibility fallback while operators migrate to managed references.

### Negative

- G1 introduces lifecycle hardening for managed assistant SecretRefs only (Telegram baseline).
- Expiration status is computed at read/evaluation time; no scheduler job is added in this slice.

## Out of scope (G1)

- full vault/KMS provider implementation details and key-management orchestration internals
- bulk secret inventory/search UI
- per-provider secret policy editors for all integrations/channels
- replacing existing webhook signing-secret storage model with managed SecretRefs (deferred to a later hardening slice)
