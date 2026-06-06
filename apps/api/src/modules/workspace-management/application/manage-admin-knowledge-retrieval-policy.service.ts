import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import {
  type AdminKnowledgeEmbeddingBackfillImpactSourceState,
  type AdminKnowledgeEmbeddingBackfillSourceType,
  type AdminKnowledgeEmbeddingChangeImpactState,
  type PreviewAdminKnowledgeEmbeddingChangeInput,
  buildAdminKnowledgeRetrievalPolicyState,
  normalizeAdminKnowledgeRetrievalPolicyRecord,
  parsePreviewAdminKnowledgeEmbeddingChangeInput,
  parseUpdateAdminKnowledgeRetrievalPolicyInput,
  toAdminKnowledgeRetrievalPolicyRecord,
  type AdminKnowledgeRetrievalPolicyState,
  type UpdateAdminKnowledgeRetrievalPolicyInput
} from "./admin-knowledge-retrieval-policy";
import { BumpConfigGenerationService } from "./bump-config-generation.service";
import { MaterializationRolloutService } from "./materialization-rollout.service";
import {
  createDefaultPlatformRuntimeRouterPolicy,
  createEmptyAvailableModelCatalogByProvider,
  createEmptyAvailableModelsByProvider,
  PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID
} from "./platform-runtime-provider-settings";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

type BackfillCandidate = {
  id: string;
  workspaceId: string | null;
  currentVersion: number;
  chunkCount: number;
  sizeBytes: number;
};

type SkillDocumentBackfillCandidate = BackfillCandidate & {
  skillId: string;
};

type AssistantKnowledgeBackfillCandidate = BackfillCandidate & {
  assistantId: string;
};

type RawBackfillCandidate = Omit<BackfillCandidate, "sizeBytes"> & {
  sizeBytes: unknown;
};

type RawSkillDocumentBackfillCandidate = RawBackfillCandidate & {
  skillId: string;
};

type RawAssistantKnowledgeBackfillCandidate = RawBackfillCandidate & {
  assistantId: string;
};

type InternalBackfillImpactSourceSummary = AdminKnowledgeEmbeddingBackfillImpactSourceState & {
  candidates: Array<
    BackfillCandidate &
      Partial<{
        skillId: string;
        assistantId: string;
      }>
  >;
};

type InternalEmbeddingChangeImpact = Omit<AdminKnowledgeEmbeddingChangeImpactState, "sources"> & {
  sources: InternalBackfillImpactSourceSummary[];
};

