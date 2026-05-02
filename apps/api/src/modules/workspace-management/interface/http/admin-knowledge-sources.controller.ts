import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MAX_MEDIA_FILE_BYTES } from "../../application/media/media-security-policy";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import type { GlobalKnowledgeSourceState } from "../../application/assistant-knowledge-source.types";
import type { AdminKnowledgeRetrievalPolicyState } from "../../application/admin-knowledge-retrieval-policy";
import { ManageAdminKnowledgeRetrievalPolicyService } from "../../application/manage-admin-knowledge-retrieval-policy.service";
import { ManageAdminKnowledgeSourcesService } from "../../application/manage-admin-knowledge-sources.service";
import { ResolveAdminKnowledgeConnectorsService } from "../../application/resolve-admin-knowledge-connectors.service";
import { ResolveAdminKnowledgeObservabilityService } from "../../application/resolve-admin-knowledge-observability.service";
import type { AdminKnowledgeConnectorState } from "../../application/resolve-admin-knowledge-connectors.service";
import type { KnowledgeRetrievalObservabilityState } from "../../application/knowledge-retrieval-observability.service";
import type { ProductKnowledgeTextEntryState } from "../../application/authored-knowledge.types";
import type { KnowledgeIndexingJobState } from "../../application/skill-management.types";

@Controller("api/v1/admin/knowledge-sources")
export class AdminKnowledgeSourcesController {
  constructor(
    private readonly manageAdminKnowledgeSourcesService: ManageAdminKnowledgeSourcesService,
    private readonly resolveAdminKnowledgeObservabilityService: ResolveAdminKnowledgeObservabilityService,
    private readonly resolveAdminKnowledgeConnectorsService: ResolveAdminKnowledgeConnectorsService,
    private readonly manageAdminKnowledgeRetrievalPolicyService: ManageAdminKnowledgeRetrievalPolicyService
  ) {}

  @Get()
  async list(
    @Req() req: RequestWithPlatformContext,
    @Query("scope") scope: string | undefined
  ): Promise<{ requestId: string | null; sources: GlobalKnowledgeSourceState[] }> {
    if (scope === undefined) {
      throw new BadRequestException("scope query parameter is required.");
    }
    const userId = this.resolveRequestUserId(req);
    const sources = await this.manageAdminKnowledgeSourcesService.list(
      userId,
      this.manageAdminKnowledgeSourcesService.parseScope(scope)
    );
    return {
      requestId: req.requestId ?? null,
      sources
    };
  }

