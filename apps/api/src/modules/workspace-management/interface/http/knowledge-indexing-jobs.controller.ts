import { Controller, Get, Query, Req, UnauthorizedException } from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ListKnowledgeIndexingJobsService } from "../../application/list-knowledge-indexing-jobs.service";
import type { KnowledgeIndexingJobState } from "../../application/skill-management.types";

@Controller("api/v1")
export class KnowledgeIndexingJobsController {
  constructor(
    private readonly listKnowledgeIndexingJobsService: ListKnowledgeIndexingJobsService
  ) {}

  @Get("admin/knowledge-indexing/jobs")
  async listAdminJobs(
    @Req() req: RequestWithPlatformContext,
    @Query("sourceType") sourceType: unknown,
    @Query("status") status: unknown
  ): Promise<{ requestId: string | null; jobs: KnowledgeIndexingJobState[] }> {
    const jobs = await this.listKnowledgeIndexingJobsService.listForAdmin(
      this.resolveRequestUserId(req),
      {
        sourceType: this.listKnowledgeIndexingJobsService.parseSourceType(sourceType),
        status: this.listKnowledgeIndexingJobsService.parseStatus(status)
      }
    );
    return { requestId: req.requestId ?? null, jobs };
  }

  @Get("assistant/knowledge-indexing/jobs")
  async listAssistantJobs(
    @Req() req: RequestWithPlatformContext
  ): Promise<{ requestId: string | null; jobs: KnowledgeIndexingJobState[] }> {
    const jobs = await this.listKnowledgeIndexingJobsService.listForAssistant(
      this.resolveRequestUserId(req)
    );
    return { requestId: req.requestId ?? null, jobs };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
