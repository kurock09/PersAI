import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { KnowledgeIndexingJobSourceType, KnowledgeIndexingJobStatus } from "@prisma/client";
import { AdminAuthorizationService } from "./admin-authorization.service";
import {
  toKnowledgeIndexingJobState,
  type KnowledgeIndexingJobState
} from "./skill-management.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const KNOWLEDGE_INDEXING_JOB_LIST_LIMIT = 50;

@Injectable()
export class ListKnowledgeIndexingJobsService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async listForAdmin(
    userId: string,
    filters: {
      sourceType: KnowledgeIndexingJobSourceType | null;
      status: KnowledgeIndexingJobStatus | null;
    }
  ): Promise<KnowledgeIndexingJobState[]> {
    const access = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const rows = await this.prisma.knowledgeIndexingJob.findMany({
      where: {
        workspaceId: access.workspaceId,
        ...(filters.sourceType === null ? {} : { sourceType: filters.sourceType }),
        ...(filters.status === null ? {} : { status: filters.status })
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: KNOWLEDGE_INDEXING_JOB_LIST_LIMIT
    });
    return rows.map(toKnowledgeIndexingJobState);
  }

  async listForAssistant(userId: string): Promise<KnowledgeIndexingJobState[]> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { userId },
      select: { id: true, workspaceId: true }
    });
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    const rows = await this.prisma.knowledgeIndexingJob.findMany({
      where: {
        workspaceId: assistant.workspaceId,
        OR: [
          { assistantId: assistant.id },
          {
            sourceType: "skill_document",
            skill: {
              assignments: {
                some: {
                  assistantId: assistant.id,
                  userId,
                  status: "active"
                }
              }
            }
          }
        ]
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: KNOWLEDGE_INDEXING_JOB_LIST_LIMIT
    });
    return rows.map(toKnowledgeIndexingJobState);
  }

  parseSourceType(value: unknown): KnowledgeIndexingJobSourceType | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    if (
      value === "assistant_knowledge_source" ||
      value === "global_knowledge_source" ||
      value === "skill_document"
    ) {
      return value;
    }
    throw new BadRequestException("sourceType is invalid.");
  }

  parseStatus(value: unknown): KnowledgeIndexingJobStatus | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    if (
      value === "pending" ||
      value === "in_progress" ||
      value === "completed" ||
      value === "failed" ||
      value === "needs_review" ||
      value === "cancelled"
    ) {
      return value;
    }
    throw new BadRequestException("status is invalid.");
  }
}
