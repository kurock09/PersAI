import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextMessage,
  RuntimeBundleSkillScenario,
  RuntimeBundleSkillScenarioScriptRef,
  RuntimeBundleSkillScenarioStep,
  RuntimeSkillDecisionState,
  RuntimeTodoItem
} from "@persai/runtime-contract";

/**
 * ADR-119 Slice 4 / ADR-130 Slice 4 — composes the volatile active-scenario block
 * in canonical XML format.
 *
 * When the turn carries an active scenario (non-null `activeScenarioKey` + `activeSkillId`),
 * this service looks up the scenario in `bundle.skills.enabled[i].scenarios[]` and renders
 * the structured XML block. The block is emitted as a `ProviderGatewayTextMessage`
 * with `cacheRole: "volatile_context"` and `volatileKind: "active_scenario"` so provider clients
 * wrap it with `<persai_active_scenario>` instead of the memory tag.
 *
 * ADR-130 D5 — the block owns ONLY the current operational step (full body) plus the
 * exit condition. It no longer repeats every step body every turn: the ordered
 * plan/status list is owned by `<persai_chat_plan>`, and the step enumeration for
 * plan authoring is owned by the scenario plan-intake reminder. The "current step"
 * is derived from the chat-plan todos (the model-owned progression signal): the
 * in_progress row's position, or the count of completed rows, maps to the scenario
 * step index. When the plan is empty (pre-seed) or absent, the current step is
 * step 1. This keeps the same scenario step body from being repeated across
 * multiple volatile owners in the same turn.
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
    chatPlanTodos?: readonly RuntimeTodoItem[] | null;
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
    const currentStepIndex = resolveCurrentStepIndex(
      scenario.steps.length,
      params.chatPlanTodos ?? null
    );
    const blockText = renderActiveScenarioBlock(scenario, skillDisplayName, currentStepIndex);

    return {
      role: "user",
      content: blockText,
      cacheRole: "volatile_context",
      volatileKind: "active_scenario"
    };
  }
}

/**
 * ADR-130 D5 — derive the current scenario step index from the model-owned chat
 * plan. The plan-intake reminder authors one top-level todo row per scenario step,
 * in order, so:
 * - an `in_progress` row's ordinal position is the current step;
 * - otherwise the number of `completed` rows is the next step to work on;
 * - an empty/absent plan (pre-seed) means step 1.
 * The result is clamped to the scenario's step range so a model that deviates from
 * the 1:1 mapping still yields a valid, plausible step rather than an out-of-range
 * read. The authoritative ordered progress remains visible in `<persai_chat_plan>`.
 */
export function resolveCurrentStepIndex(
  stepCount: number,
  todos: readonly RuntimeTodoItem[] | null
): number {
  if (stepCount <= 0) {
    return 0;
  }
  if (todos === null || todos.length === 0) {
    return 0;
  }
  const topLevel = todos.filter((t) => t.parentId === null);
  const rows = topLevel.length > 0 ? topLevel : todos;
  const inProgressIndex = rows.findIndex((t) => t.status === "in_progress");
  if (inProgressIndex >= 0) {
    return Math.min(inProgressIndex, stepCount - 1);
  }
  const completedCount = rows.filter((t) => t.status === "completed").length;
  return Math.min(completedCount, stepCount - 1);
}

/**
 * ADR-151 — the single shared "what is the model's exact current Scenario
 * step, right now" resolver. Reuses the exact same {@link resolveCurrentStepIndex}
 * semantics {@link BuildActiveScenarioBlockService.buildBlock} renders from, so
 * the `script` tool's projection/dispatch gate can never disagree with what the
 * volatile `<persai_active_scenario>` block shows the model for this turn.
 * Returns `null` whenever `buildBlock` would also render nothing (no active
 * scenario, skill/scenario no longer in the bundle, or zero steps).
 */
export type ResolvedActiveScenarioStep = {
  skillId: string;
  scenarioKey: string;
  scenario: RuntimeBundleSkillScenario;
  step: RuntimeBundleSkillScenarioStep;
  stepIndex: number;
};

export function resolveActiveScenarioStep(params: {
  bundle: AssistantRuntimeBundle;
  skillDecisionState: RuntimeSkillDecisionState | null | undefined;
  chatPlanTodos?: readonly RuntimeTodoItem[] | null;
}): ResolvedActiveScenarioStep | null {
  const state = params.skillDecisionState;
  if (
    state === null ||
    state === undefined ||
    state.activeScenarioKey === null ||
    state.activeSkillId === null
  ) {
    return null;
  }
  const enabledSkills = params.bundle.skills?.enabled ?? [];
  const skill = enabledSkills.find((s) => s.id === state.activeSkillId) ?? null;
  if (skill === null) {
    return null;
  }
  const scenario = (skill.scenarios ?? []).find((s) => s.key === state.activeScenarioKey) ?? null;
  if (scenario === null || scenario.steps.length === 0) {
    return null;
  }
  const stepIndex = resolveCurrentStepIndex(scenario.steps.length, params.chatPlanTodos ?? null);
  const step = scenario.steps[stepIndex];
  if (step === undefined) {
    return null;
  }
  return { skillId: skill.id, scenarioKey: scenario.key, scenario, step, stepIndex };
}

