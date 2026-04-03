# ADR-062: Ephemeral setup preview runtime seam

## Status

Accepted

## Context

ADR-061 established that setup preview must be runtime-backed but must not become publish/apply lifecycle truth.

The current implementation still gets too close to the live runtime path:

- PersAI builds preview artifacts, then calls OpenClaw `workspace/cleanup`
- PersAI applies a temporary runtime spec through the normal spec-apply seam
- OpenClaw writes into the assistant's normal workspace root and spec store
- PersAI runs a normal web turn and then cleans the workspace again

That behavior has two problems:

1. It is slower than necessary because preview does almost the full live apply cycle.
2. It is riskier than intended because preview touches the same assistant workspace surface used by live runtime execution.

After the recent recreate/runtime incident, setup preview must stop sharing the live workspace/apply path.

## Decision

Setup preview now uses a dedicated ephemeral runtime seam.

- PersAI still materializes the current draft into OpenClaw-shaped bootstrap/workspace artifacts.
- PersAI sends those artifacts directly to a dedicated OpenClaw preview endpoint together with the preview prompt.
- OpenClaw creates a temporary preview-only workspace root, writes bootstrap documents there, executes one preview turn, then deletes that temporary workspace.
- OpenClaw preview does **not** write to the persisted applied-spec store.
- OpenClaw preview does **not** call the normal live workspace cleanup/reset/apply lifecycle for the assistant.
- Preview sessions are isolated and cleaned up after the turn.
- The user-facing preview contract stays the same: one transient preview response, no publish, no chat history, no `latestPublishedVersion` mutation.

## Consequences

### Positive

- Setup preview is materially faster because it avoids live apply/store/cleanup work.
- Preview no longer mutates or cleans the live assistant workspace surface.
- Recreate/setup preview is safer around active runtime processes and session state.
- ADR-061's "runtime-backed but non-lifecycle-truth" rule becomes concrete in code.

### Negative

- PersAI/OpenClaw gain one more dedicated runtime endpoint to maintain.
- Preview is now intentionally a separate execution seam, so future changes must keep it aligned with live runtime prompt/materialization semantics.

## Alternatives considered

- Keep using normal spec apply with extra cleanup hardening.
  Rejected because it still couples preview to live workspace/apply machinery and keeps unnecessary latency.
- Make preview frontend-only again.
  Rejected because it drifts from real runtime behavior and contradicts ADR-061.
