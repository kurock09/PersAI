import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type {
  LocalBrowserBridgeDeviceRegisterRequest,
  LocalBrowserBridgeWebSocketConnectRequest,
  LocalBrowserResult
} from "@persai/runtime-contract";
import type {
  BridgeCommandState,
  BridgeConnectionDescriptor,
  ForwardedCommandEnvelope,
  ForwardedCommandHandler
} from "../src/modules/browser-bridge/application/browser-bridge-coordinator.service";
import { BrowserBridgeRelayService } from "../src/modules/browser-bridge/application/browser-bridge-relay.service";

class FakeSocket {
  readonly sent: string[] = [];
  send(payload: string): void {
    this.sent.push(payload);
  }
  close(): void {}
}

/**
 * Shared Redis stand-in that both pods observe. This is deliberately synchronous so the relay's
 * fire-and-forget mirroring is observable within a test tick.
 */
class SharedBridgeState {
  readonly connections = new Map<string, BridgeConnectionDescriptor>();
  readonly scopes = new Map<string, Set<string>>();
  readonly commands = new Map<string, BridgeCommandState>();
  readonly handlers = new Map<string, ForwardedCommandHandler>();

  scopeKey(workspaceId: string, assistantId: string): string {
    return `${workspaceId}::${assistantId}`;
  }
}

class FakeCoordinatorForPod {
  private handler: ForwardedCommandHandler | null = null;

  constructor(
    readonly podId: string,
    private readonly shared: SharedBridgeState
  ) {}

  isEnabled(): boolean {
    return true;
  }

  setCommandHandler(handler: ForwardedCommandHandler): void {
    this.handler = handler;
    this.shared.handlers.set(this.podId, handler);
  }

  async ensureConnected(): Promise<boolean> {
    return true;
  }

  async registerConnection(descriptor: BridgeConnectionDescriptor): Promise<void> {
    this.shared.connections.set(descriptor.connectionKey, descriptor);
    const key = this.shared.scopeKey(descriptor.workspaceId, descriptor.assistantId);
    const set = this.shared.scopes.get(key) ?? new Set<string>();
    set.add(descriptor.connectionKey);
    this.shared.scopes.set(key, set);
  }

  async refreshConnection(descriptor: BridgeConnectionDescriptor): Promise<void> {
    await this.registerConnection(descriptor);
  }

  async removeConnection(
    connectionKey: string,
    workspaceId: string,
    assistantId: string
  ): Promise<void> {
    this.shared.connections.delete(connectionKey);
    this.shared.scopes.get(this.shared.scopeKey(workspaceId, assistantId))?.delete(connectionKey);
  }

  async listScopeConnections(
    workspaceId: string,
    assistantId: string
  ): Promise<BridgeConnectionDescriptor[]> {
    const set = this.shared.scopes.get(this.shared.scopeKey(workspaceId, assistantId)) ?? new Set();
    return [...set]
      .map((key) => this.shared.connections.get(key))
      .filter((value): value is BridgeConnectionDescriptor => value !== undefined);
  }

  async getConnection(connectionKey: string): Promise<BridgeConnectionDescriptor | null> {
    return this.shared.connections.get(connectionKey) ?? null;
  }

  async publishCommand(podId: string, envelope: ForwardedCommandEnvelope): Promise<boolean> {
    const handler = this.shared.handlers.get(podId);
    if (handler === undefined) {
      return false;
    }
    handler(envelope);
    return true;
  }

  async putCommandState(commandId: string, state: BridgeCommandState): Promise<void> {
    this.shared.commands.set(commandId, state);
  }

  async getCommandState(commandId: string): Promise<BridgeCommandState | null> {
    return this.shared.commands.get(commandId) ?? null;
  }

  async completeCommandState(commandId: string, result: LocalBrowserResult): Promise<void> {
    const existing = this.shared.commands.get(commandId);
    if (existing === undefined || existing.status === "completed") {
      return;
    }
    this.shared.commands.set(commandId, { ...existing, status: "completed", result });
  }

  async shutdown(): Promise<void> {
    this.shared.handlers.delete(this.podId);
  }
}

function buildRegisterRequest(): LocalBrowserBridgeDeviceRegisterRequest {
  return {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    deviceKind: "extension",
    deviceLabel: "Chrome",
    clientVersion: "1.0.0"
  };
}

function buildConnectRequest(
  register: ReturnType<BrowserBridgeRelayService["registerDevice"]>
): LocalBrowserBridgeWebSocketConnectRequest {
  return {
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    bridgeDeviceId: register.bridgeDeviceId,
    deviceKind: register.deviceKind,
    deviceToken: register.deviceToken
  };
}

