import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import { PersaiKnowledgeObjectStorageService } from "./persai-knowledge-object-storage.service";

const ASSISTANT_PUBLISHED_VERSIONS_NO_DELETE_TRIGGER = "assistant_published_versions_no_delete";
const ASSISTANT_AUDIT_EVENTS_NO_UPDATE_TRIGGER = "assistant_audit_events_no_update";

type TransactionClient = Prisma.TransactionClient;

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

    const assistants = await this.prisma.assistant.findMany({
      where: { userId: targetUserId },
      orderBy: { createdAt: "asc" },
      take: 2
    });
    if (assistants.length > 1) {
      throw new ConflictException(
        "User has multiple assistants; delete flow requires ADR-101 cleanup."
      );
    }
    const assistant = assistants[0] ?? null;
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
        if (assistant) {
          const aid = assistant.id;
          // ADR-133 Slice 3 — schedule the assistant subtree for deferred GC
          // before deleting the source row so the lease survives the hard-delete
          // transaction even though the lease table intentionally has no foreign
          // key back to the assistant row.
          await tx.sandboxWorkspaceGcLease.create({
            data: {
              kind: "assistant_subtree",
              targetId: aid,
              scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              metadata: {
                workspaceId: assistant.workspaceId,
                assistantId: aid
              }
            }
          });

          await tx.assistantPlatformRolloutItem.deleteMany({ where: { assistantId: aid } });
          await tx.assistantAbuseGuardState.deleteMany({ where: { assistantId: aid } });
          await tx.assistantAbuseAssistantState.deleteMany({ where: { assistantId: aid } });
          await tx.assistantAbusePeerState.deleteMany({ where: { assistantId: aid } });

          await this.deleteByAssistantId(tx, "assistant_background_task_runs", aid);
          await this.deleteByAssistantId(tx, "assistant_background_tasks", aid);
          await this.deleteByAssistantId(tx, "assistant_web_chat_turn_attempts", aid);
          await this.deleteByAssistantId(tx, "assistant_media_jobs", aid);
          // Residual assignment rows cascade from Assistant FK (S5a: no explicit delete).
          await this.deleteByAssistantId(tx, "assistant_workspace_leases", aid);
          await this.deleteByAssistantId(tx, "sandbox_jobs", aid);

          await tx.assistantChatMessageAttachment.deleteMany({ where: { assistantId: aid } });
          await tx.assistantChatMessage.deleteMany({ where: { assistantId: aid } });
          await tx.assistantChat.deleteMany({ where: { assistantId: aid } });

          await tx.assistantMemoryRegistryItem.deleteMany({ where: { assistantId: aid } });
          await tx.assistantTaskRegistryItem.deleteMany({ where: { assistantId: aid } });
          await this.deleteByAssistantId(tx, "assistant_knowledge_source_chunks", aid);
          await tx.assistantKnowledgeSource.deleteMany({ where: { assistantId: aid } });
          await tx.runtimeTurnReceipt.deleteMany({ where: { assistantId: aid } });
          await tx.runtimeSessionCompaction.deleteMany({ where: { assistantId: aid } });
          await tx.runtimeSession.deleteMany({ where: { assistantId: aid } });
          await tx.runtimeBundleState.deleteMany({ where: { assistantId: aid } });

          await tx.assistantMaterializedSpec.deleteMany({ where: { assistantId: aid } });

          await this.withPublishedVersionDeleteTriggerDisabled(tx, async () => {
            await tx.assistantPublishedVersion.deleteMany({ where: { assistantId: aid } });
          });

          await tx.assistantChannelSurfaceBinding.deleteMany({ where: { assistantId: aid } });
          await tx.assistantGovernance.deleteMany({ where: { assistantId: aid } });
          await tx.assistantTelegramGroup.deleteMany({ where: { assistantId: aid } });
          await tx.workspaceMember.updateMany({
            where: { activeAssistantId: aid },
            data: { activeAssistantId: null }
          });

          await this.withAuditEventNoUpdateTriggerDisabled(tx, async () => {
            await tx.assistant.delete({ where: { id: aid } });
          });
        }

        await tx.assistantPlatformRolloutItem.deleteMany({ where: { userId: targetUserId } });
        await tx.assistantAbuseGuardState.deleteMany({ where: { userId: targetUserId } });

        await tx.assistantPublishedVersion.updateMany({
          where: { publishedByUserId: targetUserId },
          data: { publishedByUserId: callerUserId }
        });
        await tx.globalKnowledgeSource.updateMany({
          where: { createdByUserId: targetUserId },
          data: { createdByUserId: callerUserId }
        });
        await tx.productKnowledgeTextEntry.updateMany({
          where: { createdByUserId: targetUserId },
          data: { createdByUserId: callerUserId }
        });
        await tx.skill.updateMany({
          where: { createdByUserId: targetUserId },
          data: { createdByUserId: callerUserId }
        });
        await tx.skillDocument.updateMany({
          where: { createdByUserId: targetUserId },
          data: { createdByUserId: callerUserId }
        });
        await tx.skillKnowledgeCard.updateMany({
          where: { createdByUserId: targetUserId },
          data: { createdByUserId: callerUserId }
        });

        await tx.workspaceMember.deleteMany({ where: { userId: targetUserId } });
        await tx.appUserAdminRole.deleteMany({ where: { userId: targetUserId } });

        if (workspaceId) {
          const remainingMembers = await tx.workspaceMember.count({
            where: { workspaceId }
          });

          if (remainingMembers === 0) {
            await tx.workspaceToolUsageDailyCounter.deleteMany({ where: { workspaceId } });
            await this.deleteByWorkspaceId(
              tx,
              "workspace_token_budget_period_counters",
              workspaceId
            );
            await this.deleteByWorkspaceId(
              tx,
              "workspace_media_monthly_quota_counters",
              workspaceId
            );
            await tx.workspaceQuotaUsageEvent.deleteMany({ where: { workspaceId } });
            await tx.workspaceQuotaAccountingState.deleteMany({ where: { workspaceId } });

            await this.deleteByWorkspaceId(tx, "workspace_media_package_grants", workspaceId);
            await this.deleteByWorkspaceId(tx, "workspace_payment_intents", workspaceId);
            await this.deleteByWorkspaceId(
              tx,
              "workspace_subscription_billing_events",
              workspaceId
            );
            await this.deleteByWorkspaceId(
              tx,
              "workspace_subscription_lifecycle_events",
              workspaceId
            );
            await tx.workspaceSubscription.deleteMany({ where: { workspaceId } });

            await this.deleteByWorkspaceId(tx, "knowledge_retrieval_events", workspaceId);
            await this.deleteByWorkspaceId(tx, "knowledge_retrieval_rollups", workspaceId);
            await this.deleteByWorkspaceId(tx, "knowledge_vector_chunks", workspaceId);
            await this.deleteByWorkspaceId(tx, "knowledge_indexing_jobs", workspaceId);

            // notification_dead_letters references both workspace and intent with
            // onDelete: Restrict — must be removed before notification_intents and workspace.
            // notification_delivery_attempts cascades from notification_intents automatically.
            await tx.notificationDeadLetter.deleteMany({ where: { workspaceId } });
            await tx.notificationIntent.deleteMany({ where: { workspaceId } });

            await this.withAuditEventNoUpdateTriggerDisabled(tx, async () => {
              await tx.assistantAuditEvent.updateMany({
                where: { workspaceId },
                data: { workspaceId: null }
              });
            });

            workspaceDeleted = true;

            // ADR-133 Slice 3 — schedule the workspace subtree for deferred GC
            // (GCS prefix + warm pods + workspace file metadata).
            // Lease lives independently of the workspace row so the GC schedule
            // survives the hard-delete that runs on the next statement.
            await tx.sandboxWorkspaceGcLease.create({
              data: {
                kind: "workspace_subtree",
                targetId: workspaceId,
                scheduledAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                metadata: {}
              }
            });

            await tx.workspace.delete({ where: { id: workspaceId } });
          }
        }

        await this.withAuditEventNoUpdateTriggerDisabled(tx, async () => {
          await tx.assistantAuditEvent.updateMany({
            where: { actorUserId: targetUserId },
            data: { actorUserId: null }
          });
        });

        await tx.appUser.delete({ where: { id: targetUserId } });
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

  private async deleteByAssistantId(
    tx: TransactionClient,
    tableName: string,
    assistantId: string
  ): Promise<void> {
    await tx.$executeRawUnsafe(
      `DELETE FROM "${tableName}" WHERE "assistant_id" = $1::uuid`,
      assistantId
    );
  }

  private async deleteByWorkspaceId(
    tx: TransactionClient,
    tableName: string,
    workspaceId: string
  ): Promise<void> {
    await tx.$executeRawUnsafe(
      `DELETE FROM "${tableName}" WHERE "workspace_id" = $1::uuid`,
      workspaceId
    );
  }

  private async withAuditEventNoUpdateTriggerDisabled<T>(
    tx: TransactionClient,
    operation: () => Promise<T>
  ): Promise<T> {
    await tx.$executeRawUnsafe(
      `ALTER TABLE "assistant_audit_events" DISABLE TRIGGER "${ASSISTANT_AUDIT_EVENTS_NO_UPDATE_TRIGGER}"`
    );
    const result = await operation();
    await tx.$executeRawUnsafe(
      `ALTER TABLE "assistant_audit_events" ENABLE TRIGGER "${ASSISTANT_AUDIT_EVENTS_NO_UPDATE_TRIGGER}"`
    );
    return result;
  }

  private async withPublishedVersionDeleteTriggerDisabled<T>(
    tx: TransactionClient,
    operation: () => Promise<T>
  ): Promise<T> {
    await tx.$executeRawUnsafe(`
      ALTER TABLE "assistant_published_versions"
      DISABLE TRIGGER "${ASSISTANT_PUBLISHED_VERSIONS_NO_DELETE_TRIGGER}"
    `);
    const result = await operation();
    await tx.$executeRawUnsafe(`
      ALTER TABLE "assistant_published_versions"
      ENABLE TRIGGER "${ASSISTANT_PUBLISHED_VERSIONS_NO_DELETE_TRIGGER}"
    `);
    return result;
  }
}
