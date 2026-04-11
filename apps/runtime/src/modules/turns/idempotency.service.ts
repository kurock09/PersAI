import { BadRequestException, Injectable } from "@nestjs/common";
import type { RuntimeTurnReceiptStatus } from "@prisma/client";
import type { RuntimeTurnRequest } from "@persai/runtime-contract";
import { RuntimeStateRedisService } from "../runtime-state/infrastructure/coordination/runtime-state-redis.service";
import { RuntimeStatePostgresService } from "../runtime-state/infrastructure/persistence/runtime-state-postgres.service";
import { RuntimeStateKeyspaceService } from "../runtime-state/runtime-state-keyspace.service";

export interface ClaimRuntimeTurnInput extends Pick<
  RuntimeTurnRequest,
  "requestId" | "idempotencyKey" | "runtimeTier" | "conversation" | "bundle"
> {
  sessionId?: string | null;
}

export interface RuntimeTurnReceiptSummary {
  requestId: string;
  sessionId: string | null;
  publishedVersionId: string | null;
  status: RuntimeTurnReceiptStatus;
  bundleHash: string | null;
  resultPayload: unknown | null;
  errorCode: string | null;
  errorMessage: string | null;
  completedAt: string | null;
}

export interface ClaimRuntimeTurnResult {
  conversationKey: string;
  replayed: boolean;
  receipt: RuntimeTurnReceiptSummary;
}

@Injectable()
export class IdempotencyService {
  constructor(
    private readonly runtimeStateKeyspaceService: RuntimeStateKeyspaceService,
    private readonly runtimeStatePostgresService: RuntimeStatePostgresService,
    private readonly runtimeStateRedisService: RuntimeStateRedisService
  ) {}

  async findReplayAcceptedTurn(
    input: ClaimRuntimeTurnInput
  ): Promise<ClaimRuntimeTurnResult | null> {
    this.assertNonEmpty(input.requestId, "requestId");
    this.assertNonEmpty(input.idempotencyKey, "idempotencyKey");

    const conversationKey = this.runtimeStateKeyspaceService.createConversationKey(
      input.conversation
    );
    const receiptFromMarker = await this.resolveFromMarker(input, conversationKey);
    if (receiptFromMarker !== null) {
      return this.toClaimResult(conversationKey, receiptFromMarker, true);
    }

    const existingReceipt =
      await this.runtimeStatePostgresService.findTurnReceiptByConversationAndIdempotencyKey(
        conversationKey,
        input.idempotencyKey
      );
    if (existingReceipt !== null) {
      await this.tryWriteReceiptMarker(input, existingReceipt.requestId);
      return this.toClaimResult(conversationKey, existingReceipt, true);
    }

    return null;
  }

  async createAcceptedTurn(input: ClaimRuntimeTurnInput): Promise<ClaimRuntimeTurnResult> {
    this.assertNonEmpty(input.requestId, "requestId");
    this.assertNonEmpty(input.idempotencyKey, "idempotencyKey");

    const conversationKey = this.runtimeStateKeyspaceService.createConversationKey(
      input.conversation
    );

    try {
      const createdReceipt = await this.runtimeStatePostgresService.createAcceptedTurnReceipt({
        publishedVersionId: input.bundle.publishedVersionId,
        runtimeTier: input.runtimeTier,
        conversationKey,
        conversation: input.conversation,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        bundleHash: input.bundle.bundleHash,
        ...(input.sessionId !== undefined ? { runtimeSessionId: input.sessionId } : {})
      });
      await this.tryWriteReceiptMarker(input, createdReceipt.requestId);
      return this.toClaimResult(conversationKey, createdReceipt, false);
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      const replayedReceipt =
        await this.runtimeStatePostgresService.findTurnReceiptByConversationAndIdempotencyKey(
          conversationKey,
          input.idempotencyKey
        );
      if (replayedReceipt === null) {
        throw error;
      }

      await this.tryWriteReceiptMarker(input, replayedReceipt.requestId);
      return this.toClaimResult(conversationKey, replayedReceipt, true);
    }
  }

  async claimOrReplayAcceptedTurn(input: ClaimRuntimeTurnInput): Promise<ClaimRuntimeTurnResult> {
    const replay = await this.findReplayAcceptedTurn(input);
    if (replay !== null) {
      return replay;
    }

    return this.createAcceptedTurn(input);
  }

  private async resolveFromMarker(
    input: ClaimRuntimeTurnInput,
    conversationKey: string
  ): Promise<Awaited<
    ReturnType<RuntimeStatePostgresService["findTurnReceiptByRequestId"]>
  > | null> {
    const markerRequestId = await this.tryReadReceiptMarker(input);
    if (markerRequestId === null) {
      return null;
    }

    const receipt =
      await this.runtimeStatePostgresService.findTurnReceiptByRequestId(markerRequestId);
    if (
      receipt === null ||
      receipt.conversationKey !== conversationKey ||
      receipt.idempotencyKey !== input.idempotencyKey
    ) {
      return null;
    }

    return receipt;
  }

  private toReceiptSummary(
    receipt: NonNullable<
      Awaited<ReturnType<RuntimeStatePostgresService["findTurnReceiptByRequestId"]>>
    >
  ): RuntimeTurnReceiptSummary {
    return {
      requestId: receipt.requestId,
      sessionId: receipt.runtimeSessionId,
      publishedVersionId: receipt.publishedVersionId,
      status: receipt.status,
      bundleHash: receipt.bundleHash,
      resultPayload: receipt.resultPayload ?? null,
      errorCode: receipt.errorCode,
      errorMessage: receipt.errorMessage,
      completedAt: receipt.completedAt?.toISOString() ?? null
    };
  }

  private toClaimResult(
    conversationKey: string,
    receipt: NonNullable<
      Awaited<ReturnType<RuntimeStatePostgresService["findTurnReceiptByRequestId"]>>
    >,
    replayed: boolean
  ): ClaimRuntimeTurnResult {
    return {
      conversationKey,
      replayed,
      receipt: this.toReceiptSummary(receipt)
    };
  }

  private async tryReadReceiptMarker(input: ClaimRuntimeTurnInput): Promise<string | null> {
    try {
      return await this.runtimeStateRedisService.readTurnReceiptMarker({
        conversation: input.conversation,
        idempotencyKey: input.idempotencyKey
      });
    } catch {
      return null;
    }
  }

  private async tryWriteReceiptMarker(
    input: ClaimRuntimeTurnInput,
    requestId: string
  ): Promise<void> {
    try {
      await this.runtimeStateRedisService.writeTurnReceiptMarker({
        conversation: input.conversation,
        idempotencyKey: input.idempotencyKey,
        requestId
      });
    } catch {
      // Postgres remains the durable turn-receipt authority.
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
  }

  private assertNonEmpty(value: unknown, field: string): asserts value is string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} must be a non-empty string`);
    }
  }
}
