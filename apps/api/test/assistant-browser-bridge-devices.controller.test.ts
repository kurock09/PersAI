import assert from "node:assert/strict";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { describe, test } from "node:test";
import type { RequestWithPlatformContext } from "../src/modules/platform-core/interface/http/request-http.types";
import { AssistantBrowserBridgeDevicesController } from "../src/modules/browser-bridge/interface/http/assistant-browser-bridge-devices.controller";

function buildRequest(
  overrides: Partial<RequestWithPlatformContext> = {}
): RequestWithPlatformContext {
  return {
    headers: {
      host: "api.persai.dev",
      "x-forwarded-proto": "https"
    },
    resolvedAppUser: {
      id: "user-1",
      clerkUserId: "clerk-user-1",
      email: "user@example.com",
      displayName: "User",
      birthday: null,
      gender: null,
      preferredLocale: "en",
      countryCode: "US"
    },
    ...overrides
  } as RequestWithPlatformContext;
}

describe("AssistantBrowserBridgeDevicesController", () => {
  test("registers a bridge device for an authenticated assistant workspace", async () => {
    const relayService = {
      registerDevice: (_input: unknown, websocketUrl: string) => ({
        bridgeDeviceId: "device-1",
        deviceKind: "extension" as const,
        deviceToken: "token-1",
        websocketUrl
      })
    };
    const resolveActiveAssistantService = {
      execute: async () => ({
        workspaceId: "workspace-1"
      })
    };
    const controller = new AssistantBrowserBridgeDevicesController(
      relayService as never,
      resolveActiveAssistantService as never
    );

    const result = await controller.registerDevice(buildRequest(), {
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      deviceKind: "extension",
      deviceLabel: "Chrome",
      clientVersion: "1.0.0"
    });

    assert.deepEqual(result, {
      bridgeDeviceId: "device-1",
      deviceKind: "extension",
      deviceToken: "token-1",
      websocketUrl: "wss://api.persai.dev/api/v1/assistant/browser-bridge/ws"
    });
  });

  test("rejects invalid device kind", async () => {
    const controller = new AssistantBrowserBridgeDevicesController(
      { registerDevice: () => ({}) } as never,
      { execute: async () => ({ workspaceId: "workspace-1" }) } as never
    );

    await assert.rejects(
      () =>
        controller.registerDevice(buildRequest(), {
          assistantId: "assistant-1",
          workspaceId: "workspace-1",
          deviceKind: "desktop"
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match(error.message, /deviceKind/);
        return true;
      }
    );
  });

  test("rejects unauthenticated registration requests", async () => {
    const controller = new AssistantBrowserBridgeDevicesController(
      { registerDevice: () => ({}) } as never,
      { execute: async () => ({ workspaceId: "workspace-1" }) } as never
    );

    await assert.rejects(
      () =>
        controller.registerDevice(
          buildRequest({
            resolvedAppUser: undefined
          }),
          {
            assistantId: "assistant-1",
            workspaceId: "workspace-1",
            deviceKind: "extension"
          }
        ),
      (error: unknown) => {
        assert.ok(error instanceof UnauthorizedException);
        assert.match(error.message, /Authenticated user context is missing/);
        return true;
      }
    );
  });
});