describe("BrowserBridgeRelayService cross-pod (coordinator)", () => {
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

  test("dispatch on a pod without the socket reaches the owner pod and result is visible cross-pod", async () => {
    const shared = new SharedBridgeState();
    const coordinatorA = new FakeCoordinatorForPod("pod-A", shared);
    const coordinatorB = new FakeCoordinatorForPod("pod-B", shared);

    const relayA = new BrowserBridgeRelayService(coordinatorA as never);
    const relayB = new BrowserBridgeRelayService(coordinatorB as never);
    relayA.onModuleInit();
    relayB.onModuleInit();

    // Device connects to pod A only.
    const registration = relayA.registerDevice(
      buildRegisterRequest(),
      "wss://api.persai.dev/api/v1/assistant/browser-bridge/ws"
    );
    const socket = new FakeSocket();
    const connectionKey = relayA.attachConnection(buildConnectRequest(registration), socket);

    // Dispatch is handled by pod B, which does NOT hold the socket.
    const dispatch = await relayB.dispatchCommand({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      command: { commandId: "command-x", profileKey: "crm", action: "open_view", timeoutMs: 5_000 }
    });
    assert.deepEqual(dispatch, {
      accepted: true,
      commandId: "command-x",
      bridgeDeviceId: registration.bridgeDeviceId,
      deviceKind: "extension"
    });
    // The command was forwarded to pod A and delivered over its local socket.
    assert.equal(socket.sent.length, 1);

    // While in flight, pod B observes pending state.
    assert.deepEqual(await relayB.getCommandResult("command-x"), { status: "pending" });

    // Device answers on pod A; result becomes visible to pod B.
    assert.equal(
      relayA.acceptDeviceResult(connectionKey, {
        commandId: "command-x",
        ok: true,
        title: "CRM"
      }),
      true
    );
    assert.deepEqual(await relayB.getCommandResult("command-x"), {
      status: "completed",
      result: { commandId: "command-x", ok: true, title: "CRM" }
    });

    await relayA.onModuleDestroy();
    await relayB.onModuleDestroy();
  });

  test("strict current-surface dispatch does not fall back to another pod's device", async () => {
    const shared = new SharedBridgeState();
    const coordinatorA = new FakeCoordinatorForPod("pod-A", shared);
    const coordinatorB = new FakeCoordinatorForPod("pod-B", shared);
    const relayA = new BrowserBridgeRelayService(coordinatorA as never);
    const relayB = new BrowserBridgeRelayService(coordinatorB as never);
    relayA.onModuleInit();
    relayB.onModuleInit();

    const registration = relayA.registerDevice(
      buildRegisterRequest(),
      "wss://api.persai.dev/api/v1/assistant/browser-bridge/ws"
    );
    const socket = new FakeSocket();
    relayA.attachConnection(buildConnectRequest(registration), socket);

    const dispatch = await relayB.dispatchCommand({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      bridgeDeviceId: "disconnected-current-mobile",
      requireBridgeDeviceId: true,
      command: {
        commandId: "command-strict-cross-pod",
        profileKey: "crm",
        action: "snapshot"
      }
    });

    assert.equal(dispatch.accepted, false);
    if (!dispatch.accepted) {
      assert.equal(dispatch.code, "bridge_device_not_connected");
    }
    assert.equal(socket.sent.length, 0);

    await relayA.onModuleDestroy();
    await relayB.onModuleDestroy();
  });

  test("dispatch reports device_not_connected when the owner pod is gone", async () => {
    const shared = new SharedBridgeState();
    const coordinatorA = new FakeCoordinatorForPod("pod-A", shared);
    const coordinatorB = new FakeCoordinatorForPod("pod-B", shared);
    const relayA = new BrowserBridgeRelayService(coordinatorA as never);
    const relayB = new BrowserBridgeRelayService(coordinatorB as never);
    relayA.onModuleInit();
    relayB.onModuleInit();

    const registration = relayA.registerDevice(
      buildRegisterRequest(),
      "wss://api.persai.dev/api/v1/assistant/browser-bridge/ws"
    );
    relayA.attachConnection(buildConnectRequest(registration), new FakeSocket());

    // Simulate pod A vanishing: its command handler is no longer subscribed, but the registry
    // entry lingers until pruned.
    shared.handlers.delete("pod-A");

    const dispatch = await relayB.dispatchCommand({
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      command: { commandId: "command-y", profileKey: "crm", action: "open_view" }
    });
    assert.equal(dispatch.accepted, false);
    if (dispatch.accepted === false) {
      assert.equal(dispatch.code, "bridge_device_not_connected");
    }

    await relayA.onModuleDestroy();
    await relayB.onModuleDestroy();
  });
});
