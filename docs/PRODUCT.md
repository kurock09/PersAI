# Product

## Product truth

PersAI is a control plane plus a PersAI-native runtime plane.

The active product path is:

- `apps/web` for user and admin UI
- `apps/api` for public API, control plane, and ingress
- `apps/runtime` for request-time execution
- `apps/provider-gateway` for provider transport

OpenClaw is not part of the active product/runtime path.

ADR-072 records how the native product/runtime baseline replaced the legacy path through Step 18. The active follow-through program for lifecycle polish, memory/knowledge economics, and deferred runtime work now lives in `docs/ADR/073-post-adr072-residue-and-polish-program.md`.

## Core product principles

- canonical assistant, chat, governance, and quota truth lives in PersAI
- runtime execution is native and internal to PersAI services
- users do not interact with raw runtime bootstrap/workspace artifacts
- deploy/debug/operator truth must match the native path and active cluster wiring

## User surfaces

- web chat
- Telegram interaction through the API-owned webhook/delivery path
- assistant settings and publish/apply lifecycle
- admin plan, ops, and business surfaces

## Runtime ownership

PersAI owns:

- runtime bundle materialization
- request-time turn execution
- provider routing through `provider-gateway`
- canonical message persistence
- media/quota/governance boundaries

## Historical traces

Historical OpenClaw references may remain in ADRs, changelog entries, session handoff logs, and old migrations. They are not current product truth.
