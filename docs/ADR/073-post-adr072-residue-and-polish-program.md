# ADR-073: Post-ADR-072 residue and polish program

**Status:** Accepted  
**Date:** 2026-04-17  
**Relates to:** ADR-061, ADR-070, ADR-072

## Context

ADR-072 completed the active migration from OpenClaw to the PersAI-native request-time path through Step 18. The active repo, deploy path, and dev cluster now run on `apps/api`, `apps/web`, `apps/runtime`, and `apps/provider-gateway` only.

That migration closeout leaves three different kinds of work that no longer fit cleanly inside ADR-072:

1. residual deferred architecture from ADR-072 itself
2. product-surface polish on the create/recreate and user UI path
3. a new cost-versus-quality program for memory, knowledge, caching, model routing, reasoning, and tool execution

ADR-072 remains the historical migration ADR and the source of truth for how the native runtime replacement landed. ADR-073 becomes the active program ADR for everything that remains after the native baseline is already live.

In the cost-and-quality sections below, **Skipper** means the user-facing assistant experience running on this PersAI-native control-plane/runtime stack.

## Current-state audit

### 1. ADR-072 items already closed

The following are treated as complete on the active path:

- native-only request-time execution for web and Telegram
- active deploy/runtime/control-plane cleanup through Step 18
- PersAI-owned `runtime` plus `provider-gateway` services
- PersAI-owned secrets split and GitOps image pinning path
- Step 15 core native tool/runtime baseline already landed on the active path

### 2. ADR-072 residuals under ADR-073 governance

The following residuals are governed here, with current status called out explicitly:

- **Step 19 core deploy/operator hardening** (`completed`)
  - deploy/restart recovery no longer depends on normal-ops fleet-wide `reapply all` on the observed active dev rollout path
  - published, materialized, and warmed runtime states now stay meaningfully separated on the active runtime path
  - runtime/provider recovery now has a bounded self-healing path instead of failing closed into a routine manual mass reapply expectation
  - admin `System Overview` is now the honest operator surface for current discovered pod count, status/readiness, and fleet pressure truth on the active path
- **final bounded load-readiness and rollout-speed follow-through** (`planned`, last step)
  - the native `api -> runtime -> provider-gateway` path still needs one bounded saved production-pressure proof rather than anecdotal “it feels fine” evidence
  - any remaining rollout-speed or image-pull convergence cleanup should stay here because it no longer blocks ordinary deploy/restart recovery truth
- **Step 15a - native web TTS streaming/output**
  - channel voice output remains deferred and separate from the explicit `tts` tool
- **Step 20 - isolated sandbox service**
  - local code now already includes `apps/sandbox/*`, the sandbox file/process tool family, canonical `AssistantFile` authority, durable multi-pod workspace coordination, clean internal `files` execution including unified `files.send`, explicit `files.delete`, cleaner grouped file-list output, the atomic `files.write_and_send` create-and-deliver path, delivery-honesty correction when no artifact actually reached the turn result, guardrail enforcement, and admin/operator truth
  - the remaining honest closure for this item is live dev proof on a real surface plus any later assistant-level Files API/UI and attach-by-ref successor cleanup
- **post-Step-20 attach-by-ref follow-through**
  - any successor to `persai_workspace_attach` must be attach-by-ref over a real file authority boundary
- **`max_ru` follow-through**
  - the contract exists, but the delivery/runtime adapter program is still incomplete

### 3. Create/recreate path audit

The first lifecycle polish wave is now complete on the active path:

- setup preview no longer repeats the full onboarding/create/draft write wave during final publish
- reset now clears native runtime-state rows before deleting materialized specs and published versions
- preview and welcome prompts are split into separate admin-managed first-turn templates
- welcome chat creation is explicit after publish/recreate instead of being inferred from empty history
- setup now detects an existing assistant up front and enters an explicit `recover` / `recreate` path instead of hiding that branch behind `POST /assistant` `409 already existed`
- setup/create/recreate pages now keep the active centered layout instead of drifting off the intended visual axis
- the character editor now stays aligned from the top edge of the style block and uses the available vertical space more honestly
- publish/recreate now show a short explicit completion handoff before routing into the welcome chat, rather than risking a flat or confusing transition

The active repo truth now treats the explicit frontend setup wizard as the lifecycle contract for the current path. Uploaded custom avatars may still stay local until final publish, and preview/create/recover remain wizard-orchestrated rather than exposed as one separate backend lifecycle command, but those choices are no longer treated as blockers for closing this lifecycle slice because the active user-visible flow is now coherent and honest.

