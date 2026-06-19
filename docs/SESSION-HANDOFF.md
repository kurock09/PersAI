# SESSION-HANDOFF

> Archive: handoff sections from 2026-06-06 and earlier moved to `docs/SESSION-HANDOFF.archive-2026-06-06-and-earlier.md`; 2026-05-19 and earlier remain in `docs/SESSION-HANDOFF.archive-2026-05-19-and-earlier.md`.
> Keep this file short: only the current active working set and immediate handoff.

## 2026-06-19 — ADR-121 opened (routing 2D) — IN PROGRESS

### Scope

Post-119 audit (4 directions discussed with founder: A memory-bleeding JIT redesign, B scenario step progression, C routing 2D, D sandbox/shell). Founder priority order: **C first**. A/B/D each become their own ADR (A and D explicitly architecture waves; B is the founder-owned scenario-step ADR noted in the ADR-119 closure).

### What opened

**ADR-121** — `docs/ADR/121-two-dimensional-execution-routing-model-and-thinking-budget.md`, status `Accepted — 2026-06-19 (founder go)`. Separates the router's task-weight decision (`level: light|medium|heavy|deep`) from execution (`model + thinkingBudget`) via one pure resolver; retains `executionMode` as a derived model-slot token; plumbs a new `thinkingBudget` into the provider gateway (Anthropic Extended Thinking / OpenAI `reasoning_effort`); removes the `project→reasoning` and `deepMode→premium` hardcodes (both become weighted signals). Five slices.

### Audit findings grounded in code (for the slices)

- Router: `apps/runtime/src/modules/turns/turn-routing.service.ts` — `RoutingExecutionMode` (L27); deepMode ternaries L554/576/598/637/683/707/735/751; `coerceExecutionMode` L1223–1231; classifier schema enum L108–110; precheck term lists L167–258 (admin-overridable via `precheckRuleOverrides`).
- Project hardcode: `apps/runtime/src/modules/turns/project-execution-profile.ts:72` (`executionMode: "reasoning"`).
- executionMode → model slot: `resolve-runtime-provider-routing.service.ts` (primary/premium/reasoning model keys); plan config in `admin-plan-management.types.ts:166–171`.
- No thinking plumbing in provider clients today (only a mock ref in `anthropic-empty-completion.test.ts`).

### Operating contract (founder-set)

Orchestrator runs C end-to-end: assign slice → review diff → AGENTS.md gate + affected-area checks between slices → commit → next. Final slice runs full-repo "like CI" verification + repo-wide lint/format. **Push only at the very end** (push triggers deploy). No legacy tails, no transitional flag-gated old+new coexistence.

### Next recommended step

Implement Slice 1 (contract + `level → ExecutionProfile` resolver + plan thinking-budget config; no live routing change yet).

## 2026-06-19 — ADR-119 program closed (founder acceptance)

### Baseline

- Docs-only closure slice. Baseline SHA: `62ca8f5a` (working tree: `.gitignore` modified; `tmp/` uncommitted validation artifacts).

### What closed

**ADR-119** — formally closed with founder sign-off. Status header updated to `Closed — 2026-06-19 (founder acceptance; program complete)`. § Founder acceptance closure added to the ADR footer.

**Live evidence (local, `tmp/adr-119-slice-1-validation/`):**

- Cache/payload assembly: **GREEN** (multi-turn cache hits, three-zone prompt shape confirmed).
- Scenario gate (c) Instagram carousel + sneaker photo: **PARTIAL** — engage solo, active-scenario volatile blocks, release OK; step-by-step adherence **not** green (model collapse; no `activeStepNumber` in runtime state).

**Explicit deferral:** scenario step progression, hard early-step tool guards, full live matrix (a)(b)(d)(e) → **founder's next ADR**, not ADR-119 slices.

**AGENTS.md** updated: ADR-118 + ADR-119 moved to closed archive; no open orchestration program ADR except user-started work.

### Residual (not ADR-119)

- ADR-117 `cache-prefix rollout SHA` — still closure-mode pending item.
- Scenario runtime follow-up — new ADR (founder-owned).

### Next recommended step

Author the follow-up ADR (scenario step state + acceptance criteria), then implement as bounded slices. Do not reopen ADR-119.

## 2026-06-19 — ADR-119 polish: Anthropic sliding history cache marker fix + "legacy" cleanup

### Baseline

- Baseline SHA at session start: `1340ebb9` (clean except prior-session uncommitted byte-conversion in the Anthropic client+test — confirmed as legitimate prerequisite, folded into commit 2).
- This slice's commits: `c98600ba` (Step 0 cross-cutting), `c5542ce2` (Step 1 Anthropic). Docs commit follows.

### What closed

