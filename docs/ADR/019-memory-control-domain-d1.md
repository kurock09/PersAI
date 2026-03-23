# ADR-019: Memory control domain hardening (Step 6 D1)

## Status

Accepted

## Context

PersAI separates **control plane** (backend) from **runtime behavior** (OpenClaw). Memory must be governable from the backend without moving runtime memory mechanics into `apps/api`.

Prior work (A6/A7) stored generic governance in `assistant_governance` and materialization already projected a `memoryControl` object into `openclawWorkspace` by reading `policyEnvelope.memoryControl`, which was never a first-class persisted baseline.

## Decision

1. Add a dedicated JSON column `assistant_governance.memory_control` as the **canonical** store for the memory control-plane envelope.

2. Define versioned default envelope `persai.memoryControl.v1` (implemented in `createDefaultMemoryControlEnvelope()`) containing:
   - **policy**: global read/write surface rules (MVP write surface `web` only; deny group-sourced global writes)
   - **provenance**: hooks for required source metadata (surface/channel tags) for future enforcement slices
   - **visibilityHooks**: user-facing provenance exposure toggle
   - **forgetRequestMarkers**: appendable control-plane markers (empty in D1; no runtime memory payloads)
   - **audit**: routing flag to delegate memory-relevant audit to existing `auditHook` on the same row

3. **Materialization** resolves effective memory control as:
   - `memory_control` column when present and object-shaped
   - else legacy `policyEnvelope.memoryControl`
   - else default envelope

4. Expose `governance.memoryControl` on `GET /api/v1/assistant` (and any response returning `AssistantLifecycleState`) via OpenAPI + generated contracts.

5. **Migration** backfills existing rows from legacy `policyEnvelope.memoryControl` when set, otherwise applies the MVP default JSON.

## Consequences

### Positive

- Explicit, reviewable memory governance artifact for OpenClaw materialization and future Memory Center (D2+).
- Clear split: backend owns policy/provenance/visibility/forget markers/audit routing; OpenClaw owns execution-time memory behavior.

### Negative

- New column and contract field; clients must accept `memoryControl` (nullable in practice but keyed in API shape).

## Out of scope (D1)

- Memory Center UI, user PATCH APIs for memory control, enforcement of provenance at ingest (D3), runtime memory listing, or OpenClaw behavior changes.

## Corrective note

Materialization previously relied only on `policyEnvelope.memoryControl`. That path remains as **legacy fallback**; canonical source is now `memory_control`.
