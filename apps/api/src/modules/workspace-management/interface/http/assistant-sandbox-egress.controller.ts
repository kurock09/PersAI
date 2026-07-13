import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import {
  ManageAssistantSandboxEgressService,
  type AssistantSandboxEgressState
} from "../../application/manage-assistant-sandbox-egress.service";

type SandboxEgressResponse = {
  requestId: string | null;
} & AssistantSandboxEgressState;

@Controller("api/v1")
export class AssistantSandboxEgressController {
  constructor(
    private readonly manageAssistantSandboxEgressService: ManageAssistantSandboxEgressService
  ) {}

  @Get("assistant/:assistantId/sandbox-egress")
  async getSandboxEgress(
    @Req() req: RequestWithPlatformContext,
    @Param("assistantId") assistantId: string
  ): Promise<SandboxEgressResponse> {
    const userId = this.resolveRequestUserId(req);
    const state = await this.manageAssistantSandboxEgressService.get(userId, assistantId);
    return {
      requestId: req.requestId ?? null,
      ...state
    };
  }

  @Put("assistant/:assistantId/sandbox-egress")
  @HttpCode(200)
  async putSandboxEgress(
    @Req() req: RequestWithPlatformContext,
    @Param("assistantId") assistantId: string,
    @Body() body: unknown
  ): Promise<SandboxEgressResponse> {
    const userId = this.resolveRequestUserId(req);
    const input = this.manageAssistantSandboxEgressService.parseUpdateInput(body);
    const state = await this.manageAssistantSandboxEgressService.put(userId, assistantId, input);
    return {
      requestId: req.requestId ?? null,
      ...state
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
