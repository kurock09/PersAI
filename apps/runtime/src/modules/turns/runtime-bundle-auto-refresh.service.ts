import { Injectable } from "@nestjs/common";
import type { RuntimeBundleRef, PersaiRuntimeTier } from "@persai/runtime-contract";
import { RuntimeBundleCoordinatorService } from "../bundles/runtime-bundle-coordinator.service";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

@Injectable()
export class RuntimeBundleAutoRefreshService {
  constructor(
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
    private readonly runtimeBundleCoordinatorService: RuntimeBundleCoordinatorService
  ) {}

  async ensureRequestedBundle(input: {
    bundle: RuntimeBundleRef;
    runtimeTier: PersaiRuntimeTier;
  }): Promise<boolean> {
    const freshSpec = await this.persaiInternalApiClientService.ensureFreshSpec({
      assistantId: input.bundle.assistantId,
      currentConfigGeneration: 0
    });
    if (freshSpec === null) {
      return false;
    }
    if (
      freshSpec.materializedSpecId !== input.bundle.bundleId ||
      freshSpec.publishedVersionId !== input.bundle.publishedVersionId ||
      freshSpec.bundleHash !== input.bundle.bundleHash
    ) {
      return false;
    }
    await this.runtimeBundleCoordinatorService.warmBundle({
      bundle: {
        ...input.bundle,
        compiledAt: new Date().toISOString()
      },
      bundleDocument: freshSpec.bundleDocument,
      materializedSpecId: freshSpec.materializedSpecId,
      runtimeTier: input.runtimeTier
    });
    return true;
  }

  async ensureAssistantVersionBundle(input: {
    assistantId: string;
    workspaceId: string;
    publishedVersionId: string;
    runtimeTier: PersaiRuntimeTier;
  }): Promise<boolean> {
    const freshSpec = await this.persaiInternalApiClientService.ensureFreshSpec({
      assistantId: input.assistantId,
      currentConfigGeneration: 0
    });
    if (freshSpec === null || freshSpec.publishedVersionId !== input.publishedVersionId) {
      return false;
    }
    await this.runtimeBundleCoordinatorService.warmBundle({
      bundle: {
        bundleId: freshSpec.materializedSpecId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        publishedVersionId: freshSpec.publishedVersionId,
        bundleHash: freshSpec.bundleHash,
        compiledAt: new Date().toISOString()
      },
      bundleDocument: freshSpec.bundleDocument,
      materializedSpecId: freshSpec.materializedSpecId,
      runtimeTier: input.runtimeTier
    });
    return true;
  }
}
