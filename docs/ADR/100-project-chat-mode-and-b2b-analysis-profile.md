# ADR-100: Project chat mode and B2B analysis profile

## Status

Accepted. Slices 2, 2.1, 3, 4, 5, and the pre-deploy Slice 6 block through 6H are verified in working tree on 2026-05-22. Slice 6H closes the live retrieval-quality finding by making Product KB/subscription facts intent-gated, cross-thread chat/memory recall explicit, Admin Runtime trigger lists authoritative when filled, and project-file hydration priority higher than ordinary user/product context.

## Date

2026-05-22

## Relates to

ADR-079, ADR-080, ADR-081, ADR-085, ADR-094, ADR-097, ADR-099

## Context

PersAI already has the main platform primitives needed for stronger professional and B2B work:

- first-class platform Skills with instruction cards, Skill documents, Skill knowledge cards, user assignments, prompt materialization, and Skill-aware retrieval
- plan-owned capability and limit truth for Skill count, knowledge storage, retrieval policy, context policy, sandbox policy, model slots, tool activation, per-tool caps, and tool-loop budgets
- public-pricing visibility control through `Plan.presentation.showOnPricingPage`
- native runtime execution modes (`normal`, `premium`, `reasoning`) and tool budgets
- web chat `deepModeEnabled` as an existing chat-scoped behavior toggle
- unified Files and document render-job architecture for durable user-visible file surfaces
- stream-visible activity events for retrieval and tool lifecycle

The current gap is not a missing "engineering Skill" or a missing B2B user type. The gap is that long professional analysis is still expressed indirectly through `deepMode`, `reasoning`, router policy, retrieval decisions, and plan budgets. That is too implicit for Cursor-like work where the assistant reads project context, plans, gathers documents, compares sources, re-plans, and reports an audit trail of actions without exposing raw chain-of-thought.

Founder decisions captured for this ADR:

1. B2B users are distinguished only by their effective plan. There is no separate B2B user class.
2. The professional mode is chat-scoped, not account-scoped.
3. The product mode should be a third chat mode, tentatively named `project`, alongside ordinary chat and the current smart/deep mode.
4. `project` mode should work for B2C and B2B users. The difference is the effective plan envelope: B2C gets minimal project limits, B2B gets the full high-depth plan.
5. Domain specialization must remain Skills: engineering, design, procurement, compliance, industry standards, and other verticals are Skill packs, not separate runtime modes.
6. The Cursor-like experience should come from a staged project execution profile and visible activity feed, not from a complex new routing tree.
7. The final implementation program must create a hidden B2B plan in the live cluster/admin control plane and fill the B2B limits correctly, including KB/storage/retrieval/tool budgets.

## Current code audit summary

This ADR is based on a read-only audit of the current code paths.

### Skills

Existing Skills are strong enough to serve as the domain specialization layer:

- `Skill`, `SkillDocument`, `SkillKnowledgeCard`, `AssistantSkillAssignment`, `KnowledgeIndexingJob`, and `KnowledgeVectorChunk` exist in the Prisma model.
- Admin Skill CRUD, document upload/reindex/delete, knowledge-card CRUD, and assistant-assisted authoring exist under the admin Skill surface.
- User Skill assignment exists under the assistant Skill surface and enforces plan `maxEnabledSkills`.
- `MaterializeAssistantPublishedVersionService` materializes enabled Skill prompt blocks and compact routing metadata into the runtime bundle.
- `OrchestrateRuntimeRetrievalService` validates active Skill assignments and retrieves from Skill documents/cards.

Current limitations:

- Skills are platform/global, not tenant-owned.
- Skills do not own tool budgets, model slots, or retrieval policy.
- Skills should not become execution profiles.

Conclusion: Skills are ready for professional domain packs, including engineering and standards packs. They are not the right place to encode B2B depth.

### Plans

Plans already own the capability envelope needed for B2B:

- `skillPolicy.maxEnabledSkills`
- `quotaLimits.knowledgeStorageBytesLimit`, `mediaStorageBytesLimit`, `workspaceStorageBytesLimit`
- `retrievalPolicy`
- `contextPolicy`
- `sandboxPolicy`
- `primaryModelKey`, `premiumModelKey`, `reasoningModelKey`, `systemToolModelKey`, `retrievalModelKey`, `embeddingModelKey`
- `runtimeTierDefault`
- `toolActivations[]` with `dailyCallLimit` and `perTurnCap`
- `toolBudgets.loopLimitByMode.normal|premium|reasoning`
- `presentation.showOnPricingPage`

`ManageAdminPlansService.listPublicPricingPlans()` filters public pricing to `status === "active" && presentation.showOnPricingPage`, so an active hidden plan can exist without appearing on public pricing. Admin/Ops plan override and effective subscription resolution can still apply active hidden plans.

Conclusion: a hidden B2B plan is the correct capability and limits mechanism.

### Runtime

Current runtime behavior is useful but not enough as the final project-analysis behavior:

- Runtime tool-loop defaults are `normal: 3`, `premium: 4`, `reasoning: 8`.
- Per-tool defaults include `web_search: 3`, `web_fetch: 5`, `browser: 3`, `exec: 5`, `shell: 5`, `files: 10`, `knowledge_search: 5`, `knowledge_fetch: 10`.
- Plans can override loop limits and per-tool caps.
- The current `reasoning_request` precheck chooses `executionMode: "reasoning"` but sets `retrievalHint: false` and an empty retrieval plan.
- Model role selection depends on router active/shadow state; when routing is shadow, `deepMode` only maps to `premium_reply`.

Conclusion: depth is partly plan-owned, but behavior is not fully plan-owned. `project` needs its own chat-scoped execution profile so B2C/B2B behavior is explicit and testable.

### Web UI

Existing UI patterns are usable:

- chat already stores and sends `deepModeEnabled`
- the composer already has a mode-like control surface
- sidebar already renders chat list state and live indicators
- chat entries already interleave messages and activity events
- `ThoughtBlock` exists but should not become the project activity feed

Conclusion: the clean UI path is a third chat mode and a project-aware sidebar/file panel, not a separate B2B workspace shell.

## Decision

PersAI will add a chat-scoped `project` mode with a project execution profile. B2B will be expressed only through the effective plan, not through a separate user type.

