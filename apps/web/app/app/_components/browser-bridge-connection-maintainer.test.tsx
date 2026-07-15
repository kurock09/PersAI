import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserBridgeConnectionMaintainer } from "./browser-bridge-connection-maintainer";
import { StreamingThreadsProvider, useStreamingThreadsRegistry } from "./streaming-threads";

const getExtensionBridgeStatus = vi.fn();
const releaseLocalBrowserObserverLocks = vi.fn().mockResolvedValue(undefined);
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
  BRIDGE_REGISTRATION_RENEW_AFTER_MS: 3 * 60 * 60 * 1000,
  getExtensionBridgeStatus: (...args: unknown[]) => getExtensionBridgeStatus(...args),
  isNativeBrowserBridgeShell: () => false,
  releaseLocalBrowserObserverLocks: (...args: unknown[]) =>
    releaseLocalBrowserObserverLocks(...args),
  registerExtensionBridgeDevice: (...args: unknown[]) => registerExtensionBridgeDevice(...args),
  registerNativeBrowserBridgeDevice: (...args: unknown[]) =>
    registerNativeBrowserBridgeDevice(...args)
}));

function ObserverLifecycleHarness() {
  const { markStreaming } = useStreamingThreadsRegistry();
  return (
    <>
      <button type="button" onClick={() => markStreaming("assistant-1::thread-1", true)}>
        start
      </button>
      <button type="button" onClick={() => markStreaming("assistant-1::thread-1", false)}>
        finish
      </button>
      <BrowserBridgeConnectionMaintainer assistantId="assistant-1" workspaceId="workspace-1" />
    </>
  );
}

describe("BrowserBridgeConnectionMaintainer", () => {
  afterEach(() => {
    cleanup();
    getExtensionBridgeStatus.mockReset();
    releaseLocalBrowserObserverLocks.mockReset();
    releaseLocalBrowserObserverLocks.mockResolvedValue(undefined);
    registerExtensionBridgeDevice.mockReset();
    registerNativeBrowserBridgeDevice.mockReset();
    window.localStorage.clear();
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

  it("releases retained observer locks only after an active turn finishes", async () => {
    getExtensionBridgeStatus.mockResolvedValue({
      connected: true,
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    });

    render(
      <StreamingThreadsProvider>
        <ObserverLifecycleHarness />
      </StreamingThreadsProvider>
    );

    expect(releaseLocalBrowserObserverLocks).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    expect(releaseLocalBrowserObserverLocks).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "finish" }));

    await waitFor(() => {
      expect(releaseLocalBrowserObserverLocks).toHaveBeenCalledTimes(1);
    });
  });

  it("does not release while another PersAI tab still has an active turn", () => {
    getExtensionBridgeStatus.mockResolvedValue({
      connected: true,
      assistantId: "assistant-1",
      workspaceId: "workspace-1"
    });

    render(
      <StreamingThreadsProvider>
        <ObserverLifecycleHarness />
      </StreamingThreadsProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "start" }));
    window.localStorage.setItem(
      "persai:browser-observer-active:assistant-1:another-tab",
      String(Date.now())
    );
    fireEvent.click(screen.getByRole("button", { name: "finish" }));

    expect(releaseLocalBrowserObserverLocks).not.toHaveBeenCalled();
  });

  it("does not churn a live matching extension connection", async () => {
    getExtensionBridgeStatus.mockResolvedValue({
      connected: true,
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      registrationUpdatedAt: Date.now()
    });

    render(
      <BrowserBridgeConnectionMaintainer assistantId="assistant-1" workspaceId="workspace-1" />
    );

    await waitFor(() => {
      expect(getExtensionBridgeStatus).toHaveBeenCalled();
    });
    expect(registerExtensionBridgeDevice).not.toHaveBeenCalled();
  });

  it("renews credentials for a live connection before the token safe-age wall", async () => {
    getExtensionBridgeStatus.mockResolvedValue({
      connected: true,
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      registrationUpdatedAt: Date.now() - 3 * 60 * 60 * 1000 - 1_000
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
});
