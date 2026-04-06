import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { BillingProviderSubscriptionSnapshot } from "./billing-provider.port";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  WORKSPACE_SUBSCRIPTION_REPOSITORY,
  type WorkspaceSubscriptionRepository
} from "../domain/workspace-subscription.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import type {
  WorkspaceSubscription,
  WorkspaceSubscriptionStatus
} from "../domain/workspace-subscription.entity";

const WORKSPACE_SUBSCRIPTION_STATUSES: readonly WorkspaceSubscriptionStatus[] = [
  "trialing",
  "active",
  "grace_period",
  "past_due",
  "paused",
  "canceled",
  "expired"
] as const;

export type AdminWorkspaceSubscriptionInput = {
  planCode: string;
  status?: WorkspaceSubscriptionStatus;
  trialStartedAt?: string | null;
  trialEndsAt?: string | null;
  currentPeriodStartedAt?: string | null;
  currentPeriodEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
  providerCustomerRef?: string | null;
  providerSubscriptionRef?: string | null;
  metadata?: Record<string, unknown> | null;
};

@Injectable()
export class ManageAdminWorkspaceSubscriptionService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(WORKSPACE_SUBSCRIPTION_REPOSITORY)
    private readonly workspaceSubscriptionRepository: WorkspaceSubscriptionRepository,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  parseApplyInput(body: unknown): AdminWorkspaceSubscriptionInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const record = body as Record<string, unknown>;
    const status = this.parseOptionalStatus(record.status);
    const trialStartedAt = this.parseOptionalIsoDate(record.trialStartedAt, "trialStartedAt");
    const trialEndsAt = this.parseOptionalIsoDate(record.trialEndsAt, "trialEndsAt");
    const currentPeriodStartedAt = this.parseOptionalIsoDate(
      record.currentPeriodStartedAt,
      "currentPeriodStartedAt"
    );
    const currentPeriodEndsAt = this.parseOptionalIsoDate(
      record.currentPeriodEndsAt,
      "currentPeriodEndsAt"
    );
    const cancelAtPeriodEnd = this.parseOptionalBoolean(
      record.cancelAtPeriodEnd,
      "cancelAtPeriodEnd"
    );
    const providerCustomerRef = this.parseOptionalNullableString(
      record.providerCustomerRef,
      "providerCustomerRef"
    );
    const providerSubscriptionRef = this.parseOptionalNullableString(
      record.providerSubscriptionRef,
      "providerSubscriptionRef"
    );
    const metadata = this.parseOptionalMetadata(record.metadata);

    return {
      planCode: this.parseRequiredString(record.planCode, "planCode"),
      ...(status !== undefined ? { status } : {}),
      ...(trialStartedAt !== undefined ? { trialStartedAt } : {}),
      ...(trialEndsAt !== undefined ? { trialEndsAt } : {}),
      ...(currentPeriodStartedAt !== undefined ? { currentPeriodStartedAt } : {}),
      ...(currentPeriodEndsAt !== undefined ? { currentPeriodEndsAt } : {}),
      ...(cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd } : {}),
      ...(providerCustomerRef !== undefined ? { providerCustomerRef } : {}),
      ...(providerSubscriptionRef !== undefined ? { providerSubscriptionRef } : {}),
      ...(metadata !== undefined ? { metadata } : {})
    };
  }

  async setWorkspaceSubscription(
    callerUserId: string,
    targetUserId: string,
    input: AdminWorkspaceSubscriptionInput,
    stepUpToken: string | null
  ): Promise<{ ok: true; changed: boolean; workspaceId: string }> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      callerUserId,
      "admin.plan.update",
      stepUpToken
    );
    const assistant = await this.requireAssistantByUserId(targetUserId);
    const snapshot = this.toSnapshot(assistant.workspaceId, input);
    const current = await this.workspaceSubscriptionRepository.findByWorkspaceId(
      assistant.workspaceId
    );

    if (current !== null && this.isSameSubscription(current, snapshot)) {
      return { ok: true, changed: false, workspaceId: assistant.workspaceId };
    }

    await this.workspaceSubscriptionRepository.upsertFromBillingSnapshot(snapshot);
    await this.markWorkspaceAssistantsConfigDirty(assistant.workspaceId);
    return { ok: true, changed: true, workspaceId: assistant.workspaceId };
  }

  async resetWorkspaceSubscription(
    callerUserId: string,
    targetUserId: string,
    stepUpToken: string | null
  ): Promise<{ ok: true; changed: boolean; workspaceId: string }> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      callerUserId,
      "admin.plan.update",
      stepUpToken
    );
    const assistant = await this.requireAssistantByUserId(targetUserId);
    const current = await this.workspaceSubscriptionRepository.findByWorkspaceId(
      assistant.workspaceId
    );

    if (current === null) {
      return { ok: true, changed: false, workspaceId: assistant.workspaceId };
    }

    await this.workspaceSubscriptionRepository.deleteByWorkspaceId(assistant.workspaceId);
    await this.markWorkspaceAssistantsConfigDirty(assistant.workspaceId);
    return { ok: true, changed: true, workspaceId: assistant.workspaceId };
  }

  private async requireAssistantByUserId(targetUserId: string) {
    const trimmedUserId = targetUserId.trim();
    if (trimmedUserId.length === 0) {
      throw new BadRequestException("userId is required.");
    }
    const assistant = await this.assistantRepository.findByUserId(trimmedUserId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found for target user.");
    }
    return assistant;
  }

  private toSnapshot(
    workspaceId: string,
    input: AdminWorkspaceSubscriptionInput
  ): BillingProviderSubscriptionSnapshot {
    const planCode = input.planCode.trim();
    if (planCode.length === 0) {
      throw new BadRequestException("planCode is required.");
    }
    return {
      workspaceId,
      planCode,
      status: input.status ?? "active",
      trialStartedAt: input.trialStartedAt ?? null,
      trialEndsAt: input.trialEndsAt ?? null,
      currentPeriodStartedAt: input.currentPeriodStartedAt ?? null,
      currentPeriodEndsAt: input.currentPeriodEndsAt ?? null,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      providerCustomerRef: input.providerCustomerRef ?? null,
      providerSubscriptionRef: input.providerSubscriptionRef ?? null,
      metadata: input.metadata ?? null
    };
  }

  private async markWorkspaceAssistantsConfigDirty(workspaceId: string): Promise<void> {
    await this.prisma.assistant.updateMany({
      where: { workspaceId },
      data: { configDirtyAt: new Date() }
    });
  }

  private isSameSubscription(
    current: WorkspaceSubscription,
    next: BillingProviderSubscriptionSnapshot
  ): boolean {
    return (
      current.workspaceId === next.workspaceId &&
      current.planCode === next.planCode &&
      current.status === next.status &&
      this.sameDate(current.trialStartedAt, next.trialStartedAt) &&
      this.sameDate(current.trialEndsAt, next.trialEndsAt) &&
      this.sameDate(current.currentPeriodStartedAt, next.currentPeriodStartedAt) &&
      this.sameDate(current.currentPeriodEndsAt, next.currentPeriodEndsAt) &&
      current.cancelAtPeriodEnd === next.cancelAtPeriodEnd &&
      current.providerCustomerRef === next.providerCustomerRef &&
      current.providerSubscriptionRef === next.providerSubscriptionRef &&
      JSON.stringify(current.metadata ?? null) === JSON.stringify(next.metadata ?? null)
    );
  }

  private sameDate(current: Date | null, next: string | null): boolean {
    return (current?.toISOString() ?? null) === next;
  }

  private parseRequiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required.`);
    }
    return value.trim();
  }

  private parseOptionalStatus(value: unknown): WorkspaceSubscriptionStatus | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "string" || !WORKSPACE_SUBSCRIPTION_STATUSES.includes(value as never)) {
      throw new BadRequestException(
        `status must be one of: ${WORKSPACE_SUBSCRIPTION_STATUSES.join(", ")}.`
      );
    }
    return value as WorkspaceSubscriptionStatus;
  }

  private parseOptionalIsoDate(value: unknown, field: string): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    if (typeof value !== "string") {
      throw new BadRequestException(`${field} must be an ISO datetime string or null.`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO datetime string.`);
    }
    return parsed.toISOString();
  }

  private parseOptionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "boolean") {
      throw new BadRequestException(`${field} must be a boolean.`);
    }
    return value;
  }

  private parseOptionalNullableString(value: unknown, field: string): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    if (typeof value !== "string") {
      throw new BadRequestException(`${field} must be a string or null.`);
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private parseOptionalMetadata(value: unknown): Record<string, unknown> | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("metadata must be an object or null.");
    }
    return value as Record<string, unknown>;
  }
}
