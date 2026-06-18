# ADR-118: Skill Scenarios and Model-Owned Skill Activation

## Status

Superseded by ADR-119 — 2026-06-18

> ADR-118 introduced the three-level engagement model (Enabled / Active / Running scenario), the `skill` tool, the `SkillScenario` entity, the `:::working` UX indicator, and the model-owned activation mechanism. All of those **concepts are preserved** in ADR-119. The block format (ADR-118 D4 — prose-style `## Active Scenario` markdown), the prompt-section ordering (Selection Guide last), the persona compiler (free-form Instructions duplicated), and the implicit single-monolithic-prompt cache strategy are **rewritten by ADR-119**. Where ADR-118 and ADR-119 disagree, ADR-119 is the authority. ADR-118 remains the reference for the engagement-mechanism rationale.

> Previously: Open program. Parallel to ADR-117 (does not block, does not supersede). Supersedes the hidden-classifier + cadence + lexical-gate Skill activation introduced post-ADR-079 (`SkillStateRoutingService`, `AutoSkillRoutingStateService` cadence parts, `matchesSkillLexically`) and **adds a new product concept** — admin-authored `SkillScenario` — that the current Skill data model does not have.

---

## Context

### Problem in one sentence

User-enabled Skills frequently fail to take effect on the very turn that needs them (Skill stays "inactive" while the user is already asking a domain question), and Skills today carry only static `instructionCard` + `SkillKnowledgeCard` content — there is **no concept of a reusable, admin-authored workflow** (e.g. "Instagram carousel: 8 slides via `image_generate` series, hook → problem → solution → CTA"), so every workflow is improvised by the model from scratch on each request.

### Three concrete failure modes today

**[F1] Activation latency and miss.**
User enables the *Marketer* Skill, opens a new chat, asks *«сделай карусель в инсту про новый продукт»*.

Current flow:

- Background `SkillStateRoutingService` classifier runs on cadence: first check after `DEFAULT_SKILL_ROUTING_INITIAL_CHECK_USER_MESSAGE_INDEX = 3` user messages, then every `DEFAULT_SKILL_ROUTING_BACKGROUND_RECHECK_INTERVAL_MESSAGES = 5` user messages (`apps/api/.../platform-runtime-provider-settings.ts:~L49-50`). Result is persisted to `assistant_chats.skillDecisionState` and applied on the **next** turn.
- A separate `tryForegroundActivation` synchronous path exists to bridge that gap, gated by `shouldTryForegroundActivation` (`apps/runtime/.../skill-state-routing.service.ts:~L105-122`). That gate is a **lexical substring match** (`matchesSkillLexically`, ~L419-430): lowercases the user text and checks whether any token ≥4 chars from Skill `name + description + category + tags + routingExamples` is a literal substring of the user message.

If "карусель" is not literally inside the Marketer Skill's description/tags/examples, the foreground gate refuses. The user has to wait for cadence to elapse.

**[F2] No structured workflow concept.**
A Skill row today carries `instructionCard` (one static body + guardrails + examples) and a set of `SkillKnowledgeCard` rows. There is no entity for *"this Skill knows how to execute these named workflows"*. The model improvises every multi-step output (carousel, product cards, avatar video) from generic instructions, which produces non-reproducible quality and prevents the admin from saying *"in Marketer skill, an Instagram carousel is exactly 8 slides with this structure and uses `image_generate` with `outputMode=series`"*.

**[F3] No visible signal of activation.**
The pre-removal Skill-status banner is gone. The user has no quiet confirmation that the Skill activated or which scenario is being executed.

### What activation actually controls today (verified in code)

After active-Skill decision is persisted, the downstream effect is **retrieval priority and cache**:

- `orchestrate-runtime-retrieval.service.ts` reads `ordinarySourcePriorityMode` from the runtime `retrievalPlan` and orders source stages accordingly (Skill → User → Product → Web).
- `SkillRetrievalStateService` + `SkillRetrievalPolicyService` (`apps/api/.../skill-retrieval-*.ts`) cache refs per active Skill so close follow-ups can reuse without re-searching.
- The materialized `Enabled Skills` prompt block (`enabled-skills-prompt-materialization.ts`) renders **all** Skill rows with `assignmentStatus === "active"` — i.e. **enabled-in-settings**, independent of runtime decision state. Skill instructions are visible whenever enabled; decision state only changes retrieval priority and cache.

This is the **correct architecture for the downstream effect**. The problem is upstream: how that decision is reached.

### Heuristics inventory (model-as-judge violations)

| Site | Kind | Verdict |
|---|---|---|
| `matchesSkillLexically` (substring match on Skill metadata for foreground gate) | Lexical heuristic | **Delete** |
| `DEFAULT_SKILL_ROUTING_INITIAL_CHECK_USER_MESSAGE_INDEX = 3` | Cadence heuristic (timed delay before first classifier call) | **Delete** |
| `DEFAULT_SKILL_ROUTING_BACKGROUND_RECHECK_INTERVAL_MESSAGES = 5` | Cadence heuristic (timed re-check) | **Delete** |
| `SkillStateRoutingService` (separate LLM classifier in background) | Hidden gate (LLM is not the heuristic, but it gates retrieval invisibly to user/model) | **Delete** |
| `AutoSkillRoutingStateService` cadence helpers (`shouldRunBackgroundCheck`, `runBackgroundCheck`, `markBackgroundCheckQueued/Failed`, `messageCountSinceCheck`, `backgroundCheckQueuedAtMessageIndex`) | Cadence orchestration | **Delete** (persistence helpers are kept) |
| `routerPolicy.skillRoutingPolicy` admin field (`initialCheckUserMessageIndex`, `backgroundRecheckIntervalMessages`) | Admin-tunable cadence | **Delete** from Admin Runtime |
| `confidence`, `checkedAtMessageIndex` on `RuntimeSkillDecisionState` | Classifier-only fields, irrelevant under model-owned activation | **Delete** |
| `skillCadenceState` JSON cell on `assistant_chats` | Cadence-only persistence | **Drop column** |

### Constraints that shape the solution

