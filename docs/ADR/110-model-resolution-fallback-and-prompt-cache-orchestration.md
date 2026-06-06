# ADR-110: Model resolution, fallback, embedding truth, and prompt-cache orchestration

## Status

Proposed (2026-06-06). Baseline SHA: `1a0d1ca5`.

This ADR is an orchestration program. The parent agent acts as the orchestrator and reviewer. Implementation must be delegated to subagents running GPT 5.4; the parent agent does not directly code feature changes except for explicitly requested documentation/orchestration edits.

## Context

PersAI now has several model-selection truths spread across runtime settings, plans, knowledge settings, provider clients, and media/tool execution code. The current state mixes three different concepts:

1. **Configured model slots** exposed in Admin UI.
2. **Hardcoded provider defaults** embedded in source.
3. **Fallback intent** that is partially materialized but not consistently executed.

The user-facing risk is not only operational failure. Some paths can silently degrade or produce wrong behavior:

- Chat/provider fallback is configured but runtime failover is not fully consumed at execution time.
- STT is OpenAI-only and model-hardcoded.
- TTS and web-search have provider candidates but lack explicit cross-provider failover policy.
- Embedding cannot safely use generic fallback because stored vectors and query vectors must be created by the same embedding model.
- Plan-owned embedding creates a hidden mass-reindex problem and can silently break vector search when changed.
- Admin Knowledge embedding backfill exists, but the future unified embedding truth must also cover assistant-owned knowledge.
- Anthropic prompt caching is not equivalent to OpenAI automatic caching and needs provider-specific treatment.

## Decision

Adopt a single ADR program with two independent tracks:

1. **Prompt-cache correctness and economics.**
2. **Model resolution, fallback, and embedding truth.**

These tracks may be implemented in separate slices and PRs. They share the provider/model boundary but must not be collapsed into one large code change.

### Orchestration rule

Implementation work under this ADR must follow this operating model:

- The parent agent is the **orchestrator**.
- The parent agent writes the slice task, assigns it to GPT 5.4 subagent(s), reviews diffs, runs/requests verification, and decides whether to accept, resume, or reject a subagent output.
- The parent agent does **not** directly implement production-code changes unless the user explicitly overrides this rule for a specific fix.
- Subagents must receive bounded slice prompts with:
  - exact scope and non-goals
  - likely files
  - required tests
  - invariants to preserve
  - docs they must not edit unless assigned
- The orchestrator must verify every subagent claim from code/tests, not trust summaries blindly.

### Terminology

- **Normal** means the plan-level everyday chat model, stored as `primaryModelKey`.
- **Premium** means `premiumModelKey`.
- **Reasoning** means `reasoningModelKey`.
- **Platform primary** means Admin > Runtime global primary model, stored on platform runtime provider settings.
- In assistant/plan context, "primary chat model" means **Normal**, not Premium.

## Track A: Prompt-cache correctness

### Decision

OpenAI and Anthropic caching must be treated as provider-specific behavior:

- OpenAI prompt caching is automatic and should continue to be allowed broadly where the provider supports it.
- Anthropic prompt caching is explicit (`cache_control`) and has different economics, so PersAI must decide stable cache breakpoints intentionally.

### Target behavior

1. Represent Anthropic system content as cache-aware blocks where appropriate.
2. Mark stable, high-reuse prompt sections for caching.
3. Avoid placing volatile developer/user-turn content before cacheable stable blocks in a way that invalidates useful cache reuse.
4. Read and persist provider cache usage fields honestly:
   - cache creation/input tokens where exposed
   - cache read tokens where exposed
   - normal uncached input/output tokens
5. Keep cost ledger semantics provider-specific and replay-safe.

### Non-goals

- Do not invent fake cached-token values for providers that do not report them.
- Do not force Anthropic to mimic OpenAI payload shape if that hides real provider semantics.
- Do not change user-visible assistant behavior while doing cache economics work.

## Track B: Model resolution and fallback

### Decision: hardcoded model strings leave production paths

Model names for production behavior should come from Admin-managed catalog/settings, not from scattered source constants.

