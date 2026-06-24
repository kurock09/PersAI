import { randomUUID } from "node:crypto";
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
import { buildAssistantHandle } from "../../application/assistant-handle";

@Injectable()
export class PrismaAssistantRepository implements AssistantRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findById(id: string): Promise<Assistant | null> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id }
    });
    return assistant ? this.mapToDomain(assistant) : null;
  }

  async create(userId: string, workspaceId: string): Promise<Assistant> {
    // ADR-126 Slice 3: every assistant ships with a workspace-unique `handle`.
    // We mint the id client-side so the slug fallback (`a-<first 8 hex of id>`)
    // is stable for the row across a retry, and so we can build the handle
    // inside the same transaction that performs the insert (the unique
    // `(workspace_id, handle)` index is the ultimate guard against races).
    const newId = randomUUID();
    const assistant = await this.prisma.$transaction(async (tx) => {
      // `draft_display_name` is null at first creation today; the slugifier
      // falls back to `a-<hex>` deterministically. Future entry points that
      // create assistants with a chosen name go through this same helper.
      const handle = await buildAssistantHandle(tx, workspaceId, null, newId);
      return tx.assistant.create({
        data: {
          id: newId,
          userId,
          workspaceId,
          handle
        }
      });
    });

    return this.mapToDomain(assistant);
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

  private mapToDomain(assistant: PrismaAssistant): Assistant {
    return {
      id: assistant.id,
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      handle: assistant.handle,
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
