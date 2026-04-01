# ADR-061: Setup runtime preview and assistant identity enrichment

## Status

Accepted

## Context

The current assistant setup/edit flow has several gaps that now block a coherent create/recreate experience:

1. **Preview is a local placeholder.** The final setup step renders a synthetic greeting assembled in the browser. It does not reflect the runtime's actual interpretation of the current persona, bootstrap documents, or provider routing.

2. **Assistant identity is incomplete.** PersAI already stores user `birthday` and `gender`, but assistant-owned identity still stops at `displayName`, `instructions`, `traits`, and avatar fields. Users now need an explicit assistant gender field that is editable in setup and settings and materialized into the assistant's self-description.

3. **Setup and edit diverged.** Edit exposes free-form persona instructions while setup only exposes sliders. This produces two competing authoring models for the same draft.

4. **Reset semantics were misremembered in older docs.** The current product truth is `full wipe + draft reset + runtime workspace cleanup`, not "blank published baseline + auto-apply". New setup/recreate work must align to the current full-wipe contract.

## Decision

### 1. Assistant draft/published identity grows one field

Assistant-owned identity now includes:

- `assistantGender` on mutable draft state
- `assistantGender` on immutable published snapshot state

The field is modeled as a fixed enum:

- `male`
- `female`
- `neutral`
- `other`

This field is user-editable in both setup and assistant settings.

### 2. Setup and edit share the same persona authoring model

Both setup and edit use the same two-layer persona input:

- structured sliders (`traits`)
- free-form persona text (`instructions`)

Setup may prefill the textarea from traits, but the textarea is still the user-owned source of truth for any additional nuance.

### 3. Setup preview becomes runtime-backed

The final setup step no longer uses a browser-only placeholder. Instead:

- the web client persists the current onboarding/profile data and assistant draft before preview
- PersAI exposes a dedicated setup preview endpoint
- the backend assembles a transient runtime spec from the current draft and current user profile
- PersAI asks OpenClaw for a one-off preview response
- the preview does **not** create a published version
- the preview does **not** mutate `latestPublishedVersion`
- the preview does **not** become normal chat history

This keeps preview close to real runtime behavior while preserving the draft/publish/apply lifecycle as the user-facing source of truth.

### 4. Setup preview is pre-publish only

Runtime-backed setup preview is only for the not-live setup/recreate path:

- assistant absent, then created as draft-only during setup
- assistant exists after reset with no published version and `applyStatus=not_requested`

It is not a replacement for normal chat or publish.

### 5. `/me` remains the user-profile source of truth

The setup flow relies on `GET /me` for profile prefill and must always receive:

- `displayName`
- `birthday`
- `gender`
- workspace `timezone`

Recreate/reset flows should not rely on stale in-memory setup state.

## Consequences

### Positive

- Setup preview now reflects real runtime behavior instead of a frontend stub.
- Assistant identity becomes explicit and editable, not inferred from avatar/name.
- Setup and edit stop drifting apart semantically.
- Recreate flow can reliably rebuild from persisted user profile data.

### Trade-offs

- Preview now performs backend and runtime work before final publish.
- Setup may persist onboarding/draft state before the final "Create assistant" action.
- The preview path must stay clearly separated from publish/apply and chat history.

## API / data model impact

- `AssistantDraftState` / `AssistantDraftUpdateRequest` gain `assistantGender`
- `AssistantPublishedVersionSnapshotState` gains `assistantGender`
- a new setup preview endpoint is added under `/api/v1/assistant/*`
- `GET /api/v1/me` is explicitly required to expose `birthday` and `gender`

## Relation to prior ADRs

- [ADR-053](053-runtime-hydration-depth-persona-memory-workspace-h3.md) — extends structured persona hydration from traits/avatar into assistant-owned identity and setup parity
- [ADR-048](048-native-openclaw-runtime-from-persai-apply-chat.md) — preview remains a PersAI-owned adapter flow and does not move product policy into OpenClaw
- [ADR-058](058-concrete-h13-unified-turn-gateway.md) — preview is not a normal inbound turn surface and must stay outside persisted chat semantics