### 4. User UI audit

The first user UI polish wave is now complete on the active path:

- assistant settings now have denser, more balanced desktop/mobile layout and clearer save/action affordances
- chat/sidebar UX now has explicit deletion feedback, smaller context-pressure UX, collapsed integrations, and paged memory/task surfaces
- custom account/auth surfaces now support profile edits, avatar upload, password change, and a real custom forgot-password flow

Future user-surface work should now follow the remaining economics/scale program rather than staying as a separate top-priority polish track.

### 4a. Pre-prod polish 2026 — chat-turn lifecycle correctness wave

A bounded follow-up wave landed against the active path under the umbrella name "pre-prod polish 2026". It is not a separate program track — these are correctness fixes to the existing chat-turn lifecycle that the first user UI wave assumed but did not enforce. They are recorded here because they touch architectural truth (the SSE / runtime cooperation contract and the LLM-visible tool-result shape), not just CSS.

Four fixes are in scope:

- **FIX 1, Slice 1.1 — per-thread streaming UI state.** `useChat`'s `isStreaming` flag was global, so a stream in chat A blocked input in chat B. The flag is now keyed by `threadKey` through the new `StreamingThreadsContext`, and the sidebar shows a per-thread "generating" indicator. Per-thread `AbortController` wiring is the prerequisite for Slice 1.2's stop dispatch.
- **FIX 1, Slice 1.2 — server-side soft-detach.** The SSE controller used to abort the runtime turn on any client disconnect — including a phone screen lock or backgrounded tab. Slice 1.2 splits "explicit stop" from "passive disconnect": a new `POST /api/v1/assistant/chat/web/stop` endpoint dispatches a hard abort through the new in-memory `WebChatTurnHardStopRegistry`, and SSE socket close on the stream route no longer touches the runtime abort signal. On a soft-detach the runtime keeps generating, the existing persistence path stores the full assistant message, and the client recovers via history fetch on reconnection. On hard-stop the existing `client-aborted → persistInterruptedOutcome` path is unchanged. Slice 1.2 is intentionally process-local; cross-replica routing of stop dispatch is recorded as a known residual under this section.
- **FIX 2 — tool-result filename hygiene for the LLM.** Runtime tool results carried full `RuntimeOutputArtifact` records (including `filename`, `objectKey`, `artifactId`, `sizeBytes`) into the LLM-visible JSON, which made the model echo internal file names back into chat text. The active runtime now serializes tool-result payloads through `stringifyToolResultPayloadForModel`, which strips presentation-only fields from artifact-shaped entries while preserving `kind`, `mimeType`, `voiceNote`, and `caption`. Storage-side artifact records are unchanged.
- **FIX 3 — attachments-only message display.** The web client used to send the literal `"(attached files)"` placeholder as message content for attachments-only sends, and that placeholder leaked into the bubble. The placeholder is now defined by a shared `ATTACHMENTS_ONLY_PLACEHOLDER` constant; the chat bubble renderer suppresses the text node whenever the user message has attachments and matches the sentinel, while still rendering the attachment strip.

Boundary changes from this wave:

- `docs/API-BOUNDARY.md` adds the hard-stop route and pins the soft-detach contract on the stream route.
- The runtime tool-result wire format for LLM-visible JSON is now defined as "redacted artifact shape" rather than "raw runtime payload"; the storage-side shape is unchanged.

Known residuals tracked under this section:

- Multi-replica `WebChatTurnHardStopRegistry` routing. Today the registry is process-local: a Stop POST that lands on the wrong replica returns 204 (idempotent) but does not dispatch the abort, and the client's local SSE-socket teardown becomes the only effective stop signal — strictly no worse than pre-Slice-1.2 behavior. A sticky-session or pubsub fanout solution is deferred until multi-replica web-chat traffic is real.
- Live resume of an in-flight stream after soft-detach. The current contract is "runtime continues, full message shows up on next history fetch". A future slice may add an explicit SSE re-attach endpoint so the user sees the deltas as they arrive after reconnection; this is not part of the pre-prod polish wave.

### 5. Memory, knowledge, and search audit

The active runtime already has a real PersAI-owned knowledge layer, but it is still an economy-first baseline rather than the final quality architecture:

