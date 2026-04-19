import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Req, Res } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult
} from "@persai/runtime-contract";
import { ProviderTextGenerationService } from "../../provider-text-generation.service";

@Controller("api/v1/providers")
export class ProviderTextGenerationController {
  private readonly logger = new Logger(ProviderTextGenerationController.name);

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
    @Res() res: ServerResponse & { flush?: () => void; flushHeaders?: () => void },
    @Body() body: ProviderGatewayTextGenerateRequest
  ): Promise<void> {
    const abortController = new AbortController();
    req.on("aborted", () => abortController.abort());
    res.on("close", () => abortController.abort());
    this.logger.log(
      `[stream-text-entry] requestId=${body.requestMetadata?.runtimeRequestId ?? "unknown"} classification=${body.requestMetadata?.classification ?? "unknown"} iteration=${
        body.requestMetadata?.toolLoopIteration === null ||
        body.requestMetadata?.toolLoopIteration === undefined
          ? "null"
          : String(body.requestMetadata.toolLoopIteration)
      } provider=${body.provider} model=${body.model} toolCount=${String(body.tools?.length ?? 0)} toolHistoryCount=${String(body.toolHistory?.length ?? 0)}`
    );

    const stream = await this.providerTextGenerationService.streamText(
      body,
      abortController.signal
    );
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const writeEvent = (event: unknown): void => {
      if (res.writableEnded) {
        return;
      }
      res.write(`${JSON.stringify(event)}\n`);
      res.flush?.();
    };

    for await (const event of stream) {
      if (res.writableEnded) {
        return;
      }
      writeEvent(event);
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
}
