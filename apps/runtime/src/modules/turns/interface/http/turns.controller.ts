import { Body, Controller, Post, Req, Res } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  RuntimeTurnRequest,
  RuntimeTurnResult,
  RuntimeTurnStreamEvent
} from "@persai/runtime-contract";
import { TurnExecutionService } from "../../turn-execution.service";

@Controller("api/v1/turns")
export class TurnsController {
  constructor(private readonly turnExecutionService: TurnExecutionService) {}

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

    try {
      for await (const event of stream) {
        if (res.writableEnded) {
          return;
        }
        this.writeEvent(res, event);
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  private writeEvent(
    res: ServerResponse & { flush?: () => void },
    event: RuntimeTurnStreamEvent
  ): void {
    res.write(`${JSON.stringify(event)}\n`);
    res.flush?.();
  }
}
