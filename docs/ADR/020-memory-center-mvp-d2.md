# ADR-020: Memory Center MVP (Step 6 D2)

## Status

Accepted

## Context

D1 introduced a versioned `memory_control` governance envelope and materialization hook, but users had no product surface to understand or act on memory-related control.

D2 must deliver a calm Memory Center without exposing OpenClaw/runtime internals, without a heavy admin console, and without backend reimplementation of runtime memory mechanics.

## Decision

1. **Control-plane registry** table `assistant_memory_registry_items` stores **user-facing summaries** only:
   - produced after successful **web chat** turns (streaming and sync transport paths)
   - one-line combined summary of user prompt + assistant reply (truncated), not full raw transcripts as the primary UX artifact
   - `sourceType=web_chat` with human `sourceLabel` for Memory Center display
   - soft **forget** via `forgotten_at` (removed from list, not shown as deleted rows to users)

2. **API** (authenticated, assistant-scoped):
   - `GET /api/v1/assistant/memory/items` — list active items
   - `POST /api/v1/assistant/memory/items/{itemId}/forget` — forget one item
   - `POST /api/v1/assistant/memory/do-not-remember` — body references persisted `assistantMessageId` (+ optional `userMessageId`); marks matching registry rows forgotten and appends a structured entry to `memory_control.forgetRequestMarkers` (D1 envelope)

3. **Web Memory Center** lives in the existing assistant editor **Memory** section: list, source/type pill, timestamp, forget action; calm copy.

4. **Web chat stream UI**: after a turn completes, local message IDs are reconciled to **server UUIDs** from the stream `completed` transport so **“Do not remember this”** can call the API with real message IDs.

## Consequences

### Positive

- Honest MVP: users see actionable summaries and explicit forget / do-not-remember without raw runtime dumps.
- Keeps OpenClaw as runtime owner; PersAI remains governance/control plane.

### Negative

- Registry summaries are **derived** from web chat, not a live export of OpenClaw episodic memory (that integration remains future work).
- Partial/interrupted streams do not create registry rows in this slice (quality guard).

## Out of scope

- Editing memory text, Telegram/WhatsApp memory surfaces, runtime sync of forget markers into OpenClaw behavior, D3 provenance enforcement at ingest, dedicated Memory Center route, audit log UI.