- `knowledge_search` / `knowledge_fetch` are real and PersAI-native
- uploaded knowledge sources, private memory, prior chats, preset/subscription/global knowledge are already reachable on the active path
- the active runtime knowledge contract now publishes `ragMode: "hybrid"`
- private and global knowledge reads now use bounded lexical plus vector retrieval with optional plan-scoped helper rerank
- uploaded global knowledge now participates in the same hybrid retrieval path as static global knowledge instead of staying lexical-only
- retrieval observability is now durable in Prisma and visible on the admin knowledge dashboard
- retrieval budgets/helper controls are now plan-managed, and admin global-knowledge writes are explicitly auth/quota-governed
- current tool catalog wording still overstates some `memory_search` semantics relative to the active runtime

### 6. Model routing and reasoning audit

The active system now has the first real plan-scoped routing baseline from Economics Slice A:

- `runtimeProviderRouting.primaryPath` and `fallbackMatrix` are real and still materialized
- the runtime now resolves explicit plan-scoped slots for `normal`, `premium`, `reasoning`, hidden `system/tool`, and optional `retrieval` helper work
- the main reply path now uses a configurable early `turn_routing` layer with deterministic precheck plus an optional cheap classifier on ambiguous turns; it selects execution mode and emits bounded retrieval/tool hints before the main reply request
- explicit deep/smart mode is live on the user surface without introducing raw model pickers, and once enabled the turn must stay on `premium_reply` or escalate to `reasoning` rather than silently falling back to `normal_reply`
- turn-level usage accounting now records `input`, `cached input`, and `output` usage across internal model calls
- remaining economics gaps now move to prompt-cache-first context architecture and the later retrieval/embedding follow-through, not the Slice A slot/accounting contract itself

### 7. Cache and prompt-economy audit

The active path already has bundle caching and compaction reuse, but not the full cost architecture:

- runtime bundle warm/cache exists
- durable compaction reuse exists
- idempotent turn replay exists
- OpenAI `cached input` usage already flows into runtime accounting as `cachedInputTokens`
- a live probe on the active `provider-gateway` path already confirmed that a repeated long OpenAI prefix can return large cached input on the second request
- the active OpenAI text path can now carry provider-side prompt-cache routing hints without inventing a PersAI-managed vendor cache id
- the ordinary compiled prompt now also carries a materialized stable-prefix record in the runtime bundle, so cache routing on ordinary turns no longer has to rely only on coarse bundle identity
- provider-native cached input, especially OpenAI prompt caching where the active provider supports it, is not yet the primary prompt-economy target
- prompt assembly does not yet maximize a large stable cached prefix plus a smaller dynamic tail
- there is no explicit stable cache layer for tariff-global prompts, user profile blocks, KB summary blocks, or reusable long-lived context blocks

### 8. Tool orchestration audit

The active runtime has a real bounded tool loop and now also has the first explicit hidden utility-model contract from Economics Slice A:

- the main runtime model still plans and executes tool calls in one bounded loop
- inline tools and worker tools are already separated operationally
- hidden system/tool-model work now has an explicit contract for bounded planning/selection-style tasks such as the cheap classifier used by the early `turn_routing` layer
- the current architecture keeps tools visible when policy allows them, and tool projection/policy now owns tool availability directly instead of letting hidden route guidance mutate that surface
- a more isolated deterministic tool-runner layer for every low-thinking operation is still later follow-through rather than already-finished repo truth

## Decision

PersAI will treat the post-migration program as one ordered execution stack rather than a mixed backlog.

The active order after ADR-072 Step 18 is:

1. create/recreate lifecycle polish
2. user UI polish
3. memory, knowledge, cache, and model-routing economics
4. Step 19 core deploy/operator hardening
5. deferred channel voice output (`Step 15a`)
6. deferred sandbox/file-authority program (`Step 20`)
7. final bounded load-readiness and rollout-speed follow-through

The system must not jump to sandbox or other late-stage capabilities before the user lifecycle, cost architecture, and core deploy/operator scale semantics are honest on the active path.

## Program principles

### 1. One shared lifecycle for create, preview, publish, recreate, and reset

The setup flow must be one control-plane-driven lifecycle, not several loosely matched paths.

That means:

- preview and final create share one draft source of truth
- recreate is not a hidden `409 already existed` branch in the happy path
- reset returns the user to the same canonical lifecycle with explicit destructive scope
- published/live/applying/failed states are honest and user-visible

### 2. User polish must follow architecture truth

UI improvements must not invent new semantics that the control plane and runtime do not own. If a field, state, or preview is shown, it must reflect the actual native runtime path.

