# ADR-033: Channel and surface binding model hardening (Step 8 E3)

## Status
Accepted

## Context

E1/E2 established explicit tool and capability truth, but channel availability was still represented mostly as flat booleans (`webChat|telegram|whatsapp|max`).

Product architecture requires explicit separation of:

- integration provider
- surface type
- assistant binding

And must remain correct for:

- web chat
- Telegram bot
- WhatsApp Business
- MAX bot
- MAX mini-app
- system notifications

## Decision

1. Add materialized channel/surface binding projection for OpenClaw:
   - `openclawChannelSurfaceBindings`
   - schema: `persai.openclawChannelSurfaceBindings.v1`

2. Keep capability booleans for backward compatibility but harden projection with explicit structure:
   - provider-level binding state/policy/config
   - surface-level allow/deny state/policy/config
   - explicit suppression of unavailable surfaces

3. Remove flattening assumptions:
   - keep `max` capability gate as upstream entitlement input
   - project it into two distinct surfaces:
     - `max_bot`
     - `max_mini_app`

4. Keep E3 as control-plane projection hardening only:
   - no WhatsApp/MAX delivery implementation
   - no Telegram delivery implementation changes in this slice
   - no backend router behavior added

## Consequences

### Positive

- Runtime receives explicit provider+surface+binding truth, not implied availability.
- Unknown/unavailable surfaces are explicitly suppressible.
- Product model now reflects non-flat surface taxonomy while preserving existing entitlement compatibility.

### Negative

- Existing entitlement source for MAX remains one flag; split entitlement management is deferred.
- Provider configs are modeled as control-plane refs, not active runtime credential setup in E3.

## Out of scope (E3)

- provider connection UX and runtime onboarding
- channel delivery/execution logic for Telegram/WhatsApp/MAX
- endpoint-level channel dispatch/routing behavior
