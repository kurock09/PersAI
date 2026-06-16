import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { ProviderGatewayToolCall, RuntimeConversationAddress } from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

export type RuntimeSkillToolResult =
  | {
      action: "engaged";
      skillId: string;
      skillDisplayName: string;
      scenarioKey: null;
    }
  | {
      action: "released";
      previousSkillId: string | null;
    }
  | {
      error: "skill_not_enabled";
      skillId: string;
    }
  | {
      // ADR-118 Slice 2: scenario catalog does not yet exist (Slice 3 creates the entity,
      // Slice 4 surfaces it on the bundle). Return honest error so the model retries
      // without scenarioKey.
      error: "scenario_not_found";
      scenarioKey: string;
      availableScenarios: never[];
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

type ParsedRequest = EngageRequest | ReleaseRequest;

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
    const request = this.readArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: { error: "invalid_arguments", reason: request.message },
        isError: true
      };
    }

    if (request.action === "release") {
      return this.executeRelease(params, request);
    }

    return this.executeEngage(params, request);
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

    // ADR-118 Slice 2: scenarioKey validation deferred to Slice 4 (materialized catalog).
    // Until Slice 4 lands, any scenarioKey is unknown → honest error so the model retries
    // without scenarioKey (free-form engage).
    if (request.scenarioKey !== null) {
      return {
        payload: {
          error: "scenario_not_found",
          scenarioKey: request.scenarioKey,
          availableScenarios: []
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
        skillId: request.skillId,
        scenarioKey: null
      });

      return {
        payload: {
          action: "engaged",
          skillId: outcome.skillId,
          skillDisplayName: outcome.skillDisplayName,
          scenarioKey: null
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
        skillId: null,
        scenarioKey: null
      });

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
    const allowedKeys = new Set(["action", "skillId", "scenarioKey"]);
    const unknownKeys = Object.keys(args).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}.`);
    }

    const action = this.asAction(args.action);
    if (action === null) {
      return new Error('action must be "engage" or "release".');
    }

    if (action === "release") {
      if (args.skillId !== undefined || args.scenarioKey !== undefined) {
        return new Error('skillId and scenarioKey must be omitted when action is "release".');
      }
      return { action: "release" };
    }

    const skillId = this.asNonEmptyString(args.skillId);
    if (skillId === null) {
      return new Error(
        'skillId is required and must be a non-empty string when action is "engage".'
      );
    }

    const scenarioKey = this.asOptionalString(args.scenarioKey);
    if (scenarioKey === undefined) {
      return new Error("scenarioKey must be a string or null.");
    }

    return { action: "engage", skillId, scenarioKey };
  }

  private asAction(value: unknown): "engage" | "release" | null {
    if (value === "engage" || value === "release") {
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