  @Get("product/text-entries")
  async listTextEntries(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    entries: ProductKnowledgeTextEntryState[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const entries = await this.manageAdminKnowledgeSourcesService.listTextEntries(userId);
    return { requestId: req.requestId ?? null, entries };
  }

  @Post("product/text-entries")
  async createTextEntry(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    entry: ProductKnowledgeTextEntryState;
    indexingJob: KnowledgeIndexingJobState | null;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminKnowledgeSourcesService.parseTextEntryInput(body);
    const result = await this.manageAdminKnowledgeSourcesService.createTextEntry(userId, input);
    return { requestId: req.requestId ?? null, ...result };
  }

  @Patch("product/text-entries/:entryId")
  async updateTextEntry(
    @Req() req: RequestWithPlatformContext,
    @Param("entryId") entryId: string,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    entry: ProductKnowledgeTextEntryState;
    indexingJob: KnowledgeIndexingJobState | null;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminKnowledgeSourcesService.parseTextEntryInput(body);
    const result = await this.manageAdminKnowledgeSourcesService.updateTextEntry(
      userId,
      entryId,
      input
    );
    return { requestId: req.requestId ?? null, ...result };
  }

  @Delete("product/text-entries/:entryId")
  async archiveTextEntry(
    @Req() req: RequestWithPlatformContext,
    @Param("entryId") entryId: string
  ): Promise<{ requestId: string | null; archived: true }> {
    const userId = this.resolveRequestUserId(req);
    await this.manageAdminKnowledgeSourcesService.archiveTextEntry(userId, entryId);
    return { requestId: req.requestId ?? null, archived: true };
  }

  @Post("product/text-entries/:entryId/reindex")
  async reindexTextEntry(
    @Req() req: RequestWithPlatformContext,
    @Param("entryId") entryId: string
  ): Promise<{
    requestId: string | null;
    entry: ProductKnowledgeTextEntryState;
    indexingJob: KnowledgeIndexingJobState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const result = await this.manageAdminKnowledgeSourcesService.reindexTextEntry(userId, entryId);
    return { requestId: req.requestId ?? null, ...result };
  }

  @Get("observability")
  async getObservability(
    @Req() req: RequestWithPlatformContext
  ): Promise<{ requestId: string | null; observability: KnowledgeRetrievalObservabilityState }> {
    const userId = this.resolveRequestUserId(req);
    const observability = await this.resolveAdminKnowledgeObservabilityService.execute(userId);
    return {
      requestId: req.requestId ?? null,
      observability
    };
  }

  @Get("connectors")
  async listConnectors(
    @Req() req: RequestWithPlatformContext,
    @Query("scope") scope: string | undefined
  ): Promise<{ requestId: string | null; connectors: AdminKnowledgeConnectorState[] }> {
    if (scope === undefined) {
      throw new BadRequestException("scope query parameter is required.");
    }
    const userId = this.resolveRequestUserId(req);
    const connectors = await this.resolveAdminKnowledgeConnectorsService.execute({
      userId,
      scope: this.manageAdminKnowledgeSourcesService.parseScope(scope)
    });
    return {
      requestId: req.requestId ?? null,
      connectors
    };
  }

  @Get("retrieval-policy")
  async getRetrievalPolicy(
    @Req() req: RequestWithPlatformContext
  ): Promise<{ requestId: string | null; policy: AdminKnowledgeRetrievalPolicyState }> {
    const userId = this.resolveRequestUserId(req);
    const policy = await this.manageAdminKnowledgeRetrievalPolicyService.getPolicy(userId);
    return {
      requestId: req.requestId ?? null,
      policy
    };
  }

  @Post("retrieval-policy")
  async updateRetrievalPolicy(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    policy: AdminKnowledgeRetrievalPolicyState;
    configGeneration: number;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminKnowledgeRetrievalPolicyService.parseUpdateInput(body);
    const { policy, configGeneration } =
      await this.manageAdminKnowledgeRetrievalPolicyService.updatePolicy(userId, input);
    return {
      requestId: req.requestId ?? null,
      policy,
      configGeneration
    };
  }

  @Post(":scope")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_MEDIA_FILE_BYTES } }))
  async upload(
    @Req() req: RequestWithPlatformContext,
    @Param("scope") scope: string,
    @Body() body: unknown,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string } | undefined
  ): Promise<{ requestId: string | null; source: GlobalKnowledgeSourceState }> {
    if (!file) {
      throw new BadRequestException("A file is required.");
    }
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAdminKnowledgeSourcesService.parseUploadInput(body);
    const source = await this.manageAdminKnowledgeSourcesService.upload({
      userId,
      scope: this.manageAdminKnowledgeSourcesService.parseScope(scope),
      displayName: input.displayName,
      file
    });
    return {
      requestId: req.requestId ?? null,
      source
    };
  }

  @Delete(":sourceId")
  async delete(
    @Req() req: RequestWithPlatformContext,
    @Param("sourceId") sourceId: string
  ): Promise<{ requestId: string | null; deleted: true }> {
    const userId = this.resolveRequestUserId(req);
    await this.manageAdminKnowledgeSourcesService.delete(userId, sourceId);
    return {
      requestId: req.requestId ?? null,
      deleted: true
    };
  }

  @Post(":sourceId/reindex")
  async reindex(
    @Req() req: RequestWithPlatformContext,
    @Param("sourceId") sourceId: string
  ): Promise<{ requestId: string | null; source: GlobalKnowledgeSourceState }> {
    const userId = this.resolveRequestUserId(req);
    const source = await this.manageAdminKnowledgeSourcesService.reindex(userId, sourceId);
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