@Injectable()
export class ManageAdminKnowledgeRetrievalPolicyService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly bumpConfigGenerationService: BumpConfigGenerationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    private readonly materializationRolloutService: MaterializationRolloutService
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

  parseEmbeddingChangePreviewInput(body: unknown): PreviewAdminKnowledgeEmbeddingChangeInput {
    try {
      return parsePreviewAdminKnowledgeEmbeddingChangeInput(body);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : "Invalid admin knowledge embedding preview request."
      );
    }
  }

  async getPolicy(userId: string): Promise<AdminKnowledgeRetrievalPolicyState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return this.loadPolicy();
  }

  async previewEmbeddingChange(
    userId: string,
    input: PreviewAdminKnowledgeEmbeddingChangeInput
  ): Promise<AdminKnowledgeEmbeddingChangeImpactState> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    return this.toPublicEmbeddingChangeImpact(
      await this.computeEmbeddingChangeImpact(input.embeddingModelKey)
    );
  }

  async updatePolicy(
    userId: string,
    input: UpdateAdminKnowledgeRetrievalPolicyInput,
    stepUpToken: string | null
  ): Promise<{ policy: AdminKnowledgeRetrievalPolicyState; configGeneration: number }> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const existingPolicy = await this.loadPolicy();
    const embeddingChanged = existingPolicy.embeddingModelKey !== input.embeddingModelKey;
    const internalEmbeddingImpact = embeddingChanged
      ? await this.computeEmbeddingChangeImpact(input.embeddingModelKey)
      : null;
    if (embeddingChanged) {
      await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
        userId,
        "admin.knowledge_retrieval_policy.update",
        stepUpToken
      );
    }
    const policy = this.withEmbeddingChangeImpact(
      buildAdminKnowledgeRetrievalPolicyState(input),
      internalEmbeddingImpact === null
        ? null
        : this.toPublicEmbeddingChangeImpact(internalEmbeddingImpact)
    );
    await this.persistPolicy(policy, userId);
    const backfill = await this.enqueueAdminKnowledgeEmbeddingBackfill(
      policy,
      userId,
      internalEmbeddingImpact
    );
    const configGeneration = await this.bumpConfigGenerationService.execute();
    await this.materializationRolloutService.createAutomaticGlobalRollout({
      actorUserId: userId,
      workspaceId: access.workspaceId,
      rolloutType: "system_prompt_change",
      triggerSource: "prompt_settings",
      scopeType: "affected_policy",
      criticality: "soft",
      targetGeneration: configGeneration,
      scopeMetadata: {
        reason: "admin.knowledge_retrieval_policy.update",
        embeddingModelKey: policy.embeddingModelKey,
        retrievalModelKey: policy.retrievalModelKey,
        authoringModelKey: policy.authoringModelKey
      },
      auditEventCode: "admin.materialization_rollout_created",
      auditSummary: "Admin queued a knowledge retrieval policy materialization rollout."
    });
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
        authoringModelKey: policy.authoringModelKey,
        smartSearchEnabled: policy.smartSearchEnabled,
        smartSearchLongDocSummaryChars: policy.smartSearchLongDocSummaryChars,
        fetchFullModeAbsoluteMaxChars: policy.fetchFullModeAbsoluteMaxChars,
        fetchFullModeAbsoluteMaxChatMessages: policy.fetchFullModeAbsoluteMaxChatMessages,
        embeddingChangeImpact: policy.embeddingChangeImpact,
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

  private withEmbeddingChangeImpact(
    policy: AdminKnowledgeRetrievalPolicyState,
    embeddingChangeImpact: AdminKnowledgeEmbeddingChangeImpactState | null
  ): AdminKnowledgeRetrievalPolicyState {
    return buildAdminKnowledgeRetrievalPolicyState({
      embeddingModelKey: policy.embeddingModelKey,
      retrievalModelKey: policy.retrievalModelKey,
      authoringModelKey: policy.authoringModelKey,
      smartSearchEnabled: policy.smartSearchEnabled,
      smartSearchLongDocSummaryChars: policy.smartSearchLongDocSummaryChars,
      fetchFullModeAbsoluteMaxChars: policy.fetchFullModeAbsoluteMaxChars,
      fetchFullModeAbsoluteMaxChatMessages: policy.fetchFullModeAbsoluteMaxChatMessages,
      embeddingChangeImpact
    });
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
    userId: string,
    impact: InternalEmbeddingChangeImpact | null
  ): Promise<{
    alreadyIndexedSourceCount: number;
    affectedSourceCount: number;
    affectedChunkCount: number;
    affectedBytes: number;
    bySource: Array<{
      sourceType: AdminKnowledgeEmbeddingBackfillSourceType;
      affectedSourceCount: number;
      totalChunks: number;
      totalBytes: number;
    }>;
  }> {
    if (policy.embeddingModelKey === null || impact === null || impact.affectedSourceCount === 0) {
      return {
        alreadyIndexedSourceCount: impact?.alreadyIndexedSourceCount ?? 0,
        affectedSourceCount: 0,
        affectedChunkCount: 0,
        affectedBytes: 0,
        bySource: []
      };
    }

    await this.prisma.$transaction(async (tx) => {
      for (const sourceSummary of impact.sources) {
        const summary = sourceSummary;
        for (const candidate of summary.candidates) {
          const nextVersion = candidate.currentVersion + 1;
          switch (summary.sourceType) {
            case "global_knowledge_source": {
              const updated = await tx.globalKnowledgeSource.updateMany({
                where: {
                  id: candidate.id,
                  status: "ready",
                  currentVersion: candidate.currentVersion
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
                  workspaceId: candidate.workspaceId,
                  requestedByUserId: userId,
                  sourceType: "global_knowledge_source",
                  sourceId: candidate.id,
                  sourceVersion: nextVersion,
                  status: "pending",
                  processorMode: "auto",
                  priority: 90,
                  pendingDedupeKey: `global_knowledge_source:${candidate.id}:${String(nextVersion)}`
                }
              });
              break;
            }
            case "product_knowledge_text_entry": {
              const updated = await tx.productKnowledgeTextEntry.updateMany({
                where: {
                  id: candidate.id,
                  lifecycleStatus: "active",
                  status: "ready",
                  currentVersion: candidate.currentVersion
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
                  workspaceId: null,
                  requestedByUserId: userId,
                  sourceType: "product_knowledge_text_entry",
                  sourceId: candidate.id,
                  sourceVersion: nextVersion,
                  status: "pending",
                  processorMode: "local",
                  priority: 90,
                  pendingDedupeKey: `product_knowledge_text_entry:${candidate.id}:${String(nextVersion)}`
                }
              });
              break;
            }
            case "skill_document": {
              const document = candidate as SkillDocumentBackfillCandidate;
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
              break;
            }
            case "skill_knowledge_card": {
              const card = candidate as SkillDocumentBackfillCandidate;
              const updated = await tx.skillKnowledgeCard.updateMany({
                where: {
                  id: card.id,
                  lifecycleStatus: "active",
                  status: "ready",
                  currentVersion: card.currentVersion
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
                  workspaceId: null,
                  skillId: card.skillId,
                  requestedByUserId: userId,
                  sourceType: "skill_knowledge_card",
                  sourceId: card.id,
                  sourceVersion: nextVersion,
                  status: "pending",
                  processorMode: "local",
                  priority: 90,
                  pendingDedupeKey: `skill_knowledge_card:${card.id}:${String(nextVersion)}`
                }
              });
              break;
            }
            case "assistant_knowledge_source": {
              const source = candidate as AssistantKnowledgeBackfillCandidate;
              const updated = await tx.assistantKnowledgeSource.updateMany({
                where: {
                  id: source.id,
                  assistantId: source.assistantId,
                  namespace: "assistant_user_workspace",
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
                  assistantId: source.assistantId,
                  requestedByUserId: userId,
                  sourceType: "assistant_knowledge_source",
                  sourceId: source.id,
                  sourceVersion: nextVersion,
                  status: "pending",
                  processorMode: "auto",
                  priority: 90,
                  pendingDedupeKey: `assistant_knowledge_source:${source.id}:${String(nextVersion)}`
                }
              });
              break;
            }
          }
        }
      }
    });

    return {
      alreadyIndexedSourceCount: impact.alreadyIndexedSourceCount,
      affectedSourceCount: impact.affectedSourceCount,
      affectedChunkCount: impact.affectedChunkCount,
      affectedBytes: impact.affectedBytes,
      bySource: impact.sources.map((summary) => ({
        sourceType: summary.sourceType,
        affectedSourceCount: summary.affectedSourceCount,
        totalChunks: summary.totalChunks,
        totalBytes: summary.totalBytes
      }))
    };
  }

  private async findProductSourcesMissingVectorIndex(
    embeddingModelKey: string
  ): Promise<InternalBackfillImpactSourceSummary> {
    const candidates = await this.prisma.$queryRaw<RawBackfillCandidate[]>(Prisma.sql`
      SELECT
        "id",
        NULL::uuid AS "workspaceId",
        "current_version" AS "currentVersion",
        "chunk_count" AS "chunkCount",
        "size_bytes"::text AS "sizeBytes"
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
    return this.buildBackfillSummary(
      "global_knowledge_source",
      "Product KB uploaded files",
      this.normalizeBackfillCandidates(candidates)
    );
  }

  private async findSkillDocumentsMissingVectorIndex(
    embeddingModelKey: string
  ): Promise<InternalBackfillImpactSourceSummary> {
    const candidates = await this.prisma.$queryRaw<RawSkillDocumentBackfillCandidate[]>(Prisma.sql`
      SELECT
        "id",
        "workspace_id" AS "workspaceId",
        "skill_id" AS "skillId",
        "current_version" AS "currentVersion",
        "chunk_count" AS "chunkCount",
        "size_bytes"::text AS "sizeBytes"
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
    return this.buildBackfillSummary(
      "skill_document",
      "Skill documents",
      this.normalizeBackfillCandidates(candidates)
    );
  }

  private async findProductTextEntriesMissingVectorIndex(
    embeddingModelKey: string
  ): Promise<InternalBackfillImpactSourceSummary> {
    const candidates = await this.prisma.$queryRaw<RawBackfillCandidate[]>(Prisma.sql`
      SELECT
        "id",
        NULL::uuid AS "workspaceId",
        "current_version" AS "currentVersion",
        "chunk_count" AS "chunkCount",
        length("body")::text AS "sizeBytes"
      FROM "product_knowledge_text_entries" AS entry
      WHERE entry."lifecycle_status" = 'active'
        AND entry."status" = 'ready'
        AND NOT EXISTS (
          SELECT 1
          FROM "knowledge_vector_chunks" AS vector
          WHERE vector."source_type" = 'product_knowledge_text_entry'
            AND vector."source_id" = entry."id"
            AND vector."source_version" = entry."current_version"
            AND vector."embedding_model_key" = ${embeddingModelKey}
        )
      ORDER BY entry."updated_at" ASC, entry."id" ASC
    `);
    return this.buildBackfillSummary(
      "product_knowledge_text_entry",
      "Product KB text entries",
      this.normalizeBackfillCandidates(candidates)
    );
  }

  private async findSkillKnowledgeCardsMissingVectorIndex(
    embeddingModelKey: string
  ): Promise<InternalBackfillImpactSourceSummary> {
    const candidates = await this.prisma.$queryRaw<RawSkillDocumentBackfillCandidate[]>(Prisma.sql`
      SELECT
        "id",
        NULL::uuid AS "workspaceId",
        "skill_id" AS "skillId",
        "current_version" AS "currentVersion",
        "chunk_count" AS "chunkCount",
        length("body")::text AS "sizeBytes"
      FROM "skill_knowledge_cards" AS card
      WHERE card."lifecycle_status" = 'active'
        AND card."status" = 'ready'
        AND NOT EXISTS (
          SELECT 1
          FROM "knowledge_vector_chunks" AS vector
          WHERE vector."source_type" = 'skill_knowledge_card'
            AND vector."source_id" = card."id"
            AND vector."source_version" = card."current_version"
            AND vector."embedding_model_key" = ${embeddingModelKey}
        )
      ORDER BY card."updated_at" ASC, card."id" ASC
    `);
    return this.buildBackfillSummary(
      "skill_knowledge_card",
      "Skill knowledge cards",
      this.normalizeBackfillCandidates(candidates)
    );
  }

  private async findAssistantKnowledgeSourcesMissingVectorIndex(
    embeddingModelKey: string
  ): Promise<InternalBackfillImpactSourceSummary> {
    const candidates = await this.prisma.$queryRaw<
      RawAssistantKnowledgeBackfillCandidate[]
    >(Prisma.sql`
      SELECT
        "id",
        "workspace_id" AS "workspaceId",
        "assistant_id" AS "assistantId",
        "current_version" AS "currentVersion",
        "chunk_count" AS "chunkCount",
        "size_bytes"::text AS "sizeBytes"
      FROM "assistant_knowledge_sources" AS source
      WHERE source."namespace" = 'assistant_user_workspace'
        AND source."status" = 'ready'
        AND NOT EXISTS (
          SELECT 1
          FROM "knowledge_vector_chunks" AS vector
          WHERE vector."source_type" = 'assistant_knowledge_source'
            AND vector."source_id" = source."id"
            AND vector."source_version" = source."current_version"
            AND vector."embedding_model_key" = ${embeddingModelKey}
        )
      ORDER BY source."updated_at" ASC, source."id" ASC
    `);
    return this.buildBackfillSummary(
      "assistant_knowledge_source",
      "Assistant uploaded knowledge",
      this.normalizeBackfillCandidates(candidates)
    );
  }

  private async countAlreadyIndexedSources(embeddingModelKey: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: unknown }>>(Prisma.sql`
      SELECT count(*)::text AS "count"
      FROM (
        SELECT source."id"
        FROM "global_knowledge_sources" AS source
        WHERE source."scope" = 'product'
          AND source."status" = 'ready'
          AND EXISTS (
            SELECT 1
            FROM "knowledge_vector_chunks" AS vector
            WHERE vector."source_type" = 'global_knowledge_source'
              AND vector."source_id" = source."id"
              AND vector."source_version" = source."current_version"
              AND vector."embedding_model_key" = ${embeddingModelKey}
          )
        UNION ALL
        SELECT entry."id"
        FROM "product_knowledge_text_entries" AS entry
        WHERE entry."lifecycle_status" = 'active'
          AND entry."status" = 'ready'
          AND EXISTS (
            SELECT 1
            FROM "knowledge_vector_chunks" AS vector
            WHERE vector."source_type" = 'product_knowledge_text_entry'
              AND vector."source_id" = entry."id"
              AND vector."source_version" = entry."current_version"
              AND vector."embedding_model_key" = ${embeddingModelKey}
          )
        UNION ALL
        SELECT document."id"
        FROM "skill_documents" AS document
        WHERE document."status" = 'ready'
          AND EXISTS (
            SELECT 1
            FROM "knowledge_vector_chunks" AS vector
            WHERE vector."source_type" = 'skill_document'
              AND vector."source_id" = document."id"
              AND vector."source_version" = document."current_version"
              AND vector."embedding_model_key" = ${embeddingModelKey}
          )
        UNION ALL
        SELECT card."id"
        FROM "skill_knowledge_cards" AS card
        WHERE card."lifecycle_status" = 'active'
          AND card."status" = 'ready'
          AND EXISTS (
            SELECT 1
            FROM "knowledge_vector_chunks" AS vector
            WHERE vector."source_type" = 'skill_knowledge_card'
              AND vector."source_id" = card."id"
              AND vector."source_version" = card."current_version"
              AND vector."embedding_model_key" = ${embeddingModelKey}
          )
        UNION ALL
        SELECT source."id"
        FROM "assistant_knowledge_sources" AS source
        WHERE source."namespace" = 'assistant_user_workspace'
          AND source."status" = 'ready'
          AND EXISTS (
            SELECT 1
            FROM "knowledge_vector_chunks" AS vector
            WHERE vector."source_type" = 'assistant_knowledge_source'
              AND vector."source_id" = source."id"
              AND vector."source_version" = source."current_version"
              AND vector."embedding_model_key" = ${embeddingModelKey}
          )
      ) indexed_sources
    `);
    return this.toSafeNonNegativeInteger(rows[0]?.count ?? 0);
  }

  private async computeEmbeddingChangeImpact(
    nextEmbeddingModelKey: string | null
  ): Promise<InternalEmbeddingChangeImpact> {
    const currentPolicy = await this.loadPolicy();
    const currentEmbeddingModelKey = currentPolicy.embeddingModelKey;
    if (currentEmbeddingModelKey === nextEmbeddingModelKey) {
      return {
        fromEmbeddingModelKey: currentEmbeddingModelKey,
        toEmbeddingModelKey: nextEmbeddingModelKey,
        requiresDangerousConfirmation: false,
        vectorSearchWillBeDisabled: nextEmbeddingModelKey === null,
        alreadyIndexedSourceCount: 0,
        affectedSourceCount: 0,
        affectedChunkCount: 0,
        affectedBytes: 0,
        sources: []
      };
    }
    if (nextEmbeddingModelKey === null) {
      return {
        fromEmbeddingModelKey: currentEmbeddingModelKey,
        toEmbeddingModelKey: null,
        requiresDangerousConfirmation: true,
        vectorSearchWillBeDisabled: true,
        alreadyIndexedSourceCount: 0,
        affectedSourceCount: 0,
        affectedChunkCount: 0,
        affectedBytes: 0,
        sources: []
      };
    }

    const [sources, alreadyIndexedSourceCount] = await Promise.all([
      Promise.all([
        this.findProductSourcesMissingVectorIndex(nextEmbeddingModelKey),
        this.findProductTextEntriesMissingVectorIndex(nextEmbeddingModelKey),
        this.findSkillDocumentsMissingVectorIndex(nextEmbeddingModelKey),
        this.findSkillKnowledgeCardsMissingVectorIndex(nextEmbeddingModelKey),
        this.findAssistantKnowledgeSourcesMissingVectorIndex(nextEmbeddingModelKey)
      ]),
      this.countAlreadyIndexedSources(nextEmbeddingModelKey)
    ]);
    const affectedSources = sources.filter((summary) => summary.affectedSourceCount > 0);

    return {
      fromEmbeddingModelKey: currentEmbeddingModelKey,
      toEmbeddingModelKey: nextEmbeddingModelKey,
      requiresDangerousConfirmation: true,
      vectorSearchWillBeDisabled: false,
      alreadyIndexedSourceCount,
      affectedSourceCount: affectedSources.reduce(
        (sum, summary) => sum + summary.affectedSourceCount,
        0
      ),
      affectedChunkCount: affectedSources.reduce((sum, summary) => sum + summary.totalChunks, 0),
      affectedBytes: affectedSources.reduce((sum, summary) => sum + summary.totalBytes, 0),
      sources: affectedSources
    };
  }

  private toPublicEmbeddingChangeImpact(
    impact: InternalEmbeddingChangeImpact
  ): AdminKnowledgeEmbeddingChangeImpactState {
    return {
      fromEmbeddingModelKey: impact.fromEmbeddingModelKey,
      toEmbeddingModelKey: impact.toEmbeddingModelKey,
      requiresDangerousConfirmation: impact.requiresDangerousConfirmation,
      vectorSearchWillBeDisabled: impact.vectorSearchWillBeDisabled,
      alreadyIndexedSourceCount: impact.alreadyIndexedSourceCount,
      affectedSourceCount: impact.affectedSourceCount,
      affectedChunkCount: impact.affectedChunkCount,
      affectedBytes: impact.affectedBytes,
      sources: impact.sources.map((source) => ({
        sourceType: source.sourceType,
        label: source.label,
        affectedSourceCount: source.affectedSourceCount,
        totalChunks: source.totalChunks,
        totalBytes: source.totalBytes
      }))
    };
  }

  private normalizeBackfillCandidates<
    T extends RawBackfillCandidate &
      Partial<{
        skillId: string;
        assistantId: string;
      }>
  >(
    candidates: T[]
  ): Array<
    BackfillCandidate &
      Partial<{
        skillId: string;
        assistantId: string;
      }>
  > {
    return candidates.map((candidate) => ({
      ...candidate,
      sizeBytes: this.toSafeNonNegativeInteger(candidate.sizeBytes)
    }));
  }

  private toSafeNonNegativeInteger(value: unknown): number {
    const asBigInt =
      typeof value === "bigint"
        ? value
        : typeof value === "number" && Number.isFinite(value)
          ? BigInt(Math.max(0, Math.trunc(value)))
          : typeof value === "string" && /^\d+$/.test(value)
            ? BigInt(value)
            : 0n;
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    return Number(asBigInt > maxSafe ? maxSafe : asBigInt);
  }

  private buildBackfillSummary(
    sourceType: AdminKnowledgeEmbeddingBackfillSourceType,
    label: string,
    candidates: Array<
      BackfillCandidate &
        Partial<{
          skillId: string;
          assistantId: string;
        }>
    >
  ): InternalBackfillImpactSourceSummary {
    return {
      sourceType,
      label,
      affectedSourceCount: candidates.length,
      totalChunks: candidates.reduce((sum, candidate) => sum + candidate.chunkCount, 0),
      totalBytes: candidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0),
      candidates
    };
  }
}
