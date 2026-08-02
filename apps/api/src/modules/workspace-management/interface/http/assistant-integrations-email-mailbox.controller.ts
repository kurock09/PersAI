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
  AssistantEmailMailboxService,
  type WorkspaceEmailMailboxStateView
} from "../../application/assistant-email-mailbox.service";
import { ResolveActiveAssistantService } from "../../application/resolve-active-assistant.service";

/**
 * ADR-169 S2 — the fourth `IntegrationCard` ("Email") reworked around a
 * connected mailbox instead of a verified sender address. Workspace-scoped
 * (one connected mailbox per workspace in v1); the caller's workspace is
 * always resolved from the authenticated session, never accepted from the
 * request body.
 */
@Controller("api/v1/assistant/integrations/email-mailbox")
export class AssistantIntegrationsEmailMailboxController {
  constructor(
    private readonly emailMailboxService: AssistantEmailMailboxService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  @Get()
  async getMailbox(
    @Req() req: RequestWithPlatformContext
  ): Promise<{ requestId: string | null; mailbox: WorkspaceEmailMailboxStateView | null }> {
    const workspaceId = await this.resolveWorkspaceId(req);
    const mailbox = await this.emailMailboxService.readMailbox(workspaceId);
    return { requestId: req.requestId ?? null, mailbox };
  }

  @Post("connect")
  @HttpCode(200)
  async connect(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; authorizationUrl: string }> {
    const workspaceId = await this.resolveWorkspaceId(req);
    const input = this.emailMailboxService.parseConnectInput(body);
    const { authorizationUrl } = await this.emailMailboxService.initiateConnect(workspaceId, input);
    return { requestId: req.requestId ?? null, authorizationUrl };
  }

  @Post("verify-smtp")
  @HttpCode(200)
  async verifySmtp(
    @Req() req: RequestWithPlatformContext
  ): Promise<{ requestId: string | null; mailbox: WorkspaceEmailMailboxStateView | null }> {
    const workspaceId = await this.resolveWorkspaceId(req);
    const mailbox = await this.emailMailboxService.verifySmtpAccess(workspaceId);
    return { requestId: req.requestId ?? null, mailbox };
  }

  @Delete()
  @HttpCode(200)
  async disconnect(
    @Req() req: RequestWithPlatformContext
  ): Promise<{ requestId: string | null; removed: boolean }> {
    const workspaceId = await this.resolveWorkspaceId(req);
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    const { removed } = await this.emailMailboxService.disconnect(
      workspaceId,
      req.resolvedAppUser.id
    );
    return { requestId: req.requestId ?? null, removed };
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