1. **Prompt cache discipline (ADR-074 P1, ADR-110).** Tool schemas and the `Enabled Skills` block live in the cached system prefix. They **must not** mutate per turn based on chat-scope state (`activeScenarioKey`). Any per-turn dynamic content uses the existing `cacheRole: "volatile_context"` projection (ADR-110, ADR-112 Slice 2) which the provider clients drop from the cached prefix and re-project as a `user` block immediately before the current question.
2. **PersAI principle (ADR-112).** Model judges, code provides structured data, heuristics permitted **only** as negative guardrails (skip-on-obvious-failure), never as the deciding layer.
3. **ADR-117 coordination.** ADR-117 owns the `tools` selection guide (`bootstrap-preset-data.ts`) and, as of ADR-118 authoring, is in closure mode with a golden invariant test (`apps/runtime/test/native-tool-projection.test.ts`) reading both `bootstrap-preset-data.ts` and `tool-catalog-data.ts` from disk. ADR-118 contributes **exactly one** rule line to that same `tools` template, additively in Slice 7, and the same slice updates the golden test to accept the new line as part of the canonical guide. No second template, no duplicated selection logic.
4. **Existing retrieval orchestration is correct.** `orchestrate-runtime-retrieval`, `SkillRetrievalStateService`, `SkillRetrievalPolicyService`, `ordinarySourcePriorityMode` stage-cascade — all preserved untouched. We change only how `skillDecisionState` is **set**, not how downstream consumers read it.
5. **Production-grade, no scaffolding.** No TODO stubs, no compatibility shims for the deleted cadence path, no parallel "old + new" classifier coexistence. Slice 6 sweeps the dead code in one pass after Slices 1-5 land.
6. **Migration safety.** `skillDecisionState` shape change is a Prisma JSON shape change (not a column drop), so no destructive migration. `skillCadenceState` is a real column drop and requires an additive migration with explicit rollback note.

---

## Decision

### D1 — Three-level engagement model

Three distinct states, each with one owner:

| Level | What | Effect | Set by |
|---|---|---|---|
| **Enabled** | Skill row is `assignmentStatus = active` for this assistant | `instructionCard` + scenarios catalog rendered into the cached `Enabled Skills` prompt block | Admin (user Settings → Skills) |
| **Active** | Chat-scope: this chat is currently in the Skill's domain | `ordinarySourcePriorityMode` flips to Skill-first; `SkillRetrievalStateService` cache key = `activeSkillId`; UI shows soft indicator | **Model**, via `skill({ action: "engage" })` tool |
| **Running scenario** | Chat-scope: a specific structured workflow is in progress | Volatile developer block with scenario steps injected after cached prefix, before current user question | **Model**, via `skill({ action: "engage", scenarioKey })` |

There is no fourth level. There is no implicit/hidden activation by classifier, cadence, or lexical match.

### D2 — Single tool `skill` (discriminated union)

Native runtime tool, projected per turn through `native-tool-projection.ts`. Discriminated union by `action`.

```
skill({ action: "engage", skillId, scenarioKey?: optional }) → engaged | error
skill({ action: "release" })                                  → released
```

- `engage` without `scenarioKey` → activate Skill for free-form discussion in the domain (sets `activeSkillId`, clears `activeScenarioKey`).
- `engage` with `scenarioKey` → activate Skill **and** load scenario steps into volatile developer block on the same turn.
- Repeated `engage` with different values **replaces** state (this is the scenario-switch and skill-switch path).
- `release` clears `activeSkillId` and `activeScenarioKey`.
- Only one Skill active at a time. Multi-Skill is explicitly out of scope (see Alternatives).

Tool result shape (returned to the model in the same tool loop iteration):

```
// engage without scenario
{ action: "engaged", skillId, skillDisplayName, scenarioKey: null }

// engage with scenario
{
  action: "engaged",
  skillId, skillDisplayName,
  scenarioKey, scenarioDisplayName,
  steps: [...],            // structured directives (see D3)
  recommendedTools: [...], // text list, not a constraint
  exitCondition: "..."
}

// release
{ action: "released", previousSkillId }

// honest errors
{ error: "skill_not_enabled", skillId }
{ error: "scenario_not_found", scenarioKey, availableScenarios: [...] }
{ error: "scenario_not_active", scenarioKey } // for archived
```

The tool result for an `engage`-with-scenario carries the steps inline as **structured tool result**. The same content is also rendered into the volatile developer block on the next turn so the model keeps seeing it across iterations. Runtime composes the developer block; tool result is one-shot confirmation.

### D3 — `SkillScenario` first-class entity

New Prisma model `SkillScenario`, owned by a `Skill` row.

```
SkillScenario {
  id, skillId,
  key            (slug, immutable; e.g. "instagram_carousel")
  displayName    (Json loc: { ru, en })
  description    (Json loc, 1-2 sentences for catalog)
  iconEmoji      (nullable)
  intentExamples (string[]): how a user typically asks for this scenario
                  — these are HINTS for the model (rendered into the Enabled
                  Skills catalog), NOT for regex/lexical matching anywhere
  steps          (Json structured list, see below)
  recommendedTools (string[]): native tool keys (`image_generate`, etc.)
  exitCondition  (string): textual exit rule
  status         (enum: draft | active | archived)
  displayOrder   (int)
  createdAt, updatedAt
}

Each step in `steps` is structured:
{
  number: int,
  directive: string,                  // imperative, e.g. "CALL image_generate with outputMode=series, count=8"
  recommendedToolCall: string | null, // native tool key the step suggests (text hint, NOT a constraint)
  mayBeSkippedIf: string | null,
  negativeGuards: string[]            // "Do NOT collapse into one call", etc.
}
```

**Rationale for `recommendedToolCall` being text-only:** the user's explicit feedback during ADR design — "в сценарии задавал какой tool лучше вызвать для модели в виде инструкции". We do **not** implement JSON-schema args constraints, post-call validation, or any other enforcement. The directive is rendered into the developer block, the model follows or doesn't. Adherence comes from the structure of the developer block (numbering, imperatives, guards) and the model's judgment, not from runtime gating. If telemetry later shows specific adherence failures, a future ADR can add structural matching by `recommendedToolCall` for progress display — that is **not** in scope for ADR-118.

Lifecycle:

