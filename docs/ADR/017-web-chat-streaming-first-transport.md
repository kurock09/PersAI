# ADR-017: Web chat streaming-first transport (C3)

## Status

Accepted

## Context

Step 5 C2 introduced a minimal web chat backend transport path.
Step 5 C3 requires streaming-first behavior as the primary web chat UX path, with honest interruption/failure handling and preserved record correctness.

## Decision

For Step 5 C3:

- Add streaming-first backend endpoint:
  - `POST /api/v1/assistant/chat/web/stream`
- Keep transport behind the existing OpenClaw adapter boundary:
  - backend adapter stream call to `POST /api/v1/runtime/chat/web/stream`
- Preserve lifecycle truth gate before stream starts:
  - assistant exists
  - latest published version exists
  - latest published version is successfully applied
- Persist record truth around stream:
  - user message is persisted before streaming begins
  - completed stream persists full assistant message
  - interrupted/failed stream with partial output persists partial assistant message and explicit system marker
- Web UI uses streaming path as the primary send path (request/response is not the default UX path).

## Consequences

### Positive

- Streaming is the default happy path for web chat UX.
- Partial/interrupted output is represented honestly and preserved in canonical records.
- Architecture boundary stays explicit:
  - backend record/history truth
  - OpenClaw runtime/session truth

### Negative

- Streaming path is synchronous HTTP SSE in C3 (no advanced multiplex/backpressure/session resume semantics yet).
- Legacy non-streaming C2 endpoint remains available for compatibility, but is not the default UX path.

## Out of scope

- Telegram streaming or Telegram chat transport
- Behavioral runtime routing logic in backend domain/application layers
- Advanced streaming semantics (resume/replay/token metadata channels)

