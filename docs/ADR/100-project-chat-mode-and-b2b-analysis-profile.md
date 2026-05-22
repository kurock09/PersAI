# ADR-100: Project chat mode and B2B analysis profile

## Status

Accepted. Slices 2 through 6H are implemented and verified as of 2026-05-22, and the immediate post-6H follow-up now also tightens the project/ordinary orchestrator layer: project summaries use meaning-first copy, real tool/retrieval activity now wins over generic project status in the live badge, early pre-answer project spam is reduced, and the staged runtime contract plus tool-loop follow-up more explicitly tells the model to keep progressing from local context to external verification when the current evidence is still insufficient. The pre-deploy project-mode core is in place: explicit `chatMode`, project UI shell, staged project execution profile, project-only activity/reasoning feed, project-file gather and lazy extraction cache, bounded upload micro-description enrichment, and Slice 6H retrieval source-admission cleanup. Slice 7 is not started; the honest next step is deploy prep plus live project verification before any hidden B2B cluster-plan work.

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
8. Source sufficiency must stay model-owned: runtime may expose plan/tool constraints and honest source hints, but it should not devolve into keyword routing that pretends to know the full answer path in advance.

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

### Mode and source boundaries

The intended steady-state split is:

- `normal` - ordinary assistant chat; no staged project workflow
- `smart` - the current think-deeper mode; deeper reasoning/tool use, but still ordinary chat rather than project analysis
- `project` - staged project work (`plan -> gather -> analyze -> replan -> synthesize`) with project reasoning summaries, visible tool/source progress, and project-file-aware retrieval

Supporting boundaries stay separate:

- Skills are the domain-specialization layer across all modes; they are not execution profiles and they are not a B2B flag
- Product KB plus subscription/plan facts are for PersAI/product/pricing/billing/setup questions, or for explicit mixed questions that compare product constraints with domain work
- current-thread conversation remains ordinary chat context, but assistant-wide cross-thread `chat` / `memory` recall requires explicit recall intent
- project files are first-class sources in project mode, but they still reuse the existing `AssistantFile` / `fileRef` truth rather than a separate project file system

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
  - use web/browser when the current local context does not directly answer the real user task

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
6. The model should treat "one local file" or "one retrieved snippet" as insufficient unless it directly resolves the actual task; if evidence is partial, outdated, or off-target, it should keep gathering or verify externally instead of synthesizing early.

## Project visible reasoning and activity feed

Project mode should feel closer to Cursor than ordinary chat: the user should see how the assistant is working, what it is checking, and why another pass is needed. This visibility is a project-mode feature, not a default behavior for ordinary B2C chat.

PersAI should show two safe streams in project mode:

1. activity events - what the system is doing
2. visible reasoning summaries - concise, model-authored summaries of the current plan/check/gap/conclusion

Visible reasoning summaries are allowed and encouraged in project mode. Raw hidden chain-of-thought remains hidden. The copy should be short and concrete ("checking the uploaded estimate against the policy", "gathering one more source", "verifying the current rule externally"), not canned filler like "another pass is needed". These summaries should not drown out more concrete tool/retrieval activity when the model is already in the middle of real source work.

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

Implementation should extend the existing runtime stream and web `ActivityEvent`/`ChatEntry` pattern rather than introduce an unrelated feed channel. Ordinary `normal` and `smart` chats should keep the calmer current experience, but tool lifecycle and source activity may still remain visible through the same existing activity surface when tools actually run; only the richer staged reasoning-summary layer is project-specific. Live-status selection should prefer concrete tool/retrieval work over generic project-stage banners.

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

## Implementation program

### Slice 1 - ADR and audit closeout

Status: **done**.

- ADR-100 established the product decision: `project` is a chat mode, B2B is a plan envelope, and PersAI should reuse existing Skills, Files, Knowledge, Plans, and retrieval seams instead of inventing parallel systems.

### Slice 2 - Chat mode contract

Status: **implemented**.

- `assistant_chats.chat_mode` adds explicit `normal | smart | project`.
- Web/API/contracts now carry `chatMode`.
- `deepModeEnabled` remains the compatibility boolean until old clients are gone.

Accepted residual:

- legacy `deepModeEnabled`-only PATCH can still downgrade `project -> smart` for old clients.

### Slice 3 - Project UI shell

Status: **implemented**.

- Composer exposes a compact three-state mode control.
- Chat list marks project chats.
- Selected project chats show a lower-sidebar project-files panel derived from existing attachment / `AssistantFile` truth.

Accepted residuals:

- the panel still refetches paginated history on mount instead of live-syncing optimistic uploads
- draft chats without a persisted `chat.id` still hide the panel

### Slice 4 - Project execution profile

Status: **implemented**.