/**
 * Scenario-scoped Script availability: while a Scenario is active, every
 * materialized `scriptRef` on any of its steps is available for the whole
 * Scenario period (not only the current operational step). Unique by
 * `scriptKey` (first step wins for pin/mapping). Returns `null` when there
 * is no active Scenario in the bundle or the Scenario binds zero Scripts.
 */
export type ResolvedActiveScenarioScripts = {
  skillId: string;
  scenarioKey: string;
  scenario: RuntimeBundleSkillScenario;
  scriptRefs: RuntimeBundleSkillScenarioScriptRef[];
};

export function resolveActiveScenarioScriptRefs(params: {
  bundle: AssistantRuntimeBundle;
  skillDecisionState: RuntimeSkillDecisionState | null | undefined;
}): ResolvedActiveScenarioScripts | null {
  const state = params.skillDecisionState;
  if (
    state === null ||
    state === undefined ||
    state.activeScenarioKey === null ||
    state.activeSkillId === null
  ) {
    return null;
  }
  const enabledSkills = params.bundle.skills?.enabled ?? [];
  const skill = enabledSkills.find((s) => s.id === state.activeSkillId) ?? null;
  if (skill === null) {
    return null;
  }
  const scenario = (skill.scenarios ?? []).find((s) => s.key === state.activeScenarioKey) ?? null;
  if (scenario === null) {
    return null;
  }
  const byKey = new Map<string, RuntimeBundleSkillScenarioScriptRef>();
  for (const step of scenario.steps) {
    const ref = step.scriptRef;
    if (ref === null) {
      continue;
    }
    if (!byKey.has(ref.scriptKey)) {
      byKey.set(ref.scriptKey, ref);
    }
  }
  if (byKey.size === 0) {
    return null;
  }
  return {
    skillId: skill.id,
    scenarioKey: scenario.key,
    scenario,
    scriptRefs: [...byKey.values()]
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderActiveScenarioBlock(
  scenario: RuntimeBundleSkillScenario,
  skillDisplayName: string,
  currentStepIndex = 0
): string {
  const parts: string[] = [`Active: ${scenario.displayName} (Skill: ${skillDisplayName})`, ""];

  // ADR-130 D5 — render only the current operational step in full. The ordered
  // plan/status list is owned by <persai_chat_plan>; the full step enumeration
  // for plan authoring is owned by the scenario plan-intake reminder.
  const steps = scenario.steps;
  if (steps.length > 0) {
    const index = Math.min(Math.max(currentStepIndex, 0), steps.length - 1);
    const currentStep = steps[index]!;
    parts.push(renderStep(currentStep));
  }

  parts.push(`<exit_condition>${escapeXml(scenario.exitCondition)}</exit_condition>`);

  return parts.join("\n");
}

function renderStep(step: RuntimeBundleSkillScenarioStep): string {
  const lines: string[] = [`<step number="${String(step.number)}">`];

  lines.push(`  <directive>${escapeXml(step.directive)}</directive>`);

  if (step.recommendedToolCall !== null && step.recommendedToolCall !== undefined) {
    lines.push(
      `  <recommended_tool_call>${escapeXml(step.recommendedToolCall)}</recommended_tool_call>`
    );
  }

  const expectedUserResponse = step.expectedUserResponse ?? null;
  if (expectedUserResponse !== null) {
    lines.push(
      `  <expected_user_response>${escapeXml(expectedUserResponse)}</expected_user_response>`
    );
  }

  const nextStepTrigger = step.nextStepTrigger ?? null;
  if (nextStepTrigger !== null) {
    lines.push(`  <next_step_trigger>${escapeXml(nextStepTrigger)}</next_step_trigger>`);
  }

  const recoveryGuidance = step.recoveryGuidance ?? null;
  if (recoveryGuidance !== null) {
    lines.push(`  <recovery_guidance>${escapeXml(recoveryGuidance)}</recovery_guidance>`);
  }

  if (step.mayBeSkippedIf !== null && step.mayBeSkippedIf !== undefined) {
    lines.push(`  <may_be_skipped_if>${escapeXml(step.mayBeSkippedIf)}</may_be_skipped_if>`);
  }

  if (step.negativeGuards.length > 0) {
    lines.push("  <negative_guards>");
    for (const guard of step.negativeGuards) {
      lines.push(`    <guard>Do NOT ${escapeXml(guard)}</guard>`);
    }
    lines.push("  </negative_guards>");
  }

  lines.push("</step>");

  return lines.join("\n");
}
