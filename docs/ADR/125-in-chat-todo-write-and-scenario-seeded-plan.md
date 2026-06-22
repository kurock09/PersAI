# ADR-125 — In-chat TodoWrite and scenario-seeded plan

Status: Implemented locally — pending deploy + live validation
Date: 2026-06-22
Baseline SHA: `b29c3873`
Supersedes: none
Superseded-by: none

## Context

PersAI assistants already engage Skills with scenarios (ADR-119), and the active scenario block is reinjected on every turn as `<persai_active_scenario>` XML. But two structural gaps remain:

1. The model cannot **mutate** scenario progress between turns. The scenario block is static per skill version; the model has no way to mark a step done, add a subtask the user just asked about, or close work as cancelled.
2. The user cannot **see** the active plan as a structured list. Today plans live only in prose between assistant and user, with no orchestrator-visible source of truth.

Both gaps surface when assistants run multi-step work (DeepSeek tool-loops, scenario-driven flows, ad-hoc planning conversations). The orchestration concept that solves both is the same as Cursor's: a per-thread structured todo list that the model writes through a tool and the user sees as a collapsible block.

## Decision

Introduce **`todo_write`** as a native PersAI tool, mirroring the architecture of `memory_write` and `skill` (model-owned, zero-provider-cost, durable, reinjected into the next turn's context).

The tool operates on a per-chat hierarchical todo list. The model **owns** the list — it can add, mutate, complete, cancel, and clear items. The server enforces invariants (one `in_progress` per parent, status transitions, parent-child closure). The list is **seeded by skills**: when the model calls `skill({action:"engage", scenarioKey:"..."})`, the runtime materialises scenario steps as todos embedded under the currently `in_progress` parent if one exists, otherwise as top-level items.

This is **"Path C"** — server-seeded, model-mutated. The model is the durable orchestrator after seeding; scenarios are now seeds, not parallel state.

## Scope fence

In scope:

- new Prisma model `AssistantChatTodo` with hierarchical parent/child relationship
- new runtime tool `todo_write` (descriptor + projection + dispatcher + service)
- new server-side invariants (single in_progress per parent, status transitions, soft 200 cap per chat)
- new reinjection block in `turn-context-hydration.service.ts` (capped window ~12)
- skill-engage seeding hook (idempotent via `seed_key`, append on engage, embedded under in_progress)
- new web UI inline block (Cursor-style collapsible, parent + indented children, subtle skill suffix)
- new API endpoints: list (by chat), clear-all (by chat)
- admin presets entry: `todo_write` in `PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER`
- plan management: `todo_write` in `STARTER_TRIAL_TOOL_POLICY` `active:true` (parity with files/grep/glob)
- activity-badge lifecycle labels for `todo_write` (ru + en)
- golden prompt snapshot updated

Out of scope (deliberately):

- cross-chat continuity (lives in ADR-120 open-loops)
- completion criteria / proof contracts (schema reserves a `completion_criteria JSONB NULL` column, but v1 does not use it)
- runtime stream resilience (separate future ADR)
- background tasks unification with todos
- `cancelled` status (only `pending` / `in_progress` / `completed` on v1; expand later if needed)
- user-side editing in UI (only clear-all on v1)
- scenario-step linkage beyond seeding (no live two-way binding between scenario state and todos)
- forbidden refusal on overflow (soft cap, the model may keep adding, oldest active items roll out of the prompt window)

## Schema

New table:

```prisma
enum AssistantChatTodoStatus {
  pending
  in_progress
  completed
}

enum AssistantChatTodoOrigin {
  model_authored
  scenario_seeded
}

model AssistantChatTodo {
  id                  String                      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  chatId              String                      @map("chat_id") @db.Uuid
  assistantId         String                      @map("assistant_id") @db.Uuid
  parentId            String?                     @map("parent_id") @db.Uuid
  content             String                      @db.Text
  status              AssistantChatTodoStatus     @default(pending)
  origin              AssistantChatTodoOrigin     @default(model_authored)
  seedSkillId         String?                     @map("seed_skill_id") @db.Uuid
  seedSkillLabel      String?                     @map("seed_skill_label")
  seedScenarioKey     String?                     @map("seed_scenario_key")
  seedKey             String?                     @map("seed_key")
  sortOrder           Int                         @map("sort_order")
  completionCriteria  Json?                       @map("completion_criteria") @db.JsonB
  createdAt           DateTime                    @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt           DateTime                    @updatedAt @map("updated_at") @db.Timestamptz(6)
  completedAt         DateTime?                   @map("completed_at") @db.Timestamptz(6)

  chat                AssistantChat               @relation(fields: [chatId], references: [id], onDelete: Cascade)
  parent              AssistantChatTodo?          @relation("AssistantChatTodoChildren", fields: [parentId], references: [id], onDelete: Cascade)
  children            AssistantChatTodo[]         @relation("AssistantChatTodoChildren")

  @@index([chatId, sortOrder])
  @@index([chatId, parentId, sortOrder])
  @@index([chatId, seedKey])
  @@map("assistant_chat_todos")
}
```

`sortOrder` is the in-list ordering (parents only); children are ordered by their own `sortOrder` within `parentId`. New items append (`max(sortOrder)+1`).

Idempotency: `(chatId, seedKey)` uniquely identifies one scenario-seeded batch. Re-engaging the same scenario with the same `seedKey` is a no-op (no duplicates, no resets).

## Tool contract

Schema (model-facing, OpenAI-compatible):

```json
{
  "name": "todo_write",
  "description": "Manage the orchestrator's structured plan for this chat. ... (full WHEN/WHEN NOT/EXAMPLES/GOTCHAS block)",
  "input_schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["action"],
    "properties": {
      "action": {
        "type": "string",
        "enum": ["add", "update", "complete", "remove", "clear"],
        "description": "One operation per call."
      },
      "items": {
        "type": "array",
        "description": "Required for action=add. Each item: { content, parentId?, status? }.",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["content"],
          "properties": {
            "content":   { "type": "string", "minLength": 1, "maxLength": 240 },
            "parentId":  { "type": "string", "description": "Optional parent todo id to attach as a child." },
            "status":    { "type": "string", "enum": ["pending", "in_progress"], "description": "Initial status; defaults to pending. completed cannot be set on add." }
          }
        }
      },
      "id":        { "type": "string", "description": "Required for action=update | complete | remove. The exact id of the todo." },
      "content":   { "type": "string", "minLength": 1, "maxLength": 240, "description": "Optional new content for action=update." },
      "status":    { "type": "string", "enum": ["pending", "in_progress", "completed"], "description": "Optional new status for action=update." },
      "parentId":  { "type": "string", "description": "Optional new parent for action=update. Use the empty string to detach to top-level." }
    }
  }
}
```

Result (runtime contract):

```ts
type RuntimeTodoWriteToolResult = {
  toolCode: "todo_write";
  executionMode: "inline";
  action: "applied" | "skipped";
  reason: string | null;
  warning: string | null;
  todos: Array<{
    id: string;
    parentId: string | null;
    content: string;
    status: "pending" | "in_progress" | "completed";
    origin: "model_authored" | "scenario_seeded";
    seedSkillLabel: string | null;
  }>;
  windowed: boolean;
};
```

The `todos` array on the response is the **post-mutation full visible window** so the model immediately sees the current plan after the call. The window matches the prompt reinjection window (see below).

## Server-side invariants (enforced in `RuntimeTodoWriteToolService` via API)

1. `add`: each item must have non-empty content; if `parentId` is set, parent must exist and not be `completed`. If a parent is set, the child status defaults to `pending` (cannot start completed).
2. `update`:
   - cannot resurrect a `completed` todo to `pending` / `in_progress`
   - cannot complete a parent while it has at least one `in_progress` child (children must reach `completed` first)
   - parent reparent is allowed only between top-level and existing non-completed parents
3. `complete`: sets `completed_at = now()`; rejects if invariant in (2) fails
4. `remove`: cascades to children (DB-level)
5. `clear`: deletes all todos in chat. Used by UI button, also exposed to model.
6. Cap: hard 500 rows per chat at DB-level (rejected with `cap_exceeded`); soft 200 advised in the prompt window.

## Reinjection — prompt window

New block emitted by `turn-context-hydration.service.ts` next to the existing memory / active-scenario blocks (volatile context, not cached system prefix):

- block header: `<persai_chat_plan>`
- contents: a window of ~12 items selected as `(all in_progress) + (most recent ~6 pending) + (most recent ~2 completed)`, ordered by sortOrder. Children always co-locate with their parent (no orphaned children in the window).
- when total > window: emit a `+N more` tail line.
- block is omitted entirely when the list is empty (no `You have no todos` chatter).
- max items in block: 12 (constant `RUNTIME_CHAT_PLAN_WINDOW_MAX`).

## Skill seeding (Path C)

In the engage flow, after `RuntimeSkillToolService.executeEngageWithScenario` resolves the scenario, the runtime calls a new API endpoint `POST /v1/internal/chats/:chatId/todos/seed-skill-scenario` with:

```ts
{
  skillId: string;
  skillDisplayName: string;
  scenarioKey: string;
  steps: Array<{ number: number; directive: string }>;
  seedKey: string; // hash of (skillId, scenarioKey, skill.version, scenario.version)
}
```

API behaviour:

1. If a row with `(chatId, seedKey)` already exists, return `{ seeded: false, reason: "already_seeded" }`.
2. Else, resolve placement:
   - if any todo is `in_progress` (deepest first), attach the seeded steps as children of that one
   - else create top-level seeded steps
3. Each created row gets `origin: "scenario_seeded"`, `seedSkillId`, `seedSkillLabel: skillDisplayName`, `seedScenarioKey`, `seedKey`.
4. Sort order: append after the current max sortOrder within the chosen parent.

Disengage (`skill({action:"release"})`) does **not** delete seeded todos. They remain in the plan as ordinary items, owned by the model.

## UI (web)

New inline block rendered in the chat thread, before the assistant message that triggered it (similar to other inline activity blocks):

- Cursor-style **collapsible** head with chevron — collapsed by default after the first turn it appears in; expanded for the active turn.
- One row per todo:
  - left: status icon (empty circle / spinning circle / check)
  - center: content text (strikethrough when completed)
  - right (subtle): for `scenario_seeded`, italic gray suffix ` · {seedSkillLabel}` — no icon, no badge box
- Children: indented one level under parent, same row layout.
- Tail row when window truncated: gray ` +N more` line.
- Footer: `Clear plan` button (text link, gray, confirmation modal).
- Empty state: block is not rendered at all.
- i18n: ru + en strings for `Plan`, `Clear plan`, `Confirm clear`, `+N more`.
- Loading and error states: skeleton row for fetch; inline red text for clear-all failure.

The block is **always present in the message stream when the chat has any todos**, anchored to the last assistant message that produced a `todo_write` result OR at the bottom of the stream when no recent mutation. Exact placement to be confirmed in Slice 3 (orchestrator review).

## Admin surfaces

`/admin/presets`:

- `todo_write` added to `PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER` (between `memory_write` and `quota_status`, since it's a model-cognition tool, not a quota-driven one).
- Per-Tool Model Instructions card surfaces description + usageGuidance with the same "Use code default" / override toggle as other native tools.

`/admin/plans`:

- `todo_write` row appears in Plan Tools catalog with toggle activation. Starter Trial plan ships `active:true` (parity with `files`, `grep`, `glob`).
- catalog entry has `displayName: "Plan / TodoWrite"`, `description`, `modelDescription`, `modelUsageGuidance` per the same format as grep/glob (WHEN / WHEN NOT / EXAMPLES / GOTCHAS).
- `capabilityGroup: "workspace_ops"`, `toolClass: "utility"`, `policyClass: "plan_managed"`.

Activity-badge labels:

- `todo_write_started: activityTodoWriteStart`
- `todo_write_finished: activityTodoWriteDone`
- `todo_write_failed: activityTodoWriteFailed`
- ru/en strings added to `apps/web/messages/{en,ru}.json` `chat.*` block.

## Slice plan

**Slice 1 — Backend foundation (no UI, no skill seeding)**

Files touched (sub-agent must verify and may add neighbours as needed):

- `apps/api/prisma/schema.prisma` — add model + enums
- `apps/api/prisma/migrations/<TS>_adr125_assistant_chat_todos/migration.sql` — forward migration
- `apps/api/prisma/tool-catalog-data.ts` — add `todo_write` catalog row + `STARTER_TRIAL_TOOL_POLICY` entry
- `apps/api/src/modules/workspace-management/application/assistant-chat-todos.service.ts` (NEW)
- `apps/api/src/modules/workspace-management/application/assistant-chat-todos.controller.ts` (NEW, internal-only POST endpoints used by runtime + a public-ish GET/DELETE for web)
- `packages/runtime-contract/src/index.ts` — `RuntimeTodoWriteToolResult` type + `PERSAI_RUNTIME_TODO_WRITE_ACTIONS` constants
- `apps/runtime/src/modules/turns/runtime-todo-write-tool.service.ts` (NEW) — mirror `runtime-memory-write-tool.service.ts` shape
- `apps/runtime/src/modules/turns/turn-execution.service.ts` — add `TODO_WRITE_TOOL_CODE = "todo_write"`, register service in constructor + module wiring, add dispatcher case
- `apps/runtime/src/modules/turns/turns.module.ts` — register provider
- `apps/runtime/src/modules/turns/persai-internal-api.client.service.ts` — add `applyTodoWriteAction` / `seedSkillScenarioTodos` / `readChatPlanWindow` methods
- `apps/runtime/src/modules/turns/native-tool-projection.ts` — add `createTodoWriteToolDefinition`, wire `todo_write` projection (allowed when policy is `enabled + visibleToModel + usageRule=allowed + executionMode=inline`)
- `apps/runtime/src/modules/turns/turn-context-hydration.service.ts` — add the `<persai_chat_plan>` reinjection block builder + window resolver
- `apps/api/test/assistant-chat-todos.service.test.ts` (NEW) — unit tests for invariants
- `apps/runtime/test/runtime-todo-write-tool.service.test.ts` (NEW)
- `apps/runtime/test/native-tool-projection.test.ts` — add todo_write projection assertions
- `apps/runtime/test/turn-context-hydration.service.test.ts` — add window block assertion
- wire all new test files into `apps/runtime/test/run-suite-isolated.ts` and `apps/api/test/run-suite.ts`

Constraints:

- absolutely no TODO scaffolding
- no parallel code paths
- descriptor matches WHEN / WHEN NOT / EXAMPLES / GOTCHAS structure used by every other native tool
- migration uses `CREATE TABLE IF NOT EXISTS` + explicit indexes; safe forward and rollback
- bundle compile pipeline must materialise `todo_write` policy onto `bundle.governance.toolPolicies` so projection sees it — verify this is automatic from the tool catalog seed (it should be, like grep/glob)

**Slice 2 — Skill engage seeding**

Files:

- `apps/runtime/src/modules/turns/runtime-skill-tool.service.ts` — after `executeEngageWithScenario` returns engagement outcome, call `persaiInternalApiClientService.seedSkillScenarioTodos({...})` with `seedKey = hash(skillId, scenarioKey, skill.version, scenario.version)`. Failures are warn-logged and do not fail engage.
- `apps/api/src/modules/workspace-management/application/assistant-chat-todos.service.ts` — `seedSkillScenarioTodos` method idempotent on `(chatId, seedKey)`, placement under deepest `in_progress` parent or top-level
- `apps/runtime/test/runtime-skill-tool.service.test.ts` — extend with seeding tests (no in_progress, with in_progress, re-engage idempotency, archived skill graceful)
- `apps/api/test/assistant-chat-todos.service.test.ts` — extend with `seedSkillScenarioTodos` test cases

**Slice 3 — Web UI**

Files:

- `apps/web/app/app/_components/inline-chat-plan.tsx` (NEW)
- `apps/web/app/app/_components/inline-chat-plan.test.tsx` (NEW)
- `apps/web/app/app/_components/chat-message.tsx` — render `<InlineChatPlan>` block in stream
- `apps/web/app/app/_components/use-chat.ts` (or sibling) — fetch + cache + invalidate plan on `todo_write` activity event
- `apps/web/messages/en.json` + `apps/web/messages/ru.json` — `chat.plan*` strings

**Slice 4 — Admin / Plan / Lifecycle / Snapshot**

Files:

- `apps/web/app/admin/presets/page.tsx` — append `todo_write` to `PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER`
- `apps/web/app/app/_components/activity-badge.tsx` — add `todo_write_*` lifecycle keys + ru/en messages
- `apps/web/messages/en.json` + `apps/web/messages/ru.json` — `activityTodoWriteStart / Done / Failed`
- update golden prompt snapshot test if any (locate via grep on `prompt-golden` / `golden-snapshot`)
- `apps/api/test/seed-tool-catalog.test.ts` — extend with `todo_write` row assertions

## Acceptance

- DB has the new table + indexes after migration
- Live: model can call `todo_write({action:"add", items:[{content:"…"}]})` and the result includes the windowed plan
- Live: model can call `todo_write({action:"complete", id:"…"})` and the row is marked completed
- Live: a follow-up turn sees the `<persai_chat_plan>` block in the prompt
- Live: engaging a scenario seeds steps as children of the current in_progress parent (or top-level)
- Live: re-engaging the same scenario does not duplicate seeded steps
- UI: plan block appears, collapses on click, renders parents + children, suffix appears on seeded items
- Admin: `/admin/presets` has the `todo_write` card
- Admin: `/admin/plans` shows `todo_write` toggle, Starter Trial defaults to active
- AGENTS gate (lint + format + typecheck × 4 packages + relevant unit suites + golden snapshots) green
- One push at end → deploy → live verify

## Implementation status

- Slice 1 (backend foundation): **Implemented.** New Prisma model + migration (`assistant_chat_todos`, enums `AssistantChatTodoStatus`/`AssistantChatTodoOrigin`); `AssistantChatTodosService` enforcing invariants (single `in_progress` per parent, status transitions, parent not closable while a child is open, soft ~200 / hard 500 caps, content length cap, cycle detection); internal-runtime + user-facing controllers (`GET`/`DELETE /v1/assistant/chats/web/:chatId/plan`, `POST /v1/internal/runtime/chat-todos/{apply,window,seed-skill-scenario}`); runtime contract types (`RuntimeTodoItem`, `RuntimeTodoWriteToolResult`, `PERSAI_RUNTIME_TODO_WRITE_*` constants, `RUNTIME_CHAT_PLAN_WINDOW_MAX = 12`); native-tool projection (`createTodoWriteToolDefinition`); runtime dispatcher case + `RuntimeTodoWriteToolService`; `<persai_chat_plan>` reinjection block in `turn-context-hydration.service.ts` (`volatileKind: "chat_plan"`, wrapped by every provider client).
- Slice 2 (skill engage seeding): **Implemented.** `executeEngageWithScenario` calls `persaiInternalApiClientService.seedSkillScenarioTodos(...)` after a successful `updateSkillState`; idempotent via `(chatId, seedKey)` where one batch shares one `seedKey` (the schema uses a non-unique `@@index([chatId, seedKey])` and the service does the existence check + inserts inside a single Prisma transaction). Placement: under deepest `in_progress` parent or top-level when there is no parent. Failures are warn-logged and never fail engage. Unsupported channels are silently skipped.
- Slice 3 (web UI): **Implemented.** `<ChatPlanCard>` (Cursor-style collapsible card, inline above the composer in `ChatArea`) with status icons (pending circle / in-progress spinner / completed strike-through), parent/child indenting, `from <skill>` pill for `scenario_seeded`, `done / total` counts, optional `+N more` when windowed, inline clear-confirm row. `useChat` integration: `chatPlan`/`chatPlanTotalCount`/`chatPlanWindowed` state + `refreshChatPlan` / `clearChatPlan` callbacks; refetch on chat load, on terminal turn completion/interruption/failure, on `todo_write` SSE tool events, and on soft-detach reconcile / focus-resume paths. New API client helpers `getAssistantWebChatPlan` / `clearAssistantWebChatPlan`. Lifecycle labels for `todo_write_started/finished/failed` wired through `ACTIVITY_LABEL_KEYS`. New ru/en `chat.plan*` and `activityTodoWrite*` strings.
- Slice 4 (admin + catalog regression): **Implemented.** Backend canonical `PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER` and the web `/admin/presets` mirror both include `todo_write` (inserted after `memory_write`). `/admin/plans` shows the `todo_write` toggle automatically (existing plan-managed backfill seeds the row; new `TOOL_CARD_DESCRIPTION.todo_write` blurb provides a one-liner in the card). New focused regression test `apps/api/test/tool-catalog-data.test.ts` locks the `todo_write` catalog row (`displayName: "Todo Write"`, `policyClass: "plan_managed"`, `toolClass: "utility"`, `capabilityGroup: "workspace_ops"`, non-empty model description/usage guidance) and the Starter Trial activation (`active: true`, both limits `null`). Selection-guide template and byte-golden snapshot were intentionally left untouched — `todo_write` is exposed to the model via native tool projection (Slice 1), so editing `<tool_usage_policy>` would expand scope unnecessarily.
- Live-validation: **pending the next dev deploy.** The additive enum + table migration must run; the `Dev Image Publish` workflow will pause on the `persai-dev-migrations` environment per CI policy.
- ADR-119 byte-golden fixture: **unchanged** by ADR-125 (no `<tool_usage_policy>` template edits).
- `displayName` note: ADR text in the slice plan above mentions `"Plan / TodoWrite"`. The shipped catalog row uses `"Todo Write"` (Slice 1) to match the existing single-word convention of `Files`, `Grep`, `Glob`, etc. The implementation is the source of truth; the slice-plan note is left for historical context.
