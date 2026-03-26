import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { BumpConfigGenerationService } from "../../application/bump-config-generation.service";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../../domain/assistant.repository";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../../domain/assistant-materialized-spec.repository";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../../domain/assistant-published-version.repository";
import { ApplyAssistantPublishedVersionService } from "../../application/apply-assistant-published-version.service";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

type EnsureFreshSpecRequest = {
  assistantId: string;
  currentConfigGeneration: number;
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
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly materializedSpecRepository: AssistantMaterializedSpecRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly publishedVersionRepository: AssistantPublishedVersionRepository,
    private readonly applyAssistantPublishedVersionService: ApplyAssistantPublishedVersionService
  ) {}

  @Get("config-generation")
  async getConfigGeneration(@Req() req: InternalRequestLike): Promise<{
    generation: number;
  }> {
    this.assertAuthorized(req);
    const generation = await this.bumpConfigGenerationService.current();
    return { generation };
  }

  @HttpCode(200)
  @Post("ensure-fresh-spec")
  async ensureFreshSpec(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{
    fresh: boolean;
    rematerialized: boolean;
    generation: number;
  }> {
    this.assertAuthorized(req);
    const input = parseEnsureFreshSpecInput(body);

    const currentGeneration = await this.bumpConfigGenerationService.current();
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new BadRequestException("Assistant not found.");
    }

    const latestSpec = await this.materializedSpecRepository.findLatestByAssistantId(
      input.assistantId
    );
    const specGeneration = latestSpec?.materializedAtConfigGeneration ?? 0;
    const globalStale = specGeneration < currentGeneration;
    const perUserStale = assistant.configDirtyAt !== null;

    if (!globalStale && !perUserStale) {
      return { fresh: true, rematerialized: false, generation: currentGeneration };
    }

    const latestPublished = await this.publishedVersionRepository.findLatestByAssistantId(
      input.assistantId
    );
    if (latestPublished === null) {
      return { fresh: true, rematerialized: false, generation: currentGeneration };
    }

    await this.applyAssistantPublishedVersionService.execute(
      assistant.userId,
      latestPublished,
      true
    );

    return { fresh: true, rematerialized: true, generation: currentGeneration };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    const rawAuthHeader = req.headers.authorization;
    const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
    const token =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length).trim()
        : "";
    const configured = loadApiConfig(process.env).OPENCLAW_GATEWAY_TOKEN?.trim() ?? "";
    if (configured.length === 0) {
      throw new UnauthorizedException(
        "OPENCLAW_GATEWAY_TOKEN must be configured for internal endpoints."
      );
    }
    if (token.length === 0 || token !== configured) {
      throw new UnauthorizedException("Internal authorization failed.");
    }
  }
}
