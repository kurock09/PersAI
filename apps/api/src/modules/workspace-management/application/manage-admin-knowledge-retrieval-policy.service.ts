import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import {
  buildAdminKnowledgeRetrievalPolicyState,
  normalizeAdminKnowledgeRetrievalPolicyRecord,
  parseUpdateAdminKnowledgeRetrievalPolicyInput,
  toAdminKnowledgeRetrievalPolicyRecord,
  type AdminKnowledgeRetrievalPolicyState,
  type UpdateAdminKnowledgeRetrievalPolicyInput
} from "./admin-knowledge-retrieval-policy";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import {
  createDefaultPlatformRuntimeRouterPolicy,
  createEmptyAvailableModelCatalogByProvider,
  createEmptyAvailableModelsByProvider,
  PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID
} from "./platform-runtime-provider-settings";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

@Injectable()
export class ManageAdminKnowledgeRetrievalPolicyService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseUpdateInput(body: unknown): UpdateAdminKnowledgeRetrievalPolicyInput {
    try {
      return parseUpdateAdminKnowledgeRetrievalPolicyInput(body);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Invalid admin knowledge retrieval policy request."
      );
    }
  }

  async getPolicy(userId: string): Promise<AdminKnowledgeRetrievalPolicyState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return await this.loadPolicy();
  }

  async updatePolicy(
    userId: string,
    input: UpdateAdminKnowledgeRetrievalPolicyInput
  ): Promise<{ policy: AdminKnowledgeRetrievalPolicyState; configGeneration: number }> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const policy = buildAdminKnowledgeRetrievalPolicyState(input);
    await this.persistPolicy(policy, userId);
    const configGeneration = await this.bumpConfigGenerationService.execute();
    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.knowledge_retrieval_policy_updated",
      summary: "Admin knowledge retrieval policy updated.",
      details: {
        embeddingModelKey: policy.embeddingModelKey,
        retrievalModelKey: policy.retrievalModelKey
      }
    });
    return { policy, configGeneration };
  }

  async loadPolicy(): Promise<AdminKnowledgeRetrievalPolicyState> {
    const row = await this.prisma.platformRuntimeProviderSettings.findUnique({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      select: { adminKnowledgeRetrievalPolicy: true }
    });
    return normalizeAdminKnowledgeRetrievalPolicyRecord(row?.adminKnowledgeRetrievalPolicy ?? null);
  }

  private async persistPolicy(
    policy: AdminKnowledgeRetrievalPolicyState,
    userId: string
  ): Promise<void> {
    const adminKnowledgeRetrievalPolicy = toAdminKnowledgeRetrievalPolicyRecord(
      policy
    ) as Prisma.InputJsonValue;
    await this.prisma.platformRuntimeProviderSettings.upsert({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      create: {
        id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID,
        primaryProvider: "openai",
        primaryModel: "gpt-4o-mini",
        fallbackProvider: null,
        fallbackModel: null,
        routingFastModelKey: null,
        routerPolicy: createDefaultPlatformRuntimeRouterPolicy() as Prisma.InputJsonValue,
        availableModelsByProvider: createEmptyAvailableModelsByProvider() as Prisma.InputJsonValue,
        availableModelCatalogByProvider:
          createEmptyAvailableModelCatalogByProvider() as Prisma.InputJsonValue,
        documentProcessingPolicy: {} as Prisma.InputJsonValue,
        adminKnowledgeRetrievalPolicy,
        updatedByUserId: userId
      },
      update: {
        adminKnowledgeRetrievalPolicy,
        updatedByUserId: userId
      }
    });
  }
}
