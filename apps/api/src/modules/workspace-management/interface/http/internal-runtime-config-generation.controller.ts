import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  Res
} from "@nestjs/common";
import { BumpConfigGenerationService } from "../../application/bump-config-generation.service";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../../domain/assistant-materialized-spec.repository";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../../domain/assistant-published-version.repository";
import { MaterializeAssistantPublishedVersionService } from "../../application/materialize-assistant-published-version.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "../../application/resolve-platform-runtime-provider-settings.service";
import { SyncTelegramChatTargetService } from "../../application/sync-telegram-chat-target.service";
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
  publishedVersionId: string;
  contentHash: string;
  spec: {
    bootstrap: unknown;
    workspace: unknown;
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
  private readonly logger = new Logger(InternalRuntimeConfigGenerationController.name);

  constructor(
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly materializedSpecRepository: AssistantMaterializedSpecRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly publishedVersionRepository: AssistantPublishedVersionRepository,
    private readonly materializeAssistantPublishedVersionService: MaterializeAssistantPublishedVersionService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly syncTelegramChatTargetService: SyncTelegramChatTargetService,
    private readonly prisma: WorkspaceManagementPrismaService
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
    mode: "legacy_openclaw_default" | "global_settings";
    primary: { provider: "openai" | "anthropic"; model: string } | null;
  }> {
    this.assertAuthorized(req);
    const [generation, settings] = await Promise.all([
      this.bumpConfigGenerationService.current(),
      this.resolvePlatformRuntimeProviderSettingsService.execute()
    ]);
    return {
      generation,
      mode: settings.mode,
      primary: settings.primary
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
    const perUserStale =
      assistant.configDirtyAt !== null &&
      (latestSpec === null || assistant.configDirtyAt.getTime() > latestSpec.createdAt.getTime());

    if (!globalStale && !perUserStale) {
      res.status(204);
      return;
    }

    const latestPublished = await this.publishedVersionRepository.findLatestByAssistantId(
      input.assistantId
    );
    if (latestPublished === null) {
      res.status(204);
      return;
    }

    await this.materializeAssistantPublishedVersionService.execute(
      assistant,
      latestPublished,
      latestSpec?.sourceAction ?? "publish"
    );

    const refreshedSpec = await this.materializedSpecRepository.findByPublishedVersionId(
      latestPublished.id
    );
    if (refreshedSpec === null) {
      throw new BadRequestException("Fresh materialized spec was not found.");
    }

    return {
      generation: currentGeneration,
      assistantId: assistant.id,
      publishedVersionId: refreshedSpec.publishedVersionId,
      contentHash: refreshedSpec.contentHash,
      spec: {
        bootstrap: refreshedSpec.openclawBootstrap,
        workspace: refreshedSpec.openclawWorkspace
      }
    };
  }

  @HttpCode(200)
  @Post("telegram/group-update")
  async handleTelegramGroupUpdate(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{ ok: boolean }> {
    this.assertAuthorized(req);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Body must be an object.");
    }
    const row = body as Record<string, unknown>;
    const assistantId = typeof row.assistantId === "string" ? row.assistantId.trim() : "";
    const telegramChatId = typeof row.telegramChatId === "string" ? row.telegramChatId.trim() : "";
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const event = typeof row.event === "string" ? row.event.trim() : "";
    const memberCount =
      typeof row.memberCount === "number" && Number.isInteger(row.memberCount)
        ? row.memberCount
        : null;

    if (!assistantId || !telegramChatId || !event) {
      throw new BadRequestException("assistantId, telegramChatId, and event are required.");
    }

    if (event === "joined") {
      const existingGroup = await this.prisma.assistantTelegramGroup.findUnique({
        where: {
          assistantId_telegramChatId: { assistantId, telegramChatId }
        },
        select: { title: true }
      });
      const dedupeTitles = Array.from(
        new Set(
          [existingGroup?.title?.trim() ?? "", title]
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        )
      );
      if (dedupeTitles.length > 0) {
        await this.prisma.assistantTelegramGroup.updateMany({
          where: {
            assistantId,
            title: { in: dedupeTitles },
            telegramChatId: { not: telegramChatId },
            status: "active"
          },
          data: { status: "left", leftAt: new Date() }
        });
      }
      await this.prisma.assistantTelegramGroup.upsert({
        where: {
          assistantId_telegramChatId: { assistantId, telegramChatId }
        },
        create: {
          assistantId,
          telegramChatId,
          title: title || "Unknown group",
          memberCount,
          status: "active",
          joinedAt: new Date()
        },
        update: {
          ...(title ? { title } : {}),
          ...(memberCount !== null ? { memberCount } : {}),
          status: "active",
          leftAt: null
        }
      });
      this.logger.log(`Telegram group joined: ${telegramChatId} for assistant ${assistantId}`);
    } else if (event === "left") {
      await this.prisma.assistantTelegramGroup.updateMany({
        where: { assistantId, telegramChatId },
        data: { status: "left", leftAt: new Date() }
      });
      this.logger.log(`Telegram group left: ${telegramChatId} for assistant ${assistantId}`);
    }

    return { ok: true };
  }

  @HttpCode(200)
  @Post("telegram/chat-target")
  async handleTelegramChatTarget(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{ ok: boolean }> {
    this.assertAuthorized(req);
    const input = this.syncTelegramChatTargetService.parseInput(body);
    await this.syncTelegramChatTargetService.execute(input);
    return { ok: true };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal endpoints.",
      "Internal authorization failed."
    );
  }
}
