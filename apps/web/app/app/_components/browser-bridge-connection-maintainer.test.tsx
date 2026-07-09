import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserBridgeConnectionMaintainer } from "./browser-bridge-connection-maintainer";

const getExtensionBridgeStatus = vi.fn();
const registerExtensionBridgeDevice = vi.fn();
const registerNativeBrowserBridgeDevice = vi.fn();

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue("test-token"),
    isLoaded: true,
    isSignedIn: true
  })
}));

vi.mock("../browser-bridge-client", () => ({
  getExtensionBridgeStatus: (...args: unknown[]) => getExtensionBridgeStatus(...args),
  isNativeBrowserBridgeShell: () => false,
  registerExtensionBridgeDevice: (...args: unknown[]) => registerExtensionBridgeDevice(...args),
  registerNativeBrowserBridgeDevice: (...args: unknown[]) =>
    registerNativeBrowserBridgeDevice(...args)
}));

describe("BrowserBridgeConnectionMaintainer", () => {
  afterEach(() => {
    cleanup();
    getExtensionBridgeStatus.mockReset();
    registerExtensionBridgeDevice.mockReset();
    registerNativeBrowserBridgeDevice.mockReset();
  });

  it("renews a disconnected extension registration outside the login modal", async () => {
    getExtensionBridgeStatus.mockResolvedValue({
      connected: false,
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    });
    registerExtensionBridgeDevice.mockResolvedValue({ connected: true });

    render(
      <BrowserBridgeConnectionMaintainer assistantId="assistant-1" workspaceId="workspace-1" />
    );

    await waitFor(() => {
      expect(registerExtensionBridgeDevice).toHaveBeenCalledWith({
        token: "test-token",
        assistantId: "assistant-1",
        workspaceId: "workspace-1"
      });
    });
  });

  it("does not churn a live matching extension connection", async () => {
    getExtensionBridgeStatus.mockResolvedValue({
      connected: true,
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    });

    render(
      <BrowserBridgeConnectionMaintainer assistantId="assistant-1" workspaceId="workspace-1" />
    );

    await waitFor(() => {
      expect(getExtensionBridgeStatus).toHaveBeenCalled();
    });
    expect(registerExtensionBridgeDevice).not.toHaveBeenCalled();
  });
});
