import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageLightbox } from "./image-lightbox";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

vi.mock("./use-history-back-to-close", () => ({
  useHistoryBackToClose: () => undefined
}));

describe("ImageLightbox", () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as { PersaiNative?: unknown }).PersaiNative;
    vi.unstubAllGlobals();
  });

  it("renders modern save and share actions", () => {
    render(
      <ImageLightbox
        open
        src="/api/attachment/image-1"
        downloadUrl="/api/attachment/image-1?download=1"
        filename="image.png"
        alt="Generated image"
        onClose={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: "lightboxSave" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lightboxShare" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lightboxClose" })).toBeInTheDocument();
  });

  it("shares the image file when Web Share supports files", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Blob(["image"], { type: "image/png" })))
    );
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: canShare
    });

    render(
      <ImageLightbox
        open
        src="/api/attachment/image-1"
        downloadUrl="/api/attachment/image-1?download=1"
        filename="image.png"
        alt="Generated image"
        onClose={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "lightboxShare" }));

    await waitFor(() => {
      expect(share).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "image.png",
          files: [expect.any(File)]
        })
      );
    });
  });

  it("prefers the native mobile bridge when available", async () => {
    const nativeShare = vi.fn().mockReturnValue(true);
    (
      window as unknown as { PersaiNative?: { shareMedia?: (payloadJson: string) => boolean } }
    ).PersaiNative = {
      shareMedia: nativeShare
    };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ImageLightbox
        open
        src="/api/attachment/image-1"
        downloadUrl="/api/attachment/image-1?download=1"
        filename="image.png"
        alt="Generated image"
        onClose={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "lightboxShare" }));

    await waitFor(() => {
      expect(nativeShare).toHaveBeenCalledWith(
        JSON.stringify({
          url: "http://localhost:3000/api/attachment/image-1?download=1",
          filename: "image.png",
          title: "image.png",
          userAgent: navigator.userAgent
        })
      );
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
