import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextMessage,
  RuntimeBundleSkillScenario,
  RuntimeBundleSkillScenarioStep,
  RuntimeSkillDecisionState
} from "@persai/runtime-contract";

/**
 * ADR-118 Slice 4 — composes the `## Active Scenario` volatile developer block.
 *
 * When the turn carries an active scenario (non-null `activeScenarioKey` + `activeSkillId`),
 * this service looks up the scenario in `bundle.skills.enabled[i].scenarios[]` and renders
 * the structured block per D4. The block is emitted as a `ProviderGatewayTextMessage` with
 * `cacheRole: "volatile_context"` and `volatileKind: "active_scenario"` so provider clients
 * wrap it with the scenario-specific XML tag instead of the memory tag.
 *
 * Returns null when:
 * - `activeScenarioKey` or `activeSkillId` is null (no active scenario)
 * - the scenario is not found in the bundle (it may have been archived between turns)
 */
@Injectable()
export class BuildActiveScenarioBlockService {
  private readonly logger = new Logger(BuildActiveScenarioBlockService.name);

  buildBlock(params: {
    bundle: AssistantRuntimeBundle;
    skillDecisionState: RuntimeSkillDecisionState | null | undefined;
  }): ProviderGatewayTextMessage | null {
    const state = params.skillDecisionState;
    if (
      state === null ||
      state === undefined ||
      state.activeScenarioKey === null ||
      state.activeSkillId === null
    ) {
      return null;
    }

    const { activeSkillId, activeScenarioKey } = state;
    const enabledSkills = params.bundle.skills?.enabled ?? [];
    const skill = enabledSkills.find((s) => s.id === activeSkillId) ?? null;

    if (skill === null) {
      this.logger.log(
        `[active-scenario] activeScenarioKey=${activeScenarioKey} resolved but skill=${activeSkillId} not in bundle; degrading gracefully`
      );
      return null;
    }

    const scenario = (skill.scenarios ?? []).find((s) => s.key === activeScenarioKey) ?? null;

    if (scenario === null) {
      this.logger.log(
        `[active-scenario] activeScenarioKey=${activeScenarioKey} resolved but scenario not in bundle for skill=${activeSkillId}; degrading gracefully`
      );
      return null;
    }

    const skillDisplayName = skill.name;
    const blockText = renderActiveScenarioBlock(scenario, skillDisplayName);

    return {
      role: "user",
      content: blockText,
      cacheRole: "volatile_context",
      volatileKind: "active_scenario"
    };
  }
}

function renderActiveScenarioBlock(
  scenario: RuntimeBundleSkillScenario,
  skillDisplayName: string
): string {
  const lines: string[] = [
    `## Active Scenario: ${scenario.displayName} (Skill: ${skillDisplayName})`,
    "",
    "Follow steps in order. Do not skip, do not combine, do not respond to the user without making progress on a step.",
    "",
    "Steps:"
  ];

  for (const step of scenario.steps) {
    lines.push(`${String(step.number)}. ${step.directive}`);
    appendStepDetails(lines, step);
  }

  lines.push("", `Exit condition: ${scenario.exitCondition}`);

  return lines.join("\n");
}

function appendStepDetails(lines: string[], step: RuntimeBundleSkillScenarioStep): void {
  if (step.recommendedToolCall !== null) {
    lines.push(`   Recommended tool: ${step.recommendedToolCall}`);
  }
  if (step.negativeGuards.length > 0) {
    lines.push(`   Guards: ${step.negativeGuards.map((g) => `Do NOT ${g}`).join(". ")}.`);
  }
}