### 3. Cost savings must come from routing, caching, and retrieval discipline, not from lowering intelligence everywhere

PersAI should protect quality by using cheaper execution where it is safe and premium reasoning where it is justified.

### 4. Stable context belongs in reusable cache layers

Large stable instructions and summaries must not be resent as fresh prompt text every turn when they can be cached or referenced.

### 5. Knowledge retrieval must become hybrid and budgeted

Long-term knowledge quality must come from:

- bounded chunking
- embedding-based retrieval
- lexical/hybrid rerank
- token-budgeted excerpt injection

It must not fall back to dumping large documents into ordinary prompts.

### 6. Thinking and execution should be split when the job does not require reasoning

PersAI should distinguish:

- a reasoning/planning model that decides what to do
- a deterministic execution layer that runs low-thinking tools and enforces quotas, policy, and accounting

### 7. Scale hardening comes before sandbox ambition

Routine deploy, restart, pod replacement, warm recovery, and operator-visible pod truth for the ordinary active path must be honest before sandbox ambition. Those core deploy/operator semantics are now observed on the active path; the only remaining scale residual is the final bounded load-readiness and rollout-speed follow-through, which stays deliberately later than the main lifecycle/economics cleanup.

## Target product and runtime architecture

### A. Assistant lifecycle and user-surface target

The target user path is:

1. onboarding/profile collection
2. assistant draft creation or recovery
3. runtime-backed preview from the same draft pipeline
4. final publish/apply from that same draft
5. clean post-publish handoff into chat
6. recreate/reset returning through the same lifecycle with honest destructive messaging

The target polish rules are:

- no duplicated write calls just because preview and final create are separate buttons
- no hidden recreate semantics inside an ordinary create call
- no misleading avatar or publish-state truth on the active path, even when a custom uploaded avatar remains local until final publish during setup
- no misleading “assistant is ready” state before runtime/apply state actually is ready
- post-publish handoff into the welcome chat is explicit and honest

### B. Plan-scoped model contract target

PersAI adopts a plan-scoped model contract rather than hard-coded model ids or public model pickers.

This contract must stay **catalog-driven and admin-managed**, not hard-coded to one vendor or one fixed lineup in code.

The source of truth is:

- admin-managed available model catalog
- admin-managed provider settings
- plan-level model slots and eligibility
- assistant/runtime routing policy derived from those settings

Active plans should be able to define distinct slots such as:

- `normalReplyModel`
- `premiumReplyModel`
- `reasoningModel`
- `systemToolModel`
- `retrievalModel` when a provider offers a search/retrieval-specialized model

During a turn, the main user-facing reply agent remains the orchestrator. It decides whether the current step is:

- the normal user reply path
- a deeper/premium or reasoning path
- hidden system/tool work such as rewrite, compaction, rerank, selection, or tool preparation

This is not a giant all-purpose trigger router. Most work types should be known by the pipeline step that requested the model, and only ambiguous user-facing turns should need a small bounded classifier or an explicit deeper-thinking mode.

The active routing layer is therefore an early bounded turn router, not a hidden tool call inside the main reply loop. In ordinary mode it may keep the turn on `normal_reply` or escalate to `premium_reply` / `reasoning`; it may also emit bounded retrieval/tool hints that the runtime still enforces against actual policy and tool availability. When explicit deep mode is enabled, the effective allowed set narrows to `premium_reply` and `reasoning`, and the runtime must clamp any attempted `normal_reply` downgrade back to `premium_reply`.

The runtime then resolves the concrete model from the active plan slot instead of hard-coding model ids in code.

User-facing UX should stay simple:

- ordinary chat should not expose raw model choice
- the only acceptable surface override is an explicit deeper-thinking mode if the product wants it; when enabled, it promises at least the premium path and may further escalate to reasoning, but it must not silently fall back to `normal_reply`
- hidden system/tool model use stays invisible unless the product later exposes economics diagnostics

### C. Prompt-cache-first context target

PersAI should treat provider-native cached input as the primary savings lever, with OpenAI Prompt Caching as the current cost target wherever the active provider and request shape support it.

OpenAI prompt caching is automatic for eligible exact-prefix reuse; PersAI should improve hit rates by materializing stable prompt blocks, preserving exact early-prefix ordering, and sending provider-side cache routing hints such as `prompt_cache_key` and retention policy where supported, rather than pretending PersAI owns a vendor cache-id lifecycle.

Stable prompt families should be assembled so that a large exact prefix can be reused between turns:

