# ADR-051: Global runtime provider settings correction (H1b)

## Status

Accepted

## Context

`H1` and `H1a` proved the core control-plane path:

- PersAI can materialize an admin-managed runtime provider profile into `openclawBootstrap.governance.runtimeProviderProfile`
- OpenClaw can validate and consume that profile on the applied runtime path
- platform admins can mutate the profile through the existing rollout controls

However, the `H1a` admin UI exposed the wrong level of abstraction for normal operations:

- changing provider keys still required thinking in `SecretRef` coordinates
- the UI remained assistant/governance-oriented while the live runtime still behaves like one global provider-key configuration
- there was no simple place to persist a platform-wide list of allowed/default models for later plan gating

The product requirement for the corrective slice is:

- keep provider keys global at the platform/runtime level
- keep model access / plan enforcement as a later layer on top of those keys
- let platform admins quickly replace `OpenAI` and `Anthropic` keys from PersAI UI
- avoid exposing raw secret values after write
- keep OpenClaw as the runtime executor and secret resolver

## Decision

1. Introduce a platform-global runtime provider settings object in PersAI.

   It becomes the preferred admin-owned source for:
   - `primary` provider + model
   - optional `fallback` provider + model
   - `availableModelsByProvider` metadata for `openai` and `anthropic`
   - masked provider-key presence state

2. Introduce a dedicated PersAI-managed encrypted secret store for provider keys.
   - raw `OpenAI` / `Anthropic` keys are accepted only on write
   - raw values are stored only in dedicated encrypted persistence, not in assistant governance, public read models, logs, or materialized documents
   - read APIs return only bounded metadata such as `configured`, `updatedAt`, and optional last-four hints

3. Add a dedicated admin API for the simple UX:
   - `GET /api/v1/admin/runtime/provider-settings`
   - `PUT /api/v1/admin/runtime/provider-settings`

   `PUT` is a dangerous admin action and requires step-up.

4. Hide `SecretRef` mechanics from the normal admin UI.
   - PersAI generates the required provider credential refs internally
   - materialization still emits a runtime provider profile for OpenClaw
   - the UI edits raw keys and model fields, not `source/provider/id` triples

5. Global settings overlay materialization with explicit precedence:
   - `platform global runtime provider settings`
   - fallback to legacy `assistant_governance.policyEnvelope.runtimeProviderProfile` + `assistant_governance.secret_refs.refs.runtime_provider_credentials` when no global settings are configured
   - fallback again to legacy OpenClaw runtime default when neither control-plane source is present

6. OpenClaw adds a PersAI-managed secret-resolution path.
   - materialized refs may use a new `SecretRef.source = "persai"`
   - OpenClaw resolves those refs through an authenticated internal PersAI endpoint instead of local env/file/exec providers
   - OpenClaw remains the component that resolves secret refs to raw runtime credentials

7. Updating global runtime provider settings triggers best-effort convergence for live assistants.
   - PersAI attempts soft reapply for assistants that already have a latest published version
   - failures remain bounded per assistant and do not expose raw secret values

## Consequences

### Positive

- Admin UX matches the real operational need: quick global key replacement plus default/fallback model control.
- The product gains a persistent platform-wide model catalog (`availableModelsByProvider`) without waiting for plan enforcement.
- Raw keys stop depending on Kubernetes-only secret rotation workflows for normal provider swaps.
- OpenClaw still owns runtime-side credential resolution and execution.

### Trade-offs

- This slice introduces a new platform-global control-plane object instead of reusing assistant governance alone.
- PersAI now owns an encrypted secret store for write-only provider keys, which adds key-management requirements.
- The old `H1a` rollout-based editor becomes a compatibility/fallback path rather than the preferred admin surface.

## Out of scope

- plan-based model enforcement or entitlement filtering
- tool credential refs (`H2`)
- Telegram / WhatsApp / MAX runtime readiness follow-up
- end-user or workspace-member model/provider pickers
- exposing stored raw provider keys back to the browser

## Relation to prior ADRs

- [ADR-049](049-platform-admin-runtime-control-plane-phasing.md) — `H1b` is an approved corrective slice within the same north-star program
- [ADR-050](050-runtime-provider-profile-baseline-h1.md) — `H1b` keeps the runtime profile materialization/apply path, but replaces the preferred admin mutation UX
- [ADR-048](048-native-openclaw-runtime-from-persai-apply-chat.md) — `H1b` still rides on native apply/chat instead of adding a side-band runtime path
