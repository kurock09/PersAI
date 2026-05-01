import { Body, Controller, Logger, Post, Req, Res } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  RuntimeCompactionRequest,
  RuntimeCompactionResult,
  RuntimeSessionResolveInput,
  RuntimeSessionResolveResult,
  RuntimeSkillRoutingCheckResult,
  RuntimeTurnRequest,
  RuntimeTurnResult,
  RuntimeTurnStreamEvent
} from "@persai/runtime-contract";
import { SessionStoreService } from "../../../sessions/session-store.service";
import { SessionCompactionService } from "../../session-compaction.service";
import { TurnExecutionService } from "../../turn-execution.service";
import { createStreamWriterInstrumentation } from "./stream-writer-instrumentation";

const STREAM_HEARTBEAT_INTERVAL_MS = 10_000;
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

@Controller("api/v1/turns")
export class TurnsController {
  private readonly logger = new Logger(TurnsController.name);

  constructor(
    private readonly turnExecutionService: TurnExecutionService,
    private readonly sessionCompactionService: SessionCompactionService,
    private readonly sessionStoreService: SessionStoreService
  ) {}

  @Post("create")
  createTurn(@Body() body: RuntimeTurnRequest): Promise<RuntimeTurnResult> {
    return this.turnExecutionService.createTurn(body);
  }

  @Post("skill-routing-check")
  checkSkillRouting(@Body() body: RuntimeTurnRequest): Promise<RuntimeSkillRoutingCheckResult> {
    return this.turnExecutionService.checkSkillRouting(body);
  }

  @Post("stream")
  async streamTurn(
    @Req() req: IncomingMessage,
    @Res() res: ServerResponse & { flush?: () => void },
    @Body() body: RuntimeTurnRequest
  ): Promise<void> {
    const abortController = new AbortController();
    req.on("aborted", () => abortController.abort());
    res.on("close", () => abortController.abort());
    const traceEnabled = readTraceEnabledHeader(req);

    const stream = await this.turnExecutionService.streamTurn(body, {
      signal: abortController.signal,
      traceEnabled
    });

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const writerInstrumentation = createStreamWriterInstrumentation();
    const heartbeat = setInterval(() => {
      if (res.writableEnded) {
        return;
      }
      // Empty NDJSON lines are ignored by readers but keep the socket active through proxies.
      const writeReturnedTrue = res.write("\n");
      writerInstrumentation.recordWrite(writeReturnedTrue, res);
      res.flush?.();
    }, STREAM_HEARTBEAT_INTERVAL_MS);

    const startedAtMs = Date.now();
    try {
      for await (const event of stream) {
        if (res.writableEnded) {
          return;
        }
        this.writeEvent(res, event, writerInstrumentation);
      }
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) {
        res.end();
      }
      if (traceEnabled) {
        this.logger.log(
          `runtime_stream_writer_stats requestId=${body.requestId ?? "unknown"} channel=${body.conversation?.channel ?? "unknown"} elapsedMs=${String(Date.now() - startedAtMs)} ${writerInstrumentation.formatStats()}`
        );
      }
    }
  }

  @Post("compact")
  compactSession(@Body() body: RuntimeCompactionRequest): Promise<RuntimeCompactionResult> {
    return this.sessionCompactionService.compactSession(body);
  }

  @Post("session/resolve")
  async resolveSession(
    @Body() body: RuntimeSessionResolveInput
  ): Promise<RuntimeSessionResolveResult> {
    const resolved = await this.sessionStoreService.resolveSession(body);
    return {
      found: resolved.found,
      session: resolved.session
    };
  }

  private writeEvent(
    res: ServerResponse & { flush?: () => void },
    event: RuntimeTurnStreamEvent,
    writerInstrumentation: ReturnType<typeof createStreamWriterInstrumentation>
  ): void {
    const writeReturnedTrue = res.write(`${JSON.stringify(event)}\n`);
    writerInstrumentation.recordWrite(writeReturnedTrue, res);
    res.flush?.();
  }
}
