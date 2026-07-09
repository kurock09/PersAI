import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type {
  LocalBrowserBridgeWebSocketConnectRequest,
  LocalBrowserBridgeDeviceRegisterRequest
} from "@persai/runtime-contract";
import { BrowserBridgeRelayService } from "../src/modules/browser-bridge/application/browser-bridge-relay.service";

class FakeSocket {
  readonly sent: string[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  closed = false;

  send(payload: string): void {
    if (this.closed) {
      throw new Error("socket_closed");
    }
    this.sent.push(payload);
  }

  close(code?: number, reason?: string): void {
    this.closed = true;
    this.closeCalls.push({ code, reason });
  }
}

function buildRegisterRequest(
  overrides: Partial<LocalBrowserBridgeDeviceRegisterRequest> = {}
): LocalBrowserBridgeDeviceRegisterRequest {
  return {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    deviceKind: "extension",
    deviceLabel: "Chrome",
    clientVersion: "1.0.0",
    ...overrides
  };
}

function buildConnectRequest(
  register: ReturnType<BrowserBridgeRelayService["registerDevice"]>,
  overrides: Partial<LocalBrowserBridgeWebSocketConnectRequest> = {}
): LocalBrowserBridgeWebSocketConnectRequest {
  return {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    bridgeDeviceId: register.bridgeDeviceId,
    deviceKind: register.deviceKind,
    deviceToken: register.deviceToken,
    ...overrides
  };
}

describe("BrowserBridgeRelayService", () => {
  const originalClerkSecretKey = process.env.CLERK_SECRET_KEY;

  beforeEach(() => {
    process.env.CLERK_SECRET_KEY = "test-clerk-secret-key-123456";
  });

  afterEach(() => {
    if (originalClerkSecretKey === undefined) {
      delete process.env.CLERK_SECRET_KEY;
    } else {
      process.env.CLERK_SECRET_KEY = originalClerkSecretKey;
    }
  });

  test("registers device, authenticates websocket, dispatches command, and completes result", async () => {
    const service = new BrowserBridgeRelayService();
    const registration = service.registerDevice(
      buildRegisterRequest(),
      "wss://api.persai.dev/api/v1/assistant/browser-bridge/ws"
    );
    assert.equal(registration.deviceKind, "extension");
    assert.match(registration.deviceToken, /^v1\./);

    const socket = new FakeSocket();
    const connectionKey = service.attachConnection(buildConnectRequest(registration), socket);
    const dispatch = await service.dispatchCommand({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      command: {
        commandId: "command-1",
        profileKey: "crm",
        action: "snapshot",
        timeoutMs: 5_000
      }
    });
    assert.deepEqual(dispatch, {
      accepted: true,
      commandId: "command-1",
      bridgeDeviceId: registration.bridgeDeviceId
    });
    assert.equal(socket.sent.length, 1);
    assert.deepEqual(JSON.parse(socket.sent[0] ?? "{}"), {
      commandId: "command-1",
      profileKey: "crm",
      action: "snapshot",
      timeoutMs: 5_000
    });

    assert.equal(
      service.acceptDeviceResult(connectionKey, {
        commandId: "command-1",
        ok: true,
        title: "CRM Dashboard",
        content: "Hello"
      }),
      true
    );
    assert.deepEqual(await service.getCommandResult("command-1"), {
      status: "completed",
      result: {
        commandId: "command-1",
        ok: true,
        title: "CRM Dashboard",
        content: "Hello"
      }
    });
  });

  test("rejects websocket connections with invalid device token", () => {
    const service = new BrowserBridgeRelayService();
    const registration = service.registerDevice(
      buildRegisterRequest(),
      "wss://api.persai.dev/api/v1/assistant/browser-bridge/ws"
    );
    const socket = new FakeSocket();

    assert.throws(() =>
      service.attachConnection(
        buildConnectRequest(registration, {
          deviceToken: `${registration.deviceToken}tampered`
        }),
        socket
      )
    );
  });

  test("returns structured unavailable when no device is connected", async () => {
    const service = new BrowserBridgeRelayService();

    assert.deepEqual(
      await service.dispatchCommand({
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        command: {
          commandId: "command-1",
          profileKey: "crm",
          action: "snapshot"
        }
      }),
      {
        accepted: false,
        commandId: "command-1",
        code: "bridge_unavailable",
        message: "No active browser bridge device is connected for this assistant.",
        activeBridgeDeviceIds: []
      }
    );
  });

  test("times out pending commands and exposes completed timeout result", async () => {
    const service = new BrowserBridgeRelayService();
    const registration = service.registerDevice(
      buildRegisterRequest(),
      "wss://api.persai.dev/api/v1/assistant/browser-bridge/ws"
    );
    service.attachConnection(buildConnectRequest(registration), new FakeSocket());

    const dispatch = await service.dispatchCommand({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      command: {
        commandId: "command-timeout",
        profileKey: "crm",
        action: "snapshot",
        timeoutMs: 1
      }
    });
    assert.equal(dispatch.accepted, true);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(await service.getCommandResult("command-timeout"), {
      status: "completed",
      result: {
        commandId: "command-timeout",
        ok: false,
        errorReason: "bridge_command_timeout"
      }
    });
  });

  test("replaces duplicate connection honestly and fails in-flight command on disconnect", async () => {
    const service = new BrowserBridgeRelayService();
    const registration = service.registerDevice(
      buildRegisterRequest(),
      "wss://api.persai.dev/api/v1/assistant/browser-bridge/ws"
    );
    const firstSocket = new FakeSocket();
    service.attachConnection(buildConnectRequest(registration), firstSocket);
    const firstDispatch = await service.dispatchCommand({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      command: {
        commandId: "command-in-flight",
        profileKey: "crm",
        action: "snapshot"
      }
    });
    assert.equal(firstDispatch.accepted, true);

    const secondSocket = new FakeSocket();
    service.attachConnection(buildConnectRequest(registration), secondSocket);
    assert.deepEqual(firstSocket.closeCalls, [
      { code: 4002, reason: "duplicate_connection_replaced" }
    ]);
    assert.deepEqual(await service.getCommandResult("command-in-flight"), {
      status: "completed",
      result: {
        commandId: "command-in-flight",
        ok: false,
        errorReason: "bridge_connection_closed"
      }
    });

    const secondDispatch = await service.dispatchCommand({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      command: {
        commandId: "command-new",
        profileKey: "crm",
        action: "snapshot"
      }
    });
    assert.equal(secondDispatch.accepted, true);
    assert.equal(secondSocket.sent.length, 1);
  });

  test("falls back to the sole live connection when a stale bridgeDeviceId is requested", async () => {
    // A DB-stored bridgeSessionRef goes stale the moment the device
    // reconnects with a new id (token refresh, extension restart). Callers
    // like openLiveView pass that stale id as a *preference* — dispatch must
    // still succeed against the one connection that is actually live instead
    // of hard-failing with bridge_device_not_connected.
    const service = new BrowserBridgeRelayService();
    const registration = service.registerDevice(
      buildRegisterRequest(),
      "wss://api.persai.dev/api/v1/assistant/browser-bridge/ws"
    );
    const socket = new FakeSocket();
    service.attachConnection(buildConnectRequest(registration), socket);

    const dispatch = await service.dispatchCommand({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      bridgeDeviceId: "some-stale-device-id-from-a-previous-session",
      command: {
        commandId: "command-stale-pref",
        profileKey: "crm",
        action: "open_view"
      }
    });
    assert.deepEqual(dispatch, {
      accepted: true,
      commandId: "command-stale-pref",
      bridgeDeviceId: registration.bridgeDeviceId
    });
    assert.equal(socket.sent.length, 1);
  });

  test("still reports bridge_device_ambiguous for a stale id when multiple devices are live", async () => {
    const service = new BrowserBridgeRelayService();
    const registrationA = service.registerDevice(
      buildRegisterRequest({ deviceLabel: "Chrome A" }),
      "wss://api.persai.dev/api/v1/assistant/browser-bridge/ws"
    );
    const registrationB = service.registerDevice(
      buildRegisterRequest({ deviceLabel: "Chrome B" }),
      "wss://api.persai.dev/api/v1/assistant/browser-bridge/ws"
    );
    service.attachConnection(buildConnectRequest(registrationA), new FakeSocket());
    service.attachConnection(buildConnectRequest(registrationB), new FakeSocket());

    const dispatch = await service.dispatchCommand({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      bridgeDeviceId: "some-stale-device-id-from-a-previous-session",
      command: {
        commandId: "command-stale-ambiguous",
        profileKey: "crm",
        action: "open_view"
      }
    });
    assert.equal(dispatch.accepted, false);
    if (dispatch.accepted === false) {
      assert.equal(dispatch.code, "bridge_device_ambiguous");
    }
  });
});
