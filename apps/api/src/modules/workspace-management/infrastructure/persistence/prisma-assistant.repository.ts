import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Assistant as PrismaAssistant } from "@prisma/client";
import type { RuntimeAssistantVoiceProfile } from "@persai/runtime-contract";
import type { Assistant } from "../../domain/assistant.entity";
import type {
  AssistantRepository,
  UpdateAssistantDraftInput
} from "../../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantRepository implements AssistantRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findById(id: string): Promise<Assistant | null> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id }
    });
    return assistant ? this.mapToDomain(assistant) : null;
  }

  async findByUserId(userId: string): Promise<Assistant | null> {
    const assistants = await this.prisma.assistant.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      take: 2
    });

    if (assistants.length > 1) {
      throw new Error("Assistant lookup by userId is ambiguous for multi-assistant users.");
    }
    const assistant = assistants[0] ?? null;
    return assistant ? this.mapToDomain(assistant) : null;
  }

  async create(userId: string, workspaceId: string): Promise<Assistant> {
    const assistant = await this.prisma.assistant.create({
      data: {
        userId,
        workspaceId
      }
    });

    return this.mapToDomain(assistant);
  }

  async updateDraft(userId: string, input: UpdateAssistantDraftInput): Promise<Assistant | null> {
    const assistantId = await this.findSingleAssistantIdByUserId(userId);
    if (assistantId === null) {
      return null;
    }
    return this.updateDraftByAssistantId(assistantId, input);
  }

  async updateDraftByAssistantId(
    assistantId: string,
    input: UpdateAssistantDraftInput
  ): Promise<Assistant | null> {
    const data: Record<string, unknown> = {
      draftDisplayName: input.draftDisplayName,
      draftInstructions: input.draftInstructions,
      draftUpdatedAt: new Date()
    };
    if (input.draftTraits !== undefined) data.draftTraits = input.draftTraits;
    if (input.draftAvatarEmoji !== undefined) data.draftAvatarEmoji = input.draftAvatarEmoji;
    if (input.draftAvatarUrl !== undefined) data.draftAvatarUrl = input.draftAvatarUrl;
    if (input.draftAssistantGender !== undefined) {
      data.draftAssistantGender = input.draftAssistantGender;
    }
    if (input.draftVoiceProfile !== undefined) {
      data.draftVoiceProfile =
        input.draftVoiceProfile === null
          ? Prisma.DbNull
          : (input.draftVoiceProfile as unknown as Prisma.InputJsonValue);
    }
    if (input.draftArchetypeKey !== undefined) {
      data.draftArchetypeKey = input.draftArchetypeKey;
    }

    const assistant = await this.prisma.assistant.update({
      where: { id: assistantId },
      data
    });

    return this.mapToDomain(assistant);
  }

  async markApplyPending(userId: string, targetVersionId: string): Promise<Assistant | null> {
    const assistantId = await this.findSingleAssistantIdByUserId(userId);
    if (assistantId === null) {
      return null;
    }
    return this.markApplyPendingByAssistantId(assistantId, targetVersionId);
  }

  async markApplyPendingByAssistantId(
    assistantId: string,
    targetVersionId: string
  ): Promise<Assistant | null> {
    const assistant = await this.prisma.assistant.update({
      where: { id: assistantId },
      data: {
        applyStatus: "pending",
        applyTargetVersionId: targetVersionId,
        applyAppliedVersionId: null,
        applyRequestedAt: new Date(),
        applyStartedAt: null,
        applyFinishedAt: null,
        applyErrorCode: null,
        applyErrorMessage: null
      }
    });

    return this.mapToDomain(assistant);
  }

  async markApplyInProgress(userId: string, targetVersionId: string): Promise<Assistant | null> {
    const assistantId = await this.findSingleAssistantIdByUserId(userId);
    if (assistantId === null) {
      return null;
    }
    return this.markApplyInProgressByAssistantId(assistantId, targetVersionId);
  }

  async markApplyInProgressByAssistantId(
    assistantId: string,
    targetVersionId: string
  ): Promise<Assistant | null> {
    const assistant = await this.prisma.assistant.update({
      where: { id: assistantId },
      data: {
        applyStatus: "in_progress",
        applyTargetVersionId: targetVersionId,
        applyRequestedAt: new Date(),
        applyStartedAt: new Date(),
        applyFinishedAt: null,
        applyErrorCode: null,
        applyErrorMessage: null
      }
    });

    return this.mapToDomain(assistant);
  }

  async markApplySucceeded(userId: string, appliedVersionId: string): Promise<Assistant | null> {
    const assistantId = await this.findSingleAssistantIdByUserId(userId);
    if (assistantId === null) {
      return null;
    }
    return this.markApplySucceededByAssistantId(assistantId, appliedVersionId);
  }

  async markApplySucceededByAssistantId(
    assistantId: string,
    appliedVersionId: string
  ): Promise<Assistant | null> {
    const assistant = await this.prisma.assistant.update({
      where: { id: assistantId },
      data: {
        applyStatus: "succeeded",
        applyAppliedVersionId: appliedVersionId,
        applyFinishedAt: new Date(),
        applyErrorCode: null,
        applyErrorMessage: null
      }
    });

    return this.mapToDomain(assistant);
  }

  async markApplyFailed(
    userId: string,
    targetVersionId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<Assistant | null> {
    const assistantId = await this.findSingleAssistantIdByUserId(userId);
    if (assistantId === null) {
      return null;
    }
    return this.markApplyFailedByAssistantId(assistantId, targetVersionId, errorCode, errorMessage);
  }

  async markApplyFailedByAssistantId(
    assistantId: string,
    targetVersionId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<Assistant | null> {
    const assistant = await this.prisma.assistant.update({
      where: { id: assistantId },
      data: {
        applyStatus: "failed",
        applyTargetVersionId: targetVersionId,
        applyFinishedAt: new Date(),
        applyErrorCode: errorCode,
        applyErrorMessage: errorMessage
      }
    });

    return this.mapToDomain(assistant);
  }

  async markApplyDegraded(
    userId: string,
    targetVersionId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<Assistant | null> {
    const assistantId = await this.findSingleAssistantIdByUserId(userId);
    if (assistantId === null) {
      return null;
    }
    return this.markApplyDegradedByAssistantId(
      assistantId,
      targetVersionId,
      errorCode,
      errorMessage
    );
  }

  async markApplyDegradedByAssistantId(
    assistantId: string,
    targetVersionId: string,
    errorCode: string,
    errorMessage: string
  ): Promise<Assistant | null> {
    const assistant = await this.prisma.assistant.update({
      where: { id: assistantId },
      data: {
        applyStatus: "degraded",
        applyTargetVersionId: targetVersionId,
        applyFinishedAt: new Date(),
        applyErrorCode: errorCode,
        applyErrorMessage: errorMessage
      }
    });

    return this.mapToDomain(assistant);
  }

  private async findSingleAssistantIdByUserId(userId: string): Promise<string | null> {
    const assistants = await this.prisma.assistant.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
      take: 2
    });
    if (assistants.length > 1) {
      throw new Error("Assistant mutation by userId is ambiguous for multi-assistant users.");
    }
    return assistants[0]?.id ?? null;
  }

  private mapToDomain(assistant: PrismaAssistant): Assistant {
    return {
      id: assistant.id,
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      draftDisplayName: assistant.draftDisplayName,
      draftInstructions: assistant.draftInstructions,
      draftTraits: assistant.draftTraits as Record<string, number> | null,
      draftAvatarEmoji: assistant.draftAvatarEmoji,
      draftAvatarUrl: assistant.draftAvatarUrl,
      draftAssistantGender: assistant.draftAssistantGender,
      draftVoiceProfile: assistant.draftVoiceProfile as RuntimeAssistantVoiceProfile | null,
      draftArchetypeKey: assistant.draftArchetypeKey,
      draftUpdatedAt: assistant.draftUpdatedAt,
      applyStatus: assistant.applyStatus,
      applyTargetVersionId: assistant.applyTargetVersionId,
      applyAppliedVersionId: assistant.applyAppliedVersionId,
      applyRequestedAt: assistant.applyRequestedAt,
      applyStartedAt: assistant.applyStartedAt,
      applyFinishedAt: assistant.applyFinishedAt,
      applyErrorCode: assistant.applyErrorCode,
      applyErrorMessage: assistant.applyErrorMessage,
      configDirtyAt: assistant.configDirtyAt,
      createdAt: assistant.createdAt,
      updatedAt: assistant.updatedAt
    };
  }
}