Core decisions:

1. Chat mode becomes the product behavior switch.
2. Effective plan remains the capability and limits envelope.
3. Skills remain the domain specialization layer.
4. Project mode is generic professional analysis mode, not engineering-specific.
5. Cursor-like behavior is implemented through a staged execution profile, not a complex routing tree.
6. User-visible activity feed is separate from internal reasoning and never exposes raw chain-of-thought.
7. Project files are surfaced as chat/project context, reusing existing Files truth rather than introducing a parallel file system.

## Product model

### Chat modes

Target chat mode values:

- `normal` - ordinary B2C chat behavior
- `smart` - current think-deeper behavior, preserving the existing product semantics of `deepModeEnabled`
- `project` - staged project-analysis behavior

The mode is stored on the chat/thread, not on the user.

`project` is available to both B2C and B2B users. The effective plan determines how deep it can run.

### B2C vs B2B

There is no `isB2BUser` field and no separate B2B identity class.

B2C project mode:

- same UI mode
- conservative project limits
- low tool and retrieval budgets
- smaller context and KB envelope

B2B project mode:

- same UI mode
- hidden B2B plan envelope
- high Skill count
- high KB/storage envelope
- deeper retrieval/context/sandbox/tool budgets
- stronger model slots
- isolated runtime tier when configured

### Skills and domains

Domains are Skills:

- engineering
- design
- construction/project documentation
- procurement and components
- compliance and industry standards
- company-specific norms and procedures

Industry packs such as Gazprom, NOVATEK, or other standards packs should be modeled as curated Skills with Skill documents and knowledge cards, not as hardcoded runtime branches.

## Runtime model

### Project execution profile

`project` mode introduces a deterministic staged execution profile:

1. `plan`
   - understand the user request
   - identify relevant project files, Skill packs, KB sources, and possible web/browser needs
   - produce an internal task plan, not visible raw chain-of-thought

2. `gather`
   - inspect which project files are relevant
   - surface project files in the existing developer/working-files context with tiny semantic anchors beside the current refs/aliases
   - trigger deep document extraction only for files that are actually needed in the current pass
   - persist extracted/cache truth after the first deep analysis and reuse it instead of reparsing by default
   - run Skill/user/Product KB retrieval
   - fetch exact excerpts when needed
   - optionally use web/browser when local context is insufficient

3. `analyze`
   - compare requirements, project documents, norms, and assumptions
   - identify conflicts, omissions, ambiguities, outdated references, and optimization candidates

4. `replan`
   - decide whether another pass is needed
   - gather missing sources or inspect narrower file sections
   - bounded by the effective plan

5. `synthesize`
   - produce the final user-facing answer under a project output contract
   - include sources and confidence/residual gaps

This is a loop-policy/profile problem, not a routing-tree problem. The router may still help with lightweight classification, but `project` mode must not depend on a fragile tree of special-case routing decisions.

### Plan-owned depth

The project profile reads depth from the effective plan:

- max project passes
- loop budgets
- per-tool caps
- retrieval limits
- context hydration budget
- sandbox policy
- enabled tool set
- model slots

If a dedicated `project` budget is not added in the first implementation slice, the project profile may initially map to the plan's `reasoning` budget plus project-specific guardrails. A later slice may add explicit plan keys such as `projectPolicy.maxPasses` and `projectPolicy.activityVerbosity`.

### Required first runtime corrections

1. Project mode must not inherit the current `reasoning_request` behavior that disables retrieval.
2. Project mode should default to retrieval-aware behavior when project files, Skills, or KB sources exist.
3. Project mode must support a project-only visible reasoning summary feed: concise user-facing summaries of the plan, hypotheses, checks, source comparisons, conflicts, gaps, and reasons for another pass.
4. Project mode must enforce a final-answer contract rather than streaming raw hidden scratchpad.
5. Project mode must stream user-visible activity events for stages and source/tool usage.

## Project visible reasoning and activity feed

Project mode should feel closer to Cursor than ordinary chat: the user should see how the assistant is working, what it is checking, and why another pass is needed. This visibility is a project-mode feature, not a default behavior for ordinary B2C chat.

PersAI should show two safe streams in project mode:

1. activity events - what the system is doing
2. visible reasoning summaries - concise, model-authored summaries of the current plan/check/gap/conclusion

Visible reasoning summaries are allowed and encouraged in project mode. Raw hidden chain-of-thought remains hidden.

Allowed visible events:

- planning started/completed
- searching project files
- reading file or document sections
- retrieving Skill/KB sources
- using web search/fetch/browser
- comparing documents
- checking norms/rules
- re-planning because gaps remain
- synthesizing final report

Visible reasoning summaries may include:

- "Plan of analysis"
- "What I am checking now"
- "Why I need a second pass"
- "Conflict found between requirement A and source B"
- "Missing data or unresolved assumption"
- "Interim conclusion"
- "What changed after reading an additional source"

Events and summaries may include:

- stage
- status
- short user-safe summary
- source class
- source/file display name
- result count
- elapsed time
- error/skip status

Events must not include:

- raw hidden reasoning
- provider scratchpad
- hidden developer prompts
- full tool result payloads unless explicitly safe and user-facing

Implementation should extend the existing runtime stream and web `ActivityEvent`/`ChatEntry` pattern rather than introduce an unrelated feed channel. Ordinary `normal` and `smart` chats should keep the calmer current experience unless a later product decision explicitly enables visible reasoning summaries outside project mode.

## Project sidebar and files

The main chat list remains the left-sidebar anchor.

For project-mode chats:

- the chat row is marked as a project
- the selected project chat exposes a lower sidebar section for project files
- project files are chat/project context, not a second file authority
- file identity remains the existing `AssistantFile`/`fileRef` truth
- project files may be uploaded chat files, generated outputs, or files explicitly attached/saved into the project context

The project file panel should start as a projection over existing Files/chat attachment truth. A separate project file registry should be added only if current file associations prove insufficient during implementation.

## Hidden B2B plan

### Plan purpose

The hidden B2B plan is the high-capability envelope for project mode and professional users.

It should be:

- `status: active`
- `presentation.showOnPricingPage: false`
- not shown on public pricing
- assignable through admin/Ops/subscription override
- configured with high but explicit limits

