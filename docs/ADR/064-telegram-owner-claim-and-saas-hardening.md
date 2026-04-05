# ADR-064: Telegram owner claim and SaaS hardening

## Status

Accepted

## Context

The first Telegram delivery slices made end-to-end bot connectivity work, but they still left production SaaS risks:

1. Telegram direct messages were effectively public once a bot username was known.
2. Repeated Telegram webhook deliveries could replay the same inbound turn and re-trigger tools such as image generation.
3. Runtime-side `401 Unauthorized` states were treated as retry noise instead of terminal integration failure.
4. UI state, PersAI control-plane state, and OpenClaw runtime state could drift, leaving a bot shown as connected while it was actually broken or still unclaimed.
5. Telegram onboarding was awkward because the owner's Telegram chat was not guaranteed to appear immediately after connect.

At the current product stage this is not acceptable for a multi-tenant SaaS target in the `5000+` user range.

## Decision

1. Telegram direct-message access becomes `owner_only` by default.
2. A Telegram bot is not fully ready immediately after token connect:
   - connect stores token/binding truth
   - the integration enters `claim_required`
   - PersAI generates a one-time 6-digit owner claim code
   - the owner opens the bot chat in Telegram and sends that code
   - only after claim does the integration become `connected`
3. Existing connected Telegram bots are migrated into the same `claim_required` posture until the owner confirms the Telegram account.
4. OpenClaw Telegram ingress becomes replay-safe:
   - dedupe repeated Telegram updates by `assistantId + update_id`
   - enforce owner gate before runtime turn execution
   - reject non-owner direct messages without starting a turn
5. Telegram terminal auth failures are explicit:
   - `401 Unauthorized` on profile/runtime Telegram API calls transitions the integration into `invalid_token`
   - this is not treated as an infinite retry path
6. While Telegram is still unclaimed, the bot responds in the assistant system language with a short prompt telling the user to send the 6-digit code from PersAI.
7. After successful owner claim, the bot immediately sends a short system message in the assistant system language so the private owner chat appears in Telegram without manual searching.

## Consequences

### Positive

- Telegram bots become private-by-default and safer for SaaS use.
- Replayed Telegram updates no longer fan out into repeated user-visible turns.
- Broken Telegram tokens move into an honest operator-visible state instead of endless log spam.
- Telegram onboarding becomes clearer because the owner only needs to send a short code instead of relying on platform-specific deep-link handoff.
- claim completion still produces an immediate owner chat.
- PersAI UI, PersAI control plane, and OpenClaw runtime share one explicit lifecycle: `not_connected -> claim_required -> connected` or `invalid_token`.

### Negative

- Telegram connect is now a two-step flow instead of “paste token and done”.
- Existing Telegram bots require owner re-claim after rollout.
- OpenClaw keeps a small amount of additional PersAI-specific Telegram lifecycle logic because the enforcement point must exist in the runtime ingress path itself.

## Out of scope

- team/shared Telegram bot access modes beyond owner-only
- WhatsApp/MAX equivalent claim flows
- a full distributed bot-registry redesign beyond the minimal runtime safety hardening in this slice

## Relation to prior ADRs

- [ADR-034](034-telegram-connection-and-delivery-surface-e4.md) remains the base Telegram control-plane connect surface
- [ADR-057](057-assistant-scoped-runtime-reconcile-and-telegram-lifecycle-h8-scale.md) remains the runtime lifecycle baseline; this ADR adds owner claim, replay safety, and terminal auth semantics
