import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserLoginModal } from "./browser-login-modal";

const completeAssistantBrowserLogin = vi.fn();
const dismissAssistantBrowserProfileView = vi.fn();
const openAssistantBrowserProfileView = vi.fn();
const getExtensionBridgeStatus = vi.fn();
const registerExtensionBridgeDevice = vi.fn();
const registerNativeBrowserBridgeDevice = vi.fn();
const isNativeBrowserBridgeShell = vi.fn(() => false);

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue("test-token")
  })
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

vi.mock("./use-history-back-to-close", () => ({
  useHistoryBackToClose: () => undefined
}));

vi.mock("../assistant-api-client", () => ({
  completeAssistantBrowserLogin: (...args: unknown[]) => completeAssistantBrowserLogin(...args),
  dismissAssistantBrowserProfileView: (...args: unknown[]) =>
    dismissAssistantBrowserProfileView(...args),
  openAssistantBrowserProfileView: (...args: unknown[]) => openAssistantBrowserProfileView(...args)
}));

vi.mock("../browser-bridge-client", () => ({
  getExtensionBridgeStatus: (...args: unknown[]) => getExtensionBridgeStatus(...args),
  registerExtensionBridgeDevice: (...args: unknown[]) => registerExtensionBridgeDevice(...args),
  registerNativeBrowserBridgeDevice: (...args: unknown[]) =>
    registerNativeBrowserBridgeDevice(...args),
  hideNativeBrowserBridgeView: vi.fn().mockResolvedValue(undefined),
  showNativeBrowserBridgeView: vi.fn().mockResolvedValue(undefined),
  isNativeBrowserBridgeShell: () => isNativeBrowserBridgeShell(),
  PERSAI_BROWSER_BRIDGE_WEB_STORE_URL: null
}));

const pendingBrowserLogin = {
  profileId: "profile-1",
  profileKey: "bitrix",
  displayName: "Bitrix24",
  loginUrl: "https://bitrix.example/login",
  workspaceId: "workspace-1",
  bridgeClientKind: "extension" as const
};

