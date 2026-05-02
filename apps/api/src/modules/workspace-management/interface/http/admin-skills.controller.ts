import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { MAX_MEDIA_FILE_BYTES } from "../../application/media/media-security-policy";
import { ManageAdminSkillsService } from "../../application/manage-admin-skills.service";
import type { SkillKnowledgeCardState } from "../../application/authored-knowledge.types";
import type {
  AdminSkillState,
  KnowledgeIndexingJobState,
  SkillDocumentState
} from "../../application/skill-management.types";

@Controller("api/v1/admin/skills")
export class AdminSkillsController {
  constructor(private readonly manageAdminSkillsService: ManageAdminSkillsService) {}

  @Get()
  async list(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    skills: AdminSkillState[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const skills = await this.manageAdminSkillsService.list(userId);
    return { requestId: req.requestId ?? null, skills };
  }

  @Post()
  async create(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; skill: AdminSkillState }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminSkillsService.parseUpsertInput(body);
    const skill = await this.manageAdminSkillsService.create(userId, input);
    return { requestId: req.requestId ?? null, skill };
  }

  @Get(":skillId")
  async get(
    @Req() req: RequestWithPlatformContext,
    @Param("skillId") skillId: string
  ): Promise<{ requestId: string | null; skill: AdminSkillState }> {
    const userId = this.resolveRequestUserId(req);
    const skill = await this.manageAdminSkillsService.get(userId, skillId);
    return { requestId: req.requestId ?? null, skill };
  }

  @Patch(":skillId")
  async update(
    @Req() req: RequestWithPlatformContext,
    @Param("skillId") skillId: string,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; skill: AdminSkillState }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminSkillsService.parseUpsertInput(body);
    const skill = await this.manageAdminSkillsService.update(userId, skillId, input);
    return { requestId: req.requestId ?? null, skill };
  }

  @Delete(":skillId")
  async archive(
    @Req() req: RequestWithPlatformContext,
    @Param("skillId") skillId: string
  ): Promise<{ requestId: string | null; archived: true }> {
    const userId = this.resolveRequestUserId(req);
    await this.manageAdminSkillsService.archive(userId, skillId);
    return { requestId: req.requestId ?? null, archived: true };
  }

  @Post(":skillId/documents")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_MEDIA_FILE_BYTES } }))
  async uploadDocument(
    @Req() req: RequestWithPlatformContext,
    @Param("skillId") skillId: string,
    @Body() body: unknown,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string } | undefined
  ): Promise<{
    requestId: string | null;
    document: SkillDocumentState;
    indexingJob: KnowledgeIndexingJobState;
  }> {
    if (!file) {
      throw new BadRequestException("A file is required.");
    }
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminSkillsService.parseDocumentUploadInput(body);
    const result = await this.manageAdminSkillsService.uploadDocument({
      userId,
      skillId,
      input,
      file
    });
    return {
      requestId: req.requestId ?? null,
      document: result.document,
      indexingJob: result.indexingJob
    };
  }

  @Delete(":skillId/documents/:documentId")
  async deleteDocument(
    @Req() req: RequestWithPlatformContext,
    @Param("skillId") skillId: string,
    @Param("documentId") documentId: string
  ): Promise<{ requestId: string | null; deleted: true }> {
    const userId = this.resolveRequestUserId(req);
    await this.manageAdminSkillsService.deleteDocument(userId, skillId, documentId);
    return { requestId: req.requestId ?? null, deleted: true };
  }

  @Post(":skillId/documents/:documentId/reindex")
  async reindexDocument(
    @Req() req: RequestWithPlatformContext,
    @Param("skillId") skillId: string,
    @Param("documentId") documentId: string
  ): Promise<{
    requestId: string | null;
    document: SkillDocumentState;
    indexingJob: KnowledgeIndexingJobState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const result = await this.manageAdminSkillsService.reindexDocument(userId, skillId, documentId);
    return {
      requestId: req.requestId ?? null,
      document: result.document,
      indexingJob: result.indexingJob
    };
  }

  @Post(":skillId/knowledge-cards")
  async createKnowledgeCard(
    @Req() req: RequestWithPlatformContext,
    @Param("skillId") skillId: string,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    card: SkillKnowledgeCardState;
    indexingJob: KnowledgeIndexingJobState | null;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminSkillsService.parseKnowledgeCardInput(body);
    const result = await this.manageAdminSkillsService.createKnowledgeCard(userId, skillId, input);
    return { requestId: req.requestId ?? null, ...result };
  }

  @Patch(":skillId/knowledge-cards/:cardId")
  async updateKnowledgeCard(
    @Req() req: RequestWithPlatformContext,
    @Param("skillId") skillId: string,
    @Param("cardId") cardId: string,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    card: SkillKnowledgeCardState;
    indexingJob: KnowledgeIndexingJobState | null;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminSkillsService.parseKnowledgeCardInput(body);
    const result = await this.manageAdminSkillsService.updateKnowledgeCard(
      userId,
      skillId,
      cardId,
      input
    );
    return { requestId: req.requestId ?? null, ...result };
  }

  @Delete(":skillId/knowledge-cards/:cardId")
  async archiveKnowledgeCard(
    @Req() req: RequestWithPlatformContext,
    @Param("skillId") skillId: string,
    @Param("cardId") cardId: string
  ): Promise<{ requestId: string | null; archived: true }> {
    const userId = this.resolveRequestUserId(req);
    await this.manageAdminSkillsService.archiveKnowledgeCard(userId, skillId, cardId);
    return { requestId: req.requestId ?? null, archived: true };
  }

  @Post(":skillId/knowledge-cards/:cardId/reindex")
  async reindexKnowledgeCard(
    @Req() req: RequestWithPlatformContext,
    @Param("skillId") skillId: string,
    @Param("cardId") cardId: string
  ): Promise<{
    requestId: string | null;
    card: SkillKnowledgeCardState;
    indexingJob: KnowledgeIndexingJobState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const result = await this.manageAdminSkillsService.reindexKnowledgeCard(
      userId,
      skillId,
      cardId
    );
    return { requestId: req.requestId ?? null, ...result };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
