# ADR-050: Runtime provider profile baseline (H1)

## Status

Accepted

Follow-up note: the `H1/H1a` runtime profile baseline in this ADR remains the compatibility materialization path, but the preferred admin mutation UX for provider keys/models is superseded by [ADR-051](051-global-runtime-provider-settings-h1b.md).

## Context

ADR-049 defined the north-star direction: PersAI becomes the admin-driven control plane for runtime configuration while OpenClaw remains the runtime plane and secret resolver.

The first production-grade slice must remove the current "default model from Helm/OpenClaw config" dependency without trying to solve tool credentials, Telegram delivery readiness, or deep runtime hydration in the same change.

The repo already has the right seams:

- `assistant_governance.policy_envelope`
- `assistant_governance.secret_refs`
- platform-admin rollout/apply/rollback flow
- materialized `openclawBootstrap` / `openclawWorkspace`
- native OpenClaw apply + web chat path from ADR-048

The missing piece is a narrow, typed baseline that lets platform admins choose assistant-scoped primary/fallback models for `OpenAI + Anthropic`, wire provider credential refs without raw secrets in PersAI state, and let OpenClaw validate/consume that profile on the applied runtime path.

## Decision

1. Canonical H1 control-plane truth lives inside existing governance containers, not a new top-level DB object:
   - `assistant_governance.policy_envelope.runtimeProviderProfile`
   - `assistant_governance.secret_refs.refs.runtime_provider_credentials`

2. `policyEnvelope.runtimeProviderProfile` stores the admin-owned routing choice only:
   - schema `persai.runtimeProviderProfile.v1`
   - `primary` provider + model
   - optional `fallback` provider + model
   - no raw credentials
   - no user-facing picker

3. `secret_refs.refs.runtime_provider_credentials` stores provider credential references only:
   - schema `persai.runtimeProviderCredentialRefs.v1`
   - provider-scoped entries for `openai` and/or `anthropic`
   - each entry carries non-secret metadata plus an OpenClaw-compatible `SecretRef`
   - PersAI stores metadata and refs, not secret values

4. The first mutation surface is the existing platform-admin rollout path:
   - `POST /api/v1/admin/platform-rollouts`
   - H1 adds typed validation when `targetPatch.policyEnvelope.runtimeProviderProfile` and/or `targetPatch.secretRefs.refs.runtime_provider_credentials` are present
   - this keeps step-up, audit, soft reapply, percentage rollout, and rollback semantics from ADR-042

5. Materialization resolves a concrete admin-managed runtime profile:
   - `openclawBootstrap.governance.runtimeProviderProfile`
   - contains the selected primary/fallback provider+model and the resolved provider credential refs needed by OpenClaw
   - `runtimeProviderRouting` remains a derived routing view and now reflects the admin-managed profile when present

6. OpenClaw owns runtime-side validation and execution:
   - `POST /api/v1/runtime/spec/apply` validates the materialized runtime provider profile before persisting the applied spec
   - validation includes provider allowlist (`OpenAI + Anthropic` only in H1), structural model refs, and provider credential ref resolvability against current OpenClaw runtime config/environment
   - web chat sync/stream use the applied profile to pass per-run `provider` / `model` overrides into `agentCommandFromIngress`

7. Backward compatibility is explicit:
   - if no admin-managed runtime provider profile is materialized, OpenClaw keeps its legacy configured default model path
   - H1 is opt-in control-plane ownership, not a flag day migration

## Consequences

### Positive

- PersAI becomes the source of truth for assistant-scoped primary/fallback runtime selection without duplicating OpenClaw internals.
- Existing rollout/rollback and reapply semantics are reused instead of inventing a parallel admin mutation system.
- OpenClaw validates runtime credential refs in the environment that actually executes the models.
- The slice is small enough to ship before tool-secret and Telegram/MAX/WhatsApp follow-up work.

### Trade-offs

- H1 does not introduce a dedicated admin UI/editor; the first mutation surface is rollout-driven.
- H1 does not yet move tool-provider credentials into the same control-plane path.
- H1 does not yet hydrate persona/memory/tasks/tool policy deeper into runtime behavior beyond the current native apply/chat path.

## H1a follow-up

The immediate follow-up after `H1` is a narrow platform-admin UI slice for:

- editing `runtimeProviderProfile` primary/fallback provider+model
- editing provider credential refs for `openai` / `anthropic`
- keeping mutation rights platform-admin only
- reusing the same H1 backend/materialization/apply contract rather than inventing a second UI-only data path

### H1a exact UI slice

- land inside the existing PersAI admin surface rather than a separate runtime-settings product area
- add a structured editor above the existing generic platform-rollout JSON box
- hydrate the form from current `assistant.governance.policyEnvelope` and `assistant.governance.secretRefs`
- submit through the same `POST /api/v1/admin/platform-rollouts` endpoint with a generated:
  - `targetPatch.policyEnvelope.runtimeProviderProfile`
  - `targetPatch.secretRefs.refs.runtime_provider_credentials`
- keep provider choice constrained to `openai` / `anthropic`
- keep model refs free-form strings so PersAI does not duplicate OpenClaw's runtime allowlist implementation
- edit credential refs only as metadata + `SecretRef` coordinates (`source`, `provider`, `id`, optional `refKey`)
- do not add raw secret entry fields, new secret persistence paths, or a second mutation API
- preserve unrelated `policyEnvelope` and `secretRefs.refs.*` branches when generating rollout patches, because the current rollout path replaces whole governance envelopes rather than deep-merging nested keys

## Out of scope

- tool credential refs
- Telegram runtime delivery readiness
- WhatsApp/MAX follow-up readiness
- user-facing model selection
- raw secret storage in PersAI
- replacing OpenClaw secret resolution with PersAI-side secret materialization

## Relation to prior ADRs

- [ADR-042](042-progressive-rollout-and-rollback-controls-f6.md) — H1 reuses rollout/rollback as the first admin mutation surface
- [ADR-043](043-secret-lifecycle-hardening-g1.md) — H1 extends managed SecretRef direction beyond Telegram-only lifecycle metadata
- [ADR-048](048-native-openclaw-runtime-from-persai-apply-chat.md) — H1 rides on the native apply/chat boundary and adds provider-profile validation/consumption on that path
- [ADR-049](049-platform-admin-runtime-control-plane-phasing.md) — H1 is the first concrete coding slice from the north-star plan
