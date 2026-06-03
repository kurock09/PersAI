import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  WorkspaceVcoinBalanceRecord,
  WorkspaceVcoinBalanceRepository
} from "../../domain/workspace-vcoin-balance.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

/**
 * ADR-108 Slice 1 — Prisma implementation of the read-only-with-create
 * VC wallet port. The only public method is `getOrCreate`. Slices 2/3/4
 * own the actual debit / credit / grant / purchase mutations against the
 * same underlying `workspace_vcoin_balances` row.
 *
 * `findUnique` then `create` is the natural shape here: an explicit upsert
 * would unnecessarily overwrite `updatedAt` on the read path, which would
 * misrepresent the row's "last touched" timestamp downstream. P2002 races
 * (another concurrent `create`) are handled by re-reading the row.
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
