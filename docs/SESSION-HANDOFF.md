# SESSION-HANDOFF

> Archive: handoff sections from 2026-06-06 and earlier moved to `docs/SESSION-HANDOFF.archive-2026-06-06-and-earlier.md`; 2026-05-19 and earlier remain in `docs/SESSION-HANDOFF.archive-2026-05-19-and-earlier.md`.
> Keep this file short: only the current active working set and immediate handoff.

## 2026-06-14 - ADR-115 program closed

### Baseline

- Closing commit: `4f72286e` on `main` (from `989fc2b8`).

### What changed

- **ADR-115 closed** in `docs/ADR/115-inbound-safety-program-contour-heuristics-and-async-moderation.md` (115.0–115.7 + follow-through ledger).
- **Sidebar safety standing:** `ResolveUserSafetyStandingService`, bootstrap `userSafety` section, warn/block icons on assistant card with modal (card still opens settings).
- **Warn copy:** web banner, TG messenger, and sidebar modal reference prior messages in the chat/thread (not “this request”).
- **TG idempotency:** verified + test — duplicate `triggerKey` does not re-deliver warn.

### Verification

- Full AGENTS gate: lint, format:check, typecheck (api/web), test, test:step2, build.

### Next recommended step

- Deploy `api` + `web`; live-test warn/restrict on web + Telegram. Resume ADR-102 slice order or next program backlog item.
