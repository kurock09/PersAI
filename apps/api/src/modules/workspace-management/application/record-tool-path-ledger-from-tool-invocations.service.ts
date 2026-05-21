import { Injectable, Logger } from "@nestjs/common";
import type { RuntimeTurnToolInvocation } from "@persai/runtime-contract";
import {
  RecordModelCostLedgerService,
  type ModelCostLedgerSurface
} from "./record-model-cost-ledger.service";

@Injectable()
export class RecordToolPathLedgerFromToolInvocationsService {
  private readonly logger = new Logger(RecordToolPathLedgerFromToolInvocationsService.name);

  constructor(private readonly recordModelCostLedgerService: RecordModelCostLedgerService) {}

  async recordFromToolInvocations(input: {
    workspaceId: string;
    assistantId: string;
    userId: string;
    surface: ModelCostLedgerSurface;
    source: string;
    assistantMessageId: string;
    requestCorrelationId?: string | null;
    toolInvocations?: RuntimeTurnToolInvocation[];
  }): Promise<void> {
    if (input.toolInvocations === undefined || input.toolInvocations.length === 0) {
      return;
    }

    for (const invocation of input.toolInvocations) {
      if (invocation.ok !== true || invocation.billingFacts === undefined) {
        continue;
      }
      const billingFacts = invocation.billingFacts;
      if (billingFacts === null) {
        continue;
      }

      const sourceEventId =
        typeof invocation.toolCallId === "string" && invocation.toolCallId.trim().length > 0
          ? `tool_invocation:${invocation.toolCallId.trim()}`
          : `tool_invocation:${invocation.name}:${input.assistantMessageId}:${invocation.iteration}`;

      try {
        await this.recordModelCostLedgerService.recordToolPathBillingFactsEvent({
          workspaceId: input.workspaceId,
          assistantId: input.assistantId,
          userId: input.userId,
          surface: input.surface,
          source: input.source,
          sourceEventId,
          requestCorrelationId: input.requestCorrelationId ?? null,
          billingFacts
        });
      } catch (error) {
        this.logger.warn(
          `[tool-path-ledger] Non-blocking append failed for assistant ${input.assistantId} tool ${invocation.name}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }
}
