# ADR 047: WhatsApp and MAX Readiness Hardening (Step 10 G5)

## Status

Accepted

## Context

E3/E4 introduced explicit provider/surface model and Telegram binding flow, but readiness projection still contained a Telegram-only configured-state assumption for non-web/non-system providers.
Step 10 G5 requires architecture hardening so WhatsApp and MAX can be added later without redesign.

## Decision

Harden channel/surface readiness projection:

- resolve provider configured state from canonical assistant binding repository for:
  - `telegram`
  - `whatsapp`
  - `max`
- keep Telegram additional managed SecretRef lifecycle gate.
- keep WhatsApp/MAX as binding-gated readiness only in G5 (no runtime delivery implementation).

Preserve non-flat surface taxonomy:

- WhatsApp remains `whatsapp_business`.
- MAX remains explicitly split into:
  - `max_bot`
  - `max_mini_app`

No new public APIs or persistence tables in this slice.

## Consequences

Positive:

- readiness model becomes provider-consistent and future-ready.
- avoids redesign when adding real WhatsApp/MAX flows.
- maintains explicit surface separation needed for MAX bot vs mini-app behavior.

Trade-offs / intentional limits:

- still no real WhatsApp transport runtime integration in G5.
- still no real MAX bot/mini-app transport runtime integration in G5.
- secret lifecycle hardening beyond Telegram remains future scope.