- tariff/global system framing
- user profile and long-lived identity/style blocks
- reusable summary blocks
- reusable KB digest or document-summary blocks

The dynamic tail should remain small and volatile:

- recent turn messages
- immediate task state
- bounded retrieved excerpts
- temporary execution metadata

Exact-prefix rules matter. Stable blocks should be ordered, versioned, and invalidated deliberately so provider-native caching can actually hit instead of being defeated by avoidable prompt churn.

Ordinary user turns, setup/runtime preview, assistant-side scheduled follow-ups, and premium long-form analysis should all follow this same prefix-first cache policy rather than inventing separate prompt-economy rules.

Cache architecture is therefore not just a PersAI-owned store; it is prompt assembly, invalidation, and observability designed to maximize `cached_tokens` while preserving warmth, continuity, and relevance.

### D. Knowledge correction and retrieval-model target

ADR-073 now records the current active truth:

- active retrieval now publishes `ragMode: "hybrid"`
- assistant-private and global knowledge search now combine lexical plus vector retrieval with bounded fetch windows
- retrieval-side helper work can resolve from the active plan's `retrievalModel` slot when available
- retrieval telemetry is durable and workspace-scoped through Prisma event/rollup state plus the admin knowledge observability surface
- plan policy now owns retrieval result limits, lexical/vector candidate budgets, fetch windows, helper toggles, helper output caps, and embedding-search enablement
- admin-managed global knowledge writes are now behind an explicit governance seam plus workspace knowledge-storage quota checks

Further follow-through should improve this landed baseline without pretending it is finished forever:

1. keep reference-first, bounded fetch semantics
2. refine where an optional specialized retrieval/search model path is actually justified for query rewrite, search planning, candidate selection, and rerank
3. keep generating and versioning embeddings for assistant/global chunks and later durable summary blocks
4. continue lexical + vector retrieval as the default knowledge baseline
5. deepen bounded hybrid scoring, helper observability, and operator diagnostics where it materially improves quality
6. inject only the best 3 to 5 references or excerpt windows into the final prompt

The specialized retrieval model is not the main conversational agent. It is a hidden knowledge-side helper owned by the runtime/tool path.

When this helper path is used, the runtime should resolve the model from the active plan's `retrievalModel` slot when that slot exists, rather than from a hard-coded vendor/model choice or the ordinary reply path.

Budget rules:

- retrieval is reference-first
- summaries beat raw document dumps
- the final prompt receives bounded excerpts, not full corpora
- cacheable knowledge blocks should be reused instead of rebuilt every turn
- retrieval-side helper calls should avoid the full conversational system prompt and persona shell whenever possible
- retrieval-side helper calls should carry only the smallest task contract needed for rewrite, ranking, selection, or schema conformance, so PersAI does not waste tokens on user-facing prompt framing where it adds no retrieval value

### E. Hidden system/tool model and turn-economics target

PersAI keeps one admin-managed hidden system/tool model slot for cheap background work that does not need the full user-facing conversational model.

Eligible work may include:

- summary and compaction
- query rewrite
- retrieval candidate selection or rerank assistance
- structured extraction
- tool-argument preparation
- quota or policy helpers where model use is still justified

The admin surface already owns the default model path; ADR-073 extends that idea into an explicit system/tool contract at the plan/runtime level.

Every internal call must emit enough usage data to measure economics honestly:

- model slot and resolved model id
- step type
- input tokens
- cached input tokens
- output tokens
- per-call estimated cost
- per-user-turn totals across all internal calls

This accounting must treat input and output separately, because they are priced differently, and must sum the hidden work rather than pretending the final user reply is the whole cost story.

### F. Reasoning-mode target

Reasoning mode is not the default path.

It should activate only for tasks that benefit from slower and more expensive thinking, such as:

- complex planning
- multi-document synthesis
- architecture or policy design
- ambiguous tradeoff resolution
- difficult debugging or long-horizon recommendations

Cheap/default routing should stay active for:

- ordinary conversation
- short factual questions
- deterministic tool delegation
- short retrieval-backed answers where the retrieved context is already clear

The `use_smart_model` policy should escalate when one or more of the following are true:

- multi-document or multi-source synthesis is required
- the answer drives a high-cost or high-risk tool decision
- the system needs structured planning or prioritization rather than short response generation
- the user explicitly asks for deeper analysis, design, or comparison
- the turn exhausts the safe context budget for the cheap/default path