- Runtime branches on `chatMode === "project"`.
- Project mode uses the staged `plan -> gather -> analyze -> replan -> synthesize` execution profile.
- Depth still reuses existing plan-owned reasoning/tool budgets rather than a new B2B-only runtime branch.

Accepted residuals:

- shadow router mode still does not force orchestrated pre-retrieval
- project activity/reasoning feed remains session-ephemeral by design

### Slice 5 - Activity and visible reasoning feed

Status: **implemented**.

- Project-only activity and safe reasoning-summary events reuse the existing timeline/feed path.
- Ordinary `normal` and `smart` chats keep the calmer current behavior.

Accepted residual:

- client-side tool-badge suppression on reattach is still imperfect when local chat mode is unknown

### Slice 6 - Retrieval, project files, and bounded file intelligence

Status: **implemented through Slice 6H**.

This block is now closed for the pre-deploy local implementation scope:

- **6A:** cheap deterministic `semanticSummary` / `semanticSummarySource` anchors land on attachment + canonical file metadata
- **6B:** project-only retrieval ordering is gated by internal `gatherProfile: "project"`
- **6C / 6D / 6E:** project chat files become a real gather source before KB, while deep extraction stays lazy and is cached on `AssistantFile.metadata`
- **6F:** uploads that still lack deterministic summaries can use an API-owned cheap micro-description job; project mode always enqueues, ordinary non-project chats obey `routerPolicy.analyzeUploadsOnB2cUpload`, and helper cost accounting remains internal-ledger-only
- **6H:** Product KB/subscription facts are now product-intent-gated, assistant-wide `chat` / `memory` recall is explicit-recall-gated, non-empty precheck override lists replace built-ins, and `project_file` outranks ordinary user/product retrieval items in runtime hydration

Remaining residuals before Slice 7:

- `pinnedSkillId` remains deferred and must stay separate from ordinary skill activation if added later
- richer image-only semantic summaries remain later work
- current-thread chat is still not a first-class orchestrated source; Slice 6H only stops broad assistant-wide recall leakage unless recall intent is explicit
- live deploy verification must still confirm source-admission quality, project-file gather priority, lazy extraction cache, and upload micro-description behavior end to end

Preserved design constraints for later work:

- Skills remain the domain layer; do not turn them into execution modes
- Product KB and subscription facts stay intent-gated, not mode-gated
- project files stay on existing `AssistantFile` / `fileRef` truth
- reuse `DocumentExtractionService`; do not introduce parse-every-upload or a second project-only file/knowledge system

Verification already completed for Slices 2-6H:

- focused API/runtime/web tests for chat mode, project profile, retrieval orchestration, extraction cache, upload micro-description, and Admin Runtime copy
- repo gate: lint, `format:check`, `@persai/api` typecheck, `@persai/web` typecheck, `@persai/runtime` typecheck

### Slice 7 - Hidden B2B plan in cluster

Status: **not started**.

Required outcome:

- create or update the hidden active B2B plan in the target cluster/admin control plane
- fill the plan from live admin/runtime truth and the ADR baseline, using only active provider-catalog model keys
- assign the plan to a test workspace/assistant, materialize the bundle, and verify the saved project-capable policy
- confirm with a live project-mode smoke, not only local code review

This slice remains blocked until deploy prep and live project verification pass.

## Execution discipline

1. One implementation session handles one bounded slice or tightly coupled doc closeout only.
2. The parent agent owns scope, reconciliation, and source-of-truth docs.
3. Subagents may help with readonly audit, focused search, verification, or narrowly scoped non-overlapping work.
4. Do not create parallel project-only Files, KB, Skill, or retrieval systems unless the existing PersAI-native systems are proven insufficient in that slice.
5. Do not reintroduce OpenClaw runtime/deploy/request-time compatibility.
6. Architecture/API/data/workflow changes must update the source-of-truth docs in the same slice.
7. Slice 7 must read live admin/runtime truth before writing plan values and must verify the saved result after writing.

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

## Execution program status

| Slice | Status | Notes |
|-------|--------|-------|
| 1 ADR + audit | done | decision and reuse constraints established |
| 2 chat mode contract | complete | explicit `chatMode`; compatibility `deepModeEnabled` preserved |
| 3 project UI shell | complete | mode control, project marker, project-files sidebar |
| 4 project execution profile | complete | staged project runtime profile landed |
| 5 activity + reasoning feed | complete | project-only visible activity/reasoning landed |
| 6 retrieval and file-intelligence closeout | complete through 6H | project files, lazy extraction cache, bounded upload enrichment, source-admission cleanup |
| 7 hidden B2B cluster plan | blocked | after deploy prep and live project verification |

## Next recommended step

Run **deploy prep + live project verification**: validate the new source-admission behavior, project-file gather priority, lazy extraction cache, and upload micro-description job path against the target environment. Do not create the hidden B2B cluster plan (Slice 7) until live verification confirms project retrieval quality end to end.
