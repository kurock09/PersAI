import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { validatePersaiMediaFile } from "./media/media-security-policy";
import { PersaiKnowledgeObjectStorageService } from "./persai-knowledge-object-storage.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
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
    private readonly knowledgeObjectStorage: PersaiKnowledgeObjectStorageService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
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

  async list(userId: string): Promise<AdminSkillState[]> {
    const access = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const rows = await this.prisma.skill.findMany({
      where: { workspaceId: access.workspaceId },
      include: { documents: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] } },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }]
    });
    return rows.map(toAdminSkillState);
  }

  async get(userId: string, skillId: string): Promise<AdminSkillState> {
    const access = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const skill = await this.prisma.skill.findFirst({
      where: { id: skillId, workspaceId: access.workspaceId },
      include: { documents: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] } }
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
        workspaceId: access.workspaceId,
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
      include: { documents: true }
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
      where: { id: skillId, workspaceId: access.workspaceId }
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
      include: { documents: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] } }
    });
    if (nextStatus === "archived") {
      await this.disableAssignmentsForArchivedSkill(existing.id);
    }
    await this.markAssignedAssistantsDirty(existing.id);
    return toAdminSkillState(skill);
  }

  async archive(userId: string, skillId: string): Promise<void> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const existing = await this.prisma.skill.findFirst({
      where: { id: skillId, workspaceId: access.workspaceId }
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
      where: { id: params.skillId, workspaceId: access.workspaceId }
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
    const quota = await this.trackWorkspaceQuotaUsageService.checkWorkspaceKnowledgeStorageQuota({
      workspaceId: access.workspaceId,
      userId: access.userId
    });
    if (!quota.allowed) {
      throw new ConflictException("Workspace knowledge storage quota is already exhausted.");
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
    let appliedQuotaBytes = BigInt(0);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const document = await tx.skillDocument.create({
          data: {
            skillId: skill.id,
            workspaceId: access.workspaceId,
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
            workspaceId: access.workspaceId,
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

      const applied =
        await this.trackWorkspaceQuotaUsageService.recordWorkspaceKnowledgeStorageUpload({
          workspaceId: access.workspaceId,
          userId: access.userId,
          sizeBytes: BigInt(stored.sizeBytes),
          source: "admin_skill_document_upload",
          metadata: { skillId: skill.id, documentId: result.document.id }
        });
      appliedQuotaBytes = applied.appliedDelta;
      if (applied.capped) {
        throw new ConflictException("Workspace knowledge storage quota is exhausted.");
      }
      return {
        document: toSkillDocumentState(result.document),
        indexingJob: toKnowledgeIndexingJobState(result.indexingJob)
      };
    } catch (error) {
      if (documentId !== null) {
        await this.prisma.knowledgeIndexingJob
          .deleteMany({ where: { sourceType: "skill_document", sourceId: documentId } })
          .catch(() => undefined);
        await this.prisma.skillDocument
          .delete({ where: { id: documentId } })
          .catch(() => undefined);
      }
      if (appliedQuotaBytes > BigInt(0)) {
        await this.trackWorkspaceQuotaUsageService
          .releaseWorkspaceKnowledgeStorage({
            workspaceId: access.workspaceId,
            userId: access.userId,
            sizeBytes: appliedQuotaBytes,
            source: "admin_skill_document_upload_rollback",
            metadata: { skillId: skill.id, documentId }
          })
          .catch(() => undefined);
      }
      await this.knowledgeObjectStorage.deleteObject(stored.objectKey).catch(() => undefined);
      throw error;
    }
  }

  async deleteDocument(userId: string, skillId: string, documentId: string): Promise<void> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const document = await this.prisma.skillDocument.findFirst({
      where: {
        id: documentId,
        skillId,
        workspaceId: access.workspaceId
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
    await this.trackWorkspaceQuotaUsageService.releaseWorkspaceKnowledgeStorage({
      workspaceId: access.workspaceId,
      userId: access.userId,
      sizeBytes: document.sizeBytes,
      source: "admin_skill_document_delete",
      metadata: { skillId, documentId }
    });
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
        skillId,
        workspaceId: access.workspaceId
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
          workspaceId: access.workspaceId,
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
    return {
      document: toSkillDocumentState(result.document),
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

  private isSkillDocumentMime(mimeType: string): boolean {
    return mimeType.startsWith("text/") || SKILL_DOCUMENT_MIMES.has(mimeType);
  }
}
