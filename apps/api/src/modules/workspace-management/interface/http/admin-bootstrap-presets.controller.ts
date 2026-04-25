import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManagePromptTemplatesService } from "../../application/manage-bootstrap-presets.service";

interface PresetState {
  id: string;
  template: string;
  updatedAt: string;
}

@Controller("api/v1/admin/prompt-templates")
export class AdminPromptTemplatesController {
  constructor(private readonly managePromptTemplatesService: ManagePromptTemplatesService) {}

  @Get()
  async listPresets(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    presets: PresetState[];
  }> {
    const userId = this.resolveRequestUserId(req);
    const presets = await this.managePromptTemplatesService.getAll(userId);
    return {
      requestId: req.requestId ?? null,
      presets: presets.map((p) => ({
        id: p.id,
        template: p.template,
        updatedAt: p.updatedAt.toISOString()
      }))
    };
  }

  @Patch(":id")
  async updatePreset(
    @Req() req: RequestWithPlatformContext,
    @Param("id") id: string,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    preset: PresetState;
  }> {
    const userId = this.resolveRequestUserId(req);

    if (typeof body !== "object" || body === null || !("template" in body)) {
      throw new BadRequestException(
        'Request body must contain a non-empty "template" string field.'
      );
    }

    const { template } = body as { template: unknown };
    if (typeof template !== "string" || template.trim().length === 0) {
      throw new BadRequestException("Template must be a non-empty string.");
    }

    const preset = await this.managePromptTemplatesService.update(userId, id, template);
    return {
      requestId: req.requestId ?? null,
      preset: {
        id: preset.id,
        template: preset.template,
        updatedAt: preset.updatedAt.toISOString()
      }
    };
  }

  @Post(":id/reset-to-default")
  async resetPresetToDefault(
    @Req() req: RequestWithPlatformContext,
    @Param("id") id: string
  ): Promise<{
    requestId: string | null;
    preset: PresetState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const preset = await this.managePromptTemplatesService.resetToDefault(userId, id);
    return {
      requestId: req.requestId ?? null,
      preset: {
        id: preset.id,
        template: preset.template,
        updatedAt: preset.updatedAt.toISOString()
      }
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