Reasoning must stay limited on lower tiers and quota-governed on paid tiers.

An explicit deeper-thinking user mode is acceptable. Raw model pickers are not.

### G. Deterministic tool-runner target

PersAI introduces a system-side execution layer for tools that do not require creative reasoning.

This layer is responsible for:

- quota checks and daily-limit enforcement
- policy gating
- deterministic argument validation
- low-thinking tool execution for `tts`, `web`, `image`, and similar helpers
- usage accounting and audit emission

The main assistant decides **what** to do. The deterministic tool runner decides **how to execute it safely and cheaply**.

## Tariff policy

### Trial

- normal reply slot: cheapest acceptable conversational model from the admin-approved catalog
- premium/reasoning slots: mostly off or narrowly gated
- hidden system/tool slot: economical background model for rewrite, summary, or tool prep when policy allows it
- cache: provider-native cached prefix plus minimal profile/summary blocks
- retrieval: bounded hybrid path with the smallest excerpt and helper budget

### Free

- normal reply slot: economical general-purpose conversational model selected from the admin-approved catalog
- premium/reasoning slots: exceptional only
- hidden system/tool slot: economical background model allowed for internal utility work
- cache: provider-native cached prefix plus user profile cache
- retrieval: bounded hybrid path with smaller excerpt/helper budgets than paid tiers

### Base

- normal reply slot: standard-quality conversational model selected from the admin-approved catalog
- premium reply slot: allowed for clearly complex tasks, document synthesis, and higher-risk user asks
- reasoning slot: limited and quota-governed
- hidden system/tool slot: enabled for internal utility work and lower-cost background steps
- cache: all major stable prefix families enabled
- retrieval: bounded hybrid path with conservative token budgets once landed

### PRO

- normal reply slot: high-quality conversational model selected from the admin-approved catalog
- premium/reasoning slots: broader and more available for complex turns and premium workflows
- hidden system/tool slot: enabled with larger background budgets
- cache: all major stable prefix families enabled, plus larger reusable summaries and KB blocks
- retrieval: full hybrid path with the highest excerpt and synthesis budget among standard tiers

## Economics versus quality

### Savings come from

- provider-native cached input reuse for large stable prompt prefixes
- hidden system/tool-model use for cheap background steps
- specialized retrieval-model assistance plus bounded excerpts instead of whole-document injection
- explicit premium/reasoning escalation instead of defaulting every turn onto the highest-cost model
- deterministic tool execution for low-thinking work
- bounded reasoning usage instead of blanket deep-thinking

### Quality is protected by

- keeping the main user-facing reply on the plan's conversational or premium slot instead of exposing the background utility model
- keeping profile, summary, and KB context structured so the cached prefix preserves continuity instead of flattening personality
- using honest retrieval truth now and hybrid retrieval later rather than overselling current lexical behavior
- escalating to the higher-capability slot only when the task actually needs it
- exposing at most a simple deeper-thinking mode instead of raw model pickers

## First-wave priorities

The first implementation wave after ADR-073 approval is grouped into larger slices:

1. **Assistant lifecycle closeout** (completed)
   - explicit recreate/recover path is now first-class on the wizard entry path
   - hidden `POST /assistant` `409 already existed` happy-path fallback is removed
   - the active lifecycle contract is now the explicit setup wizard path with one persisted preview draft, explicit completion handoff, and explicit welcome-chat routing
   - uploaded custom avatars may remain local until final publish on the current path; this is now treated as accepted lifecycle truth rather than as an open blocker
2. **User UI polish** (completed)
   - settings/chat/sidebar/profile/auth polish landed on the active native path
   - setup centering, personality-editor alignment, and post-publish handoff polish are now also part of the completed user-facing baseline
   - future UI changes should now be driven by the remaining economics/Step-19 work
3. **Economics Slice A - plan-scoped model slots and turn accounting** (completed; ready for deploy/live validation)
   - plan slots for normal reply, premium/reasoning, hidden system/tool work, and optional retrieval-specialized work are landed on the active path
   - the active path now uses a configurable early `turn_routing` layer with deterministic precheck plus an optional cheap classifier, while explicit deeper-thinking mode keeps user-selected smart turns on `premium` / `reasoning` without exposing raw model pickers
   - `Admin > Runtime` now exposes per-category router trigger editing for `continue`, `retrieval`, `reasoning`, `premium writing`, and `tool/browse` precheck hints instead of a raw JSON-only override surface, and web chat can surface the latest shadow decision to the assistant owner/admin as a compact badge such as `premium (llm)` or `reasoning (precheck)` without exposing raw classifier payloads
   - honest per-turn accounting now records `input`, `cached input`, `output`, and per-call totals across internal model work