Known hardcoded/default surfaces to reconcile:

- OpenAI STT: `gpt-4o-mini-transcribe`.
- OpenAI TTS: `gpt-4o-mini-tts`.
- OpenAI image default: `gpt-image-1`.
- OpenAI video default: `sora-2`.
- Web-search defaults: Perplexity `sonar-pro`-style model and Gemini `gemini-2.5-flash`-style model.
- Image capability special case: transparent-background support must come from catalog/capability metadata, not string equality against a model id.

Yandex `speechkit-v3` is not a priority cleanup item because it is effectively tied to the Yandex SpeechKit API version/path, not a general PersAI model slot.

### Decision: fallback must execute, not only materialize

PersAI should distinguish two behaviors:

1. **Slot inheritance:** empty role-specific slots inherit from safer defaults.
2. **Runtime failover:** provider/model failure or timeout triggers a second eligible provider/model attempt when configured and safe.

Slot inheritance exists today and remains valid. Runtime failover must be made real for eligible capabilities.

### Cross-provider fallback target

Each eligible capability should resolve through:

```text
capability request
  -> primary provider + model
  -> capability-valid fallback provider + model
  -> safe global/catch-all behavior where applicable
```

Fallback must be capability-aware. A fallback model must support the requested capability and required request features.

Initial target chains:

- **Chat/text:** OpenAI -> Anthropic where configured.
- **TTS:** OpenAI <-> Yandex where configured.
- **STT:** OpenAI -> Yandex SpeechKit as the recommended first fallback candidate.
- **Web search:** Perplexity <-> Gemini where configured.
- **Video:** preserve existing provider-aware video fallback for cinematic paths; do not fallback HeyGen talking-avatar to unrelated cinematic providers.
- **Image:** support provider-aware fallback once the second image provider is added.

### STT decision

STT must stop being OpenAI-only. The first fallback target should be Yandex SpeechKit because:

- Yandex credentials/client infrastructure already exists for TTS.
- It is a strong Russian-language fallback.
- It keeps the first implementation smaller than adding a new provider family.

Acceptable caveat: fallback STT can produce slightly different transcripts. That is acceptable during primary-provider outage.

### Retrieval helper decision

Retrieval helper reranking is fallback-eligible because it is an ordinary LLM call over already-found candidates.

Two cases must remain distinct:

- **Model not configured:** this may mean the operator intentionally disables rerank to save tokens. Current graceful-off behavior is acceptable unless the user later chooses default-on.
- **Model configured but provider/model fails:** this should use normal text-model failover.

If the product decision changes to "helper default-on", an empty helper slot should inherit from the plan **Normal** model in assistant/plan context, not from Premium. Admin-only authoring surfaces with no plan context may use platform primary.

### Authoring model decision

Admin Knowledge authoring is an admin/platform operation with no assistant plan context. If no authoring model is configured, platform primary is an acceptable fallback.

### Embedding decision: pinned, no generic fallback

Embedding is the explicit exception to generic fallback.

Embedding search works only when stored document vectors and query vectors are produced by the same embedding model. A different embedding model can produce:

- a different vector space
- a different vector dimension
- silently wrong similarity scores
- empty vector hits after model-key filtering

Therefore:

- Cross-model embedding fallback is forbidden.
- Retry with the same embedding model is allowed.
- Graceful-off is allowed: if embedding is unavailable or not configured, vector search is disabled and lexical search may continue.
- Changing embedding model means reindexing all stored vectors that should be searchable under the new model.

### Embedding ownership decision

Plan-owned embedding must be removed. Embedding model truth moves to **Admin > Knowledge** as the single project-wide source.

Implications:

- Remove `embeddingModelKey` from plan editing, plan payloads, and plan billing hints.
- Keep one Admin Knowledge embedding index model.
- If Admin Knowledge embedding is unset, the UI should guide the operator to select one. If code needs a bootstrap fallback, it may use `text-embedding-3-large` only as a catalog-backed default, not as hidden product truth.
- The operator may manually choose `text-embedding-3-large` in Admin > Knowledge for PersAI.
- Changing the Admin Knowledge embedding model is a dangerous action and must require explicit confirmation.

