import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeBrowserPreviewEvent } from "../browser-bridge-client";
import { NativeBrowserPreview } from "./native-browser-preview";

const bridgeMocks = vi.hoisted(() => ({
  native: true,
  listener: null as ((event: NativeBrowserPreviewEvent) => void) | null,
  remove: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  backHandlers: [] as Array<{ handler: () => void; priority: number }>
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

vi.mock("./back-handler-stack", () => ({
  pushBackHandler: (handler: () => void, options?: { priority?: number }) => {
    const entry = { handler, priority: options?.priority ?? 0 };
    bridgeMocks.backHandlers.push(entry);
    return () => {
      const index = bridgeMocks.backHandlers.lastIndexOf(entry);
      if (index !== -1) {
        bridgeMocks.backHandlers.splice(index, 1);
      }
    };
  }
}));

vi.mock("../browser-bridge-client", () => ({
  isNativeBrowserBridgeShell: () => bridgeMocks.native,
  subscribeNativeBrowserPreview: async (listener: (event: NativeBrowserPreviewEvent) => void) => {
    bridgeMocks.listener = listener;
    return bridgeMocks.remove;
  },
  showNativeBrowserBridgeView: (...args: unknown[]) => bridgeMocks.show(...args),
  hideNativeBrowserBridgeView: (...args: unknown[]) => bridgeMocks.hide(...args)
}));

describe("NativeBrowserPreview", () => {
  beforeEach(() => {
    bridgeMocks.native = true;
    bridgeMocks.listener = null;
    bridgeMocks.backHandlers = [];
    bridgeMocks.remove.mockReset();
    bridgeMocks.remove.mockResolvedValue(undefined);
    bridgeMocks.show.mockReset();
    bridgeMocks.show.mockResolvedValue(undefined);
    bridgeMocks.hide.mockReset();
    bridgeMocks.hide.mockResolvedValue(undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders native preview updates in the top-right and opens the retained browser on tap", async () => {
    render(<NativeBrowserPreview />);
    await act(async () => undefined);

    act(() => {
      bridgeMocks.listener?.({
        phase: "update",
        profileKey: "mail",
        pageUrl: "https://mail.ru/inbox",
        imageDataUrl: "data:image/jpeg;base64,preview"
      });
    });

    const preview = screen.getByTestId("native-browser-preview");
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveStyle({
      width: "clamp(9rem, 38vw, 22rem)",
      top: "calc(0.875rem + env(safe-area-inset-top))"
    });

    fireEvent.click(preview);
    await act(async () => undefined);
    expect(bridgeMocks.show).toHaveBeenCalledWith("mail");
    expect(bridgeMocks.backHandlers).toHaveLength(1);
  });

  it("does not hide immediately when the assistant run ends", async () => {
    render(<NativeBrowserPreview />);
    await act(async () => undefined);

    act(() => {
      bridgeMocks.listener?.({
        phase: "update",
        profileKey: "mail",
        pageUrl: "https://mail.ru/inbox",
        imageDataUrl: "data:image/jpeg;base64,preview"
      });
    });
    expect(screen.getByTestId("native-browser-preview")).toBeInTheDocument();

    act(() => {
      bridgeMocks.listener?.({
        phase: "end",
        profileKey: "mail",
        pageUrl: "https://mail.ru/inbox",
        imageDataUrl: null
      });
    });
    expect(screen.getByTestId("native-browser-preview")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(screen.getByTestId("native-browser-preview")).toBeInTheDocument();
  });

  it("uses native favicon data when provided", async () => {
    render(<NativeBrowserPreview />);
    await act(async () => undefined);

    act(() => {
      bridgeMocks.listener?.({
        phase: "update",
        profileKey: "mail",
        pageUrl: "https://mail.ru/inbox",
        imageDataUrl: "data:image/jpeg;base64,preview",
        faviconDataUrl: "data:image/png;base64,favicon"
      });
    });

    const favicon = screen.getByTestId("native-browser-preview").querySelector("span img");
    expect(favicon).toHaveAttribute("src", "data:image/png;base64,favicon");
  });

  it("never renders on desktop web", async () => {
    bridgeMocks.native = false;
    render(<NativeBrowserPreview />);
    await act(async () => undefined);

    expect(screen.queryByTestId("native-browser-preview")).not.toBeInTheDocument();
    expect(bridgeMocks.listener).toBeNull();
  });
});