4. **Economics Slice B - prompt-cache-first context architecture** (completed on the current active path)
   - bounded OpenAI request-side cache-routing support is now landed on the active text path: provider requests can carry stable `prompt_cache_key` plus explicit retention policy hints, and a live probe already confirmed large cached-input reuse on a repeated long prefix
   - ordinary compiled prompt output now also materializes a stable-prefix record in the runtime bundle, and ordinary-turn cache keys can derive from that stable prompt identity plus turn-variant state instead of only from bundle-level metadata
   - ordinary/deep cache identity now also incorporates the hydrated leading `durable memory` and reusable shared-compaction-summary blocks, and those stable families now use explicit versioned cache-key tokens instead of implicit header-only matching
   - operator-facing observability for the active path now reaches `/admin/business`, where averaged completed-turn economics (`avg input`, `avg cached input`, `avg output`, cache-hit turn rate, cache-share percent, average usage steps) are aggregated from persisted runtime turn receipts over the rolling `last_7_days` window
   - future KB/retrieval digest blocks should reuse this same versioned stable-family scheme when they are introduced, rather than keeping Slice B itself open
5. **Economics Slice C - knowledge correction and retrieval-model path** (completed)
   - docs/product/runtime truth now reflects the active hybrid retrieval baseline instead of the old `pattern_only` contract
   - retrieval observability is now durable through Prisma event/rollup state and visible on the admin knowledge dashboard
   - uploaded global knowledge now has hybrid-search parity with private knowledge, retrieval budgets/helper controls are plan-managed, and admin global-knowledge writes are explicitly governance/quota-bounded

## Second-wave priorities

These are valuable but not first-wave blockers:

- richer per-tier UX explanations for premium analysis mode
- broader admin diagnostics for runtime/routing behavior
- more sophisticated rerank and retrieval-quality telemetry
- deeper tool-runner isolation and specialization
- `Step 15a` native web voice output
- `Step 20` sandbox live-proof and attach-by-ref follow-through
- `max_ru` delivery/runtime adapter completion

## Non-goals

ADR-073 does not:

- reopen the OpenClaw migration itself
- reintroduce legacy route modes or deploy wiring
- treat sandbox/file/process tools as part of the ordinary near-term user path
- overstate economics/retrieval capabilities beyond the code, contracts, and active operator surfaces that already prove them

## Execution ledger

| Program item                                  | Status      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-072 Step 18 closeout                      | completed   | Native baseline is live and active-path cleanup is complete                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Create/recreate lifecycle polish              | completed   | Preview/create dedupe, reset cleanup, preview/welcome split, explicit recover/recreate wizard path, redirect-loop fix, and gender-safe default voice selection are now landed on the active path                                                                                                                                                                                                                                                                                      |
| User UI polish                                | completed   | Assistant/chat/sidebar/profile/auth polish landed on the active native path                                                                                                                                                                                                                                                                                                                                                                                                           |
| Smart-model and plan-slot contract            | completed   | Plan-scoped normal/premium/reasoning/system-tool/retrieval slots, a configurable early `turn_routing` layer, and deeper-thinking mode with no deep-to-normal downgrade are now landed on the active path                                                                                                                                                                                                                                                                              |
| Prompt-cache-first context architecture       | completed   | Bundle cache exists; OpenAI text requests now carry provider-side cache-routing hints, ordinary compiled prompt output materializes a stable-prefix record for bundle-owned cache identity, hydrated durable-memory/shared-summary leading blocks participate in ordinary/deep cache identity via explicit versioned stable-family tokens, and `/admin/business` now exposes rolling averaged runtime token/cache economics from persisted completed-turn receipts on the active path |
| Knowledge correction and retrieval-model path | completed   | Active retrieval now publishes `hybrid`, private/global knowledge use bounded lexical plus vector retrieval with plan-managed helper/budget policy, and durable admin-visible observability plus global-write governance are landed on the active path                                                                                                                                                                                                                                |
| Hidden system/tool model and turn economics   | completed   | Hidden utility-model routing plus per-call `input` / `cached input` / `output` accounting are now first-class on the active path                                                                                                                                                                                                                                                                                                                                                      |
| Step 19 core deploy/operator hardening        | completed   | Deploy/restart/pod-replacement recovery is now observed on the live dev rollout path without routine fleet-wide manual `reapply all`, bounded runtime self-healing is landed on the active path, and `/admin` `System Overview` now provides the current honest pod-status/readiness operator surface                                                                                                                                                                                 |
| Step 15a native web TTS output                | deferred    | Not part of the first active polish/economics wave                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Step 20 isolated sandbox                      | in_progress | Local sandbox/fileRef/files-send baseline, explicit `files.delete`, cleaner grouped file-list output, the atomic `files.write_and_send` happy path, delivery-honesty fail-closed correction, enforcement, operator truth, and dev deploy wiring are now landing; the remaining honest closure is one live `sandbox -> fileRef or write_and_send -> user receives file` proof plus later attach-by-ref follow-through                                                                                                      |
| Final bounded load-readiness follow-through   | planned     | One saved bounded production-pressure proof plus any remaining rollout-speed/image-pull cleanup stays as the last program step because it no longer blocks ordinary deploy recovery or current operator truth                                                                                                                                                                                                                                                                         |

