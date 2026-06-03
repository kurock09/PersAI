import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  WorkspaceVcoinLedgerEventRecordInput,
  WorkspaceVcoinLedgerEventRecordResult,
  WorkspaceVcoinLedgerEventRepository
} from "../../domain/workspace-vcoin-ledger-event.repository";

/**
 * ADR-108 Slice 3 — Prisma implementation of the VC ledger event port.
 *
 * The single responsibility of this repository is inserting a row into
 * `workspace_vcoin_ledger_events` and translating the P2002 unique-violation
 * (which is the "already applied" idempotency signal) into a structured
 * `{ recorded: false }` result.
 *
 * Every other P2002 on this table (e.g. a race on the primary key) is
 * intentionally NOT caught here — per ADR-108 Slice 3 forbidden patterns,
 * P2002 must only be caught from the ledger event insert; anywhere else it
 * is a real constraint violation that must surface.
 *
 * The repository does not call `WorkspaceVcoinBalanceRepository.credit`;
 * that responsibility belongs to the caller (`GrantMonthlyVcoinService`).
 * Ledger-first → credit-second is the required order (ADR-108 Slice 3
 * forbidden patterns).
 */
@Injectable()
export class PrismaWorkspaceVcoinLedgerEventRepository implements WorkspaceVcoinLedgerEventRepository {
  async recordEvent(
    input: WorkspaceVcoinLedgerEventRecordInput
  ): Promise<WorkspaceVcoinLedgerEventRecordResult> {
    try {
      await input.tx.workspaceVcoinLedgerEvent.create({
        data: {
          workspaceId: input.workspaceId,
          kind: input.kind,
          amountVc: input.amountVc,
          referenceKey: input.referenceKey,
          planCode: input.planCode ?? null
        }
      });
      return { recorded: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { recorded: false };
      }
      throw error;
    }
  }
}
