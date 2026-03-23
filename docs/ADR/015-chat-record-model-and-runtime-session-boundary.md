# ADR-015: Chat record model and runtime session boundary

## Status

Accepted

## Context

Step 5 C1 introduces the first backend chat domain model.
The product requires canonical user-facing chat records, while preserving the existing OpenClaw boundary where runtime conversational context/session truth is external.

We need to avoid collapsing record/history modeling into runtime session internals.

## Decision

For Step 5 C1:

- Backend (`apps/api`) stores canonical chat record entities:
  - `assistant_chats`
  - `assistant_chat_messages`
- Surface-aware threading is explicit in chat identity:
  - `(assistant_id, surface, surface_thread_key)` unique key
  - C1 surface baseline is `web` only
- Chat ownership/scope is constrained by existing assistant and workspace membership model:
  - assistant ownership tie
  - workspace membership tie
- Message history is persisted as immutable append records with author + content + timestamp.
- OpenClaw remains owner of runtime session/context truth and is not represented in chat domain entities.

## Consequences

### Positive

- Creates a stable canonical record layer for chat list/history.
- Preserves architecture split between control-plane records and runtime context.
- Keeps future transport/streaming work independent from persistence model.

### Negative

- C1 does not provide chat transport endpoints yet.
- C1 does not include streaming semantics.
- C1 does not include Telegram chat-domain modeling.

## Out of scope

- Web chat backend transport (`C2`)
- Streaming transport (`C3`)
- Chat list actions/API behavior (`C4`)
- Active web chats cap enforcement (`C5`)
- Telegram chat domain entities/surface modeling
- Runtime session internals inside backend chat tables

