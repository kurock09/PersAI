import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { ResendTelegramOwnerMessageService } from "../src/modules/workspace-management/application/resend-telegram-owner-message.service";
import type { AssistantChannelSurfaceBindingRepository } from "../src/modules/workspace-management/domain/assistant-channel-surface-binding.repository";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { ResolveTelegramIntegrationStateService } from "../src/modules/workspace-management/application/resolve-telegram-integration-state.service";
import type { PlatformRuntimeProviderSecretStoreService } from "../src/modules/workspace-management/application/platform-runtime-provider-secret-store.service";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";

async function run(): Promise<void> {
  const auditEvents: Array<Record<string, unknown>> = [];
  const fetchCalls: Array<{ url: string; body: unknown }> = [];
  const activeAssistantResolver = {
    execute: async ({ userId }: { userId: string }) => {
      if (userId !== "user-1") {
        throw new Error("assistant not found");
      }
      return { assistantId: assistant.id, assistant };
    }
  };

  const assistant = {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1",
    draftDisplayName: null,
    draftInstructions: null,
    draftTraits: null,
    draftAvatarEmoji: null,
    draftAvatarUrl: null,
    draftAssistantGender: null,
    draftUpdatedAt: null,
    applyStatus: "succeeded" as const,
    applyTargetVersionId: null,
    applyAppliedVersionId: null,
    applyRequestedAt: null,
    applyStartedAt: null,
    applyFinishedAt: null,
    applyErrorCode: null,
    applyErrorMessage: null,
    configDirtyAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const integrationState = {
    schema: "persai.telegramIntegration.v1" as const,
    provider: "telegram" as const,
    surfaceType: "telegram_bot" as const,
    capabilityAllowed: true,
    connectionStatus: "claim_required" as const,
    bindingState: "active" as const,
    connectedAt: new Date().toISOString(),
    bot: {
      telegramUserId: 1,
      username: "bot",
      displayName: "Bot",
      avatarUrl: null,
      ownerTelegramUserId: 11,
      ownerTelegramUsername: "alex",
      ownerTelegramChatId: "chat-1"
    },
    tokenHint: {
      lastFour: "1234"
    },
    ownerClaim: {
      required: true,
      status: "pending" as const,
      code: "214930",
      claimIssuedAt: new Date().toISOString(),
      claimExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      claimedAt: null,
      systemWelcomeSentAt: null
    },
    runtime: {
      health: "ok" as const,
      lastError: null,
      checkedAt: null
    },
    secretLifecycle: {
      status: "active" as const,
      refKey: "telegram_bot:assistant-1",
      manager: "backend_vault_kms" as const,
      version: 1,
      rotatedAt: null,
      expiresAt: null,
      revokedAt: null,
      emergencyRevokedAt: null,
      revokeReason: null,
      legacyFallbackUsed: false
    },
    configPanel: {
      available: true,
      settings: {
        autoCompactionEnabled: true,
        defaultParseMode: "plain_text" as const,
        inboundUserMessagesEnabled: true,
        outboundAssistantMessagesEnabled: true,
        groupReplyMode: "mention_reply" as const,
        notes: null
      }
    },
    notes: []
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    fetchCalls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null
    });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const service = new ResendTelegramOwnerMessageService(
      {
        findByAssistantId: async () => null,
        createBaseline: async () => ({
          id: "gov-1",
          assistantId: assistant.id,
          capabilityEnvelope: null,
          secretRefs: null,
          policyEnvelope: null,
          memoryControl: null,
          tasksControl: null,
          assistantPlanOverrideCode: null,
          quotaPlanCode: null,
          quotaHook: null,
          auditHook: null,
          createdAt: new Date(),
          updatedAt: new Date()
        })
      } as Pick<
        AssistantGovernanceRepository,
        "findByAssistantId" | "createBaseline"
      > as AssistantGovernanceRepository,
      {
        findByAssistantProviderSurface: async () => ({
          id: "binding-1",
          assistantId: assistant.id,
          providerKey: "telegram",
          surfaceType: "telegram_bot",
          bindingState: "active",
          tokenFingerprint: null,
          tokenLastFour: "1234",
          policy: null,
          config: null,
          metadata: {
            telegramOwnerClaimStatus: "pending",
            telegramOwnerTelegramChatId: "chat-1"
          },
          connectedAt: new Date(),
          disconnectedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        }),
        upsert: async () => {
          throw new Error("not used");
        },
        patchMetadata: async () => undefined,
        hasActiveBindingForProvider: async () => true
      } as AssistantChannelSurfaceBindingRepository,
      {
        execute: async () => integrationState
      } as Pick<
        ResolveTelegramIntegrationStateService,
        "execute"
      > as ResolveTelegramIntegrationStateService,
      {
        resolveSecretValueByProviderKey: async () => "123456:ABCDEF"
      } as Pick<
        PlatformRuntimeProviderSecretStoreService,
        "resolveSecretValueByProviderKey"
      > as PlatformRuntimeProviderSecretStoreService,
      {
        execute: async (event: Record<string, unknown>) => {
          auditEvents.push(event);
        }
      } as Pick<AppendAssistantAuditEventService, "execute"> as AppendAssistantAuditEventService,
      {
        workspace: {
          findUnique: async () => ({ locale: "ru" })
        }
      } as never,
      activeAssistantResolver as never
    );

    const result = await service.execute("user-1");
    assert.equal(result.ownerClaim.code, "214930");
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0]?.url, "https://api.telegram.org/bot123456:ABCDEF/sendMessage");
    assert.deepEqual(fetchCalls[0]?.body, {
      chat_id: "chat-1",
      text: "Чтобы подтвердить владельца ассистента, отправьте сюда актуальный 6-значный код из PersAI."
    });
    assert.equal(auditEvents.length, 1);

    const failingService = new ResendTelegramOwnerMessageService(
      {
        findByAssistantId: async () => null,
        createBaseline: async () => ({
          id: "gov-1",
          assistantId: assistant.id,
          capabilityEnvelope: null,
          secretRefs: null,
          policyEnvelope: null,
          memoryControl: null,
          tasksControl: null,
          assistantPlanOverrideCode: null,
          quotaPlanCode: null,
          quotaHook: null,
          auditHook: null,
          createdAt: new Date(),
          updatedAt: new Date()
        })
      } as Pick<
        AssistantGovernanceRepository,
        "findByAssistantId" | "createBaseline"
      > as AssistantGovernanceRepository,
      {
        findByAssistantProviderSurface: async () => ({
          id: "binding-1",
          assistantId: assistant.id,
          providerKey: "telegram",
          surfaceType: "telegram_bot",
          bindingState: "active",
          tokenFingerprint: null,
          tokenLastFour: "1234",
          policy: null,
          config: null,
          metadata: {
            telegramOwnerClaimStatus: "pending"
          },
          connectedAt: new Date(),
          disconnectedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        }),
        upsert: async () => {
          throw new Error("not used");
        },
        patchMetadata: async () => undefined,
        hasActiveBindingForProvider: async () => true
      } as AssistantChannelSurfaceBindingRepository,
      {
        execute: async () => integrationState
      } as Pick<
        ResolveTelegramIntegrationStateService,
        "execute"
      > as ResolveTelegramIntegrationStateService,
      {
        resolveSecretValueByProviderKey: async () => "123456:ABCDEF"
      } as Pick<
        PlatformRuntimeProviderSecretStoreService,
        "resolveSecretValueByProviderKey"
      > as PlatformRuntimeProviderSecretStoreService,
      {
        execute: async () => undefined
      } as Pick<AppendAssistantAuditEventService, "execute"> as AppendAssistantAuditEventService,
      {
        workspace: {
          findUnique: async () => ({ locale: "ru" })
        }
      } as never,
      activeAssistantResolver as never
    );

    await assert.rejects(
      () => failingService.execute("user-1"),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message ===
          "Telegram chat is not known yet. Open the bot chat and send any message first."
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run();
