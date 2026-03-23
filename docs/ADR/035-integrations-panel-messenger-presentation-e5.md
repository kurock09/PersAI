# ADR-035: Integrations panel messenger presentation (Step 8 E5)

## Status
Accepted

## Context

E4 delivered Telegram connection and config APIs/UI mechanics. The main user desktop still needs a clear, premium integrations panel that presents messenger surfaces consistently:

- Telegram as real/active when connected
- MAX and WhatsApp as muted coming-soon
- no fake active states for non-existent integrations

## Decision

1. Harden `Tools & Integrations` into a messenger-first panel on `/app` with three cards:
   - Telegram
   - MAX
   - WhatsApp

2. Telegram card uses real binding truth from E4 integration state:
   - connected vs available-to-connect vs not-allowed-by-plan
   - connect form shown only when not connected
   - post-connect config panel remains available

3. MAX and WhatsApp are explicitly non-active in E5:
   - visually muted
   - labeled `Coming soon`
   - no connect behavior wired

4. Keep control-plane ownership in web:
   - Telegram remains an interaction/delivery surface
   - deep assistant configuration is not moved into messenger surfaces

## Consequences

### Positive

- User sees a clear integrations panel with honest state signaling.
- Telegram behavior remains grounded in persisted backend truth.
- MAX/WhatsApp expectations are set without false-active UX.

### Negative

- MAX/WhatsApp cards are presentation-only until future slices.
- Visual language is lightweight premium baseline, not final design-system polish.

## Out of scope (E5)

- MAX or WhatsApp connection/delivery implementation
- Telegram runtime webhook transport expansion beyond E4 connect/config scope
- advanced integration orchestration/fallback UX
