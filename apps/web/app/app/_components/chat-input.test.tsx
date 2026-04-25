import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "./chat-input";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

function toFileList(files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: function* () {
      yield* files;
    }
  } as unknown as FileList;
}

function enableTouchDevice() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }));
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 1
  });
}

describe("ChatInput", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a knowledge-base checkbox for eligible documents", () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pdfFile = new File(["hello"], "notes.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, {
      target: {
        files: toFileList([pdfFile])
      }
    });

    expect(screen.getByLabelText("knowledgeAddToBase")).toBeInTheDocument();
  });

  it("forwards addToKnowledgeBase when the checkbox is enabled", () => {
    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pdfFile = new File(["hello"], "notes.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, {
      target: {
        files: toFileList([pdfFile])
      }
    });

    fireEvent.click(screen.getByLabelText("knowledgeAddToBase"));
    fireEvent.change(screen.getByPlaceholderText("placeholder"), {
      target: { value: "Use this file" }
    });
    fireEvent.click(screen.getByTitle("send"));

    expect(onSend).toHaveBeenCalledWith("Use this file", [pdfFile], {
      addToKnowledgeBase: true
    });
  });

  it("keeps the checkbox hidden for non-knowledge files", () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const audioFile = new File(["audio"], "voice.mp3", { type: "audio/mpeg" });
    fireEvent.change(fileInput, {
      target: {
        files: toFileList([audioFile])
      }
    });

    expect(screen.queryByLabelText("knowledgeAddToBase")).toBeNull();
  });

  it("shows only the file tile in the desktop attachment menu", () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    fireEvent.click(screen.getByTitle("attachFile"));

    expect(screen.getByText("attachMenuFile")).toBeInTheDocument();
    expect(screen.queryByText("attachMenuCamera")).toBeNull();
    expect(screen.queryByText("attachMenuPhotos")).toBeNull();
  });

  it("shows a live camera preview in the mobile camera tile", async () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }]
    } as unknown as MediaStream;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    enableTouchDevice();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(stream)
      }
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 1
    });

    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle("attachFile")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTitle("attachFile"));

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
    });
    const video = document.querySelector("video") as HTMLVideoElement | null;
    expect(video?.srcObject).toBe(stream);
  });

  it("cancels a pending mobile voice start after a short tap", async () => {
    enableTouchDevice();
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }]
    } as unknown as MediaStream;
    let resolveGetUserMedia: (value: MediaStream) => void = () => undefined;
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveGetUserMedia = resolve;
        })
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    const mediaRecorder = vi.fn();
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: Object.assign(mediaRecorder, {
        isTypeSupported: vi.fn(() => true)
      })
    });

    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    const mic = await screen.findByTitle("voiceHoldToRecord");
    fireEvent.pointerDown(mic, { pointerType: "touch", pointerId: 1, clientY: 100 });
    fireEvent.pointerUp(mic, { pointerType: "touch", pointerId: 1, clientY: 100 });
    resolveGetUserMedia(stream);

    await waitFor(() => {
      expect(stop).toHaveBeenCalled();
    });
    expect(mediaRecorder).not.toHaveBeenCalled();
    expect(screen.queryByRole("status", { name: "recording" })).toBeNull();
  });
});
