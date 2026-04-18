import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Req, Res } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextDeltaEvent,
  ProviderGatewayTextGenerateResult
} from "@persai/runtime-contract";
import { ProviderTextGenerationService } from "../../provider-text-generation.service";

const STREAM_DELTA_BATCH_WINDOW_MS = 40;
const STREAM_DELTA_BATCH_MAX_CHARS = 96;

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

    let pendingDelta: ProviderGatewayTextDeltaEvent | null = null;
    let pendingDeltaTimer: ReturnType<typeof setTimeout> | null = null;

    const writeEvent = (event: unknown): void => {
      if (res.writableEnded) {
        return;
      }
      res.write(`${JSON.stringify(event)}\n`);
      res.flush?.();
    };

    const clearPendingDeltaTimer = (): void => {
      if (pendingDeltaTimer !== null) {
        clearTimeout(pendingDeltaTimer);
        pendingDeltaTimer = null;
      }
    };

    const flushPendingDelta = (): void => {
      clearPendingDeltaTimer();
      if (pendingDelta === null) {
        return;
      }
      writeEvent(pendingDelta);
      pendingDelta = null;
    };

    const schedulePendingDeltaFlush = (): void => {
      if (pendingDeltaTimer !== null) {
        return;
      }
      pendingDeltaTimer = setTimeout(() => {
        pendingDeltaTimer = null;
        flushPendingDelta();
      }, STREAM_DELTA_BATCH_WINDOW_MS);
    };

    for await (const event of stream) {
      if (res.writableEnded) {
        clearPendingDeltaTimer();
        return;
      }
      if (event.type === "text_delta") {
        pendingDelta =
          pendingDelta === null
            ? event
            : {
                ...event,
                delta: pendingDelta.delta + event.delta
              };
        if (pendingDelta.delta.length >= STREAM_DELTA_BATCH_MAX_CHARS) {
          flushPendingDelta();
        } else {
          schedulePendingDeltaFlush();
        }
        continue;
      }
      flushPendingDelta();
      writeEvent(event);
    }

    flushPendingDelta();
    if (!res.writableEnded) {
      res.end();
    }
  }
}