1. **Sliding history marker (#2 of 2) now actually fires.** `applyAnthropicMovingHistoryBreakpoint` formula corrected from `floor((total − minTail) / minTail) * minTail` (required ~6k tokens before firing → history caching effectively disabled in prod) to `floor(total / minTail) * minTail` (fires at one full 3k-token chunk, stays stable inside a chunk, advances across each boundary). Tail buffer removed — the dynamic tail (`volatile_context` + current question) is already spliced in after the marker. Byte-based measurement (3 UTF-8 bytes/token) folded in for Cyrillic/mixed content.
2. **"legacy" wording removed** from the active single-block system-prompt path (Anthropic client JSDoc/comments, `turn-execution.service.ts` `buildProviderRequest`, runtime-contract JSDoc).
3. **Dead multi-block seam removed (Variant B / no-dead-stubs):** `systemPromptBlocks` field, `buildAnthropicSystemBlocks` multi-block branch, `ANTHROPIC_MAX_SYSTEM_CACHE_MARKERS`, OpenAI per-block branch, related tests. `rg "systemPromptBlocks" --type ts` returns only one explanatory JSDoc reference.

### Untouched by design

`compile-prompt-constructor.service.ts` (Slice 2 multi-block — rejected), `attachCacheControlToLastBlock` + `measureAnthropicMessageContentBytes` (prior-session fixes, verified in place), the `shouldApplyAnthropicMovingHistoryBreakpoint` `main_turn`-only gate (protects against caching raw `tool_result`), the volatile-context splice in `buildAnthropicMessages`.

### Target Anthropic config

**2/4 `cache_control` markers used:** #1 single-block system marker (caches tools + whole system) + #2 sliding history marker. **Slice 2 multi-block system (#3/#4) explicitly REJECTED ON REVIEW** (not deferred) — minimal practical gain because the single-block system marker already caches tools + the entire system zone, and PersAI's prefix zones invalidate together on publish, not independently. Recorded in the ADR-119 footer.

### Gate

`lint` PASS · `format:check` PASS · `@persai/api` typecheck PASS · `@persai/web` typecheck PASS · `@persai/provider-gateway` test PASS (exit 0, full suite incl. Anthropic) · `@persai/runtime` + `@persai/provider-gateway` typecheck PASS.

### Next recommended step

~~Push the 3 commits, wait for CI green + GitOps reconcile in dev, then run the live validation…~~ Superseded by ADR-119 founder acceptance closure (top section).

## 2026-06-18 — ADR-119 follow-up: Anthropic moving-history-breakpoint fix for tool-loop conversations

### Root cause

Founder live-test observation: `inputTokens` per turn kept climbing past the 3,000-token `anthropicHistoryBreakpointMinTokens` threshold even on long conversations — the moving history `cache_control` marker was never landing on assistant messages. Symptom: a 14k cached prefix grows to 20k+ over a long chat and every turn re-pays the per-turn input cost.

Audit of `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts` revealed four compounding bugs:

1. `applyAnthropicMovingHistoryBreakpoint` used a now-deleted `resolveAnthropicHistoryBreakpointText` helper that returned `null` whenever an assistant message's content was anything other than a single `text` block. The provider client emits `toolHistory` exchanges as `assistant: [{ type: "tool_use", … }]` + `user: [{ type: "tool_result", … }]`. **Any** turn where the model called a tool produces pure-`tool_use` assistant messages — i.e. the breakpoint silently skipped real production tool-loop conversations entirely.
2. When a candidate was found, the function **destructively replaced** the message's content array with `[{type:"text", text: …, cache_control: …}]`, which would have corrupted multi-block messages (e.g. text+tool_use, image content).
3. `measureAnthropicTextTailChars` (the byte counter feeding the chunked-cache math) only counted `text` block lengths; `tool_use` JSON args and `tool_result` content contributed zero. On tool-heavy turns the chunked math therefore under-estimated the prefix size, biasing the candidate-search threshold toward "not enough yet" and pushing the marker further back even when it could have placed.
4. `countAnthropicCacheBreakpoints` walked `system` and `tools` only — even when the moving marker was placed, the `cacheBreakpoints=N` log line stayed at the system-prefix count, masking the bug from operations.

### Fix scope

- **`AnthropicBuiltMessageContent` type** — extended to allow `cache_control?: AnthropicPromptCacheControl` on `image`, `document`, `tool_use`, and `tool_result` blocks (previously text-only).
- **`applyAnthropicMovingHistoryBreakpoint`** — rewritten. Accepts **any** assistant message as a candidate, walks chunked-cache math (`totalContentChars`, `minTailChars`, `targetBoundary`, `maxCachedPrefixChars`) using the new `measureAnthropicMessageContentChars`, and delegates marker placement to the new `attachCacheControlToLastBlock` helper.
- **`attachCacheControlToLastBlock`** (new) — non-destructively clones the candidate message; if content is a string, wraps it in a single `text` block carrying `cache_control`; if content is an array, walks blocks back-to-front and attaches `cache_control` to the **last** block whose type accepts it (text/image/document/tool_use/tool_result).
- **`measureAnthropicMessageContentChars`** (renamed from `measureAnthropicTextTailChars`) — counts `text` text length, `tool_use` `JSON.stringify(input ?? {}).length`, and `tool_result` string-content length. `image` and `document` blocks count as zero (base64 data is not part of the textual cache key Anthropic uses).
- **`countAnthropicCacheBreakpoints`** — extended to also walk `payload.messages` so the `[anthropic-non-stream-start]` / `[anthropic-stream-start]` log lines surface message-level markers (operational visibility for ops + future cache audits).

### Tests

- `apps/provider-gateway/test/anthropic-provider.client.test.ts` — full existing breakpoint suite passes unchanged.
- New `toolHistoryBreakpointRequest` case — supplies a single tool exchange via `toolHistory` (the realistic prod path), forces the breakpoint via `anthropicHistoryBreakpointMinTokens: 10`, asserts:
  - the pure-`tool_use` assistant message emitted from `toolHistory` is byte-preserved (no destructive content rewrite);
  - `cache_control: { type: "ephemeral" }` is correctly attached to the last (and only) `tool_use` block;
  - the user-side `tool_result` message stays byte-identical (markers belong to assistant turns, not user replies).
- New `shortToolHistoryRequest` case — tiny `toolHistory` payload + 1-char user message asserts that the chunked-cache math still gates correctly and **no** marker is placed when the history is below the breakpoint threshold (guards against over-aggressive caching on short turns).

### Files touched

- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Gate

- `corepack pnpm --filter @persai/provider-gateway run lint` PASS
- `corepack pnpm run format:check` PASS (one auto-fix applied to the test file)
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm --filter @persai/runtime run typecheck` PASS
- `corepack pnpm --filter @persai/provider-gateway run typecheck` PASS
- `corepack pnpm --filter @persai/provider-gateway run test` PASS (full suite, incl. 2 new tool-loop cases)

### Cache prefix impact

None on the **system prefix** — the fix only changes per-turn placement of `cache_control` markers inside `messages[]`. Anthropic now sees the message-history cache key it was always supposed to see, so post-deploy:

- Conversations with no tool calls: marker placement already worked → no behavior change.
- Conversations with tool calls (the prod-realistic case): first post-deploy turn writes the message-history cache (`cache_creation_input_tokens` rises by the cached chunk size); subsequent turns reuse it (`cache_read_input_tokens` grows accordingly; `inputTokens` per turn drops).
- `cacheBreakpoints=N` log line now reflects total markers (system + tools + messages) instead of system+tools only — operations should expect higher values post-deploy.

### Live-test validation plan (next session)

1. Open chat → call 2-3 tools across 3-4 turns → `kubectl logs deployment/persai-provider-gateway -f` and watch `cacheBreakpoints=N` rise once the assistant-side total content crosses 3k tokens.
2. Confirm `cache_read_input_tokens` on turn N+1 includes the prior turn's tool-message bytes (delta on top of the system prefix).
3. Confirm `inputTokens` (raw) on long tool-loop chats no longer grows linearly with conversation length.

### Risks / residuals

- The new marker placement targets the *last* cache-control-capable block in an assistant message. For multi-block messages (text + tool_use), the marker lands on `tool_use`. Anthropic accepts `cache_control` on `tool_use` (verified via type extension + their docs), but if a future API change disallowed it, the fix would need to prefer text-block placement when both are present. **Not a current risk** but flagged.
- Provider-gateway test suite has long-running fixtures (≈5 min for the full suite). The breakpoint fix added two cases at the very end of the file; ensure new contributors don't add tests *after* them without timing budget.
- OpenAI symmetric breakpoint placement is out of scope (OpenAI does not have an equivalent moving `cache_control` mechanism — it caches whole prefixes implicitly).

### Next recommended step

Commit the fix, push, monitor CI, then run a live-test on `persai-dev` (open chat → tool-heavy conversation → grep `cache_read_input_tokens` and `cacheBreakpoints` in provider-gateway logs across 3-4 turns) to confirm the moving history cache starts firing.

## 2026-06-18 — ADR-119 cleanup slice (template + tool descriptor normalization + legacy fallback canonicalization)

### Root cause

Post-live-test audit by the founder surfaced five structural inconsistencies that the staged ADR-119 slices left behind:

1. Markdown `# X` / `## X` headings still surfaced *inside* the XML-wrapped templates (e.g. `# Core Persona` inside `<voice>`, `# Sense of Time` inside `<persai_environment>`). The XML tag IS the heading; duplicating it as markdown is noise and pushes the model toward emitting markdown headings in its own output.
2. Four prompt templates (`router_classifier`, `skill_state_classifier`, `preview_bootstrap`, `welcome_bootstrap`) were *never* wrapped in canonical XML — they shipped as raw markdown prompts. They had been excluded from the Slice 1 XML balance validator via `SKIPPED_TEMPLATE_KEYS`.
3. Slice 7 rewrote 8/20 catalog tools and 3/5 hidden synthetics to the canonical 4-section ACI format (`WHEN TO USE` / `WHEN NOT TO USE` / `EXAMPLES` / `GOTCHAS`). The remaining 12 catalog tools (incl. `video_generate`, `document`, `tts`, `browser`, `scheduled_action`, `background_task`, `persai_tool_quota_status`, `files`, `exec`, `shell`) and 2 synthetics (`summarize_context`, `compact_context`, `quota_status`) still used one-liner prose, so admin UI and tool projection produced inconsistent surfaces.
4. `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts` carried legacy markdown-heading fallback paths in `generateSoulPrompt`, `generateUserPrompt`, `generateIdentityPrompt`, `generatePreviewPrompt`, and `generateWelcomePrompt`. They fire only when a template is null (test fixtures, fresh DB) but still produce `# Identity` / `# User Context` / `# Character Preview` / `# First Conversation` — exactly the markdown surface the user saw in live-test screenshots.
5. `renderTraitsBlock` emitted `## Personality Traits\n\n- **trait**: N/100` markdown inside the `<voice>` block via the `{{traits_block}}` placeholder, regardless of which template was in use — visible in the live-test prompt.

### Fix scope (single integral cleanup slice)

- **Visible templates (`apps/api/prisma/bootstrap-preset-data.ts`)** — `soul`, `user`, `identity`, `memory_protocol`, `tools`, `heartbeat`, `presence` had every `# H1` / `## H2` markdown heading replaced with nested canonical XML elements (`<core_persona>`, `<gendered_self_reference>`, `<style>`, `<openings>`, `<emotion_response>`, `<silence>`, `<examples>`, `<sense_of_time>`, `<usage>`). The numbered priority list in `<tool_usage_policy>` lifted from Markdown `1. … 6. …` to canonical XML `<rule order="N">…</rule>` inside `<priority_order>`. List labels normalized: `- **Name**: value` → `- Name: value` (bold inline emphasis stripped from list-item labels; true emphasis like `**${assistantName}**` kept).
- **Missed templates** — `router_classifier` → `<router_classifier>` with `<modes>`, `<retrieval_plan>`, `<tool_hints>`; `skill_state_classifier` → `<skill_state_classifier>` with `<rules>`; `preview_bootstrap` → `<character_preview>` with `<task>`, `<constraints>`; `welcome_bootstrap` → `<first_conversation_greeting>` with `<task>`, `<opening_requirements>`, `<middle_section>`, `<closing_requirements>`, `<formatting_constraints>`.
- **Tool descriptors (`apps/api/prisma/tool-catalog-data.ts`)** — full 4-section ACI conversion for 10 remaining catalog entries: `video_generate`, `document`, `tts`, `browser`, `scheduled_action`, `background_task`, `persai_tool_quota_status`, `files`, `exec`, `shell`. `files` override mirrored in `apps/api/src/modules/workspace-management/application/runtime-tool-policy.ts` (policy override path that supersedes catalog). Hidden synthetics in `HIDDEN_PROMPT_TEMPLATE_DEFAULTS` — `summarize_context`, `compact_context`, `quota_status` converted to the same shape. `cron` and `persai_workspace_attach` keep one-liner shape (hidden-internal / migration-only, never model-visible).
- **Legacy fallback canonicalization (`compile-prompt-constructor.service.ts`)** — the `template === null` branch of `generateSoulPrompt` rebuilt to emit `<voice>` + `<character_notes>` instead of `# Core Persona` / `## Voice` / `## How you may open` etc.; `generateUserPrompt` → `<user>`; `generateIdentityPrompt` → `<identity>`; `generatePreviewPrompt` → `<character_preview>`; `generateWelcomePrompt` → `<first_conversation_greeting>`. `renderTraitsBlock` rewritten from `## Personality Traits\n\n- **trait**: …` to `<personality_traits>\n- trait: …\n</personality_traits>`. `interpolateTemplate` line-builders (`user_name_line`, `assistant_gender_line`, `archetype_label_line`, etc.) updated to feed `- Name: value` style into the placeholders, matching the new template defaults.
- **Memory `<read>` provenance documentation** — added a 4-line enum reference inside `<memory_protocol><read>` so the model interprets `user_explicit` / `system_inferred` / `auto_extracted` / `legacy` correctly (the live-test "P1 provenance" finding was an older backfill entry, not a write-path bug; write paths already set the correct enum per audit of `RuntimeMemoryWriteToolService`, `ManageAssistantWorkspaceMemoryService.add`, `AutoExtractToMemoryService`).

### Tests

- `apps/api/test/bootstrap-preset-data.test.ts` — `SKIPPED_TEMPLATE_KEYS` emptied (every template now must pass XML balance); `EXPECTED_OUTER_TAGS` extended with the 4 newly-wrapped templates and their canonical outer tags; new `runNoMarkdownHeadings` invariant function asserts no `^#{1,6}\s` markdown headings inside any visible/hidden template after stripping fenced code blocks, inline backticks, and `{{placeholders}}`.
- `apps/api/test/seed-tool-catalog.test.ts` — the Slice 7 8-tool ACI shape check generalized to "every model-visible catalog entry must carry the 4-section ACI shape" (`HIDDEN_ONELINER_CODES` skips only `cron` and `persai_workspace_attach`); cross-tool drift `ALLOW_LIST` expanded with the new legitimate cross-references (`browser ↔ web_search/web_fetch`; `video_generate → image_generate/image_edit/tts`; `document → files`; `scheduled_action ↔ background_task`; `persai_tool_quota_status → knowledge_search/document`; `files ↔ exec/shell/document`; `exec → shell/files/document`; `shell → files/exec/document`); restructured-catalog set renamed to `ACI_CATALOG_CODES` and extended to cover all 18 in-scope tools.
- `apps/api/test/runtime-tool-policy.test.ts` — `files` override assertions updated for the canonical 4-section shape (asserts each section header line, plus the canonical phrasings inside `GOTCHAS`).
- Golden snapshot — `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt` deleted and regenerated against the new prompt bytes (11346 bytes vs prior 11007).

### Files touched

- `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/api/prisma/tool-catalog-data.ts`
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts`
- `apps/api/src/modules/workspace-management/application/runtime-tool-policy.ts`
- `apps/api/test/bootstrap-preset-data.test.ts`
- `apps/api/test/seed-tool-catalog.test.ts`
- `apps/api/test/runtime-tool-policy.test.ts`
- `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt` (regenerated)
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Gate

- `corepack pnpm -r --if-present run lint` PASS (all packages)
- `corepack pnpm run format:check` PASS (3 auto-fixes applied during the slice)
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm --filter @persai/api run test` PASS (full suite, incl. new invariants and regenerated golden snapshot)
- `corepack pnpm --filter @persai/runtime run test` PASS
- `corepack pnpm --filter @persai/provider-gateway run test` PASS
- `corepack pnpm --filter @persai/web run test` PASS

### Reset-to-default checklist (founder runs after deploy)

Existing assistants carry their own snapshot copies of every visible template in DB. The new defaults only take effect on `Reset to default`. After GitOps reconcile, visit `/admin/presets/[assistant]` for each affected assistant and click `Reset to default` on these template rows:

- `system`
- `soul`
- `user`
- `identity`
- `memory_protocol`
- `tools`
- `heartbeat`
- `presence`
- `router_classifier`
- `skill_state_classifier`
- `preview_bootstrap`
- `welcome_bootstrap`

Tool catalog: nothing to click. `SeedToolCatalogService` auto-applies the new `modelDescription` / `modelUsageGuidance` strings on every API pod startup (`startup_idempotent: true`), so the new ACI shape ships with the next deploy automatically.

### Risks / residuals

- **One-time prompt-cache prefix invalidation on rollout** — all template bytes change in this slice, so the Anthropic and OpenAI cache prefixes invalidate once and rebuild on the next turn. Per ADR-119 D11 this is acceptable; expected on cleanup waves.
- The `runNoMarkdownHeadings` invariant is intentionally strict — any future template work that uses `^#{1,6}\s` will fail the test. Backtick the example or lift it to nested XML.
- OpenAI symmetry for the wider response-dump path (not in this slice, separate residual from prior follow-up): if the live test pivots to GPT-5.x, OpenAI client still needs the `dumpResponse` wiring done for Anthropic.
- Bold inline emphasis `**X**` is still used in true-emphasis spots (`**${assistantName}**`, `**${humanName}**`, `Your voice is **${voiceDna.archetypeLabel}**`). This is intentional and Anthropic-standard; only list-item label bold was stripped.

### Next recommended step

Push to `main`, wait for `Dev Image Publish` → GitOps reconcile, run the Reset-to-default checklist on the founder's assistants, then re-launch the browser-use subagent against `docs/ADR/119-live-test-plan.md`. With every template now XML-canonical and every model-visible tool descriptor in 4-section ACI shape, the cache-effectiveness zone (F) should now read clean cache-prefix hits across turns; the model's own response markdown should no longer be biased by markdown headings in the system prompt; and tool selection across Zones C/D should be tighter because the descriptors all carry explicit WHEN/NOT/EXAMPLES/GOTCHAS routing.

---

## 2026-06-18 — Anthropic terminal usage metadata + wired `dumpResponse` (live-test blocker fix)

### Root cause

Browser-use live-test runner reported a P0 blocker mid-matrix: Zone F (cache effectiveness) cannot be measured because `provider_payload_response_dump` events never appear in `provider-gateway` logs even with `PERSAI_DEBUG_PROVIDER_PAYLOAD=true` and `RATE=1.0`. Audit of `apps/provider-gateway/src/` confirmed `ProviderDebugPayloadLogger.dumpResponse()` is defined since Slice 0.5 but has **zero call sites in any provider client** — only `dumpRequest()` was wired. Without an end-of-turn log line carrying the `usage` block, neither the matrix runner nor a human operator can read `cache_creation_input_tokens` / `cache_read_input_tokens` per turn.

### Fix scope

Anthropic-only (live test uses claude-sonnet-4-6; OpenAI symmetry deferred). In `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`:

- New private `logAnthropicRequestEnd("anthropic-non-stream-end" | "anthropic-stream-end", input, {stopReason, usage, toolCallCount})` emits one always-on info line per turn with the printf grammar: `[<tag>] requestId=<id> classification=<c> iteration=<i> model=<m> stopReason=<r> toolCalls=<n> inputTokens=<n|null> cacheCreationInputTokens=<n|null> cacheReadInputTokens=<n|null> outputTokens=<n|null> totalTokens=<n|null>`. No user content; always-on; readable from `kubectl logs` without any toggle.
- `generateText()` (non-stream caller path, runs via `messages.stream(...).finalMessage()` under the hood) now calls `logAnthropicRequestEnd("anthropic-non-stream-end", ...)` and `debugPayloadLogger.dumpResponse(...)` once `finalMessage()` resolves, with the full SDK response object as the dump payload.
- `streamText()` calls both at `message_stop` for both the `tool_use → tool_calls` branch and the `completed` branch, with the aggregated `latestUsage`/`latestStopReason` and a synthesized response object (`{stop_reason, usage, tool_call_count, text}`) to keep the dump bounded.
- `usage` is computed once per turn (`finalUsage`) and reused for the metadata line, the `dumpResponse` payload, and the runtime contract result — no double computation.

### Tests

- `apps/provider-gateway/test/anthropic-provider.client.test.ts` — existing fixture extended:
  - Non-stream path now asserts a `[anthropic-non-stream-end]` log line matching the printf grammar (regex accepts `<n|null>` per token field).
  - Streaming path now asserts a `[anthropic-stream-end]` log line AND the exact figures from the existing stream-cache fixture: `inputTokens=10`, `cacheCreationInputTokens=4`, `cacheReadInputTokens=6`, `outputTokens=5`, `totalTokens=25`. This locks the field order and surface for the live-test runner.

### Files touched

- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risks / residuals

- OpenAI client is NOT updated in this slice — `dumpResponse` still has zero call sites there. If the live test pivots to GPT-5.x, a symmetric patch is needed.
- The `dumpResponse` payload is the SDK message object (non-stream) or a synthesized minimal object (stream) — no system prompt or message bodies are included, but downstream redaction in `sanitizeResponseValue` still applies bounded preview / base64 redaction defensively.
- Always-on `[anthropic-*-end]` line is one extra info-level log per provider call. Negligible volume vs. `[anthropic-*-start]` already emitted.
- Cache-prefix bytes UNCHANGED.

### Next recommended step

Push to `main`, wait for `Dev Image Publish` → GitOps reconcile, then re-launch the browser-use subagent against the unchanged `docs/ADR/119-live-test-plan.md`. Zone F should now read `cacheReadInputTokens=N` directly from the `[anthropic-stream-end]` line for every turn; the test plan's "Cache hit/miss" acceptance criterion is now satisfiable.

---

## 2026-06-18 — ADR-119 live-test enablement (Slice 14 partial + comprehensive plan)

### Root cause

Initial live test on `persai-dev` surfaced two issues that block any meaningful ADR-119 acceptance gate: (1) Slice 0.5 `PERSAI_DEBUG_PROVIDER_PAYLOAD` toggle silently no-ops at default `LOG_LEVEL=info` (uses `.debug()`) and only accepts the exact string `"true"`, so a human operator setting `=1` sees nothing; (2) ArgoCD reverts any `kubectl set env` within ~2 minutes, so the dev cluster cannot be patched ad-hoc for a multi-zone test session.

### Fix scope

- Slice 14 partial — debug-payload toggle hardened: accept `"1"/"true"/"yes"/"on"` case-insensitively via new `isTruthyEnvFlag()`; emit dumps at INFO via `logger.log()` instead of DEBUG so default-level pods surface them; gating still in `shouldDump()`.
- `infra/helm/values-dev.yaml` `providerGateway.env` adds `PERSAI_DEBUG_PROVIDER_PAYLOAD: "true"` + `PERSAI_DEBUG_PROVIDER_PAYLOAD_RATE: "1.0"` (dev only, gitops-managed; production values files MUST keep OFF).
- New `docs/ADR/119-live-test-plan.md` — 8-zone acceptance matrix (A baseline / B memory / C native tools 12 cases / D Skills+scenarios / E PDF-hotfix regression / F cache effectiveness / G parallel-tool discipline / H error+recovery) with pre-conditions, capture rules, output artifact shape, and explicit acceptance criteria. Designed to be executed by a browser-use subagent against `https://persai.dev`.

### Tests

- `apps/provider-gateway/test/provider-debug-payload-logger.test.ts` expanded: 9 truthy spellings (`"1"`, `"true"`, `"TRUE"`, `"True"`, `"yes"`, `"YES"`, `"on"`, `"ON"`, `" true "`) all assert `shouldDump() === true` with `RATE=1.0`; 7 falsy spellings (`""`, `"0"`, `"false"`, `"FALSE"`, `"no"`, `"off"`, `"anything-else"`) all assert `false`. `withDebugCapture` intercepts `Logger.prototype.log` instead of `debug`.
- `apps/provider-gateway/test/anthropic-provider.client.test.ts` + `openai-provider.client.test.ts` re-run — green (use `withDebugCapture` indirectly via Slice 0.5 dump tests).

### Files touched

- `apps/provider-gateway/src/modules/providers/provider-debug-payload-logger.ts`
- `apps/provider-gateway/test/provider-debug-payload-logger.test.ts`
- `infra/helm/values-dev.yaml`
- `docs/ADR/119-live-test-plan.md` (NEW)
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risks / residuals

- This is NOT ADR-119 Slice 14 in full. Slice 14 in `docs/ADR/119-live-test-plan.md`-adjacent follow-up scope would also touch operational docs and a Loki-retention note. Logger toggle change is the bare minimum to unblock the live-test gate.
- The full ADR-119 follow-up trio (Slice 12 `current_local_date`, Slice 13 template-refresh migration, Slice 15 multi-BP system blocks) is still pending. The live-test plan REQUESTED here will surface their impact by recording specific failures (date drift, missing XML wrappers, single cache breakpoint).
- `infra/helm/values-dev.yaml` enabling `PERSAI_DEBUG_PROVIDER_PAYLOAD=true` at full sample rate increases provider-gateway log volume for dev. Acceptable for a dev cluster; production values files MUST keep OFF.

### Next recommended step

Push the toggle + gitops + test plan as ONE commit. After ArgoCD syncs the new image + env, the operator launches a browser-use subagent with `docs/ADR/119-live-test-plan.md` as the prompt. Subagent produces `docs/ADR/119-live-test-findings-<date>.md`; orchestrator audits findings; results feed a follow-up Slice 12+13+15 batch ADR.

---

## 2026-06-18 — ADR-119 CLOSED (golden tests + docs + ADR closure)

### Root cause

Slice 11 is the final closure slice of the ADR-119 program. Locks invariants in tests, propagates the architecture to top-level docs, and marks the ADR Closed with reachability proof.

### Fix scope

- 6 golden tests (1 new file for full-prompt snapshot in api; 1 new runtime-side companion; 5 strengthened/labeled across existing test files).
- 4 top-level docs updated (ARCHITECTURE, API-BOUNDARY, DATA-MODEL, TEST-PLAN).
- ADR-119 `Status` = `Closed — 2026-06-18` with closure footer (slice SHA table).
- ADR-118 (`118-skill-scenarios-and-model-owned-activation.md`) `Status` = `Superseded by ADR-119 — 2026-06-18`.

### Tests

- New: `apps/api/test/adr119-golden-prompt-snapshot.test.ts` with committed expected fixture at `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt`.
- New: `apps/runtime/test/adr119-golden-prompt-snapshot.test.ts` — runtime volatile-context zone structure (GT1b).
- Extended `apps/runtime/test/prompt-cache-stable-blocks.test.ts`: GT2 (5 state variants) + GT6 (memory provenance labels).
- Extended `apps/runtime/test/native-tool-projection.test.ts`: `runAdr119Invariantstest` export (GT3).
- Labeled `apps/provider-gateway/test/anthropic-provider.client.test.ts` + `openai-provider.client.test.ts`: GT4.
- Extended `apps/api/test/compile-prompt-constructor.service.test.ts`: `runAdr119GoldenTest5PersonaDedup` (GT5).
- `apps/runtime/test/run-suite-isolated.ts` + `run-suite.ts` updated to include new runtime tests.

### Files touched

- `apps/api/test/adr119-golden-prompt-snapshot.test.ts` (NEW)
- `apps/api/test/fixtures/adr119-golden-prompt-snapshot.expected.txt` (NEW — committed fixture)
- `apps/runtime/test/adr119-golden-prompt-snapshot.test.ts` (NEW)
- `apps/runtime/test/prompt-cache-stable-blocks.test.ts` (extended)
- `apps/runtime/test/native-tool-projection.test.ts` (extended)
- `apps/runtime/test/run-suite-isolated.ts` (updated)
- `apps/runtime/test/run-suite.ts` (updated)
- `apps/provider-gateway/test/anthropic-provider.client.test.ts` (label)
- `apps/provider-gateway/test/openai-provider.client.test.ts` (label)
- `apps/api/test/compile-prompt-constructor.service.test.ts` (extended)
- `docs/ARCHITECTURE.md`
- `docs/API-BOUNDARY.md`
- `docs/DATA-MODEL.md`
- `docs/TEST-PLAN.md`
- `docs/ADR/119-prompt-architecture-and-2026-context-engineering.md`
- `docs/ADR/118-skill-scenarios-and-model-owned-activation.md`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**Low — closure work.** Golden tests will catch any future structural drift. No code logic changed; all changes are tests, docs, or ADR metadata.

### Acceptance gate deferred

Founder live-test on persai-dev not yet executed. Per ADR rollout policy, the live-test is subjective and post-closure. If regressions discovered, future ADR will address.

### Deviation from instructions

Golden Test 1 (full materialized system-prefix byte-snapshot) lives in `apps/api/test/adr119-golden-prompt-snapshot.test.ts` rather than `apps/runtime/test/adr119-golden-prompt-snapshot.test.ts` as originally specified. Reason: `CompilePromptConstructorService` is an api-package class that cannot be imported in the runtime package without cross-package wiring that would break `corepack pnpm --filter @persai/runtime run typecheck`. The runtime file at `apps/runtime/test/adr119-golden-prompt-snapshot.test.ts` provides GT1b (runtime volatile-context zone structure validation).

### Next recommended step

Founder live-test sequence (a)-(e) per ADR-119 Rollout section:

- (a) Free-form marketing domain discussion with Marketer Skill enabled.
- (b) Memory recall accuracy under a new session.
- (c) Instagram-carousel scenario with reference image; verify no parallel skill+image_edit call.
- (d) Scenario switch mid-chat.
- (e) Explicit release; verify UX indicator disappears.
  After successful live-test, the program is fully closed.

---

## 2026-06-18 — ADR-119 Slice 10 landed (admin UI for new scenario step fields)

### Root cause

The Slice 4 scenario step schema extended `SkillScenarioStepState` with `expectedUserResponse`, `nextStepTrigger`, and `recoveryGuidance`. The Slice 3 materializer auto-derives `<first_step_preview>` from `steps[0].directive`. Neither set of fields was exposed in the admin UI — admins had no way to author or override them.

### Fix scope

- `apps/web/app/admin/skills/page.tsx`: `ScenarioStepDraft` extended with 4 new string fields. `EMPTY_SCENARIO_STEP_DRAFT` defaults to `""`. `scenarioToDraft` maps `scenario.firstStepPreview` (scenario-level) to `draft.steps[0].firstStepPreview`; other new step fields via `?? ""`. `validateScenarioDraft` enforces length limits (400/200/400/200 chars). Both payload serializers trim and null-coerce; `firstStepPreview` emitted at step 0 level and scenario level. Step editor JSX: 3 textareas per step + text input on step 1 only for `firstStepPreview`. `renderActiveScenarioBlockPreview` rewritten to Slice 4 XML format. New `renderScenarioCatalogFirstStepPreview` helper. Catalog preview pane shows `<first_step_preview>` value.
- `apps/api/prisma/schema.prisma` + `apps/api/prisma/migrations/20260618160000_adr119_first_step_preview/migration.sql`: new `first_step_preview VARCHAR(200)` nullable column on `skill_scenarios` table.
- `apps/api/src/modules/workspace-management/application/skill-scenario.types.ts`: `SkillScenarioStepState` gains `firstStepPreview: string | null`; `parseStep` validates ≤200 chars; `normalizeStepsState` reads from stored JSON. `AdminSkillScenarioState` gains scenario-level `firstStepPreview: string | null`.
- `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts`: `createScenario` / `updateScenario` persist and load the new `firstStepPreview` column.
- `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts`: `<first_step_preview>` uses `scenario.firstStepPreview` verbatim when non-null/non-empty, falls back to auto-derived from `directive`.
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`: maps `row.firstStepPreview` into `EnabledSkillScenarioCandidate`.
- `packages/contracts/openapi.yaml` + generated model files: optional `firstStepPreview?` added to `AdminSkillScenario`, `AdminSkillScenarioStep`, `AdminCreateSkillScenarioRequest`, `AdminUpdateSkillScenarioRequest`.
- `packages/runtime-contract/src/index.ts`: `RuntimeBundleSkillScenario` and `RuntimeBundleSkillScenarioStep` gain optional `firstStepPreview?`.

### Tests

- `apps/web/app/admin/skills/page.test.tsx`: 22 new Slice 10 tests; existing `renderActiveScenarioBlockPreview` and `createScenario` fixture tests updated for new fields and XML format.
- `apps/api/test/enabled-skills-prompt-materialization.test.ts`: 2 new tests (firstStepPreview override verbatim; fallback to directive when absent).
- `apps/api/test/manage-skill-scenarios.service.test.ts`: 3 new tests (firstStepPreview persists on step 1; missing fields return null; overlong firstStepPreview rejects).

### Files touched

- `apps/web/app/admin/skills/page.tsx`
- `apps/web/app/admin/skills/page.test.tsx`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260618160000_adr119_first_step_preview/migration.sql`
- `apps/api/src/modules/workspace-management/application/skill-scenario.types.ts`
- `apps/api/src/modules/workspace-management/application/manage-skill-scenarios.service.ts`
- `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/generated/model/adminSkillScenario.ts`
- `packages/contracts/src/generated/model/adminSkillScenarioStep.ts`
- `packages/contracts/src/generated/model/adminCreateSkillScenarioRequest.ts`
- `packages/contracts/src/generated/model/adminUpdateSkillScenarioRequest.ts`
- `packages/runtime-contract/src/index.ts`
- `apps/api/test/enabled-skills-prompt-materialization.test.ts`
- `apps/api/test/manage-skill-scenarios.service.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**Low — UI extension + additive schema.** All new fields optional; backward-compatible defaults (`?? ""`). Prisma migration is additive (new nullable column, existing rows backfill to NULL; auto-derive from `directive` preserved when column is null). The `renderActiveScenarioBlockPreview` format change is visible only in the admin preview pane. Materializer update is additive (falls back to existing auto-derive when `firstStepPreview` is null/empty).

### Deviation from instructions

None. `firstStepPreview` was added at scenario level (new Prisma column `first_step_preview VARCHAR(200)` on `skill_scenarios`, migration `20260618160000_adr119_first_step_preview`) as the instructions specified. It is also stored at step level within the `steps` JSON blob (for runtime bundle pass-through), but the authoritative value used by the materializer is the scenario-level Prisma column.

### Next recommended step

Slice 11 — golden tests + docs + ADR closure (golden test suite, `docs/ARCHITECTURE.md`/`API-BOUNDARY.md`/`DATA-MODEL.md`/`TEST-PLAN.md` updates, ADR-119 `Status: Closed`, ADR-118 `Status: Superseded`).

---

## 2026-06-18 — ADR-119 Slice 9 landed (memory protocol + provenance)

### Root cause

The volatile memory rail lacked a formal protocol declaration in the cache prefix, memory entries carried no provenance, and the inner rendering used legacy markdown-list / old wrapper tags (`<recent_short_memory>`, `<persai_contextual_memory>`) rather than the canonical `<persai_memory>` / `<entry>` XML from ADR D10.

### Fix scope

- `apps/api/prisma/schema.prisma`: `AssistantMemoryProvenance` enum + `provenance` column on `AssistantMemoryRegistryItem` (DEFAULT `legacy`).
- `apps/api/prisma/migrations/20260618153000_adr119_memory_provenance/migration.sql`: additive migration; existing rows backfill to `legacy`.
- `apps/api/src/modules/workspace-management/domain/assistant-memory-registry-item.entity.ts`: `provenance` field.
- `apps/api/src/modules/workspace-management/domain/assistant-memory-registry.repository.ts`: `provenance` in `CreateAssistantMemoryRegistryItemInput`.
- `apps/api/src/modules/workspace-management/infrastructure/persistence/prisma-assistant-memory-registry.repository.ts`: create + mapToDomain carry provenance.
- `apps/api/src/modules/workspace-management/application/write-assistant-memory.service.ts`: `provenance` in `WriteAssistantMemoryInput`; `parseInput` defaults to `system_inferred` when absent; `asProvenance` updated.
- `apps/api/src/modules/workspace-management/application/manage-assistant-workspace-memory.service.ts`: `user_explicit` provenance on workspace-memory writes.
- `apps/api/src/modules/workspace-management/application/hydrate-memory-for-turn.service.ts`: `provenance` in `HydratedDurableMemoryItem`.
- `apps/api/prisma/bootstrap-preset-data.ts`: new `memory_protocol` template; `{{memory_protocol_block}}` in `system` template; `agents` template emptied.
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts`: `generateMemoryProtocolPrompt` + `memory_protocol_block` substitution.
- `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts`: `provenance` in `InternalMemoryWriteInput` + `InternalHydratedDurableMemoryItem`.
- `apps/runtime/src/modules/turns/auto-extract-to-memory.service.ts`: `provenance: "auto_extracted"`.
- `apps/runtime/src/modules/turns/runtime-memory-write-tool.service.ts`: `provenance: "system_inferred"`.
- `apps/runtime/src/modules/turns/prompt-cache-stable-blocks.ts`: `MemoryXmlEntry` type; `formatDurableMemoryContextualBlock` accepts `MemoryXmlEntry[]`, emits XML; `isDurableMemoryContextualMessage` requires `role === "assistant"` guard.
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts`: `buildContextualMemoryMessage` uses `takeMemoryXmlEntries` + `volatileKind: "memory"`.
- `apps/runtime/src/modules/turns/turn-execution.service.ts`: `extractRenderedShortMemorySummaries` dual-parses XML and legacy markdown.
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`: wrapper tag `<persai_memory>`.
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`: wrapper tag `<persai_memory>`.
- `packages/runtime-bundle/src/index.ts`: `memoryProtocol?` in `AssistantRuntimeCompiledOrdinaryPromptSections`.
- `packages/runtime-contract/src/index.ts`: JSDoc updated for `volatileKind`.

### Tests

- `apps/api/test/bootstrap-preset-data.test.ts`: `memory_protocol` template XML balance; `system` template contains `{{memory_protocol_block}}`; `agents` template does not contain inline `<memory_protocol>` block.
- `apps/api/test/compile-prompt-constructor.service.test.ts`: compiled system prompt includes `<memory_protocol>` with `<read>` and `<write>`.
- `apps/api/test/write-assistant-memory.service.test.ts`: `deepEqual` fixture updated to include `provenance: "system_inferred"`.
- `apps/runtime/test/prompt-cache-stable-blocks.test.ts`: XML entry rendering, byte-stability, `isDurableMemoryContextualMessage` with role guard.
- `apps/runtime/test/turn-context-hydration.service.test.ts`: contextual memory assertions updated to new XML format; all fixtures carry `provenance: "legacy"`.
- `apps/runtime/test/runtime-memory-write-tool.service.test.ts`: `deepEqual` fixture updated with `provenance: "system_inferred"`.
- `apps/runtime/test/turn-execution.service.test.ts`: `deepEqual` fixture updated with `provenance: "system_inferred"`.
- `apps/runtime/test/native-tool-projection.test.ts`: updated ADR-117 golden test — `agents` block no longer contains `<memory_protocol>`; new assertion verifies dedicated `memory_protocol` template is present.
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`: `<persai_memory>` wrapper assertions; `<recent_short_memory>` no longer fires.
- `apps/provider-gateway/test/openai-provider.client.test.ts`: `<persai_memory>` wrapper assertions; `<persai_contextual_memory>` no longer fires.

### Risk

**Medium — migration gate.** `20260618153000_adr119_memory_provenance` is an additive column with DEFAULT, so production rollback is safe (drop column). Per AGENTS.md, Prisma migration changes cause Dev Image Publish to pause on the `persai-dev-migrations` GitHub Environment and wait for manual approval. This is expected — user must approve in GitHub after push. One-time prompt-cache prefix invalidation deliberate (batched with Slice 8).

### Next recommended step

Slice 10 — admin UI for new scenario fields (`expectedUserResponse`, `nextStepTrigger`, `recoveryGuidance`) exposed in the skill scenario editor.

---

## 2026-06-18 — ADR-119 Slice 8 landed (response contract `<must>`/`<prefer>` restructure)

### Root cause

The `<response_contract>` block in the `system` template was a flat 11-rule list with no priority differentiation. Per ADR-119 D9, a flat list causes the model to prioritize the first 2-3 rules and ignore the rest. The two-tier `<must>`/`<prefer>` structure communicates which rules are hard invariants (must satisfy every reply) versus soft preferences (apply unless contradicting `<must>`).

### Fix scope

- `apps/api/prisma/bootstrap-preset-data.ts`: `<response_contract>` block in the `system` template rewritten from flat 11-rule list to two-tier XML with `<must>` (4 hard invariants: polished product blocks, assistant_gender self-reference forms, fenced code blocks, delivery honesty) and `<prefer>` (4 soft preferences: opener, calm formatting, Markdown h2/h3, follow-up actions). Some prior rules collapsed (e.g. the five follow-up-action rules are now one PREFER bullet); gendered self-reference moved from `<prefer>` position to `<must>` (it is a hard invariant).

### Tests

- `apps/api/test/bootstrap-preset-data.test.ts`: new `runResponseContractSlice8` suite — XML balance passes (new `<must>`/`<prefer>` tags balanced); `<must>` and `<prefer>` nested inside `<response_contract>`; MUST tier contains 4 key phrases; PREFER tier contains 4 key phrases; first child of `<response_contract>` is `<must>` not a bare list item.
- `apps/api/test/compile-prompt-constructor.service.test.ts`: 3 stale `runDefaultPromptTemplateCompile` assertions updated to match new text (`Add follow-up actions` → `Follow-up actions`, `1-2 short plain-text bullet items` → `1-2 short user-imperative bullets`, `Never write follow-up actions from the assistant's point of view` → `No Markdown formatting inside follow-ups`). New `runResponseContractSlice8` test: compiled default system prompt contains `<response_contract>` with `<must>` and `<prefer>` children.

### Files touched

- `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/api/test/bootstrap-preset-data.test.ts`
- `apps/api/test/compile-prompt-constructor.service.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**Low — prompt-only content change.** No schema changes. No new templates. No compiler changes. One-time prompt-cache prefix bytes shift on rollout (the `<response_contract>` section bytes change); this is deliberate and batched with Slice 9 (memory protocol) for a single combined invalidation event.

### Next recommended step

Slice 9 — memory protocol + provenance (`<memory_protocol>` block in cache prefix; `Memory.provenance` column; `AutoExtractToMemoryService` provenance tagging; materialized `<persai_memory>` entries carry `provenance` attribute in volatile context). Batch deploy with Slice 8.

---

## 2026-06-18 — ADR-119 Slice 7 landed (tool descriptor rewrite)

### Root cause

Per-tool descriptors in `tool-catalog-data.ts` were flat prose strings with no structure. Anthropic ACI best practices require role / when_to_use / when_not_to_use / examples / gotchas sections so the model makes correct tool-selection decisions. Several descriptors also contained cross-tool routing prose (e.g. "use knowledge_search before web_search") that ADR-117 prohibits in per-tool descriptors (cross-tool routing belongs in the `tools` selection-guide template only).

### Fix scope

- `apps/api/prisma/tool-catalog-data.ts`: `modelDescription` and `modelUsageGuidance` rewritten for 8 tools: `skill`, `image_edit`, `image_generate`, `memory_search` (→ `knowledge_search`), `memory_get` (→ `knowledge_fetch`), `web_search`, `web_fetch`. New catalog entry `memory_write` added (id: `33333333-3333-3333-3333-333333333333`, `policyClass: "platform_managed"`). Each new `modelUsageGuidance` follows the 4-section ACI format. Stale double-sentence GOTCHA ("If you have not called image_edit…") removed from `image_edit` guidance; it was subsumed by the single "Never claim the edit is done" bullet.
- `apps/api/prisma/bootstrap-preset-data.ts`: `HIDDEN_PROMPT_TEMPLATE_DEFAULTS` entries for `knowledge_search`, `knowledge_fetch`, and `memory_write` (all three synthetic tools) updated to the same 4-section ACI format. These defaults populate new workspace DB rows before any admin override.
- `apps/runtime/src/modules/turns/native-tool-projection.ts`: `resolveToolDefinitionDescription` now uses `\n` separator between description and guidance (preserves multi-line structure). Added `TOOL_DESCRIPTION_CAP = 1024` constant and `truncateToDescriptionCap` helper that falls back to the `WHEN TO USE:` first line when the combined string exceeds the cap. Cross-tool prose (`image_edit` suggestion) removed from `image_generate` hardcoded projection hint.

### Tests

- `apps/runtime/test/native-tool-projection.test.ts`: new export `runAdr119Slice7DescriptorTests` — (1) per-tool rendered description shape test × 8 tools (asserts all 4 section headers present), (2) cross-tool prose drift test reading catalog source file (ALLOW_LIST includes chain-link exceptions and pre-Slice-7 `shell → files` exception), (3) safe-fallback truncation test. Registered in `run-suite-isolated.ts`. Test bundle updated to include `web_fetch` credential ref so the tool is projected in the shape-test. Existing `webSearch.description` assertion updated to use `\n` separator.
- `apps/api/test/seed-tool-catalog.test.ts`: Slice 7 shape assertions (8 tools, 4 section headers each) + ADR-117 cross-tool drift assertions added. Stale `"If you have not called image_edit"` assertion removed. `shell: ["files"]` added to ALLOW_LIST.

### Files touched

- `apps/api/prisma/tool-catalog-data.ts`
- `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/runtime/src/modules/turns/native-tool-projection.ts`
- `apps/runtime/test/native-tool-projection.test.ts`
- `apps/runtime/test/run-suite-isolated.ts`
- `apps/api/test/seed-tool-catalog.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**One-time prompt-cache prefix invalidation on rollout** — tool description bytes change for 8 tools; batched with Slice 6 (selection guide XML) for a single combined invalidation event. No schema changes. New `memory_write` catalog entry is additive (no plan activation seeded; `platform_managed`).

### Next recommended step

Slice 8 — response contract restructure (`<response_contract>` must/prefer two-tier rewrite in `bootstrap-preset-data.ts`).

---

## 2026-06-18 — ADR-119 Slice 6 landed (selection guide XML priority order)

### Root cause

The `tools` prompt template was written as a flat Markdown document (`# Native Tool Runtime — Selection Guide` heading + `##` sections). Per ADR-119 D8, the canonical form must be structured XML with a `<priority_order>` block placing Skills first, `<parallelism>` block constraining `skill({engage})` as solo, `<failure_handling>` block with `pending_delivery` and error honesty rules, and `<category_rules>` with per-domain `<category>` elements. The ADR-118 D7 one-rule Skills contribution was embedded in the old `## Skills` Markdown section and needed migrating into the new XML structure.

### Fix scope

- `apps/api/prisma/bootstrap-preset-data.ts`: `tools` template rewritten from Markdown to canonical XML `<tool_usage_policy>` structure. Old `# Native Tool Runtime — Selection Guide` heading removed. `<priority_order>` with 6 numbered rules (Skills gate #1, active scenario #2, knowledge-before-web #3, media routing #4, memory #5, files/docs/tasks #6). `<parallelism>` block. `<failure_handling>` block (error/denied/pending_delivery/budget). `<category_rules>` with five `<category>` elements: files, documents, tasks, browser, skills.
- `apps/runtime/test/native-tool-projection.test.ts`: ADR-117 golden test invariants updated for new XML form. Old assertions on Markdown headings (`# Native Tool Runtime — Selection Guide`, `## Skills`, `` `# Enabled Skills` ``, `` `Skill ID` ``, `skill({ action: "engage" })` spacing) replaced with XML-form equivalents. New assertions added: (d) `<priority_order>` + "Skills are the gate", (e) `<parallelism>` + "ALWAYS solo", `<failure_handling>` + "pending_delivery".
- `apps/web/app/admin/presets/page.test.tsx`: mock template for "renders the tools section as selection guide" test updated from old Markdown heading to new XML snippet.

### Tests

- `apps/runtime/test/native-tool-projection.test.ts`: ADR-117 golden test updated (0 new cases; existing assertions replaced/extended).
- `apps/api/test/bootstrap-preset-data.test.ts`: Slice 1 XML balance validator passes unchanged (new template is balanced; `tool_usage_policy` outer tag already in `EXPECTED_OUTER_TAGS`).
- `apps/web/app/admin/presets/page.test.tsx`: mock template updated; 0 new cases.

### Files touched

- `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/runtime/test/native-tool-projection.test.ts`
- `apps/web/app/admin/presets/page.test.tsx`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**One-time prompt-cache prefix invalidation on rollout** — The `tools` block content and structure change completely; the stable cache prefix is invalidated for all workspaces on first materialization after deploy. This is deliberate and batched with Slice 7 (per-tool descriptor rewrite) so there is only one combined invalidation event.

**Admin UI for custom `tools` template** — Admins with a custom `tools` template will see the old Markdown heading in their override. `reset-to-default` delivers the new XML form. No migration needed; custom overrides are respected.

### Next recommended step

Slice 7 — per-tool descriptor rewrite (`tool-catalog-data.ts`): rewrite each high-traffic tool description to Anthropic ACI best-practices format (role / when_to_use / when_not_to_use / examples / gotchas). Update ADR-117 golden test Slice 7 contribution from ADR-118. Batch deploy with Slice 6 cache-prefix invalidation.

---

## 2026-06-18 — ADR-119 Slice 5 landed (`<system-reminder>` protocol)

### Root cause

The volatile-context rail (`cacheRole: "volatile_context"`) had no mechanism to inject mid-conversation directive messages. Per ADR-119 D7, the model needs `<system-reminder>` blocks to reinforce rules under recency bias (active scenario tick, reference image warning, tool budget pressure). The `volatileKind` union only had `"memory"` and `"active_scenario"`; both provider clients had no handler for a third kind; the cache prefix had no declaration of the reminder protocol; the compiler had no `reminders_protocol_block` placeholder.

### Fix scope

- `packages/runtime-contract/src/index.ts`: `volatileKind` union extended to `"memory" | "active_scenario" | "system_reminder"`. JSDoc updated.
- `packages/runtime-bundle/src/index.ts`: `AssistantRuntimeCompiledOrdinaryPromptSections` extended with optional `remindersProtocol?: string`.
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`: `buildAnthropicVolatileContextMessage` extended — `system_reminder` kind wraps content with `<system-reminder>…</system-reminder>` and a preamble directing the model to absorb without responding.
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`: `buildOpenAIVolatileContextItem` extended symmetrically.
- `apps/api/prisma/bootstrap-preset-data.ts`: `reminders_protocol` template added to `VISIBLE_PROMPT_TEMPLATE_DEFAULTS`; `system` template updated to include `{{reminders_protocol_block}}` between `{{enabled_skills_block}}` and `<response_contract>`.
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts`: `PromptTemplateMap` extended with `reminders_protocol?`; `REMINDERS_PROTOCOL_DEFAULT` constant added; `generateRemindersProtocolPrompt` method added; `remindersProtocol` added to `ordinarySections`; `reminders_protocol_block` added to substitution map and fallback join.
- `apps/runtime/src/modules/turns/tool-budget-policy.ts`: `ToolBudgetSnapshot` exported type added; `getSnapshot()` method added to `ToolBudgetPolicy`.
- `apps/runtime/src/modules/turns/build-system-reminder-blocks.service.ts`: NEW — `BuildSystemReminderBlocksService` with three reminder emission rules (scenario tick, image, budget warning).
- `apps/runtime/src/modules/turns/turns.module.ts`: `BuildSystemReminderBlocksService` added to `providers` and `exports`.
- `apps/runtime/src/modules/turns/turn-execution.service.ts`: `BuildSystemReminderBlocksService` injected; called after `buildActiveScenarioBlockService.buildBlock()`; reminder blocks appended after the active-scenario block in `hydratedMessages`.

### Tests

- `apps/runtime/test/build-system-reminder-blocks.service.test.ts`: NEW — 11 test cases covering all reminder conditions, stable ordering, cacheRole/volatileKind assertions, byte-stability, graceful degradation.
- `apps/runtime/test/turn-execution.service.test.ts`: extended with 2 integration scenarios (scenario active → 1 reminder; scenario + image → 2 reminders). All 3 `TurnExecutionService` instantiations updated with `new BuildSystemReminderBlocksService()`.
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`: extended — `system_reminder` wraps with `<system-reminder>`, preamble present, no double-wrapping.
- `apps/provider-gateway/test/openai-provider.client.test.ts`: symmetric new test for `system_reminder`.
- `apps/api/test/bootstrap-preset-data.test.ts`: `reminders_protocol` added to `EXPECTED_OUTER_TAGS`; new `runRemindersProtocolSlice5` function checks presence, balance, placeholder position.
- `apps/api/test/compile-prompt-constructor.service.test.ts`: new `runRemindersProtocolSlice5` function — default template includes `<reminders_protocol>`, null falls back to default, custom template used verbatim, `remindersProtocol` in ordinarySections.

### Files touched

- `packages/runtime-contract/src/index.ts`
- `packages/runtime-bundle/src/index.ts`
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`
- `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts`
- `apps/runtime/src/modules/turns/tool-budget-policy.ts`
- `apps/runtime/src/modules/turns/build-system-reminder-blocks.service.ts` (NEW)
- `apps/runtime/src/modules/turns/turns.module.ts`
- `apps/runtime/src/modules/turns/turn-execution.service.ts`
- `apps/runtime/test/build-system-reminder-blocks.service.test.ts` (NEW)
- `apps/runtime/test/run-suite.ts`
- `apps/runtime/test/run-suite-isolated.ts`
- `apps/runtime/test/turn-execution.service.test.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `apps/provider-gateway/test/openai-provider.client.test.ts`
- `apps/api/test/bootstrap-preset-data.test.ts`
- `apps/api/test/compile-prompt-constructor.service.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**One-time prompt-cache prefix invalidation on rollout** — The stable cache prefix grows by ~6 lines for the new `<reminders_protocol>` declaration (batched with Slice 4 deploy per ADR-119). The `{{reminders_protocol_block}}` placeholder is placed between `{{enabled_skills_block}}` and `<response_contract>` in the system template; existing custom templates that omit the placeholder continue to work (line dropped by `interpolateTemplate`).

**Budget reminder fires with 0% usage at turn prep time** — The `toolBudgetSnapshot` is always empty at message-preparation time (no tools have been called yet). Budget-warning reminders are correct semantically but will not fire in practice in the current turn-start injection. This is acceptable behavior and the API is complete for future toolloop-iteration injection.

**Admin UI for `reminders_protocol` template not exposed** — Custom per-workspace overrides of `reminders_protocol` are respected but not yet exposed in the admin UI (Slice 10 covers that). Default is used for all workspaces.

### Next recommended step

Slice 6 — selection guide priority order (ADR-119 D8: rewrite `tools` template default as priority-ordered XML with Skills-first gate). Key file: `apps/api/prisma/bootstrap-preset-data.ts` `tools` template, ADR-117 golden test must also pass.

---

## 2026-06-18 — ADR-119 Slice 4 landed (volatile scenario XML format + step field extensions)

### Root cause

`BuildActiveScenarioBlockService` was emitting the active-scenario volatile block in Markdown format (`## Active Scenario: …`, `Steps:`, `Recommended tool:`, `Guards:`). Per ADR-119 D5 the block must be structured XML so the model can parse individual step fields reliably. Additionally, three new optional step-level fields (`expectedUserResponse`, `nextStepTrigger`, `recoveryGuidance`) were spec'd in D5 but had never been added to the schema or the materializer. The Anthropic provider client still used the old inner tag name `active_scenario` (the OpenAI client was already using `persai_active_scenario` since ADR-118 Slice 4 — an inconsistency introduced then).

### Fix scope

- `packages/runtime-contract/src/index.ts`: `RuntimeBundleSkillScenarioStep` extended with three optional fields (`expectedUserResponse?`, `nextStepTrigger?`, `recoveryGuidance?`).
- `apps/api/src/modules/workspace-management/application/skill-scenario.types.ts`: `SkillScenarioStepState` extended with the same three fields (non-optional, `null`-default); `parseStep` validates each up to 400 chars; three new `MAX_*` constants added.
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`: `normalizeSkillScenarioSteps` populates new fields with `null` when absent (never `undefined`); exported for direct unit testing.
- `apps/runtime/src/modules/turns/build-active-scenario-block.service.ts`: `renderActiveScenarioBlock` fully rewritten from Markdown to canonical XML per ADR-119 D5; `renderStep`/`escapeXml` helpers added; `appendStepDetails` removed.
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`: `innerTag` for `volatileKind === "active_scenario"` renamed `active_scenario` → `persai_active_scenario`.

### Tests

- `apps/runtime/test/build-active-scenario-block.service.test.ts`: 8 existing cases updated (Markdown → XML assertions); 10 new cases added (XML step tag, recommendedToolCall present/absent, expectedUserResponse present/absent, nextStepTrigger present/absent, recoveryGuidance present/absent, empty negativeGuards → tag absent, guard format, exit_condition tag, byte-stability).
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`: updated scenario test to assert `<persai_active_scenario>` (NOT `<active_scenario>`).
- `apps/provider-gateway/test/openai-provider.client.test.ts`: added negative assertion `must NOT use bare <active_scenario>`.
- `apps/api/test/materialize-assistant-published-version.service.test.ts`: 3 new unit tests for `normalizeSkillScenarioSteps` (new fields flow through, missing → null, explicit null → null).

### Files touched

- `packages/runtime-contract/src/index.ts`
- `apps/api/src/modules/workspace-management/application/skill-scenario.types.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/runtime/src/modules/turns/build-active-scenario-block.service.ts`
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/runtime/test/build-active-scenario-block.service.test.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `apps/provider-gateway/test/openai-provider.client.test.ts`
- `apps/api/test/materialize-assistant-published-version.service.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**One-time prompt-cache prefix invalidation on rollout** — The volatile `active_scenario` block bytes change shape (Markdown → XML). This block is projected at runtime (volatile, not cached), so cache invalidation is limited to the volatile block itself. No stable prefix bytes change in this slice. The Anthropic inner-tag rename (`active_scenario` → `persai_active_scenario`) also affects only the volatile volatile-tail projection.

**Additive contract change** — `RuntimeBundleSkillScenarioStep` new fields are optional. Existing bundle JSON files (pre-Slice-4 materialization) will deserialize with `undefined` for these fields; the renderer treats `undefined` as null (both checks use `?? null`). Safe degradation, no crash.

**Admin UI for new fields deferred** — New `expectedUserResponse`, `nextStepTrigger`, `recoveryGuidance` fields are not yet exposed in the admin scenario editor (Slice 10). Existing scenarios continue to work unchanged; new fields default to null until an admin edits and saves a scenario after Slice 10 ships.

### Next recommended step

Slice 5 — system-reminder protocol. Will batch with Slice 4 in the same volatile-tail format deploy per ADR-119. Key files: `packages/runtime-contract/src/index.ts` (add `system_reminder` to `volatileKind`), `apps/runtime/src/modules/turns/build-system-reminder.service.ts` (new), `apps/runtime/src/modules/turns/turn-execution.service.ts` (inject reminder before memory), both provider clients (add `<system-reminder>` wrapper for the new kind).

---

## 2026-06-17 — ADR-119 Slice 3 landed (Skills progressive disclosure + first_step_preview)

### Root cause

The `enabled-skills-prompt-materialization.ts` Markdown card renderer emitted the full `instructionCard.body` (up to 1,200 chars), `guardrails`, and `examples` for every enabled Skill directly into the stable cache prefix. This was risk R8 from ADR-119 inventory: ~1,500 chars × 3 Skills ≈ ~4,500 chars (~1,100 tokens) wasted on every request even when no Skill was ever engaged. Additionally, the model had no compact step-1 guidance before calling `skill({engage})`, triggering parallel tool-call races ([F3]).

### Fix scope

- `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts`: `renderSkillCard` and `renderEnabledSkillsPromptBlock` rewritten to emit compact XML per ADR-119 D4. Body/guardrails/examples removed from the prefix block. New fields added: `whenToUse` (optional InstructionCard field), `first_step_preview` per scenario (≤200-char excerpt of `steps[0].directive`). `escapeXml` helper added. Locale fallback order for `localize` updated to prefer `ru` before `en` (per ADR).
- `packages/runtime-bundle/src/index.ts`: `AssistantRuntimeEnabledSkillSummary` extended with required `body: string`, `guardrails: string[]`, `examples: string[]` fields.
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`: `normalizeInstructionCard` extended to extract `whenToUse`; `skills.enabled` bundle mapping extended to include `body`, `guardrails`, `examples` from the card.
- `apps/runtime/src/modules/turns/runtime-skill-tool.service.ts`: `RuntimeSkillToolResult` engaged variants extended with `instruction: {body, guardrails, examples}` and `scenario: {key, displayName, description, steps, recommendedTools, exitCondition} | null`. `buildInstruction` helper added.

### Tests

- `apps/api/test/enabled-skills-prompt-materialization.test.ts`: fully rewritten for XML format — `<skill id>` tags, `key` attribute, `<first_step_preview>` present/absent, R8 sentinel assertions (body/guardrails/examples NOT in prefix), R8 invariant assertion (body/guardrails/examples ARE on card objects), byte-stability test.
- `apps/runtime/test/runtime-skill-tool.service.test.ts`: `createBundle` updated to include `body/guardrails/examples`; new assertions for `instruction.body`, `instruction.guardrails`, `instruction.examples` on both engage paths; `scenario` nested object assertions (key, displayName, description, steps shape); byte-match sentinel test.
- `apps/runtime/test/native-tool-projection.test.ts`: skill fixture updated with `body: "", guardrails: [], examples: []`.
- `apps/runtime/test/turn-routing.service.test.ts`: skill fixtures updated with `body: "", guardrails: [], examples: []`.

### Files touched

- `packages/runtime-bundle/src/index.ts`
- `apps/api/src/modules/workspace-management/application/enabled-skills-prompt-materialization.ts`
- `apps/api/src/modules/workspace-management/application/materialize-assistant-published-version.service.ts`
- `apps/runtime/src/modules/turns/runtime-skill-tool.service.ts`
- `apps/api/test/enabled-skills-prompt-materialization.test.ts`
- `apps/runtime/test/runtime-skill-tool.service.test.ts`
- `apps/runtime/test/native-tool-projection.test.ts`
- `apps/runtime/test/turn-routing.service.test.ts`
- `apps/web/app/admin/presets/page.tsx`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**One-time prompt-cache prefix invalidation on rollout** — the XML card bytes replacing the Markdown format change the stable prefix bytes for every assistant with enabled Skills; all provider-side cache entries invalidate once. R8 invariant is maintained: `body/guardrails/examples` are added to the bundle type AND materialized AND returned by the engage tool in this same commit, so the model always receives full instructions on `skill({engage})`.

**`body/guardrails/examples` required on `AssistantRuntimeEnabledSkillSummary`** — older bundle JSON files (from pre-Slice-3 materialization) will deserialize with `undefined` for these fields. The runtime `buildInstruction` helper will return empty strings/arrays — safe degradation, no crash. Next turn rematerializes the bundle and picks up the new fields.

### Next recommended step

Slice 4 — volatile scenario block XML format (`<persai_active_scenario>` per ADR-119 D5). Rewrites `BuildActiveScenarioBlockService` to emit structured XML with `<step number status>`, `<directive>`, `<next_step_trigger>`, `<negative_guards>`, and `<exit_condition>` instead of the current Markdown developer block.

---

## 2026-06-17 — ADR-119 Slice 2 landed (provider cache_control markers + parallel-tool-calls discipline)

### Root cause

Production observed the model co-firing `skill({engage})` and a media generation tool in the same response (parallel tool call), bypassing the intended Skill activation gate. Concurrently, the OpenAI Responses API was receiving the system prompt via the legacy `payload.instructions` parameter instead of inside `input[]`, meaning the stable system prefix was NOT the cache prefix — invalidating OpenAI prefix-match caching on every structural change. Anthropic still emitted only a single `cache_control` marker on the whole system prompt, blocking the planned 3-zone BP boundary split.

### Fix scope

- `packages/runtime-contract/src/index.ts`: `ProviderGatewayTextGenerateRequest` extended with `skillsEnabled?: boolean` and `systemPromptBlocks?: Array<{id:string, text:string}>`.
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`: `buildAnthropicSystemBlocks` extended for multi-block path; `toAnthropicToolChoice` returns `{type:"auto", disable_parallel_tool_use:true}` when `skillsEnabled && tools`.
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`: `payload.instructions` removed from both non-streaming and streaming paths; `buildOpenAISystemDeveloperItems` helper added; `buildOpenAIInputItems` prepends developer-role items; `parallel_tool_calls` is `false` when `skillsEnabled===true`, otherwise `true`.
- `apps/runtime/src/modules/turns/turn-execution.service.ts`: `buildProviderRequest` now passes `skillsEnabled: bundle.skills?.enabled.length > 0`.
- **Minimal path**: `systemPromptBlocks` is wired through the contract and provider clients but NOT yet populated from materialization. Providers fall back to single-block until a follow-up micro-slice exposes compiler block offsets.

### Tests

- `apps/provider-gateway/test/anthropic-provider.client.test.ts`: new Slice 2 cases — `skillsEnabled:true + tools`, `skillsEnabled:true + no tools`, `skillsEnabled:false + tools`, `skillsEnabled:undefined + tools`, 3-block / 4-block / mismatch `systemPromptBlocks` (generate + stream mirrors).
- `apps/provider-gateway/test/openai-provider.client.test.ts`: new Slice 2 cases — `skillsEnabled:true/false/undefined + tools`, `systemPromptBlocks` 2-block (generate + stream), `instructions`-absent assertions on generate + stream baseline.
- Updated existing input-array assertions throughout `openai-provider.client.test.ts` to include the new developer-system item at `input[0]`.

### Files touched

- `packages/runtime-contract/src/index.ts`
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`
- `apps/runtime/src/modules/turns/turn-execution.service.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `apps/provider-gateway/test/openai-provider.client.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**OpenAI one-time prompt-cache prefix invalidation** — moving system prompt from `instructions` to `input[0]` as developer items changes the Responses API cache key; all cached prefixes are invalidated once on rollout. Functional behavior is unchanged. **Back-compat**: `skillsEnabled===false/undefined` paths preserve `parallel_tool_calls:true` (OpenAI) and no `disable_parallel_tool_use` (Anthropic) — tested in both directions.

**Deviation from spec:** `cacheBreakpoints: number[]` replaced by `systemPromptBlocks: Array<{id,text}>` — named blocks are safer than byte-offsets under string normalization differences.

### Next recommended step

Slice 3 — Skills progressive disclosure + `first_step_preview`. **BATCH Slices 1 + 2 + 3 in one persai-dev deploy** per ADR-119 (Slices 1+2 must land together; Slice 3 also batched for deploy efficiency). Slice 3 requires Slice 1's `compileMode` field to be present. A follow-up micro-slice (between Slice 2 and Slice 3) should populate `systemPromptBlocks` from materialization output using the `xml_canonical_v1` zone boundaries.

---

## 2026-06-17 — ADR-119 Slice 1 landed (XML compile output + persona deduplication)

### Root cause

The materialized system prompt had no structural XML boundaries — it was a single Markdown blob. `snapshotInstructions` was rendered through two paths simultaneously (`{{persona_instructions_block}}` in the system template AND `{{instructions_block}}` inside the soul template), causing the [F1] persona duplication failure mode documented in ADR-119. Downstream Slice 2 cache-control marker splitting requires character-offset metadata from the compiler, which only makes sense once XML zone boundaries exist.

### Fix scope

- `apps/api/prisma/bootstrap-preset-data.ts`: all eight visible templates wrapped with canonical ADR-119 outer XML tags; `soul` split into adjacent `<voice>` + `<character_notes>` blocks; `system` Response UI Contract section wrapped in `<response_contract>`.
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts`: `{{persona_instructions_block}}` dropped (resolves to `null`, so legacy custom templates drop the line silently); `stripEmptyCharacterNotes` added to collapse empty shell on persona-less assistants; `compileMode: "xml_canonical_v1"` emitted on every new materialization.
- `packages/runtime-bundle/src/index.ts`: `AssistantRuntimePromptCompileMode` type added; optional `compileMode` field added to `AssistantRuntimePromptConstructor.ordinary`; fallback synthesizer emits `"legacy_markdown"`.
- `apps/api/test/bootstrap-preset-data.test.ts`: new file — XML balance validator (stack-based, strips fenced code/backticks/placeholders) + outer-tag presence + `<character_notes>`/`{{instructions_block}}` placement assertions.
- `apps/api/test/compile-prompt-constructor.service.test.ts`: three fixture snapshots added (archetype-only, free-form-only, archetype+instructions); each asserts `compileMode`, `<voice>` count, `<character_notes>` count, single-occurrence of `snapshotInstructions`, and `<voice>`/`<character_notes>` adjacency.
- `apps/runtime/test/native-tool-projection.test.ts`: ADR-117 golden test updated for `<tool_usage_policy>` and `<memory_protocol>` outer tags (inner heading assertions preserved).

### Tests

Full verification gate passed:

- `corepack pnpm prisma:generate` PASS
- `corepack pnpm -r --if-present run lint` PASS
- `corepack pnpm run format:check` PASS
- `corepack pnpm --filter @persai/api run typecheck` PASS
- `corepack pnpm --filter @persai/web run typecheck` PASS
- `corepack pnpm --filter @persai/runtime run typecheck` PASS
- `corepack pnpm --filter @persai/provider-gateway run typecheck` PASS
- `corepack pnpm --filter @persai/runtime-contract run typecheck` PASS
- `corepack pnpm --filter @persai/api run test` PASS
- `corepack pnpm --filter @persai/runtime run test` PASS

### Files touched

- `apps/api/prisma/bootstrap-preset-data.ts`
- `apps/api/src/modules/workspace-management/application/compile-prompt-constructor.service.ts`
- `packages/runtime-bundle/src/index.ts`
- `apps/api/test/bootstrap-preset-data.test.ts` (new)
- `apps/api/test/compile-prompt-constructor.service.test.ts`
- `apps/runtime/test/native-tool-projection.test.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

**One-time prompt-cache prefix invalidation on rollout** — the XML tag bytes added to every cached template change the stable prefix bytes; all provider-side cache entries are invalidated once on the first materialization after deploy. `configDirtyAt` is cleared implicitly on next materialization (existing flow). Low functional risk: inner template content is byte-identical. R7 (`skill_state_classifier` orphan) and R8 (Skills progressive disclosure) remain deferred per slice boundary.

### Next recommended step

Slice 2 — provider cache_control markers + parallel-tool-calls discipline. **BATCH WITH SLICE 1 IN SAME DEPLOY**: Slice 2 requires the `compileMode: "xml_canonical_v1"` field from Slice 1 to safely split the Anthropic `cache_control` marker into 3 BP boundaries (BP1/BP2/BP3). OpenAI `developer` role migration (R4) and parallel-tool-calls discipline (R5) are also Slice 2 scope.

---

## 2026-06-17 — ADR-119 Slice 0.5 landed (Anthropic gateway observability)

### Root cause

OpenAI already emitted `[openai-stream-start]` operational metadata for streaming Responses calls, but Anthropic emitted no per-request start metadata on either caller-facing `generateText()` or `streamText()` path. That asymmetry would make ADR-119 prompt-architecture slices hard to observe and compare across providers. Slice 0.5 also required a safe, flag-gated body-dump channel before request-shape refactors start landing.

### Fix

`apps/provider-gateway` now emits always-on INFO start lines before both Anthropic SDK invocations:

- `[anthropic-non-stream-start]` for caller-facing `generateText()` (even though it uses `messages.stream(...).finalMessage()` internally after the provider hotfix).
- `[anthropic-stream-start]` for `streamText()`.

Both lines include request id, classification, tool-loop iteration, model, system block count, cache breakpoint count, message count, tool count, and tool-history count derived from the assembled Anthropic payload. A shared `ProviderDebugPayloadLogger` now gates provider body dumps behind `PERSAI_DEBUG_PROVIDER_PAYLOAD === "true"` and samples via `PERSAI_DEBUG_PROVIDER_PAYLOAD_RATE` (default/sanitized fallback `0.05`). It uses the separate logger name `persai.debug.provider`, truncates system/message/tool previews, and redacts base64 image/document inputs to `<redacted:<mime>:base64:LENGTH=N>`. OpenAI now calls the same dump helper on its non-streaming and streaming Responses paths while keeping existing metadata behavior.

### Tests

Full Slice 0.5 verification gate passed:

- `corepack pnpm --filter @persai/provider-gateway run lint`
- `corepack pnpm --filter @persai/provider-gateway run typecheck`
- `corepack pnpm --filter @persai/provider-gateway run test`
- `corepack pnpm run format:check`
- `corepack pnpm -r --if-present run lint`
- `corepack pnpm --filter @persai/api run typecheck`
- `corepack pnpm --filter @persai/web run typecheck`

### Files touched

- `apps/provider-gateway/src/modules/providers/provider-debug-payload-logger.ts`
- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`
- `apps/provider-gateway/src/modules/providers/openai/openai-provider.client.ts`
- `apps/provider-gateway/test/provider-debug-payload-logger.test.ts`
- `apps/provider-gateway/test/anthropic-provider.client.test.ts`
- `apps/provider-gateway/test/openai-provider.client.test.ts`
- `apps/provider-gateway/test/run-suite.ts`
- `docs/CHANGELOG.md`
- `docs/SESSION-HANDOFF.md`

### Risk

Low with flags off: production behavior is unchanged except for small Anthropic INFO metadata lines. The meaningful risk is accidental prompt/body exposure when debugging is enabled; mitigations are exact-string env gating, sampling, dedicated logger name, truncation, and base64 redaction. Operator follow-up: configure Loki retention for the `persai.debug.provider` channel at 3 days; no Helm/infra files were edited in this slice.

### Next recommended step

Slice 1: XML compile output + persona deduplication.

---

## 2026-06-17 — ADR-119 Slice 0 (inventory ledger, read-only) landed; provider-gateway hotfix deployed

### Slice 0 ledger summary

Read-only subagent produced `docs/ADR/119-prompt-inventory.md` — 1062-line ledger covering every prompt-section writer (W1-W41 detailed), 15 `bootstrap-preset-data.ts` template constants, 7 tool-descriptor surfaces, 5 volatile-context kinds with end-to-end traces, selection-guide single-seat verification, persona compiler duplication audit (the [F1] failure mode), 12 future-slice hit lists, 10 risks, and 8 reachability spot-checks with file:line citations. Orchestrator audit: spot-checks 1-8 all match real code. Gate green (format:check + lint).

### Risks folded back from the ledger (actionable for executor subagents)

The ledger surfaced 10 risks. The 6 most material ones must adjust the executor-subagent prompts for Slices 1-9:

- **R4** — OpenAI today uses `payload.instructions = input.systemPrompt` in both non-streaming (`openai-provider.client.ts:197-199`) and streaming (`openai-provider.client.ts:979-981`). ADR-119 mandates `developer` role inside `input[]` for cache-friendliness. **Slice 2 must include this request-shape migration explicitly**, with behavior risk noted (Responses API treats `developer` role differently from `instructions`).

- **R5** — `parallel_tool_calls = true` is hardcoded whenever tools exist (`openai-provider.client.ts:203-206`, `openai-provider.client.ts:985-988`). **Slice 2 test plan must cover both `skillsEnabled=false` (current behavior preserved) and `skillsEnabled=true` (parallel disabled) cases** to prevent accidental global disable.

- **R6** — Anthropic today emits ONE `cache_control` marker on the whole `systemPrompt` string (`anthropic-provider.client.ts:591-604`). **Slice 2 needs compiled offset metadata** (character positions or pre-split text blocks) from the runtime bundle to split safely into 3 BP boundaries — the provider client cannot infer semantic boundaries from a blob.

- **R8** — Enabled Skills prefix still renders `card.body` + `guardrails` + `examples` (`enabled-skills-prompt-materialization.ts:128-140`). **Slice 3 progressive disclosure must move all three into the `skill({engage})` tool response in the same deploy** — otherwise the model loses access to instruction bodies after Slice 3 lands.

- **R10** — `buildOpenAIInputItems` currently passes all volatile messages as one batch assuming same wrapper (`openai-provider.client.ts:1390-1393`). **Before Slices 4/5/9 add new `volatileKind` values** (`retrieved_knowledge`, `system-reminder`, `environment`, possibly renamed memory), provider clients must group/sort volatile messages by kind or preserve individual wrappers — current batching breaks if mixed kinds arrive in one turn.

- **R7** — `skill_state_classifier` prompt template (orphaned by ADR-118 Slice 6 cadence/classifier deletion) is still seeded at `bootstrap-preset-data.ts:226-240` and materialized into `promptDocuments.skillStateClassifier` at `materialize-assistant-published-version.service.ts:1017-1018`. Adjacent to prompt surface even though unused. **Either fold into Slice 11 closure or schedule a separate micro-slice** — orchestrator note for future planning.

The remaining risks (R1, R2, R3, R9) are textual ADR clarifications (the kind exists today vs introduced; retrieved knowledge migration path; environment migration; background-worker prompt scope) — orchestrator will fold these into the ADR text in the next slice that touches it.

### Provider-gateway hotfix (earlier this session, already deployed)

`7637ba48` on `origin/main`. See "Anthropic provider gateway hotfix" entry in `docs/CHANGELOG.md`. PDF jobs, AutoExtractToMemoryService, and SessionCompactionService unblocked.

### Next recommended step

Execute **ADR-119 Slice 0.5 — Anthropic gateway observability** via executor subagent. Goal: add `[anthropic-stream-start]` and `[anthropic-non-stream-start]` metadata lines mirroring OpenAI's, plus env-flag-gated body dump with base64 redaction. This is foundational for observing Slices 1-11 prompt structure changes from gateway logs. After Slice 0.5 lands and verifies, proceed to Slice 1 (XML compile output + persona deduplication, HIGH risk, batched with Slice 2 in same materialization rollout). Use the ledger Section 7 Slice 0.5 hit list as the file-touch contract.

---

## 2026-06-17 — Production hotfix: Anthropic provider gateway (non-streaming refusal for high max_tokens + maxItems rejected by structured output)

### Root cause

Two independent regressions in `@anthropic-ai/sdk@0.87.0` consumption by `apps/provider-gateway` were observed on `persai-dev` between 21:00 and 06:13 UTC+3 on 2026-06-16/17 (Loki / `kubectl logs`):

**Bug 1 — non-streaming refused when `max_tokens` projects > 10 min:**

```
Streaming is required for operations that may take longer than 10 minutes.
See https://github.com/anthropics/anthropic-sdk-typescript#long-requests for more details
```

Thrown synchronously from `Anthropic.calculateNonstreamingTimeout` (`@anthropic-ai/sdk@0.87.0` client.js:425) before any network call. The SDK precomputes wall-time from `max_tokens` × model token rate. PersAI hits this on PDF content generation in `runtime-document-provider-adapter.service.ts` (caps at `DEFENSIVE_OUTPUT_TOKEN_CAP = 64_000`) AND on the LLM document failure-framing fallback (~220 tokens normally, but routes through the same code path) — net effect: user got `Ассистент временно недоступен. Попробуйте ещё раз.` instead of any real reply (one of `runtime_degraded` / `runtime_unreachable` / `assistant_turn_failed` from `system-copy-catalog.ts`, all mapped to the same string).

**Bug 2 — `maxItems` rejected on `array` type in `output_config.format.schema`:**

```
400 invalid_request_error: output_config.format.schema:
For 'array' type, property 'maxItems' is not supported
```

Anthropic's structured-output schema does not accept `maxItems` (or `minItems`) on array types. Three call sites used it as a soft cap that was already re-enforced server-side after the model returned:

- `apps/runtime/src/modules/turns/auto-extract-to-memory.service.ts:59` — `AUTO_EXTRACT_OUTPUT_SCHEMA.items.maxItems = AUTO_EXTRACT_SOFT_CAP`. Killed the auto-extract background loop every run (~minute cadence), visible as `[auto-extract] Provider call failed for session ... Provider gateway request failed with status 500.` in runtime logs and as `[PersaiBackgroundCompactionSchedulerService] Background compaction job <uuid> deferred for retry (attempt 1, code=provider_error)` retry chains in api logs.
- `apps/runtime/src/modules/turns/shared-compaction-state.ts:71` — `REUSABLE_SHARED_COMPACTION_OUTPUT_SCHEMA.properties[*].maxItems = MAX_SECTION_ITEMS`. Killed all durable shared-compaction calls.
- `apps/api/src/modules/workspace-management/application/generate-skill-authoring-draft.service.ts:260` — `knowledgeCards.maxItems = 5`. Would have killed admin Skill authoring drafts if routed via Anthropic; less visible because the codepath is admin-triggered.

### User-visible symptom timeline

From the founder's `nica` Telegram chat (captured verbatim in the user prompt that opened this slice):

```
> Alex: Собери подробный pdf
> Nica: Запрос принят. Готовлю документ и пришлю его отдельно, когда он будет готов.
> Alex: Еще в работе?
> Nica: Запрос принят. Готовлю документ и пришлю его отдельно, когда он будет готов.
> Alex: Делай MD тогда
> Nica: Ассистент временно недоступен. Попробуйте ещё раз.
```

3 PDF enqueues all logged as `POST /api/v1/internal/runtime/document-jobs/enqueue 202` in api logs at 23:01:10, 23:03:14, 23:04:35; all 3 immediately triggered `AssistantDocumentJobCompletionTurnService: LLM document failure-framing call failed ... Document-job runtime returned HTTP 400` — the failure-framing LLM call itself crashed under Bug 1, so the user got the generic copy.

### Fix

Both fixes are in `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts`. Caller-facing API of `generateText` / `streamText` is unchanged.

**Fix A — Bug 1.** Replace `this.client.messages.create(payload, { signal })` (lines 153-155 pre-fix) with the streaming-aggregation pattern:

```ts
const stream = this.client.messages.stream(payload, { signal });
const response = (await stream.finalMessage()) as AnthropicNonStreamingMessage;
```

`messages.stream()` returns a `MessageStream`; `await stream.finalMessage()` resolves to a fully-assembled `Message` identical in shape to `messages.create()` (same `content`, `stop_reason`, `usage`). The underlying connection is streaming so the SDK's `calculateNonstreamingTimeout` 10-min refusal is bypassed. All downstream logic (`parseAnthropicToolCalls`, `extractAnthropicText`, `anthropic_empty_completion` warn, `toUsageSnapshot`, both tool_calls and completed return branches) preserved verbatim. `streamText()` untouched.

**Fix B — Bug 2.** New private `sanitizeAnthropicStructuredOutputSchema(value: unknown): unknown` walks the schema recursively. For each plain object it constructs a new object skipping keys `maxItems` and `minItems`; for arrays it maps over elements; primitives and `null` pass through. Does NOT mutate the caller's input (verified in tests). `toAnthropicOutputConfig` now calls it before sending and casts the result back to `Record<string, unknown>` (TS sees the input schema as that type from the contract). Tool input schemas (`tools[].input_schema`) untouched — Anthropic accepts `maxItems` there, only `output_config.format.schema` is restricted.

Server-side caller validation that was previously paired with the schema cap is **kept** in both `auto-extract-to-memory.service.ts` (post-response validator drops candidates over the cap) and `shared-compaction-state.ts` (post-response `normalizeReusableCompactionSections` truncates oversize sections). Behaviour is identical when the model returns ≤ cap items; for over-cap returns, the cap is enforced one layer later instead of failing the entire call with a 400.

### Tests

`apps/provider-gateway/test/anthropic-provider.client.test.ts`:

- Restubbed `installFakeAnthropic` to expose both `client.messages.stream(...).finalMessage()` (new non-streaming path) and `client.messages.create(...)` (still used by `streamText` via the `stream: true` payload branch); `create` now throws if called without `stream: true` to guard against regressions.
- New test: `generateText` with `maxOutputTokens: 32_000` succeeds — was throwing before this fix.
- New test: structured request with `outputSchema.schema.properties.items = { type: "array", maxItems: 5, minItems: 1, items: { type: "string" } }` → sent payload's `output_config.format.schema.properties.items.maxItems` and `.minItems` are `undefined`; deep `items.items.type === "string"` preserved; the **original** schema object still has `maxItems: 5` and `minItems: 1` after the call (no mutation).
- New test: nested schema with `properties.outer = { type: "array", maxItems: 3, items: { type: "object", properties: { inner: { type: "array", maxItems: 7, minItems: 2, items: { ... } } } } }` → `maxItems` stripped at both levels; deepest leaf preserved; original input unchanged at both levels.
- New test: empty-completion path with the new `finalMessage()` source still triggers `anthropic_empty_completion` warn with `event` + `stopReason` fields.

`apps/provider-gateway/test/anthropic-empty-completion.test.ts`: fake client extended to expose both `stream` and `create` so the legacy stream-path stubs continue working.

Sub-agent left `AbortSignal!.signal` reads as optional-chained which TypeScript narrowed to `never` in strict mode (`Property 'signal' does not exist on type 'never'`) — switched to `!` non-null assertions in two places (lines 320-321, 332) and one warn-event read (1041-1042). Schema sanitizer return type cast to `Record<string, unknown>` in `toAnthropicOutputConfig` to satisfy `ProviderGatewayStructuredOutputSchema.schema` typing.

### Cache prefix invalidation

None. This fix is internal to the provider-gateway request construction layer; system-prefix bytes are unchanged.

### Gate green

- recursive `corepack pnpm -r --if-present run lint` — PASS (14 packages, none skipped)
- `corepack pnpm run format:check` — PASS
- `corepack pnpm --filter @persai/provider-gateway run typecheck` — PASS
- `corepack pnpm --filter @persai/provider-gateway run test` — PASS (exit 0; both `anthropic_empty_completion` warns triggered as expected by tests; `openai_empty_completion` tests also pass)
- `corepack pnpm --filter @persai/api run typecheck` — PASS
- `corepack pnpm --filter @persai/web run typecheck` — PASS

### Files touched

- `apps/provider-gateway/src/modules/providers/anthropic/anthropic-provider.client.ts` — Bug 1: switched non-streaming `messages.create` → `messages.stream().finalMessage()`. Bug 2: new `sanitizeAnthropicStructuredOutputSchema` private method; wired into `toAnthropicOutputConfig`.
- `apps/provider-gateway/test/anthropic-provider.client.test.ts` — restubbed for `messages.stream` path; new tests for high `max_tokens`, schema sanitization (single-level and nested), no-mutation, empty-completion under new path. Sub-agent's `?.` reads switched to `!` non-null assertions where TS narrowed too aggressively after closure capture.
- `apps/provider-gateway/test/anthropic-empty-completion.test.ts` — fake client extended to expose both `stream` and `create`.
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md` — this entry.

### Risk

Low. The streaming-internal path is the SDK-documented long-form pattern (the error message in Bug 1 explicitly redirects to it); `finalMessage()` produces the same `Message` shape so all downstream parsing/usage/warn paths are unchanged. Schema sanitization is additive and only removes fields Anthropic was already rejecting; caller-side validators still enforce the same caps. Behaviour at small `max_tokens` (≤1024 default for routing / micro-description / failure-framing) is unchanged — the stream returns the full message just as `create` would have.

### Out-of-scope follow-ups

- **Founder owns**: bump `SANDBOX_RUNNING_JOB_GRACE_MS` from `15000` in `infra/helm/values-dev.yaml` and `infra/helm/values.yaml`. The 15-second stale threshold killed `tool=files` workspace operations at 23:08:25 and 23:09:25 during this incident (workspace-hydrate with stale-derivative cleanup can legitimately exceed 15 s). Founder said they would handle this directly.
- ADR-119 implementation work is paused; this hotfix did not touch ADR-119.

### Next recommended step

1. **Deploy provider-gateway** to `persai-dev` (selective pin, image tag from this commit) — no schema/migration changes, low-risk path. After rollout, observe Loki for the next 10 minutes: there should be ZERO new `Streaming is required` errors and ZERO `output_config.format.schema: For 'array' type, property 'maxItems' is not supported` errors. AutoExtractToMemoryService should start succeeding again (`[auto-extract] success`-style log, currently absent). BackgroundCompactionScheduler should stop entering `attempt N` retry chains for `code=provider_error`.
2. **Live re-test PDF in `nica` Telegram chat** with the founder's same prompt ("Собери подробный pdf"). Expected: real document delivery (no infinite "Запрос принят…" loop, no "Ассистент временно недоступен"). If the document worker fails for any non-Anthropic reason, the failure-framing LLM call should now succeed and produce an honest user-visible explanation.
3. **Then** founder bumps `SANDBOX_RUNNING_JOB_GRACE_MS` separately.
4. **Then** resume ADR-119 Slice 0 (architecture inventory) per the plan agreed in the prior turn.

---

## 2026-06-16 — ADR-118 post-deploy hotfix (skill state write-race: tool engage was being silently reverted by post-turn turnRouting echo)

### Root cause

Model successfully called `skill({action:"engage", skillId:"131c1531-...", scenarioKey:"instagram_carousel"})` (verified via Function Call in the user UI) and the tool returned `{action:"engaged", ...}`. But on the NEXT turn no `<persai_active_scenario>` developer block appeared. DB inspection (`assistant_chats.skill_decision_state` for the most recent chat) showed `{status:"inactive", activeSkillId:null, activeScenarioKey:null}` — i.e. the tool's persisted ACTIVE state was overwritten with INACTIVE between tool execution and the next turn.

Two writers on the same JSONB column inside one turn:

- **Writer 1 (correct, ADR-118 owner):** `RuntimeSkillToolService.executeEngageWithScenario` → POST `/api/v1/internal/runtime/skill/state` → `InternalRuntimeSkillStateService.apply` → `AutoSkillRoutingStateService.persistFromTurnRouting({turnRouting:{skillState:active}})` → DB becomes ACTIVE.
- **Writer 2 (stale echo, the bug):** turn-end pipeline → `complete-web-post-runtime-turn.persistWebTurnSkillStateAndQueueBackgroundCheck` → `AutoSkillRoutingStateService.persistFromTurnRouting({turnRouting: runtimeResponse.turnRouting})`. Post-Slice-6 `TurnRoutingService` always echoes back `request.skillStateContext.decision` as `routeDecision.skillState` (every code path: `skillState: currentSkillDecision` — line 565, 615, 653, 677, 694, 725, 746, 762). That echo is the snapshot from turn START (before the tool ran), i.e. INACTIVE. Writer 2 fires AFTER writer 1, overwriting ACTIVE → INACTIVE.

### Fix

Split the write surface into two methods with explicit, non-overlapping roles in `auto-skill-routing-state.service.ts`:

- `persistFromTurnRouting({chatId, turnRouting})` is now **strictly read-only** and returns `readChatSkillState(chatId)` (the freshest DB value, which the tool may have just written). It exists only to feed `engagementSummary` derivation in the post-turn flow.
- New `persistDecisionState({chatId, nextState})` is the **single authoritative writer**. It does the row write + `skillRetrievalStateService.clearForChatWhenSkillMismatches` in one logical step.

`InternalRuntimeSkillStateService.apply` (the `/internal/runtime/skill/state` handler) switched from `persistFromTurnRouting({turnRouting:{skillState:next}})` to `persistDecisionState({chatId, nextState:next})` for both `engage` and `release` paths. The `persistDecisionIfChanged` / `shouldPersistSkillDecisionState` / `extractDecisionStateFromTurnRouting` orchestration that compared current vs next was deleted along with the write path — no need for "did it change" gating when the tool always passes a deliberate target state.

### Test changes

`apps/api/test/auto-skill-routing-state.service.test.ts` rewritten to lock in the new invariants:

- `persistFromTurnRouting` produces ZERO writes even when `turnRouting.skillState` disagrees with the DB (was: would have written the stale echo).
- `persistFromTurnRouting` returns the current DB state regardless of what `turnRouting.skillState` says.
- `persistDecisionState` writes the new state AND calls `clearForChatWhenSkillMismatches` with the correct `activeSkillId` (the new active one on engage, `null` on release).
- After a tool engage write, a subsequent `persistFromTurnRouting` call with a stale inactive echo still returns the active state from DB (the regression scenario, now locked).

`apps/api/test/internal-runtime-skill-state.controller.test.ts`, `apps/api/test/send-web-chat-turn.service.test.ts`, `apps/api/test/stream-web-chat-turn.service.test.ts`: unchanged (they mock the service interface — only the implementation changed).

### DB seeding (separate from the fix, same session)

Per user request earlier in the session, 3 marketer SkillScenario rows seeded directly via a one-shot `kubectl exec`'d Prisma script into `persai-dev` DB:

- Skill: Маркетолог `131c1531-5566-4ad2-9422-3b9b76f6d666` (category=work)
- `instagram_carousel` (order=100), `content_plan_monthly` (order=200), `landing_audit` (order=300) — all `status="active"`
- `configDirtyAt = NOW()` bumped on the 2 assistants that have the marketer Skill assigned, so the next turn rematerializes the bundle and the scenarios reach the cache prefix catalog
- Temp scripts in `%TEMP%` and pod `/tmp` were deleted after run; nothing committed

### Cache prefix invalidation

None. This fix is a behaviour change in the API write path only; cache prefix bytes unchanged.

### Gate green

lint PASS · format:check PASS · api typecheck PASS · web typecheck PASS · `auto-skill-routing-state.service.test.ts` PASS · `internal-runtime-skill-state.controller.test.ts` PASS · `send-web-chat-turn.service.test.ts` PASS (11/11) · `stream-web-chat-turn.service.test.ts` PASS (14/14).

### Files touched

- `apps/api/src/modules/workspace-management/application/auto-skill-routing-state.service.ts` — split write path: `persistFromTurnRouting` becomes read-only; new public `persistDecisionState`; deleted `persistDecisionIfChanged`, `shouldPersistSkillDecisionState`.
- `apps/api/src/modules/workspace-management/application/internal-runtime-skill-state.service.ts` — switched both engage and release branches to `persistDecisionState`; deleted the misleading `persistFromTurnRouting writes ... in one atomic step` comment.
- `apps/api/test/auto-skill-routing-state.service.test.ts` — rewritten around new invariants.
- `docs/CHANGELOG.md`, `docs/SESSION-HANDOFF.md` — this entry.

### Risk

Low. Tool-driven write path was already the only one carrying new information; the deleted write path was always a stale echo (proven: `TurnRoutingService` produces `routeDecision.skillState` exclusively from `currentSkillDecision = request.skillStateContext.decision`, no derived state, no classifier output to feed back). The two streaming/non-streaming web turn handlers still call `persistFromTurnRouting` for the engagement-summary read-through, which now returns the freshest DB value instead of echoing the runtime snapshot — net behavior is identical when no tool fires, correct when a tool fires.

### Next recommended step

User retests: turn 1 engages a scenario via the `skill` tool → turn 2's provider call should now contain the `<persai_active_scenario>` developer block. If still broken after deploy, check (1) bundle rematerialization actually ran for the assistant (`configDirtyAt` cleared, `scenarios[]` present in bundle), (2) DB shows `activeSkillId + activeScenarioKey` non-null after engage. The `inspect-skill-state.js` pattern from this session can be reused.

---

## 2026-06-16 — ADR-118 post-Slice-7 production hotfix (Skill ID rendering + selection-guide expansion + `routingExamples` Slice-6 residual cleanup + Clerk middleware admin scenarios registration)

### Root cause

Production caught the model passing `skillId: "Диетолог"` (display name) and `skillId: "1"` (random) to `skill({action:"engage", ...})` and getting `skill_not_enabled`. `renderSkillCard` in `enabled-skills-prompt-materialization.ts` never rendered `card.id`; the tool description told the model "Must be one of the Skill ids listed in the Enabled Skills block" but the block contained no IDs.

### Scope

**A. Skill ID rendering**

- `apps/api/.../enabled-skills-prompt-materialization.ts`: each card now starts with `- Skill ID: ${card.id}` then `- Display name: ${card.name}` (renamed from `- Skill:`). Section intro explicitly tells the model `Skill ID` is the EXACT opaque identifier to pass as `skillId`.
- `apps/api/test/enabled-skills-prompt-materialization.test.ts`: regression — `assert.match(block, /- Skill ID: accounting/)` + `Display name:` + intro phrase.
- `apps/web/app/admin/presets/page.tsx`: `skill_cards_block` sample preview updated (`- Skill ID: skl_accounting_demo`, `- Display name: Accountant`).

**B. Selection-guide `## Skills` section expanded**

- `apps/api/prisma/bootstrap-preset-data.ts`: replaced single prose paragraph with concrete trigger logic — points the model at `# Enabled Skills` block as source of truth, forbids substituting display name / category, gives `scenarioKey: "instagram_carousel"` example, references engage and release signatures.
- `apps/runtime/test/native-tool-projection.test.ts` (ADR-117 golden): 4 old `**Skills.**` assertions replaced with 7 new ones for the expanded section.

**C. Slice 6 ledger-gap follow-up — `routingExamples` removal**

- `routingExamples` was a derived field (`card.examples.slice(0, 2)`) populated in materialization and parsed into `EnabledSkillSummary` in `turn-routing.service.ts`, but never read post-Slice-6 (sole consumer was the deleted `hasSkillLexicalMatch`).
- Removed from: `AssistantRuntimeEnabledSkillSummary` (runtime-bundle), `materialize-assistant-published-version.service.ts:1004` derive, local type in `turn-routing.service.ts:39+1383`, plus 3 test fixture files (`turn-routing.service.test.ts` 5 occurrences, `turn-execution.service.test.ts` 2 occurrences).
- Grep audit: 0 active-code matches for `routingExamples` in `apps/` and `packages/`.

**D. Clerk middleware admin scenarios registration (Slice 3 follow-up, production-blocking)**

- `IdentityAccessModule.configure(consumer)` uses **explicit per-route registration** for `ClerkAuthMiddleware.forRoutes(...)` — every API route needing `req.resolvedAppUser` must be enumerated.
- Slice 3 added 5 new scenario controller routes (`@Get/@Post/@Patch/@Delete` under `/api/v1/admin/skills/:skillId/scenarios[/:scenarioKey]`) but never updated the middleware registration. Result: API received the request, middleware did not run, `req.resolvedAppUser === undefined`, controller threw `UnauthorizedException("Authenticated user context is missing.")`.
- Fix: added 5 paths to `apps/api/src/modules/identity-access/identity-access.module.ts`.
- Guardrail: 5 new `hasRoute` assertions added to `apps/api/test/identity-access.module.test.ts` so any future scenario route surfaces this gap before merge.

### Cache prefix invalidation

One deliberate one-time invalidation covers all three changes (intro line + per-card Skill ID line + `## Skills` selection-guide section).

### Gate green

lint PASS · format:check PASS · 5 typechecks PASS · api test PASS · runtime test PASS (ADR-117 golden expanded) · web test PASS (777/777) · provider-gateway test PASS.

### Next step

After this hotfix lands on dev, validate that the model engages skills correctly with the real skillId (Диетолог-style intent → `skill({engage, skillId: <opaque cuid>})` → state persists → annotation appears). If green, proceed to ADR-118 Slice 8 (ADR closure + golden invariant tests + docs). User has parked a follow-up discussion about importing `msitarzewski/agency-agents` content as PersAI Skill+Scenario seed material.

---

## 2026-06-16 — ADR-118 Slice 7 landed — UX engagement indicator + selection-guide rule

### Scope

**A. Runtime-contract / Domain type extension**

- `packages/runtime-contract/src/index.ts`: `RuntimeSkillDecisionState` + `activeScenarioDisplayName: string | null`.
- `apps/api/.../domain/assistant-chat.entity.ts`: `AssistantChatSkillDecisionState` + `activeScenarioDisplayName`.
- `apps/api/.../infrastructure/persistence/prisma-assistant-chat.repository.ts`: `parseSkillDecisionState` includes the new field.
- `apps/api/.../application/web-chat-turn-attempt.service.ts`: `parseSkillDecisionState` includes the new field.

**B. Internal skill state service / routing service**

- `auto-skill-routing-state.service.ts`: `createInactiveSkillDecisionState` factory, `normalizeDecisionState`, and `shouldPersistSkillDecisionState` all include `activeScenarioDisplayName`.

**C. API projection / types**

- `web-chat.types.ts`: inline `skillDecisionState` shapes updated; `AssistantWebChatEngagementSummary` interface + `deriveEngagementSummary` helper added; `AssistantWebChatTurnState` extended with `engagementSummary?`.
- `assistant-runtime.facade.ts`: inline `skillState` shape updated.
- `send-web-chat-turn.service.ts`: derives and includes `engagementSummary` on turn completion.
- `stream-web-chat-turn.service.ts`: derives and includes `engagementSummary` on `turn_completed` SSE event.

**D. Web hook + component**

- `use-chat.ts`: `ChatMessage.engagementSummary` field; `onCompleted` extracts from transport payload.
- `chat-message.tsx`: `WorkingTextBlocks` gains `engagementSummary` prop; annotation renders inline to the right of the toggle — `<span data-testid="engagement-annotation">`, classes `flex min-w-0 items-center text-sm leading-relaxed text-text-subtle/60`, skill name with `shrink-0 whitespace-nowrap`, scenario with `truncate`, `·` separator, null = nothing.

**E. Selection-guide rule**

- `apps/api/prisma/bootstrap-preset-data.ts`: Skills rule added after `## Files`, before `## Deferred media honesty`. Deliberate one-time cache prefix invalidation.

**F. Tests**

- `apps/api/test/engagement-summary.derivation.test.ts` (new): 7 cases for `deriveEngagementSummary`.
- `apps/web/app/app/_components/chat-message.test.tsx`: 6 new engagement annotation cases (skill-only, skill+scenario, absent-null, absent-undefined, same-row structural, not-in-block-body).
- `apps/runtime/test/native-tool-projection.test.ts`: 4 new ADR-118 Slice 7 assertions for the Skills rule.
- `apps/api/test/auto-skill-routing-state.service.test.ts`: `activeScenarioDisplayName` added to all `RuntimeSkillDecisionState` fixtures.
- `apps/api/test/send-web-chat-turn.service.test.ts`: `activeScenarioDisplayName: null` in `skillDecisionState` mock.
- `apps/runtime/test/build-active-scenario-block.service.test.ts`: all `RuntimeSkillDecisionState` fixtures updated.
- `apps/runtime/test/turn-execution.service.test.ts`: 3 `RuntimeSkillDecisionState` fixtures updated.
- `apps/runtime/test/turn-routing.service.test.ts`: 3 `RuntimeSkillDecisionState` fixtures updated.

### Deviations / notes

- `engagementSummary` is derived from `skillDecisionState` in the same turn-completion path (both streaming SSE and non-streaming). Historical messages loaded via history API carry the `engagementSummary` if the field was stored in the turn state at commit time — no separate DB column change needed (JSON field additive).
- The `WorkingTextBlocks` component did not previously have a slot for annotations — the flex row was added as a new structural container wrapping both the toggle button and the new annotation span.
- `bootstrap-preset-data.ts` cache prefix change is deliberate and noted here as the one-time Slice 7 invalidation.

### Status

- **Not committed, not deployed.** Deploy expected BEFORE Slice 8.

### Verify gate

- lint PASS; format:check PASS; runtime-contract typecheck PASS; api typecheck PASS; web typecheck PASS; runtime typecheck PASS; provider-gateway typecheck PASS; api test PASS (exit 0); runtime test PASS (ADR-117 golden test passes); web test PASS (777/777); provider-gateway test PASS (exit 0).

### Next recommended step

- **Deploy Slice 7** (Slices 1–7 uncommitted; entire Slice 1–7 stack ships together).
- **ADR-118 Slice 8** (ADR closure + golden invariant tests) — after deploy confirmation.

---

## 2026-06-16 — ADR-118 Slice 6 landed — full dead-code sweep (classifier / cadence / HTTP route / lexical-gate stack)

### Scope — Phase 1 (classifier / HTTP route / caller chain)

- **`skill-state-routing.service.ts` deleted** (runtime): entire `SkillStateRoutingService` class — `SKILL_STATE_OUTPUT_SCHEMA`, `tryForegroundActivation`, `shouldTryForegroundActivation`, `matchesSkillLexically`, `checkSkillState`, all private helpers. ~441 lines gone.
- **`skill-state-routing.service.test.ts` deleted** (runtime test): ~165 lines.
- **`turns.module.ts`** (runtime): removed `SkillStateRoutingService` import, provider entry, and export entry.
- **`turns.controller.ts`** (runtime): removed `POST skill-routing-check` handler + `RuntimeSkillStateCheckResult` import.
- **`turn-execution.service.ts`** (runtime): removed `SkillStateRoutingService` import and constructor parameter; deleted `checkSkillRouting` method; removed `"checkSkillRouting"` from `assertSupportedTurnRequest` operation union.
- **`web-runtime-turn-client.service.ts`** (API): deleted `checkSkillRouting` method + `isRuntimeSkillStateCheckResult` helper.
- **`auto-skill-routing-state.service.ts`** (API): deleted `persistFromSkillCheckResult` (dead — no production callers after Slice 1).
- **`runtime-contract/src/index.ts`**: deleted `RuntimeSkillStateCheckResult` interface.
- Tests: `turn-execution.service.test.ts` (4 `SkillStateRoutingService` constructor args removed), `auto-skill-routing-state.service.test.ts` (2 `persistFromSkillCheckResult` blocks deleted), `send-native-web-chat-turn.service.test.ts` (1 whole test case deleted), `stream-web-chat-turn.service.test.ts` (mock updated).

### Scope — Phase 2 (lexical-gate residuals — ledger-gap batch)

Orchestrator audit found 10 methods in `turn-routing.service.ts` that the Slice 0 ledger missed (different names, not `matchesSkillLexically`). All 10 deleted:

- `resolveActiveAutoSkill` — reads `skillStateContext.decision`; inlined as direct state check at callsite.
- `carryForwardAutoSkillState` — trivial pass-through; inlined as `input.request.skillStateContext?.decision ?? null`.
- `shouldReuseActiveSkill` — carry-forward heuristic (lexical gate + short-follow-up check); replaced by `if (activeAutoSkill)` (trust the persisted state, no lexical fanfare).
- `buildSkillRoutingMatchText`, `hasSkillLexicalMatch`, `buildSkillRoutingTerms`, `tokenizeForSkillRouting`, `skillRoutingStems` — the exact lexical gate stack.
- `createAutoSkillStateOnClassifierFailure` — cadence-era failure synthesizer; callers now pass through `input.request.skillStateContext?.decision ?? null`.
- `buildTopicSummary` — only used by `createAutoSkillStateOnClassifierFailure`; deleted. `topicSummary` field kept on `RuntimeSkillDecisionState` (Slice 2 state-passthrough may write it via the `skill` tool response; separate cleanup if unused).

Additional cleanup driven by the method deletions:

- **`RuntimeSkillStateContext` simplified** (`packages/runtime-contract/src/index.ts`): `recentMessages`, `currentUserMessageIndex`, `forceCheck` fields removed (all dead after the 10-method deletion). `RuntimeSkillRoutingRecentMessage` type deleted.
- **`buildRuntimeContext` collapsed** (`auto-skill-routing-state.service.ts`): was async + 2 DB queries (count user messages + fetch up to 30 recent rows). Now synchronous one-liner `return { decision: input.decisionState }`. `selectRecentRoutingRows` private helper deleted. Constants `MAX_RECENT_ROUTING_MESSAGES` and `MAX_RECENT_ROUTING_USER_TURNS` deleted. Callers in `send-web-chat-turn.service.ts` + `stream-web-chat-turn.service.ts` updated from `await buildRuntimeContext` to synchronous call.
- **`driftRecheckDecision` test deleted** (`turn-routing.service.test.ts`) — tested `forceCheck: true` forcing a drift-detection re-check; behavior gone by design (model releases via `skill` tool now).
- `turn-routing.service.test.ts`, `turn-execution.service.test.ts`, `send-web-chat-turn.service.test.ts`, `stream-web-chat-turn.service.test.ts`: `currentUserMessageIndex`, `recentMessages`, `forceCheck` removed from `skillStateContext` constructions in tests.

### Deviations from ADR / ledger

- **Ledger gap identified and closed**: Slice 0 ledger missed the 10 lexical-gate methods in `turn-routing.service.ts` because they were named differently from `matchesSkillLexically`. Orchestrator audit caught them; all 10 deleted in the same sweep.
- `topicSummary` field kept on `RuntimeSkillDecisionState` — nothing writes it server-side now, but the Slice 2 `skill` tool state-passthrough may still carry a value set by the model-owned engage call. Separate cleanup if confirmed dead.
- `persistWebTurnSkillStateAndQueueBackgroundCheck` function name kept — name is now misleading (background check removed Slice 1; only persists state now), but not in required-zero list. Separate refactor.

### Status

- **Not committed, not deployed.** Orchestrator handles git closure.

### Verify gate

- lint PASS; format:check PASS; runtime typecheck PASS; api typecheck PASS; web typecheck PASS; provider-gateway typecheck PASS; runtime-contract typecheck PASS; runtime test PASS (exit 0); api test PASS (exit 0); provider-gateway test PASS (exit 0); web test PASS (772/772).

### Grep audit (required-zero in apps/ + packages/)

All 26 required-zero symbols return 0 active-code matches (first 15 from Phase 1, last 11 from Phase 2):
`matchesSkillLexically`, `tryForegroundActivation`, `shouldTryForegroundActivation`, `runBackgroundCheck`, `markBackgroundCheckQueued`, `markBackgroundCheckFailed`, `messageCountSinceCheck`, `backgroundCheckQueuedAtMessageIndex`, `skillCadenceState`, `RuntimeSkillCadenceState`, `DEFAULT_SKILL_ROUTING_`, `checkSkillState`, `checkSkillRouting`, `skill-routing-check`, `SkillStateRoutingService`, `hasSkillLexicalMatch`, `buildSkillRoutingTerms`, `tokenizeForSkillRouting`, `skillRoutingStems`, `buildSkillRoutingMatchText`, `shouldReuseActiveSkill`, `resolveActiveAutoSkill`, `carryForwardAutoSkillState`, `createAutoSkillStateOnClassifierFailure`, `buildTopicSummary`.

### Next recommended step

- **Slice 7** — UX engagement indicator (quiet Skill/Scenario annotation in the `:::working` block header row, to the right of the `Выполнено ▾` toggle) + one additive `skill` tool selection-guide rule line contributed to the ADR-117 canonical `tools` template (guarded by ADR-117 golden test). See ADR-118 Slice 7 plan.

## 2026-06-16 — ADR-118 Slice 5 landed (admin UI for SkillScenario authoring)

### Scope

- **Inline Scenarios section on Skill admin page** (`apps/web/app/admin/skills/page.tsx`): co-located below the existing Skill editor with fetch, list (ordered by `displayOrder`), status badges (draft/active/archived), archived-toggle, Create + Edit + Activate + Archive + Reactivate actions. Choice: inline expansion (not drill-in route) because the Skills page already uses expandable row sections and the user should not navigate away from the Skill editing context.
- **Scenario editor form** with full D3 field set: `key` (slug-regex validated, readonly after create), `displayName.{ru,en}`, `description.{ru,en}`, `iconEmoji`, `displayOrder`, `status`, `intentExamples` (up to 10), `recommendedTools` (checkboxes, hardcoded `NATIVE_SCENARIO_TOOL_KEYS` = `["image_generate","image_edit","video_generate","knowledge_search","memory_write","files","scheduled_action","background_task","skill"]` — no existing constant in codebase), `exitCondition`, structured `steps` editor with auto-number, `directive`, `recommendedToolCall` dropdown, `mayBeSkippedIf`, `negativeGuards`, up/down reorder, add/delete.
- **Inline validation**: `key` regex, at least one step, non-empty `directive` per step, soft yellow warning if last step misses `skill({` or `release`.
- **Live preview panes** (300 ms debounce): Pane A "Catalog rendering" matches `enabled-skills-prompt-materialization.ts` format with `ru`/`en` toggle; Pane B "Active Scenario developer block" matches `BuildActiveScenarioBlockService` output (formatting duplicated in `renderActiveScenarioBlockPreview` with comment to source file — service's private renderer was not extractable without changing runtime code).
- **API integration**: orval-generated `getAdminSkillScenarios`, `postAdminSkillScenario`, `patchAdminSkillScenario`, `deleteAdminSkillScenario` called directly from `@persai/contracts` with Bearer token; optimistic local state + refetch on success, error display on failure.
- **Tests** (`apps/web/app/admin/skills/page.test.tsx`): 10 new cases covering round-trip draft, payload shapes, validation blocking, `renderActiveScenarioBlockPreview`, `renderScenarioCatalogLine`, soft warning, `NATIVE_SCENARIO_TOOL_KEYS` membership. Total web suite now 772 tests.

### Deviation from ADR

- None. Inline expansion chosen (ADR was flexible on inline vs drill-in). Preview formatter duplicated in the page module (Slice 4 service renderer is private — no change to runtime code). `NATIVE_SCENARIO_TOOL_KEYS` hardcoded — no central constant exists in the codebase.

### Status

- **Not committed, not deployed.** Orchestrator handles git closure.

### Verify gate

- lint PASS; format:check PASS; web typecheck PASS; api typecheck PASS; runtime typecheck PASS; api test PASS (exit 0); runtime test PASS (exit 0); web test PASS (772/772).

### Next recommended step

- **Slice 6** — Dead-code sweep: delete `SkillStateRoutingService`, `matchesSkillLexically`, `tryForegroundActivation`, `AutoSkillRoutingStateService` cadence helpers, cadence constants, `skillCadenceState` column (Prisma migration), `routerPolicy.skillRoutingPolicy` admin field. See ADR-118 Slice 6 plan and the inventory ledger `docs/ADR/118-skill-engagement-inventory.md` R9 extension for the full hit list.

## 2026-06-16 — ADR-118 Slice 4 landed (scenario catalog materialization + active-scenario volatile block)

### Scope

- **Bundle extension:** `RuntimeBundleSkillScenarioStep` + `RuntimeBundleSkillScenario` in `packages/runtime-contract/src/index.ts`. `AssistantRuntimeEnabledSkillSummary.scenarios?: RuntimeBundleSkillScenario[]` in `packages/runtime-bundle/src/index.ts`.
- **Materialization:** `materialize-assistant-published-version.service.ts` — new private `resolveEnabledSkillScenariosForBundle` method fetches `status: "active"` rows from `skill_scenarios` by `skillId`, converts to bundle shape with locale resolution. Scenarios injected into both prompt cards (for catalog rendering) and `runtimeBundleArtifact.skills.enabled[i].scenarios`.
- **Catalog rendering:** `enabled-skills-prompt-materialization.ts` extended to render `Available scenarios:` section per Skill card in the cached prefix. Exported constant `SCENARIO_CATALOG_RENDER_LIMIT = 8`. `... +N more` footer for overflow. Zero scenarios → section omitted entirely. New `resolveEnabledSkillScenariosForBundle` export. Updated `EnabledSkillPromptCard` + `EnabledSkillPromptCandidate` with `scenarios` field.
- **Volatile block:** new `BuildActiveScenarioBlockService` — when `activeScenarioKey !== null && activeSkillId !== null`, looks up scenario in bundle, renders `## Active Scenario` block per D4, returns `ProviderGatewayTextMessage` with `cacheRole: "volatile_context"` + `volatileKind: "active_scenario"`. Graceful degrade (null + log) if skill/scenario missing from bundle. Registered in `turns.module.ts`.
- **Turn assembly:** `TurnExecutionService.prepareTurnExecution` now calls `buildActiveScenarioBlockService.buildBlock` and prepends the active scenario message before the memory block (scenario first, memory second).
- **Volatile wrapper widening:** `ProviderGatewayTextMessage.volatileKind?: "memory" | "active_scenario"` added. Anthropic wraps `active_scenario` with `<active_scenario>` / OpenAI wraps with `<persai_active_scenario>`. Memory path (missing or `"memory"`) emits byte-identical strings to the old hardcoded literals → **no real cache invalidation for existing memory blocks** (R3 confirmed).
- **Skill tool:** `RuntimeSkillToolService` new `executeEngageWithScenario` method validates `scenarioKey` against bundle, returns honest `availableScenarios` in `scenario_not_found`, or persists and returns full `engaged` payload.
- **Tests:** `build-active-scenario-block.service.test.ts` (8 cases); `runtime-skill-tool.service.test.ts` extended (scenario happy-path + honest availableScenarios); `enabled-skills-prompt-materialization.test.ts` extended (catalog format, overflow footer, zero-scenario omit, locale resolution, byte-stability); provider-gateway tests extended (back-compat memory + new `active_scenario` wrappers for Anthropic + OpenAI).

### Deviation from ADR

- None. `volatileKind` added as Option A (field on `ProviderGatewayTextMessage`), consistent with the existing `cacheRole` pattern. Slice 2 test (d) comment updated from "Slice 2 honesty: always returns scenario_not_found" to "scenario_not_found when skill has no scenarios in bundle".

### One-time cache invalidation (R3)

The old volatile memory wrappers were hardcoded literals. The new parameterized path emits **byte-identical strings** when `volatileKind === "memory"` or `volatileKind` is absent. Confirmed in both Anthropic (same `<recent_short_memory>` tag + same outer preamble text) and OpenAI (same `<persai_contextual_memory>` tag + same preamble text). **No actual user-facing cache miss for existing memory blocks.** The new `<active_scenario>` / `<persai_active_scenario>` tags are net-new and will not invalidate any existing cached prefix.

### Status

- **Not committed, not deployed.** Orchestrator handles git closure.

### Verify gate

- prisma generate PASS; lint PASS; format:check PASS; api typecheck PASS; web typecheck PASS; runtime typecheck PASS; provider-gateway typecheck PASS; runtime-contract typecheck PASS; api test PASS; runtime test PASS; provider-gateway test PASS; web test PASS (762/762).

### Next recommended step

- **Slice 5** — Admin UI scenario editor: CRUD editor for `SkillScenario` entries in the workspace management admin interface. The entity, API, contracts, and runtime infrastructure are all in place. Slice 5 is purely admin UI (no backend changes expected beyond minor OpenAPI consumers).

## 2026-06-16 — ADR-118 Slice 3 landed (`SkillScenario` entity + admin API)

### Scope

- New Prisma model `SkillScenario` (table `skill_scenarios`), enum `SkillScenarioStatus`, migration `20260616140000_adr118_skill_scenario`. FK to `Skill(id)` CASCADE; unique `(skillId, key)`; index `(skillId, status, displayOrder)`.
- `skill-scenario.types.ts`: full parser/serializer for `AdminSkillScenarioState`, `CreateSkillScenarioInput`, `UpdateSkillScenarioInput`. Key regex `^[a-z][a-z0-9_]{1,63}$`. Required `ru`+`en` locales enforced.
- `ManageSkillScenariosService`: `listScenarios` (archived excluded by default), `getScenario`, `createScenario` (ConflictException on duplicate key), `updateScenario` (key immutable; status transitions `draft→active`, `active→archived`, `archived→active` enforced), `archiveScenario` (idempotent). Every mutation calls `markAssignedAssistantsDirty(skillId)`.
- 5 scenario routes added to `AdminSkillsController` (GET list, POST create, GET single, PATCH update, DELETE archive). DELETE returns 200 with archived state.
- `ManageSkillScenariosService` registered in `workspace-management.module.ts`.
- OpenAPI: 7 new schemas + 5 new paths; `contracts:generate` run.
- Tests: `manage-skill-scenarios.service.test.ts` + `admin-skill-scenarios.controller.test.ts`.

### Deviation from ADR

- ADR references `skill.entity.ts` / `skill.repository.ts` / `prisma-skill.repository.ts` — these files do NOT exist in the codebase. The existing Skills admin service uses `WorkspaceManagementPrismaService` directly. `ManageSkillScenariosService` follows the same direct-Prisma pattern (no separate domain entity/repository files).
- ADR named the dirty-marker `markAssistantsConfigDirtyForSkill`; actual name in codebase is `markAssignedAssistantsDirty(skillId)`.

### Status

- **Not committed, not deployed.** Orchestrator handles git closure. Slice 3 can deploy independently (additive table + API).

### Verify gate

- prisma generate PASS; contracts:generate PASS; lint PASS (all workspaces); api typecheck PASS; web typecheck PASS; runtime typecheck PASS; provider-gateway typecheck PASS; runtime-contract typecheck PASS; api test PASS (exit 0); runtime test PASS; web test PASS (762/762). format:check: 667 pre-existing failures in `packages/contracts/src/generated/` (orval output); 0 failures in newly-authored files.

### Next recommended step

- **Slice 4** — Materialization: scenario catalog in `Enabled Skills` block (cached prefix) + `## Active Scenario` volatile developer block composition in runtime turn assembly. Requires:
  1. Extend `enabled-skills-prompt-materialization.ts` to render `active` scenarios per Skill (`key + displayName + 1-line desc + recommendedTools hint`).
  2. Surface `bundle.skills.enabled[i].scenarios[]` in materialized runtime bundle so runtime can resolve `scenarioKey → steps` without extra round-trip.
  3. New service `build-active-scenario-block.service.ts` (or co-located): when `skillDecisionState.activeScenarioKey !== null`, compose `## Active Scenario` block as `ProviderGatewayTextMessage` with `cacheRole: "volatile_context"`.
  4. Wire into turn assembly at the volatile-context insertion point.
  5. Swap `scenario_not_found` stub in `RuntimeSkillToolService` (Slice 2) with real catalog validation against `bundle.skills.enabled[i].scenarios[]`.
  6. Widen volatile-context wrappers in provider clients for `active_scenario` kind (Slice 0 ledger R3).
  - High complexity; recommend strong subagent.

## 2026-06-16 — ADR-118 Slice 2 landed (`skill` tool)

### Scope

- New `skill` tool: tool catalog row (`apps/api/prisma/tool-catalog-data.ts`, `policyClass: "platform_managed"`), runtime-tool-policy execution mode + native-execution flag (`runtime-tool-policy.ts`), `createSkillToolDefinition` in `native-tool-projection.ts` (flat schema, byte-stable, omitted when no enabled Skills), `RuntimeSkillToolService` (`apps/runtime/src/modules/turns/runtime-skill-tool.service.ts`), `PersaiInternalApiClientService.updateSkillState` method, `InternalRuntimeSkillStateService` + `InternalRuntimeSkillStateController` (internal port 3002, `POST /api/v1/internal/runtime/skill/state`), wired into `TurnExecutionService` + `turns.module.ts`. Slice 2 always returns `scenario_not_found` for any `scenarioKey` (Slice 4 will fill in real scenario validation). Chat resolution in the API: runtime sends `assistantId + channel + surfaceThreadKey`; API resolves to `chatId` via `AssistantChatRepository.findChatBySurfaceThread`.
- Tests: `runtime-skill-tool.service.test.ts` (9 cases), `internal-runtime-skill-state.controller.test.ts` (7 cases), new assertions in `native-tool-projection.test.ts` (projected with enabled skills / absent without), assertion in `seed-tool-catalog.test.ts`.

### Why

- ADR-118 step 2 in the orchestrator slice plan. Restores Skill engagement after Slice 1 made the cadence/classifier path inert. Together Slices 1+2 must deploy atomically.

### Status

- **Not committed, not deployed.** Orchestrator handles git closure. Slice 2 must deploy together with Slice 1.

### Verify gate

- lint PASS; format:check PASS; api typecheck PASS; web typecheck PASS; runtime typecheck PASS; provider-gateway typecheck PASS; runtime-contract typecheck PASS; api test PASS; runtime test PASS.

### Next recommended step

- **Orchestrator closure:** commit Slices 1+2 together, deploy, verify Skill engagement works via the `skill` tool.
- **Slice 3** — `SkillScenario` Prisma entity + admin API (medium complexity).

## 2026-06-16 — ADR-118 Slice 1 landed (decision state + cadence persistence trim)

### Scope

- `RuntimeSkillDecisionState` reshape to `{status, activeSkillId, activeSkillName, activeScenarioKey, topicSummary}` (`confidence` + `checkedAtMessageIndex` removed). R1 inline re-declarations updated. R7 cadence column drop + atomic-writer fix (same commit). `AutoSkillRoutingStateService` cadence helpers deleted; persistence kept. Cadence constants + `routerPolicy.skillRoutingPolicy` removed from `platform-runtime-provider-settings`, OpenAPI, admin runtime UI, generated contracts. `SkillStateRoutingService` file preserved; turn-execution caller removed (classifier inert).
- 29 files modified + 6 generated models deleted + 1 new Prisma migration directory (`20260616120000_adr118_drop_skill_cadence_state`).

### Why

- ADR-118 step 1 in the orchestrator slice plan. Makes the old cadence/classifier path inert by data shape (column dropped, helpers gone, decision-state no longer carries cadence fields) so Slice 2's `skill` tool can land cleanly on a clean slate. Slice 1 is intentionally not standalone — between Slice 1 and Slice 2, Skill engagement is OFF.

### Status

- Committed locally. **Not deployed.** Slice 2 (`skill` tool) must land in the same deploy.

### Verify gate

- format:check PASS; lint PASS; api typecheck PASS; web typecheck PASS; api test PASS; runtime test PASS. Web suite has one pre-existing `use-chat.test.tsx` resume-polling flake that passes when run in isolation — diff in `use-chat.ts` is shape-only (3 lines), unrelated to the flaky test. Migration regenerates `assistant-chats.skill_cadence_state` removal; Prisma client regenerated.

### Next recommended step

- **Slice 2 (`skill` tool)** — high complexity, must land in the same deploy. New tool catalog row, native projection, runtime service (`apps/runtime/.../runtime-skill-tool.service.ts`), internal API endpoint that flips the decision row in `assistant_chats.skill_decision_state` (reuses kept `AutoSkillRoutingStateService` persistence helpers from this slice), error paths. Subagent model: GPT-5.4 or Sonnet (not Opus per user instruction).

## 2026-06-15 — HOTFIX: runtime-contract startup crash (ADR-117 Slice 3 regression)

- **Symptom:** after pushing the ADR-117 + media work (`260837c2`), the dev rollout crash-looped new `api` and `runtime` pods (`api-6f6857f7d`, `runtime-78dc88bc64`) with `ERR_MODULE_NOT_FOUND: .../runtime-contract/src/media-prompt-fragments` imported from `index.ts`. Old pods kept serving, so dev stayed up.
- **Root cause:** Slice 3's `export … from "./media-prompt-fragments"` was the first relative import in the contract package, which is consumed as **un-built TS source** (`main` → `src/index.ts`, no build). Node 22 type-stripping ESM cannot resolve an extensionless relative specifier; `.ts` extension fails the emit typecheck (TS5097); no `.js` sibling exists.
- **Fix:** inlined the fragments directly into `packages/runtime-contract/src/index.ts` and deleted the sibling file → package back to a single self-contained module. Zero consumer-import changes (all already import from `@persai/runtime-contract`). Golden single-source test re-anchored to `index.ts`. Docs (`API-BOUNDARY`, `ARCHITECTURE`, `TEST-PLAN`, ADR-117 closure) updated.
- **Verify gate:** runtime-contract typecheck, **api emit build**, runtime+gateway typecheck, lint, golden single-source + projection test all green. Next: push → confirm rollout pods go Ready.

## 2026-06-15 — ADR-118 opened: Skill scenarios + model-owned activation

### Scope

- New OPEN program ADR: `docs/ADR/118-skill-scenarios-and-model-owned-activation.md`. Authored after ADR-117 entered closure mode (ADR-117 Slices 1-5 + hotfix landed; golden invariant test in place). Adds a new product concept (`SkillScenario`) and replaces hidden Skill activation (classifier + cadence + lexical-gate) with model-owned activation via a single `skill` tool. Slice 7 of ADR-118 contributes one additive rule line to the canonical `tools` selection guide guarded by the ADR-117 golden test (the same slice updates that golden test to accept the new Skills line).

### Why

- Three concrete failure modes today: (F1) activation latency/miss — foreground `matchesSkillLexically` substring gate refuses if Skill metadata doesn't literally contain user keywords; background classifier runs every 5 user messages with first check after the 3rd, so even when it activates it's at minimum 5 turns late; (F2) Skills carry only static `instructionCard` + `SkillKnowledgeCard` — no concept of admin-authored workflows like "Instagram-карусель: 8 slides via image_generate series"; (F3) no visible signal of active Skill since the old banner was removed.

### Decision (summary)

- **Three-level engagement model:** Enabled (Settings) → Active (model decides) → Running scenario (model decides). Skills KB priority retrieval + cache key now driven by explicit model action, not hidden gate.
- **Single tool `skill({ action: "engage" | "release", skillId?, scenarioKey? })`** — covers activation, exit, scenario selection, scenario switch.
- **`SkillScenario` first-class DB entity** — admin-authored structured workflows (key, displayName, description, intentExamples, steps[], recommendedTools[], exitCondition, lifecycle draft/active/archived). Steps are structured records with `directive + recommendedToolCall (text hint, not a constraint) + negativeGuards + mayBeSkippedIf`.
- **Volatile developer block for active scenario** — uses existing `cacheRole: "volatile_context"` pattern (ADR-110, ADR-112 Slice 2). Cached system prefix stays byte-stable across engage/release.
- **UX indicator** — inline annotation in the `:::working` block header row, **to the right of the `Выполнено ▾` toggle** (NOT a line inside the block body): `Маркетолог · Instagram-карусель` for Skill + scenario, `Маркетолог` for Skill without scenario, nothing if no active Skill. Subdued color, single row, ellipsis on narrow widths. No banner, no chip, no line inside the body.
- **One additive line in ADR-117 `tools` selection guide** — Slice 7 adds the Skills engagement rule additively to the canonical guide, no second template.
- **Dead-code sweep mandatory** — `SkillStateRoutingService`, `matchesSkillLexically`, `tryForegroundActivation`, `AutoSkillRoutingStateService` cadence helpers, cadence constants, `skillCadenceState` column, `routerPolicy.skillRoutingPolicy` admin field — all deleted in Slice 6. No flag-gating, no compatibility shims.

### Execution

- 9 slices (0 inventory → 1 state shape + cadence persistence trim → 2 `skill` tool → 3 `SkillScenario` entity + admin API → 4 materialization (catalog + volatile block) → 5 admin UI editor → 6 dead-code sweep → 7 UX indicator + selection-guide rule → 8 golden tests + docs + closure). For orchestrator-driven execution: orchestrator assigns slices to subagents, audits diffs, does not write code. Complexity tags `low/medium/high` per slice for subagent model selection.
- **Slices 1 and 2 must land in the same deploy** (Slice 1 makes old cadence inert; Slice 2 restores activation through the new tool). Window between them must be minimal.

### Status

- ADR authored only. No code touched. Not deployed, not committed.

### Slice 0 landed (2026-06-15, baseline SHA 4a0baa39)

- Deliverable `docs/ADR/118-skill-engagement-inventory.md` produced by read-only subagent. 37 ledger rows (vs ADR-118's ~10 expected — subagent uncovered an additional 27 reachable callsites), 35/35 delete verdicts with proven reachability (every caller listed by file:line), 0 unproven. Sections 1-7 complete: heuristics inventory, keep verdicts, `Enabled Skills` block independence proof, volatile-context end-to-end trace through Anthropic + OpenAI clients, Slice 6 hit list, risks R1-R10, verification (lint + format:check PASS).
- Orchestrator audit: 4 spot-checks against real code (`matchesSkillLexically`, `DEFAULT_SKILL_ROUTING_*`, `volatile_context` provider clients, `checkSkillRouting` chain) all matched ledger claims with correct file:line.
- 4 of 10 ledger risks folded back into ADR-118 as actionable adjustments:
  - **R1 → Slice 1:** explicit update of inline re-declarations in `assistant-runtime.facade.ts:~L115` and `apps/web/.../use-chat.ts:~L158` (not flowed by contract regen alone).
  - **R3 → Slice 4:** volatile-context wrappers currently memory-specific (`<recent_short_memory>` / `<persai_contextual_memory>`); Slice 4 widens them with a `volatileKind` parameter (`memory` → existing wrapper, `active_scenario` → `<active_scenario>`). One additional one-time deliberate cache invalidation for the memory wrapper bytes — explicitly logged.
  - **R7 → Slice 1:** `manage-admin-skills.service.ts:~L678-680` and `manage-assistant-skills.service.ts:~L172-175` both write `skillCadenceState` atomically with the decision row; Slice 1 must drop those writes in the **same commit** as the column drop, or Prisma fails with `Unknown field`.
  - **R9 → Slice 6:** ADR-118 originally underspecified — Slice 6 hit list now explicitly enumerates the `POST /api/v1/turns/skill-routing-check` route, `TurnExecutionService.checkSkillRouting`, `WebRuntimeTurnClientService.checkSkillRouting`, and downstream callers in three `*-web-chat-turn.service.ts` files.
- R2, R4, R5, R6, R8, R10 already covered by ADR or are cosmetic / docs-closure work (R4 lands in Slice 8).

### Next recommended step

- Execute **Slice 1 + Slice 2 together (same deploy)**. Slice 1 = state shape migration + cadence persistence trim + admin field removal + inline re-declarations updated (medium complexity, prefer strong subagent — Prisma migration + contract regen + 2 atomic writer-fixes + admin runtime trim). Slice 2 = the new `skill` tool (high complexity, requires strong subagent — new tool catalog row, native projection, runtime service, internal API endpoint, error paths). The two must land in the same deploy because Slice 1 leaves activation inert (old cadence stopped, new tool not yet shipped) and Slice 2 restores it.

## 2026-06-15 — ADR-117 opened: tool-instruction source-of-truth (Мир 2)

### Scope

- New OPEN program ADR: `docs/ADR/117-tool-instruction-source-of-truth-and-native-tool-runtime-selection-guide.md`. Governs Мир 2 only (which tool / when / how the provider renders), not the persona/system prefix (Мир 1, already clean).

### Why

- Model misfires on tool selection: instructions scattered across 4+ layers, media provider-prose duplicated 3×, and at least one factual drift (catalog tells the model to read `action="deferred"` but the real result is `action="pending_delivery"`; legacy `"deferred"` survives only in `turn-execution.service.ts:~5176`).

### Decision (summary)

- Three concerns, one source each: (1) WHICH/WHEN → Native Tool Runtime **selection guide** = the DB `tools` system-prompt block; (2) WHAT+params → tool descriptor (catalog → policy → projection); (3) HOW provider renders → one provider-conditioning constants module (runtime composers + gateway builders share it, model never re-reads it).
- Reconcile every instruction against real code; delete drift + dead paths (legacy `buildRuntimeToolPoliciesMarkdown`, ghost strippers — prove reachability first).

### Execution

- 6 slices (0 inventory → 1 selection guide → 2 catalog consolidation → 3 provider constants → 4 dead-code sweep → 5 golden tests/docs/closure). Intended for Sonnet subagents; each slice self-contained with its own verification gate. Additive-first to avoid leaving the model with less guidance mid-program.

### Status

- ADR authored. **Slice 0 done** (`docs/ADR/117-tool-instruction-inventory.md` — inventory + reconciliation ledger). **Slice 1 done** (selection guide). **Slice 2 done** (catalog consolidation + `agents` reduction). **Slice 3 done** (provider-conditioning constants module). **Slice 4 done** (dead-code & drift sweep). **Slice 5 done — program complete (deploy pending).** Not deployed, not committed.

### Slice 1 landed (Native Tool Runtime selection guide)

- `apps/api/prisma/bootstrap-preset-data.ts`: `tools` default replaced with the ~36-line cross-tool selection guide (images/vision, knowledge-web local-first, document, memory/tasks, files alias-first + delivery honesty, "call don't narrate", `pending_delivery` honesty). No param mechanics, no provider-conditioning prose (those stay in descriptor / Slice 3 constants).
- `apps/web/app/admin/presets/page.tsx` (+ `page.test.tsx`): `tools` block relabeled "Native Tool Runtime — Selection Guide"; removed stale `tools_catalog_block` variable chip; test asserts new label/description + chip absence (6/6 pass).
- **Additive-first respected:** `tool-catalog-data.ts` and `agents` template untouched.
- Gate green: lint, format:check, api+web+runtime typecheck, seed/compile/tool-policy + presets page tests.

### Slice 2 landed (catalog consolidation + agents reduction)

- **A1 — drift fix:** `image_generate`, `image_edit`, `video_generate` catalog `modelUsageGuidance`: `action="deferred"` → `action="pending_delivery"` (ledger R1). No model-facing `"deferred"` remains anywhere.
- **A2 — selection sentences removed:** dropped S4/S5 from `image_generate`, S7 from `image_edit`, S9/S10/S11 from `video_generate`, S13 from `web_search`, S14 from `web_fetch`, S15 from `scheduled_action`, S16 from `background_task`. Each replaced with short mechanical guidance where field would otherwise be empty.
- **A4 — multi-reference fix:** `image_edit.modelUsageGuidance` updated from singular `referenceImageAlias` to `referenceImageAliases` (plural, up to 15), matching the multi-ref API. "Ask instead of guessing" instruction retained.
- **A5 — files comment:** `files.modelUsageGuidance` annotated "policy-overridden: real model text comes from `runtime-tool-policy.ts` `resolveRuntimeToolUsageGuidance`".
- **B — agents reduction:** `agents` template reduced from "Memory and Task Governance" + Tasks Policy to "Memory Policy" only (4 bullets). Tasks selection now lives solely in the `tools` guide (Slice 1).
- **C — projection fallback:** `createScheduledActionToolDefinition` fallback updated: "Use background_task for assistant-side conditional checks." removed (duplicated S15).
- **D — admin UI:** `PRESET_META.agents` label → "Memory Policy"; description updated to reflect Memory Policy only. `agents_block` hint updated.
- **Prompt-cache note:** this slice changes the seeded `agents` default → another deliberate one-time prompt-cache prefix invalidation on rollout (next materialization will pick it up). Not deployed; not committed.
- Gate green: lint, format:check, api+web+runtime typecheck, api+runtime+web tests all pass.

### Additive-first proof (Slice 2)

| Removed sentence (ledger)                                                | Guide section that now owns it                                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| S4 image_generate "not for editing/video"                                | Selection Guide §Images: "Create/generate → `image_generate`; Modify/edit → `image_edit`; Animate → `video_generate`" |
| S5 image_generate "call immediately / never narrate"                     | Selection Guide: "call the tool immediately — never print a fake call…"                                               |
| S7 image_edit "do not use for description/OCR"                           | Selection Guide §Images: "Describe/analyze → answer from vision; do NOT call an image tool"                           |
| S9 video_generate "use only for generated video/animation"               | Selection Guide §Images: "Animate or create a short video clip → `video_generate`"                                    |
| S10 video_generate "do not use for editing/image questions"              | Selection Guide §Images: mutual exclusion with image_edit + vision                                                    |
| S11 video_generate "call immediately / never narrate"                    | Selection Guide: global "call immediately" rule                                                                       |
| S13 web_search "when you need sources/links"                             | Selection Guide §Knowledge & Web: "need sources or links without an exact URL → `web_search`"                         |
| S14 web_fetch "when you already know the exact URL"                      | Selection Guide §Knowledge & Web: "know the exact URL → `web_fetch`"                                                  |
| S15 scheduled_action "do not use for hidden checks; use background_task" | Selection Guide §Memory & Tasks: "Conditional check → `background_task`"                                              |
| S16 background_task "`scheduled_action` is only for reminders"           | Selection Guide §Memory & Tasks: "Simple unconditional reminder → `scheduled_action`"                                 |

### Slice 3 landed (provider-conditioning constants module)

- **Canonical fragments (in `packages/runtime-contract/src/index.ts`):** `ANTI_COLLAGE_RULE`, `STANDALONE_IMAGE_RULE`, `STANDALONE_GENERATED_IMAGE_RULE`, `STANDALONE_EDITED_IMAGE_RULE`, `referenceGuidanceRule({ multiple })`, `seriesItemHeaderLine(index,total)`. Placed in the shared contract package (not runtime-local) because `@persai/provider-gateway` is a separate package and must reference the exact same strings — true single-source. NOTE: originally a sibling `media-prompt-fragments.ts`, but folded into `index.ts` by the 2026-06-15 hotfix (un-built-source runtime constraint — see below).
- **Consumers refactored:** runtime `runtime-image-generate-tool.service.ts` + `runtime-image-edit-tool.service.ts` composers, and gateway `openai-provider.client.ts` (`generateImage` count>1, `buildImageEditPrompt`) now import the fragments. Provider semantics unchanged (wording unified to the most complete variant; `seriesItemHeaderLine` byte-identical). The runtime edit `referenceLine` keeps its alias-named form (it embeds real `image #N` aliases — different shape than the generic builder).
- **Model-facing trim:** removed the collage/grid/multi-panel provider-hygiene clause from `image_generate`/`image_edit` descriptions in `native-tool-projection.ts`; kept `count=N`/`outputMode='series'` intent and the `referenceImageAliases` "rooted in source" param-choice guidance.
- **Tests:** updated `openai-provider.client.test.ts` (unified wording assertion), `native-tool-projection.test.ts` (collage `doesNotMatch` + `runMediaPromptFragmentsSanityTest`), registered the sanity test in `run-suite-isolated.ts`.
- Gate green: lint, format:check, all-package typecheck (incl. runtime-contract), provider-gateway suite, runtime projection + sanity (via temp runner). Not deployed; not committed.

### Slice 4 landed (dead-code & drift sweep)

- **Removed (proven dead):** `buildRuntimeToolPoliciesMarkdown` (`runtime-tool-policy.ts`); `buildPromptToolMarkdownEntry` + orphaned `joinPromptToolInstruction` (`prompt-constructor-tool-metadata.ts`); the `generateToolsPrompt` `else` markdown fallback (`compile-prompt-constructor.service.ts`). Missing-`tools`-template case (cold-migration only) now → empty tools block + one `warn` log.
- **Removed ghost-verb sanitizers** from `native-tool-projection.ts` (the four `containsLegacy*`/`resolveSanitized*` fns); call sites now use `resolveToolDefinitionDescription` directly. Re-confirmed zero live matches before deleting.
- **Reconcile:** `files` hardcoded description in `runtime-tool-policy.ts` now lists `preview`.
- **Kept:** document-tool `action !== "deferred"` guard in `turn-execution.service.ts`.
- Tests updated: `compile-prompt-constructor.service.test.ts` (warned empty-block), `runtime-tool-policy.test.ts` (no markdown builder + `preview`), `native-tool-projection.test.ts` (raw descriptions).
- Gate green: lint, format:check, api+web+runtime+gateway typecheck, affected api tests + runtime projection/sanity (temp runner). Not deployed; not committed.

### Slice 5 landed (golden single-source test + closure)

- `apps/runtime/test/native-tool-projection.test.ts`: `runMediaPromptFragmentsSanityTest` now reads the live production sources from disk and fails if ADR-117 ownership drifts: collage/contact-sheet/diptych wording re-inlined outside `packages/runtime-contract/src/index.ts`, runtime/provider media paths stop importing the shared fragments, `tool-catalog-data.ts` reintroduces `action="deferred"` or cross-tool comparison prose, or `bootstrap-preset-data.ts` loses the selection-guide marker / reintroduces an `agents` Tasks Policy.
- Doc truth updated in `docs/API-BOUNDARY.md`, `docs/ARCHITECTURE.md`, and `docs/TEST-PLAN.md` to record the D1 precedence rule, the three-concern seam, and how to run the golden test through the runtime temp-runner path.
- `docs/ADR/117-tool-instruction-source-of-truth-and-native-tool-runtime-selection-guide.md` now has a closure section: slices 0-5 all marked done, final owner table reaffirmed, reachability proofs cited from the inventory ledger Section 4, residual kept document-tool guard recorded, and `cache-prefix rollout SHA: PENDING` until materialization rollout + GKE deploy happen.
- Gate green on this slice's current tree: lint, format:check, api/web/runtime/runtime-contract typecheck, and runtime temp-runner projection + golden sanity tests. No deploy, no commit.

### Next recommended step

- Materialization rollout + GKE deploy (records the cache-prefix rollout SHA), then optionally the separate knowledge-output markdown-normalization slice.

## 2026-06-15 — image_edit multi-reference inputs (up to 16)

### Scope

- Bounded feature slice (no ADR). User: lift the prior 2-image `image_edit` limit to OpenAI gpt-image-1's 16 total inputs (source + up to 15 references), wired production-grade across all layers.

### What landed

- **Contract** (`packages/runtime-contract`): `MAX_RUNTIME_IMAGE_EDIT_INPUT_IMAGES=16`, `MAX_RUNTIME_IMAGE_EDIT_REFERENCE_IMAGES=15`; `RuntimeImageEditRequest.referenceImageAliases` + result `referenceImageAliases`/`referenceFilenames`; `ProviderGatewayImageEditRequest.referenceImages`. Legacy single `referenceImage(Alias)` kept (deprecated, merged in).
- **Tool projection** (`native-tool-projection.ts`): new `referenceImageAliases` array param (maxItems 15) + updated `image_edit` descriptions; references stay "guidance only", output rooted in source.
- **Runtime service** (`runtime-image-edit-tool.service.ts`): parser merges single+array aliases, dedupes case-insensitively, drops source-collisions, caps at 15; `resolveImageSelection` loads N references; `composeSeriesPrompt` + logs list all refs; result payloads carry plural fields.
- **Provider-gateway** (`provider-image-generation.service.ts`): normalizes `referenceImages` (prefers array, falls back to single), caps at 15.
- **OpenAI client** (`openai-provider.client.ts`): builds `image=[source, ...references]`; plural prompt wording for >1 reference, single-reference wording preserved verbatim.

### Verification

- Full gate green: lint (all workspaces), format:check, typecheck (contract/runtime/provider-gateway/api/web). Tests: runtime media-request-parsing 13/13 (3 new multi-ref cases), full runtime suite pass, provider-gateway openai-client + image-generation-service pass (new multi-ref assertions).
- NOT deployed to `persai-dev`; NOT committed (pending user direction).

### Next recommended step

- Commit + deploy; live-test `image_edit` with 3+ reference aliases for `alex@agse.ru` and confirm OpenAI receives source + all refs (watch `[image-edit] ... referenceAliases=[...]` log).

## 2026-06-15 — Image gen/edit silent-cut + missing-prompt bugfix

### Scope

- Bounded bugfix slice (no ADR). Triaged a `persai-dev` incident for `alex@agse.ru`: image carousel turn cut off mid-reply with **no error** and produced no image; re-asking worked.

### Root cause (from kubectl logs, turn `c8c44383`)

1. **Silent stream cut:** the web `slow_avg` cadence watchdog (`avgThresholdMs=200`) fired on the slow post-tool wrap-up answer (observed `rollingAvgMs=322`) and aborted the runtime fetch. Side-effect turns are not safe to retry, so the reply stayed truncated.
2. **No image:** the `image_edit` call shipped `outputMode="series"` + 4 `seriesItems` but **no top-level `prompt`**, so the parser returned `invalid_arguments` → `skipped` → `/media-jobs/enqueue` was never called (confirmed: enqueue present for the working retries `4b02033a`/`e95161b3`, absent for `c8c44383`).

### What landed

- `apps/api/.../cadence-watchdog.ts`: `slow_avg` disabled for the rest of a span once any tool starts (`recordToolStarted`); pure-text turns unchanged. New regression test.
- `apps/runtime/.../runtime-image-edit-tool.service.ts` + `runtime-image-generate-tool.service.ts`: `prompt` optional in series mode (synthesized overall prompt); non-series still requires it. Added `requestId`-tagged `skipped` warn logs to previously silent branches. New parser tests.

### Verification

- Gate green: api/runtime/web typecheck, format:check, lint (api+runtime). Tests: cadence-watchdog 22/22, runtime media-request-parsing 10/10.
- NOT yet deployed to `persai-dev`; NOT committed (clean-tree change pending user direction).

### Next recommended step

- Deploy to `persai-dev` and re-run the original carousel flow for `alex@agse.ru` to confirm: full reply (no cut) + job enqueued. Watch new `[image-edit]/[image-generate] skipped reason=...` logs to catch any other skip causes.

## 2026-06-14 — ADR-116 closed (file re-view: inspect, read, preview)

### Baseline

- `ff9e4cbb` on `main`; deployed to `persai-dev` (`runtime`, `provider-gateway`, `api`, `web`).

### What landed (116.0–116.3)

- **116.0:** `files.inspect` / contract `files.preview`; plan `maxFilePreviewBytes` + `maxFilePreviewEdgePx`; Admin Plans UI; materialized `RuntimeToolPolicy`; capability matrix.
- **116.1:** `files.read` metadata (`charCount`, `truncated`, `readNote`, `extractionCached`, `extractionQuality`); sanitizer clip truth; extract API `cached: true` on hits.
- **116.2:** `files.preview` for `image/*` + native PDF; ephemeral `toolFollowUpUserContent` injection; unified hydration byte/edge limits from bundle.
- **116.3:** focused unit tests, doc truth (`API-BOUNDARY`, `TEST-PLAN`, `DATA-MODEL`), live acceptance on `persai-dev` — all four checklist items PASS (see ADR-116 closure table).

### Verification

- Repo gate at `ff9e4cbb`: lint, format:check, typecheck, test, test:step2.
- Live: `files.preview` on historical images; `preview_size_limit` at plan limit 25 bytes; success at 8 MB with `file_preview` runtime log.

### Next recommended step

- No open ADR-116 work. Await explicit user priority for the next program (e.g. skill scenarios consumer of `files.preview`, or unrelated slice).
