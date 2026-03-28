# ADR-056: Unified inbound turn gateway and PersAI-owned reminders (H12/H13)

## Status

Accepted

## Context

Web chat already enforces plan/capability/quota rules inside PersAI API, but Telegram and future channels do not share the same entry boundary. User-facing errors are also inconsistent: web relies on string heuristics, while non-web channels mostly return generic text.

At the same time, reminders/tasks can no longer depend on native OpenClaw cron semantics as a product boundary:

- native cron is single-tenant by design
- channel delivery resolution belongs to PersAI control plane
- task/reminder limits must align with plan/catalog governance
- fallback delivery and user-facing denial UX must be deterministic code, not prompt behavior

The repo also carries explicit fork-safety constraints:

- prefer PersAI-side fixes first
- avoid growing native OpenClaw cron diff
- document runtime contract changes before code

## Decision

1. **PersAI owns the inbound turn gateway for all product surfaces.**
   - Web chat, Telegram, cron/reminder callbacks, and future messengers converge on one PersAI application-layer turn orchestration path.
   - That path resolves assistant state, applies capability/quota/abuse/tool-limit checks, calls the OpenClaw runtime adapter, records usage, and returns structured success/failure results.

2. **Errors become code-first, not message-first.**
   - PersAI API returns stable machine-readable error codes inside the canonical error envelope.
   - Web and messenger UX map from the same backend codes, with surface-specific formatting.
   - String heuristics remain fallback only for legacy/runtime edge cases.

3. **PersAI owns reminders/tasks as a product feature.**
   - Tasks/reminders are represented in PersAI control-plane data and UI.
   - Preferred notification channel and fallback routing are resolved in PersAI.
   - Native OpenClaw cron is not the long-term product scheduler surface; any temporary cron webhook bridge is compatibility-only and must stay minimal.

4. **OpenClaw remains runtime/transport execution, not product policy authority.**
   - OpenClaw continues to execute agent turns and channel bridge logic.
   - PersAI remains the source of truth for plan enforcement, delivery preference, retries/fallbacks, and user-facing denial semantics.

5. **Tasks Center becomes a real current-state control surface.**
   - Current active reminders/tasks are listed from PersAI-owned state.
   - One-time successful tasks disappear from the current list.
   - Recurring tasks remain one live row with updated `nextRunAt`.
   - V1 keeps pause/resume/cancel, but no edit flow.

## Consequences

### Positive

- One enforcement model for `web`, Telegram, reminder callbacks, and future messengers.
- Stable error codes allow consistent, polished user messaging across surfaces.
- Reminder delivery becomes multi-tenant and plan-aware without native cron schema changes.
- New messenger support becomes an adapter exercise instead of another policy rewrite.
- OpenClaw fork risk stays concentrated in thin bridge seams.

### Negative

- The implementation spans API, contracts, UI, persistence, and a small OpenClaw bridge surface.
- Existing Tasks Center assumptions from D5 change: PersAI now owns population, not just control actions.
- Some docs from D4/D5 and P6 need to evolve because enforcement is no longer web-only and tasks are no longer display-only hints.

## Alternatives considered

- **Keep enforcement split per channel:** rejected because it duplicates policy and guarantees inconsistent user-facing failures.
- **Keep reminders as native OpenClaw cron product surface:** rejected because it breaks multi-tenant delivery ownership and increases fork-risk in native cron files.
- **Use prompt instructions for delivery/channel fallback behavior:** rejected because the behavior must be deterministic and auditable.