### Embedding reindex decision

Changing the Admin Knowledge embedding model must enqueue or require a controlled reindex for every vector-bearing source governed by the unified embedding truth:

- Product KB
- Skill documents/cards where vectorized
- assistant-owned uploaded knowledge

The existing Admin Knowledge backfill behavior is a starting point but is incomplete for unified embedding truth unless assistant-owned knowledge is included.

The confirmation surface should show impact before changing:

- number of affected sources/documents/chunks where available
- approximate token volume where available
- clear warning that cost and time may be large
- explicit "I understand this starts reindexing" confirmation

For very large bases, implementation should prefer queued/throttled background reindex with progress over one unbounded burst.

## Execution slices

### Slice 0 — Read-only reconciliation and task split

Owner: orchestrator, no coding subagent.

Scope:

- Confirm current code paths for fallback materialization/execution.
- Confirm current code paths for Admin Knowledge backfill and assistant-owned knowledge indexing.
- Confirm current plan payload/contracts containing `embeddingModelKey`.
- Confirm hardcoded model strings in provider-gateway/runtime/web-search/media routing.
- Produce exact slice prompts for GPT 5.4 subagents.

Exit:

- Updated ADR slice plan if code truth differs.
- No production code changes.

### Slice 1 — Embedding truth consolidation

Owner: GPT 5.4 subagent. Orchestrator reviews.

Scope:

- Remove plan-owned embedding selection from API/web/contracts/persistence writes.
- Resolve assistant embedding model from Admin Knowledge policy.
- Preserve lexical graceful-off when no embedding model is configured.
- Update docs/contracts/tests.

Non-goals:

- Do not change chat/premium/reasoning/system/retrieval model slots.
- Do not implement generic embedding fallback.

Required verification:

- focused API tests for plan save/read without embedding
- focused retrieval/indexing tests showing assistant knowledge uses Admin Knowledge embedding model
- contracts generation if OpenAPI changes
- repo lint/format/typecheck gate

### Slice 2 — Unified embedding reindex safety

Owner: GPT 5.4 subagent. Orchestrator reviews.

Scope:

- Extend Admin Knowledge embedding-change backfill/impact analysis to assistant-owned knowledge.
- Add dangerous-action confirmation semantics for embedding model changes.
- Expose impact/progress enough for the Admin Knowledge UI.
- Ensure `text-embedding-3-large` is only a catalog/default bootstrap, not hidden override when operator configured another value.

Non-goals:

- No cross-model fallback.
- No dual-indexing unless a later ADR explicitly chooses that cost.

Required verification:

- tests for Product KB + Skill + assistant-owned knowledge reindex candidates
- tests for no-op when vectors already exist for selected model
- tests for confirmation requirement
- web tests for confirmation copy/state

### Slice 3 — Runtime text failover execution

Owner: GPT 5.4 subagent. Orchestrator reviews.

Scope:

- Make materialized text fallback policy actually execute on provider failure/timeout for eligible text/chat calls.
- Preserve slot inheritance semantics.
- Record telemetry/audit enough to know fallback happened.
- Avoid fallback loops.

Non-goals:

- Do not include embedding.
- Do not silently change successful primary-provider behavior.

Required verification:

- runtime/provider-gateway focused tests for primary failure -> fallback attempt
- tests for no fallback when fallback model missing or capability-invalid
- usage/cost accounting tests where applicable

### Slice 4 — Capability catalog cleanup for hardcoded model defaults

Owner: GPT 5.4 subagent. Orchestrator reviews.

Scope:

- Move STT/TTS/web-search/image/video defaults to catalog/settings where appropriate.
- Add capability metadata needed for request constraints, including transparent-background support.
- Remove production routing decisions based on raw model-string equality.

Non-goals:

- Do not add new providers beyond the selected first fallback targets.
- Do not change user plan pricing.

Required verification:

- provider settings tests
- media routing tests
- Admin Runtime UI tests for new/changed fields

### Slice 5 — STT/TTS/web-search cross-provider fallback

Owner: GPT 5.4 subagent. Orchestrator reviews.