describe("BrowserLoginModal", () => {
  afterEach(() => {
    cleanup();
    completeAssistantBrowserLogin.mockReset();
    dismissAssistantBrowserProfileView.mockReset();
    openAssistantBrowserProfileView.mockReset();
    getExtensionBridgeStatus.mockReset();
    registerExtensionBridgeDevice.mockReset();
    registerNativeBrowserBridgeDevice.mockReset();
    isNativeBrowserBridgeShell.mockReset();
    isNativeBrowserBridgeShell.mockReturnValue(false);
  });

  it("shows a compact retry block when the desktop extension is unavailable", async () => {
    getExtensionBridgeStatus.mockRejectedValue(new Error("missing"));

    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={pendingBrowserLogin}
        onDismiss={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByTestId("browser-login-modal")).toBeInTheDocument();
    expect(await screen.findByTestId("browser-login-extension-status")).toBeInTheDocument();
    expect(screen.queryByTestId("browser-login-extension-cta")).not.toBeInTheDocument();
    expect(screen.getByText("browserLoginExtensionUnavailable")).toBeInTheDocument();
    expect(screen.getByText("browserLoginExtensionInstallHint")).toBeInTheDocument();
    expect(screen.getByText("browserLoginCheckBridge")).toBeInTheDocument();
    expect(screen.getByTestId("browser-login-complete")).toBeDisabled();
  });

  it("keeps a compact web modal visible and opens the desktop bridge window only by user action", async () => {
    getExtensionBridgeStatus.mockResolvedValue({
      connected: true,
      desiredConnection: true,
      bridgeDeviceId: "device-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileCount: 1,
      lastProfileKey: "bitrix"
    });
    openAssistantBrowserProfileView.mockResolvedValue(undefined);

    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={pendingBrowserLogin}
        onDismiss={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(await screen.findByTestId("browser-login-modal")).toBeInTheDocument();
    expect(await screen.findByTestId("browser-login-open-bridge-view")).toBeInTheDocument();
    expect(screen.queryByTestId("browser-login-extension-status")).not.toBeInTheDocument();
    expect(screen.getByText("browserLoginOpenSiteHint")).toBeInTheDocument();
    expect(openAssistantBrowserProfileView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("browser-login-open-bridge-view"));

    await waitFor(() => {
      // The modal targets its own connected bridge device so the server never
      // has to guess between multiple connected surfaces.
      expect(openAssistantBrowserProfileView).toHaveBeenCalledWith(
        "test-token",
        "assistant-1",
        "profile-1",
        "device-1",
        { signal: expect.any(Object) }
      );
    });
    expect(screen.getByTestId("browser-login-modal")).toBeInTheDocument();
    expect(screen.getByText("browserLoginBridgeWindowOpened")).toBeInTheDocument();
  });

  it("keeps the full instructions behind the help toggle", async () => {
    getExtensionBridgeStatus.mockRejectedValue(new Error("missing"));

    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={pendingBrowserLogin}
        onDismiss={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await screen.findByTestId("browser-login-extension-status");
    expect(screen.queryByTestId("browser-login-instructions")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("browser-login-help-toggle"));
    expect(screen.getByTestId("browser-login-instructions")).toBeInTheDocument();
    expect(screen.getByText("browserLoginHowItWorks")).toBeInTheDocument();
  });

  it("keeps Done disabled when the extension is installed but not connected", async () => {
    registerExtensionBridgeDevice.mockRejectedValue(new Error("registration failed"));
    getExtensionBridgeStatus.mockResolvedValue({
      connected: false,
      desiredConnection: true,
      bridgeDeviceId: "device-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileCount: 1,
      lastProfileKey: "bitrix"
    });

    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={pendingBrowserLogin}
        onDismiss={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(await screen.findByText("browserLoginExtensionInstalled")).toBeInTheDocument();
    expect(screen.getByTestId("browser-login-complete")).toBeDisabled();

    fireEvent.click(screen.getByTestId("browser-login-complete"));
    expect(completeAssistantBrowserLogin).not.toHaveBeenCalled();
    expect(dismissAssistantBrowserProfileView).not.toHaveBeenCalled();
  });

  it("uses the native bridge on mobile without rendering extension recovery UI", async () => {
    isNativeBrowserBridgeShell.mockReturnValue(true);
    registerNativeBrowserBridgeDevice.mockResolvedValue({
      connected: true,
      desiredConnection: true,
      bridgeDeviceId: "mobile-device-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileCount: 1,
      lastProfileKey: "bitrix"
    });

    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={{
          ...pendingBrowserLogin,
          bridgeClientKind: "capacitor"
        }}
        onDismiss={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(registerNativeBrowserBridgeDevice).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("browser-login-extension-status")).not.toBeInTheDocument();
    expect(getExtensionBridgeStatus).not.toHaveBeenCalled();
  });

  it("keeps a working web Done fallback when the branded window fails to open", async () => {
    getExtensionBridgeStatus.mockResolvedValue({
      connected: true,
      desiredConnection: true,
      bridgeDeviceId: "device-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileCount: 1,
      lastProfileKey: "bitrix"
    });
    // The branded Chrome window could not be opened, so the web dialog stays
    // visible as a fallback and its Done button still completes the login.
    openAssistantBrowserProfileView.mockRejectedValue(new Error("open failed"));
    completeAssistantBrowserLogin.mockResolvedValue({});
    const onCompleted = vi.fn();
    const onDismiss = vi.fn();

    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={pendingBrowserLogin}
        onDismiss={onDismiss}
        onCancel={vi.fn()}
        onCompleted={onCompleted}
      />
    );

    await screen.findByText("browserLoginExtensionConnected");
    fireEvent.click(screen.getByTestId("browser-login-complete"));

    await waitFor(() => {
      expect(completeAssistantBrowserLogin).toHaveBeenCalledWith(
        "test-token",
        "assistant-1",
        "profile-1",
        "device-1"
      );
    });
    expect(onCompleted).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("dismisses live view in assist mode when Done is pressed", async () => {
    getExtensionBridgeStatus.mockResolvedValue({
      connected: true,
      desiredConnection: true,
      bridgeDeviceId: "device-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileCount: 1,
      lastProfileKey: "bitrix"
    });
    dismissAssistantBrowserProfileView.mockResolvedValue(undefined);
    const onCompleted = vi.fn();
    const onDismiss = vi.fn();

    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={{ ...pendingBrowserLogin, completionMode: "assist" }}
        onDismiss={onDismiss}
        onCancel={vi.fn()}
        onCompleted={onCompleted}
      />
    );

    await screen.findByText("browserLoginExtensionConnected");
    fireEvent.click(screen.getByTestId("browser-login-complete"));

    await waitFor(() => {
      expect(dismissAssistantBrowserProfileView).toHaveBeenCalledWith(
        "test-token",
        "assistant-1",
        "profile-1"
      );
    });
    expect(completeAssistantBrowserLogin).not.toHaveBeenCalled();
    expect(onCompleted).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("dismisses assist mode on header close without calling cancel", async () => {
    dismissAssistantBrowserProfileView.mockResolvedValue(undefined);
    const onDismiss = vi.fn();
    const onCancel = vi.fn();

    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={{ ...pendingBrowserLogin, completionMode: "assist" }}
        onDismiss={onDismiss}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByLabelText("browserLoginClose"));
    await waitFor(() => {
      expect(dismissAssistantBrowserProfileView).toHaveBeenCalledWith(
        "test-token",
        "assistant-1",
        "profile-1"
      );
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(openAssistantBrowserProfileView).not.toHaveBeenCalled();
  });

  it("cancels from footer without dismiss", () => {
    const onDismiss = vi.fn();
    const onCancel = vi.fn();

    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={pendingBrowserLogin}
        onDismiss={onDismiss}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByText("browserLoginCancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(openAssistantBrowserProfileView).not.toHaveBeenCalled();
  });

  it("aborts an in-flight desktop open before cancelling login", async () => {
    getExtensionBridgeStatus.mockResolvedValue({
      connected: true,
      desiredConnection: true,
      bridgeDeviceId: "device-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      profileCount: 1,
      lastProfileKey: "bitrix"
    });
    let openSignal: AbortSignal | undefined;
    openAssistantBrowserProfileView.mockImplementation(
      async (...args: unknown[]) =>
        await new Promise<void>((_resolve, reject) => {
          openSignal = (args[4] as { signal?: AbortSignal } | undefined)?.signal;
          openSignal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );
    const onCancel = vi.fn();

    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={pendingBrowserLogin}
        onDismiss={vi.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.click(await screen.findByTestId("browser-login-open-bridge-view"));
    await waitFor(() => expect(openSignal).toBeDefined());
    fireEvent.click(screen.getByText("browserLoginCancel"));

    expect(openSignal?.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels assist mode via dismiss-view semantics", async () => {
    dismissAssistantBrowserProfileView.mockResolvedValue(undefined);
    const onDismiss = vi.fn();
    const onCancel = vi.fn();

    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={{ ...pendingBrowserLogin, completionMode: "assist" }}
        onDismiss={onDismiss}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByText("browserLoginCancel"));

    await waitFor(() => {
      expect(dismissAssistantBrowserProfileView).toHaveBeenCalledWith(
        "test-token",
        "assistant-1",
        "profile-1"
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
