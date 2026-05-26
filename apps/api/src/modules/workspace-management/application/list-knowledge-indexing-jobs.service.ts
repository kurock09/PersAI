import { BadRequestException, Injectable } from "@nestjs/common";
import type { KnowledgeIndexingJobSourceType, KnowledgeIndexingJobStatus } from "@prisma/client";
import { AdminAuthorizationService } from "./admin-authorization.service";
import {
  toKnowledgeIndexingJobState,
  type KnowledgeIndexingJobState
} from "./skill-management.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

const KNOWLEDGE_INDEXING_JOB_LIST_LIMIT = 50;

@Injectable()
export class ListKnowledgeIndexingJobsService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  async listForAdmin(
    userId: string,
    filters: {
      sourceType: KnowledgeIndexingJobSourceType | null;
      status: KnowledgeIndexingJobStatus | null;
    }
  ): Promise<KnowledgeIndexingJobState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const rows = await this.prisma.knowledgeIndexingJob.findMany({
      where: {
        ...(filters.sourceType === null ? {} : { sourceType: filters.sourceType }),
        ...(filters.status === null ? {} : { status: filters.status })
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: KNOWLEDGE_INDEXING_JOB_LIST_LIMIT
    });
    return rows.map(toKnowledgeIndexingJobState);
  }

  async listForAssistant(userId: string): Promise<KnowledgeIndexingJobState[]> {
    const assistant = await this.resolveActiveAssistantService.execute({ userId });
    const rows = await this.prisma.knowledgeIndexingJob.findMany({
      where: {
        OR: [
          { assistantId: assistant.assistantId, workspaceId: assistant.workspaceId },
          {
            sourceType: { in: ["skill_document", "skill_knowledge_card"] },
            skill: {
              assignments: {
                some: {
                  assistantId: assistant.assistantId,
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
      value === "skill_document" ||
      value === "skill_knowledge_card" ||
      value === "product_knowledge_text_entry"
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