- `draft` → not visible to any model, not in any catalog
- `active` → appears in the `Enabled Skills` catalog for assistants that have the parent Skill assigned; `skill({ engage, scenarioKey })` is accepted
- `archived` → removed from catalog; `engage` with this key returns `scenario_not_active`. Existing chats that have `activeScenarioKey` pointing to an archived scenario keep the current turn until release; new engages fail honestly.

Mutations (`active` ↔ `archived`, step edits while `active`) mark all assistants with the parent Skill assigned as `configDirtyAt`, triggering normal re-materialization through the existing `materialization_rollouts` path.

### D4 — Volatile developer block for active scenario

When a turn starts with `skillDecisionState.activeScenarioKey !== null`, the runtime turn assembly composes a `## Active Scenario` developer block:

```
## Active Scenario: <scenarioDisplayName> (Skill: <skillDisplayName>)

Follow steps in order. Do not skip, do not combine, do not respond to the user
without making progress on a step.

Steps:
1. <directive>
   Recommended tool: <recommendedToolCall> (if any)
   Guards: Do NOT <guard 1>. Do NOT <guard 2>.
2. ...
...
N. <final step — typically: confirm and call skill({ action: "release" })>

Exit condition: <exitCondition>
```

This block is injected with `cacheRole: "volatile_context"` on the corresponding `ProviderGatewayTextMessage` (existing contract field, already projected as a non-cacheable `user` block by both Anthropic and OpenAI clients per ADR-110 / ADR-112 Slice 2). Tool schemas in the cached prefix are **not modified**. The cached prefix stays byte-stable across scenario engage/release events.

### D5 — Dead-code removal

After Slices 1-5 land (state shape, tool, materialization, admin UI, UX indicator), Slice 6 deletes the cadence/classifier/lexical-gate stack in one sweep. No flag-gating, no compatibility coexistence. See heuristics inventory above for the exact removal list. Tests covering the removed services are deleted; tests covering preserved services (`SkillRetrievalStateService`, `orchestrate-runtime-retrieval`, materialization) are updated for the new state shape.

### D6 — UX indicator in the `:::working` block header (inline next to the toggle)

When the chat stream completes for a turn that was inside an active Skill, the already-collapsed `:::working` block (the same UI element introduced post-ADR-112 for chat working notes) carries the engagement summary **inline in its own header row, immediately to the right of the `Выполнено ▾` toggle**. Not as a line inside the block. Not as a separate row below. Same row as the toggle, secondary visual weight:

```
[avatar]  Выполнено ▾    Маркетолог · Instagram-карусель
          └── toggle ──┘ └── engagement annotation (subdued, same row) ──┘
```

- Skill **with** scenario: annotation `<SkillDisplayName> · <ScenarioDisplayName>` (e.g. `Маркетолог · Instagram-карусель`).
- Skill **without** scenario (free-form domain discussion): annotation `<SkillDisplayName>` only (e.g. `Маркетолог`).
- No active Skill (`release` was called inside the turn, or never engaged): no annotation at all. The toggle stays plain `Выполнено ▾`.

Typography: same line-height as the toggle label, muted/subdued color, separated from the chevron by a fixed gap. The annotation must not wrap to a second row at any chat width above mobile breakpoint; on narrow widths it truncates with ellipsis at the scenario boundary (Skill name preserved, scenario name truncated first). Localization: `Выполнено` / `Done` per user `preferredLocale`; Skill and scenario names are themselves already localized through their `displayName` JSON.

This is the **only** UI signal of active Skill/scenario state in the chat surface. No banner, no badge, no floating chip, no line inside the block body.

State source: the existing `activeTurn` projection on `AssistantWebChatState` (web bootstrap / chat list / messages) is extended with `engagementSummary: { skillDisplayName, scenarioDisplayName?: string } | null` derived from `assistant_chats.skillDecisionState` at the time the turn completed. The web client reads it from the SSE final event and from history fetch, ensuring reconciliation parity (ADR-100 Slices 2-5 reconciliation discipline). The component that renders the `:::working` block toggle row consumes `engagementSummary` as an optional prop and renders the annotation as a sibling of the label, not as a child of the block body.

### D7 — One additive line in the canonical `tools` selection guide

ADR-117 is in **closure mode** as of ADR-118 authoring — Slices 1-5 + hotfix have landed and `apps/runtime/test/native-tool-projection.test.ts` now contains the ADR-117 golden invariant that reads `apps/api/prisma/bootstrap-preset-data.ts` from disk and asserts the Native Tool Runtime selection guide remains the single canonical seat and that `agents` does not reintroduce a Tasks Policy.

ADR-118 Slice 7 adds **one** rule line to that same `tools` template default, additively, and updates the ADR-117 golden test to accept the new Skills line as part of the canonical guide (not as a competing block). The line:

```
**Skills.** If a Skill is enabled in the assistant's domain of the request,
the first step of the turn is `skill({ action: "engage", skillId, scenarioKey? })`.
If a scenario applies, include `scenarioKey`. Do not re-engage if already active.
When the conversation leaves the domain, call `skill({ action: "release" })`.
```

Three sentences, one rule, additive. The ADR-117 closure section's `cache-prefix rollout SHA: PENDING` will be either resolved before ADR-118 Slice 7 lands (preferred — separate rollouts, cleaner attribution) or absorbed into the same rollout (acceptable — one cache invalidation pays for both changes). Slice 7's verification gate explicitly re-runs the ADR-117 golden test against the updated guide to confirm no other ADR-117 invariant is broken (Tasks Policy not reintroduced, selection-guide-shaped seat preserved, `tool-catalog-data.ts` not regressed on cross-tool prose).

---

## Target architecture

