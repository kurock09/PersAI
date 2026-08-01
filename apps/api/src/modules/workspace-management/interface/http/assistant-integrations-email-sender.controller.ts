import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  AssistantEmailSenderIdentityService,
  type WorkspaceEmailSenderIdentityView
} from "../../application/assistant-email-sender-identity.service";
import { ResolveActiveAssistantService } from "../../application/resolve-active-assistant.service";

type EmailSenderResponse = {
  requestId: string | null;
  identity: WorkspaceEmailSenderIdentityView | null;
};

/**
 * ADR-168 S1 — the fourth `IntegrationCard` ("Email") in Settings →
 * Интеграции. Workspace-scoped (one verified address per workspace in v1);
 * the caller's workspace is always resolved from the authenticated session,
 * never accepted from the request body.
 */
@Controller("api/v1/assistant/integrations/email-sender")
export class AssistantIntegrationsEmailSenderController {
  constructor(
    private readonly emailSenderIdentityService: AssistantEmailSenderIdentityService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  @Get()
  async getIdentity(@Req() req: RequestWithPlatformContext): Promise<EmailSenderResponse> {
    const workspaceId = await this.resolveWorkspaceId(req);
    const identity = await this.emailSenderIdentityService.readIdentity(workspaceId, {
      recheck: true
    });
    return { requestId: req.requestId ?? null, identity };
  }

  @Post()
  @HttpCode(200)
  async requestIdentity(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<EmailSenderResponse> {
    const workspaceId = await this.resolveWorkspaceId(req);
    const input = this.emailSenderIdentityService.parseRequestInput(body);
    const identity = await this.emailSenderIdentityService.requestIdentity(workspaceId, input);
    return { requestId: req.requestId ?? null, identity };
  }

  @Post("resend")
  @HttpCode(200)
  async resendConfirmation(@Req() req: RequestWithPlatformContext): Promise<EmailSenderResponse> {
    const workspaceId = await this.resolveWorkspaceId(req);
    const identity = await this.emailSenderIdentityService.resendConfirmation(workspaceId);
    return { requestId: req.requestId ?? null, identity };
  }

  @Delete()
  @HttpCode(200)
  async removeIdentity(
    @Req() req: RequestWithPlatformContext
  ): Promise<{ requestId: string | null; removed: true }> {
    const workspaceId = await this.resolveWorkspaceId(req);
    await this.emailSenderIdentityService.removeIdentity(workspaceId);
    return { requestId: req.requestId ?? null, removed: true };
  }

  private async resolveWorkspaceId(req: RequestWithPlatformContext): Promise<string> {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    const membership = await this.resolveActiveAssistantService.resolveMembership(
      req.resolvedAppUser.id
    );
    return membership.workspaceId;
  }
}
