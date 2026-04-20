# Data Model

This document describes the current active PersAI data-model truth at a high level.

ADR-072 remains the historical migration record through the Step 18 native-path closeout. The active post-closeout program now lives in `docs/ADR/073-post-adr072-residue-and-polish-program.md`.

## Control-plane ownership

PersAI is the source of truth for:

- assistants and published versions
- runtime bundle materialization
- canonical chats and messages
- canonical assistant chat attachments and media metadata
- assistant/global knowledge source metadata and indexed chunks
- persisted assistant workspace files through `assistant_files`
- plan-owned retrieval policy and admin-managed knowledge governance
- durable retrieval observability rollups/events
- governance, quota, audit, and admin state
- integration state such as Telegram binding/config

## Runtime-plane ownership

The native runtime path uses PersAI-owned runtime state models for:

- bundle warm/invalidation state
- runtime sessions
- turn receipts and idempotency state
- session compaction metadata

## Sandbox and assistant workspace state

Current active Step 20 persistence includes:

- `assistant_files` as the canonical file registry for persisted assistant workspace files
- `assistant_workspace_leases` for multi-pod workspace ownership/serialization
- `sandbox_jobs` for queued/running/completed/blocked sandbox execution telemetry and result state

`SandboxFileRef` is not active current-model truth anymore.

## Knowledge and retrieval state

Current active knowledge/retrieval persistence includes:

- assistant-scoped uploaded knowledge sources plus indexed assistant chunk rows
- workspace-scoped global knowledge sources plus indexed global chunk rows
- workspace-scoped `KnowledgeRetrievalEvent` rows for individual search/fetch telemetry
- workspace-scoped `KnowledgeRetrievalRollup` rows for durable aggregated retrieval metrics

The active retrieval-policy contract is plan-managed rather than hard-coded. Retrieval limits, helper toggles, fetch windows, and embedding-search enablement resolve from plan billing hints and materialize into active runtime/control-plane behavior.

## Secret ownership

Current secret wiring is split between:

- `persai-api-secrets`
- `persai-runtime-secrets`

No active data-model boundary should require `persai-openclaw-secrets`.

## Historical traces

Historical migration traces may still exist in old migrations and archival docs, including renamed legacy columns or compatibility-era materialization fields. Those traces do not define the active request-time model.
