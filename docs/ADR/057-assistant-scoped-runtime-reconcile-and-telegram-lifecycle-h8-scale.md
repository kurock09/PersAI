# ADR-057: Assistant-scoped runtime reconcile and Telegram lifecycle hardening (H8-scale)

## Status

Accepted

## Context

H8 Telegram runtime readiness shipped functional end-to-end delivery, but the current lifecycle behavior is too expensive and too broad for multi-tenant production use:

1. A user-scoped `spec/apply` can still trigger unnecessary runtime churn for Telegram even when nothing meaningful changed.
2. The current OpenClaw -> PersAI freshness path is too coarse for single-assistant changes. It rematerializes through the backend apply flow instead of returning a fresh spec for local runtime reconcile.
3. Assistant reset/create flows clean workspace/spec state, but they do not guarantee cleanup of assistant-scoped runtime sessions and transcripts.
4. Telegram bot startup and restart behavior is too eager:
   - no-op apply still restarts transport
   - profile sync runs on startup/reinit
   - startup reinit is unbounded
   - Telegram profile APIs can be hit in bursts, increasing `429` risk

This conflicts with the repository rules and architecture goals:

- PersAI is the control plane.
- OpenClaw is the runtime plane.
- user-scoped changes must remain assistant-scoped
- global churn is acceptable only for real admin/platform changes
- reset semantics must fully clean runtime-side leftovers for the assistant being reset
- future channels must be able to reuse the same lifecycle pattern

## Decision

### 1. User-scoped changes use assistant-scoped reconcile only

Any user-owned change that affects one assistant's materialized runtime state must result in a reconcile for that assistant only.

Examples:

- persona edits
- avatar edits
- Telegram connect/disconnect/config changes
- other assistant-specific channel/settings changes

These changes must not trigger mass `full apply` behavior across other assistants.

### 2. Global admin/platform changes remain the only broad invalidation path

Global changes may still invalidate many assistants, but they remain explicitly platform-scoped:

- plan changes
- global runtime provider settings
- bootstrap preset changes
- other admin-owned materialization sources

Those changes continue to use lazy invalidation and explicit admin reapply tooling where appropriate.

### 3. `ensure-fresh-spec` returns fresh spec; OpenClaw reconciles locally

For a single assistant freshness miss:

- PersAI returns the fresh materialized spec payload
- OpenClaw validates and applies that spec locally
- OpenClaw updates its local runtime store and workspace
- OpenClaw does not call back into the backend apply lifecycle for that assistant

This preserves the H3.1 lazy invalidation model while avoiding unnecessary backend-side apply churn.

### 4. Telegram runtime reconcile becomes fingerprint-driven

Telegram runtime behavior is split into two decisions:

- transport reconcile
- profile reconcile

OpenClaw persists runtime fingerprints so no-op apply is idempotent.

Transport fingerprint includes the fields that truly require bot rotation, at minimum:

- bot token hash
- webhook mode
- webhook URL

Profile fingerprint includes the fields that truly require Telegram profile sync, at minimum:

- persona hash
- avatar hash

Result:

- unchanged transport fingerprint -> do not restart the bot
- unchanged profile fingerprint -> do not call Telegram profile APIs

### 5. Telegram startup is bounded and readiness-safe

Telegram bot reinitialization from persisted runtime state must:

- use bounded concurrency
- add jitter
- retry transient failures with backoff
- defer non-critical profile work until after the gateway is ready

Probe tuning is allowed later, but it is not the root fix.

### 6. Assistant lifecycle owns runtime-side session cleanup

PersAI assistant create/reset flows must be able to instruct OpenClaw to remove assistant-scoped runtime sessions and transcript artifacts for that assistant.

This cleanup is explicit product correctness behavior, not just generic store maintenance.

Cleanup scope includes PersAI-owned session keys such as:

- web sessions for the assistant
- Telegram sessions for the assistant
- other PersAI runtime session namespaces for that assistant

Generic OpenClaw session maintenance remains a bounded-growth backstop, not the primary reset semantic.

## Consequences

### Positive

- User settings apply immediately, but only for the affected assistant.
- No-op apply becomes cheap and idempotent.
- Telegram `429` storms become much less likely.
- Startup behavior becomes safer under 1000+ assistants.
- Reset/recreate semantics become complete on the runtime side.
- The pattern generalizes to future channels.

### Negative

- OpenClaw fork keeps a small amount of additional PersAI-specific runtime metadata and reconcile logic.
- The internal freshness contract changes shape and requires coordinated docs + tests across both repos.

## Out of scope

- replacing OpenClaw cron with a backend-owned scheduler
- WhatsApp/MAX runtime delivery implementation
- broad probe-budget tuning before lifecycle fixes land
- speculative refactors of native OpenClaw session architecture outside the minimal cleanup seam

## Relation to prior ADRs

- [ADR-048](048-native-openclaw-runtime-from-persai-apply-chat.md) — keeps OpenClaw as the runtime executor and extends local runtime reconcile semantics
- [ADR-054](054-config-generation-lazy-invalidation-h3-1.md) — narrows single-assistant freshness handling to fresh-spec return + local reconcile
- [ADR-056](056-unified-inbound-turn-gateway-and-persai-owned-reminders-h12-h13.md) — remains consistent with PersAI as product/control-plane owner
