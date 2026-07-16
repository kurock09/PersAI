import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { ApiErrorHttpException } from "../../../platform-core/interface/http/api-error";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageAdminScriptsService } from "../../application/manage-admin-scripts.service";
import type {
  ScriptState,
  ScriptVersionState,
  SkillScriptLinkState
} from "../../application/script-management.types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller("api/v1/admin/scripts")
export class AdminScriptsController {
  constructor(private readonly service: ManageAdminScriptsService) {}

  @Get()
  async list(@Req() req: RequestWithPlatformContext) {
    return {
      requestId: req.requestId ?? null,
      scripts: await this.service.list(this.user(req))
    };
  }

  @Post()
  async create(@Req() req: RequestWithPlatformContext, @Body() body: unknown) {
    return {
      requestId: req.requestId ?? null,
      script: await this.service.create(this.user(req), this.service.parseCreateInput(body))
    };
  }

  @Get(":scriptId")
  async get(
    @Req() req: RequestWithPlatformContext,
    @Param("scriptId") scriptId: string
  ): Promise<{ requestId: string | null; script: ScriptState }> {
    return {
      requestId: req.requestId ?? null,
      script: await this.service.get(this.user(req), this.id(scriptId, "scriptId"))
    };
  }

  @Patch(":scriptId")
  async update(
    @Req() req: RequestWithPlatformContext,
    @Param("scriptId") scriptId: string,
    @Body() body: unknown
  ) {
    return {
      requestId: req.requestId ?? null,
      script: await this.service.update(
        this.user(req),
        this.id(scriptId, "scriptId"),
        this.service.parseUpdateInput(body)
      )
    };
  }

  @Delete(":scriptId")
  async archive(@Req() req: RequestWithPlatformContext, @Param("scriptId") scriptId: string) {
    return {
      requestId: req.requestId ?? null,
      script: await this.service.archive(this.user(req), this.id(scriptId, "scriptId"))
    };
  }

  @Get(":scriptId/versions")
  async listVersions(@Req() req: RequestWithPlatformContext, @Param("scriptId") scriptId: string) {
    return {
      requestId: req.requestId ?? null,
      versions: await this.service.listVersions(this.user(req), this.id(scriptId, "scriptId"))
    };
  }

  @Post(":scriptId/versions")
  async createVersion(
    @Req() req: RequestWithPlatformContext,
    @Param("scriptId") scriptId: string,
    @Body() body: unknown
  ) {
    return {
      requestId: req.requestId ?? null,
      version: await this.service.createVersion(
        this.user(req),
        this.id(scriptId, "scriptId"),
        this.service.parseVersionCreateInput(body)
      )
    };
  }

  @Patch(":scriptId/versions/:versionId")
  async updateVersion(
    @Req() req: RequestWithPlatformContext,
    @Param("scriptId") scriptId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; version: ScriptVersionState }> {
    return {
      requestId: req.requestId ?? null,
      version: await this.service.updateVersion(
        this.user(req),
        this.id(scriptId, "scriptId"),
        this.id(versionId, "versionId"),
        this.service.parseVersionUpdateInput(body)
      )
    };
  }

  @Post(":scriptId/versions/:versionId/validate")
  @HttpCode(HttpStatus.OK)
  async validateVersion(
    @Req() req: RequestWithPlatformContext,
    @Param("scriptId") scriptId: string,
    @Param("versionId") versionId: string
  ) {
    return {
      requestId: req.requestId ?? null,
      valid: true as const,
      version: await this.service.validateVersion(
        this.user(req),
        this.id(scriptId, "scriptId"),
        this.id(versionId, "versionId")
      )
    };
  }

  @Post(":scriptId/versions/:versionId/publish")
  @HttpCode(HttpStatus.OK)
  async publishVersion(
    @Req() req: RequestWithPlatformContext,
    @Param("scriptId") scriptId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown
  ) {
    return {
      requestId: req.requestId ?? null,
      ...(await this.service.publishVersion(
        this.user(req),
        this.id(scriptId, "scriptId"),
        this.id(versionId, "versionId"),
        this.service.parsePublishInput(body)
      ))
    };
  }

  private user(req: RequestWithPlatformContext): string {
    const id = req.resolvedAppUser?.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return id;
  }

  private id(value: string, name: string): string {
    const normalized = value.trim();
    if (!UUID_PATTERN.test(normalized)) {
      throw new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
        code: "admin_script_invalid_id",
        category: "validation",
        message: `${name} must be a valid UUID.`
      });
    }
    return normalized;
  }
}

@Controller("api/v1/admin/skills")
export class AdminSkillScriptsController {
  constructor(private readonly service: ManageAdminScriptsService) {}

  @Get(":skillId/scripts")
  async list(
    @Req() req: RequestWithPlatformContext,
    @Param("skillId") skillId: string
  ): Promise<{ requestId: string | null; scripts: SkillScriptLinkState[] }> {
    return {
      requestId: req.requestId ?? null,
      scripts: await this.service.listSkillScripts(this.user(req), this.skillId(skillId))
    };
  }

  @Put(":skillId/scripts")
  async replace(
    @Req() req: RequestWithPlatformContext,
    @Param("skillId") skillId: string,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; scripts: SkillScriptLinkState[] }> {
    return {
      requestId: req.requestId ?? null,
      scripts: await this.service.replaceSkillScripts(
        this.user(req),
        this.skillId(skillId),
        this.service.parseScriptsReplaceInput(body)
      )
    };
  }

  private user(req: RequestWithPlatformContext): string {
    const userId = req.resolvedAppUser?.id;
    if (typeof userId !== "string" || userId.length === 0) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return userId;
  }

  private skillId(value: string): string {
    const normalized = value.trim();
    if (!UUID_PATTERN.test(normalized)) {
      throw new ApiErrorHttpException(HttpStatus.BAD_REQUEST, {
        code: "admin_script_invalid_id",
        category: "validation",
        message: "skillId must be a valid UUID."
      });
    }
    return normalized;
  }
}
