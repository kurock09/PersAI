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

### 2. ADR-072 residuals still alive

The following remain active program items and move under ADR-073 governance:

- **Step 19 - scale hardening for 10000+ active users**
  - deploy/restart recovery must stop depending on normal-ops fleet-wide `reapply all`
  - published, materialized, and warmed runtime states must stay separate
  - runtime/provider recovery must become bounded and self-healing
- **Step 15a - native web TTS streaming/output**
  - channel voice output remains deferred and separate from the explicit `tts` tool
- **Step 20 - isolated sandbox service**
  - `apps/sandbox/*`, file/process tools, and sandbox authority remain deferred
- **post-Step-20 attach-by-ref follow-through**
  - any successor to `persai_workspace_attach` must be attach-by-ref over a real file authority boundary
- **`max_ru` follow-through**
  - the contract exists, but the delivery/runtime adapter program is still incomplete

### 3. Create/recreate path audit

Current setup truth is functionally correct but not yet product-clean:

- setup preview and final create both call `postOnboarding`
- setup preview and final create both call `postAssistantCreate`
- preview persists draft state before previewing, but uploaded custom avatar stays local-only until final publish
- recreate uses `reset -> wizard -> create fallback to existing assistant`, not a first-class shared lifecycle pipeline
- final create still uses hard navigation to `/app/chat` instead of the cleaner route/state transition path

This is acceptable for the current baseline but not the desired long-term product path.

### 4. User UI audit

The active user UI is operational, but the next polish slice must improve:

- setup flow coherence between preview, create, recreate, and reset
- honest loading/error states around preview, publish, and post-publish routing
- avatar consistency between local preview, runtime preview, and final assistant state
- clearer lifecycle states when an assistant is draft, applying, failed, or live

### 5. Memory, knowledge, and search audit

The active runtime already has a real PersAI-owned knowledge layer, but it is still an economy-first baseline rather than the final quality architecture:

- `knowledge_search` / `knowledge_fetch` are real and PersAI-native
- uploaded knowledge sources, private memory, prior chats, preset/subscription/global knowledge are already reachable on the active path
- current retrieval is still `ragMode: "pattern_only"`
- current reranking is heuristic text scoring, not a true embedding/vector retrieval program
- current tool catalog wording still overstates some `memory_search` semantics relative to the active runtime

### 6. Model routing and reasoning audit

The active system already materializes structured provider routing, but execution does not yet match the full contract:

- `runtimeProviderRouting.primaryPath` is real and used
- `fallbackMatrix` is materialized but not fully executed by runtime turn logic
- repo-level `use_smart_model` policy does not yet exist
- there is no explicit reasoning-mode policy layer
- there is no explicit cheap-model versus premium-model routing discipline per tariff

### 7. Cache and prompt-economy audit

The active path already has bundle caching and compaction reuse, but not the full cost architecture:

- runtime bundle warm/cache exists
- durable compaction reuse exists
- idempotent turn replay exists
- provider-native cached input blocks are not yet integrated as a first-class product/runtime policy
- there is no explicit stable cache layer for tariff-global prompts, user profile blocks, KB summary blocks, or reusable long-lived context blocks

### 8. Tool orchestration audit

The active runtime has a real bounded tool loop, but not yet the final split between thinking and execution:

- the main runtime model plans and executes tool calls in one bounded loop
- inline tools and worker tools are already separated operationally
- there is no dedicated deterministic tool-runner layer for low-thinking operations such as `tts`, `web`, `image`, quota checks, and policy/accounting enforcement

## Decision

PersAI will treat the post-migration program as one ordered execution stack rather than a mixed backlog.

The active order after ADR-072 Step 18 is:

1. create/recreate lifecycle polish
2. user UI polish
3. memory, knowledge, cache, and model-routing economics
4. Step 19 scale and deploy-recovery hardening
5. deferred channel voice output (`Step 15a`)
6. deferred sandbox/file-authority program (`Step 20`)

The system must not jump to sandbox or other late-stage capabilities before the user lifecycle, cost architecture, and scale semantics are honest on the active path.

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

