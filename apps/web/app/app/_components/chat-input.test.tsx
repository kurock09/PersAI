import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
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

function enableHybridDesktopTouchDevice() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(pointer: coarse)" || query === "(hover: hover) and (pointer: fine)",
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
    vi.useRealTimers();
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

  it("does not allow manual resizing of the composer textarea", () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    expect(screen.getByPlaceholderText("placeholder")).toHaveStyle({ resize: "none" });
  });

  it("returns focus to the desktop composer after send", () => {
    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    const textarea = screen.getByPlaceholderText("placeholder");
    fireEvent.change(textarea, {
      target: { value: "hello" }
    });
    fireEvent.click(screen.getByTitle("send"));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, undefined);
    expect(textarea).toHaveFocus();
  });

  it("restores focus to the desktop composer after sending with Enter", () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return 1;
    });
    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    const textarea = screen.getByPlaceholderText("placeholder");
    fireEvent.change(textarea, {
      target: { value: "hello from enter" }
    });
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "Enter" });
    textarea.blur();
    rafCallbacks[0]?.(0);

    expect(onSend).toHaveBeenCalledWith("hello from enter", undefined, undefined);
    expect(textarea).toHaveFocus();
  });

  it("returns focus after send on hybrid desktop touch devices", async () => {
    enableHybridDesktopTouchDevice();
    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("placeholder")).toBeInTheDocument();
    });
    const textarea = screen.getByPlaceholderText("placeholder");
    fireEvent.change(textarea, {
      target: { value: "hello from desktop touch" }
    });
    fireEvent.click(screen.getByTitle("send"));

    expect(onSend).toHaveBeenCalledWith("hello from desktop touch", undefined, undefined);
    expect(textarea).toHaveFocus();
  });

  it("keeps focus on the composer after send rerenders the desktop button into stop", async () => {
    function Wrapper() {
      const [isStreaming, setIsStreaming] = useState(false);
      return (
        <ChatInput
          onSend={() => {
            setIsStreaming(true);
          }}
          onTranscribeVoice={vi.fn(async () => "")}
          onStop={vi.fn()}
          isStreaming={isStreaming}
        />
      );
    }

    render(<Wrapper />);

    const textarea = screen.getByPlaceholderText("placeholder");
    fireEvent.change(textarea, {
      target: { value: "hello after rerender" }
    });
    fireEvent.mouseDown(screen.getByTitle("send"));
    fireEvent.click(screen.getByTitle("send"));

    await waitFor(() => {
      expect(screen.getByTitle("stop")).toBeInTheDocument();
    });
    expect(textarea).toHaveFocus();
  });

  it("keeps the desktop composer focusable while a send is pending", async () => {
    function Wrapper() {
      const [pendingSendStatus, setPendingSendStatus] = useState<
        | "sending"
        | "reconciling"
        | "send_failed"
        | "send_failed_unconfirmed"
        | "send_failed_confirmed"
        | null
      >(null);

      return (
        <ChatInput
          onSend={() => {
            setPendingSendStatus("sending");
          }}
          onTranscribeVoice={vi.fn(async () => "")}
          onStop={vi.fn()}
          isStreaming={false}
          pendingSendStatus={pendingSendStatus}
        />
      );
    }

    render(<Wrapper />);

    const textarea = screen.getByPlaceholderText("placeholder");
    fireEvent.change(textarea, {
      target: { value: "hello pending send" }
    });
    fireEvent.mouseDown(screen.getByTitle("send"));
    fireEvent.click(screen.getByTitle("send"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("placeholder")).toHaveFocus();
    });
    expect(textarea).not.toBeDisabled();
    expect(screen.getByTitle("send")).toBeDisabled();
  });

  it("shows up to two active media job chips with elapsed time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T12:02:00Z"));

    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
        activeMediaJobs={[
          {
            id: "job-1",
            kind: "image",
            operation: "image_generate",
            status: "running",
            createdAt: "2026-05-05T12:00:00Z",
            startedAt: "2026-05-05T12:00:18Z",
            updatedAt: "2026-05-05T12:01:50Z"
          },
          {
            id: "job-2",
            kind: "video",
            operation: "video_generate",
            status: "running",
            createdAt: "2026-05-05T12:01:00Z",
            startedAt: "2026-05-05T12:01:22Z",
            updatedAt: "2026-05-05T12:01:55Z"
          }
        ]}
      />
    );

    expect(screen.getByText("mediaJobImageGenerate 1:42")).toBeInTheDocument();
    expect(screen.getByText("mediaJobVideoGenerate 0:38")).toBeInTheDocument();
    expect(
      screen.getByText("mediaJobImageGenerate 1:42").closest('[aria-live="polite"]')
    ).toHaveClass("right-0", "justify-end");
  });

  it("falls back to createdAt when a media job is still queued", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T12:01:42Z"));

    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
        activeMediaJobs={[
          {
            id: "job-1",
            kind: "image",
            operation: "image_edit",
            status: "queued",
            createdAt: "2026-05-05T12:00:00Z",
            startedAt: null,
            updatedAt: "2026-05-05T12:01:40Z"
          }
        ]}
      />
    );

    expect(screen.getByText("mediaJobImageEdit 1:42")).toBeInTheDocument();
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
    expect(mic).not.toHaveClass("hover:bg-surface-hover");
  });
});
