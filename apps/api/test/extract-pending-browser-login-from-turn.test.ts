import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ProviderGatewayToolExchange } from "@persai/runtime-contract";
import {
  appendTelegramBrowserLoginLink,
  extractPendingBrowserLoginFromTurn,
  parsePendingBrowserLoginState
} from "../src/modules/workspace-management/application/extract-pending-browser-login-from-turn";

const pending = {
  profileId: "profile-1",
  profileKey: "bitrix",
  displayName: "Bitrix24",
  liveUrl: "https://browserless.example/live/bitrix",
  loginUrl: "https://example.bitrix24.ru/login"
};

function browserLoginExchange(content: Record<string, unknown>): ProviderGatewayToolExchange {
  return {
    toolCall: {
      id: "tool-call-1",
      name: "browser",
      arguments: { action: "login", displayName: "Bitrix24", url: pending.loginUrl }
    },
    toolResult: {
      toolCallId: "tool-call-1",
      name: "browser",
      content: JSON.stringify(content),
      isError: false
    }
  };
}

describe("extractPendingBrowserLoginFromTurn", () => {
  test("returns null when tool exchanges are absent", () => {
    assert.equal(extractPendingBrowserLoginFromTurn([], undefined), null);
  });

  test("parses pendingBrowserLogin from browser login tool result payload", () => {
    const result = extractPendingBrowserLoginFromTurn(
      [{ name: "browser", iteration: 0, ok: true, toolCallId: "tool-call-1" }],
      [
        browserLoginExchange({
          toolCode: "browser",
          action: "login",
          pendingBrowserLogin: pending
        })
      ]
    );
    assert.deepEqual(result, pending);
  });

  test("ignores failed browser login invocations", () => {
    const result = extractPendingBrowserLoginFromTurn(
      [{ name: "browser", iteration: 0, ok: false, toolCallId: "tool-call-1" }],
      [
        browserLoginExchange({
          toolCode: "browser",
          action: "login",
          pendingBrowserLogin: pending
        })
      ]
    );
    assert.equal(result, null);
  });

  test("ignores browser login exchange when no matching browser invocation succeeded", () => {
    const result = extractPendingBrowserLoginFromTurn(
      [{ name: "files", iteration: 0, ok: true, toolCallId: "tool-call-2" }],
      [
        browserLoginExchange({
          toolCode: "browser",
          action: "login",
          pendingBrowserLogin: pending
        })
      ]
    );
    assert.equal(result, null);
  });

  test("uses the latest successful browser login exchange", () => {
    const older = {
      ...pending,
      profileId: "profile-old",
      profileKey: "old",
      liveUrl: "https://browserless.example/live/old"
    };
    const result = extractPendingBrowserLoginFromTurn(
      [
        { name: "browser", iteration: 0, ok: true, toolCallId: "tool-call-1" },
        { name: "browser", iteration: 1, ok: true, toolCallId: "tool-call-2" }
      ],
      [
        browserLoginExchange({
          toolCode: "browser",
          action: "login",
          pendingBrowserLogin: older
        }),
        {
          ...browserLoginExchange({
            toolCode: "browser",
            action: "login",
            pendingBrowserLogin: pending
          }),
          toolCall: {
            id: "tool-call-2",
            name: "browser",
            arguments: { action: "login" }
          },
          toolResult: {
            toolCallId: "tool-call-2",
            name: "browser",
            content: JSON.stringify({
              toolCode: "browser",
              action: "login",
              pendingBrowserLogin: pending
            }),
            isError: false
          }
        }
      ]
    );
    assert.deepEqual(result, pending);
  });

  test("parses pendingBrowserLogin from non-login browser recovery payloads", () => {
    const result = extractPendingBrowserLoginFromTurn(
      [{ name: "browser", iteration: 0, ok: true, toolCallId: "tool-call-1" }],
      [
        {
          toolCall: {
            id: "tool-call-1",
            name: "browser",
            arguments: {
              action: "snapshot",
              profile: pending.profileKey,
              url: "https://crm.example"
            }
          },
          toolResult: {
            toolCallId: "tool-call-1",
            name: "browser",
            content: JSON.stringify({
              toolCode: "browser",
              action: "skipped",
              reason: "browser_profile_needs_user_reauth",
              pendingBrowserLogin: pending
            }),
            isError: false
          }
        }
      ]
    );
    assert.deepEqual(result, pending);
  });

  test("parsePendingBrowserLoginState rejects partial payloads", () => {
    assert.equal(parsePendingBrowserLoginState({ profileKey: "bitrix" }), null);
  });
});

describe("appendTelegramBrowserLoginLink", () => {
  test("appends PersAI web-login instructions instead of a live URL", () => {
    assert.equal(
      appendTelegramBrowserLoginLink("en", "I'll open the login page.", pending),
      'I\'ll open the login page.\n\nTo continue login for "Bitrix24", open PersAI on the web: https://persai.dev'
    );
  });
});
