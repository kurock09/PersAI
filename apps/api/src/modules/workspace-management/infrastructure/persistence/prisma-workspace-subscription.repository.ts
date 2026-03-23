import { Injectable } from "@nestjs/common";
import type { WorkspaceSubscription as PrismaWorkspaceSubscription } from "@prisma/client";
import type { WorkspaceSubscriptionRepository } from "../../domain/workspace-subscription.repository";
import type { WorkspaceSubscription } from "../../domain/workspace-subscription.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaWorkspaceSubscriptionRepository implements WorkspaceSubscriptionRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findByWorkspaceId(workspaceId: string): Promise<WorkspaceSubscription | null> {
    const row = await this.prisma.workspaceSubscription.findUnique({
      where: { workspaceId }
    });
    return row === null ? null : this.toDomain(row);
  }

  private toDomain(row: PrismaWorkspaceSubscription): WorkspaceSubscription {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      planCode: row.planCode,
      status: row.status,
      trialStartedAt: row.trialStartedAt,
      trialEndsAt: row.trialEndsAt,
      currentPeriodStartedAt: row.currentPeriodStartedAt,
      currentPeriodEndsAt: row.currentPeriodEndsAt,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      billingProvider: row.billingProvider,
      providerCustomerRef: row.providerCustomerRef,
      providerSubscriptionRef: row.providerSubscriptionRef,
      metadata: row.metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
