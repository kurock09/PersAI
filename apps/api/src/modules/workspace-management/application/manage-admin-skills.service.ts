import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { createInactiveSkillDecisionState } from "./auto-skill-routing-state.service";
import { validatePersaiMediaFile } from "./media/media-security-policy";
import { PersaiKnowledgeObjectStorageService } from "./persai-knowledge-object-storage.service";
import {
  parseAdminSkillUpsertInput,
  parseSkillDocumentUploadInput,
  toAdminSkillState,
  toKnowledgeIndexingJobState,
  toSkillDocumentState,
  type AdminSkillState,
  type AdminSkillUpsertInput,
  type KnowledgeIndexingJobState,
  type SkillDocumentState,
  type SkillDocumentUploadInput
} from "./skill-management.types";
import {
  parseSkillKnowledgeCardInput,
  toSkillKnowledgeCardState,
  type SkillKnowledgeCardInput,
  type SkillKnowledgeCardState
} from "./authored-knowledge.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const SKILL_DOCUMENT_MIMES = new Set([
  "application/json",
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

@Injectable()
export class ManageAdminSkillsService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly knowledgeObjectStorage: PersaiKnowledgeObjectStorageService
  ) {}

  parseUpsertInput(body: unknown): AdminSkillUpsertInput {
    try {
      return parseAdminSkillUpsertInput(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Skill request.";
      throw new BadRequestException(message);
    }
  }

  parseDocumentUploadInput(body: unknown): SkillDocumentUploadInput {
    try {
      return parseSkillDocumentUploadInput(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Skill document request.";
      throw new BadRequestException(message);
    }
  }

  parseKnowledgeCardInput(body: unknown): SkillKnowledgeCardInput {
    try {
      return parseSkillKnowledgeCardInput(body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid Skill knowledge card request.";
      throw new BadRequestException(message);
    }
  }

  async list(userId: string): Promise<AdminSkillState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const rows = await this.prisma.skill.findMany({
      include: {
        documents: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        knowledgeCards: {
          where: { lifecycleStatus: { not: "archived" } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }]
        }
      },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }]
    });
    return rows.map(toAdminSkillState);
  }

  async get(userId: string, skillId: string): Promise<AdminSkillState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const skill = await this.prisma.skill.findFirst({
      where: { id: skillId },
      include: {
        documents: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        knowledgeCards: {
          where: { lifecycleStatus: { not: "archived" } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }]
        }
      }
    });
    if (skill === null) {
      throw new NotFoundException("Skill not found.");
    }
    return toAdminSkillState(skill);
  }

  async create(userId: string, input: AdminSkillUpsertInput): Promise<AdminSkillState> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const status = input.status ?? "draft";
    const skill = await this.prisma.skill.create({
      data: {
        createdByUserId: access.userId,
        updatedByUserId: access.userId,
        status,
        name: input.name as Prisma.InputJsonValue,
        description: input.description as Prisma.InputJsonValue,
        category: input.category,
        tags: input.tags as Prisma.InputJsonValue,
        instructionCard: input.instructionCard as Prisma.InputJsonValue,
        iconEmoji: input.iconEmoji,
        color: input.color,
        displayOrder: input.displayOrder ?? 100,
        archivedAt: status === "archived" ? new Date() : null
      },
      include: { documents: true, knowledgeCards: true }
    });
    return toAdminSkillState(skill);
  }

  async update(
    userId: string,
    skillId: string,
    input: AdminSkillUpsertInput
  ): Promise<AdminSkillState> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const existing = await this.prisma.skill.findFirst({
      where: { id: skillId }
    });
    if (existing === null) {
      throw new NotFoundException("Skill not found.");
    }
    const nextStatus = input.status ?? existing.status;
    const skill = await this.prisma.skill.update({
      where: { id: existing.id },
      data: {
        updatedByUserId: access.userId,
        status: nextStatus,
        name: input.name as Prisma.InputJsonValue,
        description: input.description as Prisma.InputJsonValue,
        category: input.category,
        tags: input.tags as Prisma.InputJsonValue,
        instructionCard: input.instructionCard as Prisma.InputJsonValue,
        iconEmoji: input.iconEmoji,
        color: input.color,
        displayOrder: input.displayOrder ?? existing.displayOrder,
        archivedAt:
          nextStatus === "archived"
            ? (existing.archivedAt ?? new Date())
            : nextStatus === "active" || nextStatus === "draft"
              ? null
              : existing.archivedAt
      },
      include: {
        documents: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
        knowledgeCards: {
          where: { lifecycleStatus: { not: "archived" } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }]
        }
      }
    });
    if (nextStatus === "archived") {
      await this.disableAssignmentsForArchivedSkill(existing.id);
    }
    await this.markAssignedAssistantsDirty(existing.id);
    await this.resetAssignedChatState(existing.id, "routing_and_retrieval");
    return toAdminSkillState(skill);
  }

  async archive(userId: string, skillId: string): Promise<void> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const existing = await this.prisma.skill.findFirst({
      where: { id: skillId }
    });
    if (existing === null) {
      throw new NotFoundException("Skill not found.");
    }
    await this.prisma.skill.update({
      where: { id: existing.id },
      data: {
        status: "archived",
        archivedAt: existing.archivedAt ?? new Date(),
        updatedByUserId: access.userId
      }
    });
    await this.disableAssignmentsForArchivedSkill(existing.id);
    await this.markAssignedAssistantsDirty(existing.id);
    await this.resetAssignedChatState(existing.id, "routing_and_retrieval");
  }

  async uploadDocument(params: {
    userId: string;
    skillId: string;
    input: SkillDocumentUploadInput;
    file: { buffer: Buffer; mimetype: string; originalname: string };
  }): Promise<{ document: SkillDocumentState; indexingJob: KnowledgeIndexingJobState }> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(
      params.userId
    );
    const skill = await this.prisma.skill.findFirst({
      where: { id: params.skillId }
    });
    if (skill === null) {
      throw new NotFoundException("Skill not found.");
    }
    const validated = await validatePersaiMediaFile({
      buffer: params.file.buffer,
      mimeType: params.file.mimetype,
      originalFilename: params.file.originalname,
      surface: "knowledge_upload"
    });
    if (!this.isSkillDocumentMime(validated.effectiveMimeType)) {
      throw new BadRequestException("Only document-like files can be added to Skills.");
    }
    const objectKey = this.knowledgeObjectStorage.buildSkillDocumentObjectKey({
      skillId: skill.id,
      extension: validated.normalizedExtension,
      originalFilename: validated.originalFilename
    });
    const stored = await this.knowledgeObjectStorage.saveObject({
      objectKey,
      buffer: params.file.buffer,
      mimeType: validated.effectiveMimeType
    });

    let documentId: string | null = null;
    let createdDocument: SkillDocumentState | null = null;
    let createdIndexingJob: KnowledgeIndexingJobState | null = null;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const document = await tx.skillDocument.create({
          data: {
            skillId: skill.id,
            createdByUserId: access.userId,
            displayName: params.input.displayName,
            description: params.input.description,
            originalFilename: validated.originalFilename ?? params.file.originalname,
            mimeType: validated.effectiveMimeType,
            sizeBytes: BigInt(stored.sizeBytes),
            storagePath: stored.objectKey,
            status: "processing",
            currentVersion: 1
          }
        });
        documentId = document.id;
        const indexingJob = await tx.knowledgeIndexingJob.create({
          data: {
            workspaceId: null,
            skillId: skill.id,
            requestedByUserId: access.userId,
            sourceType: "skill_document",
            sourceId: document.id,
            sourceVersion: 1,
            status: "pending",
            processorMode: "auto",
            pendingDedupeKey: `skill_document:${document.id}:1`
          }
        });
        return { document, indexingJob };
      });
      createdDocument = toSkillDocumentState(result.document);
      createdIndexingJob = toKnowledgeIndexingJobState(result.indexingJob);
    } catch (error) {
      if (documentId !== null) {
        await this.prisma.knowledgeIndexingJob
          .deleteMany({ where: { sourceType: "skill_document", sourceId: documentId } })
          .catch(() => undefined);
        await this.prisma.skillDocument
          .delete({ where: { id: documentId } })
          .catch(() => undefined);
      }
      await this.knowledgeObjectStorage.deleteObject(stored.objectKey).catch(() => undefined);
      throw error;
    }
    await this.resetAssignedChatState(skill.id, "retrieval_only");
    return {
      document: createdDocument as SkillDocumentState,
      indexingJob: createdIndexingJob as KnowledgeIndexingJobState
    };
  }

  async deleteDocument(userId: string, skillId: string, documentId: string): Promise<void> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const document = await this.prisma.skillDocument.findFirst({
      where: {
        id: documentId,
        skillId
      }
    });
    if (document === null) {
      throw new NotFoundException("Skill document not found.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeVectorChunk.deleteMany({
        where: { sourceType: "skill_document", sourceId: document.id }
      });
      await tx.knowledgeIndexingJob.deleteMany({
        where: { sourceType: "skill_document", sourceId: document.id }
      });
      await tx.skillDocument.delete({ where: { id: document.id } });
    });
    await this.knowledgeObjectStorage.deleteObject(document.storagePath);
    await this.resetAssignedChatState(skillId, "retrieval_only");
  }

  async reindexDocument(
    userId: string,
    skillId: string,
    documentId: string
  ): Promise<{ document: SkillDocumentState; indexingJob: KnowledgeIndexingJobState }> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const document = await this.prisma.skillDocument.findFirst({
      where: {
        id: documentId,
        skillId
      }
    });
    if (document === null) {
      throw new NotFoundException("Skill document not found.");
    }
    const nextVersion = document.currentVersion + 1;
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedDocument = await tx.skillDocument.update({
        where: { id: document.id },
        data: {
          status: "processing",
          currentVersion: nextVersion,
          lastReindexRequestedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
      const indexingJob = await tx.knowledgeIndexingJob.create({
        data: {
          workspaceId: null,
          skillId,
          requestedByUserId: access.userId,
          sourceType: "skill_document",
          sourceId: document.id,
          sourceVersion: nextVersion,
          status: "pending",
          processorMode: "auto",
          pendingDedupeKey: `skill_document:${document.id}:${String(nextVersion)}`
        }
      });
      return { document: updatedDocument, indexingJob };
    });
    await this.resetAssignedChatState(skillId, "retrieval_only");
    return {
      document: toSkillDocumentState(result.document),
      indexingJob: toKnowledgeIndexingJobState(result.indexingJob)
    };
  }

  async createKnowledgeCard(
    userId: string,
    skillId: string,
    input: SkillKnowledgeCardInput
  ): Promise<{ card: SkillKnowledgeCardState; indexingJob: KnowledgeIndexingJobState | null }> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const skill = await this.requireSkill(skillId);
    const lifecycleStatus = input.lifecycleStatus ?? "draft";
    const result = await this.prisma.$transaction(async (tx) => {
      const card = await tx.skillKnowledgeCard.create({
        data: {
          skillId: skill.id,
          createdByUserId: access.userId,
          updatedByUserId: access.userId,
          title: input.title,
          body: input.body,
          locale: input.locale,
          tags: input.tags as Prisma.InputJsonValue,
          lifecycleStatus,
          status: lifecycleStatus === "active" ? "processing" : "ready",
          provenanceKind: input.provenanceKind,
          provenanceMetadata:
            input.provenanceMetadata === null
              ? Prisma.JsonNull
              : (input.provenanceMetadata as Prisma.InputJsonValue),
          currentVersion: 1,
          archivedAt: lifecycleStatus === "archived" ? new Date() : null
        }
      });
      const indexingJob =
        lifecycleStatus === "active"
          ? await tx.knowledgeIndexingJob.create({
              data: {
                workspaceId: null,
                skillId: skill.id,
                requestedByUserId: access.userId,
                sourceType: "skill_knowledge_card",
                sourceId: card.id,
                sourceVersion: 1,
                status: "pending",
                processorMode: "local",
                pendingDedupeKey: `skill_knowledge_card:${card.id}:1`
              }
            })
          : null;
      return { card, indexingJob };
    });
    await this.resetAssignedChatState(skill.id, "retrieval_only");
    return {
      card: toSkillKnowledgeCardState(result.card),
      indexingJob:
        result.indexingJob === null ? null : toKnowledgeIndexingJobState(result.indexingJob)
    };
  }

  async updateKnowledgeCard(
    userId: string,
    skillId: string,
    cardId: string,
    input: SkillKnowledgeCardInput
  ): Promise<{ card: SkillKnowledgeCardState; indexingJob: KnowledgeIndexingJobState | null }> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    await this.requireSkill(skillId);
    const existing = await this.prisma.skillKnowledgeCard.findFirst({
      where: { id: cardId, skillId }
    });
    if (existing === null) {
      throw new NotFoundException("Skill knowledge card not found.");
    }
    const lifecycleStatus = input.lifecycleStatus ?? existing.lifecycleStatus;
    const shouldIndex = lifecycleStatus === "active";
    const nextVersion = shouldIndex ? existing.currentVersion + 1 : existing.currentVersion;
    const result = await this.prisma.$transaction(async (tx) => {
      if (!shouldIndex) {
        await this.clearKnowledgeCardRuntimeIndex(tx, existing.id);
      }
      const card = await tx.skillKnowledgeCard.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          body: input.body,
          locale: input.locale,
          tags: input.tags as Prisma.InputJsonValue,
          lifecycleStatus,
          provenanceKind: input.provenanceKind,
          provenanceMetadata:
            input.provenanceMetadata === null
              ? Prisma.JsonNull
              : (input.provenanceMetadata as Prisma.InputJsonValue),
          status: shouldIndex ? "processing" : "ready",
          currentVersion: nextVersion,
          updatedByUserId: access.userId,
          lastReindexRequestedAt: shouldIndex ? new Date() : existing.lastReindexRequestedAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          archivedAt:
            lifecycleStatus === "archived"
              ? (existing.archivedAt ?? new Date())
              : lifecycleStatus === "draft" || lifecycleStatus === "active"
                ? null
                : existing.archivedAt
        }
      });
      const indexingJob = shouldIndex
        ? await tx.knowledgeIndexingJob.create({
            data: {
              workspaceId: null,
              skillId,
              requestedByUserId: access.userId,
              sourceType: "skill_knowledge_card",
              sourceId: existing.id,
              sourceVersion: nextVersion,
              status: "pending",
              processorMode: "local",
              pendingDedupeKey: `skill_knowledge_card:${existing.id}:${String(nextVersion)}`
            }
          })
        : null;
      return { card, indexingJob };
    });
    await this.resetAssignedChatState(skillId, "routing_and_retrieval");
    return {
      card: toSkillKnowledgeCardState(result.card),
      indexingJob:
        result.indexingJob === null ? null : toKnowledgeIndexingJobState(result.indexingJob)
    };
  }

  async archiveKnowledgeCard(userId: string, skillId: string, cardId: string): Promise<void> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    await this.requireSkill(skillId);
    const existing = await this.prisma.skillKnowledgeCard.findFirst({
      where: { id: cardId, skillId }
    });
    if (existing === null) {
      throw new NotFoundException("Skill knowledge card not found.");
    }
    await this.prisma.$transaction(async (tx) => {
      await this.clearKnowledgeCardRuntimeIndex(tx, existing.id);
      await tx.skillKnowledgeCard.update({
        where: { id: existing.id },
        data: {
          lifecycleStatus: "archived",
          status: "ready",
          archivedAt: existing.archivedAt ?? new Date(),
          updatedByUserId: access.userId
        }
      });
    });
    await this.resetAssignedChatState(skillId, "routing_and_retrieval");
  }

  async reindexKnowledgeCard(
    userId: string,
    skillId: string,
    cardId: string
  ): Promise<{ card: SkillKnowledgeCardState; indexingJob: KnowledgeIndexingJobState }> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    await this.requireSkill(skillId);
    const existing = await this.prisma.skillKnowledgeCard.findFirst({
      where: { id: cardId, skillId }
    });
    if (existing === null) {
      throw new NotFoundException("Skill knowledge card not found.");
    }
    if (existing.lifecycleStatus !== "active") {
      throw new ConflictException("Only active Skill knowledge cards can be reindexed.");
    }
    const nextVersion = existing.currentVersion + 1;
    const result = await this.prisma.$transaction(async (tx) => {
      const card = await tx.skillKnowledgeCard.update({
        where: { id: existing.id },
        data: {
          status: "processing",
          currentVersion: nextVersion,
          lastReindexRequestedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
      const indexingJob = await tx.knowledgeIndexingJob.create({
        data: {
          workspaceId: null,
          skillId,
          requestedByUserId: access.userId,
          sourceType: "skill_knowledge_card",
          sourceId: existing.id,
          sourceVersion: nextVersion,
          status: "pending",
          processorMode: "local",
          pendingDedupeKey: `skill_knowledge_card:${existing.id}:${String(nextVersion)}`
        }
      });
      return { card, indexingJob };
    });
    await this.resetAssignedChatState(skillId, "retrieval_only");
    return {
      card: toSkillKnowledgeCardState(result.card),
      indexingJob: toKnowledgeIndexingJobState(result.indexingJob)
    };
  }

  private async disableAssignmentsForArchivedSkill(skillId: string): Promise<void> {
    await this.prisma.assistantSkillAssignment.updateMany({
      where: { skillId, status: "active" },
      data: {
        status: "archived",
        disabledReason: "skill_archived",
        disabledAt: new Date()
      }
    });
  }

  private async requireSkill(skillId: string) {
    const skill = await this.prisma.skill.findFirst({
      where: { id: skillId }
    });
    if (skill === null) {
      throw new NotFoundException("Skill not found.");
    }
    return skill;
  }

  private async clearKnowledgeCardRuntimeIndex(
    tx: {
      skillKnowledgeCardChunk: {
        deleteMany: (args: { where: { skillKnowledgeCardId: string } }) => Promise<unknown>;
      };
      knowledgeVectorChunk: {
        deleteMany: (args: {
          where: { sourceType: "skill_knowledge_card"; sourceId: string };
        }) => Promise<unknown>;
      };
      knowledgeIndexingJob: {
        deleteMany: (args: {
          where: { sourceType: "skill_knowledge_card"; sourceId: string; status?: "pending" };
        }) => Promise<unknown>;
      };
    },
    cardId: string
  ): Promise<void> {
    await tx.skillKnowledgeCardChunk.deleteMany({
      where: { skillKnowledgeCardId: cardId }
    });
    await tx.knowledgeVectorChunk.deleteMany({
      where: { sourceType: "skill_knowledge_card", sourceId: cardId }
    });
    await tx.knowledgeIndexingJob.deleteMany({
      where: { sourceType: "skill_knowledge_card", sourceId: cardId, status: "pending" }
    });
  }

  private async markAssignedAssistantsDirty(skillId: string): Promise<void> {
    await this.prisma.assistant.updateMany({
      where: {
        skillAssignments: {
          some: { skillId }
        }
      },
      data: { configDirtyAt: new Date() }
    });
  }

  private async resetAssignedChatState(
    skillId: string,
    scope: "routing_and_retrieval" | "retrieval_only"
  ): Promise<void> {
    const assignments = await this.prisma.assistantSkillAssignment.findMany({
      where: { skillId },
      select: { assistantId: true }
    });
    const assistantIds = [...new Set(assignments.map((assignment) => assignment.assistantId))];
    if (assistantIds.length === 0) {
      return;
    }
    if (scope === "retrieval_only") {
      await this.prisma.assistantChat.updateMany({
        where: { assistantId: { in: assistantIds } },
        data: { skillRetrievalState: Prisma.DbNull }
      });
      return;
    }
    const activeAssignmentCounts = await this.prisma.assistantSkillAssignment.groupBy({
      by: ["assistantId"],
      where: {
        assistantId: { in: assistantIds },
        status: "active",
        skill: {
          status: "active",
          archivedAt: null
        }
      },
      _count: { assistantId: true }
    });
    const assistantsWithActiveSkills = new Set(
      activeAssignmentCounts
        .filter((row) => row._count.assistantId > 0)
        .map((row) => row.assistantId)
    );
    const assistantsWithoutActiveSkills = assistantIds.filter(
      (assistantId) => !assistantsWithActiveSkills.has(assistantId)
    );
    if (assistantsWithActiveSkills.size > 0) {
      await this.prisma.assistantChat.updateMany({
        where: { assistantId: { in: [...assistantsWithActiveSkills] } },
        data: {
          skillDecisionState:
            createInactiveSkillDecisionState() as unknown as Prisma.InputJsonValue,
          skillRetrievalState: Prisma.DbNull
        }
      });
    }
    if (assistantsWithoutActiveSkills.length > 0) {
      await this.prisma.assistantChat.updateMany({
        where: { assistantId: { in: assistantsWithoutActiveSkills } },
        data: {
          skillDecisionState: Prisma.DbNull,
          skillRetrievalState: Prisma.DbNull
        }
      });
    }
  }

  private isSkillDocumentMime(mimeType: string): boolean {
    return mimeType.startsWith("text/") || SKILL_DOCUMENT_MIMES.has(mimeType);
  }
}
