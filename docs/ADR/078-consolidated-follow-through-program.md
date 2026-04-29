# ADR-078: Consolidated follow-through program after ADR-072..077

**Status:** Accepted  
**Date:** 2026-04-29  
**Relates to:** ADR-072, ADR-073, ADR-074, ADR-075, ADR-076, ADR-077

## Context

ADR-072 through ADR-077 now serve as historical records of the native runtime migration, the post-migration polish/economics wave, the mobile WebView shell decision, the cold-start/bootstrap program, and the assistant background-task runtime split.

Those ADRs contain two different kinds of material:

1. closed architecture and implementation history that should stay archived
2. a smaller set of still-open follow-through topics that should continue in one place instead of staying split across multiple older ADRs

ADR-078 becomes that single continuation document.

## Decision

PersAI will treat ADR-072 through ADR-077 as closed historical ADRs and carry all still-open follow-through only in ADR-078.

ADR-078 keeps only genuinely open work. Already landed or founder-verified work from older ADRs remains archival context and is not duplicated here as active backlog.

## Explicit cancellations

- `ADR-072 Step 15a` native web/channel voice output is **cancelled**, not deferred.

## Ordered workstack

### 1. Mobile shell reliability and rollout

This block merges the remaining live mobile/WebView follow-through from ADR-075 and ADR-076 into one execution area:

- finish offline/cold-start hardening where the current shell still depends on incomplete edge-case handling
- capture the real measured baseline needed before any Service Worker / PWA shell decision
- decide and execute the production mobile rollout path: production origin, tightened `allowNavigation`, production icons/splash, store-track packaging, iOS/TestFlight readiness, and push-path product decision

Current open themes inside this block:

- root-level offline coverage and native error-to-offline handoff hardening
- measured re-evaluation of `ADR-076 Slice 7` (`ship` vs `do not ship`)
- production rollout packaging and store readiness
- Apple account / signing / TestFlight readiness
- push decision for mobile (`Telegram-only` vs native push)
- richer mobile camera path only if it becomes a real product ask

### 2. Runtime/tool efficiency follow-through

This block carries the still-open Phase 4 follow-through from ADR-074 in strict order:

1. `R2` — parallel tool calls plus explicit unused-parallelism guidance
2. `R3` — first wave of compound tools

No other ADR-074 slice remains active here.

### 3. Assistant background-task final verification and cleanup

ADR-077 is architecturally closed, but one small operational follow-through remains:

- keep one explicit closure block for final acceptance truth and any lingering background-task test cleanup so the product/runtime split does not regress

This block is intentionally narrow:

- verification of the accepted reminder vs background-task contract
- cleanup of any remaining transition-state test debt

It is not a reopen of the ADR-077 architecture.

### 4. Long-tail deferred research

These topics stay explicitly later and should only open when there is real product or measurement pressure:

- `Q11-C` — LLM-judge quality scoring in smoke harness
- `Q12-C` — per-user multi-level cache key
- `Q13-C` — living `USER.md` / controlled persona auto-evolution
- browser/web push only if there is a real web-only user cohort that justifies it

## Archive note

The following are not active ADR-078 backlog items:

- ADR-072 migration closeout and native runtime replacement
- ADR-073 lifecycle/UI/economics/Step-19 closeout
- ADR-074 slices already landed and founder-accepted
- ADR-075 Android shell viability decision and shipped baseline shell behavior
- ADR-076 slices 1-6 and Section M
- ADR-077 architecture split between reminders and assistant background tasks

These remain historical records only.

## Execution ledger

| Program item | Status | Notes |
| --- | --- | --- |
| Mobile shell reliability and rollout | planned | Consolidates remaining ADR-075 and ADR-076 follow-through: offline hardening, measured Slice 7 decision, production rollout, iOS/store/push decisions |
| Runtime/tool efficiency follow-through | planned | ADR-074 `R2 -> R3` only |
| Assistant background-task final verification/test cleanup | planned | Narrow ADR-077 closure hardening only |
| Long-tail deferred research | deferred | `Q11-C`, `Q12-C`, `Q13-C`, and optional web push only when justified by evidence |

## Consequences

### Positive

- one active continuation ADR replaces several half-open historical ADR tails
- completed work is not duplicated as fake backlog
- future sessions can read one active program instead of re-interpreting multiple older closure notes

### Negative

- ADR-078 is intentionally broader than a single feature slice
- some older ADR sections remain historically stale in detail, so the active truth must be read from ADR-078 and current source-of-truth docs rather than from old in-place future-tense language
