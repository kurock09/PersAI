# ADR-058: Concrete H13 unified turn gateway shape

## Status

Accepted

## Context

ADR-056 froze the product boundary: PersAI owns inbound turn policy and reminders/tasks are PersAI-owned product behavior. The codebase still had one major gap after that decision:

- web chat already entered PersAI enforcement before runtime execution
- Telegram inbound still executed the turn locally inside OpenClaw and only synced side-effects back to PersAI
- reminder callbacks delivered summaries directly without using the same backend error family

That left enforcement and user-facing denial semantics inconsistent across surfaces.

## Decision

1. PersAI becomes the concrete turn gateway for Telegram as well as web.
   - OpenClaw Telegram webhook handling stays in the runtime.
   - But before any Telegram turn executes, OpenClaw calls PersAI internal turn ingress:
     - `POST /api/v1/internal/runtime/turns/telegram`
   - PersAI performs live-state resolution, capability/quota/rate checks, emits stable codes, and invokes OpenClaw runtime as executor.

2. OpenClaw keeps runtime/tool-calling ownership through a thin non-web runtime bridge.
   - PersAI invokes:
     - `POST /api/v1/runtime/chat/channel`
   - Current concrete surface: `telegram`.
   - This keeps OpenClaw as execution engine while moving policy ownership to PersAI.

3. Reminder callback delivery adopts the same backend error-code family even while remaining callback-driven.
   - `POST /api/v1/internal/cron-fire` now evaluates the same PersAI live-state/capability/quota gates before delivering reminder content.
   - Reminder delivery copy is rendered from the same backend code family rather than ad hoc strings.
   - This slice intentionally does not redesign reminder execution into a brand-new scheduler/runtime architecture.

4. Surface formatting is adapter-only.
   - web keeps HTTP/SSE code-first behavior
   - Telegram internal ingress returns rendered messenger-safe copy from backend codes
   - reminder callback delivery renders reminder-safe copy from the same code family

5. Tool daily-limit enforcement stays PersAI-owned and is executed at real runtime tool-call time through a minimal OpenClaw seam.
   - PersAI exposes internal consume endpoint:
     - `POST /api/v1/internal/runtime/tools/consume`
   - OpenClaw reuses its existing `before_tool_call` seam only for PersAI runtime turns and calls that endpoint before the tool executes.
   - Counter state and exhaustion semantics remain backend-owned; OpenClaw stays a thin executor.

## Consequences

### Positive

- Telegram no longer bypasses PersAI control-plane enforcement.
- Web and Telegram now converge on one backend-owned error-code family.
- Per-tool daily limits now enforce at actual runtime tool-call time rather than only existing as materialized policy metadata.
- Future WhatsApp/MAX/VK support can follow the same adapter pattern:
  - inbound provider event -> PersAI internal turn gateway -> OpenClaw runtime executor -> PersAI surface renderer/output adapter
- OpenClaw changes stay minimal:
  - mostly `persai-runtime/*`
  - one narrow reuse of the existing `before_tool_call` seam

### Negative

- Telegram turns now add one extra internal round-trip:
  - OpenClaw webhook -> PersAI internal turn ingress -> OpenClaw runtime execute
- Reminder callbacks are only partially unified in this slice:
  - delivery semantics are unified
  - they do not become a fully redesigned scheduler/runtime architecture in this ADR
