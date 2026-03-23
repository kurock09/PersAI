# ADR-021: Memory source policy enforcement (Step 6 D3)

## Status

Accepted

## Context

D1 defined `persai.memoryControl.v1` with MVP policy fields and D2 added the Memory Center registry fed from web chat. Policy text referenced surfaces and group-sourced write denial, but **ingest and read paths did not evaluate** transport + trust classification in code.

Without explicit evaluation, “trusted 1:1 only” risked becoming an undocumented convention.

## Decision

1. **Documented control-model fields** (defaults + migration backfill for existing rows):
   - `policy.trustedOneToOneGlobalWriteSurfaces` — surfaces allowed to receive **global registry** writes when the attempt is classified `trusted_1to1` (MVP: `["web"]`).
   - `policy.allowedGlobalWriteSurfaces` — allowed write surfaces (MVP: `["web"]`); write must pass **both** lists (trusted list falls back to allowed list when omitted).
   - `sourceClassification` — versioned names for trust classes used in evaluation (`globalWriteRequiresTrust`, `groupSourcedGlobalWriteClass`, `trustedDirectThreadClass`); evaluation uses the runtime types in `memory-source-policy.ts`, aligned with these defaults.

2. **Read gate (`globalMemoryReadAllSurfaces`)** — `isGlobalMemoryReadAllowed()` must pass before:
   - listing Memory Center items
   - forget-by-id
   - do-not-remember (registry + marker append)

3. **Write gate (`evaluateGlobalMemoryWritePolicy`)** — before inserting a registry row after a web chat turn:
   - `sourceTrust === "group"` → **denied** when `denyGroupSourcedGlobalWrites !== false` (default true); if policy ever disabled denial, MVP still returns **not supported** for group → global registry.
   - `sourceTrust !== "trusted_1to1"` → denied.
   - `transportSurface` must appear in allowed and trusted 1:1 lists.

4. **Call-site context** — web chat send/stream paths pass `WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT` (`web` + `trusted_1to1`); not inferred inside the record service alone.

5. **Shared resolution** — effective envelope for evaluation uses `resolveEffectiveMemoryControlFromGovernance()` (column → legacy → defaults), matching materialization merge rules.

## Consequences

### Positive

- Global memory policy is **enforced** on supported APIs and web-chat ingest, not only described in JSON.
- Trust/surface rules are **named** in the envelope and in TypeScript types.

### Negative

- Memory Center and do-not-remember return **409 Conflict** when global read is disabled by policy.
- Successful web chat turns **omit** registry rows when global write policy denies the attempt; the chat response still succeeds (silent skip at the record hook).

## Out of scope (D3)

- New channels (Telegram/WhatsApp/MAX), group-thread transports, or broad channel redesign.
- OpenClaw runtime memory behavior changes.
- User-facing editors for `memory_control` policy (admin/product).

## Migration

- `20260324160000_step6_d3_memory_source_policy_envelope` ensures existing `memory_control` rows gain `policy.trustedOneToOneGlobalWriteSurfaces` and `sourceClassification` when missing.
