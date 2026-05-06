import { forwardRef, Inject, Injectable } from "@nestjs/common";
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
import { MaterializeAssistantPublishedVersionService } from "./materialize-assistant-published-version.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";

export type AssistantMaterializedSpecFreshness = {
  currentGeneration: number;
  latestPublishedVersion: AssistantPublishedVersion | null;
  materializedSpec: AssistantMaterializedSpec | null;
  refreshed: boolean;
  stale: boolean;
  specGeneration: number;
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
    private readonly bumpConfigGenerationService: BumpConfigGenerationService
  ) {}

  async resolveCurrent(
    assistant: Assistant,
    latestPublishedVersion?: AssistantPublishedVersion | null
  ): Promise<AssistantMaterializedSpec | null> {
    const freshness = await this.resolveFreshness(assistant, latestPublishedVersion);
    return freshness.materializedSpec;
  }

  async resolveFreshness(
    assistant: Assistant,
    latestPublishedVersion?: AssistantPublishedVersion | null
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
        specGeneration: existingSpec?.materializedAtConfigGeneration ?? 0
      };
    }

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
        specGeneration: existingSpec.materializedAtConfigGeneration
      };
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
      specGeneration: refreshedSpec?.materializedAtConfigGeneration ?? currentGeneration
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
