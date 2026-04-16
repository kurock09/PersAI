import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminToolPromptMetadataService } from "../../application/manage-admin-tool-prompt-metadata.service";

@Controller("api/v1/admin/tools/metadata")
export class AdminToolMetadataController {
  constructor(
    private readonly manageAdminToolPromptMetadataService: ManageAdminToolPromptMetadataService
  ) {}

  @Get()
  async list(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    tools: Awaited<ReturnType<ManageAdminToolPromptMetadataService["list"]>>;
  }> {
    const userId = this.resolveRequestUserId(req);
    return {
      requestId: req.requestId ?? null,
      tools: await this.manageAdminToolPromptMetadataService.list(userId)
    };
  }

  @Patch(":toolCode")
  async update(
    @Req() req: RequestWithPlatformContext,
    @Param("toolCode") toolCode: string,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    tool: Awaited<ReturnType<ManageAdminToolPromptMetadataService["update"]>>;
  }> {
    const userId = this.resolveRequestUserId(req);
    if (typeof body !== "object" || body === null) {
      throw new BadRequestException("Request body must be an object.");
    }
    const record = body as Record<string, unknown>;
    if (
      !Object.prototype.hasOwnProperty.call(record, "modelDescription") &&
      !Object.prototype.hasOwnProperty.call(record, "modelUsageGuidance")
    ) {
      throw new BadRequestException(
        'Request body must contain "modelDescription" and/or "modelUsageGuidance".'
      );
    }

    const tool = await this.manageAdminToolPromptMetadataService.update(userId, toolCode, {
      ...(Object.prototype.hasOwnProperty.call(record, "modelDescription")
        ? {
            modelDescription:
              typeof record.modelDescription === "string" || record.modelDescription === null
                ? record.modelDescription
                : (() => {
                    throw new BadRequestException('"modelDescription" must be a string or null.');
                  })()
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(record, "modelUsageGuidance")
        ? {
            modelUsageGuidance:
              typeof record.modelUsageGuidance === "string" || record.modelUsageGuidance === null
                ? record.modelUsageGuidance
                : (() => {
                    throw new BadRequestException('"modelUsageGuidance" must be a string or null.');
                  })()
          }
        : {})
    });

    return {
      requestId: req.requestId ?? null,
      tool
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