### Required B2B plan dimensions

The final implementation program must create or update a hidden B2B plan in the target cluster/admin control plane and fill these fields intentionally:

- `skillPolicy.maxEnabledSkills`
- `quotaLimits.tokenBudgetLimit`
- `quotaLimits.knowledgeStorageBytesLimit`
- `quotaLimits.workspaceStorageBytesLimit`
- `quotaLimits.mediaStorageBytesLimit`
- document/image/video monthly units if enabled
- `retrievalPolicy`
- `contextPolicy`
- `sandboxPolicy`
- model slots: normal, premium, reasoning, system tool, retrieval, embedding
- `runtimeTierDefault`
- plan-managed tool activations
- per-tool `dailyCallLimit`
- per-tool `perTurnCap`
- `toolBudgets.loopLimitByMode`

### B2B plan creation rule

Agents must not invent provider model keys or cluster-specific plan facts.

When creating the cluster plan, the implementation agent must:

1. read current Admin Runtime provider catalog and active model capabilities
2. read current public/paid plans and identify the strongest existing paid baseline
3. clone the business-safe lifecycle/payment/presentation shape from the closest paid plan where appropriate
4. set `showOnPricingPage: false`
5. choose model keys only from active catalog rows
6. preserve existing billing lifecycle fallback rules unless explicitly changing them
7. set B2B limits using the ADR baseline below, adjusted only when current cluster/provider capabilities require it
8. verify the saved plan through the admin API/read model after writing
9. apply the plan to a test assistant/workspace through the existing override/subscription path
10. materialize/reapply the assistant bundle and verify runtime bundle contains the expected project-capable policy

### Initial B2B baseline

The exact numeric values may be adjusted from live cluster evidence, but the initial target must be a strong professional envelope rather than a lightly renamed consumer plan:

- `maxEnabledSkills`: at least 12
- `knowledgeStorageBytesLimit`: at least 10 GB, or at least 10x the strongest visible paid plan, whichever is larger
- `workspaceStorageBytesLimit`: at least 50 GB, or at least 10x the strongest visible paid plan, whichever is larger
- `mediaStorageBytesLimit`: at least 20 GB, or at least 10x the strongest visible paid plan, whichever is larger
- `retrievalPolicy.defaultMaxResults`: at least 10
- `retrievalPolicy.maxMaxResults`: at least 20
- `retrievalPolicy.lexicalCandidateLimit`: at least 80
- `retrievalPolicy.vectorCandidateLimit`: at least 80
- `retrievalPolicy.fetchMaxChars`: at least 24000
- `retrievalPolicy.fetchFullModeMaxChars`: at least 120000
- `retrievalPolicy.fetchFullModeMaxChatMessages`: at least 80
- `retrievalPolicy.helperEnabled`: true when a retrieval model is configured
- `retrievalPolicy.embeddingSearchEnabled`: true when an embedding model is configured
- `contextPolicy.preset`: `rich` or `custom`
- `contextPolicy.knowledgeHydrationBudget`: materially higher than the strongest visible paid plan
- `sandboxPolicy.enabled`: true
- `sandboxPolicy.networkAccessEnabled`: false by default unless explicitly approved for the contour
- `runtimeTierDefault`: `paid_isolated` when supported, otherwise the strongest available paid tier
- project/reasoning loop limit: at least 10
- `web_search` per-turn cap: at least 6 when enabled
- `web_fetch` per-turn cap: at least 10 when enabled
- `knowledge_search` per-turn cap: at least 10
- `knowledge_fetch` per-turn cap: at least 20
- `files` per-turn cap: at least 30
- `exec`/`shell` per-turn caps: conservative and explicitly justified; start at 8-10 only if sandbox is enabled and safe

These values are not public marketing claims. They are internal default targets for the first hidden B2B plan. Operators may tune them after cost and quality evidence.

## Knowledge, indexing, and Skill readiness

Before implementing project mode, agents must verify current KB/Skill readiness instead of assuming it:

1. Confirm Skill documents and Skill knowledge cards are indexed into `KnowledgeVectorChunk` when embedding search is enabled.
2. Confirm Product KB and Skill KB retrieval use admin-owned `embeddingModelKey` and `retrievalModelKey` where appropriate.
3. Confirm plan retrieval policy is read by assistant/user KB paths.
4. Confirm document-processing provider settings are configured for the target environment when B2B document sources require OCR/parsing.
5. Confirm project-mode file reads use Files/chat attachment truth and do not create a second file identity.
6. Confirm retrieval observability records project-mode retrieval stages honestly.

If any of these are missing, the implementation must tune the existing KB/Skill/indexing path first. It must not create a parallel project-only knowledge system.

## Implementation plan

### Slice 1 - ADR and code audit closeout

This document.

Deliverables:

- ADR-100 added
- current code audit summarized
- no runtime behavior changed

### Slice 2 - Chat mode contract

Status: **complete in working tree** (2026-05-22; verified after Slice 2.1 closeout).

Add explicit chat mode while preserving existing `deepModeEnabled` behavior during migration.

Deliverables:

- API/data contract for chat mode: `normal | smart | project`
- web chat create/update/read surfaces carry chat mode
- existing deep mode maps to `smart`
- `project` initially maps to the same compatibility `deepMode=true` runtime path until Slice 4 adds the dedicated project execution profile
- no separate B2B user type
- tests for old chats and mode switching

Do not remove `deepModeEnabled` until all clients are migrated.

#### Slice 2 verification (independent read-only audit, 2026-05-22)

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Prisma `assistant_chats.chat_mode` + migration backfill | pass | `20260522151500_adr100_chat_mode_contract` |
| API/domain sync `chatMode` ↔ `deepModeEnabled` | pass | `chatModeToDeepModeEnabled`, repository resolver |
| Web read/update/send carries `chatMode` | pass | patch, stream payload, chat state |
| Runtime compat via `deepMode=true` for smart/project | pass | no runtime `chatMode` behavior yet (Slice 4) |
| OpenAPI turn-send contract includes `chatMode` | pass | `AssistantWebChatTurnRequest.chatMode` + `deepModeEnabled` (Slice 2.1) |
| Tests for mode switching / migration | pass | `parseInput`, `parseUpdateInput` sync/conflict; web patch test |
| Docs/source-of-truth updated | pass | ADR, handoff, changelog, architecture, API, data model, test plan |
| Repo verification gate green | pass | parent re-ran lint, format:check, api/web typecheck 2026-05-22 |

