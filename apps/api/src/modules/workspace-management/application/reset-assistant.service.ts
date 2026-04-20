import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import { PersaiKnowledgeObjectStorageService } from "./persai-knowledge-object-storage.service";

@Injectable()
export class ResetAssistantService {
  private readonly logger = new Logger(ResetAssistantService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly knowledgeObjectStorage: PersaiKnowledgeObjectStorageService
  ) {}

  async execute(userId: string): Promise<void> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const aid = assistant.id;
    const releasedBytes = await this.attachmentRepository.sumSizeBytesByAssistantId(aid);
    const releasedKnowledgeBytes =
      (
        await this.prisma.assistantKnowledgeSource.aggregate({
          where: { assistantId: aid },
          _sum: { sizeBytes: true }
        })
      )._sum.sizeBytes ?? BigInt(0);

    this.logger.log(`Starting reset transaction for assistant ${aid}`);

    try {
      await this.prisma.$transaction(
        async (tx) => {
          this.logger.log("Step 1: clearing assistant fields");
          await tx.assistant.update({
            where: { id: aid },
            data: {
              applyStatus: "not_requested",
              applyTargetVersionId: null,
              applyAppliedVersionId: null,
              applyRequestedAt: null,
              applyStartedAt: null,
              applyFinishedAt: null,
              applyErrorCode: null,
              applyErrorMessage: null,
              draftDisplayName: null,
              draftInstructions: null,
              draftTraits: Prisma.DbNull,
              draftAvatarEmoji: null,
              draftAvatarUrl: null,
              draftAssistantGender: null,
              draftVoiceProfile: Prisma.DbNull,
              draftArchetypeKey: null,
              draftUpdatedAt: new Date()
            }
          });

          this.logger.log("Step 2a: deleting chat message attachments");
          await tx.assistantChatMessageAttachment.deleteMany({ where: { assistantId: aid } });

          this.logger.log("Step 2b: deleting chat messages");
          await tx.assistantChatMessage.deleteMany({ where: { assistantId: aid } });

          this.logger.log("Step 3: deleting chats");
          await tx.assistantChat.deleteMany({ where: { assistantId: aid } });

          this.logger.log("Step 4: deleting memory items");
          await tx.assistantMemoryRegistryItem.deleteMany({ where: { assistantId: aid } });

          this.logger.log("Step 5: deleting task items");
          await tx.assistantTaskRegistryItem.deleteMany({ where: { assistantId: aid } });

          this.logger.log("Step 6: deleting knowledge sources");
          await tx.assistantKnowledgeSource.deleteMany({ where: { assistantId: aid } });

          this.logger.log("Step 7: deleting runtime turn receipts");
          await tx.runtimeTurnReceipt.deleteMany({ where: { assistantId: aid } });

          this.logger.log("Step 8: deleting runtime session compactions");
          await tx.runtimeSessionCompaction.deleteMany({ where: { assistantId: aid } });

          this.logger.log("Step 9: deleting runtime sessions");
          await tx.runtimeSession.deleteMany({ where: { assistantId: aid } });

          this.logger.log("Step 10: deleting runtime bundle states");
          await tx.runtimeBundleState.deleteMany({ where: { assistantId: aid } });

          this.logger.log("Step 11: deleting materialized specs");
          await tx.assistantMaterializedSpec.deleteMany({ where: { assistantId: aid } });

          this.logger.log(
            "Step 12: disabling immutability trigger and deleting published versions"
          );
          await tx.$executeRawUnsafe(
            `ALTER TABLE "assistant_published_versions" DISABLE TRIGGER "assistant_published_versions_no_delete"`
          );
          await tx.assistantPublishedVersion.deleteMany({ where: { assistantId: aid } });
          await tx.$executeRawUnsafe(
            `ALTER TABLE "assistant_published_versions" ENABLE TRIGGER "assistant_published_versions_no_delete"`
          );

          this.logger.log("Transaction complete");
        },
        { timeout: 30_000 }
      );
    } catch (err) {
      this.logger.error("Reset transaction failed", err instanceof Error ? err.stack : err);
      throw err;
    }

    await this.mediaObjectStorage.deletePrefix(this.mediaObjectStorage.buildAssistantPrefix(aid));
    await this.knowledgeObjectStorage.deletePrefix(
      this.knowledgeObjectStorage.buildAssistantPrefix(aid)
    );
    await this.trackWorkspaceQuotaUsageService.releaseMediaStorage({
      assistant,
      sizeBytes: releasedBytes,
      source: "assistant_reset_media_cleanup",
      metadata: { assistantId: aid }
    });
    await this.trackWorkspaceQuotaUsageService.releaseKnowledgeStorage({
      assistant,
      sizeBytes: releasedKnowledgeBytes,
      source: "assistant_reset_knowledge_cleanup",
      metadata: { assistantId: aid }
    });

    try {
      await this.appendAssistantAuditEventService.execute({
        workspaceId: assistant.workspaceId,
        assistantId: aid,
        actorUserId: userId,
        eventCategory: "assistant_lifecycle",
        eventCode: "assistant.full_reset",
        summary:
          "Full assistant reset: chats, memory, tasks, knowledge sources, runtime state, published versions, materialized specs, and workspace files deleted.",
        details: {}
      });
    } catch (err) {
      this.logger.error("Failed to append audit event for reset", err);
    }
  }
}
