import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextMessage,
  RuntimeBundleSkillScenario,
  RuntimeBundleSkillScenarioStep,
  RuntimeSkillDecisionState,
  RuntimeTodoItem
} from "@persai/runtime-contract";
import type { ToolBudgetSnapshot } from "./tool-budget-policy";

const CHAT_PLAN_REMINDER_CONTENT_MAX = 140;
const INTAKE_STEP_TITLE_MAX = 80;
const INTAKE_MAX_STEPS_RENDERED = 12;

/**
 * ADR-119 Slice 5 + ADR-125 follow-up — composes `<system-reminder>` volatile-context blocks
 * for mid-conversation injection.
 *
 * Five reminder classes are supported (emitted in stable order — scenario tick first, then
 * image, then scenario plan intake, then chat-plan lifecycle, then budget reminders alphabetical
 * by tool name):
 *
 *   1. **Active scenario tick** — emitted every turn while a scenario is active and resolvable
 *      from the bundle. Keeps the model oriented to the current step count.
 *
 *   2. **Reference image attached** — emitted when the current turn has a user-attached image
 *      AND a scenario is active. Reminds the model to verify its scenario step before any
 *      media tool call.
 *
 *   3. **Scenario plan intake** (ADR-125 Option A) — emitted when a scenario is active AND
 *      resolvable from the bundle AND the chat plan is empty. This is the critical "first
 *      move" nudge: after `skill.engage` returns scenario steps, the model is expected to
 *      author a `todo_write({action:"add", items:[...]})` mirroring those steps before any
 *      other work. Tool-catalog guidance alone proved insufficient — this reminder repeats
 *      every turn (until the plan exists) and embeds the actual step list so the model has
 *      the data it needs to compose the `add` call right next to the imperative.
 *
 *   4. **Chat-plan lifecycle** — emitted when the windowed chat plan has at least one open
 *      (non-completed) row. This is the Claude-Code / Cursor-style per-turn nudge that closes
 *      the gap between "model did the work" and "model called `todo_write` to mark it done".
 *      Two branches:
 *        - if any row is `in_progress` → name that row + demand `todo_write` complete BEFORE
 *          the assistant text reply;
 *        - else (only `pending` rows) → demand the model pick the next row and switch it to
 *          `in_progress` via `todo_write` BEFORE substantive work.
 *      Suppressed entirely when the plan is empty or every windowed row is already completed.
 *
 *   5. **Tool budget warning** — emitted per tool that has consumed ≥ 80% of its `per_tool_cap`.
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

    const resolvedScenario = hasActiveScenario ? resolveScenario(params.bundle, state!) : null;

    // Reminder 1 — Active scenario tick.
    if (resolvedScenario !== null) {
      const total = resolvedScenario.steps.length;
      const displayName = resolvedScenario.displayName;
      messages.push(
        makeReminder(
          `Active scenario: ${displayName}, ${String(total)} steps total. Follow steps in order. Negative guards from each step apply.`
        )
      );
    }

    // Reminder 2 — Reference image attached (only when scenario is also active).
    if (params.currentTurnHasUserAttachedImage && hasActiveScenario) {
      messages.push(
        makeReminder(
          "Reference image attached this turn. Verify scenario step before any media tool call. If at step 1 (brief), collect missing brief items first."
        )
      );
    }

    // Reminder 3 — Scenario plan intake (fires only when scenario active + plan empty).
    const intakeReminder = buildScenarioPlanIntakeReminder(
      resolvedScenario,
      params.chatPlanTodos ?? null
    );
    if (intakeReminder !== null) {
      messages.push(intakeReminder);
    }

    // Reminder 4 — Chat-plan lifecycle nudge.
    const chatPlanReminder = buildChatPlanLifecycleReminder(params.chatPlanTodos ?? null);
    if (chatPlanReminder !== null) {
      messages.push(chatPlanReminder);
    }

    // Reminder 5 — Tool budget warning (one message per qualifying tool, alpha by name).
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

function buildScenarioPlanIntakeReminder(
  resolvedScenario: RuntimeBundleSkillScenario | null,
  todos: readonly RuntimeTodoItem[] | null
): ProviderGatewayTextMessage | null {
  // Only fire when there IS a scenario AND the plan is empty.
  if (resolvedScenario === null) {
    return null;
  }
  if (todos !== null && todos.length > 0) {
    return null;
  }
  if (resolvedScenario.steps.length === 0) {
    return null;
  }
  const stepsToRender = resolvedScenario.steps.slice(0, INTAKE_MAX_STEPS_RENDERED);
  const renderedLines = stepsToRender.map((step) => {
    const title = deriveStepTitle(step);
    return `  ${String(step.number)}. ${title}`;
  });
  const truncatedNote =
    resolvedScenario.steps.length > INTAKE_MAX_STEPS_RENDERED
      ? `\n  …and ${String(resolvedScenario.steps.length - INTAKE_MAX_STEPS_RENDERED)} more — include every step in the add call.`
      : "";
  const firstStepTitle = deriveStepTitle(stepsToRender[0]!);
  const secondStepHint =
    stepsToRender.length > 1 ? `, {content:"${deriveStepTitle(stepsToRender[1]!)}"}` : "";
  return makeReminder(
    `Scenario "${resolvedScenario.displayName}" is active but the chat plan is empty. Your VERY NEXT action MUST be a single todo_write({action:"add", items:[…]}) call that mirrors the scenario steps below — one row per step, in order, first item status:"in_progress", every other item status:"pending". Do this BEFORE replying to the user and BEFORE any other tool call. The scenario IS the plan — do not skip this even if the user has not asked for a plan.\nScenario steps:\n${renderedLines.join("\n")}${truncatedNote}\nExample shape: todo_write({action:"add", items:[{content:"${firstStepTitle}", status:"in_progress"}${secondStepHint}, …]}).`
  );
}

function deriveStepTitle(step: RuntimeBundleSkillScenarioStep): string {
  const raw = step.directive.trim().replace(/\s+/g, " ");
  // Cut at the first sentence boundary if it sits within the limit; otherwise
  // truncate on a word boundary with an ellipsis.
  const sentenceEnd = raw.search(/[.!?](\s|$)/);
  const firstSentence =
    sentenceEnd > 0 && sentenceEnd + 1 <= INTAKE_STEP_TITLE_MAX
      ? raw.slice(0, sentenceEnd + 1)
      : raw;
  if (firstSentence.length <= INTAKE_STEP_TITLE_MAX) {
    return firstSentence;
  }
  const slice = firstSentence.slice(0, INTAKE_STEP_TITLE_MAX - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const trimmed = lastSpace > INTAKE_STEP_TITLE_MAX * 0.5 ? slice.slice(0, lastSpace) : slice;
  return `${trimmed.trimEnd()}…`;
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
): RuntimeBundleSkillScenario | null {
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
