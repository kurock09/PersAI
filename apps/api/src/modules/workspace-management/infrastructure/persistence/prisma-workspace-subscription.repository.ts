import { Injectable } from "@nestjs/common";
import { Prisma, type WorkspaceSubscription as PrismaWorkspaceSubscription } from "@prisma/client";
import type { BillingProviderSubscriptionSnapshot } from "../../application/billing-provider.port";
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

  async upsertFromBillingSnapshot(
    snapshot: BillingProviderSubscriptionSnapshot
  ): Promise<WorkspaceSubscription> {
    const row = await this.prisma.workspaceSubscription.upsert({
      where: { workspaceId: snapshot.workspaceId },
      update: {
        planCode: snapshot.planCode,
        status: snapshot.status,
        trialStartedAt: this.toDate(snapshot.trialStartedAt),
        trialEndsAt: this.toDate(snapshot.trialEndsAt),
        currentPeriodStartedAt: this.toDate(snapshot.currentPeriodStartedAt),
        currentPeriodEndsAt: this.toDate(snapshot.currentPeriodEndsAt),
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        billingProvider: null,
        providerCustomerRef: snapshot.providerCustomerRef,
        providerSubscriptionRef: snapshot.providerSubscriptionRef,
        metadata: this.toPrismaMetadata(snapshot.metadata)
      },
      create: {
        workspaceId: snapshot.workspaceId,
        planCode: snapshot.planCode,
        status: snapshot.status,
        trialStartedAt: this.toDate(snapshot.trialStartedAt),
        trialEndsAt: this.toDate(snapshot.trialEndsAt),
        currentPeriodStartedAt: this.toDate(snapshot.currentPeriodStartedAt),
        currentPeriodEndsAt: this.toDate(snapshot.currentPeriodEndsAt),
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        billingProvider: null,
        providerCustomerRef: snapshot.providerCustomerRef,
        providerSubscriptionRef: snapshot.providerSubscriptionRef,
        metadata: this.toPrismaMetadata(snapshot.metadata)
      }
    });
    return this.toDomain(row);
  }

  async deleteByWorkspaceId(workspaceId: string): Promise<void> {
    await this.prisma.workspaceSubscription.deleteMany({
      where: { workspaceId }
    });
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

  private toDate(value: string | null): Date | null {
    return value === null ? null : new Date(value);
  }

  private toPrismaMetadata(
    value: Record<string, unknown> | null
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
  }
}
