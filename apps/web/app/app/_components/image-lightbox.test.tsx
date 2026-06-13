import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageLightbox } from "./image-lightbox";
import { NATIVE_MEDIA_TRANSFER_EVENT } from "./persai-native-bridge";

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue("fresh-client-token")
  })
}));

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

function mockInlineImageCanvas() {
  const drawImage = vi.fn();
  const toBlob = vi.fn((callback: BlobCallback, type?: string) => {
    callback(new Blob(["inline-image"], { type: type ?? "image/png" }));
  });
  const createElement = vi.spyOn(document, "createElement");
  createElement.mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    const element = document.createElementNS("http://www.w3.org/1999/xhtml", tagName, options);
    if (tagName.toLowerCase() === "canvas") {
      Object.defineProperty(element, "getContext", {
        configurable: true,
        value: vi.fn(() => ({ drawImage }))
      });
      Object.defineProperty(element, "toBlob", {
        configurable: true,
        value: toBlob
      });
    }
    return element;
  }) as typeof document.createElement);

  return {
    attachToImage(image: HTMLElement) {
      Object.defineProperty(image, "complete", {
        configurable: true,
        value: true
      });
      Object.defineProperty(image, "naturalWidth", {
        configurable: true,
        value: 320
      });
      Object.defineProperty(image, "naturalHeight", {
        configurable: true,
        value: 180
      });
    },
    drawImage,
    toBlob
  };
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

  it("renders quiet gallery controls and navigates with buttons and keyboard", () => {
    const onNavigate = vi.fn();
    render(
      <ImageLightbox
        open
        src="/api/assistant-file/file-ref-image-2"
        downloadUrl="/api/assistant-file/file-ref-image-2?download=1"
        filename="image-2.png"
        alt="Generated image 2"
        galleryItems={[
          { src: "/api/assistant-file/file-ref-image-1", filename: "image-1.png" },
          { src: "/api/assistant-file/file-ref-image-2", filename: "image-2.png" },
          { src: "/api/assistant-file/file-ref-image-3", filename: "image-3.png" }
        ]}
        currentIndex={1}
        onNavigate={onNavigate}
        onClose={() => undefined}
      />
    );

    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "lightboxNext" }));
    expect(onNavigate).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole("button", { name: "lightboxPrevious" }));
    expect(onNavigate).toHaveBeenCalledWith(0);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith(2);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it("navigates image gallery with horizontal touch swipes", () => {
    const onNavigate = vi.fn();
    render(
      <ImageLightbox
        open
        src="/api/assistant-file/file-ref-image-1"
        filename="image-1.png"
        alt="Generated image 1"
        galleryItems={[
          { src: "/api/assistant-file/file-ref-image-1", filename: "image-1.png" },
          { src: "/api/assistant-file/file-ref-image-2", filename: "image-2.png" }
        ]}
        currentIndex={0}
        onNavigate={onNavigate}
        onClose={() => undefined}
      />
    );

    const image = screen.getByTestId("media-lightbox-image-surface");
    fireEvent.pointerDown(image, {
      pointerId: 1,
      clientX: 240,
      clientY: 100,
      pointerType: "touch"
    });
    fireEvent.pointerMove(image, {
      pointerId: 1,
      clientX: 120,
      clientY: 104,
      pointerType: "touch"
    });
    fireEvent.pointerUp(image, {
      pointerId: 1,
      clientX: 120,
      clientY: 104,
      pointerType: "touch"
    });

    expect(onNavigate).toHaveBeenCalledWith(1);
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
    const inlineCanvas = mockInlineImageCanvas();
    const nativeShare = vi.fn().mockReturnValue(true);
    (
      window as unknown as { PersaiNative?: { shareMedia?: (payloadJson: string) => boolean } }
    ).PersaiNative = {
      shareMedia: nativeShare
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Blob(["image"], { type: "image/png" })))
    );

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

    inlineCanvas.attachToImage(screen.getByTestId("media-lightbox-image-surface"));
    fireEvent.click(screen.getByRole("button", { name: "lightboxShare" }));

    await waitFor(() => {
      expect(nativeShare).toHaveBeenCalledTimes(1);
    });
    const request = JSON.parse(nativeShare.mock.calls[0]?.[0] ?? "{}");
    expect(request).toMatchObject({
      mode: "inline",
      mediaType: "image",
      filename: "image.png",
      title: "image.png",
      userAgent: navigator.userAgent,
      mimeType: "image/png",
      sessionToken: "fresh-client-token"
    });
    expect(typeof request.requestId).toBe("string");
    expect(request.requestId.length).toBeGreaterThan(0);
    expect(typeof request.inlineBase64).toBe("string");
    expect(request.inlineBase64.length).toBeGreaterThan(0);
    expect(request.url).toBeUndefined();
    expect(inlineCanvas.drawImage).toHaveBeenCalledTimes(1);
    expect(inlineCanvas.toBlob).toHaveBeenCalledTimes(1);
  });

  it("prefers the native mobile save bridge when available", async () => {
    const inlineCanvas = mockInlineImageCanvas();
    const nativeSave = vi.fn().mockReturnValue(true);
    (
      window as unknown as { PersaiNative?: { saveMedia?: (payloadJson: string) => boolean } }
    ).PersaiNative = {
      saveMedia: nativeSave
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Blob(["image"], { type: "image/png" })))
    );

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

    inlineCanvas.attachToImage(screen.getByTestId("media-lightbox-image-surface"));
    fireEvent.click(screen.getByRole("button", { name: "lightboxSave" }));

    await waitFor(() => {
      expect(nativeSave).toHaveBeenCalledTimes(1);
    });
    const request = JSON.parse(nativeSave.mock.calls[0]?.[0] ?? "{}");
    expect(request).toMatchObject({
      mode: "inline",
      mediaType: "image",
      filename: "image.png",
      title: "image.png",
      userAgent: navigator.userAgent,
      mimeType: "image/png",
      sessionToken: "fresh-client-token"
    });
    expect(typeof request.requestId).toBe("string");
    expect(request.requestId.length).toBeGreaterThan(0);
    expect(typeof request.inlineBase64).toBe("string");
    expect(request.inlineBase64.length).toBeGreaterThan(0);
    expect(request.url).toBeUndefined();
    expect(inlineCanvas.drawImage).toHaveBeenCalledTimes(1);
    expect(inlineCanvas.toBlob).toHaveBeenCalledTimes(1);
  });

  it("calls native bridge methods with the native object context", async () => {
    const inlineCanvas = mockInlineImageCanvas();
    const nativeBridge = {
      saveMedia: vi.fn(function (this: unknown) {
        return this === nativeBridge;
      })
    };
    (window as unknown as { PersaiNative?: typeof nativeBridge }).PersaiNative = nativeBridge;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(new Blob(["image"], { type: "image/png" })))
    );

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

    inlineCanvas.attachToImage(screen.getByTestId("media-lightbox-image-surface"));
    fireEvent.click(screen.getByRole("button", { name: "lightboxSave" }));

    await waitFor(() => {
      expect(nativeBridge.saveMedia).toHaveReturnedWith(true);
    });
  });

  it("shows native transfer progress for remote video saves", async () => {
    const nativeSave = vi.fn().mockImplementation((payloadJson: string) => {
      const payload = JSON.parse(payloadJson);
      window.dispatchEvent(
        new CustomEvent(NATIVE_MEDIA_TRANSFER_EVENT, {
          detail: {
            requestId: payload.requestId,
            action: "save",
            mode: "remote",
            stage: "downloading",
            bytesDownloaded: 50,
            totalBytes: 100
          }
        })
      );
      return true;
    });
    (
      window as unknown as { PersaiNative?: { saveMedia?: (payloadJson: string) => boolean } }
    ).PersaiNative = {
      saveMedia: nativeSave
    };

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

    fireEvent.click(screen.getByRole("button", { name: "lightboxSave" }));

    expect(await screen.findByText("lightboxTransferDownloadingSave")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(nativeSave).toHaveBeenCalledTimes(1);
    const request = JSON.parse(nativeSave.mock.calls[0]?.[0] ?? "{}");
    expect(request).toMatchObject({
      mode: "remote",
      mediaType: "video",
      url: "http://localhost:3000/api/assistant-file/file-ref-video-1?download=1",
      filename: "video.mp4"
    });
  });

  it("reuses one fetched blob across share and save fallback actions", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    const createObjectUrlSpy = vi.fn().mockReturnValue("blob:http://localhost/object-1");
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createObjectUrlSpy;
        static revokeObjectURL = vi.fn();
      }
    );
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
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

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
      expect(share).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "lightboxSave" }));
    await waitFor(() => {
      expect(anchorClickSpy).toHaveBeenCalled();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    anchorClickSpy.mockRestore();
  });

  it("uses the fresh same-origin session token when fetching transfer assets", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(new Blob(["image"], { type: "image/png" })));
    vi.stubGlobal("fetch", fetchSpy);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("share unsupported"))
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
      expect(fetchSpy).toHaveBeenCalledWith("/api/assistant-file/file-ref-image-1?download=1", {
        credentials: "same-origin",
        headers: {
          "X-PersAI-Session-Token": "fresh-client-token"
        }
      });
    });
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

  it("restores video chrome visibility when the playing video is tapped", async () => {
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

    fireEvent.click(video!);

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

  it("hides the hero play overlay after playback starts and restores chrome on video tap", async () => {
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

    fireEvent.click(video!);

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
