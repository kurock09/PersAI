import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ProviderGatewayToolExchange } from "@persai/runtime-contract";
import {
  resolvePendingBrowserLoginForWebChat,
  resolvePendingBrowserLoginFromRuntimeTurn
} from "../src/modules/workspace-management/application/resolve-pending-browser-login-for-web-chat";

describe("resolvePendingBrowserLoginFromRuntimeTurn", () => {
  test("maps runtime browser login tool exchanges to pendingBrowserLogin", () => {
    const pending = {
      profileId: "profile-1",
      profileKey: "bitrix",
      displayName: "Bitrix24",
      loginUrl: "https://example.bitrix24.ru/login",
      workspaceId: "workspace-1",
      bridgeClientKind: "extension" as const,
      completionMode: "login" as const
    };
    const toolExchanges: ProviderGatewayToolExchange[] = [
      {
        toolCall: {
          id: "tool-call-1",
          name: "browser",
          arguments: { action: "login" }
        },
        toolResult: {
          toolCallId: "tool-call-1",
          name: "browser",
          content: JSON.stringify({
            toolCode: "browser",
            action: "login",
            pendingBrowserLogin: pending
          }),
          isError: false
        }
      }
    ];

    assert.deepEqual(
      resolvePendingBrowserLoginFromRuntimeTurn({
        toolInvocations: [{ name: "browser", iteration: 0, ok: true, toolCallId: "tool-call-1" }],
        toolExchanges
      }),
      pending
    );
  });
});

describe("resolvePendingBrowserLoginForWebChat", () => {
  test("returns null when no pending profile remains", async () => {
    const resolved = await resolvePendingBrowserLoginForWebChat({
      browserProfileRepository: {
        findMostRecentPendingLoginForChat: async () => null
      },
      assistantId: "assistant-1",
      chatId: "chat-1"
    });

    assert.equal(resolved, null);
  });

  test("returns pending login from DB row without requiring latest tool exchange", async () => {
    const pending = {
      profileId: "profile-1",
      profileKey: "bitrix",
      displayName: "Bitrix24",
      loginUrl: "https://example.bitrix24.ru/login",
      workspaceId: "workspace-1",
      bridgeClientKind: "extension" as const,
      completionMode: "login" as const
    };

    const resolved = await resolvePendingBrowserLoginForWebChat({
      browserProfileRepository: {
        findMostRecentPendingLoginForChat: async () => ({
          id: pending.profileId,
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          profileKey: pending.profileKey,
          displayName: pending.displayName,
          loginUrl: pending.loginUrl,
          originHost: "example.bitrix24.ru",
          bridgeSessionRef: null,
          bridgeClientKind: "extension",
          originatingChatId: "chat-1",
          status: "pending_login",
          lastUsedAt: null,
          expiresAt: null,
          createdAt: new Date("2026-07-05T12:00:00.000Z"),
          updatedAt: new Date("2026-07-05T12:00:00.000Z")
        })
      },
      assistantId: "assistant-1",
      chatId: "chat-1"
    });

    assert.deepEqual(resolved, pending);
  });

  test("returns null when pending profile has no persisted bridge client kind", async () => {
    const resolved = await resolvePendingBrowserLoginForWebChat({
      browserProfileRepository: {
        findMostRecentPendingLoginForChat: async () => ({
          id: "profile-1",
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          profileKey: "bitrix",
          displayName: "Bitrix24",
          loginUrl: "https://example.bitrix24.ru/login",
          originHost: "example.bitrix24.ru",
          bridgeSessionRef: null,
          bridgeClientKind: null,
          originatingChatId: "chat-1",
          status: "pending_login",
          lastUsedAt: null,
          expiresAt: null,
          createdAt: new Date("2026-07-05T12:00:00.000Z"),
          updatedAt: new Date("2026-07-05T12:00:00.000Z")
        })
      },
      assistantId: "assistant-1",
      chatId: "chat-1"
    });

    assert.equal(resolved, null);
  });

  test("does not return pending login from a different chat", async () => {
    const resolved = await resolvePendingBrowserLoginForWebChat({
      browserProfileRepository: {
        findMostRecentPendingLoginForChat: async (_assistantId, chatId) =>
          chatId === "chat-1"
            ? {
                id: "profile-1",
                assistantId: "assistant-1",
                workspaceId: "workspace-1",
                profileKey: "bitrix",
                displayName: "Bitrix24",
                loginUrl: "https://example.bitrix24.ru/login",
                originHost: "example.bitrix24.ru",
                bridgeSessionRef: null,
                bridgeClientKind: "extension",
                originatingChatId: "chat-1",
                status: "pending_login",
                lastUsedAt: null,
                expiresAt: null,
                createdAt: new Date("2026-07-05T12:00:00.000Z"),
                updatedAt: new Date("2026-07-05T12:00:00.000Z")
              }
            : null
      },
      assistantId: "assistant-1",
      chatId: "chat-2"
    });

    assert.equal(resolved, null);
  });
});