```
USER ENABLES SKILL IN SETTINGS
  └── AssistantSkillAssignment row, assignmentStatus=active
       └── Materialization renders Enabled Skills block (cached prefix)
            ├── instructionCard
            └── catalog of active SkillScenarios (key + displayName + 1-line desc)

MODEL FIRST STEP OF TURN (when domain matches)
  └── skill({ action: "engage", skillId, scenarioKey? })
       └── Internal API: POST /api/v1/internal/runtime/skill/state
            └── assistant_chats.skillDecisionState updated atomically
                 └── SkillRetrievalStateService.clearForChatWhenSkillMismatches
                 └── Tool result returned to model (steps inline if scenario)

NEXT ITERATION OF TOOL LOOP (same turn)
  └── Volatile developer block "## Active Scenario" composed by runtime
       └── cacheRole: "volatile_context" (NOT in cached prefix)
       └── Model follows numbered imperatives + guards

RETRIEVAL (when model calls knowledge_search / orchestrated)
  └── retrievalPlan.ordinarySourcePriorityMode resolves from activeSkillId
       └── orchestrate-runtime-retrieval stage-cascade: Skill → User → Product → Web
       └── SkillRetrievalStateService cache by activeSkillId

STREAM END
  └── activeTurn.engagementSummary projected to web client
       └── :::working block (collapsed) shows "Выполнено — <Skill> · <Scenario>"

MODEL EXIT (when domain shifts)
  └── skill({ action: "release" })
       └── activeSkillId, activeScenarioKey cleared
       └── retrieval returns to ordinary priority
```

Invariants enforced by tests (Slice 8 golden tests):

- The only writer of `assistant_chats.skillDecisionState.{activeSkillId, activeScenarioKey}` is the `skill` tool execution path. No other service writes these fields.
- Tool schemas in `native-tool-projection.ts` do **not** vary based on `skillDecisionState`. The cached system prefix is byte-stable across engage/release.
- No reachable code path in `apps/api`, `apps/runtime`, `apps/web` references `SkillStateRoutingService`, `matchesSkillLexically`, `tryForegroundActivation`, `shouldRunBackgroundCheck`, `runBackgroundCheck`, the cadence constants, or `skillCadenceState` after Slice 6.

---

## Work plan (slices for executor subagents)

Each slice is sized for one subagent in a single sitting. The orchestrator assigns the slice, the subagent reads live code and the ADR, implements, runs the verification gate, and stops at a green committable tree. The orchestrator audits the diff against the slice's acceptance criteria before assigning the next slice. The orchestrator does not write code.

**Subagent model guidance (orchestrator decides):**

- `low` complexity (inventory, doc, UX wiring) → fast model
- `medium` (state shape, entity + admin API, tool wiring, materialization extension) → strong default
- `high` (volatile block runtime composition, dead-code sweep) → strongest available

**Slice ordering invariant:** Slices 1-5 are additive (old cadence path keeps running until Slice 6). Slices 6-8 are subtractive/finalizing. Do not skip Slice 6 — leaving dead code is a hard ADR-118 violation.

### Standard verification gate (run at end of every slice)

1. `corepack pnpm -r --if-present run lint`
2. `corepack pnpm run format:check`
3. `corepack pnpm --filter @persai/api run typecheck`
4. `corepack pnpm --filter @persai/web run typecheck`
5. `corepack pnpm --filter @persai/runtime run typecheck` + `--filter @persai/provider-gateway run typecheck` + `--filter @persai/runtime-contract run typecheck`
6. Affected package tests (api / runtime / web / contracts). If Prisma schema changed: `corepack pnpm prisma:generate` and `corepack pnpm contracts:generate` before tests.
7. If seeds, templates, catalog, or materialization changed: re-run the affected materialization test(s) and explicitly note the prompt-cache prefix change in the slice handoff.

---

### Slice 0 — Engagement inventory and reachability ledger (low, no behavior change) — **LANDED 2026-06-15**

**Deliverable:** `docs/ADR/118-skill-engagement-inventory.md` (37-row ledger; 35/35 delete verdicts with reachability proven; Sections 1-7 complete; lint + format:check PASS). Risks R1, R3, R7, R9 from the ledger have been folded back into Slices 1, 4, 6 below as concrete adjustments.

**Goal:** produce the single source ledger that drives Slices 1-6. No code changes.

**Do:**

- Walk every site listed in the heuristics inventory above. For each, record: file + symbol + approx line, current behavior, who reads/writes it, and verdict (`delete` / `keep` / `replace` / `migrate`). Expand the table if more sites are found.
- Confirm reachability: `SkillStateRoutingService` import graph, `matchesSkillLexically` callers, `runBackgroundCheck` callers, admin UI usage of `routerPolicy.skillRoutingPolicy`. List every call site so Slice 6 can be a clean sweep.
- Confirm that `Enabled Skills` block already renders independent of `skillDecisionState` (we believe yes — verify in `enabled-skills-prompt-materialization.ts`).
- Confirm the volatile-context projection path: trace one volatile block end-to-end through Anthropic and OpenAI provider clients to verify scenario block can ride the same rails.

**Deliverable:** `docs/ADR/118-skill-engagement-inventory.md` (ledger). Documentation only.

**Acceptance:** ledger row count ≥ heuristics inventory table; every callsite of deleted symbols enumerated with file:line; reachability proven for every `delete` verdict; volatile-context path confirmed.

**Gate:** lint, format. **Risk:** none (read-only).

### Slice 1 — Decision state shape + persistence trim (medium)

**Goal:** new shape of `RuntimeSkillDecisionState` and `assistant_chats` persistence; cadence persistence dropped; classifier persistence helpers deleted; no model behavior change yet.

**Do:**