Routine deploy, restart, and warm recovery for the ordinary active path must be proven first. Sandbox/file/process capability remains deliberately late-stage.

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
- no local-only avatar truth that diverges from runtime preview truth
- no hidden recreate semantics inside an ordinary create call
- no misleading “assistant is ready” state before runtime/apply state actually is ready

### B. Smart-model routing target

PersAI adopts an explicit `use_smart_model` policy layer.

This policy must stay **catalog-driven and admin-managed**, not hard-coded to one vendor or one fixed model lineup in code.

The source of truth is:

- admin-managed available model catalog
- admin-managed provider settings
- plan-level model policy and eligibility
- assistant/runtime routing policy derived from those settings

ADR-073 therefore defines **model roles**, not fixed model ids.

The policy decides:

- default model role for the turn
- whether the turn stays on an economical/default path or escalates to a higher-capability path
- whether reasoning mode is permitted or required
- whether the task should stay on the main assistant path or hand off to the deterministic tool runner

Decision inputs may include:

- tariff
- user-visible task class
- context size
- retrieval burden
- tool requirements
- premium budget consumption
- quality risk of a cheap answer

Model-role examples that may exist per plan:

- `defaultModel`
- `premiumModel`
- `reasoningEligibleModel`
- `toolPlanningModel`
- `backgroundEconomyModel`

Which concrete model id fills each role must come from admin UI and plan configuration, not from hard-coded architecture rules.

### C. Cache and context target

PersAI adopts four stable cache families:

- `cache_id_global_preset`
  - tariff-level stable system instructions and policy framing
- `cache_id_user_profile`
  - user identity, preferences, long-lived style/settings
- `cache_id_kb_*`
  - stable KB digests, document summaries, or reusable knowledge blocks
- `cache_id_summary_*`
  - reusable project/week/session summaries

Live context remains only for:

- recent turn messages
- immediate task state
- bounded retrieved excerpts
- temporary execution metadata

Provider-native cached input must be used wherever the provider and request shape support it, especially for:

- tariff-global stable instructions
- long-lived user profile blocks
- reusable KB digest blocks
- reusable summary blocks
- repeated long-form analysis prompts that share the same stable prefix

Ordinary user turns, setup/runtime preview, assistant-side scheduled follow-ups, and premium long-form analysis should all use the same cache policy instead of inventing separate prompt-economy rules.

### D. Knowledge and embedding target

PersAI will move from pattern-only retrieval to a hybrid knowledge stack:

1. ingest and chunk documents
2. generate embeddings for chunks and summary blocks
3. run lexical + vector retrieval
4. rerank with bounded hybrid scoring
5. inject only the best 3 to 5 references or excerpt windows into the final prompt

Budget rules:

- retrieval is reference-first
- summaries beat raw document dumps
- the final prompt receives bounded excerpts, not full corpora
- cacheable knowledge blocks should be reused instead of rebuilt every turn

### E. Reasoning-mode target

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

### F. Deterministic tool-runner target

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

- default model role: cheapest acceptable model from the admin-approved catalog
- premium escalation: rare, narrow, and strongly gated
- reasoning: off by default
- cache: global preset plus minimal user profile cache
- retrieval: low token budget, few excerpts, no premium escalation without explicit policy allowance

### Free

- default model role: economical general-purpose model selected from the admin-approved catalog
- premium escalation: exceptional only
- reasoning: off except tightly bounded special cases if the plan allows it
- cache: global preset plus user profile cache
- retrieval: bounded hybrid retrieval once available, but with smaller excerpt budget than paid tiers

### Base

- default model role: standard-quality general-purpose model selected from the admin-approved catalog
- premium escalation: allowed for clearly complex tasks, document synthesis, and higher-risk user asks
- reasoning: limited and quota-governed
- cache: all major cache families enabled
- retrieval: full bounded hybrid retrieval with conservative token budgets

### PRO

