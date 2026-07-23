import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res
} from "@nestjs/common";
import { BumpConfigGenerationService } from "../../application/bump-config-generation.service";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../../domain/assistant.repository";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../../domain/assistant-published-version.repository";
import { ResolvePlatformRuntimeProviderSettingsService } from "../../application/resolve-platform-runtime-provider-settings.service";
import { EnsureAssistantMaterializedSpecCurrentService } from "../../application/ensure-assistant-materialized-spec-current.service";
import { resolveMaterializedNativeRuntimeBundle } from "../../application/native-runtime-bundle-hash";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

type EnsureFreshSpecRequest = {
  assistantId: string;
  currentConfigGeneration: number;
};

type EnsureFreshSpecResponse = {
  generation: number;
  assistantId: string;
  materializedSpecId: string;
  publishedVersionId: string;
  contentHash: string;
  bundleHash: string;
  bundleDocument: string;
  spec: {
    assistantConfig: unknown;
    assistantWorkspace: unknown;
  };
};

function parseEnsureFreshSpecInput(body: unknown): EnsureFreshSpecRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestException("Request body must be an object.");
  }
  const row = body as Record<string, unknown>;
  if (typeof row.assistantId !== "string" || row.assistantId.trim().length === 0) {
    throw new BadRequestException("assistantId must be a non-empty string.");
  }
  if (
    typeof row.currentConfigGeneration !== "number" ||
    !Number.isInteger(row.currentConfigGeneration)
  ) {
    throw new BadRequestException("currentConfigGeneration must be an integer.");
  }
  return {
    assistantId: row.assistantId.trim(),
    currentConfigGeneration: row.currentConfigGeneration
  };
}

@Controller("api/v1/internal/runtime")
export class InternalRuntimeConfigGenerationController {
  constructor(
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly publishedVersionRepository: AssistantPublishedVersionRepository,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService
  ) {}

  @Get("config-generation")
  async getConfigGeneration(@Req() req: InternalRequestLike): Promise<{
    generation: number;
  }> {
    this.assertAuthorized(req);
    const generation = await this.bumpConfigGenerationService.current();
    return { generation };
  }

  @Get("provider-settings/default")
  async getDefaultProviderSettings(@Req() req: InternalRequestLike): Promise<{
    generation: number;
    mode: "unconfigured_default" | "global_settings";
    primary: { provider: "openai" | "anthropic" | "deepseek" | "kimi"; model: string } | null;
    availableModelsByProvider: Record<"openai" | "anthropic" | "deepseek" | "kimi", string[]>;
  }> {
    this.assertAuthorized(req);
    const [generation, settings] = await Promise.all([
      this.bumpConfigGenerationService.current(),
      this.resolvePlatformRuntimeProviderSettingsService.execute()
    ]);
    return {
      generation,
      mode: settings.mode,
      primary: settings.primary,
      availableModelsByProvider: settings.availableModelsByProvider
    };
  }

  @HttpCode(200)
  @Post("ensure-fresh-spec")
  async ensureFreshSpec(
    @Req() req: InternalRequestLike,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: { status(code: number): unknown }
  ): Promise<EnsureFreshSpecResponse | void> {
    this.assertAuthorized(req);
    const input = parseEnsureFreshSpecInput(body);

    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new BadRequestException("Assistant not found.");
    }

    const latestPublished = await this.publishedVersionRepository.findLatestByAssistantId(
      input.assistantId
    );
    if (latestPublished === null) {
      res.status(204);
      return;
    }

    const freshness = await this.ensureAssistantMaterializedSpecCurrentService.resolveFreshness(
      assistant,
      latestPublished
    );
    const refreshedSpec = freshness.materializedSpec;
    if (refreshedSpec === null) {
      throw new BadRequestException("Fresh materialized spec was not found.");
    }
    const specGeneration = refreshedSpec.materializedAtConfigGeneration;
    const runtimeBehind = input.currentConfigGeneration < specGeneration;
    if (!freshness.refreshed && !runtimeBehind) {
      res.status(204);
      return;
    }
    const { bundleHash, bundleDocument } = resolveMaterializedNativeRuntimeBundle({
      materializedSpec: refreshedSpec,
      context: "Fresh materialized"
    });

    return {
      generation: freshness.currentGeneration,
      assistantId: assistant.id,
      materializedSpecId: refreshedSpec.id,
      publishedVersionId: refreshedSpec.publishedVersionId,
      contentHash: refreshedSpec.contentHash,
      bundleHash,
      bundleDocument,
      spec: {
        assistantConfig: refreshedSpec.assistantConfig,
        assistantWorkspace: refreshedSpec.assistantWorkspace
      }
    };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal endpoints.",
      "Internal authorization failed."
    );
  }
}
