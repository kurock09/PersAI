import { Body, Controller, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeConfig } from "@persai/config";
import type { RuntimeAsyncContinuationResult, RuntimeTurnRequest } from "@persai/runtime-contract";
import { RUNTIME_CONFIG } from "../../../../runtime-config";
import { SessionLeaseService } from "../../../sessions/session-lease.service";
import { IdempotencyService } from "../../idempotency.service";
import { TurnExecutionService } from "../../turn-execution.service";
import {
  assertRuntimeInternalApiAuthorized,
  type RuntimeInternalRequestLike
} from "./assert-runtime-internal-auth";
import {
  createCoalescedStreamFlusher,
  createStreamWriterInstrumentation
} from "./stream-writer-instrumentation";

const STREAM_HEARTBEAT_INTERVAL_MS = 10_000;

@Controller("api/v1/internal/runtime/async-continuations")
export class InternalRuntimeAsyncContinuationsController {
  constructor(
    private readonly turnExecutionService: TurnExecutionService,
    private readonly idempotencyService: IdempotencyService,
    private readonly sessionLeaseService: SessionLeaseService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}

  @HttpCode(200)
  @Post()
  create(
    @Req() req: RuntimeInternalRequestLike,
    @Body() body: RuntimeTurnRequest
  ): Promise<RuntimeAsyncContinuationResult> {
    assertRuntimeInternalApiAuthorized(
      req,
      this.config,
      "PERSAI_INTERNAL_API_TOKEN must be configured for async continuations.",
      "Internal async continuation authorization failed."
    );
    return this.turnExecutionService.createAsyncContinuation(body);
  }

  /**
   * ADR-152 resumable web continuation stream. Early busy/duplicate/invalid
   * outcomes remain JSON (same shape as POST /); accepted work is NDJSON with
   * the ordinary `RuntimeTurnStreamEvent` vocabulary from `streamTurn`.
   */
  @Post("stream")
  async stream(
    @Req() req: IncomingMessage & RuntimeInternalRequestLike,
    @Res() res: ServerResponse & { flush?: () => void },
    @Body() body: RuntimeTurnRequest
  ): Promise<void> {
    assertRuntimeInternalApiAuthorized(
      req,
      this.config,
      "PERSAI_INTERNAL_API_TOKEN must be configured for async continuation streams.",
      "Internal async continuation stream authorization failed."
    );
    const abortController = new AbortController();
    req.on("aborted", () => abortController.abort());
    res.on("close", () => abortController.abort());

    const started = await this.turnExecutionService.streamAsyncContinuation(body, {
      signal: abortController.signal
    });
    if (started.outcome !== "stream") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(started));
      return;
    }

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const writerInstrumentation = createStreamWriterInstrumentation();
    const streamFlusher = createCoalescedStreamFlusher(res);
    let wroteFirstPayload = false;
    const heartbeat = setInterval(() => {
      if (res.writableEnded) {
        return;
      }
      const writeReturnedTrue = res.write("\n");
      writerInstrumentation.recordWrite(writeReturnedTrue, res);
      streamFlusher.flushAfterWrite();
    }, STREAM_HEARTBEAT_INTERVAL_MS);

    try {
      for await (const event of started.events) {
        if (res.writableEnded) {
          return;
        }
        const shouldFlushImmediately = !wroteFirstPayload || event.type !== "text_delta";
        wroteFirstPayload = true;
        const writeReturnedTrue = res.write(`${JSON.stringify(event)}\n`);
        writerInstrumentation.recordWrite(writeReturnedTrue, res);
        streamFlusher.flushAfterWrite({ immediate: shouldFlushImmediately });
      }
    } finally {
      clearInterval(heartbeat);
      streamFlusher.dispose();
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  @HttpCode(200)
  @Post("status")
  async status(
    @Req() req: RuntimeInternalRequestLike,
    @Body() body: RuntimeTurnRequest & { sessionId: string }
  ): Promise<{
    proof: "proven" | "ambiguous";
    receiptStatus: "absent" | "accepted" | "completed" | "interrupted" | "failed";
    exactInFlight: boolean;
    logicalReceiptStatus: "absent" | "accepted" | "completed" | "interrupted" | "failed";
    logicalReceiptRequestId: string | null;
    logicalEverAccepted: boolean;
    logicalOrphanReconciled: boolean;
  }> {
    assertRuntimeInternalApiAuthorized(
      req,
      this.config,
      "PERSAI_INTERNAL_API_TOKEN must be configured for async continuation status.",
      "Internal async continuation status authorization failed."
    );
    try {
      const [receipt, logicalReceipt, markerRequestId] = await Promise.all([
        this.idempotencyService.inspectExactReceipt({
          requestId: body.requestId,
          idempotencyKey: body.idempotencyKey,
          conversation: body.conversation,
          sessionId: body.sessionId
        }),
        this.idempotencyService.inspectLogicalReceipt({
          idempotencyKey: body.idempotencyKey,
          conversation: body.conversation
        }),
        this.sessionLeaseService.readAcceptedTurnInFlight({
          conversation: body.conversation,
          idempotencyKey: body.idempotencyKey
        })
      ]);
      return {
        proof: "proven",
        receiptStatus: receipt?.status ?? "absent",
        exactInFlight: markerRequestId === body.requestId,
        logicalReceiptStatus: logicalReceipt?.status ?? "absent",
        logicalReceiptRequestId: logicalReceipt?.requestId ?? null,
        logicalEverAccepted: logicalReceipt !== null,
        logicalOrphanReconciled: logicalReceipt?.errorCode === "orphan_reconciled"
      };
    } catch {
      return {
        proof: "ambiguous",
        receiptStatus: "absent",
        exactInFlight: false,
        logicalReceiptStatus: "absent",
        logicalReceiptRequestId: null,
        logicalEverAccepted: false,
        logicalOrphanReconciled: false
      };
    }
  }
}
