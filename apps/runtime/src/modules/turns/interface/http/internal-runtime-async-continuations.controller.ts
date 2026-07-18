import { Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
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

  @HttpCode(200)
  @Post("status")
  async status(
    @Req() req: RuntimeInternalRequestLike,
    @Body() body: RuntimeTurnRequest & { sessionId: string }
  ): Promise<{
    proof: "proven" | "ambiguous";
    receiptStatus: "absent" | "accepted" | "completed" | "interrupted" | "failed";
    exactInFlight: boolean;
  }> {
    assertRuntimeInternalApiAuthorized(
      req,
      this.config,
      "PERSAI_INTERNAL_API_TOKEN must be configured for async continuation status.",
      "Internal async continuation status authorization failed."
    );
    try {
      const [receipt, markerRequestId] = await Promise.all([
        this.idempotencyService.inspectExactReceipt({
          requestId: body.requestId,
          idempotencyKey: body.idempotencyKey,
          conversation: body.conversation,
          sessionId: body.sessionId
        }),
        this.sessionLeaseService.readAcceptedTurnInFlight({
          conversation: body.conversation,
          idempotencyKey: body.idempotencyKey
        })
      ]);
      return {
        proof: "proven",
        receiptStatus: receipt?.status ?? "absent",
        exactInFlight: markerRequestId === body.requestId
      };
    } catch {
      return { proof: "ambiguous", receiptStatus: "absent", exactInFlight: false };
    }
  }
}
