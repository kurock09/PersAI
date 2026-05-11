import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Req, Res } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextStreamEvent,
  ProviderGatewayTextGenerateResult
} from "@persai/runtime-contract";
import { ProviderTextGenerationService } from "../../provider-text-generation.service";
import { ProviderStreamObservabilityService } from "../../provider-stream-observability.service";
import {
  createCoalescedStreamFlusher,
  createStreamWriterInstrumentation
} from "./stream-writer-instrumentation";

const TRACE_HEADER_NAME = "x-persai-trace";

function readTraceEnabledHeader(req: IncomingMessage | undefined | null): boolean {
  const headers = (
    req as { headers?: Record<string, string | string[] | undefined> } | null | undefined
  )?.headers;
  if (headers === undefined || headers === null) {
    return false;
  }
  const raw = headers[TRACE_HEADER_NAME];
  if (typeof raw === "string") {
    return raw.toLowerCase() === "on";
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return (raw[0] ?? "").toLowerCase() === "on";
  }
  return false;
}

@Controller("api/v1/providers")
export class ProviderTextGenerationController {
  private readonly logger = new Logger(ProviderTextGenerationController.name);

  constructor(
    private readonly providerTextGenerationService: ProviderTextGenerationService,
    private readonly providerStreamObservabilityService: ProviderStreamObservabilityService
  ) {}

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

    const traceEnabled = readTraceEnabledHeader(req);
    const startedAtMs = Date.now();
    const requestId = body.requestMetadata?.runtimeRequestId ?? "unknown";
    const classification = body.requestMetadata?.classification ?? "unknown";
    const iteration =
      body.requestMetadata?.toolLoopIteration === null ||
      body.requestMetadata?.toolLoopIteration === undefined
        ? "null"
        : String(body.requestMetadata.toolLoopIteration);
    let status: "completed" | "failed" | "interrupted" = "completed";
    let firstEventMs: number | null = null;
    let firstTextDeltaMs: number | null = null;
    let wroteFirstPayload = false;
    const writerInstrumentation = createStreamWriterInstrumentation();
    const streamFlusher = createCoalescedStreamFlusher(res);
    const writeEvent = (event: ProviderGatewayTextStreamEvent): void => {
      if (res.writableEnded) {
        return;
      }
      const writeReturnedTrue = res.write(`${JSON.stringify(event)}\n`);
      writerInstrumentation.recordWrite(writeReturnedTrue, res);
      const shouldFlushImmediately =
        !wroteFirstPayload ||
        event.type === "completed" ||
        event.type === "tool_calls" ||
        event.type === "failed";
      wroteFirstPayload = true;
      streamFlusher.flushAfterWrite({
        immediate: shouldFlushImmediately
      });
    };

    this.providerStreamObservabilityService.beginStreamRequest();
    try {
      const stream = await this.providerTextGenerationService.streamText(
        body,
        abortController.signal
      );
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      for await (const event of stream) {
        if (res.writableEnded) {
          status = abortController.signal.aborted ? "interrupted" : "completed";
          return;
        }
        if (event.type !== "keepalive" && firstEventMs === null) {
          firstEventMs = Date.now() - startedAtMs;
        }
        if (event.type === "text_delta" && firstTextDeltaMs === null) {
          firstTextDeltaMs = Date.now() - startedAtMs;
        }
        writeEvent(event);
      }
    } catch (error) {
      status = abortController.signal.aborted ? "interrupted" : "failed";
      throw error;
    } finally {
      if (abortController.signal.aborted && status === "completed") {
        status = "interrupted";
      }
      if (!res.writableEnded) {
        streamFlusher.dispose();
        res.end();
      } else {
        streamFlusher.dispose();
      }
      const totalMs = Date.now() - startedAtMs;
      this.providerStreamObservabilityService.recordStreamRequest({
        provider: body.provider,
        classification,
        status,
        totalMs,
        stageDurations: [
          ...(firstEventMs === null ? [] : [{ stage: "first_event", durationMs: firstEventMs }]),
          ...(firstTextDeltaMs === null
            ? []
            : [{ stage: "first_text_delta", durationMs: firstTextDeltaMs }]),
          { stage: "total", durationMs: totalMs }
        ]
      });
      this.providerStreamObservabilityService.endStreamRequest();
      if (traceEnabled) {
        this.logger.log(
          `[stream-text-timing] requestId=${requestId} classification=${classification} iteration=${iteration} provider=${body.provider} model=${body.model} status=${status} firstEventMs=${firstEventMs ?? -1} firstTextDeltaMs=${firstTextDeltaMs ?? -1} totalMs=${String(totalMs)} ${writerInstrumentation.formatStats()}`
        );
      }
    }
  }
}
