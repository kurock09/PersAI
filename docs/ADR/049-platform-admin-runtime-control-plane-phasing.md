# ADR-049: Platform-admin runtime control plane phasing

## Status

Accepted

## Context

PersAI and the OpenClaw fork now have a working baseline for:

- native `PersAI -> OpenClaw` web chat on the applied-spec path
- persisted runtime apply via `POST /api/v1/runtime/spec/apply`
- Redis-backed apply-store support for restart-safe / multi-replica runtime state
- materialized `openclawBootstrap` / `openclawWorkspace` documents that already carry persona, effective capabilities, tool availability, `openclawCapabilityEnvelope`, `memoryControl`, `tasksControl`, and governance metadata

At the same time, important runtime truth still lives outside the PersAI control plane:

- the active default model is still pinned in runtime config / Helm
- provider credentials are still runtime-side secrets only
- `runtimeProviderRouting` exists as a derived control-plane hint, but it still points to `openclaw_managed_default` instead of explicit admin-owned model refs
- `assistant_governance.secret_refs` is hardened only for Telegram lifecycle in the current baseline

The product direction is to make PersAI the normal control plane for runtime behavior without creating a parallel system or duplicating OpenClaw internals.

The user constraints for this phase are:

- only platform admin manages runtime settings
- first production-grade provider scope is `OpenAI + Anthropic`
- raw provider/tool secrets must not be stored in open PersAI state
- the solution must reuse existing governance/materialization boundaries where they fit
- delivery must continue one small slice at a time

## Decision

1. **North-star ownership**

   PersAI becomes the canonical **control plane** for assistant-scoped runtime profile inputs:

   - primary model selection
   - fallback model selection
   - provider credential references
   - tool credential references
   - persona / memory / tasks / tool-policy governance inputs
   - channel readiness inputs and integration readiness gates

   In this phase, mutation rights stay **platform-admin only**.

2. **Boundary discipline**

   PersAI owns:

   - policy
   - entitlement-aware availability truth
   - credential **references**
   - materialized runtime documents

   OpenClaw continues to own:

   - runtime execution
   - session state
   - provider/tool implementation details
   - secret reference resolution to raw values
   - runtime-only operational config and validation

   PersAI must not duplicate OpenClaw provider catalogs, tool schemas, or secret-resolution internals.

3. **Canonical containers must be reused before adding new ones**

   The planned evolution must start from existing control-plane seams:

   - `assistant_governance.policyEnvelope.runtimeProviderRouting`
   - `assistant_governance.secret_refs`
   - `assistant_governance.memory_control`
   - `assistant_governance.tasks_control`
   - `assistant_channel_surface_bindings`
   - materialized `openclawBootstrap` / `openclawWorkspace`

   Do not introduce a parallel runtime-profile subsystem unless these seams prove insufficient during an approved slice.

4. **Materialization remains the only bridge**

   Any new control-plane truth for models, fallbacks, provider credential refs, tool credential refs, or runtime hydration must travel to OpenClaw through the existing materialization/apply flow.

   No direct Helm patching, runtime-only final configuration, or side-band product control path is the target model.

5. **Phased delivery order**

   The next work is explicitly phased so the system can move toward the target state without scope explosion:

   - **H1 — platform-admin runtime provider profile baseline**
     - first supported providers: `OpenAI + Anthropic`
     - assistant-scoped primary/fallback model refs become explicit control-plane truth
     - provider credential refs become explicit control-plane truth
     - no raw secret values in PersAI
     - minimal OpenClaw consumption on the applied web runtime path only

   - **H2 — tool credential refs baseline**
     - extend managed credential references for tool providers
     - keep tool execution/runtime policy in OpenClaw
     - no marketplace redesign

   - **H3 — runtime hydration depth**
     - consume materialized persona, memory, tasks/reminders, tool policy, and related capability envelopes deeper in OpenClaw session/runtime policy
     - continue ADR-048 `P2` work without creating a second runtime behavior path

   - **H4 — Telegram runtime readiness alignment**
     - keep Telegram as the first channel-specific runtime-readiness slice after provider profile basics
     - make runtime profile, managed secret refs, and apply semantics align cleanly for Telegram

   - **H5 — WhatsApp/MAX follow-up**
     - keep readiness / secret-ref parity first
     - delivery/runtime execution remains a later dedicated slice

6. **Guardrails for every slice**

   Every future slice in this plan must preserve these rules:

   - docs / ADR first when architecture, contract, workflow, or data model changes
   - no giant all-at-once migration
   - no raw secret values in PersAI persistence, APIs, logs, materialized documents, or tests
   - no user-facing provider picker unless a separate ADR approves it
   - no silent fallback from missing configured credentials to unrelated runtime defaults

## Consequences

### Positive

- PersAI gets a clear long-term path to become a real control plane instead of a thin wrapper around dev-only runtime overrides.
- Existing governance/materialization work is reused instead of discarded.
- OpenClaw stays the runtime plane and secret resolver, so the architecture does not split into two competing runtime systems.
- The phased plan gives future sessions a stable sequence and acceptance boundary.

### Negative

- The target state will take several slices, not one release.
- Some currently working dev overrides will temporarily coexist with the new control-plane path until the first slices land.
- Secret-reference evolution must stay carefully aligned with OpenClaw secret-resolution contracts to avoid inventing a PersAI-only secret model.

## Out of scope for ADR-049

- implementing all runtime-control features in one session
- storing raw provider/tool credentials in PersAI database state
- user-facing provider marketplace or end-user model picker
- redesigning channel delivery for Telegram, WhatsApp, or MAX in this ADR
- replacing OpenClaw runtime ownership of sessions, tools, or secret resolution

## First recommended coding slice

Start with **H1 — platform-admin runtime provider profile baseline**.

Concrete implementation record: [ADR-050](050-runtime-provider-profile-baseline-h1.md).

Why H1 first:

- it removes the most important dev-only runtime override from Helm
- it builds directly on the existing `runtimeProviderRouting` seam
- it reuses the existing `secret_refs` boundary instead of inventing a second credential model
- it unblocks later tool-secret and hydration slices without forcing them into the same change

## Relation to prior ADRs

- [ADR-036](036-provider-and-fallback-baseline-e6.md) — existing derived runtime routing baseline; ADR-049 defines the next step from abstract hints toward admin-owned runtime profile truth
- [ADR-043](043-secret-lifecycle-hardening-g1.md) — existing managed SecretRef lifecycle baseline; ADR-049 extends the direction beyond Telegram-only credentials
- [ADR-048](048-native-openclaw-runtime-from-persai-apply-chat.md) — native runtime/apply/chat boundary remains intact; ADR-049 defines the phased control-plane evolution on top of that boundary
- [ADR-047](047-whatsapp-max-readiness-hardening-g5.md) — WhatsApp/MAX remain later readiness/delivery follow-up work, not part of the first slice
