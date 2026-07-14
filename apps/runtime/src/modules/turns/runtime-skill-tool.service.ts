import { Injectable, Logger } from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeEnabledSkillSummary
} from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeBundleSkillScenarioStep,
  RuntimeConversationAddress
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import {
  executeRuntimeToolContractDescribe,
  isToolContractDescribeCall
} from "./runtime-tool-contract-describe";

/** ADR-119 Slice 3 — full instruction payload served on engage; removed from cache prefix. */
export interface RuntimeSkillEngageInstruction {
  body: string;
  guardrails: string[];
  examples: string[];
}

/** ADR-119 Slice 3 — full scenario object served on engage-with-scenario. */
export interface RuntimeSkillEngageScenario {
  key: string;
  displayName: string;
  description: string;
  steps: Array<{
    number: number;
    directive: string;
    recommendedToolCall: string | null;
    mayBeSkippedIf: string | null;
    negativeGuards: string[];
  }>;
  recommendedTools: string[];
  exitCondition: string | null;
}

export interface RuntimeSkillCatalogScenarioRow {
  key: string;
  name: string;
}

export interface RuntimeSkillDescribeScenario {
  key: string;
  displayName: string;
  oneLine: string;
  firstStepPreview: string | null;
  recommendedTools: string[];
  guardrails: string[];
  examples: string[];
  intentExamples: string[];
}

export interface RuntimeSkillListRow {
  id: string;
  displayName: string;
  summary: string | null;
  whenToUse: string | null;
  category: string;
  tags: string[];
  scenarios: RuntimeSkillCatalogScenarioRow[];
}

export type RuntimeSkillToolResult =
  | {
      action: "listed";
      category: string | null;
      skills: RuntimeSkillListRow[];
      truncated: boolean;
    }
  | {
      action: "described";
      skillId: string;
      skillDisplayName: string;
      summary: string | null;
      whenToUse: string | null;
      category: string;
      tags: string[];
      body: string;
      guardrails: string[];
      examples: string[];
      scenarios: RuntimeSkillDescribeScenario[];
      scenario: RuntimeSkillDescribeScenario | null;
      truncated: boolean;
    }
  | {
      action: "engaged";
      skillId: string;
      skillDisplayName: string;
      scenarioKey: null;
      instruction: RuntimeSkillEngageInstruction;
      scenario: null;
    }
  | {
      action: "engaged";
      skillId: string;
      skillDisplayName: string;
      scenarioKey: string;
      instruction: RuntimeSkillEngageInstruction;
      scenario: RuntimeSkillEngageScenario;
    }
  | {
      action: "released";
      previousSkillId: string | null;
    }
  | {
      error: "stale_assistant_role_snapshot";
      reason: string;
    }
  | {
      error: "skill_not_enabled";
      skillId: string;
    }
  | {
      error: "scenario_not_found";
      scenarioKey: string;
      availableScenarios: string[];
    }
  | {
      error: "invalid_arguments";
      reason: string;
    };

export interface RuntimeSkillToolExecutionResult {
  payload: RuntimeSkillToolResult;
  isError: boolean;
}

type EngageRequest = {
  action: "engage";
  skillId: string;
  scenarioKey: string | null;
};

type ReleaseRequest = {
  action: "release";
};

type ListRequest = {
  action: "list";
  category: string | null;
};

type DescribeRequest = {
  action: "describe";
  skillId: string | null;
  scenarioKey: string | null;
};

type ParsedRequest = EngageRequest | ReleaseRequest | ListRequest | DescribeRequest;

const SKILL_LIST_RESULT_CAP_CHARS = 3_500;
const SKILL_DESCRIBE_RESULT_CAP_CHARS = 4_500;
const SKILL_DESCRIBE_BODY_CAP_CHARS = 1_600;
const SKILL_DESCRIBE_BODY_FLOOR_CHARS = 600;
const SKILL_FIRST_STEP_PREVIEW_CAP_CHARS = 200;
const SKILL_DETAIL_TAG_CAP = 6;
const SKILL_DETAIL_TOOL_CAP = 8;
const SKILL_DETAIL_TEXT_LIST_CAP = 8;
const SKILL_DETAIL_LIST_ITEM_CAP_CHARS = 180;

