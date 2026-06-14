# SESSION-HANDOFF

> Archive: handoff sections from 2026-06-06 and earlier moved to `docs/SESSION-HANDOFF.archive-2026-06-06-and-earlier.md`; 2026-05-19 and earlier remain in `docs/SESSION-HANDOFF.archive-2026-05-19-and-earlier.md`.
> Keep this file short: only the current active working set and immediate handoff.

## 2026-06-14 - Program closure doc hygiene + media completion follow-ups

### Baseline

- `main` @ `4b63f2ef` (program closure doc hygiene).

### Platform program status

- **No open orchestration program ADR.** The numbered execution programs through **ADR-115** are closed archive.
- Last closed program: **ADR-115** inbound safety (2026-06-14).
- Other recently closed programs still authoritative as **target-state** docs only: ADR-100 (project chat), ADR-102 (pre-PROD cleanup), ADR-105 (media jobs), ADR-106–109 (video/vcoin/HeyGen), ADR-112 (context/memory/tools), ADR-114 (reserve image transport).
- New product work (e.g. skill internal flows/scenarios) needs **explicit user priority** and a **new ADR** — do not resume ADR-078 / ADR-102 slice order.

### Recent landed code (2026-06-14)

- Media job completion framing: `mediaCompletionVisionEnabled`, vision vs text-only delivery reply (`48bf0023`, `accd30ef`).
- Vision input scoped to job outputs only; max output tokens 1000; warmer completion prompts.
- `seriesItems` must be unique per frame (`fb2d2415`).

### Doc hygiene (this session)

- Retired stale ADR-102 / ADR-078 “active program” references from `AGENTS.md`, `ARCHITECTURE.md`, `ROADMAP.md`, cursor rules, and this handoff.
- Replaced `.cursor/rules/adr072-runtime-continuity.mdc` with `persai-session-continuity.mdc`.

### Next recommended step

- User-driven: audit skill scenarios / project-mode flows and draft **ADR-116** if product wants internal agent playbooks (e.g. marketer: Instagram carousel, product cards, avatar video).
- Ops: deploy `api` + `runtime` for media completion + series fixes; re-materialize assistants after plan toggles.
