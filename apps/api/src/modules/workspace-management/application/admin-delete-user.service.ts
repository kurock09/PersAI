import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter
} from "./assistant-runtime-adapter.types";
import { AdminAuthorizationService } from "./admin-authorization.service";

@Injectable()
export class AdminDeleteUserService {
  private readonly logger = new Logger(AdminDeleteUserService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly runtimeAdapter: AssistantRuntimeAdapter,
    private readonly adminAuthorizationService: AdminAuthorizationService
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

    if (assistant) {
      this.logger.log(`Resetting runtime workspace for assistant ${assistant.id}`);
      try {
        await this.runtimeAdapter.resetWorkspace(assistant.id);
      } catch (err) {
        this.logger.warn("Runtime workspace reset failed (continuing)", err);
      }
    }

    const workspaceMember = await this.prisma.workspaceMember.findFirst({
      where: { userId: targetUserId }
    });
    const workspaceId = workspaceMember?.workspaceId ?? null;

    this.logger.log(`Starting full delete transaction for user ${targetUserId}`);

    await this.prisma.$transaction(
      async (tx) => {
        if (assistant) {
          const aid = assistant.id;

          await tx.assistantPlatformRolloutItem.deleteMany({ where: { assistantId: aid } });
          await tx.assistantAbuseGuardState.deleteMany({ where: { assistantId: aid } });
          await tx.assistantAbuseAssistantState.deleteMany({ where: { assistantId: aid } });

          await tx.assistantChatMessageAttachment.deleteMany({ where: { assistantId: aid } });
          await tx.assistantChatMessage.deleteMany({ where: { assistantId: aid } });
          await tx.assistantChat.deleteMany({ where: { assistantId: aid } });

          await tx.assistantMemoryRegistryItem.deleteMany({ where: { assistantId: aid } });
          await tx.assistantTaskRegistryItem.deleteMany({ where: { assistantId: aid } });

          await tx.assistantMaterializedSpec.deleteMany({ where: { assistantId: aid } });

          await tx.$executeRawUnsafe(
            `ALTER TABLE "assistant_published_versions" DISABLE TRIGGER "assistant_published_versions_no_delete"`
          );
          await tx.assistantPublishedVersion.deleteMany({ where: { assistantId: aid } });
          await tx.$executeRawUnsafe(
            `ALTER TABLE "assistant_published_versions" ENABLE TRIGGER "assistant_published_versions_no_delete"`
          );

          await tx.assistantChannelSurfaceBinding.deleteMany({ where: { assistantId: aid } });
          await tx.assistantGovernance.deleteMany({ where: { assistantId: aid } });
          await tx.assistantTelegramGroup.deleteMany({ where: { assistantId: aid } });

          await tx.assistantAuditEvent.updateMany({
            where: { assistantId: aid },
            data: { assistantId: null }
          });

          await tx.assistant.delete({ where: { id: aid } });
        }

        await tx.assistantPlatformRolloutItem.deleteMany({ where: { userId: targetUserId } });
        await tx.assistantAbuseGuardState.deleteMany({ where: { userId: targetUserId } });

        await tx.assistantAuditEvent.updateMany({
          where: { actorUserId: targetUserId },
          data: { actorUserId: null }
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

            const channels = await tx.workspaceAdminNotificationChannel.findMany({
              where: { workspaceId },
              select: { id: true }
            });
            if (channels.length > 0) {
              await tx.adminNotificationDelivery.deleteMany({
                where: { channelId: { in: channels.map((c) => c.id) } }
              });
              await tx.workspaceAdminNotificationChannel.deleteMany({ where: { workspaceId } });
            }

            await tx.workspace.delete({ where: { id: workspaceId } });
          }
        }

        await tx.appUser.delete({ where: { id: targetUserId } });
      },
      { timeout: 60_000 }
    );

    this.logger.log(`User ${targetUserId} fully deleted`);
  }
}