## Consequences

### Positive

- the active program after ADR-072 becomes readable and ordered
- user-lifecycle polish and cost architecture stop competing for priority in an ad hoc way
- docs can point to one honest post-migration program ADR
- future implementation slices can stay bounded and still align with a longer program

### Negative

- ADR-073 opens a wider program than a single code slice
- several areas now become explicitly acknowledged gaps rather than implicit assumptions
- the team must avoid pretending that pattern-only retrieval, current routing, or current setup UX already equal the desired final state

## Universal continuation prompt

Use the prompt below to resume this ADR program in a new session.

```text
Continue work on `docs/ADR/073-post-adr072-residue-and-polish-program.md` as the active post-ADR-072 program ADR for `C:\Users\alex\Documents\PersAI`.

Before doing anything else, read in this order:
1. `AGENTS.md`
2. `docs/SESSION-HANDOFF.md`
3. `docs/CHANGELOG.md`
4. `docs/ADR/072-persai-native-multichannel-runtime-replacement.md`
5. `docs/ADR/073-post-adr072-residue-and-polish-program.md`
6. `docs/ARCHITECTURE.md`
7. `docs/API-BOUNDARY.md`
8. `docs/DATA-MODEL.md`
9. `docs/ROADMAP.md`
10. `docs/TEST-PLAN.md`

Operating rules for this ADR:
- Treat ADR-072 as the historical migration ADR through Step 18.
- Treat ADR-073 as the active follow-through program.
- Do not hardcode model ids, vendor names, or tariff-to-model bindings into architecture truth when those choices should come from admin-managed catalog/configuration and per-plan policy.
- Any model-routing, reasoning, cache, or quota policy must be described in terms of admin-managed catalog, provider settings, plan policy, and runtime materialization, unless the code already proves a narrower live constraint.
- Keep implementation slices bounded. Do not mix create/recreate polish, memory/KB economics, core Step 19 hardening or final load-proof follow-through, and Step 20 sandbox work into one oversized change unless explicitly asked.
- Verify every claim against current code, contracts, Helm values, and active docs. Do not trust old ADR text by itself.
- If docs and code diverge, fix or explicitly surface the divergence.

Current ADR-073 execution order:
1. create/recreate lifecycle polish
2. user UI polish
3. memory, knowledge, cache, and smart-model economics
4. Step 19 core deploy/operator hardening
5. deferred Step 15a native web voice output
6. Step 20 sandbox live-proof and attach-by-ref follow-through
7. final bounded load-readiness and rollout-speed follow-through

Inside item 3, keep these as the active economics tracks:
1. plan-scoped `normal`, `premium/reasoning`, `system/tool`, and optional retrieval-specialized model slots
2. provider-native cached-input-first prompt assembly with large stable prefixes and measured `cached_tokens`
3. hybrid retrieval quality/governance follow-through on top of the landed lexical + vector baseline, including honest helper use and durable observability
4. turn-level token/cost accounting across `input`, `cached input`, and `output`

When resuming:
- first identify the current unfinished slice under ADR-073
- gather evidence from code and active docs
- implement only that bounded slice
- then update any touched source-of-truth docs, `docs/SESSION-HANDOFF.md`, and `docs/CHANGELOG.md`
- finally run the required verification gate from `AGENTS.md`

At the end of the session, report:
- what changed
- why it changed
- files touched
- tests/checks run
- risks or residuals
- next recommended ADR-073 step
```
