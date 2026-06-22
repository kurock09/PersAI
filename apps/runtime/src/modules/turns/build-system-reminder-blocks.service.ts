import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextMessage,
  RuntimeSkillDecisionState,
  RuntimeTodoItem
} from "@persai/runtime-contract";
import type { ToolBudgetSnapshot } from "./tool-budget-policy";

const CHAT_PLAN_REMINDER_CONTENT_MAX = 140;

/**
 * ADR-119 Slice 5 + ADR-125 follow-up — composes `<system-reminder>` volatile-context blocks
 * for mid-conversation injection.
 *
 * Four reminder classes are supported (emitted in stable order — scenario tick first, then
 * image, then chat-plan lifecycle, then budget reminders alphabetical by tool name):
 *
 *   1. **Active scenario tick** — emitted every turn while a scenario is active and resolvable
 *      from the bundle. Keeps the model oriented to the current step count.
 *
 *   2. **Reference image attached** — emitted when the current turn has a user-attached image
 *      AND a scenario is active. Reminds the model to verify its scenario step before any
 *      media tool call.
 *
 *   3. **Chat-plan lifecycle** — emitted when the windowed chat plan has at least one open
 *      (non-completed) row. This is the Claude-Code / Cursor-style per-turn nudge that closes
 *      the gap between "model did the work" and "model called `todo_write` to mark it done".
 *      Two branches:
 *        - if any row is `in_progress` → name that row + demand `todo_write` complete BEFORE
 *          the assistant text reply;
 *        - else (only `pending` rows) → demand the model pick the next row and switch it to
 *          `in_progress` via `todo_write` BEFORE substantive work.
 *      Suppressed entirely when the plan is empty or every windowed row is already completed.
 *
 *   4. **Tool budget warning** — emitted per tool that has consumed ≥ 80% of its `per_tool_cap`.
 *      Each qualifying tool gets its own separate message (keeps recency bias mechanism crisp).
 *      Reminders are ordered alphabetically by tool name.
 *
 * All returned messages carry `cacheRole: "volatile_context"` and
 * `volatileKind: "system_reminder"` so the provider clients wrap them with
 * `<system-reminder>…</system-reminder>`.
 */
@Injectable()
export class BuildSystemReminderBlocksService {
  buildBlocks(params: {
    bundle: AssistantRuntimeBundle;
    skillDecisionState: RuntimeSkillDecisionState | null | undefined;
    currentTurnHasUserAttachedImage: boolean;
    toolBudgetSnapshot: ToolBudgetSnapshot;
    chatPlanTodos?: readonly RuntimeTodoItem[] | null;
  }): ProviderGatewayTextMessage[] {
    const messages: ProviderGatewayTextMessage[] = [];

    const state = params.skillDecisionState;
    const hasActiveScenario =
      state !== null &&
      state !== undefined &&
      state.activeScenarioKey !== null &&
      state.activeSkillId !== null;

    // Reminder 1 — Active scenario tick.
    if (hasActiveScenario) {
      const resolvedScenario = resolveScenario(params.bundle, state!);
      if (resolvedScenario !== null) {
        const total = resolvedScenario.steps.length;
        const displayName = resolvedScenario.displayName;
        messages.push(
          makeReminder(
            `Active scenario: ${displayName}, ${String(total)} steps total. Follow steps in order. Negative guards from each step apply.`
          )
        );
      }
    }

    // Reminder 2 — Reference image attached (only when scenario is also active).
    if (params.currentTurnHasUserAttachedImage && hasActiveScenario) {
      messages.push(
        makeReminder(
          "Reference image attached this turn. Verify scenario step before any media tool call. If at step 1 (brief), collect missing brief items first."
        )
      );
    }

    // Reminder 3 — Chat-plan lifecycle nudge.
    const chatPlanReminder = buildChatPlanLifecycleReminder(params.chatPlanTodos ?? null);
    if (chatPlanReminder !== null) {
      messages.push(chatPlanReminder);
    }

    // Reminder 4 — Tool budget warning (one message per qualifying tool, alpha by name).
    const budgetWarnings = params.toolBudgetSnapshot
      .filter((entry) => entry.perToolCap > 0 && entry.perToolUsed / entry.perToolCap >= 0.8)
      .slice()
      .sort((a, b) => a.toolName.localeCompare(b.toolName));

    for (const entry of budgetWarnings) {
      const remaining = entry.perToolCap - entry.perToolUsed;
      messages.push(
        makeReminder(
          `${entry.toolName} tool has ${String(remaining)} of ${String(entry.perToolCap)} invocations remaining this turn. Plan accordingly.`
        )
      );
    }

    return messages;
  }
}

function buildChatPlanLifecycleReminder(
  todos: readonly RuntimeTodoItem[] | null
): ProviderGatewayTextMessage | null {
  if (todos === null || todos.length === 0) {
    return null;
  }
  const inProgress = todos.find((t) => t.status === "in_progress") ?? null;
  if (inProgress !== null) {
    const title = truncateForReminder(inProgress.content);
    return makeReminder(
      `Active plan task (in_progress): "${title}" — id ${inProgress.id}. The MOMENT this task is delivered (artifact created, answer composed, sub-question resolved), call todo_write({action:"complete", id:"${inProgress.id}"}) BEFORE writing your reply to the user, then continue. Do not batch completions across multiple steps.`
    );
  }
  const firstPending = todos.find((t) => t.status === "pending") ?? null;
  if (firstPending !== null) {
    const pendingCount = todos.filter((t) => t.status === "pending").length;
    const title = truncateForReminder(firstPending.content);
    return makeReminder(
      `Plan has ${String(pendingCount)} pending item${pendingCount === 1 ? "" : "s"}, none in_progress. Next is "${title}" — id ${firstPending.id}. Call todo_write({action:"update", id:"${firstPending.id}", status:"in_progress"}) BEFORE substantive work on it. Only one in_progress sibling per parent.`
    );
  }
  // All windowed rows are completed (or `cancelled`-shaped statuses that ever
  // exist). Stay silent — there is nothing to nudge.
  return null;
}

function truncateForReminder(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (trimmed.length <= CHAT_PLAN_REMINDER_CONTENT_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, CHAT_PLAN_REMINDER_CONTENT_MAX - 1).trimEnd()}…`;
}

function resolveScenario(
  bundle: AssistantRuntimeBundle,
  state: RuntimeSkillDecisionState
): { displayName: string; steps: unknown[] } | null {
  const enabledSkills = bundle.skills?.enabled ?? [];
  const skill = enabledSkills.find((s) => s.id === state.activeSkillId) ?? null;
  if (skill === null) {
    return null;
  }
  const scenario = (skill.scenarios ?? []).find((s) => s.key === state.activeScenarioKey) ?? null;
  return scenario;
}

function makeReminder(content: string): ProviderGatewayTextMessage {
  return {
    role: "user",
    content,
    cacheRole: "volatile_context",
    volatileKind: "system_reminder"
  };
}
