# ADR-048: Native OpenClaw runtime driven by PersAI apply + web chat contract

## Status

Accepted (planning baseline; implementation tracks fork PRs)

## Context

PersAI materializes assistant governance into `openclawBootstrap` / `openclawWorkspace` (`openclaw.bootstrap.v1` / `openclaw.workspace.v1`), including persona (`displayName`, `instructions`), effective capabilities, tool availability, OpenClaw capability envelope, `memoryControl`, `tasksControl`, and related governance fields. It applies this payload to the neighboring runtime via `POST /api/v1/runtime/spec/apply` and sends turns via `POST /api/v1/runtime/chat/web` and `POST /api/v1/runtime/chat/web/stream`.

The dev image currently applies `infra/dev/gitops/openclaw-runtime-spec-apply-compat.patch`, which **accepts** apply and answers chat with **stub** echo text. That proves transport only; it does **not** load persona, memory policy, tools, or session state into OpenClaw’s native agent pipeline.

The product goal is **one runtime**: OpenClaw’s full agent behavior (memory, tools, sessions, provider routing as implemented in the fork) **driven** by PersAI’s published materialization, not a parallel “simple chat” path.

At scale (order of **1k–2k** concurrent interactive users, multiple gateway replicas), **apply state must not live only in one process’s heap**: otherwise a chat request routed to another replica will not see the last `spec/apply`. Low latency expects same-region deploys, bounded adapter timeouts on PersAI API, and horizontal capacity on OpenClaw (e.g. HPA) without breaking session/spec visibility.

## Decision

1. **Ownership**: Native bridging logic is implemented in the **OpenClaw fork** (`https://github.com/kurock09/openclaw` per [ADR-012](012-openclaw-fork-source-and-deploy-boundary.md)), not in `apps/api` domain code. PersAI keeps the HTTP contract documented in [API-BOUNDARY.md](../API-BOUNDARY.md) (“PersAI to OpenClaw HTTP runtime contract (v1)”).

2. **Replace stub with native pipeline**: Runtime HTTP handlers for `/api/v1/runtime/spec/apply`, `/api/v1/runtime/chat/web`, and `/api/v1/runtime/chat/web/stream` must eventually **delegate** to the same internal code paths OpenClaw uses for agent turns (session store, `agentCommandFromIngress` / embedded PI agent, hooks/cron-style isolated turns, etc.), after **hydrating** runtime state from the applied PersAI payload.

3. **Phased delivery** (fork-side; order adjustable after spike):

   - **P0 — Persist apply (multi-replica–ready)**: On successful apply validation, store `spec.bootstrap` and `spec.workspace` (and `assistantId`, `publishedVersionId`, `contentHash`) in a **runtime-owned store behind a small interface**, keyed at minimum by `(assistantId, publishedVersionId)` (and optionally `contentHash` for validation on read). **Implementation rule:** a process-local `Map` is acceptable only for **single-replica** dev/smoke; before running **more than one OpenClaw replica** (or enabling aggressive load spread), the backing implementation must be **shared** (e.g. Redis or another low-latency cluster cache — exact tech is fork/ops choice). Design the API so the store can be swapped without changing the HTTP contract. TTL/eviction policy should be explicit (at least “until superseded by newer `publishedVersionId` or reapply with new `contentHash`”).

   - **P1 — Session identity**: Derive a stable OpenClaw `sessionKey` (or equivalent) from PersAI’s `chatId` + `surfaceThreadKey` + `assistantId` + `publishedVersionId` so repeated web turns hit the same session/transcript as intended. Document the mapping in the fork and align with [ADR-015](015-chat-record-model-and-runtime-session-boundary.md) (backend remains source of truth for chat **records**; OpenClaw holds runtime session truth).

   - **P2 — Hydrate from workspace**: Map `persona.instructions` / `displayName`, `memoryControl`, `tasksControl`, `effectiveCapabilities`, `toolAvailability`, `openclawCapabilityEnvelope` into the fork’s session entry / agent config model (e.g. session store updates, model/provider hints, tool policy). Reuse or extend existing `mergeSessionEntry` / agent scope resolution where possible (`src/config/sessions.js`, `src/agents/agent-scope.js`, `src/agents/agent-command.ts`).

   - **P3 — Chat sync + stream**: Implement web sync/stream handlers by running a full agent turn and mapping output to the existing PersAI-expected JSON / NDJSON (`delta` / `done`). Prefer reusing the same execution path as inbound hooks (`runCronIsolatedAgentTurn` / `dispatchAgentHook` pattern in `src/gateway/server/hooks.ts`) or `agentCommandFromIngress` after resolving deps — **spike required** to pick the least divergent call site.

   - **P4 — Remove or shrink compat patch**: When native paths pass contract tests, drop echo behavior from the patch or merge equivalent code into fork `main`; bump `openclaw-approved-sha.txt` in PersAI with CHANGELOG + SESSION-HANDOFF per ADR-012.

4. **Scaling and latency (operational baseline, not a separate product phase)**:

   - OpenClaw: **HPA** (or fixed replica count ≥2 only after shared apply store exists); keep API and OpenClaw in the **same region** as the database and primary users.
   - PersAI API: existing `OPENCLAW_ADAPTER_*` timeouts/retries; avoid synchronous heavy work in the apply HTTP handler beyond persist + ack.
   - Document in fork runbook: when shared store is required (e.g. before production multi-replica).

5. **Secrets**: Provider and channel credentials remain configured for OpenClaw as today (K8s secrets, config file); PersAI does not widen secret handling beyond existing governance `secretRefs` metadata.

## Consequences

### Positive

- Single agent semantics: memory, tools, and persona follow OpenClaw’s implementation while **inputs** remain governed by PersAI publish/apply.

- Clear boundary: PersAI does not import OpenClaw internals; fork owns execution.

### Negative

- Large fork effort; spikes needed against `src/agents/agent-command.ts` and gateway hook/cron paths.

- Dual maintenance until compat patch is removed.

## Implementation pointers (fork repository, approved SHA baseline)

Non-exhaustive files observed at `aa6b962a3ab0d59f73fd34df58c0f8815070eadd`:

- `src/gateway/server-http.ts` — HTTP server; compat patch attaches runtime routes here.
- `src/gateway/server/hooks.ts` — `dispatchAgentHook` → `runCronIsolatedAgentTurn` for agent turns.
- `src/agents/agent-command.ts` — core agent command / session manager path.
- `src/config/sessions.js` — session store, `mergeSessionEntry`, session key resolution.
- `src/gateway/openai-http.ts` — OpenAI-compatible ingress using `resolveGatewayRequestContext` + `sessionKey` (reference for streaming patterns).

PersAI materialization source of truth for payload shapes:

- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`

## Contract stability

Changes to HTTP paths or JSON shapes require updating [API-BOUNDARY.md](../API-BOUNDARY.md) and this ADR if semantics change.

## Relation to prior ADRs

- [ADR-006](006-openclaw-service-boundary.md) — service boundary preserved.
- [ADR-012](012-openclaw-fork-source-and-deploy-boundary.md) — fork remains SoT for runtime code.
- [ADR-013](013-openclaw-backend-integration-contract.md), [ADR-014](014-openclaw-apply-reapply-adapter.md) — adapter and apply baseline; this ADR covers **native** fulfillment on the fork side.
