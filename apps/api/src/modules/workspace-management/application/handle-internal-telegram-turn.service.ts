import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter
} from "./assistant-runtime-adapter.types";
import { EnforceAbuseRateLimitService } from "./enforce-abuse-rate-limit.service";
import { EnforceAssistantCapabilityAndQuotaService } from "./enforce-assistant-capability-and-quota.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export interface InternalTelegramTurnRequest {
  assistantId: string;
  threadId: string;
  message: string;
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

@Injectable()
export class HandleInternalTelegramTurnService {
  constructor(
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter,
    private readonly enforceAssistantCapabilityAndQuotaService: EnforceAssistantCapabilityAndQuotaService,
    private readonly enforceAbuseRateLimitService: EnforceAbuseRateLimitService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  parseInput(payload: unknown): InternalTelegramTurnRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Telegram turn payload must be an object.");
    }

    const row = payload as Record<string, unknown>;
    return {
      assistantId: normalizeRequiredString(row.assistantId, "assistantId"),
      threadId: normalizeRequiredString(row.threadId, "threadId"),
      message: normalizeRequiredString(row.message, "message")
    };
  }

  async execute(input: InternalTelegramTurnRequest): Promise<{
    assistantMessage: string;
    respondedAt: string;
  }> {
    const resolved = await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(
      input.assistantId
    );

    await this.enforceAssistantCapabilityAndQuotaService.enforceInboundTurn({
      assistant: resolved.assistant,
      surface: "telegram",
      isNewThread: false,
      activeSurfaceChatsCount: 0
    });
    await this.enforceAbuseRateLimitService.enforceAndRegisterAttempt({
      assistant: resolved.assistant,
      surface: "telegram"
    });

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: resolved.workspaceId },
      select: { timezone: true }
    });
    if (workspace === null) {
      throw new NotFoundException("Workspace does not exist for this assistant.");
    }

    const runtimeResponse = await this.assistantRuntimeAdapter.sendChannelTurn({
      assistantId: resolved.assistantId,
      publishedVersionId: resolved.publishedVersionId,
      surface: "telegram",
      threadId: input.threadId,
      userMessage: input.message,
      userTimezone: workspace.timezone,
      currentTimeIso: new Date().toISOString()
    });

    await this.trackWorkspaceQuotaUsageService.recordInboundTurnUsage({
      assistant: resolved.assistant,
      userContent: input.message,
      assistantContent: runtimeResponse.assistantMessage,
      source: "telegram_turn_sync"
    });

    return runtimeResponse;
  }
}