- Update `RuntimeSkillDecisionState` in `packages/runtime-contract/src/index.ts`: add `activeScenarioKey: string | null`; remove `confidence`, `checkedAtMessageIndex`. Update OpenAPI / generated contracts.
- **Also update inline re-declarations of the same shape** (Slice 0 ledger R1): `apps/api/src/modules/workspace-management/application/assistant-runtime.facade.ts` (`AssistantRuntimeTurnRoutingSnapshot.skillState`, ~L115/L123-124) and `apps/web/app/app/_components/use-chat.ts` (web chat hook, ~L158/L166-167). Regeneration alone does not flow into these inline types.
- Prisma migration: drop column `assistant_chats.skill_cadence_state`. Migration name `adr118_drop_skill_cadence_state`. Reversible (column re-creatable). The `skill_decision_state` JSON column stays — only its shape changes (not enforced at DB).
- **Atomically with the column drop, remove the two cadence-state writers** (Slice 0 ledger R7): `apps/api/src/modules/workspace-management/application/manage-admin-skills.service.ts:~L678-680` and `manage-assistant-skills.service.ts:~L172-175` both write `skillCadenceState: createEnabledSkillBootstrapCadenceState()` (or `Prisma.DbNull`) atomically with `skillDecisionState`. Slice 1 must drop the `skillCadenceState` write from both **in the same commit** as the column drop, otherwise Prisma fails at runtime with `Unknown field`.
- The generated `AssistantWebChatState.skillCadenceState` field is a non-optional `… | null` projection (Slice 0 ledger R2); column drop + contract regen + web client deploy ship coordinated in this slice (already implied by the Slice 1+2 same-deploy rule).
- `AutoSkillRoutingStateService`: delete cadence methods (`shouldRunBackgroundCheck`, `runBackgroundCheck`, `markBackgroundCheckQueued`, `markBackgroundCheckFailed`, `createBackgroundCheckContext`, `createNewChatSkillCadenceState`, `createEnabledSkillBootstrapCadenceState`, `createMigrationRepairSkillCadenceState`, `readSkillRoutingPolicy`, `skillRoutingPolicyCache`). Keep `buildRuntimeContext`, `persistFromTurnRouting`, `persistFromSkillCheckResult`, `readChatSkillState`, `persistState`, `shouldPersistSkillDecisionState`, `normalizeDecisionState`. The service becomes a thin persistence facade.
- Delete `DEFAULT_SKILL_ROUTING_INITIAL_CHECK_USER_MESSAGE_INDEX` and `DEFAULT_SKILL_ROUTING_BACKGROUND_RECHECK_INTERVAL_MESSAGES` from `platform-runtime-provider-settings.ts` (L49-50) and **all 5 call-sites** identified by the Slice 0 ledger (L748, L749, L763, L769, L1983, L1985). Delete `routerPolicy.skillRoutingPolicy` from admin runtime settings shape (OpenAPI + admin runtime UI section).
- Update `manage-admin-runtime-provider-settings.service.test.ts` + `platform-runtime-provider-settings.test.ts` for removed shape.
- `SkillStateRoutingService` is **kept** as a class in this slice (deleted in Slice 6) but its outputs are unused: do not call it from `turn-execution.service.ts`. Wire only the persistence path of `persistFromTurnRouting`.

**Acceptance:**

- Old cadence path no longer runs (model behavior unchanged because `Enabled Skills` block was already independent of decision state). Activation effectively becomes inert — Skills stay `inactive` until Slice 2 ships the `skill` tool. This is intentional: Slice 1 is the additive substrate; Slice 2 immediately restores model-driven activation.
- Prisma migration applied locally and on `persai-dev` succeeds; rollback note documented.
- Verification gate green.

**Risk:** medium. Mitigation: the inert-activation window between Slices 1 and 2 must be **one session apart at most**; orchestrator must batch the two slices in the same deploy.

### Slice 2 — Tool `skill` (high)

**Goal:** model can activate / release / select scenario through the new structured tool.

**Do:**

- Add `skill` row to `apps/api/prisma/tool-catalog-data.ts` with `toolCode = "skill"`, `modelDescription` per D2, `modelUsageGuidance` per D2, `displayCategory` consistent with other native-runtime tools.
- New native projection in `apps/runtime/src/modules/turns/native-tool-projection.ts`: `createSkillToolDefinition` builds the discriminated-union JSON schema (action + skillId + scenarioKey). No JSON-schema-args constraints, no scenario-conditional schema mutation.
- New runtime service `apps/runtime/src/modules/turns/runtime-skill-tool.service.ts`: parses tool args, validates against `RuntimeBundle.skills.enabled` and the materialized scenario catalog, calls internal API.
- New internal API endpoint `POST /api/v1/internal/runtime/skill/state` (registered on `API_INTERNAL_PORT=3002`, guarded by `PERSAI_INTERNAL_API_TOKEN`): writes `skillDecisionState`, calls `SkillRetrievalStateService.clearForChatWhenSkillMismatches`, returns the tool result payload (engaged-with-scenario inlines the scenario steps fetched from `SkillScenario`).
- Honest error codes per D2 (`skill_not_enabled`, `scenario_not_found`, `scenario_not_active`).
- Wire `runtime-skill-tool.service` into `turn-execution.service.ts` tool dispatch.
- Tests: focused service tests on parser, internal API, error paths; runtime turn-execution test for the engage/release flow.

**Acceptance:** model can call `skill({engage, skillId})`, `skill({engage, skillId, scenarioKey})`, `skill({release})`. State persists across turns. Retrieval picks up the new active Skill (no change to `orchestrate-runtime-retrieval` itself, only the upstream state). Errors return honestly without crashes.

**Risk:** medium-high (new tool, new internal seam). Mitigation: integration test on real `persai-dev` materialized bundle in a sandbox chat at end of slice.

### Slice 3 — `SkillScenario` entity + admin API (medium)

**Goal:** admin-managed scenarios persisted in DB, mutable through Admin Skills surface.

**Do:**

- Prisma model `SkillScenario` per D3. Migration `adr118_skill_scenario`. FK to `Skill(id) ON DELETE CASCADE ON UPDATE CASCADE`. Unique `(skillId, key)`. Index `(skillId, status, displayOrder)`.
- Repository port + Prisma adapter under `apps/api/src/modules/workspace-management/domain` + `infrastructure/persistence`.
- New service `ManageSkillScenariosService` (`apps/api/src/modules/workspace-management/application`).
- API routes under existing `apps/api/.../interface/http/admin-skills.controller.ts`:
  - `GET /api/v1/admin/skills/:skillId/scenarios`
  - `POST /api/v1/admin/skills/:skillId/scenarios`
  - `GET /api/v1/admin/skills/:skillId/scenarios/:scenarioKey`
  - `PATCH /api/v1/admin/skills/:skillId/scenarios/:scenarioKey`
  - `DELETE /api/v1/admin/skills/:skillId/scenarios/:scenarioKey` (archive, not hard delete)
- OpenAPI hand-edit + `corepack pnpm contracts:generate`.
- Mark dirty: every successful mutation calls the existing `markAssistantsConfigDirtyForSkill(skillId)` helper.
- Tests: `manage-skill-scenarios.service.test.ts` (CRUD + lifecycle + validation), controller tests for auth scoping.

**Acceptance:** scenarios fully CRUDable via API; archived scenarios stop appearing in catalog queries; mutations re-materialize affected assistants; admin auth scoping enforced.

