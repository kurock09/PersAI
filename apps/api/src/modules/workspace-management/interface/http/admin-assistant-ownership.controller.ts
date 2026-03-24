import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  ManageAdminAssistantOwnershipService,
  type AssistantOwnershipFlowResult
} from "../../application/manage-admin-assistant-ownership.service";

@Controller("api/v1/admin/assistants/ownership")
export class AdminAssistantOwnershipController {
  constructor(
    private readonly manageAdminAssistantOwnershipService: ManageAdminAssistantOwnershipService
  ) {}

  @Post("transfer")
  async transfer(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    ownership: AssistantOwnershipFlowResult;
  }> {
    const adminUserId = this.resolveRequestUserId(req);
    const input = this.manageAdminAssistantOwnershipService.parseTransferInput(body);
    const ownership = await this.manageAdminAssistantOwnershipService.transferOwnership(
      adminUserId,
      input,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      ownership
    };
  }

  @Post("recover")
  async recover(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    ownership: AssistantOwnershipFlowResult;
  }> {
    const adminUserId = this.resolveRequestUserId(req);
    const input = this.manageAdminAssistantOwnershipService.parseRecoveryInput(body);
    const ownership = await this.manageAdminAssistantOwnershipService.recoverOwnership(
      adminUserId,
      input,
      this.resolveStepUpToken(req)
    );
    return {
      requestId: req.requestId ?? null,
      ownership
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }

  private resolveStepUpToken(req: RequestWithPlatformContext): string | null {
    const header = req.headers["x-persai-step-up-token"];
    if (Array.isArray(header)) {
      return header[0] ?? null;
    }
    return typeof header === "string" ? header : null;
  }
}