Residual risks (accepted, not blocking Slice 2 merge):

- legacy `deepModeEnabled`-only PATCH can downgrade `project → smart` for old clients (documented; guard deferred until legacy clients migrate)

Scope overlap accepted from Slice 2 (not Slice 3 complete):

- header three-state `ChatModeToggle`
- sidebar project marker (`FolderKanban`)

#### Slice 2.1 - Chat mode contract closeout

Status: **complete** (2026-05-22; implementation subagent + parent verification).

Owner: implementation subagent. Parent agent verified gate and updated this ADR.

Allowed files:

- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/**` (via `contracts:generate` only)
- `apps/api/test/send-web-chat-turn.service.test.ts`
- `apps/api/test/manage-web-chat-list.service.test.ts` (if exists) or add focused parseUpdateInput test file
- `docs/API-BOUNDARY.md` (turn-send contract note only if needed)
- revert unrelated hunk in `apps/web/app/app/_components/chat-input.tsx` if still present

Out of scope:

- Slice 3 sidebar project files
- Slice 4 runtime profile
- any `apps/runtime/**` code changes

Deliverables:

- add optional `chatMode` and `deepModeEnabled` to `AssistantWebChatTurnRequest` in OpenAPI
- regenerate contracts
- add focused API test(s) for `ManageWebChatListService.parseUpdateInput` sync/conflict behavior
- run ADR-100 focused verification + repo gate; report command output in handoff

### Slice 3 - Project UI shell

Status: **complete in working tree** (2026-05-22; subagents 3A + 3B + parent verification).

Extend the current composer/sidebar shape.

Deliverables:

- compact three-state mode control in the composer area
- project chat marker in the chat list
- selected project chat shows project files in the lower sidebar
- mobile fallback uses a compact chip/menu rather than a wide control
- project files read existing Files/chat attachment truth

#### Slice 3 verification (parent agent, 2026-05-22)

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Lower sidebar project files panel | pass | `project-files-panel.tsx`; dedupe by `fileRef`; paginated `getChatMessages` |
| Composer-area mode control (desktop 3-state) | pass | `chat-area.tsx` — toggle above `ChatInput` |
| Mobile compact chip + 3-mode menu | pass | replaces wide header pills |
| List project marker | pass | from Slice 2 (`FolderKanban`) |
| Tests | pass | `sidebar.test.tsx` 20/20; `chat-area.test.tsx` 14/14 |
| No API/runtime/contracts diffs | pass | web-only slice |
| Repo gate | pass | lint + format:check + web/api typecheck (after prettier fix on 3A files) |

Residuals (accepted):

- project files panel refetches full paginated history on mount; no live refresh hook to `useChat` optimistic attachments yet
- draft threads without persisted `chat.id` hide panel until chat exists

### Slice 4 - Project execution profile

Status: **complete in working tree** (2026-05-22; implementation subagent + parent verification).

Add the staged runtime profile with minimal routing changes.

Deliverables:

- project-mode request/profile reaches runtime
- project profile runs staged plan/gather/analyze/replan/synthesize loop
- project mode defaults to retrieval-aware behavior
- project mode reads plan budgets/caps instead of hardcoding B2B depth
- B2C project mode remains bounded by ordinary plan limits
- B2B project mode uses hidden B2B plan limits
- tests cover retrieval not being disabled for document-heavy project turns

#### Slice 4 verification (parent agent, 2026-05-22)

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Project mode reaches runtime distinctly | pass | runtime now branches on `RuntimeTurnRequest.chatMode === "project"` |
| Retrieval-aware precheck for project mode | pass | avoids the PDF/document `reasoning_request` empty-retrieval trap |
| Staged project developer contract | pass | `project-execution-profile.ts` adds plan/gather/analyze/replan/synthesize contract |
| Plan-budget reads reuse existing reasoning budgets | pass | uses existing bundle/tool-policy reasoning budgets; no new plan keys |
| Native API bridge includes `chatMode` consistently | pass | `send-native-web-chat-turn.service.ts` now includes `chatMode` in helper-built bodies |
| Tests | pass | runtime project-profile 3/3; native send 5/5; native stream 8/8; focused routing test pass |
| Repo gate | pass | lint, format:check, api/web/runtime typecheck |

Residuals (accepted):

- shadow router mode still does not force orchestrated pre-retrieval; project fix currently covers precheck + existing tool-loop path
- project activity / reasoning feed still has no durable persistence; current slice is session-ephemeral by design

### Slice 5 - Activity feed

Status: **complete in working tree** (2026-05-22; implementation subagent + parent verification).

Add safe project activity events and visible reasoning summaries.

Deliverables:

- runtime stream event types for project stage/activity
- runtime/web support for project-only visible reasoning summary entries
- API/web maps events into existing chat activity timeline
- visible events show actions, sources, and safe summary reasoning, not raw hidden chain-of-thought
- tests verify activity appears for project-mode retrieval/tool stages

#### Slice 5 verification (parent agent, 2026-05-22)

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Runtime emits project-only stage/activity events | pass | additive `project_activity` events only for `chatMode === "project"` |
| Runtime emits safe visible reasoning summaries | pass | additive `project_reasoning_summary`; bounded runtime-authored summaries only |
| API/native bridge maps new stream events | pass | new SSE event names added without breaking existing activity path |
| Web appends project feed into existing timeline | pass | reuses `activities[]` + `ActivityBadge`, not `ThoughtBlock` |
| Ordinary chats remain unchanged | pass | new events are project-gated; normal/smart flow preserved |
| Tests | pass | runtime project-stream 2/2; native stream 9/9; web use-chat 78 + activity-badge 7 |
| Repo gate | pass | lint, format:check, api/web/runtime typecheck |

Residuals (accepted):

- project activity feed is session-ephemeral in client state; no DB persistence in this slice
- client-side tool-badge suppression on reattach is not fully chat-mode-aware when mode is unknown locally

### Slice 6 - Skill and KB tuning

Status: **complete in working tree for original pre-deploy scope** (2026-05-22; 6A/6B/6C/6D/6E/6F complete), but live verification opened mandatory Slice 6H source-admission cleanup before deploy readiness.

Tune existing Skills/KB/indexing only where evidence shows gaps.

Deliverables:

- verify Skill documents/cards indexing
- verify Product KB and Skill KB retrieval under project mode
- verify document extraction/OCR settings in Admin Tools for target contour
- add cheap background upload micro-description when deterministic summary is absent, without moving heavy parse-on-upload into the ordinary path
- add tests around project-mode retrieval source classes

Do not add tenant-owned Skills or a project-only KB unless current global Skill/Product/user KB truth is proven insufficient.

Before deploy / Slice 7, Slice 6 required three mandatory closeout blocks:

1. **Slice 6C - Project File Intelligence**
   - project chat files become a first-class gather source
   - tiny semantic anchors appear in the existing developer/working-files context beside current refs/aliases
   - file identity survives weak/generic filenames across formats without bloating prompt tokens

2. **Slice 6D - Deep file analysis integration**
   - deep analysis for complex docs/media must use the existing shared extraction stack (`DocumentExtractionService`, OCR/parser providers, document-analysis path), not default to bare `files.read`
   - first deep extraction should be persisted/cached on existing attachment/`fileRef` truth so the same file is not reprocessed repeatedly

3. **Slice 6E - Runtime core correction**
   - the project gather/analyze/replan loop must treat project chat files as a real source class
   - project runtime must use the above semantic anchors and cached extraction truth systematically, not only opportunistically

Slice 6 is **not** honestly complete until these three blocks are either implemented or explicitly moved into a superseding ADR before deploy.

#### Slice 6A - Token-safe semantic summaries

Status: **complete in working tree** (2026-05-22; implementation subagent + parent verification).

Bounded groundwork only:

- adds tiny durable `semanticSummary` + `semanticSummarySource` on existing attachment/file metadata when cheap deterministic signals already exist
- mirrors summary into canonical file truth so later turns can use `fileRef`-based hints
- exposes capped working-file hints for weak/generic filenames only
- keeps `contentPreview` unchanged and does **not** add upload-time vision captioning or heavy parsing for all uploads

#### Slice 6A verification (parent agent, 2026-05-22)

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Durable semantic summary on existing metadata | pass | attachment metadata + canonical file metadata only; no schema migration |
| Deterministic low-cost generation only | pass | from `textExtract` / `transcription` only |
| Token-safe runtime working-file hints | pass | weak filenames only; strict per-file and total caps |
| No prompt bloat / no preview dump | pass | `contentPreview` stays separate and out of working-file hints |
| Tests | pass | API semantic-summary 3/3; media staging pass; runtime working-files semantic-hint test pass |
| Repo gate | pass | lint, format:check, api/web/runtime typecheck |

Residuals (accepted):

- no backfill for already-uploaded files
- no image vision summary in this slice
- no retrieval-order / pinned-skill changes yet; those remain the open part of Slice 6

#### Slice 6B - Project-gated retrieval ordering

Status: **complete in working tree** (2026-05-22; implementation subagent + parent verification).

Bounded retrieval change only:

- keeps ordinary non-project active-skill orchestration unchanged
- for project-mode active-skill turns, keeps the skill stage and still stages user knowledge before product knowledge even when skill hits already exist
- uses a tiny internal `gatherProfile: "project"` flag to gate the changed ordering strictly to project retrieval
- does **not** add pinned-skill schema, chat-file retrieval staging, or web execution inside orchestrate

#### Slice 6B verification (parent agent, 2026-05-22)

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Project-only retrieval-ordering change | pass | active-skill project turns now stage skill -> user -> product |
| Ordinary non-project active-skill behavior preserved | pass | no global change to ordinary `active_skill` semantics |
| Tight project gating | pass | internal `gatherProfile: "project"` only |
| Tests | pass | focused orchestrate-runtime-retrieval + turn-execution tests pass |
| Repo gate | pass | lint, format:check, api/web/runtime typecheck |

Residuals (accepted):

- pinned-skill design and schema are still not implemented
- chat files are still not a first-class orchestrated retrieval stage
- Slice 6 indexing/admin verification is still not fully closed

#### Slice 6C - Project File Intelligence

Status: **complete in working tree** (2026-05-22; implementation subagent + parent verification).

Required outcome:

- the existing developer/working-files section becomes the steady-state prompt seam where project files carry tiny semantic anchors beside current refs/aliases
- these anchors must help the model understand what a file is without replaying full previews or full extracted text
- anchors must stay token-cheap and reuse canonical attachment/`fileRef` truth

#### Slice 6C verification (parent agent, 2026-05-22)

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Project files become a real staged source | pass | project gather now stages project-file-backed items before KB in project mode |
| Working-files remains cheap selector layer | pass | tiny semantic anchors stay in existing developer/working-files context only |
| No second file truth / no new KB | pass | uses canonical attachment + `AssistantFile` / `fileRef` truth only |
| Tests | pass | focused orchestrate-runtime-retrieval + runtime turn-execution tests pass |
| Repo gate | pass | lint, format:check, api/web/runtime typecheck |

#### Slice 6D - Deep file analysis integration

Status: **complete in working tree** (2026-05-22; implementation subagent + parent verification).

Required outcome:

- project mode must use the existing deep extraction/parsing stack for complex docs/media when deeper analysis is needed
- the first deep analysis result must be persisted/cached on existing attachment/`fileRef` truth so later passes do not rerun the same heavy analysis by default
- this applies beyond PDF to the real mixed project-file contour

#### Slice 6D verification (parent agent, 2026-05-22)

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Existing deep extraction stack reused | pass | `ExtractInternalRuntimeAssistantFileService` still delegates to `DocumentExtractionService` |
| One-time deep extraction cache on existing truth | pass | cache stored on `AssistantFile.metadata.internalRuntimeFileExtractionCache` |
| No parse-every-upload regression | pass | upload path stays light; extraction remains lazy |
| Tests | pass | focused extraction-cache API test passes |
| Repo gate | pass | lint, format:check, api/web/runtime typecheck |

#### Slice 6E - Runtime core correction

Status: **complete in working tree** (2026-05-22; implementation subagent + parent verification).

Required outcome:

- project runtime must treat project chat files as a real gather source in the staged loop
- source ordering must become operationally real, not only advisory:
  - pinned/active skill first when present
  - project chat files
  - user/product KB
  - web/tools
- this slice must make the project mode feel like a real document-working mode, not just a better ordinary chat

#### Slice 6E verification (parent agent, 2026-05-22)

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Project runtime treats project files as a real gather source | pass | project-only file gather stage added in existing API orchestrator |
| Source ordering operationalized for project mode | pass | project + skill = skill -> project files -> user -> product; project no-skill = project files -> user -> product |
| Ordinary mode unchanged | pass | gated by `gatherProfile === "project"` only |
| Tests | pass | focused orchestrate-runtime-retrieval + turn-execution tests pass |
| Repo gate | pass | lint, format:check, api/web/runtime typecheck |

#### Slice 6F - Upload micro-description background enrichment

Status: **complete in working tree** (2026-05-22; parent-verified bounded pre-deploy slice).

Required outcome:

- when a staged upload lacks a deterministic semantic summary, API can enqueue one cheap background micro-description pass after canonical `fileRef` truth exists
- project mode always enqueues this pass for eligible uploads; ordinary non-project chats obey an admin runtime boolean gate instead of forcing B2C upload analysis on by default
- the helper must reuse the existing `systemTool` model slot, not add a new dedicated helper model slot
- canonical truth must persist on `AssistantFile.metadata.semanticSummary` / `semanticSummarySource` and mirror attachment metadata when practical
- internal cost accounting for this helper must stay ledger-only: persist replay-safe helper `usage` + durable call time on the job row first, then append a non-blocking ledger row keyed by immutable job id
- this remains a tiny semantic-summary path only; it must not become parse-every-upload or live-verification-by-assertion

#### Slice 6F verification (parent agent, 2026-05-22)

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Admin runtime B2C upload toggle | pass | `routerPolicy.analyzeUploadsOnB2cUpload`, default `false`; project mode bypasses the toggle and always enqueues |
| Durable API-owned background job lane | pass | new DB-backed `assistant_upload_micro_description_jobs` with lease scheduler/worker in API |
| Helper model-slot reuse | pass | micro-description helper uses existing `systemTool` model slot |
| Canonical semantic-summary persistence | pass | writes `AssistantFile.metadata.semanticSummary` + `semanticSummarySource`, mirrors attachment metadata when practical |
| Internal ledger-only себес seam | pass | durable `usageJson` + `usageOccurredAt` on job row first; non-blocking `tool_helper` ledger row appended after persistence; no user quota path changed |
| Summary-source extension | pass | semantic summary source adds `upload_micro_description` |
| Enqueue timing | pass | stage path can enqueue once `fileRef` exists; prepared inbound turn enqueues after staged-attachment merge and final `chatMode` resolution |
| Tests | pass | focused API job/media/prepare/settings tests, `record-model-cost-ledger.service.test.ts`, and focused web admin/client/settings tests pass |
| Repo gate | pass | lint, format:check, api/web typecheck |

Residuals still open after Slice 6 closeout:

- `pinnedSkillId` remains deferred and must be a separate chat-scoped override if added later
- image-only richer visual summaries are still not implemented beyond current bounded semantic anchors
- project-file gather intentionally stays narrow to canonical attachment-backed, extraction-capable files
- deploy/live verification must still prove this behavior end to end before Slice 7

#### Slice 6H - Retrieval source admission and relevance hygiene

Status: **complete in working tree / parent-verified** (2026-05-22).

Live verification showed that the current retrieval path can inject irrelevant context into the prompt across `normal`, `smart`, and `project` modes. The failure is systemic rather than project-only:

- runtime precheck often enables user and Product KB together whenever a generic knowledge/retrieval intent is detected
- project precheck currently enables Product KB whenever knowledge tools are available
- API orchestration groups `document`, `memory`, and `chat` into one broad `user_document` bundle and groups Product KB plus current subscription/plan facts into one broad `product_kb` bundle
- `searchMemory()` and `searchChats()` search assistant-wide history by broad lexical `OR`, so old unrelated chats can enter new turns
- synthetic plan/subscription documents are searched like ordinary Product KB, so tariff/plan facts can appear in unrelated engineering/project questions
- runtime post-orchestration hydration currently prioritizes `skill_reference`, `user_document`, and `product_kb`, but does not give `project_file` its intended top project priority

Required outcome:

- preserve Product KB for genuine PersAI/product/platform/pricing/subscription questions; do **not** globally disable it by mode
- preserve human memory and recall; assistant-wide memory/chat remains available when the user explicitly asks to recall prior discussions
- preserve Skill semantics; Skills remain domain specialization, not runtime modes, and ordinary auto-skill behavior must not be broken
- remove irrelevant source stuffing from ordinary/smart/project prompts; low-relevance context must be omitted rather than included to fill a block
- make source admission policy operator-tunable through existing Admin Runtime / retrieval policy surfaces where practical instead of hardcoding a brittle routing tree

Target source-admission rules:

1. **Skills**
   - Skill activation remains the domain-specialization layer.
   - If a chat-scoped pinned Skill is added later, it must be a separate field (for example `pinnedSkillId`) and must not overload ordinary `skillDecisionState`.
   - Without a pinned Skill, project mode keeps ordinary auto-skill behavior: foreground activation, sticky reuse, and configured background recheck cadence.
   - Skill hits should be considered sufficient grounding unless the request also asks for project files, user docs, web freshness, or explicit product/subscription facts.
   - Product KB must not be appended after successful Skill grounding unless product intent is present.

2. **Product KB and subscription/plan facts**
   - Product KB is admitted for product/platform questions: PersAI features, pricing, plans, quotas, subscription state, limits, billing, setup, and platform behavior.
   - Product KB is not admitted for unrelated external/domain questions merely because retrieval is active.
   - Synthetic plan catalog and `subscription:current` documents should be treated as a separate plan/subscription fact class, admitted only for billing/product intent.
   - Mixed questions may admit both domain/project sources and Product KB when the user explicitly asks to compare PersAI/product constraints with the domain task.

3. **Chat and memory**
   - Current-thread chat context may be used automatically when relevant.
   - Cross-thread chat and contextual memory require explicit recall intent such as “помнишь”, “что мы обсуждали”, “вернись к прошлому”, or a similarly clear reference.
   - Core durable memory may continue to hydrate through the existing memory path, but orchestrated `Retrieved Knowledge Context` must not duplicate broad assistant-wide memory unless source admission allows it.
   - Cross-thread recall should be tightly capped and relevance-ranked rather than broad assistant-wide lexical `OR` stuffing.

4. **Project files**
   - In project mode, project files/current chat files remain first-class gather sources.
   - Runtime hydration priority must rank `project_file` above ordinary user/product sources.
   - If project files are irrelevant to the current user request, they may be omitted; the system should not include low-confidence file context just because project mode is active.

5. **No forced filler**
   - The orchestrated context block should prefer zero retrieved items over low-relevance items.
   - Per-source results need a relevance floor and token-coverage guard so one incidental token cannot pull old chats, plan docs, or unrelated memory.
   - Plan/admin limits still control maximum volume, but relevance controls admission.

Implementation notes:

- Reuse existing `routerPolicy`, Admin Knowledge Retrieval Policy, and plan `retrievalPolicy` where possible.
- If new knobs are required, add them as a compact `retrievalSourcePolicy` under Admin Runtime router policy rather than scattering constants across runtime/API.
- Runtime routing should output source-intent/admission facts, not a hardcoded mode-only routing tree.
- API orchestration should enforce the final source admission decision before search/fetch and again before rendering.
- Tests must cover `normal`, `smart`, and `project`, including:
  - external engineering/project query does not retrieve plan/subscription/Product KB
  - product/pricing/subscription query still retrieves Product KB or subscription facts
  - explicit recall query can search cross-thread chat/memory
  - unrelated project turn does not search old investor/tariff chats
  - active Skill grounding does not automatically append Product KB without product intent
  - `project_file` outranks `product_kb` and `user_document` in runtime hydration

Implemented closeout:

- runtime precheck now derives product-source admission from product intent rather than generic retrieval intent, including project-mode precheck
- generic `plan` / `план` no longer triggers Product KB by itself
- `routerPolicy.precheckRuleOverrides` trigger lists are authoritative when non-empty: configured lists replace built-in defaults instead of merging with them
- explicit recall intent is carried in the retrieval plan reason code, and API orchestration searches `memory` / `chat` only when that recall marker is present
- ordinary user documents remain searchable without forcing assistant-wide memory/chat into every retrieval turn
- project-file retrieved items outrank ordinary user documents and Product KB in runtime hydration
- Admin Runtime helper copy now says filled trigger lists override the built-in router defaults

Verification:

- `corepack pnpm --filter @persai/runtime exec tsx test/turn-routing.service.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/project-execution-profile.test.ts`
- `corepack pnpm --filter @persai/runtime exec tsx test/turn-execution.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/orchestrate-runtime-retrieval.service.test.ts`
- `corepack pnpm --filter @persai/api exec tsx test/read-assistant-knowledge.service.test.ts`
- `corepack pnpm --filter @persai/web exec vitest run app/admin/runtime/page.test.tsx --config vitest.config.ts`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm run format:check`
- `corepack pnpm --filter @persai/runtime run typecheck`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`

#### Founder follow-up audit (2026-05-22; readonly verification, design guidance)

Verified current system truth:

- complex document parsing already exists in the shared API-owned `DocumentExtractionService` and is used by Knowledge indexing, document-job source extraction, and runtime `files.read` for extractable file types
- ordinary web chat upload does **not** run that full extraction path automatically; it only stores a small local `contentPreview` and canonical `fileRef`
- project chat files therefore remain visible today mainly through file refs, working-file aliases, current-turn multimodal PDF/image inputs, and explicit `files.read`; there is no durable extracted-text cache for chat attachments yet
- image and file attachments are analyzed reliably on the upload turn through direct multimodal input or direct file presence, but later turns do **not** get a durable semantic description; weak filenames or generic upload names across different formats are therefore not enough for the model to remember what the file was
- ordinary skill activation already has a safe split between foreground lexical activation, sticky reuse, and background cadence rechecks; this can be reused in project mode when no explicit skill is pinned

Design refinements to preserve for later slices:

1. Optional pinned skill in project mode should be a **separate chat-scoped field** (for example `pinnedSkillId`), not an overload of `skillDecisionState`.
2. If no pinned skill is selected, project mode should keep the ordinary auto-skill path:
   - foreground lexical activation
   - sticky reuse
   - background cadence recheck every configured N turns
3. If a pinned skill is selected, retrieval should prioritize sources in this order:
   - pinned Skill KB
   - project chat files / attachments
   - user/product KB
   - web and other tools
4. A pinned skill must not break or globally rewrite ordinary skill activation semantics on non-project chats.
5. Project-file intelligence must reuse the existing Files + `DocumentExtractionService` path rather than invent a second project file system or a second OCR/parser stack.
6. Durable revisit/re-analysis of complex chat attachments should use an extraction cache/metadata layer attached to the existing `fileRef` / attachment truth rather than reparsing on every access.
7. Do **not** run full document parsing/OCR on every ordinary chat upload by default. Project mode should first surface that a file exists, then request deeper extraction lazily when the staged `gather` pass decides the file is relevant.
8. If a later slice adds project-file extraction caching, it must sit on the existing `fileRef` / attachment truth and reuse the same shared parser path rather than creating a separate upload-time parsing pipeline.
9. If later slices need the model to reliably revisit images/files with weak filenames or generic upload names across formats, add a tiny durable semantic summary on canonical attachment/file truth (for example attachment metadata plus optional `fileRef`-level cache), rather than trying to encode that memory only in ephemeral prompt text.
10. This semantic-summary layer should be shared across ordinary B2C chats and project mode; `project` should only affect when deeper lazy generation is triggered, not create a separate storage truth.
11. Any semantic summary must be strictly bounded and token-cheap: short enough to anchor later retrieval and working-file context, not a second full transcript or hidden prompt dump.

### Slice 7 - Hidden B2B plan in cluster

Status: **not started** (blocked until deploy prep and live project retrieval verification pass).

Create or update the hidden B2B plan in the target cluster/admin control plane.

Deliverables:

- hidden active plan exists and is not returned by public pricing
- B2B plan fields are filled from current cluster truth and ADR baseline
- plan uses active provider catalog model keys only
- plan enables high-depth project mode through plan caps, retrieval/context/sandbox/tool budgets
- plan assigned to a test workspace/assistant
- assistant bundle materialized and inspected
- smoke project chat confirms project mode runs with B2B envelope

This slice is not complete until the plan exists in the live target environment, not only in local code.

## Execution rules for Cursor agents and subagents

1. One implementation session handles one bounded slice only.
2. The parent agent owns scope, edits, reconciliation, and final decisions.
3. Subagents may be used for readonly audit, code search, test execution, and independent review.
4. Subagents must not independently edit overlapping files.
5. Composer 2.5 may be used for readonly subagents or narrowly scoped implementation subagents only when the parent agent provides a precise task, explicit file boundaries, and expected output.
6. Before coding a slice, the parent agent must first search current code for existing usable surfaces and prefer those over new abstractions.
7. Do not create legacy compatibility layers for unshipped branch behavior.
8. Do not reintroduce OpenClaw runtime, deploy, secret, or request-time compatibility.
9. Do not create parallel project-only Files, KB, Skill, or retrieval systems unless the existing PersAI-native systems are proven insufficient in that slice.
10. Any architecture/API/data/workflow changes must update source-of-truth docs in the same slice.
11. The final B2B plan creation slice must inspect live/admin truth before writing plan values and must verify the saved result after writing.

### Recommended subagent usage

Use subagents for:

- Skills/KB/indexing audit
- plan/admin API audit
- runtime project-profile audit
- web/sidebar UX audit
- tests and verification
- cluster/admin plan readback verification

Each subagent must return:

- files inspected
- facts found in code or cluster state
- gaps
- recommended parent-agent actions
- no broad rewrites

## Non-goals

- no separate B2B user type
- no engineering-specific runtime mode
- no tenant-owned Skill catalog in this ADR
- no parallel project file store
- no parallel project KB/index
- no raw chain-of-thought display; project mode may show safe visible reasoning summaries
- no rewrite of ordinary B2C chat routing
- no replacement of existing plan, Skill, Files, or retrieval architecture

## Consequences

### Positive

- B2B is flexible because plan, not identity type, controls capability.
- One user can use project mode for work and ordinary chat for personal tasks under the same hidden plan.
- B2C users can experience project mode with safe small limits.
- Skills stay reusable across B2C and B2B.
- Cursor-like behavior is implemented as a runtime profile and activity feed, not as fragile routing complexity.
- Existing Files, KB, Skills, Plans, and materialization systems are reused.

### Negative

- Project mode adds a new behavioral contract that must be tested separately from `normal` and `smart`.
- The first implementation needs careful migration from `deepModeEnabled` to explicit chat mode.
- Activity and visible reasoning summary design must avoid leaking hidden reasoning while still feeling transparent.
- Hidden B2B plan creation requires live/admin verification and cannot be fully proven by local unit tests.
- Strong B2B limits increase cost risk unless ledger and Ops/Business monitoring are used.

## Alternatives considered

### Use only hidden plan and current reasoning mode

Rejected. Plans can raise limits, but current runtime behavior is still not explicitly project-oriented, and current reasoning precheck can disable retrieval for requests where retrieval is essential.

### Make engineering a runtime mode

Rejected. Engineering, design, procurement, and compliance are domains. Domains belong in Skills. Runtime mode should express behavior depth, not profession.

### Add separate B2B user type

Rejected. It would duplicate plan truth and make personal/work usage awkward for the same user. Effective plan already solves capability differentiation.

### Build a project-only KB/file system

Rejected for now. PersAI already has Files, Knowledge, Skill docs/cards, Product KB, and retrieval orchestration. Project mode should reuse them first.

### Expose raw thoughts as the activity feed

Rejected. Project mode may show visible reasoning summaries, plans, checks, interim conclusions, and reasons for re-planning, but raw hidden chain-of-thought remains hidden.

## Verification plan

For implementation slices:

- focused API tests for chat mode persistence and plan enforcement
- focused runtime tests for project profile budget/retrieval behavior
- focused web tests for mode control, project chat marker, and sidebar project files
- focused activity-feed tests for project stage events
- KB/indexing tests for Skill documents/cards and retrieval source classes where touched
- cluster/admin readback for hidden B2B plan creation
- required repo gate from `AGENTS.md` before claiming a code slice clean

## Execution program status (parent agent ledger)

| Slice | Status | Owner | Notes |
|-------|--------|-------|-------|
| 1 ADR + audit | done | parent | ADR-100 accepted |
| 2 chat mode contract | complete | prior session + 2.1 | verified in working tree |
| 2.1 contract closeout | complete | implementation subagent | OpenAPI turn request + parseUpdateInput tests + gate green |
| 3 project UI shell | complete | subagents 3A + 3B | files panel + composer mode UX verified |
| 4 project execution profile | complete | implementation subagent | runtime staged profile + native bridge verified |
| 5 activity + reasoning feed | complete | implementation subagent | project-only streams + visible reasoning feed verified |
| 6 Skill/KB tuning | complete through 6H | implementation subagents + parent verification | 6A/6B/6C/6D/6E/6F landed; 6H closes source-admission cleanup |
| 6H retrieval source admission | complete in working tree | parent + bounded subagents | Product KB intent-gated, recall-gated chat/memory, authoritative Admin Runtime trigger overrides, project-file priority |
| 7 hidden B2B cluster plan | blocked | ops subagent | after deploy prep and live-profile verification |

Parent-agent rules (founder directive 2026-05-22):

- parent agent orchestrates, verifies, and updates ADR/handoff/changelog only
- parent agent does not implement broad code slices directly
- one bounded subagent task at a time with explicit file boundaries
- no Slice 7 cluster plan work until Slice 4 exists

## Next recommended step

Run **deploy prep + live project verification**: validate the new source-admission behavior, project-file gather priority, lazy extraction cache, and upload micro-description job path against the target environment. Do not create the hidden B2B cluster plan (Slice 7) until live verification confirms project retrieval quality end to end.
