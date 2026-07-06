import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserLoginModal } from "./browser-login-modal";

const completeAssistantBrowserLogin = vi.fn();

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
  completeAssistantBrowserLogin: (...args: unknown[]) => completeAssistantBrowserLogin(...args)
}));

const pendingBrowserLogin = {
  profileId: "profile-1",
  profileKey: "bitrix",
  displayName: "Bitrix24",
  liveUrl: "https://browserless.example/live",
  loginUrl: "https://bitrix.example/login"
};

describe("BrowserLoginModal", () => {
  afterEach(() => {
    cleanup();
    completeAssistantBrowserLogin.mockReset();
  });

  it("renders iframe and complete button when open", () => {
    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={pendingBrowserLogin}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId("browser-login-modal")).toBeInTheDocument();
    expect(screen.getByTestId("browser-login-iframe")).toHaveAttribute(
      "src",
      pendingBrowserLogin.liveUrl
    );
    expect(screen.getByTestId("browser-login-complete")).toHaveTextContent("browserLoginDone");
  });

  it("reloads iframe when reload is pressed", () => {
    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={pendingBrowserLogin}
        onClose={vi.fn()}
      />
    );

    const iframe = screen.getByTestId("browser-login-iframe");
    fireEvent.click(screen.getByTestId("browser-login-reload"));
    expect(screen.getByTestId("browser-login-iframe")).not.toBe(iframe);
  });

  it("calls complete login API when Done is pressed", async () => {
    completeAssistantBrowserLogin.mockResolvedValue({});
    const onCompleted = vi.fn();
    const onClose = vi.fn();

    render(
      <BrowserLoginModal
        open
        assistantId="assistant-1"
        pendingBrowserLogin={pendingBrowserLogin}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    );

    fireEvent.click(screen.getByTestId("browser-login-complete"));

    await waitFor(() => {
      expect(completeAssistantBrowserLogin).toHaveBeenCalledWith(
        "test-token",
        "assistant-1",
        "profile-1"
      );
    });
    expect(onCompleted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
