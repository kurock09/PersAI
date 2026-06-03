import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  WorkspaceVcoinBalanceDebitInput,
  WorkspaceVcoinBalanceDebitResult,
  WorkspaceVcoinBalanceRecord,
  WorkspaceVcoinBalanceRepository
} from "../../domain/workspace-vcoin-balance.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

/**
 * Prisma client interface this repository uses. Accepts either the full
 * `WorkspaceManagementPrismaService` (no enclosing transaction) or a
 * `Prisma.TransactionClient` (composes with a caller-owned
 * `prisma.$transaction(async (tx) => …)` block). Both surface the same
 * `workspaceVcoinBalance` delegate so the repository can share its read +
 * write paths across the two cases without conditional plumbing.
 */
type WorkspaceVcoinBalanceClient = Pick<
  WorkspaceManagementPrismaService | Prisma.TransactionClient,
  "workspaceVcoinBalance"
>;

/**
 * ADR-108 — Prisma implementation of the VC wallet port.
 *
 * Slice 1 wired the read-only-with-create surface. Slice 2 adds the
 * `debit` mutation that is invoked by the video-only success-delivery
 * path inside the SAME `prisma.$transaction` that settles the monthly
 * unit counter, so retries cannot double-debit and a failed settle rolls
 * the wallet update back automatically (ADR-108 cross-slice invariant 4).
 *
 * `findUnique` then `create` is the natural shape for `getOrCreate`: an
 * explicit upsert would unnecessarily overwrite `updatedAt` on the read
 * path, which would misrepresent the row's "last touched" timestamp
 * downstream. P2002 races (another concurrent `create`) are handled by
 * re-reading the row.
 */
@Injectable()
export class PrismaWorkspaceVcoinBalanceRepository implements WorkspaceVcoinBalanceRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async getOrCreate(workspaceId: string): Promise<WorkspaceVcoinBalanceRecord> {
    const existing = await this.prisma.workspaceVcoinBalance.findUnique({
      where: { workspaceId }
    });
    if (existing !== null) {
      return this.mapToDomain(existing);
    }

    try {
      const created = await this.prisma.workspaceVcoinBalance.create({
        data: { workspaceId }
      });
      return this.mapToDomain(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.prisma.workspaceVcoinBalance.findUnique({
          where: { workspaceId }
        });
        if (raced !== null) {
          return this.mapToDomain(raced);
        }
      }
      throw error;
    }
  }

  /**
   * ADR-108 Slice 2 — debit `amountVc` from the workspace wallet.
   *
   * When `input.tx` is supplied the entire read+update happens inside
   * that transaction so the caller can compose the debit atomically with
   * its own writes. When omitted, the debit runs against the default
   * client; the read-then-update pair is not transactionally tight on its
   * own and is intentionally not used by Slice 2 settle (Slice 2 always
   * passes `tx`). Future slices that need a stand-alone debit should
   * also pass a tx if they care about a precise `previousBalanceVc`
   * snapshot.
   *
   * `amountVc === 0` is a no-op fast path that still calls `getOrCreate`
   * (with the supplied client) so the row exists for subsequent debits in
   * the same transaction. Negative amounts throw; per ADR-108 the wallet
   * may go negative only on the one-shot debit lifecycle rule, never via
   * a "negative debit = credit" trick (credits are owned by Slice 3 / 4
   * and will land as dedicated `credit` overloads).
   */
  async debit(input: WorkspaceVcoinBalanceDebitInput): Promise<WorkspaceVcoinBalanceDebitResult> {
    if (!Number.isInteger(input.amountVc)) {
      throw new RangeError(
        `WorkspaceVcoinBalanceRepository.debit: amountVc must be an integer (got ${String(input.amountVc)}).`
      );
    }
    if (input.amountVc < 0) {
      throw new RangeError(
        `WorkspaceVcoinBalanceRepository.debit: amountVc must be non-negative (got ${String(input.amountVc)}); use a dedicated credit method instead.`
      );
    }

    const client: WorkspaceVcoinBalanceClient = input.tx ?? this.prisma;
    const ensured = await this.ensureRow(client, input.workspaceId);
    if (input.amountVc === 0) {
      return {
        previousBalanceVc: ensured.balanceVc,
        balanceVc: ensured.balanceVc,
        debitedAt: ensured.updatedAt
      };
    }

    const updated = await client.workspaceVcoinBalance.update({
      where: { workspaceId: input.workspaceId },
      data: { balanceVc: { decrement: input.amountVc } }
    });
    return {
      previousBalanceVc: ensured.balanceVc,
      balanceVc: updated.balanceVc,
      debitedAt: updated.updatedAt
    };
  }

  /**
   * `getOrCreate` against the (possibly-transactional) client. Mirrors
   * the standalone `getOrCreate` above but operates against the supplied
   * client so the row creation, the read, and the subsequent decrement
   * are all part of the same transaction when one is provided.
   */
  private async ensureRow(
    client: WorkspaceVcoinBalanceClient,
    workspaceId: string
  ): Promise<WorkspaceVcoinBalanceRecord> {
    const existing = await client.workspaceVcoinBalance.findUnique({
      where: { workspaceId }
    });
    if (existing !== null) {
      return this.mapToDomain(existing);
    }
    try {
      const created = await client.workspaceVcoinBalance.create({
        data: { workspaceId }
      });
      return this.mapToDomain(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await client.workspaceVcoinBalance.findUnique({
          where: { workspaceId }
        });
        if (raced !== null) {
          return this.mapToDomain(raced);
        }
      }
      throw error;
    }
  }

  private mapToDomain(row: {
    workspaceId: string;
    balanceVc: number;
    updatedAt: Date;
  }): WorkspaceVcoinBalanceRecord {
    return {
      workspaceId: row.workspaceId,
      balanceVc: row.balanceVc,
      updatedAt: row.updatedAt
    };
  }
}
