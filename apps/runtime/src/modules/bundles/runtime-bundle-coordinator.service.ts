import { BadRequestException, Injectable } from "@nestjs/common";
import { PERSAI_RUNTIME_TIERS } from "@persai/runtime-contract";
import { RuntimeStateRedisService } from "../runtime-state/infrastructure/coordination/runtime-state-redis.service";
import { RuntimeStatePostgresService } from "../runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import type {
  InvalidateRuntimeBundleRequest,
  InvalidateRuntimeBundleResponse,
  WarmRuntimeBundleRequest,
  WarmRuntimeBundleResponse
} from "./bundle.types";
import { RuntimeBundleRegistryService } from "./runtime-bundle-registry.service";

@Injectable()
export class RuntimeBundleCoordinatorService {
  constructor(
    private readonly runtimeBundleRegistryService: RuntimeBundleRegistryService,
    private readonly runtimeStatePostgresService: RuntimeStatePostgresService,
    private readonly runtimeStateRedisService: RuntimeStateRedisService
  ) {}

  async warmBundle(input: WarmRuntimeBundleRequest): Promise<WarmRuntimeBundleResponse> {
    this.assertNonEmpty(input.materializedSpecId, "materializedSpecId");
    if (!PERSAI_RUNTIME_TIERS.includes(input.runtimeTier)) {
      throw new BadRequestException("runtimeTier must be a supported PersAI runtime tier");
    }

    this.runtimeBundleRegistryService.validateWarmBundleInput(input);
    const warmedAt = new Date();
    const warmedAtIso = warmedAt.toISOString();

    await this.runtimeStatePostgresService.upsertBundleState({
      assistantId: input.bundle.assistantId,
      workspaceId: input.bundle.workspaceId,
      materializedSpecId: input.materializedSpecId,
      publishedVersionId: input.bundle.publishedVersionId,
      runtimeTier: input.runtimeTier,
      bundleHash: input.bundle.bundleHash
    });

    try {
      await this.runtimeStatePostgresService.markBundleStateWarmed(
        input.bundle.publishedVersionId,
        warmedAt
      );
      await this.runtimeStateRedisService.markBundleWarm(input.bundle);
      return this.runtimeBundleRegistryService.warmBundle(input, warmedAtIso);
    } catch (error) {
      await Promise.allSettled([
        this.runtimeStatePostgresService.invalidateBundleStates({
          assistantId: input.bundle.assistantId,
          publishedVersionId: input.bundle.publishedVersionId,
          invalidatedAt: warmedAt
        }),
        this.runtimeStateRedisService.invalidateBundleMarkers({
          assistantId: input.bundle.assistantId,
          publishedVersionId: input.bundle.publishedVersionId
        })
      ]);
      throw error;
    }
  }

  async invalidateBundles(
    input: InvalidateRuntimeBundleRequest
  ): Promise<InvalidateRuntimeBundleResponse> {
    this.assertNonEmpty(input.assistantId, "assistantId");
    const invalidatedAt = new Date();
    const invalidatedAtIso = invalidatedAt.toISOString();

    await this.runtimeStatePostgresService.invalidateBundleStates({
      assistantId: input.assistantId,
      ...(input.publishedVersionId === undefined
        ? {}
        : { publishedVersionId: input.publishedVersionId }),
      invalidatedAt
    });

    let redisError: unknown = null;
    try {
      await this.runtimeStateRedisService.invalidateBundleMarkers(input);
    } catch (error) {
      redisError = error;
    }

    const invalidated = this.runtimeBundleRegistryService.invalidateBundles(input, invalidatedAtIso);
    if (redisError) {
      throw redisError;
    }
    return invalidated;
  }

  private assertNonEmpty(value: unknown, field: string): void {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} must be a non-empty string`);
    }
  }
}
