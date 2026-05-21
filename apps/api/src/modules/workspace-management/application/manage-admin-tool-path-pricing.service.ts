import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import {
  PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID,
  createDefaultPlatformRuntimeRouterPolicy,
  createEmptyAvailableModelCatalogByProvider,
  createEmptyAvailableModelsByProvider
} from "./platform-runtime-provider-settings";
import {
  buildAdminToolPathPricingCatalogState,
  normalizeToolPathPricingCatalogRecord,
  parseAdminToolPathPricingCatalogRequest,
  type AdminToolPathPricingCatalogRequest,
  type AdminToolPathPricingCatalogState
} from "./tool-path-pricing-catalog";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

@Injectable()
export class ManageAdminToolPathPricingService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseUpdateInput(body: unknown): AdminToolPathPricingCatalogRequest {
    try {
      return parseAdminToolPathPricingCatalogRequest(body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid tool-path pricing catalog request.";
      throw new BadRequestException(message);
    }
  }

  async getCatalog(userId: string): Promise<AdminToolPathPricingCatalogState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return this.resolveCatalogState();
  }

  async updateCatalog(
    userId: string,
    input: AdminToolPathPricingCatalogRequest,
    stepUpToken: string | null
  ): Promise<{
    catalog: AdminToolPathPricingCatalogState;
    configGeneration: number;
  }> {
    const access = await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.tool_path_pricing.update",
      stepUpToken
    );

    const catalog = normalizeToolPathPricingCatalogRecord({
      schema: "persai.toolPathPricingCatalog.v1",
      rows: input.rows
    });
    const catalogJson = catalog as unknown as Prisma.InputJsonValue;

    await this.prisma.platformRuntimeProviderSettings.upsert({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      create: {
        id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID,
        primaryProvider: "openai",
        primaryModel: "gpt-5-mini",
        routerPolicy: createDefaultPlatformRuntimeRouterPolicy() as Prisma.InputJsonValue,
        availableModelsByProvider: createEmptyAvailableModelsByProvider() as Prisma.InputJsonValue,
        availableModelCatalogByProvider:
          createEmptyAvailableModelCatalogByProvider() as Prisma.InputJsonValue,
        toolPathPricingCatalog: catalogJson,
        updatedByUserId: access.userId
      },
      update: {
        toolPathPricingCatalog: catalogJson,
        updatedByUserId: access.userId
      }
    });

    const configGeneration = await this.bumpConfigGenerationService.execute();
    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: access.userId,
      eventCategory: "admin_action",
      eventCode: "admin.tool_path_pricing_updated",
      summary: "Tool-path economics catalog updated.",
      details: {
        rowCount: catalog.rows.length,
        configGeneration
      }
    });

    return {
      catalog: buildAdminToolPathPricingCatalogState(catalog),
      configGeneration
    };
  }

  private async resolveCatalogState(): Promise<AdminToolPathPricingCatalogState> {
    const row = await this.prisma.platformRuntimeProviderSettings.findUnique({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      select: { toolPathPricingCatalog: true }
    });
    const catalog = normalizeToolPathPricingCatalogRecord(row?.toolPathPricingCatalog ?? null);
    return buildAdminToolPathPricingCatalogState(catalog);
  }
}