**Risk:** medium. Standard new-entity slice.

### Slice 4 — Materialization: scenario catalog + active developer block (high)

**Goal:** scenarios visible to the model both as a catalog (cached) and as a working block (volatile).

**Do:**

- Extend `enabled-skills-prompt-materialization.ts`: for each enabled Skill, render under its instruction card a compact `Available scenarios:` list with `key`, `displayName`, 1-line description, and 1-line recommended-tools hint. Only `status = active` scenarios. Bounded by a constant (default 8 scenarios per Skill rendered; surplus omitted with a `... +N more` footer).
- New service `apps/runtime/src/modules/turns/build-active-scenario-block.service.ts` (or co-located in `turn-context-hydration.service.ts`): when the incoming `RuntimeTurnRequest` carries `skillDecisionState.activeScenarioKey !== null`, look up the scenario in the materialized bundle catalog and compose the `## Active Scenario` block per D4. Emit it as a `ProviderGatewayTextMessage` with `cacheRole: "volatile_context"`.
- **Volatile-context wrappers are currently memory-specific** (Slice 0 ledger R3): provider clients hard-code `<recent_short_memory>` (Anthropic) and `<persai_contextual_memory>` (OpenAI) around the re-projected user block. Slice 4 must widen this — recommended approach: split the inner wrapper by `kind` carried on the volatile message (e.g. `volatileKind: "memory" | "active_scenario"` projecting to `<recent_short_memory>` vs `<active_scenario>`). The outer rail (drop-from-cached-prefix + re-project-as-user-block-before-current-question) is unchanged. **This widening changes the bytes of the memory wrapper too**, so it counts as **one deliberate one-time cache invalidation** for the memory path in addition to the cache events from Slice 7. Acceptance: the existing memory wrapper test must be updated to assert the new (parameterised) wrapper, not the literal old string.
- Wire into the runtime turn assembly so the block lands immediately before the current user question (existing volatile-context insertion point).
- Surface the scenario catalog in the materialized runtime bundle (`apps/api/.../materialize-assistant-published-version.service.ts`) under `bundle.skills.enabled[i].scenarios[]` so runtime can resolve `scenarioKey → steps` without an extra API round-trip during turn execution.
- Tests: materialization test asserting catalog rendering; runtime test asserting volatile-block composition for an active scenario; provider-gateway test (extension of existing volatile-context invariant test) asserting the block is not part of the cached prefix.

**Acceptance:** model sees the scenario catalog in the cached prefix; once engaged with a scenario, model sees the working block on every subsequent iteration of the tool loop; cached system prefix bytes are unchanged across engage/release.

**Risk:** high (touches both cached prefix and volatile path; prompt-cache invariant must hold). Mitigation: snapshot test on the cached prefix bytes across an engage/release cycle.

### Slice 5 — Admin UI for scenarios (medium)

**Goal:** admin can create / edit / archive scenarios through `/admin/skills`.

**Do:**

