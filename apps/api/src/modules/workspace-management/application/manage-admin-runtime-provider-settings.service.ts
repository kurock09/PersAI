import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { Inject } from "@nestjs/common";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { ApplyAssistantPublishedVersionService } from "./apply-assistant-published-version.service";
import { AdminAuthorizationService } from "./admin-authorization.service";
import {
  PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID,
  assertRequiredProviderKeysAvailable,
  parseUpdatePlatformRuntimeProviderSettingsInput,
  type PlatformRuntimeProviderSettingsState,
  type UpdatePlatformRuntimeProviderSettingsInput
} from "./platform-runtime-provider-settings";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type AdminRuntimeProviderSettingsReapplySummary = {
  totalAssistants: number;
  assistantsWithPublishedVersion: number;
  applySucceededCount: number;
  applyDegradedCount: number;
  applyFailedCount: number;
  skippedCount: number;
};

function mapOutcomeFromApplyStatus(
  status: string | null
): "succeeded" | "degraded" | "failed" | "skipped" {
  if (status === "succeeded") {
    return "succeeded";
  }
  if (status === "degraded") {
    return "degraded";
  }
  if (status === null) {
    return "skipped";
  }
  return "failed";
}

@Injectable()
export class ManageAdminRuntimeProviderSettingsService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService,
    private readonly applyAssistantPublishedVersionService: ApplyAssistantPublishedVersionService,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository
  ) {}

  parseUpdateInput(body: unknown): UpdatePlatformRuntimeProviderSettingsInput {
    try {
      return parseUpdatePlatformRuntimeProviderSettingsInput(body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid runtime provider settings request.";
      throw new BadRequestException(message);
    }
  }

  async getSettings(userId: string): Promise<PlatformRuntimeProviderSettingsState> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    return await this.resolvePlatformRuntimeProviderSettingsService.execute();
  }

  async updateSettings(
    userId: string,
    input: UpdatePlatformRuntimeProviderSettingsInput,
    stepUpToken: string | null
  ): Promise<{
    settings: PlatformRuntimeProviderSettingsState;
    reapplySummary: AdminRuntimeProviderSettingsReapplySummary;
  }> {
    await this.adminAuthorizationService.assertCanPerformDangerousAdminAction(
      userId,
      "admin.runtime_provider_settings.update",
      stepUpToken
    );

    this.platformRuntimeProviderSecretStoreService.assertEncryptionConfigured();
    const existingProviderKeys =
      await this.platformRuntimeProviderSecretStoreService.loadKeyMetadata();
    assertRequiredProviderKeysAvailable({
      primary: input.primary,
      fallback: input.fallback,
      providerKeys: existingProviderKeys,
      incomingProviderKeys: input.providerKeys
    });

    await this.prisma.platformRuntimeProviderSettings.upsert({
      where: { id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID },
      create: {
        id: PLATFORM_RUNTIME_PROVIDER_SETTINGS_ID,
        primaryProvider: input.primary.provider,
        primaryModel: input.primary.model,
        fallbackProvider: input.fallback?.provider ?? null,
        fallbackModel: input.fallback?.model ?? null,
        availableModelsByProvider: input.availableModelsByProvider as Prisma.InputJsonValue,
        updatedByUserId: userId
      },
      update: {
        primaryProvider: input.primary.provider,
        primaryModel: input.primary.model,
        fallbackProvider: input.fallback?.provider ?? null,
        fallbackModel: input.fallback?.model ?? null,
        availableModelsByProvider: input.availableModelsByProvider as Prisma.InputJsonValue,
        updatedByUserId: userId
      }
    });

    for (const provider of ["openai", "anthropic"] as const) {
      const nextKey = input.providerKeys[provider];
      if (typeof nextKey === "string" && nextKey.trim().length > 0) {
        await this.platformRuntimeProviderSecretStoreService.upsertProviderKey(
          provider,
          nextKey,
          userId
        );
      }
    }

    const settings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    const reapplySummary = await this.reapplyLatestPublishedVersions();

    await this.appendAssistantAuditEventService.execute({
      workspaceId: null,
      assistantId: null,
      actorUserId: userId,
      eventCategory: "admin_action",
      eventCode: "admin.runtime_provider_settings_updated",
      summary: "Global runtime provider settings updated.",
      details: {
        mode: settings.mode,
        primary: settings.primary,
        fallback: settings.fallback,
        updatedProviders: Object.entries(input.providerKeys)
          .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
          .map(([provider]) => provider),
        reapplySummary
      }
    });

    return {
      settings,
      reapplySummary
    };
  }
  private async reapplyLatestPublishedVersions(): Promise<AdminRuntimeProviderSettingsReapplySummary> {
    const assistants = await this.prisma.assistant.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true
      }
    });

    const summary: AdminRuntimeProviderSettingsReapplySummary = {
      totalAssistants: assistants.length,
      assistantsWithPublishedVersion: 0,
      applySucceededCount: 0,
      applyDegradedCount: 0,
      applyFailedCount: 0,
      skippedCount: 0
    };

    for (const assistant of assistants) {
      const latestPublished =
        await this.assistantPublishedVersionRepository.findLatestByAssistantId(assistant.id);
      if (latestPublished === null) {
        summary.skippedCount += 1;
        continue;
      }

      summary.assistantsWithPublishedVersion += 1;

      try {
        await this.applyAssistantPublishedVersionService.execute(
          assistant.userId,
          latestPublished,
          true
        );
        const afterApply = await this.prisma.assistant.findUnique({
          where: { id: assistant.id },
          select: {
            applyStatus: true
          }
        });
        const outcome = mapOutcomeFromApplyStatus(afterApply?.applyStatus ?? null);
        if (outcome === "succeeded") {
          summary.applySucceededCount += 1;
        } else if (outcome === "degraded") {
          summary.applyDegradedCount += 1;
        } else if (outcome === "failed") {
          summary.applyFailedCount += 1;
        } else {
          summary.skippedCount += 1;
        }
      } catch {
        summary.applyFailedCount += 1;
      }
    }

    return summary;
  }
}
