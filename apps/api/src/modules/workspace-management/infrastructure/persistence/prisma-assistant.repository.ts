import { Injectable } from "@nestjs/common";
import type { Assistant as PrismaAssistant } from "@prisma/client";
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
    const assistant = await this.prisma.assistant.findUnique({
      where: { userId }
    });

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
    const existingAssistant = await this.prisma.assistant.findUnique({
      where: { userId },
      select: { id: true }
    });

    if (existingAssistant === null) {
      return null;
    }

    const data: Record<string, unknown> = {
      draftDisplayName: input.draftDisplayName,
      draftInstructions: input.draftInstructions,
      draftUpdatedAt: new Date()
    };
    if (input.draftTraits !== undefined) data.draftTraits = input.draftTraits;
    if (input.draftAvatarEmoji !== undefined) data.draftAvatarEmoji = input.draftAvatarEmoji;
    if (input.draftAvatarUrl !== undefined) data.draftAvatarUrl = input.draftAvatarUrl;

    const assistant = await this.prisma.assistant.update({
      where: { userId },
      data
    });

    return this.mapToDomain(assistant);
  }

  async markApplyPending(userId: string, targetVersionId: string): Promise<Assistant | null> {
    const existingAssistant = await this.prisma.assistant.findUnique({
      where: { userId },
      select: { id: true }
    });

    if (existingAssistant === null) {
      return null;
    }

    const assistant = await this.prisma.assistant.update({
      where: { userId },
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
    const existingAssistant = await this.prisma.assistant.findUnique({
      where: { userId },
      select: { id: true }
    });

    if (existingAssistant === null) {
      return null;
    }

    const assistant = await this.prisma.assistant.update({
      where: { userId },
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
    const existingAssistant = await this.prisma.assistant.findUnique({
      where: { userId },
      select: { id: true }
    });

    if (existingAssistant === null) {
      return null;
    }

    const assistant = await this.prisma.assistant.update({
      where: { userId },
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
    const existingAssistant = await this.prisma.assistant.findUnique({
      where: { userId },
      select: { id: true }
    });

    if (existingAssistant === null) {
      return null;
    }

    const assistant = await this.prisma.assistant.update({
      where: { userId },
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
    const existingAssistant = await this.prisma.assistant.findUnique({
      where: { userId },
      select: { id: true }
    });

    if (existingAssistant === null) {
      return null;
    }

    const assistant = await this.prisma.assistant.update({
      where: { userId },
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
