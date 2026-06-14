import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  AdminAuthorizationService,
  type DangerousAdminActionCode
} from "../../application/admin-authorization.service";
import { AppendAssistantAuditEventService } from "../../application/append-assistant-audit-event.service";

function parseStepUpAction(value: unknown): DangerousAdminActionCode {
  if (
    value === "admin.plan.create" ||
    value === "admin.plan.update" ||
    value === "admin.plan.delete" ||
    value === "admin.memory_backfill.apply" ||
    value === "admin.knowledge_retrieval_policy.update" ||
    value === "admin.billing_lifecycle_settings.update" ||
    value === "admin.billing_provider_credentials.update" ||
    value === "admin.runtime_provider_settings.update" ||
    value === "admin.document_processing_settings.update" ||
    value === "admin.tool_credentials.update" ||
    value === "admin.tool_path_pricing.update" ||
    value === "admin.assistant.transfer_ownership" ||
    value === "admin.assistant.recover_ownership" ||
    value === "admin.force_reapply_all" ||
    value === "admin.safety_user.restrict"
  ) {
    return value;
  }
  throw new BadRequestException(
    "action must be a supported admin dangerous action code (see AdminDangerousActionCode in OpenAPI)."
  );
}

function parseChallengeInput(body: unknown): { action: DangerousAdminActionCode } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestException("Request body must be an object.");
  }
  return {
    action: parseStepUpAction((body as Record<string, unknown>).action)
  };
}

@Controller("api/v1/admin/step-up")
export class AdminSecurityController {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  @HttpCode(200)
  @Post("challenge")
  async createStepUpChallenge(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    challenge: {
      action: DangerousAdminActionCode;
      token: string;
      expiresAt: string;
    };
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = parseChallengeInput(body);
    const { context, challenge } = await this.adminAuthorizationService.issueStepUpChallenge(
      userId,
      input.action
    );
    await this.appendAssistantAuditEventService.execute({
      workspaceId: context.workspaceId,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.step_up_challenge_issued",
      summary: "Admin step-up challenge issued.",
      details: {
        action: input.action,
        actorRoles: context.roles,
        expiresAt: challenge.expiresAt
      }
    });
    return {
      requestId: req.requestId ?? null,
      challenge: {
        action: input.action,
        token: challenge.token,
        expiresAt: challenge.expiresAt
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
