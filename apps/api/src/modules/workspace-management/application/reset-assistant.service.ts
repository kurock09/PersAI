import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter
} from "./assistant-runtime-adapter.types";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";

@Injectable()
export class ResetAssistantService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly runtimeAdapter: AssistantRuntimeAdapter,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  async execute(userId: string): Promise<void> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.assistant.update({
        where: { id: assistant.id },
        data: {
          applyStatus: "not_requested",
          applyTargetVersionId: null,
          applyAppliedVersionId: null,
          applyRequestedAt: null,
          applyStartedAt: null,
          applyFinishedAt: null,
          applyErrorCode: null,
          applyErrorMessage: null
        }
      });

      await tx.assistantChatMessage.deleteMany({
        where: { assistantId: assistant.id }
      });
      await tx.assistantChat.deleteMany({
        where: { assistantId: assistant.id }
      });
      await tx.assistantMemoryRegistryItem.deleteMany({
        where: { assistantId: assistant.id }
      });
      await tx.assistantMaterializedSpec.deleteMany({
        where: { assistantId: assistant.id }
      });
      await tx.assistantPublishedVersion.deleteMany({
        where: { assistantId: assistant.id }
      });

      await tx.assistant.update({
        where: { id: assistant.id },
        data: {
          draftDisplayName: null,
          draftInstructions: null,
          draftTraits: Prisma.JsonNull,
          draftAvatarEmoji: null,
          draftAvatarUrl: null,
          draftUpdatedAt: new Date()
        }
      });
    });

    try {
      await this.runtimeAdapter.cleanupWorkspace(assistant.id);
    } catch {
      // Workspace cleanup is best-effort; the DB wipe is the authoritative reset.
    }

    await this.appendAssistantAuditEventService.execute({
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      actorUserId: userId,
      eventCategory: "assistant_lifecycle",
      eventCode: "assistant.full_reset",
      summary:
        "Full assistant reset: all chats, memory, published versions, materialized specs and workspace files deleted.",
      details: {}
    });
  }
}
