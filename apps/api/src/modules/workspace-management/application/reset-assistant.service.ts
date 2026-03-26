import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
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
  private readonly logger = new Logger(ResetAssistantService.name);

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

    const aid = assistant.id;

    await this.prisma.$transaction([
      this.prisma.assistant.update({
        where: { id: aid },
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
      }),
      this.prisma.assistantChatMessage.deleteMany({
        where: { assistantId: aid }
      }),
      this.prisma.assistantChat.deleteMany({
        where: { assistantId: aid }
      }),
      this.prisma.assistantMemoryRegistryItem.deleteMany({
        where: { assistantId: aid }
      }),
      this.prisma.assistantMaterializedSpec.deleteMany({
        where: { assistantId: aid }
      }),
      this.prisma.assistantPublishedVersion.deleteMany({
        where: { assistantId: aid }
      }),
      this.prisma.assistant.update({
        where: { id: aid },
        data: {
          draftDisplayName: null,
          draftInstructions: null,
          draftTraits: Prisma.DbNull,
          draftAvatarEmoji: null,
          draftAvatarUrl: null,
          draftUpdatedAt: new Date()
        }
      })
    ]);

    try {
      await this.runtimeAdapter.cleanupWorkspace(aid);
    } catch (err) {
      this.logger.warn("Workspace cleanup failed (best-effort)", err);
    }

    try {
      await this.appendAssistantAuditEventService.execute({
        workspaceId: assistant.workspaceId,
        assistantId: aid,
        actorUserId: userId,
        eventCategory: "assistant_lifecycle",
        eventCode: "assistant.full_reset",
        summary:
          "Full assistant reset: all chats, memory, published versions, materialized specs and workspace files deleted.",
        details: {}
      });
    } catch (err) {
      this.logger.error("Failed to append audit event for reset", err);
    }
  }
}
