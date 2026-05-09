import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import { PersaiKnowledgeObjectStorageService } from "./persai-knowledge-object-storage.service";

const ASSISTANT_PUBLISHED_VERSIONS_NO_DELETE_TRIGGER = "assistant_published_versions_no_delete";
const ASSISTANT_AUDIT_EVENTS_NO_UPDATE_TRIGGER = "assistant_audit_events_no_update";

@Injectable()
export class AdminDeleteUserService {
  private readonly logger = new Logger(AdminDeleteUserService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly knowledgeObjectStorage: PersaiKnowledgeObjectStorageService
  ) {}

  async execute(callerUserId: string, targetUserId: string): Promise<void> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);

    const user = await this.prisma.appUser.findUnique({ where: { id: targetUserId } });
    if (user === null) {
      throw new NotFoundException("User not found.");
    }

    const assistant = await this.prisma.assistant.findUnique({
      where: { userId: targetUserId }
    });
    const releasedBytes =
      assistant === null
        ? BigInt(0)
        : ((
            await this.prisma.assistantChatMessageAttachment.aggregate({
              where: { assistantId: assistant.id },
              _sum: { sizeBytes: true }
            })
          )._sum.sizeBytes ?? BigInt(0));
    const releasedKnowledgeBytes =
      assistant === null
        ? BigInt(0)
        : ((
            await this.prisma.assistantKnowledgeSource.aggregate({
              where: { assistantId: assistant.id },
              _sum: { sizeBytes: true }
            })
          )._sum.sizeBytes ?? BigInt(0));

    const workspaceMember = await this.prisma.workspaceMember.findFirst({
      where: { userId: targetUserId }
    });
    const workspaceId = workspaceMember?.workspaceId ?? null;

    this.logger.log(`Starting full delete transaction for user ${targetUserId}`);

    await this.prisma.$transaction(
      async (tx) => {
        let workspaceDeleted = false;
        await tx.$executeRawUnsafe(
          `ALTER TABLE "assistant_audit_events" DISABLE TRIGGER "${ASSISTANT_AUDIT_EVENTS_NO_UPDATE_TRIGGER}"`
        );
        try {
          if (assistant) {
            const aid = assistant.id;

            await tx.assistantPlatformRolloutItem.deleteMany({ where: { assistantId: aid } });
            await tx.assistantAbuseGuardState.deleteMany({ where: { assistantId: aid } });
            await tx.assistantAbuseAssistantState.deleteMany({ where: { assistantId: aid } });
            await tx.assistantAbusePeerState.deleteMany({ where: { assistantId: aid } });

            await tx.assistantChatMessageAttachment.deleteMany({ where: { assistantId: aid } });
            await tx.assistantChatMessage.deleteMany({ where: { assistantId: aid } });
            await tx.assistantChat.deleteMany({ where: { assistantId: aid } });

            await tx.assistantMemoryRegistryItem.deleteMany({ where: { assistantId: aid } });
            await tx.assistantTaskRegistryItem.deleteMany({ where: { assistantId: aid } });
            await tx.assistantKnowledgeSource.deleteMany({ where: { assistantId: aid } });
            await tx.runtimeTurnReceipt.deleteMany({ where: { assistantId: aid } });
            await tx.runtimeSessionCompaction.deleteMany({ where: { assistantId: aid } });
            await tx.runtimeSession.deleteMany({ where: { assistantId: aid } });
            await tx.runtimeBundleState.deleteMany({ where: { assistantId: aid } });

            await tx.assistantMaterializedSpec.deleteMany({ where: { assistantId: aid } });

            await tx.$executeRawUnsafe(`
              ALTER TABLE "assistant_published_versions"
              DISABLE TRIGGER "${ASSISTANT_PUBLISHED_VERSIONS_NO_DELETE_TRIGGER}"
            `);
            try {
              await tx.assistantPublishedVersion.deleteMany({ where: { assistantId: aid } });
            } finally {
              await tx.$executeRawUnsafe(`
                ALTER TABLE "assistant_published_versions"
                ENABLE TRIGGER "${ASSISTANT_PUBLISHED_VERSIONS_NO_DELETE_TRIGGER}"
              `);
            }

            await tx.assistantChannelSurfaceBinding.deleteMany({ where: { assistantId: aid } });
            await tx.assistantGovernance.deleteMany({ where: { assistantId: aid } });
            await tx.assistantTelegramGroup.deleteMany({ where: { assistantId: aid } });

            await tx.assistant.delete({ where: { id: aid } });
          }

          await tx.assistantPlatformRolloutItem.deleteMany({ where: { userId: targetUserId } });
          await tx.assistantAbuseGuardState.deleteMany({ where: { userId: targetUserId } });

          await tx.assistantPublishedVersion.updateMany({
            where: { publishedByUserId: targetUserId },
            data: { publishedByUserId: callerUserId }
          });

          await tx.workspaceMember.deleteMany({ where: { userId: targetUserId } });
          await tx.appUserAdminRole.deleteMany({ where: { userId: targetUserId } });

          if (workspaceId) {
            const remainingMembers = await tx.workspaceMember.count({
              where: { workspaceId }
            });

            if (remainingMembers === 0) {
              await tx.workspaceToolUsageDailyCounter.deleteMany({ where: { workspaceId } });
              await tx.workspaceQuotaUsageEvent.deleteMany({ where: { workspaceId } });
              await tx.workspaceQuotaAccountingState.deleteMany({ where: { workspaceId } });
              await tx.workspaceSubscription.deleteMany({ where: { workspaceId } });

              // notification_dead_letters references both workspace and intent with
              // onDelete: Restrict — must be removed before notification_intents and workspace.
              // notification_delivery_attempts cascades from notification_intents automatically.
              await tx.notificationDeadLetter.deleteMany({ where: { workspaceId } });
              await tx.notificationIntent.deleteMany({ where: { workspaceId } });

              workspaceDeleted = true;

              await tx.workspace.delete({ where: { id: workspaceId } });
            }
          }

          await tx.appUser.delete({ where: { id: targetUserId } });
        } finally {
          await tx.$executeRawUnsafe(
            `ALTER TABLE "assistant_audit_events" ENABLE TRIGGER "${ASSISTANT_AUDIT_EVENTS_NO_UPDATE_TRIGGER}"`
          );
        }
        return workspaceDeleted;
      },
      { timeout: 60_000 }
    );

    if (assistant !== null) {
      await this.mediaObjectStorage.deletePrefix(
        this.mediaObjectStorage.buildAssistantPrefix(assistant.id)
      );
      await this.knowledgeObjectStorage.deletePrefix(
        this.knowledgeObjectStorage.buildAssistantPrefix(assistant.id)
      );
    }

    if (assistant !== null && workspaceId !== null) {
      const survivingMembers = await this.prisma.workspaceMember.count({
        where: { workspaceId }
      });
      if (survivingMembers > 0) {
        await this.trackWorkspaceQuotaUsageService.releaseMediaStorage({
          assistant: {
            id: assistant.id,
            userId: assistant.userId,
            workspaceId: assistant.workspaceId
          } as Parameters<
            typeof this.trackWorkspaceQuotaUsageService.releaseMediaStorage
          >[0]["assistant"],
          sizeBytes: releasedBytes,
          source: "admin_delete_user_media_cleanup",
          metadata: { targetUserId }
        });
        await this.trackWorkspaceQuotaUsageService.releaseKnowledgeStorage({
          assistant: {
            id: assistant.id,
            userId: assistant.userId,
            workspaceId: assistant.workspaceId
          } as Parameters<
            typeof this.trackWorkspaceQuotaUsageService.releaseKnowledgeStorage
          >[0]["assistant"],
          sizeBytes: releasedKnowledgeBytes,
          source: "admin_delete_user_knowledge_cleanup",
          metadata: { targetUserId }
        });
      }
    }

    this.logger.log(`User ${targetUserId} fully deleted`);
  }
}