@Injectable()
export class RuntimeSkillToolService {
  private readonly logger = new Logger(RuntimeSkillToolService.name);

  constructor(private readonly persaiInternalApiClientService: PersaiInternalApiClientService) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    conversation: RuntimeConversationAddress;
    requestId: string | null;
  }): Promise<RuntimeSkillToolExecutionResult> {
    if (
      isToolContractDescribeCall(params.toolCall.arguments) &&
      params.toolCall.arguments.skillId === undefined
    ) {
      return executeRuntimeToolContractDescribe({
        bundle: params.bundle,
        toolCode: "skill"
      }) as unknown as RuntimeSkillToolExecutionResult;
    }

    const request = this.readArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: { error: "invalid_arguments", reason: request.message },
        isError: true
      };
    }

    switch (request.action) {
      case "list":
        return this.executeList(params, request);
      case "describe":
        return this.executeDescribe(params, request);
      case "release":
        return this.executeRelease(params, request);
      case "engage":
        return this.executeEngage(params, request);
      default:
        return {
          payload: { error: "invalid_arguments", reason: "Unsupported skill action." },
          isError: true
        };
    }
  }

  private executeList(
    params: {
      bundle: AssistantRuntimeBundle;
      conversation: RuntimeConversationAddress;
      requestId: string | null;
    },
    request: ListRequest
  ): RuntimeSkillToolExecutionResult {
    const normalizedCategory = normalizeCategory(request.category);
    const rows = (params.bundle.skills?.enabled ?? [])
      .filter((skill) =>
        normalizedCategory === null
          ? true
          : normalizeCategory(skill.category) === normalizedCategory
      )
      .map((skill) => ({
        id: skill.id,
        displayName: skill.name,
        summary: normalizeOptionalText(skill.description ?? null),
        whenToUse: normalizeOptionalText(skill.whenToUse ?? null),
        category: normalizeText(skill.category),
        tags: normalizeBoundedList(skill.tags, SKILL_DETAIL_TAG_CAP),
        scenarios: (skill.scenarios ?? []).map((scenario) => ({
          key: scenario.key,
          name: scenario.displayName
        }))
      }));

    const cappedRows = [...rows];
    let truncated = false;
    while (
      JSON.stringify({
        action: "listed",
        category: normalizedCategory,
        skills: cappedRows,
        truncated
      }).length > SKILL_LIST_RESULT_CAP_CHARS &&
      cappedRows.length > 0
    ) {
      cappedRows.pop();
      truncated = true;
    }
    truncated ||= cappedRows.length < rows.length;

    return {
      payload: {
        action: "listed",
        category: normalizedCategory,
        skills: cappedRows,
        truncated
      },
      isError: false
    };
  }

  private executeDescribe(
    params: {
      bundle: AssistantRuntimeBundle;
      conversation: RuntimeConversationAddress;
      requestId: string | null;
    },
    request: DescribeRequest
  ): RuntimeSkillToolExecutionResult {
    if (request.skillId === null) {
      return executeRuntimeToolContractDescribe({
        bundle: params.bundle,
        toolCode: "skill"
      }) as unknown as RuntimeSkillToolExecutionResult;
    }

    const enabledSkills = params.bundle.skills?.enabled ?? [];
    const skill = enabledSkills.find((entry) => entry.id === request.skillId) ?? null;
    if (skill === null) {
      return {
        payload: { error: "skill_not_enabled", skillId: request.skillId },
        isError: false
      };
    }

    const allScenarios = (skill.scenarios ?? []).map((scenario) => describeScenario(scenario));
    const selectedScenario =
      request.scenarioKey === null
        ? null
        : (allScenarios.find((scenario) => scenario.key === request.scenarioKey) ?? null);

    if (request.scenarioKey !== null && selectedScenario === null) {
      return {
        payload: {
          error: "scenario_not_found",
          scenarioKey: request.scenarioKey,
          availableScenarios: allScenarios.map((scenario) => scenario.key)
        },
        isError: false
      };
    }

    let body = truncateText(skill.body, SKILL_DESCRIBE_BODY_CAP_CHARS);
    const scenarios = [...allScenarios];
    let truncated = false;
    while (
      JSON.stringify({
        action: "described",
        skillId: skill.id,
        skillDisplayName: skill.name,
        summary: normalizeOptionalText(skill.description ?? null),
        whenToUse: normalizeOptionalText(skill.whenToUse ?? null),
        category: normalizeText(skill.category),
        tags: normalizeBoundedList(skill.tags, SKILL_DETAIL_TAG_CAP),
        body,
        guardrails: normalizeBoundedList(skill.guardrails, SKILL_DETAIL_TEXT_LIST_CAP),
        examples: normalizeBoundedList(skill.examples, SKILL_DETAIL_TEXT_LIST_CAP),
        scenarios,
        scenario: request.scenarioKey === null ? null : selectedScenario,
        truncated
      }).length > SKILL_DESCRIBE_RESULT_CAP_CHARS
    ) {
      if (request.scenarioKey === null && scenarios.length > 0) {
        scenarios.pop();
        truncated = true;
        continue;
      }
      if (body.length > SKILL_DESCRIBE_BODY_FLOOR_CHARS) {
        body = truncateText(body, Math.max(SKILL_DESCRIBE_BODY_FLOOR_CHARS, body.length - 200));
        truncated = true;
        continue;
      }
      break;
    }

    truncated ||= scenarios.length < allScenarios.length;

    return {
      payload: {
        action: "described",
        skillId: skill.id,
        skillDisplayName: skill.name,
        summary: normalizeOptionalText(skill.description ?? null),
        whenToUse: normalizeOptionalText(skill.whenToUse ?? null),
        category: normalizeText(skill.category),
        tags: normalizeBoundedList(skill.tags, SKILL_DETAIL_TAG_CAP),
        body,
        guardrails: normalizeBoundedList(skill.guardrails, SKILL_DETAIL_TEXT_LIST_CAP),
        examples: normalizeBoundedList(skill.examples, SKILL_DETAIL_TEXT_LIST_CAP),
        scenarios,
        scenario: request.scenarioKey === null ? null : selectedScenario,
        truncated
      },
      isError: false
    };
  }

  private async executeEngage(
    params: {
      bundle: AssistantRuntimeBundle;
      conversation: RuntimeConversationAddress;
      requestId: string | null;
    },
    request: EngageRequest
  ): Promise<RuntimeSkillToolExecutionResult> {
    const enabledSkills = params.bundle.skills?.enabled ?? [];
    const skill = enabledSkills.find((s) => s.id === request.skillId) ?? null;
    if (skill === null) {
      return {
        payload: { error: "skill_not_enabled", skillId: request.skillId },
        isError: false
      };
    }

    if (request.scenarioKey !== null) {
      return this.executeEngageWithScenario(params, request, skill, request.scenarioKey);
    }

    try {
      const outcome = await this.persaiInternalApiClientService.updateSkillState({
        assistantId: params.bundle.metadata.assistantId,
        channel: params.conversation.channel,
        surfaceThreadKey: params.conversation.externalThreadKey,
        action: "engage",
        expectedRoleId: params.bundle.effectiveRoleId,
        skillId: request.skillId,
        scenarioKey: null
      });
      if (!outcome.applied || outcome.action === "stale") {
        return {
          payload: {
            error: "stale_assistant_role_snapshot",
            reason:
              outcome.message ??
              "Assistant role changed while this turn was running. Durable skill state was not persisted."
          },
          isError: false
        };
      }

      return {
        payload: {
          action: "engaged",
          skillId: outcome.skillId,
          skillDisplayName: outcome.skillDisplayName,
          scenarioKey: null,
          instruction: buildInstruction(skill),
          scenario: null
        },
        isError: false
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Skill engage failed.";
      this.logger.warn(
        `[skill] engage failed assistantId=${params.bundle.metadata.assistantId} skillId=${request.skillId}: ${message}`
      );
      return {
        payload: { error: "invalid_arguments", reason: message },
        isError: true
      };
    }
  }

  private async executeEngageWithScenario(
    params: {
      bundle: AssistantRuntimeBundle;
      conversation: RuntimeConversationAddress;
      requestId: string | null;
    },
    request: EngageRequest,
    skill: AssistantRuntimeEnabledSkillSummary,
    scenarioKey: string
  ): Promise<RuntimeSkillToolExecutionResult> {
    const scenarios = skill.scenarios ?? [];
    const scenario = scenarios.find((s) => s.key === scenarioKey) ?? null;
    if (scenario === null) {
      return {
        payload: {
          error: "scenario_not_found",
          scenarioKey,
          availableScenarios: scenarios.map((s) => s.key)
        },
        isError: false
      };
    }

    try {
      const outcome = await this.persaiInternalApiClientService.updateSkillState({
        assistantId: params.bundle.metadata.assistantId,
        channel: params.conversation.channel,
        surfaceThreadKey: params.conversation.externalThreadKey,
        action: "engage",
        expectedRoleId: params.bundle.effectiveRoleId,
        skillId: request.skillId,
        scenarioKey
      });
      if (!outcome.applied || outcome.action === "stale") {
        return {
          payload: {
            error: "stale_assistant_role_snapshot",
            reason:
              outcome.message ??
              "Assistant role changed while this turn was running. Durable skill state was not persisted."
          },
          isError: false
        };
      }

      // ADR-125 follow-up — the model now owns scenario intake: the
      // `skill.engage` tool response below carries `scenario.steps` with
      // every directive, and `todo_write`'s tool guidance instructs the
      // model to immediately call `todo_write({ add, items })` from those
      // directives. No server-side seeding.

      const scenarioPayload: RuntimeSkillEngageScenario = {
        key: scenario.key,
        displayName: scenario.displayName,
        description: scenario.description,
        steps: scenario.steps.map((step: RuntimeBundleSkillScenarioStep) => ({
          number: step.number,
          directive: step.directive,
          recommendedToolCall: step.recommendedToolCall,
          mayBeSkippedIf: step.mayBeSkippedIf,
          negativeGuards: step.negativeGuards
        })),
        recommendedTools: scenario.recommendedTools,
        exitCondition: scenario.exitCondition
      };

      return {
        payload: {
          action: "engaged",
          skillId: outcome.skillId,
          skillDisplayName: outcome.skillDisplayName,
          scenarioKey: scenario.key,
          instruction: buildInstruction(skill),
          scenario: scenarioPayload
        },
        isError: false
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Skill engage-with-scenario failed.";
      this.logger.warn(
        `[skill] engage-with-scenario failed assistantId=${params.bundle.metadata.assistantId} skillId=${request.skillId} scenarioKey=${scenarioKey}: ${message}`
      );
      return {
        payload: { error: "invalid_arguments", reason: message },
        isError: true
      };
    }
  }

  private async executeRelease(
    params: {
      bundle: AssistantRuntimeBundle;
      conversation: RuntimeConversationAddress;
      requestId: string | null;
    },
    _request: ReleaseRequest // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<RuntimeSkillToolExecutionResult> {
    try {
      const outcome = await this.persaiInternalApiClientService.updateSkillState({
        assistantId: params.bundle.metadata.assistantId,
        channel: params.conversation.channel,
        surfaceThreadKey: params.conversation.externalThreadKey,
        action: "release",
        expectedRoleId: params.bundle.effectiveRoleId,
        skillId: null,
        scenarioKey: null
      });
      if (!outcome.applied || outcome.action === "stale") {
        return {
          payload: {
            error: "stale_assistant_role_snapshot",
            reason:
              outcome.message ??
              "Assistant role changed while this turn was running. Durable skill state was not persisted."
          },
          isError: false
        };
      }

      return {
        payload: {
          action: "released",
          previousSkillId: outcome.previousSkillId ?? null
        },
        isError: false
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Skill release failed.";
      this.logger.warn(
        `[skill] release failed assistantId=${params.bundle.metadata.assistantId}: ${message}`
      );
      return {
        payload: { error: "invalid_arguments", reason: message },
        isError: true
      };
    }
  }

  private readArguments(args: Record<string, unknown>): ParsedRequest | Error {
    const allowedKeys = new Set(["action", "skillId", "scenarioKey", "category"]);
    const unknownKeys = Object.keys(args).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}.`);
    }

    const action = this.asAction(args.action);
    if (action === null) {
      return new Error('action must be "engage", "release", "list", or "describe".');
    }

    if (action === "release") {
      if (
        args.skillId !== undefined ||
        args.scenarioKey !== undefined ||
        args.category !== undefined
      ) {
        return new Error(
          'skillId, scenarioKey, and category must be omitted when action is "release".'
        );
      }
      return { action: "release" };
    }

    if (action === "list") {
      if (args.skillId !== undefined || args.scenarioKey !== undefined) {
        return new Error('skillId and scenarioKey must be omitted when action is "list".');
      }
      const category = this.asOptionalString(args.category);
      if (category === undefined) {
        return new Error("category must be a string or null.");
      }
      return { action: "list", category };
    }

    if (action === "describe") {
      if (args.category !== undefined) {
        return new Error('category must be omitted when action is "describe".');
      }
      const skillId = this.asOptionalNonEmptyString(args.skillId);
      if (skillId === undefined) {
        return new Error("skillId must be a string or omitted when action is describe.");
      }
      const scenarioKey = this.asOptionalString(args.scenarioKey);
      if (scenarioKey === undefined) {
        return new Error("scenarioKey must be a string or null.");
      }
      return { action: "describe", skillId, scenarioKey };
    }

    const skillId = this.asNonEmptyString(args.skillId);
    if (skillId === null) {
      return new Error(
        `skillId is required and must be a non-empty string when action is "${action}".`
      );
    }

    const scenarioKey = this.asOptionalString(args.scenarioKey);
    if (scenarioKey === undefined) {
      return new Error("scenarioKey must be a string or null.");
    }

    if (action === "engage") {
      if (args.category !== undefined) {
        return new Error('category must be omitted when action is "engage".');
      }
      return { action: "engage", skillId, scenarioKey };
    }

    return new Error(`Unsupported skill action "${action}".`);
  }

  private asAction(value: unknown): "engage" | "release" | "list" | "describe" | null {
    if (value === "engage" || value === "release" || value === "list" || value === "describe") {
      return value;
    }
    return null;
  }

  private asNonEmptyString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private asOptionalNonEmptyString(value: unknown): string | null | undefined {
    if (value === undefined) {
      return null;
    }
    if (value === null) {
      return null;
    }
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private asOptionalString(value: unknown): string | null | undefined {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return undefined;
  }
}

function buildInstruction(
  skill: AssistantRuntimeEnabledSkillSummary
): RuntimeSkillEngageInstruction {
  return {
    body: skill.body,
    guardrails: skill.guardrails,
    examples: skill.examples
  };
}

function describeScenario(
  scenario: NonNullable<AssistantRuntimeEnabledSkillSummary["scenarios"]>[number]
): RuntimeSkillDescribeScenario {
  return {
    key: scenario.key,
    displayName: scenario.displayName,
    oneLine: normalizeText(scenario.description),
    firstStepPreview: resolveFirstStepPreview(scenario),
    recommendedTools: normalizeBoundedList(scenario.recommendedTools, SKILL_DETAIL_TOOL_CAP),
    guardrails: normalizeBoundedList(scenario.guardrails ?? [], SKILL_DETAIL_TEXT_LIST_CAP),
    examples: normalizeBoundedList(scenario.examples ?? [], SKILL_DETAIL_TEXT_LIST_CAP),
    intentExamples: normalizeBoundedList(scenario.intentExamples, SKILL_DETAIL_TEXT_LIST_CAP)
  };
}

function resolveFirstStepPreview(
  scenario: NonNullable<AssistantRuntimeEnabledSkillSummary["scenarios"]>[number]
): string | null {
  const explicit = normalizeOptionalText(scenario.firstStepPreview ?? null);
  if (explicit !== null) {
    return truncateText(explicit, SKILL_FIRST_STEP_PREVIEW_CAP_CHARS);
  }
  const firstDirective = normalizeOptionalText(scenario.steps[0]?.directive ?? null);
  if (firstDirective === null) {
    return null;
  }
  return truncateText(firstDirective, SKILL_FIRST_STEP_PREVIEW_CAP_CHARS);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeOptionalText(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeList(values: readonly string[]): string[] {
  return values.map((value) => normalizeText(value)).filter((value) => value.length > 0);
}

function normalizeBoundedList(values: readonly string[], maxItems: number): string[] {
  return normalizeList(values)
    .map((value) => truncateText(value, SKILL_DETAIL_LIST_ITEM_CAP_CHARS))
    .slice(0, maxItems);
}

function normalizeCategory(value: string | null): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized === null ? null : normalized.toLowerCase();
}

function truncateText(value: string, maxChars: number): string {
  const normalized = value
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}
