# SESSION-HANDOFF

> Archive: handoff sections from 2026-06-06 and earlier moved to `docs/SESSION-HANDOFF.archive-2026-06-06-and-earlier.md`; 2026-05-19 and earlier remain in `docs/SESSION-HANDOFF.archive-2026-05-19-and-earlier.md`.
> Keep this file short: only the current active working set and immediate handoff.

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
