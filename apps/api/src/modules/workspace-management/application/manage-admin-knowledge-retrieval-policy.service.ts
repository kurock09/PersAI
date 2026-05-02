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

type AdminKbBackfillCandidate = {
  id: string;
  workspaceId: string;
  currentVersion: number;
};

type SkillDocumentBackfillCandidate = AdminKbBackfillCandidate & {
  skillId: string;
};

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
    const backfill = await this.enqueueAdminKnowledgeEmbeddingBackfill(policy, userId);
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
        retrievalModelKey: policy.retrievalModelKey,
        embeddingBackfill: backfill
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

  private async enqueueAdminKnowledgeEmbeddingBackfill(
    policy: AdminKnowledgeRetrievalPolicyState,
    userId: string
  ): Promise<{ productSourceCount: number; skillDocumentCount: number }> {
    const embeddingModelKey = policy.embeddingModelKey;
    if (embeddingModelKey === null) {
      return { productSourceCount: 0, skillDocumentCount: 0 };
    }

    const [productSources, skillDocuments] = await Promise.all([
      this.findProductSourcesMissingVectorIndex(embeddingModelKey),
      this.findSkillDocumentsMissingVectorIndex(embeddingModelKey)
    ]);

    let productSourceCount = 0;
    let skillDocumentCount = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const source of productSources) {
        const nextVersion = source.currentVersion + 1;
        const updated = await tx.globalKnowledgeSource.updateMany({
          where: {
            id: source.id,
            status: "ready",
            currentVersion: source.currentVersion
          },
          data: {
            status: "processing",
            currentVersion: nextVersion,
            lastReindexRequestedAt: new Date(),
            lastErrorCode: null,
            lastErrorMessage: null
          }
        });
        if (updated.count === 0) {
          continue;
        }
        await tx.knowledgeIndexingJob.create({
          data: {
            workspaceId: source.workspaceId,
            requestedByUserId: userId,
            sourceType: "global_knowledge_source",
            sourceId: source.id,
            sourceVersion: nextVersion,
            status: "pending",
            processorMode: "auto",
            priority: 90,
            pendingDedupeKey: `global_knowledge_source:${source.id}:${String(nextVersion)}`
          }
        });
        productSourceCount += 1;
      }

      for (const document of skillDocuments) {
        const nextVersion = document.currentVersion + 1;
        const updated = await tx.skillDocument.updateMany({
          where: {
            id: document.id,
            status: "ready",
            currentVersion: document.currentVersion
          },
          data: {
            status: "processing",
            currentVersion: nextVersion,
            lastReindexRequestedAt: new Date(),
            lastErrorCode: null,
            lastErrorMessage: null
          }
        });
        if (updated.count === 0) {
          continue;
        }
        await tx.knowledgeIndexingJob.create({
          data: {
            workspaceId: document.workspaceId,
            skillId: document.skillId,
            requestedByUserId: userId,
            sourceType: "skill_document",
            sourceId: document.id,
            sourceVersion: nextVersion,
            status: "pending",
            processorMode: "auto",
            priority: 90,
            pendingDedupeKey: `skill_document:${document.id}:${String(nextVersion)}`
          }
        });
        skillDocumentCount += 1;
      }
    });

    return { productSourceCount, skillDocumentCount };
  }

  private async findProductSourcesMissingVectorIndex(
    embeddingModelKey: string
  ): Promise<AdminKbBackfillCandidate[]> {
    return this.prisma.$queryRaw<AdminKbBackfillCandidate[]>(Prisma.sql`
      SELECT
        "id",
        "workspace_id" AS "workspaceId",
        "current_version" AS "currentVersion"
      FROM "global_knowledge_sources" AS source
      WHERE source."scope" = 'product'
        AND source."status" = 'ready'
        AND NOT EXISTS (
          SELECT 1
          FROM "knowledge_vector_chunks" AS vector
          WHERE vector."source_type" = 'global_knowledge_source'
            AND vector."source_id" = source."id"
            AND vector."source_version" = source."current_version"
            AND vector."embedding_model_key" = ${embeddingModelKey}
        )
      ORDER BY source."updated_at" ASC, source."id" ASC
    `);
  }

  private async findSkillDocumentsMissingVectorIndex(
    embeddingModelKey: string
  ): Promise<SkillDocumentBackfillCandidate[]> {
    return this.prisma.$queryRaw<SkillDocumentBackfillCandidate[]>(Prisma.sql`
      SELECT
        "id",
        "workspace_id" AS "workspaceId",
        "skill_id" AS "skillId",
        "current_version" AS "currentVersion"
      FROM "skill_documents" AS document
      WHERE document."status" = 'ready'
        AND NOT EXISTS (
          SELECT 1
          FROM "knowledge_vector_chunks" AS vector
          WHERE vector."source_type" = 'skill_document'
            AND vector."source_id" = document."id"
            AND vector."source_version" = document."current_version"
            AND vector."embedding_model_key" = ${embeddingModelKey}
        )
      ORDER BY document."updated_at" ASC, document."id" ASC
    `);
  }
}
