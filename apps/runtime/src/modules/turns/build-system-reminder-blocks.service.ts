import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextMessage,
  RuntimeSkillDecisionState
} from "@persai/runtime-contract";
import type { ToolBudgetSnapshot } from "./tool-budget-policy";

/**
 * ADR-119 Slice 5 — composes `<system-reminder>` volatile-context blocks for mid-conversation
 * injection.
 *
 * Three reminder classes are supported (emitted in stable order — scenario tick first, then
 * image, then budget reminders alphabetical by tool name):
 *
 *   1. **Active scenario tick** — emitted every turn while a scenario is active and resolvable
 *      from the bundle. Keeps the model oriented to the current step count.
 *
 *   2. **Reference image attached** — emitted when the current turn has a user-attached image
 *      AND a scenario is active. Reminds the model to verify its scenario step before any
 *      media tool call.
 *
 *   3. **Tool budget warning** — emitted per tool that has consumed ≥ 80% of its `per_tool_cap`.
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

    // Reminder 3 — Tool budget warning (one message per qualifying tool, alpha by name).
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