Scope:

- Add STT provider abstraction with OpenAI primary and Yandex SpeechKit fallback.
- Add fallback-aware TTS routing across OpenAI/Yandex.
- Add fallback-aware web-search routing across configured providers.
- Keep provider credentials under Admin > Tools / runtime provider settings as existing architecture dictates.

Non-goals:

- Do not introduce a new provider if Yandex is sufficient for first STT fallback.
- Do not route embedding through this fallback layer.

Required verification:

- provider-gateway tests for STT fallback
- TTS fallback tests
- web-search fallback tests
- billingFacts/usage persistence tests where affected

### Slice 6 — Retrieval helper fallback

Owner: GPT 5.4 subagent. Orchestrator reviews.

Scope:

- If a retrieval helper model is configured and fails, route through eligible text fallback.
- Preserve current "empty means rerank disabled" unless product decision changes.
- If product decision changes to default-on, inherit from plan Normal in assistant context.

Non-goals:

- Do not force rerank on all plans without explicit product decision.
- Do not use Premium accidentally when Normal is intended.

Required verification:

- retrieval helper tests for configured model failure -> fallback
- tests for empty helper model -> graceful-off
- telemetry tests showing fallback model/provider

### Slice 7 — Anthropic prompt cache

Owner: GPT 5.4 subagent. Orchestrator reviews.

Scope:

- Add provider-specific Anthropic cache-control handling.
- Keep stable system prompt cacheable.
- Avoid invalidating cache with volatile per-turn developer/user content.
- Capture Anthropic cache usage fields honestly.

Non-goals:

- No fake cache accounting.
- No broad prompt rewrite unrelated to cache layout.

Required verification:

- provider request-shape tests for Anthropic cache blocks
- usage parsing tests
- ledger/accounting tests if persisted fields change

## Global invariants

- Active path remains PersAI-native only.
- No OpenClaw runtime/deploy compatibility wiring.
- No TODO scaffolding or dead stubs.
- No generic fallback for embedding.
- No fallback from talking-avatar HeyGen mode to cinematic video providers.
- No keyword/fuzzy routing where structural catalog/capability data is available.
- Plan `primaryModelKey` means Normal; do not confuse it with Premium.
- Docs and contracts must be updated in the same slice when long-term truth changes.

## Required orchestrator review checklist

For every subagent output:

1. Inspect changed files and confirm scope boundaries.
2. Search for accidental hardcoded model strings or embedding fallback.
3. Verify tests actually ran and match the touched surface.
4. Run or request the AGENTS.md verification gate before accepting a code slice:

```bash
corepack pnpm -r --if-present run lint
corepack pnpm run format:check
corepack pnpm --filter @persai/api run typecheck
corepack pnpm --filter @persai/web run typecheck
```

5. Add focused runtime/provider-gateway/contracts checks when those boundaries changed.
6. Update `docs/SESSION-HANDOFF.md`, `docs/CHANGELOG.md`, and architecture/API/data/test docs where the accepted slice changes current truth.

## Consequences

Positive:

- Model behavior becomes operator-visible and catalog-owned.
- Real failover replaces misleading "configured but unused" fallback.
- Embedding no longer hides mass-reindex risk inside plans.
- Admin Knowledge becomes the single embedding truth.
- Expensive embedding model changes become explicit, confirmed, and auditable.
- Anthropic cache economics become honest instead of being treated like OpenAI.

Trade-offs:

- This is multi-slice work touching API, web, runtime, provider-gateway, contracts, and docs.
- Removing plan-owned embedding is a product behavior change and requires careful contract/UI cleanup.
- Assistant-owned knowledge reindex can be expensive and must be throttled/observable.
- Cross-provider fallback can produce slightly different outputs/transcripts; this is acceptable for failover but must be observable.

## Out of scope

- Dual-indexing embeddings across multiple models.
- Automatic fallback between unrelated embedding providers/models.
- New image provider implementation before the product/provider choice is made.
- Voice cloning or HeyGen talking-avatar fallback to non-HeyGen providers.
- Broad pricing-plan redesign unrelated to model slots.