- Extend `apps/web/app/admin/skills/page.tsx` (and assistant-side viewer if exposed) with a "Scenarios" section per Skill, listing scenarios + status, with create / edit / archive actions.
- Structured step editor per Slice 3 schema: drag-reorder, directive (textarea), recommended tool (dropdown of native tool keys + null), mayBeSkippedIf (text), negativeGuards (repeatable list).
- Identity fields: key (slug, immutable after create), localized displayName + description, iconEmoji, displayOrder, status (draft/active/archived).
- Intent examples: repeatable text list (3-5 entries recommended; hard cap 10).
- Live preview: two panes — (a) catalog rendering as it will appear in the `Enabled Skills` block, (b) full `## Active Scenario` developer block as the model will see it.
- Validation: `key` matches `^[a-z][a-z0-9_]{1,63}$`; at least one step; final step is required to terminate (last step's directive should reference `skill({ release })` — soft warning, not blocker).
- Tests: `apps/web/app/admin/skills/page.test.tsx` updated for scenario CRUD + validation.

**Acceptance:** admin can create, edit, activate, archive scenarios; live preview matches what the model receives; archive flow is non-destructive (sets `status = archived`).

**Risk:** medium. Standard admin-UI slice with structured editor.

### Slice 6 — Dead-code sweep (high)

**Goal:** one path only. Zero remaining references to the cadence/classifier/lexical-gate stack.

**Do (Slice 0 ledger Section 5 is the authoritative hit list — execute it in full):**

- Delete `apps/runtime/src/modules/turns/skill-state-routing.service.ts` (whole file: class, `SKILL_STATE_OUTPUT_SCHEMA`, `tryForegroundActivation`, `shouldTryForegroundActivation`, `matchesSkillLexically`, and the public `checkSkillState` method).
- Delete its test file (`apps/runtime/test/skill-state-routing.service.test.ts`).
- Delete the runtime HTTP entry point that exposes the classifier as a checkable endpoint (Slice 0 ledger R9): the `POST /api/v1/turns/skill-routing-check` route handler in `apps/runtime/src/modules/turns/interface/http/turns.controller.ts` and its module wiring.
- Delete the API-side caller chain (Slice 0 ledger R9): `TurnExecutionService.checkSkillRouting` in `apps/runtime/src/modules/turns/turn-execution.service.ts`; `WebRuntimeTurnClientService.checkSkillRouting` in `apps/api/src/modules/workspace-management/application/web-runtime-turn-client.service.ts`; every call to it from `send-web-chat-turn.service.ts`, `send-native-web-chat-turn.service.ts` paths, and `stream-web-chat-turn.service.ts`. Tests covering this chain (`send-web-chat-turn.service.test.ts`, `send-native-web-chat-turn.service.test.ts`, `stream-web-chat-turn.service.test.ts`) updated to the new no-classifier flow.
- Delete cadence helpers in `auto-skill-routing-state.service.ts` (already done in Slice 1); confirm zero residual.
- Drop `RuntimeSkillCadenceState` type, all `cadenceState` references, `messageCountSinceCheck`, `backgroundCheckQueuedAtMessageIndex` from contracts.
- Delete admin runtime UI section for skill routing cadence (already done in Slice 1); confirm clean.
- Delete `assistantWebChatStateSkillCadenceState` and `assistantWebChatStateSkillCadenceStateBootstrapReason` generated contract types (or regenerate after OpenAPI cleanup).
- Grep across `apps/`, `packages/`, `docs/`: zero matches for `matchesSkillLexically`, `tryForegroundActivation`, `shouldTryForegroundActivation`, `runBackgroundCheck`, `markBackgroundCheckQueued`, `markBackgroundCheckFailed`, `skillCadenceState`, `DEFAULT_SKILL_ROUTING_*`, `checkSkillState`, `checkSkillRouting`, `skill-routing-check`. (Documentation/archive matches in `docs/CHANGELOG.archive-*.md`, `docs/SESSION-HANDOFF.archive-*.md`, closed ADRs — kept; they are historical.)
- Update all affected tests to the new state shape.
- No flag-gating, no fallbacks, no compatibility shims.

**Acceptance:** clean grep for every deleted symbol across active code; full verification gate green; the active-tree size measurably smaller (slice handoff includes line-count diff).

**Risk:** high (touches many files). Mitigation: orchestrator runs full repo grep audit before approving the slice.

### Slice 7 — UX indicator + selection guide rule (medium)

**Goal:** the user sees a quiet `Done — <Skill> · <Scenario>` line in the collapsed working block; the model is told (in the selection guide) to engage skills first.

**Do:**

- Extend `AssistantWebChatState.activeTurn` and `assistant_chats/.../messages` API to expose `engagementSummary: { skillDisplayName, scenarioDisplayName? } | null` (OpenAPI + generated contracts).
- Persist `engagementSummary` snapshot at turn completion in `AssistantWebChatTurnAttempt` (additive metadata column or `metadata` JSON extension — minimize migrations; prefer reusing existing metadata JSON if present).
- Stream the summary in the SSE final event (`turn_completed` or equivalent) so the web client can render it without a follow-up fetch. Reconcile from history fetch on reattach.
- Update the web chat `:::working` block component (post-ADR-112 working-notes implementation) to render the engagement annotation **inline in the toggle row, immediately to the right of the `Выполнено ▾` toggle**, as a sibling of the label (not a child of the collapsed body). Subdued color, single row, ellipsis on narrow widths (Skill name preserved, scenario name truncated first). Renders only when `engagementSummary` is present; absent annotation when null.
- Web localization: ru `Выполнено`, en `Done` (the toggle label). The annotation itself (`<Skill> · <Scenario>` / `<Skill>`) is already-localized strings from `displayName` JSON — no UI copy needed for the annotation body. No keys in the `agents` template; toggle label is UI copy.
- Add the D7 rule line to the `tools` template default in `apps/api/prisma/bootstrap-preset-data.ts`. Update `apps/web/app/admin/presets/page.test.tsx` (the ADR-117 Slice 1 test) for the new expected default.
- Cache-prefix change: noted as a deliberate one-time invalidation (same as ADR-117 Slices 1-2). Materialization rollout required.
- Tests: web chat component test for the indicator; presets page test; api send/stream test asserting the summary is in the projection.

**Acceptance:** indicator appears for engaged turns; absent for non-engaged turns; the `tools` template default contains the Skills rule exactly once; ADR-117 Slice 1 test passes against the new default.

**Risk:** medium (web + prompt prefix). Mitigation: coordinate with ADR-117 owner on the template default change (this slice bumps the default a second time after ADR-117 Slice 2 already changed it).

### Slice 8 — Golden tests + docs + ADR closure (low)

**Goal:** lock invariants; finalize docs.

**Do:**

- Golden test 1: `assistant_chats.skillDecisionState.{activeSkillId, activeScenarioKey}` is writable only through the `skill` tool execution path. Test asserts by source grep + service-call audit.
- Golden test 2: cached system prefix bytes for a representative assistant are byte-stable across `engage` / `release` / `engage(scenarioKey)` cycles. Test asserts by composing the system prefix twice with different `skillDecisionState` and comparing bytes.
- Golden test 3: no active-code reference to any deleted symbol (recheck of Slice 6 grep, executed as a test).
- Update `docs/API-BOUNDARY.md`: add the `skill` tool and the new internal API endpoint to the Runtime tool boundary section; document the engagement-summary projection field on web chat state.
- Update `docs/ARCHITECTURE.md`: add a short paragraph under "Control plane / Runtime plane" describing the three-level engagement model and pointing at this ADR.
- Update `docs/DATA-MODEL.md`: add `SkillScenario` to the Knowledge/Skills section; update the `assistant_chats.skillDecisionState` shape note; record the dropped `skillCadenceState` column.
- Update `docs/TEST-PLAN.md`: add an ADR-118 focused-checks section listing the relevant tests.
- Update `docs/CHANGELOG.md` and `docs/SESSION-HANDOFF.md` per the normal slice-landing discipline.
- Close ADR-118 in this file (`Status: Accepted → Closed`) with reachability proofs and a final summary of what landed.

**Acceptance:** all three golden tests green in CI; docs updated; ADR closed.

**Risk:** low.

---

## Consequences

### Positive

- Activation happens **on the turn the user asks**, not 3-5 turns later. The biggest UX problem with current Skills goes away.
- The model has structured, admin-authored workflows it can execute reproducibly. "Сделай карусель" becomes a one-call invocation (`skill({engage, marketer, instagram_carousel})`) with predictable output structure.
- One source of truth for activation (`skill` tool); one source of truth for scenarios (`SkillScenario` entity). No scattered heuristics, no parallel paths.
- Cached prompt prefix stays stable across engage/release. Volatile-context pattern (already paid for) carries the per-turn dynamic content.
- The whole cadence/classifier/lexical-gate stack disappears, reducing surface for future bugs.
- Admin gets a new product capability (authoring scenarios) without a new admin page — the `/admin/skills` surface absorbs it cleanly.

### Negative

- Net new product concept (`SkillScenario`) — Prisma migration, contract surface, admin UI, runtime composition, materialization extension. Real work, four medium-or-higher slices.
- One deliberate prompt-cache prefix invalidation when Slice 7 lands (the `tools` template default change). Mitigated by batching with ADR-117 Slices if both are landing close in time.
- Model is now expected to engage Skills proactively. If a model variant fails to engage reliably, Skill KB priority retrieval is missed. Mitigation is **not** a fallback classifier (explicitly out of scope per user direction); the mitigation is the selection-guide rule (D7) and, if telemetry later shows persistent miss rates, a future ADR can add an inline single-shot fallback **on the first user message of a chat only**.
- Scenario adherence is judgment-based, not enforcement-based. If the model collapses an Instagram-carousel into one `image_generate` call without `outputMode=series`, runtime won't stop it. Mitigation: structured developer block (numbered imperatives + guards + recommended tool), not constraints. If telemetry shows specific recurring adherence failures, future work can add structural progress-display (matching by `recommendedToolCall`) — explicitly not in ADR-118 scope.

### Out of scope (explicit non-goals)

- Multi-skill simultaneous activation. One at a time. (May be revisited under a future ADR if usage patterns demand it.)
- JSON-schema constraints on tool args based on active scenario. Tried in design; rejected because it mutates the cached system prefix per turn.
- Post-call validation of tool args against scenario declaration. Same reason — the user's explicit instruction was "в виде инструкции, не constraint".
- Inline single-shot fallback classifier when model forgets to engage. Explicitly deferred ("пока без").
- Mobile/Telegram UX indicator. Slice 7 covers web only; Telegram may show the indicator as a separate small text in the assistant reply if a future slice opts in.
- AI-assisted scenario authoring (extension of `GenerateSkillAuthoringDraftService`). Useful, not required for v1.

## Alternatives considered

**A. Keep the background classifier; only remove the lexical foreground gate.**
Rejected. The classifier itself is the source of latency (`every 5 user messages`) and the source of the cadence heuristics. Removing only the lexical gate doesn't fix [F1].

**B. Make `Enabled Skills` block conditional on decision state; activate Skill implicitly when needed.**
Rejected. The current architecture already renders enabled Skills unconditionally — this is the correct decoupling. The activation question is purely about retrieval priority and scenario context, not about whether instructions are visible. Coupling them would make the cached prefix mutate per turn.

**C. Two separate tools — `focus_skill` and `start_skill_scenario`.**
Rejected on simplicity grounds. One discriminated-union tool with `action` covers all four operations (engage-free, engage-scenario, switch, release) with the same mental model the user already has for `files`, `document`, `memory_write`.

**D. Implicit activation via first `knowledge_search({ source: "skill" })`.**
Rejected. Loses the cache key, loses the UI signal, and ties activation to a side effect of a query rather than an explicit declaration. Less auditable.

**E. Scenarios as free-form markdown.**
Rejected. Repeats the heuristic mistake of the catalog's `modelUsageGuidance` (ADR-117). Structured `steps[]` with `directive + recommendedToolCall + negativeGuards` is the same discipline applied to scenarios.

**F. Enforcing scenario adherence via JSON-schema args constraints or post-call validation.**
Rejected on cache-discipline grounds (constraints) and on user direction (post-call validation rejected as "сложно, лучше инструкция"). Adherence comes from structured developer block + model judgment + soft hints, not from runtime enforcement.

## Rollout & safety

- Slices 1 and 2 must land in the same deploy. Slice 1 makes the old cadence inert; Slice 2 restores activation through the new tool. The window between them is the only period where activation has no driver — minimize it by landing both in one materialization rollout.
- Prisma migration in Slice 1 is reversible (column drop with documented re-creation). Migration in Slice 3 is additive (new table). Both pass through the existing `persai-dev-migrations` GitHub Environment approval per AGENTS CI policy.
- Materialization rollout is required at the end of Slice 4 (catalog visible) and again at the end of Slice 7 (selection-guide rule + `tools` template default change). Both must be deliberate rollouts noted in the slice handoff with the resulting prompt-cache prefix change.
- No git push, no deploy without explicit user direction (repo rule). Each slice leaves a clean, green, commit-ready tree.
- Live acceptance gate at the end of Slice 7 (before Slice 8 closure): one founder live-test with `alex@agse.ru` on `persai-dev`, exercising (a) free-form domain discussion under enabled Marketer Skill, (b) `instagram_carousel` scenario engage and completion, (c) scenario switch mid-chat, (d) explicit release. UX indicator must show on (a), (b), (c); must be absent on (d) after release.

---

## Superseded by ADR-119

ADR-118's skill-engagement design (Skills + scenarios + volatile active-scenario block + UX indicator) is preserved as the **base mechanism**. ADR-119 builds on top of it with:

- **Progressive disclosure** (Slice 3): skill body moves to `skill({engage})` tool result; compact `<skill>` catalog entry stays in the AOT cached `<enabled_skills>` prefix. Many Skills can be installed without context penalty.
- **Volatile scenario block restructured to canonical XML** (Slice 4): `<persai_active_scenario>` with structured `<step>`, `<directive>`, `<expected_user_response>`, `<next_step_trigger>`, `<negative_guards>` elements replaces ADR-118 D4's prose `## Active Scenario` markdown.
- **New step-level fields** (Slice 4 + Slice 10): `expectedUserResponse`, `nextStepTrigger`, `recoveryGuidance` in `SkillScenarioStep` JSON; `firstStepPreview` override at scenario level (Slice 10 migration `20260618160000_adr119_first_step_preview`).
- **Scenario `firstStepPreview` for catalog override** (Slice 10): admins can override the auto-derived `<first_step_preview>` tag in the AOT Skills catalog.
- **Selection guide priority order with Skills #1** (Slice 6): `<priority_order>` in the `<tool_usage_policy>` block explicitly lists Skills as the first gate before any media, knowledge, or other tool call.
- **Provider-level parallel-tool-call discipline** (Slice 2): `disable_parallel_tool_use: true` (Anthropic) / `parallel_tool_calls: false` (OpenAI) when `skillsEnabled === true` and tools are present — the only reliable mitigation against the model firing `skill({engage})` in parallel with a media tool.

Where ADR-118 and ADR-119 disagree, **ADR-119 is the authority**. ADR-118 remains the reference for the engagement-mechanism rationale; ADR-119 is the reference for the prompt-architecture implementation.

**Reachability**: see ADR-119 Closure section for the slice-by-slice commit SHA list. ADR-119 file: `docs/ADR/119-prompt-architecture-and-2026-context-engineering.md`.