- default model role: high-quality general-purpose model selected from the admin-approved catalog
- premium escalation: broader and more available for complex turns and premium workflows
- reasoning: available for selected high-value tasks, still policy-governed rather than always-on
- cache: all cache families enabled, plus larger reusable summaries and KB blocks
- retrieval: full hybrid path with the highest excerpt and synthesis budget among standard tiers

## Economics versus quality

### Savings come from

- cache reuse instead of resending stable prompt text
- embeddings plus bounded excerpts instead of whole-document injection
- explicit smart-model escalation instead of defaulting every turn onto the highest-cost model
- deterministic tool execution for low-thinking work
- bounded reasoning usage instead of blanket deep-thinking

### Quality is protected by

- escalating to the higher-capability model role only when the task actually needs it
- keeping profile, summary, and KB context structured instead of dropping it
- using hybrid retrieval rather than pure cheap lexical matching
- keeping the user-facing assistant personality and memory continuity on the premium-quality path
- exposing honest UX states when the system switches into a richer analysis mode

## First-wave priorities

The first implementation wave after ADR-073 approval is:

1. **Assistant lifecycle cleanup**
   - unify preview/create/recreate pipeline
   - remove duplicate setup writes where possible
   - make reset/recreate semantics explicit
2. **User UI polish**
   - tighten setup states, publish transition, avatar consistency, and lifecycle honesty
3. **Smart-model contract**
   - add explicit routing policy for cheap/default/premium/reasoning paths
4. **Cache architecture**
   - land stable cache-layer contract for tariff/user/profile/summary/KB blocks
5. **Knowledge architecture correction**
   - align product/runtime truth around current pattern-only retrieval, then implement real hybrid embedding retrieval without pretending it already exists

## Second-wave priorities

These are valuable but not first-wave blockers:

- richer per-tier UX explanations for premium analysis mode
- broader admin diagnostics for runtime/routing behavior
- more sophisticated rerank and retrieval-quality telemetry
- deeper tool-runner isolation and specialization
- `Step 15a` native web voice output
- `Step 20` sandbox and attach-by-ref follow-through
- `max_ru` delivery/runtime adapter completion

## Non-goals

ADR-073 does not:

- reopen the OpenClaw migration itself
- reintroduce legacy route modes or deploy wiring
- treat sandbox/file/process tools as part of the ordinary near-term user path
- claim that real embeddings, provider-native cached input, or smart-model routing already exist on the active path when they do not

## Execution ledger

| Program item                               | Status    | Notes                                                                             |
| ------------------------------------------ | --------- | --------------------------------------------------------------------------------- |
| ADR-072 Step 18 closeout                   | completed | Native baseline is live and active-path cleanup is complete                       |
| Create/recreate lifecycle polish           | planned   | First active product-surface slice under ADR-073                                  |
| User UI polish                             | planned   | Follows lifecycle cleanup, stays aligned with native runtime truth                |
| Smart-model routing and reasoning policy   | planned   | No repo-wide `use_smart_model` exists yet                                         |
| Cache-layer architecture                   | planned   | Bundle cache exists; provider-native cached input and stable prompt caches do not |
| Hybrid embedding-based knowledge retrieval | planned   | Current active retrieval remains `pattern_only` plus heuristic rerank             |
| Step 19 scale hardening                    | planned   | Deploy/restart recovery and self-healing warm semantics remain active blockers    |
| Step 15a native web TTS output             | deferred  | Not part of the first active polish/economics wave                                |
| Step 20 isolated sandbox                   | deferred  | Remains after scale hardening and outside the ordinary active path                |

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
- Keep implementation slices bounded. Do not mix create/recreate polish, memory/KB economics, Step 19 scale hardening, and Step 20 sandbox work into one oversized change unless explicitly asked.
- Verify every claim against current code, contracts, Helm values, and active docs. Do not trust old ADR text by itself.
- If docs and code diverge, fix or explicitly surface the divergence.

Current ADR-073 execution order:
1. create/recreate lifecycle polish
2. user UI polish
3. memory, knowledge, cache, and smart-model economics
4. Step 19 scale/deploy-recovery hardening
5. deferred Step 15a native web voice output
6. deferred Step 20 sandbox and attach-by-ref follow-through

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
