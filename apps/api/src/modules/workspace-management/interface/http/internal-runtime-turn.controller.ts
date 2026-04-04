import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { HandleInternalTelegramTurnService } from "../../application/handle-internal-telegram-turn.service";
import { toAssistantInboundFailurePayload } from "../../application/assistant-inbound-error";
import { RenderAssistantInboundSurfaceMessageService } from "../../application/render-assistant-inbound-surface-message.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/turns")
export class InternalRuntimeTurnController {
  constructor(
    private readonly handleInternalTelegramTurnService: HandleInternalTelegramTurnService,
    private readonly renderAssistantInboundSurfaceMessageService: RenderAssistantInboundSurfaceMessageService
  ) {}

  @HttpCode(200)
  @Post("telegram")
  async handleTelegramTurn(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<
    | { ok: true; assistantMessage: string; respondedAt: string; media?: unknown[] }
    | { ok: false; code: string; message: string; renderedMessage: string }
  > {
    this.assertAuthorized(req);
    const input = this.handleInternalTelegramTurnService.parseInput(body);

    try {
      const result = await this.handleInternalTelegramTurnService.execute(input);
      return {
        ok: true,
        assistantMessage: result.assistantMessage,
        respondedAt: result.respondedAt,
        ...(result.media ? { media: result.media } : {})
      };
    } catch (error) {
      const failure = toAssistantInboundFailurePayload(error);
      const rendered = this.renderAssistantInboundSurfaceMessageService.renderError(
        "telegram",
        failure.code,
        failure.message
      );
      return {
        ok: false,
        code: failure.code,
        message: failure.message,
        renderedMessage: rendered.text
      };
    }
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal endpoints.",
      "Internal authorization failed."
    );
  }
}
