# ADR-016: Web chat backend transport boundary (C2)

## Status

Accepted

## Context

Step 5 C1 introduced canonical backend chat/message records.
Step 5 C2 requires a minimal backend transport path for web chat only, without widening into Telegram, streaming, or runtime-internal session modeling.

## Decision

For Step 5 C2:

- Add one authenticated backend transport endpoint for web chat turns:
  - `POST /api/v1/assistant/chat/web`
- Keep transport behind the existing infrastructure adapter boundary:
  - backend -> OpenClaw adapter call to `POST /api/v1/runtime/chat/web`
- Keep user-facing truth in backend records:
  - persist user message and assistant message in C1 tables
  - preserve surface-aware thread identity via `surface=web` + `surfaceThreadKey`
- Enforce assistant lifecycle/apply gate before transport:
  - assistant must exist
  - at least one published version must exist
  - latest published version must be successfully applied
- Keep domain/application layers free of OpenClaw runtime-specific internals.

## Consequences

### Positive

- Introduces bounded web chat transport without collapsing architecture into runtime session state.
- Preserves clear split:
  - backend records/history = canonical user-facing truth
  - OpenClaw runtime/session = runtime truth
- Keeps future streaming and Telegram expansion explicit in later slices.

### Negative

- Transport is synchronous request/response only in C2.
- No streaming/event transport semantics yet.
- No Telegram transport/domain handling yet.

## Out of scope

- Streaming transport (`C3`)
- Telegram transport/domain expansion
- Backend runtime behavior routing logic
- Runtime session internals in backend chat domain tables

