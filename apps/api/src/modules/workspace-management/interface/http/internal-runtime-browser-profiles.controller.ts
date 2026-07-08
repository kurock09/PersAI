import { BadRequestException, Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type {
  RuntimeBrowserLoginResult,
  RuntimeBrowserProfileListItem
} from "@persai/runtime-contract";
import {
  AssistantBrowserProfileService,
  type AssistantBrowserProfileSettingsItem,
  type ResolveBrowserProfileForToolResult
} from "../../application/assistant-browser-profile.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

type ListResponse = {
  ok: true;
  profiles: RuntimeBrowserProfileListItem[];
};

type ResolveResponse = ResolveBrowserProfileForToolResult;

type StartLoginResponse = RuntimeBrowserLoginResult & {
  ok: true;
  profileId: string;
};

type CompleteLoginResponse = {
  ok: true;
  profile: AssistantBrowserProfileSettingsItem;
};

@Controller("api/v1/internal/runtime/browser-profiles")
export class InternalRuntimeBrowserProfilesController {
  constructor(private readonly assistantBrowserProfileService: AssistantBrowserProfileService) {}

  @HttpCode(200)
  @Post("list")
  async list(@Req() req: InternalRequestLike, @Body() body: unknown): Promise<ListResponse> {
    this.assertAuthorized(req);
    const input = this.parseAssistantScopedBody(body);
    const profiles = await this.assistantBrowserProfileService.listProfilesForRuntime(
      input.assistantId
    );
    return { ok: true, profiles };
  }

  @HttpCode(200)
  @Post("resolve")
  async resolve(@Req() req: InternalRequestLike, @Body() body: unknown): Promise<ResolveResponse> {
    this.assertAuthorized(req);
    const input = this.parseResolveBody(body);
    return this.assistantBrowserProfileService.resolveProfileForTool(input);
  }

  @HttpCode(200)
  @Post("start-login")
  async startLogin(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<StartLoginResponse> {
    this.assertAuthorized(req);
    const input = this.parseStartLoginBody(body);
    const result = await this.assistantBrowserProfileService.startLogin(input);
    return { ok: true, ...result };
  }

  @HttpCode(200)
  @Post("touch")
  async touch(@Req() req: InternalRequestLike, @Body() body: unknown): Promise<{ ok: true }> {
    this.assertAuthorized(req);
    const input = this.parseTouchBody(body);
    await this.assistantBrowserProfileService.touchProfile(input);
    return { ok: true };
  }

  @HttpCode(200)
  @Post("complete-login")
  async completeLogin(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<CompleteLoginResponse> {
    this.assertAuthorized(req);
    const input = this.parseCompleteLoginBody(body);
    const result = await this.assistantBrowserProfileService.completeLogin(input);
    return { ok: true, profile: result.profile };
  }

  private parseAssistantScopedBody(body: unknown): { assistantId: string } {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    return { assistantId: this.requiredString(row.assistantId, "assistantId") };
  }

  private parseTouchBody(body: unknown): {
    assistantId: string;
    workspaceId: string;
    profileKey: string;
  } {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    return {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      profileKey: this.requiredString(row.profileKey, "profileKey")
    };
  }

  private parseResolveBody(body: unknown): { assistantId: string; profileKey: string } {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    return {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      profileKey: this.requiredString(row.profileKey, "profileKey")
    };
  }

  private parseStartLoginBody(body: unknown): {
    assistantId: string;
    workspaceId: string;
    displayName: string;
    loginUrl: string;
    originatingChatId?: string | null;
  } {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    const parsed = {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      displayName: this.requiredString(row.displayName, "displayName"),
      loginUrl: this.requiredString(row.loginUrl, "loginUrl")
    };
    const originatingChatId =
      typeof row.originatingChatId === "string" && row.originatingChatId.trim().length > 0
        ? row.originatingChatId.trim()
        : row.originatingChatId === null
          ? null
          : undefined;
    return {
      ...parsed,
      ...(originatingChatId === undefined ? {} : { originatingChatId })
    };
  }

  private parseCompleteLoginBody(body: unknown): {
    profileId: string;
    assistantId: string;
    workspaceId: string;
  } {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    return {
      profileId: this.requiredString(row.profileId, "profileId"),
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      workspaceId: this.requiredString(row.workspaceId, "workspaceId")
    };
  }

  private requiredString(value: unknown, label: string): string {
    if (typeof value !== "string") {
      throw new BadRequestException(`${label} must be a string.`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException(`${label} must be a non-empty string.`);
    }
    return trimmed;
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime browser-profile APIs.",
      "Internal runtime browser-profile authorization failed."
    );
  }
}
