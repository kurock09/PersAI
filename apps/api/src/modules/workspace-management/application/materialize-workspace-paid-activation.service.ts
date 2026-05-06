import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { readRuntimeAssignmentStateFromMaterializedLayers } from "./runtime-assignment";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import { SyncNativeRuntimeBundleService } from "./sync-native-runtime-bundle.service";
import { SyncProviderGatewayWarmupService } from "./sync-provider-gateway-warmup.service";

@Injectable()
export class MaterializeWorkspacePaidActivationService {
  private readonly logger = new Logger(MaterializeWorkspacePaidActivationService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(forwardRef(() => EnsureAssistantMaterializedSpecCurrentService))
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly syncNativeRuntimeBundleService: SyncNativeRuntimeBundleService,
    private readonly syncProviderGatewayWarmupService: SyncProviderGatewayWarmupService
  ) {}

  async execute(workspaceId: string): Promise<{
    attemptedAssistants: number;
    refreshedAssistants: number;
    failedAssistants: number;
  }> {
    const assistantIds = await this.prisma.assistant.findMany({
      where: { workspaceId },
      select: { id: true }
    });

    let attemptedAssistants = 0;
    let refreshedAssistants = 0;
    let failedAssistants = 0;

    for (const row of assistantIds) {
      const assistant = await this.assistantRepository.findById(row.id);
      if (assistant === null) {
        continue;
      }

      const latestPublishedVersion =
        await this.assistantPublishedVersionRepository.findLatestByAssistantId(assistant.id);
      if (latestPublishedVersion === null) {
        continue;
      }

      attemptedAssistants += 1;

      try {
        const freshness = await this.ensureAssistantMaterializedSpecCurrentService.resolveFreshness(
          assistant,
          latestPublishedVersion
        );
        const materializedSpec = freshness.materializedSpec;
        if (materializedSpec === null) {
          failedAssistants += 1;
          this.logger.warn(
            `Skipping immediate paid-activation warmup for assistant ${assistant.id}: materialized spec missing after refresh.`
          );
          continue;
        }

        const runtimeAssignment = readRuntimeAssignmentStateFromMaterializedLayers(
          materializedSpec.layers
        );
        const runtimeTier = runtimeAssignment?.effectiveTier ?? "free_shared_restricted";

        await this.syncNativeRuntimeBundleService.execute({
          materializedSpec,
          runtimeTier
        });
        await this.syncProviderGatewayWarmupService.execute({
          materializedSpec
        });

        refreshedAssistants += 1;
      } catch (error) {
        failedAssistants += 1;
        const message = error instanceof Error ? error.message : "Unknown materialization failure.";
        this.logger.warn(
          `Immediate paid-activation materialization failed for assistant ${assistant.id}: ${message}`
        );
      }
    }

    return {
      attemptedAssistants,
      refreshedAssistants,
      failedAssistants
    };
  }
}
