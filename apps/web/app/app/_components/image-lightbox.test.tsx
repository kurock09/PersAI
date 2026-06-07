import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageLightbox } from "./image-lightbox";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

vi.mock("./use-history-back-to-close", () => ({
  useHistoryBackToClose: () => undefined
}));

function blockVideoAutoplay() {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    () => new Promise<void>(() => undefined)
  );
}

describe("ImageLightbox", () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as { PersaiNative?: unknown }).PersaiNative;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders modern save and share actions", () => {
    const { container } = render(
      <ImageLightbox
        open
        src="/api/assistant-file/file-ref-image-1"
        downloadUrl="/api/assistant-file/file-ref-image-1?download=1"
        filename="image.png"
        alt="Generated image"
        onClose={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: "lightboxSave" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lightboxShare" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lightboxClose" })).toBeInTheDocument();
    expect(container).not.toContainElement(screen.getByRole("dialog"));
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
        src="/api/assistant-file/file-ref-image-1"
        downloadUrl="/api/assistant-file/file-ref-image-1?download=1"
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
        src="/api/assistant-file/file-ref-image-1"
        downloadUrl="/api/assistant-file/file-ref-image-1?download=1"
        filename="image.png"
        alt="Generated image"
        onClose={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "lightboxShare" }));

    await waitFor(() => {
      expect(nativeShare).toHaveBeenCalledWith(
        JSON.stringify({
          url: "http://localhost:3000/api/assistant-file/file-ref-image-1?download=1",
          filename: "image.png",
          title: "image.png",
          userAgent: navigator.userAgent
        })
      );
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the custom action chrome for video too", () => {
    blockVideoAutoplay();
    render(
      <ImageLightbox
        open
        src="/api/assistant-file/file-ref-video-1"
        downloadUrl="/api/assistant-file/file-ref-video-1?download=1"
        filename="video.mp4"
        alt="Generated video"
        mediaType="video"
        onClose={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: "lightboxSave" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lightboxShare" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lightboxClose" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lightboxPlay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lightboxPlayHero" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lightboxUnmute" })).toBeInTheDocument();
  });

  it("restores video chrome visibility when the playing media surface is tapped", async () => {
    vi.useFakeTimers();
    blockVideoAutoplay();
    render(
      <ImageLightbox
        open
        src="/api/assistant-file/file-ref-video-1"
        downloadUrl="/api/assistant-file/file-ref-video-1?download=1"
        filename="video.mp4"
        alt="Generated video"
        mediaType="video"
        onClose={() => undefined}
      />
    );

    const surface = screen.getByTestId("media-lightbox-video-surface");
    const video = surface.querySelector("video");
    expect(video).not.toBeNull();
    expect(screen.getByTestId("media-lightbox-top-chrome")).toBeInTheDocument();
    expect(screen.getByTestId("media-lightbox-video-controls")).toBeInTheDocument();

    fireEvent.play(video!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1800);
    });

    expect(screen.queryByTestId("media-lightbox-top-chrome")).toBeNull();
    expect(screen.queryByTestId("media-lightbox-video-controls")).toBeNull();

    fireEvent.click(surface);

    expect(screen.getByTestId("media-lightbox-top-chrome")).toBeInTheDocument();
    expect(screen.getByTestId("media-lightbox-video-controls")).toBeInTheDocument();
  });

  it("closes the video viewer on a downward swipe", () => {
    blockVideoAutoplay();
    const onClose = vi.fn();
    render(
      <ImageLightbox
        open
        src="/api/assistant-file/file-ref-video-1"
        downloadUrl="/api/assistant-file/file-ref-video-1?download=1"
        filename="video.mp4"
        alt="Generated video"
        mediaType="video"
        onClose={onClose}
      />
    );

    const surface = screen.getByTestId("media-lightbox-video-surface");

    fireEvent.pointerDown(surface, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      pointerType: "touch"
    });
    fireEvent.pointerMove(surface, {
      pointerId: 1,
      clientX: 102,
      clientY: 260,
      pointerType: "touch"
    });
    fireEvent.pointerUp(surface, {
      pointerId: 1,
      clientX: 102,
      clientY: 260,
      pointerType: "touch"
    });

    expect(onClose).toHaveBeenCalled();
  });

  it("hides the hero play overlay after playback starts and restores chrome on tap", async () => {
    vi.useFakeTimers();
    blockVideoAutoplay();
    render(
      <ImageLightbox
        open
        src="/api/assistant-file/file-ref-video-1"
        downloadUrl="/api/assistant-file/file-ref-video-1?download=1"
        filename="video.mp4"
        alt="Generated video"
        mediaType="video"
        onClose={() => undefined}
      />
    );

    const surface = screen.getByTestId("media-lightbox-video-surface");
    const video = surface.querySelector("video");
    expect(video).not.toBeNull();
    expect(screen.getByRole("button", { name: "lightboxPlayHero" })).toBeInTheDocument();

    fireEvent.play(video!);

    expect(screen.queryByRole("button", { name: "lightboxPlayHero" })).toBeNull();
    expect(screen.getByTestId("media-lightbox-top-chrome")).toBeInTheDocument();
    expect(screen.getByTestId("media-lightbox-video-controls")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1800);
    });

    expect(screen.queryByTestId("media-lightbox-top-chrome")).toBeNull();
    expect(screen.queryByTestId("media-lightbox-video-controls")).toBeNull();
    expect(screen.queryByRole("button", { name: "lightboxPlayHero" })).toBeNull();

    fireEvent.click(surface);

    expect(screen.getByTestId("media-lightbox-top-chrome")).toBeInTheDocument();
    expect(screen.getByTestId("media-lightbox-video-controls")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "lightboxPlayHero" })).toBeNull();
  });

  it("shows the hero play overlay again when playback pauses or ends", async () => {
    vi.useFakeTimers();
    blockVideoAutoplay();
    render(
      <ImageLightbox
        open
        src="/api/assistant-file/file-ref-video-1"
        downloadUrl="/api/assistant-file/file-ref-video-1?download=1"
        filename="video.mp4"
        alt="Generated video"
        mediaType="video"
        onClose={() => undefined}
      />
    );

    const surface = screen.getByTestId("media-lightbox-video-surface");
    const video = surface.querySelector("video");
    expect(video).not.toBeNull();

    fireEvent.play(video!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1800);
    });
    expect(screen.queryByTestId("media-lightbox-top-chrome")).toBeNull();

    await act(async () => {
      fireEvent.pause(video!);
    });

    expect(screen.getByRole("button", { name: "lightboxPlayHero" })).toBeInTheDocument();
    expect(screen.getByTestId("media-lightbox-top-chrome")).toBeInTheDocument();
    expect(screen.getByTestId("media-lightbox-video-controls")).toBeInTheDocument();

    await act(async () => {
      fireEvent.play(video!);
      fireEvent.ended(video!);
    });

    expect(screen.getByRole("button", { name: "lightboxPlayHero" })).toBeInTheDocument();
    expect(screen.getByTestId("media-lightbox-top-chrome")).toBeInTheDocument();
    expect(screen.getByTestId("media-lightbox-video-controls")).toBeInTheDocument();
  });
});
