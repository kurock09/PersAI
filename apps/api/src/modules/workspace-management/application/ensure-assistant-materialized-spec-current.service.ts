import { forwardRef, Inject, Injectable } from "@nestjs/common";
import type {
  MaterializationRolloutItemStatus,
  MaterializationRolloutStatus
} from "@prisma/client";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import type { AssistantMaterializedSpec } from "../domain/assistant-materialized-spec.entity";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import type { Assistant } from "../domain/assistant.entity";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { MaterializeAssistantPublishedVersionService } from "./materialize-assistant-published-version.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";

type FreshnessResolveMode = "inline_refresh" | "rollout_aware";

export type AssistantMaterializationActivationBlock = {
  rolloutId: string;
  rolloutStatus: MaterializationRolloutStatus;
  itemStatus: MaterializationRolloutItemStatus;
  targetGeneration: number;
  reason: "hard_rollout_pending" | "hard_rollout_failed";
};

export type AssistantMaterializedSpecFreshness = {
  currentGeneration: number;
  latestPublishedVersion: AssistantPublishedVersion | null;
  materializedSpec: AssistantMaterializedSpec | null;
  refreshed: boolean;
  stale: boolean;
  specGeneration: number;
  activationBlock: AssistantMaterializationActivationBlock | null;
};

type ResolveFreshnessOptions = {
  mode?: FreshnessResolveMode;
};

@Injectable()
export class EnsureAssistantMaterializedSpecCurrentService {
  constructor(
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(forwardRef(() => MaterializeAssistantPublishedVersionService))
    private readonly materializeAssistantPublishedVersionService: MaterializeAssistantPublishedVersionService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async resolveCurrent(
    assistant: Assistant,
    latestPublishedVersion?: AssistantPublishedVersion | null,
    options?: ResolveFreshnessOptions
  ): Promise<AssistantMaterializedSpec | null> {
    const freshness = await this.resolveFreshness(assistant, latestPublishedVersion, options);
    return freshness.materializedSpec;
  }

  async resolveFreshness(
    assistant: Assistant,
    latestPublishedVersion?: AssistantPublishedVersion | null,
    options?: ResolveFreshnessOptions
  ): Promise<AssistantMaterializedSpecFreshness> {
    const [currentGeneration, resolvedPublishedVersion, existingSpec] = await Promise.all([
      this.bumpConfigGenerationService.current(),
      latestPublishedVersion === undefined
        ? this.assistantPublishedVersionRepository.findLatestByAssistantId(assistant.id)
        : latestPublishedVersion,
      this.assistantMaterializedSpecRepository.findLatestByAssistantId(assistant.id)
    ]);

    if (resolvedPublishedVersion === null) {
      return {
        currentGeneration,
        latestPublishedVersion: null,
        materializedSpec: existingSpec,
        refreshed: false,
        stale: false,
        specGeneration: existingSpec?.materializedAtConfigGeneration ?? 0,
        activationBlock: null
      };
    }

    const specGeneration = existingSpec?.materializedAtConfigGeneration ?? 0;
    const stale = this.isStale({
      assistant,
      currentGeneration,
      materializedSpec: existingSpec
    });

    if (!stale && existingSpec !== null) {
      return {
        currentGeneration,
        latestPublishedVersion: resolvedPublishedVersion,
        materializedSpec: existingSpec,
        refreshed: false,
        stale: false,
        specGeneration: existingSpec.materializedAtConfigGeneration,
        activationBlock: null
      };
    }

    if (options?.mode === "rollout_aware") {
      const activationBlock = await this.findHardActivationBlock({
        assistantId: assistant.id,
        specGeneration
      });
      if (activationBlock !== null) {
        return {
          currentGeneration,
          latestPublishedVersion: resolvedPublishedVersion,
          materializedSpec: existingSpec,
          refreshed: false,
          stale,
          specGeneration,
          activationBlock
        };
      }
    }

    await this.materializeAssistantPublishedVersionService.execute(
      assistant,
      resolvedPublishedVersion,
      existingSpec?.sourceAction ?? "publish"
    );
    const refreshedSpec = await this.assistantMaterializedSpecRepository.findByPublishedVersionId(
      resolvedPublishedVersion.id
    );

    return {
      currentGeneration,
      latestPublishedVersion: resolvedPublishedVersion,
      materializedSpec: refreshedSpec,
      refreshed: true,
      stale,
      specGeneration: refreshedSpec?.materializedAtConfigGeneration ?? currentGeneration,
      activationBlock: null
    };
  }

  private async findHardActivationBlock(input: {
    assistantId: string;
    specGeneration: number;
  }): Promise<AssistantMaterializationActivationBlock | null> {
    const row = await this.prisma.materializationRolloutItem.findFirst({
      where: {
        assistantId: input.assistantId,
        targetGeneration: { gt: input.specGeneration },
        status: {
          in: ["pending", "running", "failed"]
        },
        rollout: {
          criticality: "hard",
          status: {
            in: ["pending", "running", "failed"]
          }
        }
      },
      orderBy: [{ targetGeneration: "desc" }, { createdAt: "desc" }],
      select: {
        rolloutId: true,
        targetGeneration: true,
        status: true,
        rollout: {
          select: {
            status: true
          }
        }
      }
    });
    if (row === null) {
      return null;
    }
    return {
      rolloutId: row.rolloutId,
      rolloutStatus: row.rollout.status,
      itemStatus: row.status,
      targetGeneration: row.targetGeneration,
      reason: row.status === "failed" ? "hard_rollout_failed" : "hard_rollout_pending"
    };
  }

  private isStale(input: {
    assistant: Assistant;
    currentGeneration: number;
    materializedSpec: AssistantMaterializedSpec | null;
  }): boolean {
    const specGeneration = input.materializedSpec?.materializedAtConfigGeneration ?? 0;
    const globalStale = specGeneration < input.currentGeneration;
    const perUserStale =
      input.assistant.configDirtyAt !== null &&
      (input.materializedSpec === null ||
        input.assistant.configDirtyAt.getTime() > input.materializedSpec.createdAt.getTime());
    return input.materializedSpec === null || globalStale || perUserStale;
  }
}
