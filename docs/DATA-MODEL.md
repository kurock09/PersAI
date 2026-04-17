# Data Model

This document describes the current active PersAI data-model truth at a high level.

## Control-plane ownership

PersAI is the source of truth for:

- assistants and published versions
- runtime bundle materialization
- canonical chats and messages
- governance, quota, audit, and admin state
- integration state such as Telegram binding/config

## Runtime-plane ownership

The native runtime path uses PersAI-owned runtime state models for:

- bundle warm/invalidation state
- runtime sessions
- turn receipts and idempotency state
- session compaction metadata

## Secret ownership

Current secret wiring is split between:

- `persai-api-secrets`
- `persai-runtime-secrets`

No active data-model boundary should require `persai-openclaw-secrets`.

## Historical traces

Historical migration traces may still exist in old migrations and archival docs, including renamed legacy columns or compatibility-era materialization fields. Those traces do not define the active request-time model.
