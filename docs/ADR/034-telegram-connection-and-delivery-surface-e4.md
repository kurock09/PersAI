# ADR-034: Telegram connection and delivery surface (Step 8 E4)

## Status
Accepted

## Context

E3 hardened channel/surface binding projection, but Telegram still had no user-facing connect flow or persisted binding state. Product UX requires opening Telegram from integrations, entering bot token in a short flow, reflecting connected state, and exposing a post-connect configuration panel while keeping web as the primary control surface.

## Decision

1. Add canonical Telegram binding persistence in backend control plane:
   - table: `assistant_channel_surface_bindings`
   - stores provider/surface/binding-state + policy/config + metadata + token fingerprint hints

2. Add Telegram integration API (assistant-scoped, auth-gated):
   - `GET /api/v1/assistant/integrations/telegram`
   - `POST /api/v1/assistant/integrations/telegram/connect`
   - `PATCH /api/v1/assistant/integrations/telegram/config`

3. Implement connect flow semantics:
   - token format validation
   - Telegram `getMe` verification before marking connected
   - persist binding as `provider=telegram`, `surface=telegram_bot`, `binding_state=active`
   - persist token fingerprint + last-four hint (raw token is not persisted)
   - best-effort bot profile sync (`displayName`, `username`, derived avatar URL)

4. Expose post-connect configuration panel semantics in control plane:
   - parse mode
   - inbound/outbound message toggles
   - lightweight notes

5. Keep architecture boundaries:
   - no deep assistant configuration moved into Telegram
   - web remains primary control-plane surface
   - no WhatsApp/MAX delivery implementation in E4
   - no backend runtime routing/dispatch introduced

## Consequences

### Positive

- Telegram now has explicit user connect flow and persisted binding truth.
- Connected state and bot profile can be surfaced in web integrations UI.
- E3 abstraction remains intact (provider + surface + assistant binding), now with real Telegram state.

### Negative

- Runtime delivery wiring is still limited to control-plane/connect/config in this slice.
- Avatar sync is best-effort and depends on Telegram username/profile availability.

## Out of scope (E4)

- WhatsApp and MAX connection/delivery
- moving assistant lifecycle/persona configuration into Telegram
- webhook/event ingestion and runtime dispatch expansion
