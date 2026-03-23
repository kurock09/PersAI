import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import type { AssistantLifecycleState } from "../../application/assistant-lifecycle.types";
import { CreateAssistantService } from "../../application/create-assistant.service";
import { GetAssistantByUserIdService } from "../../application/get-assistant-by-user-id.service";
import { PublishAssistantDraftService } from "../../application/publish-assistant-draft.service";
import { ResetAssistantService } from "../../application/reset-assistant.service";
import { RollbackAssistantService } from "../../application/rollback-assistant.service";
import { UpdateAssistantDraftService } from "../../application/update-assistant-draft.service";

@Controller("api/v1")
export class AssistantController {
  constructor(
    private readonly createAssistantService: CreateAssistantService,
    private readonly getAssistantByUserIdService: GetAssistantByUserIdService,
    private readonly publishAssistantDraftService: PublishAssistantDraftService,
    private readonly rollbackAssistantService: RollbackAssistantService,
    private readonly resetAssistantService: ResetAssistantService,
    private readonly updateAssistantDraftService: UpdateAssistantDraftService
  ) {}

  @Post("assistant")
  async createAssistant(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    assistant: AssistantLifecycleState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const assistant = await this.createAssistantService.execute(userId);

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  @Get("assistant")
  async getAssistant(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    assistant: AssistantLifecycleState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const assistant = await this.getAssistantByUserIdService.execute(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  @Patch("assistant/draft")
  async updateDraft(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    assistant: AssistantLifecycleState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.updateAssistantDraftService.parseInput(body);
    const assistant = await this.updateAssistantDraftService.execute(userId, input);

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  @Post("assistant/publish")
  async publishAssistant(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    assistant: AssistantLifecycleState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const assistant = await this.publishAssistantDraftService.execute(userId);

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  @Post("assistant/rollback")
  async rollbackAssistant(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{
    requestId: string | null;
    assistant: AssistantLifecycleState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const input = this.rollbackAssistantService.parseInput(body);
    const assistant = await this.rollbackAssistantService.execute(userId, input);

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  @Post("assistant/reset")
  async resetAssistant(@Req() req: RequestWithPlatformContext): Promise<{
    requestId: string | null;
    assistant: AssistantLifecycleState;
  }> {
    const userId = this.resolveRequestUserId(req);
    const assistant = await this.resetAssistantService.execute(userId);

    return {
      requestId: req.requestId ?? null,
      assistant
    };
  }

  private resolveRequestUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }

    return req.resolvedAppUser.id;
  }
}
