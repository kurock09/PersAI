# ADR-077: Assistant background task runtime

## Status

Accepted and closed

## Date

2026-04-26

## Closure note

As of 2026-04-29, ADR-077 is archival. The reminder/background-task split, run-history model, evaluator path, and preferred-channel delivery architecture are treated as closed historical truth. Any remaining final verification or cleanup follow-through now lives only in `docs/ADR/078-consolidated-follow-through-program.md`.

## Context

The current `scheduled_action` architecture mixes two different products in one tool and one registry:

- user-visible reminders, where the user expects a concrete reminder message at a scheduled time
- assistant-side background checks, where the assistant should wake later, evaluate a condition, and decide whether to notify the user

The user-reminder half is valuable and must remain. It already fits the product surface named "Задачи для тебя": personal reminders and direct scheduled messages that the assistant planned for the user.

The assistant-background half is the wrong shape. `kind="assistant_check"` turns a background check into a hidden runtime chat turn. If the condition fires, the model is expected to create a second `scheduled_action` with `kind="user_reminder"`, and that second task later handles delivery. This creates a fragile two-step chain:

```text
assistant_check -> hidden LLM turn -> user_reminder -> reminder delivery
```

Observed and architectural problems:

- the hidden turn can finish without a push and still look successful unless the terminal contract is very tightly policed
- the model has to know implementation details instead of returning a direct structured decision
- recurring checks pay for full LLM evaluation on every fire, with weak task-level cost semantics
- run history is not first-class; operators cannot clearly see "checked, condition false", "checked, pushed", or "failed"
- prompt/preset guidance still teaches the model to create follow-up reminders through `scheduled_action`
- user reminders and assistant background actions compete in the same model-facing vocabulary

The existing assistant settings UI already has the right product split:

- "Задачи для тебя" for personal reminders
- "Действия ассистента" for quiet assistant actions that remain visible but do not compete with reminders

ADR-077 makes that split the system truth.

## Decision

### 1. Keep `scheduled_action` only for user reminders

`scheduled_action` remains a model-visible tool for simple user-visible reminders only.

Allowed create shape:

```json
{
  "action": "create",
  "kind": "user_reminder",
  "title": "...",
  "reminderText": "...",
  "runAt": "..."
}
```

The `assistant_check` create mode is removed from the active model-facing contract. There is no legacy create mode, no audience-based fallback, and no backend coercion from assistant-side scheduled actions into user reminders.

### 2. Add a separate hidden `background_task` tool for assistant actions

Assistant-side background work uses a new hidden/internal tool family, provisionally named `background_task`.

It is not a replacement for reminders. It is the execution contract for "Действия ассистента".

Initial actions:

- `create`
- `list`
- `pause`
- `resume`
- `cancel`

Initial create shape:

```json
{
  "action": "create",
  "title": "Check USD/RUB",
  "brief": "Check USD/RUB and notify the user only if it is above 100.",
  "schedule": {
    "kind": "every",
    "everyMs": 3600000
  },
  "mode": "llm_evaluate",
  "pushPolicy": {
    "onlyWhenConditionMet": true
  }
}
```

The create contract stores an evaluator brief and structured scheduling policy. It does not require the platform to hard-code every possible condition type. Deterministic checks can be optimized later, but the baseline is a generic LLM evaluator with a strict structured result.

### 3. Replace hidden chat-turn semantics with a background evaluator

When a background task fires, the executor runs a controlled evaluator step and requires a structured decision:

```json
{
  "decision": "push" | "no_push" | "complete" | "reschedule" | "fail",
  "reason": "...",
  "pushText": "...",
  "nextRunAt": "...",
  "complete": false
}
```

Runtime execution is two-phase:

1. A synthetic background tool run uses the assistant's allowed runtime tools to gather
   evidence or produce artifacts. It is not a visible user chat turn and cannot recursively
   create `scheduled_action` or `background_task` rows.
2. A separate structured evaluator receives the tool-run report, tool invocation summary,
   and artifacts, then returns the final decision JSON.

Rules:

- `pushText` is required when `decision="push"`.
- `pushText` must be the final human-facing message, not an instruction.
- `no_push` is a valid successful outcome and is recorded in run history.
- `complete` closes one-shot or explicitly completed background tasks.
- `reschedule` may only move the task according to the stored schedule policy and platform limits.
- malformed evaluator output is a task-run failure and enters retry/dead-letter handling.

The tool run may use LLM and allowed evidence tools, but neither phase creates a second
`scheduled_action`. The executor owns the final state transition.

### 4. Push directly through the existing notification delivery preference

If the evaluator returns `decision="push"`, the background task executor enqueues a durable notification through the existing notification channel preference:

- use `Assistant.preferredNotificationChannel`
- reuse the existing channel binding truth, including Telegram/web fallback behavior
- do not introduce a second channel selector for background tasks
- enqueue through `AssistantNotificationOutboxService`; the outbox worker is the only active caller of `AssistantNotificationDeliveryService`
- deliver generated artifacts through the same media-delivery adapters when the selected
  channel supports them

The delivery path becomes:

```text
source -> AssistantNotificationOutboxService -> AssistantNotificationOutboxSchedulerService -> AssistantNotificationDeliveryService -> Assistant.preferredNotificationChannel -> Telegram / web fallback / future mobile push
```

not:

```text
background_task -> scheduled_action(user_reminder) -> reminder scheduler -> delivery
```

### 5. Add first-class run history

Run history is stored in a dedicated task-run table, not in logs only.

Proposed tables:

- `assistant_background_tasks`
- `assistant_background_task_runs`

`assistant_background_tasks` stores the current task card state:

