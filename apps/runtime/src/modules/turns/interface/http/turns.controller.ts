import { Body, Controller, Post, Req, Res } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  RuntimeCompactionRequest,
  RuntimeCompactionResult,
  RuntimeSessionResolveInput,
  RuntimeSessionResolveResult,
  RuntimeTurnRequest,
  RuntimeTurnResult,
  RuntimeTurnStreamEvent
} from "@persai/runtime-contract";
import { SessionStoreService } from "../../../sessions/session-store.service";
import { SessionCompactionService } from "../../session-compaction.service";
import { TurnExecutionService } from "../../turn-execution.service";

const STREAM_HEARTBEAT_INTERVAL_MS = 10_000;

@Controller("api/v1/turns")
export class TurnsController {
  constructor(
    private readonly turnExecutionService: TurnExecutionService,
    private readonly sessionCompactionService: SessionCompactionService,
    private readonly sessionStoreService: SessionStoreService
  ) {}

  @Post("create")
  createTurn(@Body() body: RuntimeTurnRequest): Promise<RuntimeTurnResult> {
    return this.turnExecutionService.createTurn(body);
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

    const stream = await this.turnExecutionService.streamTurn(body, {
      signal: abortController.signal
    });

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const heartbeat = setInterval(() => {
      if (res.writableEnded) {
        return;
      }
      // Empty NDJSON lines are ignored by readers but keep the socket active through proxies.
      res.write("\n");
      res.flush?.();
    }, STREAM_HEARTBEAT_INTERVAL_MS);

    try {
      for await (const event of stream) {
        if (res.writableEnded) {
          return;
        }
        this.writeEvent(res, event);
      }
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) {
        res.end();
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
    event: RuntimeTurnStreamEvent
  ): void {
    res.write(`${JSON.stringify(event)}\n`);
    res.flush?.();
  }
}
