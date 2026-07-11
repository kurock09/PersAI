import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeBrowserPreviewEvent } from "../browser-bridge-client";
import { NativeBrowserPreview } from "./native-browser-preview";

const bridgeMocks = vi.hoisted(() => ({
  native: true,
  listener: null as ((event: NativeBrowserPreviewEvent) => void) | null,
  remove: vi.fn(),
  show: vi.fn()
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

vi.mock("../browser-bridge-client", () => ({
  isNativeBrowserBridgeShell: () => bridgeMocks.native,
  subscribeNativeBrowserPreview: async (listener: (event: NativeBrowserPreviewEvent) => void) => {
    bridgeMocks.listener = listener;
    return bridgeMocks.remove;
  },
  showNativeBrowserBridgeView: (...args: unknown[]) => bridgeMocks.show(...args)
}));

describe("NativeBrowserPreview", () => {
  beforeEach(() => {
    bridgeMocks.native = true;
    bridgeMocks.listener = null;
    bridgeMocks.remove.mockReset();
    bridgeMocks.remove.mockResolvedValue(undefined);
    bridgeMocks.show.mockReset();
    bridgeMocks.show.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders native preview updates and opens the retained browser on tap", async () => {
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
    expect(preview).toHaveStyle({ width: "clamp(9rem, 38vw, 22rem)" });

    fireEvent.click(preview);
    expect(bridgeMocks.show).toHaveBeenCalledWith("mail");
  });

  it("never renders on desktop web", async () => {
    bridgeMocks.native = false;
    render(<NativeBrowserPreview />);
    await act(async () => undefined);

    expect(screen.queryByTestId("native-browser-preview")).not.toBeInTheDocument();
    expect(bridgeMocks.listener).toBeNull();
  });
});
