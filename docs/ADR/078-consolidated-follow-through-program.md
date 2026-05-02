# ADR-078: Consolidated follow-through program after ADR-072..077

**Status:** Accepted  
**Date:** 2026-04-29  
**Relates to:** ADR-072, ADR-073, ADR-074, ADR-075, ADR-076, ADR-077, ADR-079, ADR-081

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

### 0. Knowledge, Skills, document processing, and orchestrated retrieval

ADR-079 opened and implemented the product/architecture block for the knowledge plane. It supersedes the old admin `scope=skill` concept as product truth and defines first-class Skills, provider-backed document processing, `pgvector` search behind an abstraction, router-owned retrieval planning, and orchestrated source-aware retrieval context.

This block should be executed as one coherent product architecture, not as visible partial UX:

- admin Skills with instruction cards and Skill documents
- user-controlled Skill assignment in setup/recreate and Assistant Settings
- document-processing provider settings under `/admin/tools`
- DB-backed indexing jobs and quality gates
- `pgvector` vector search through a `KnowledgeVectorIndex` abstraction
- Prompt Constructor support for the `Enabled Skills` block
- runtime router `retrievalPlan` extension
- orchestrated retrieval that prepares bounded `Retrieved Knowledge Context`
- calm user activity for Skill/user/Product/web retrieval

Current guidance:

- do not preserve the old `GlobalKnowledgeSource.scope=skill` as active product truth
- do not add keyword-only Skill triggers
- do not add throwaway demo Skills; the current base catalog is admin-curated product seed data for validation/onboarding
- keep `knowledge_search` / `knowledge_fetch` as low-level tools while adding orchestration

Current state: ADR-079 implementation is in Step 13 live validation. The remaining work is deploy/reindex/live evidence for enabled Skill document retrieval and small fixes found by that validation, not a reopen of the core architecture.

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

Current state: founder-verified as working on 2026-05-02. Subsequent live polish on 2026-05-02 fixed setup/recreate Android Back step handling and prevented transient assistant-load failures from being interpreted as "assistant missing" during bad-network startup. This block remains closed unless another mobile-specific production rollout issue is discovered.

### 2. Unified user Files architecture

ADR-081 opened and implemented the active product/runtime file architecture block. It supersedes partial selector truth around chat `attachmentId`, turn-local `artifactId`, object-storage `objectKey`, and sandbox paths as model-facing concepts.

Target-state truth:

- `AssistantFile` is the canonical durable registry for every user-visible or assistant-reusable file.
- every upload, generated artifact, sandbox output, and delivered assistant file receives a durable `fileRef` immediately when persisted.
- the assistant/model-facing selector is `fileRef`; `attachmentId`, `artifactId`, `objectKey`, storage paths, sandbox absolute paths, knowledge source ids, and retrieval references are not primary model-facing file selectors.
- Knowledge remains a separate product plane and is not merged into Files.
- no legacy or transition compatibility mode should be added for the current split.

Current state: ADR-081 slices 1-5 are implemented. The remaining work is live smoke and fixes discovered by that smoke, especially around Assistant Settings Files, chat attachment projection, `fileRef` download/open, and Skill/tool file use.

### 3. Runtime/tool efficiency follow-through

This block carries the still-open Phase 4 follow-through from ADR-074, narrowed by founder decision on 2026-05-02:

1. `R2` — parallel tool calls plus explicit unused-parallelism guidance.

`R3` compound tools are cancelled. The reason is product/runtime simplicity: adding more compound tools would grow the tool model and make tool choice more confusing instead of more reliable.

No other ADR-074 slice remains active here.

### 4. Assistant background-task final verification and cleanup

ADR-077 is architecturally closed, but one small operational follow-through remains:

- keep one explicit closure block for final acceptance truth and any lingering background-task test cleanup so the product/runtime split does not regress

This block is intentionally narrow:

- verification of the accepted reminder vs background-task contract
- cleanup of any remaining transition-state test debt

It is not a reopen of the ADR-077 architecture.

Current state: founder-verified as working on 2026-05-02. This block is closed unless a concrete regression appears.

### 5. Long-tail deferred research

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

| Program item                                                       | Status     | Notes                                                                                                                                                                                          |
| ------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Knowledge, Skills, document processing, and orchestrated retrieval | live-smoke | ADR-079 implementation is complete through Step 12 plus follow-up hardening; Step 13 remains for deploy/reindex/live founder validation and narrow fixes discovered during that validation     |
| Mobile shell reliability and rollout                               | completed  | Founder verified this path as working on 2026-05-02; reopen only for concrete mobile rollout regressions                                                                                       |
| Unified user Files architecture                                    | live-smoke | ADR-081 slices 1-5 are implemented; remaining work is live Files smoke after deploy plus narrow fixes found around `fileRef` list/open/download, chat projection, and Skill/tool file handling |
| Runtime/tool efficiency follow-through                             | planned    | ADR-074 `R2` only; `R3` compound tools are cancelled by founder decision because they would grow/confuse the tool model                                                                        |
| Assistant background-task final verification/test cleanup          | completed  | Founder verified this path as working on 2026-05-02; reopen only for concrete background-task regressions                                                                                      |
| Long-tail deferred research                                        | deferred   | `Q11-C`, `Q12-C`, `Q13-C`, and optional web push only when justified by evidence                                                                                                               |

## Current real tails after ADR-079/081 implementation

Excluding live smoke and validation fixes for ADR-079/081, the real remaining ADR-078 backlog is:

1. Runtime/tool efficiency follow-through: ADR-074 `R2` only.

Mobile shell reliability/rollout and assistant background-task final verification are founder-verified as working and are no longer active backlog. ADR-074 `R3` compound tools are cancelled. The long-tail research items stay deferred and should not be pulled into active work without new evidence or an explicit founder decision.

## Consequences

### Positive

- one active continuation ADR replaces several half-open historical ADR tails
- completed work is not duplicated as fake backlog
- future sessions can read one active program instead of re-interpreting multiple older closure notes

### Negative

- ADR-078 is intentionally broader than a single feature slice
- some older ADR sections remain historically stale in detail, so the active truth must be read from ADR-078 and current source-of-truth docs rather than from old in-place future-tense language
