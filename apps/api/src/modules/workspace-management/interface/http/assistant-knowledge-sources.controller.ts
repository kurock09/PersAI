import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import type {
  AssistantKnowledgeQuotaState,
  AssistantKnowledgeSourceState
} from "../../application/assistant-knowledge-source.types";
import { ManageAssistantKnowledgeSourcesService } from "../../application/manage-assistant-knowledge-sources.service";
import { MAX_MEDIA_FILE_BYTES } from "../../application/media/media-security-policy";

@Controller("api/v1")
export class AssistantKnowledgeSourcesController {
  constructor(
    private readonly manageAssistantKnowledgeSourcesService: ManageAssistantKnowledgeSourcesService
  ) {}

  @Post("assistant/knowledge-sources")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_MEDIA_FILE_BYTES } }))
  async upload(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string } | undefined
  ): Promise<{ requestId: string | null; source: AssistantKnowledgeSourceState }> {
    const userId = this.resolveRequestUserId(req);
    if (!file) {
      throw new BadRequestException("A file is required.");
    }

    const input = this.manageAssistantKnowledgeSourcesService.parseUploadInput(body);
    const source = await this.manageAssistantKnowledgeSourcesService.upload({
      userId,
      displayName: input.displayName,
      file
    });

    return {
      requestId: req.requestId ?? null,
      source
    };
  }

  @Get("assistant/knowledge-sources")
  async list(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    quota: AssistantKnowledgeQuotaState;
    sources: AssistantKnowledgeSourceState[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const result = await this.manageAssistantKnowledgeSourcesService.list(userId);
    return {
      requestId: req.requestId ?? null,
      quota: result.quota,
      sources: result.sources
    };
  }

  @Get("assistant/knowledge-sources/:sourceId")
  async get(
    @Req() req: RequestWithPlatformContext,
    @Param("sourceId") sourceId: string
  ): Promise<{ requestId: string | null; source: AssistantKnowledgeSourceState }> {
    const userId = this.resolveRequestUserId(req);
    const source = await this.manageAssistantKnowledgeSourcesService.get(userId, sourceId);
    return {
      requestId: req.requestId ?? null,
      source
    };
  }

  @Delete("assistant/knowledge-sources/:sourceId")
  async delete(
    @Req() req: RequestWithPlatformContext,
    @Param("sourceId") sourceId: string
  ): Promise<{ requestId: string | null; deleted: true }> {
    const userId = this.resolveRequestUserId(req);
    await this.manageAssistantKnowledgeSourcesService.delete(userId, sourceId);
    return {
      requestId: req.requestId ?? null,
      deleted: true
    };
  }

  @Post("assistant/knowledge-sources/:sourceId/reindex")
  async reindex(
    @Req() req: RequestWithPlatformContext,
    @Param("sourceId") sourceId: string
  ): Promise<{ requestId: string | null; source: AssistantKnowledgeSourceState }> {
    const userId = this.resolveRequestUserId(req);
    const source = await this.manageAssistantKnowledgeSourcesService.reindex(userId, sourceId);
    return {
      requestId: req.requestId ?? null,
      source
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
