# SESSION-HANDOFF

> Archive: handoff sections from 2026-06-06 and earlier moved to `docs/SESSION-HANDOFF.archive-2026-06-06-and-earlier.md`; 2026-05-19 and earlier remain in `docs/SESSION-HANDOFF.archive-2026-05-19-and-earlier.md`.
> Keep this file short: only the current active working set and immediate handoff.

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
