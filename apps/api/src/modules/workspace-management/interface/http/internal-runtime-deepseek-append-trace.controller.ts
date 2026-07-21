import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { DeepSeekChatAppendTraceService } from "../../application/deepseek-chat-append-trace.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

/**
 * ADR-161 D2a — private Runtime control plane for DeepSeek-only operational
 * replay state. It intentionally exposes no public/API-model surface.
 */
@Controller("api/v1/internal/runtime/deepseek-append-trace")
export class InternalRuntimeDeepSeekAppendTraceController {
  constructor(private readonly traceService: DeepSeekChatAppendTraceService) {}

  @HttpCode(200)
  @Post("read")
  async read(@Req() req: InternalRequestLike, @Body() body: unknown) {
    this.assertAuthorized(req);
    return {
      ok: true as const,
      trace: await this.traceService.read(this.traceService.parseRead(body))
    };
  }

  @HttpCode(200)
  @Post("append")
  async append(@Req() req: InternalRequestLike, @Body() body: unknown) {
    this.assertAuthorized(req);
    return {
      ok: true as const,
      trace: await this.traceService.append(this.traceService.parseAppend(body))
    };
  }

  @HttpCode(200)
  @Post("reset")
  async reset(@Req() req: InternalRequestLike, @Body() body: unknown) {
    this.assertAuthorized(req);
    return {
      ok: true as const,
      trace: await this.traceService.reset(this.traceService.parseReset(body))
    };
  }

  @HttpCode(200)
  @Post("clear")
  async clear(@Req() req: InternalRequestLike, @Body() body: unknown) {
    this.assertAuthorized(req);
    return {
      ok: true as const,
      trace: await this.traceService.clear(this.traceService.parseClear(body))
    };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal DeepSeek trace endpoints.",
      "Internal DeepSeek trace authorization failed."
    );
  }
}
