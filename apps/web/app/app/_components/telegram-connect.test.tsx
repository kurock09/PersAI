import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";
import { TelegramConnect } from "./telegram-connect";
import type { TelegramIntegrationState } from "../assistant-api-client";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

const apiMocks = vi.hoisted(() => ({
  fetchAssistantTelegramGroups: vi.fn(),
  patchAssistantTelegramConfig: vi.fn(),
  postAssistantTelegramConnect: vi.fn(),
  postAssistantTelegramDisconnect: vi.fn(),
  postAssistantTelegramResendOwnerMessage: vi.fn(),
  postAssistantTelegramGroupsRefresh: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

vi.mock("./assistant-avatar", () => ({
  AssistantAvatar: () => <div data-testid="assistant-avatar" />
}));

vi.mock("../assistant-api-client", () => ({
  fetchAssistantTelegramGroups: apiMocks.fetchAssistantTelegramGroups,
  patchAssistantTelegramConfig: apiMocks.patchAssistantTelegramConfig,
  postAssistantTelegramConnect: apiMocks.postAssistantTelegramConnect,
  postAssistantTelegramDisconnect: apiMocks.postAssistantTelegramDisconnect,
  postAssistantTelegramResendOwnerMessage: apiMocks.postAssistantTelegramResendOwnerMessage,
  postAssistantTelegramGroupsRefresh: apiMocks.postAssistantTelegramGroupsRefresh
}));

function createIntegration(): TelegramIntegrationState {
  return {
    schema: "persai.telegramIntegration.v1",
    provider: "telegram",
    surfaceType: "telegram_bot",
    capabilityAllowed: true,
    connectionStatus: "connected",
    bindingState: "active",
    connectedAt: "2026-05-01T00:00:00.000Z",
    bot: {
      telegramUserId: 555,
      username: "test_bot",
      displayName: "Test Bot",
      avatarUrl: null,
      ownerTelegramUserId: 777,
      ownerTelegramUsername: "alex",
      ownerTelegramChatId: "12345"
    },
    tokenHint: {
      lastFour: "1234"
    },
    ownerClaim: {
      required: true,
      status: "claimed",
      code: null,
      claimIssuedAt: null,
      claimExpiresAt: null,
      claimedAt: "2026-05-01T00:00:00.000Z",
      systemWelcomeSentAt: "2026-05-01T00:00:00.000Z"
    },
    runtime: {
      health: "ok",
      lastError: null,
      checkedAt: null
    },
    secretLifecycle: {
      status: "active",
      refKey: "telegram_bot:assistant-1",
      manager: "backend_vault_kms",
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
        defaultParseMode: "plain_text",
        defaultDeepModeEnabled: false,
        inboundUserMessagesEnabled: true,
        outboundAssistantMessagesEnabled: true,
        telegramAccessMode: "owner_only",
        groupReplyMode: "mention_reply",
        notes: null
      }
    },
    notes: []
  };
}

function renderTelegramConnect(integration: TelegramIntegrationState = createIntegration()) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TelegramConnect
        integration={integration}
        capabilityAllowed
        assistantDisplayName="Assistant"
        onUpdated={vi.fn()}
      />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  clerkMocks.getToken.mockResolvedValue("token-1");
  apiMocks.fetchAssistantTelegramGroups.mockResolvedValue([]);
  apiMocks.patchAssistantTelegramConfig.mockResolvedValue(createIntegration());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TelegramConnect", () => {
  it("sends telegram access mode in the config patch", async () => {
    renderTelegramConnect();

    fireEvent.click(screen.getByRole("button", { name: "Configuration" }));
    fireEvent.click(screen.getByRole("button", { name: "Linked group members" }));
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));

    await waitFor(() => {
      expect(apiMocks.patchAssistantTelegramConfig).toHaveBeenCalledWith(
        "token-1",
        expect.objectContaining({
          telegramAccessMode: "group_members",
          groupReplyMode: "mention_reply"
        })
      );
    });
  });
});