- assistant/user/workspace ids
- title
- brief
- schedule
- status: `active | disabled | completed | failed | cancelled`
- next run timestamp
- attempt/retry state
- last run summary
- last push timestamp
- created/updated timestamps

`assistant_background_task_runs` stores each execution:

- task id
- scheduled time and actual start/finish time
- status: `running | no_push | pushed | completed | failed | skipped`
- evaluator decision JSON
- push text when any
- delivery target/result when any
- error code/message when failed
- token/tool usage summary when available

UI placement:

- keep the existing assistant settings "Задачи" section and card layout
- "Задачи для тебя" continues to show user reminders
- "Действия ассистента" shows background tasks
- each assistant-action card can expand to show recent run history: last checked, result, last push, last error
- the count on the card remains the count of current visible background tasks, not the number of runs

### 6. Scheduler ownership

`apps/api` remains the control-plane owner for task persistence, delivery, and user/channel truth.

The first implementation may use the same Postgres claim pattern as the reminder scheduler, but as a separate executor/service:

- separate table
- separate claim fields or claim table
- separate retry/dead-letter policy
- separate logs/events
- no branching inside the reminder scheduler on `audience="assistant"`

The long-term runtime boundary is:

- `apps/runtime` owns request-time tool execution and the evaluator call
- `apps/api` owns task storage, scheduling claims, delivery, and run history

The API executor may call Runtime with a purpose-built evaluator request. It must not simulate a normal web chat thread as the main contract.

### 7. Prompt and preset cleanup

All active prompt/preset/model guidance must stop teaching assistant-side scheduled actions.

Required cleanup:

- `/admin/presets` bootstrap defaults
- `Task Heartbeat` / `heartbeat` developer-tail guidance
- tool catalog `scheduled_action.modelUsageGuidance`
- runtime tool schema descriptions
- admin plans/tool metadata copy
- tests and fixtures that mention `assistant_check`

New guidance:

- use `scheduled_action` for user-visible reminders only
- use `background_task` for quiet assistant follow-up, conditional checks, and "поставь себе фоновую задачу"
- a background task returns a structured evaluator decision and the platform handles push/no-push

No transitional prompt mode should mention both `assistant_check` and `background_task` as valid current options.

## Implementation Plan

### Slice 1 — ADR and contract cleanup map

- Land this ADR.
- Add a checklist of active code/prompt/doc touch points.
- Confirm `scheduled_action` remains required for user reminders.
- Confirm `assistant_check` is removed from target-state truth.

### Slice 2 — Data model and run history

- Add `assistant_background_tasks`.
- Add `assistant_background_task_runs`.
- Keep `assistant_task_registry_items` for user reminders.
- Expose the new run state through assistant task/settings APIs.

### Slice 3 — Internal control API and runtime tool

- Add internal API endpoints for background task list/control.
- Add runtime `background_task` tool service.
- Remove `assistant_check` from `scheduled_action` runtime contract.
- Update tool budgets and daily usage counters for `background_task`.

### Slice 4 — Executor and evaluator

- Add `PersaiBackgroundTaskSchedulerService`.
- Add evaluator dispatch with strict JSON decision validation.
- Persist every run.
- Push directly through preferred notification delivery.
- Add retry/dead-letter behavior.

### Slice 5 — Prompt/admin cleanup

- Update bootstrap presets.
- Update `/admin/presets` mirrored defaults and labels.
- Replace `Task Heartbeat` guidance with background-task guidance.
- Update tool catalog guidance.
- Remove `assistant_check` from active tests and fixtures.

### Slice 6 — Web settings UI

- Keep the existing card layout.
- "Задачи для тебя" reads from user reminders.
- "Действия ассистента" reads from background tasks.
- Add expandable recent-run history inside assistant-action cards.

### Slice 7 — Verification and live acceptance

Acceptance cases:

1. "Напомни мне поесть через минуту" creates a `scheduled_action` user reminder and delivers through the preferred channel.
2. "Если через 2 минуты я не напишу космос, пингани меня" creates a `background_task`, not `scheduled_action`.
3. On fire, the background task records a run with `push` or `no_push`.
4. If `push`, delivery uses the existing preferred notification channel.
5. No active prompt/tool/schema path allows `kind="assistant_check"`.
6. Assistant settings show the background task in "Действия ассистента" with recent run history.

## Consequences

### Positive

- User reminders and assistant background work become separate, clear products.
- Background checks no longer rely on the model creating a second reminder.
- Push/no-push becomes a validated platform decision, not hidden chat text.
- Operators and users can inspect recent runs instead of guessing from logs.
- The existing notification preference remains the single delivery-channel source of truth.
- The platform can later optimize deterministic checks without redesigning the whole task system.

### Negative

- Requires schema, runtime contract, prompt, admin UI, and test changes.
- Existing assistant-side scheduled action rows cannot be treated as target-state truth.
- The first implementation still uses LLM for generic evaluation, so cost controls must be explicit from day one.

## Out of Scope

- A no-code automation/workflow builder.
- Hard-coding every possible trigger type such as exchange rates, weather, or news.
- A separate per-task notification channel selector.
- Backward-compatible support for model-created `assistant_check`.
- Migrating malformed historical assistant scheduled-action rows into the new system.

## Alternatives considered

- **Keep `assistant_check` and strengthen prompts.** Rejected because the model still owns the second-step reminder creation and failures remain hard to reason about.
- **Coerce malformed assistant checks into reminders.** Rejected because it hides model/tool contract errors and can push instruction text to users.
- **Make all background checks deterministic.** Rejected because many useful assistant tasks require judgment. Deterministic prechecks are an optimization, not the foundation.
- **Add a delivery channel setting per task.** Rejected because `Assistant.preferredNotificationChannel` already exists and should remain the delivery source of truth.
