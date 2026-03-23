# ADR-018: Web chat list and destructive actions (C4)

## Status

Accepted

## Context

Step 5 C1-C3 established canonical chat records and streaming-first web chat transport.
Step 5 C4 requires GPT-style chat management actions in web UX with explicit destructive semantics.

## Decision

For Step 5 C4:

- Add web chat list and metadata endpoint:
  - `GET /api/v1/assistant/chats/web`
- Add chat actions:
  - rename: `PATCH /api/v1/assistant/chats/web/{chatId}`
  - archive: `POST /api/v1/assistant/chats/web/{chatId}/archive`
  - hard delete: `DELETE /api/v1/assistant/chats/web/{chatId}` with explicit confirmation payload `confirmText="DELETE"`
- Archive and delete semantics are intentionally different:
  - archive keeps chat/message records and marks chat archived
  - delete permanently removes chat row and all related message rows
- Delete must not be disguised as archive and must require explicit user confirmation.

## Consequences

### Positive

- Provides GPT-style user-facing chat management controls.
- Keeps C1 canonical backend records as source of list/action truth.
- Makes destructive behavior honest and explicit.

### Negative

- Hard delete is irreversible and removes history records permanently.
- C4 still does not include Telegram thread management or multi-surface action parity.

## Out of scope

- Telegram chat actions
- Soft-delete behavior under delete action
- C5 limits/caps and C6 degradation UX expansion

