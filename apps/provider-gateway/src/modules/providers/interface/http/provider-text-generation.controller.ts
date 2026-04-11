import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult
} from "@persai/runtime-contract";
import { ProviderTextGenerationService } from "../../provider-text-generation.service";

@Controller("api/v1/providers")
export class ProviderTextGenerationController {
  constructor(private readonly providerTextGenerationService: ProviderTextGenerationService) {}

  @Post("generate-text")
  @HttpCode(HttpStatus.OK)
  generateText(
    @Body() body: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    return this.providerTextGenerationService.generateText(body);
  }

  @Post("stream-text")
  @HttpCode(HttpStatus.OK)
  async streamText(
    @Req() req: IncomingMessage,
    @Res() res: ServerResponse & { flush?: () => void },
    @Body() body: ProviderGatewayTextGenerateRequest
  ): Promise<void> {
    const abortController = new AbortController();
    req.on("aborted", () => abortController.abort());
    res.on("close", () => abortController.abort());

    const stream = await this.providerTextGenerationService.streamText(
      body,
      abortController.signal
    );
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    for await (const event of stream) {
      if (res.writableEnded) {
        return;
      }
      res.write(`${JSON.stringify(event)}\n`);
      res.flush?.();
    }

    if (!res.writableEnded) {
      res.end();
    }
  }
}
