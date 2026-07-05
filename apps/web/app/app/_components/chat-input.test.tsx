import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "./chat-input";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: { count?: number }) =>
    params?.count !== undefined ? `${key} (${String(params.count)})` : key
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

function withSize(file: File, size: number): File {
  Object.defineProperty(file, "size", { configurable: true, value: size });
  return file;
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

function mockComposerShell(width = 360, left = 0) {
  const shell = screen.getByTestId("chat-composer-shell");
  Object.defineProperty(shell, "offsetWidth", { configurable: true, value: width });
  shell.getBoundingClientRect = () =>
    ({
      left,
      top: 0,
      width,
      height: 48,
      right: left + width,
      bottom: 48,
      x: left,
      y: 0,
      toJSON: () => ({})
    }) as DOMRect;
  return shell;
}

/** React controlled textarea: set native value then dispatch input. */
function fillComposer(textarea: HTMLElement, value: string) {
  const el = textarea as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  )?.set;
  setter?.call(el, value);
  fireEvent.input(el, { target: { value } });
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
    fillComposer(screen.getByPlaceholderText("placeholder"), "Use this file");
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

  it("shows a localized file-size error before staging oversized uploads", () => {
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
    const oversized = withSize(
      new File(["x"], "too-large.pdf", { type: "application/pdf" }),
      26 * 1024 * 1024
    );
    fireEvent.change(fileInput, {
      target: {
        files: toFileList([oversized])
      }
    });

    expect(screen.getByText("attachmentTooLarge")).toBeInTheDocument();
    expect(screen.queryByText("too-large.pdf")).toBeNull();
    fireEvent.click(screen.getByTitle("send"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows attachment ordinals on staged thumbnails only when multiple files are pending", async () => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test-preview"),
      revokeObjectURL: vi.fn()
    });

    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const first = new File(["a"], "one.png", { type: "image/png" });
    const second = new File(["b"], "two.png", { type: "image/png" });

    fireEvent.change(fileInput, {
      target: {
        files: toFileList([first])
      }
    });
    expect(screen.queryByText("1")).toBeNull();

    fireEvent.change(fileInput, {
      target: {
        files: toFileList([second])
      }
    });

    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
    });
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
    fillComposer(textarea, "hello");
    fireEvent.click(screen.getByTitle("send"));

    expect(onSend).toHaveBeenCalledWith("hello", undefined, undefined);
    expect(textarea).toHaveFocus();
  });

  it("restores focus to the desktop composer after sending with Enter", async () => {
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
    fillComposer(textarea, "hello from enter");
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "Enter" });
    textarea.blur();
    rafCallbacks.forEach((cb) => cb(0));

    expect(onSend).toHaveBeenCalledWith("hello from enter", undefined, undefined);
    await waitFor(() => {
      expect(textarea).toHaveFocus();
    });
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
    fireEvent.input(textarea, {
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
    fillComposer(textarea, "hello after rerender");
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
    fillComposer(textarea, "hello pending send");
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
    ).toHaveClass("inset-x-0", "items-center", "md:right-0", "md:items-end");
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

  it("shows batch image banner copy when requestedCount is greater than one", () => {
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
            id: "job-series",
            kind: "image",
            operation: "image_generate",
            status: "running",
            requestedCount: 7,
            createdAt: "2026-05-05T12:00:00Z",
            startedAt: "2026-05-05T12:00:18Z",
            updatedAt: "2026-05-05T12:01:40Z"
          },
          {
            id: "job-edit-series",
            kind: "image",
            operation: "image_edit",
            status: "running",
            requestedCount: 4,
            createdAt: "2026-05-05T12:00:00Z",
            startedAt: "2026-05-05T12:00:18Z",
            updatedAt: "2026-05-05T12:01:40Z"
          }
        ]}
      />
    );

    expect(screen.getByText("mediaJobImageGenerateBatch (7) 1:24")).toBeInTheDocument();
    expect(screen.getByText("mediaJobImageEditBatch (4) 1:24")).toBeInTheDocument();
  });

  it("keeps single-image banner copy when requestedCount is one", () => {
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
            id: "job-single",
            kind: "image",
            operation: "image_generate",
            status: "running",
            requestedCount: 1,
            createdAt: "2026-05-05T12:00:00Z",
            startedAt: "2026-05-05T12:00:18Z",
            updatedAt: "2026-05-05T12:01:40Z"
          }
        ]}
      />
    );

    expect(screen.getByText("mediaJobImageGenerate 1:24")).toBeInTheDocument();
    expect(screen.queryByText(/mediaJobImageGenerateBatch/)).toBeNull();
  });

  it("shows active document job chips with elapsed time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T12:02:00Z"));

    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
        activeDocumentJobs={[
          {
            id: "doc-job-1",
            documentType: "presentation",
            descriptorMode: "export_or_redeliver",
            status: "ready_for_delivery",
            createdAt: "2026-05-05T12:00:00Z",
            startedAt: "2026-05-05T12:00:18Z",
            updatedAt: "2026-05-05T12:01:50Z"
          }
        ]}
      />
    );

    expect(screen.getByText("documentJobRedeliver 1:42")).toBeInTheDocument();
  });

  describe("active media job chip — talking-avatar banner (Slice 10b)", () => {
    it("shows legacy mediaJobVideoGenerate copy for cinematic video jobs regardless of elapsed time", () => {
      // Initial render at t+10s elapsed.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-05T12:00:10Z"));
      const props = {
        onSend: vi.fn(),
        onTranscribeVoice: vi.fn(async () => ""),
        onStop: vi.fn(),
        isStreaming: false,
        activeMediaJobs: [
          {
            id: "kling-cinematic-1",
            kind: "video" as const,
            operation: "video_generate" as const,
            displayKind: "cinematic" as const,
            status: "running" as const,
            createdAt: "2026-05-05T12:00:00Z",
            startedAt: "2026-05-05T12:00:00Z",
            updatedAt: "2026-05-05T12:00:00Z"
          }
        ]
      };
      render(<ChatInput {...props} />);
      expect(screen.getByText("mediaJobVideoGenerate 0:10")).toBeInTheDocument();
      expect(screen.queryByText(/chatTalkingAvatarBannerStage/)).toBeNull();

      // Re-mount fresh at t+10min — cinematic chip MUST stay byte-identical.
      cleanup();
      vi.setSystemTime(new Date("2026-05-05T12:10:00Z"));
      render(<ChatInput {...props} />);
      expect(screen.getByText("mediaJobVideoGenerate 10:00")).toBeInTheDocument();
      expect(screen.queryByText(/chatTalkingAvatarBannerStage/)).toBeNull();
    });

    it("treats omitted displayKind as cinematic (defensive default for legacy job rows)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-05T12:00:10Z"));

      render(
        <ChatInput
          onSend={vi.fn()}
          onTranscribeVoice={vi.fn(async () => "")}
          onStop={vi.fn()}
          isStreaming={false}
          activeMediaJobs={[
            {
              id: "legacy-row-1",
              kind: "video",
              operation: "video_generate",
              status: "running",
              createdAt: "2026-05-05T12:00:00Z",
              startedAt: "2026-05-05T12:00:00Z",
              updatedAt: "2026-05-05T12:00:00Z"
            }
          ]}
        />
      );

      expect(screen.getByText("mediaJobVideoGenerate 0:10")).toBeInTheDocument();
      expect(screen.queryByText(/chatTalkingAvatarBannerStage/)).toBeNull();
    });

    it("rotates label across stages 1→2→3→4 for talking-avatar jobs as elapsed time crosses thresholds", () => {
      // The chip label is recomputed on every parent re-render with the
      // latest `mediaJobNowMs`. Unit-test the label-by-elapsed-time mapping
      // with separate fresh mounts at each threshold rather than relying on
      // the live 1s interval — same code path, lower flake surface than
      // driving the interval through `advanceTimersByTime` mid-test.
      const props = {
        onSend: vi.fn(),
        onTranscribeVoice: vi.fn(async () => ""),
        onStop: vi.fn(),
        isStreaming: false,
        activeMediaJobs: [
          {
            id: "heygen-talking-1",
            kind: "video" as const,
            operation: "video_generate" as const,
            displayKind: "talking_avatar" as const,
            status: "running" as const,
            createdAt: "2026-05-05T12:00:00Z",
            startedAt: "2026-05-05T12:00:00Z",
            updatedAt: "2026-05-05T12:00:00Z"
          }
        ]
      };

      // Stage 1: t+0s — "Preparing avatar…", duration chip "0:00".
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-05T12:00:00Z"));
      render(<ChatInput {...props} />);
      expect(screen.getByText("chatTalkingAvatarBannerStage1 0:00")).toBeInTheDocument();
      expect(screen.queryByText(/mediaJobVideoGenerate/)).toBeNull();

      // Stage 2: t+31s — "Synthesizing voice…", elapsed chip still rendered.
      cleanup();
      vi.setSystemTime(new Date("2026-05-05T12:00:31Z"));
      render(<ChatInput {...props} />);
      expect(screen.getByText("chatTalkingAvatarBannerStage2 0:31")).toBeInTheDocument();

      // Stage 3: t+121s — "Rendering video…".
      cleanup();
      vi.setSystemTime(new Date("2026-05-05T12:02:01Z"));
      render(<ChatInput {...props} />);
      expect(screen.getByText("chatTalkingAvatarBannerStage3 2:01")).toBeInTheDocument();

      // Stage 4: t+301s — "Final pass, almost there…".
      cleanup();
      vi.setSystemTime(new Date("2026-05-05T12:05:01Z"));
      render(<ChatInput {...props} />);
      expect(screen.getByText("chatTalkingAvatarBannerStage4 5:01")).toBeInTheDocument();
    });
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
    expect(mic).toHaveClass("rounded-full");
  });

  it("stops recording on pointercancel after capture starts (mobile release path)", async () => {
    enableTouchDevice();
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }]
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    const recorderStop = vi.fn();
    const mediaRecorder = vi.fn(() => ({
      mimeType: "audio/webm",
      state: "recording",
      start: vi.fn(),
      requestData: vi.fn(),
      stop: recorderStop,
      ondataavailable: null,
      onstop: null
    }));
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
    mockComposerShell();
    fireEvent.pointerDown(mic, { pointerType: "touch", pointerId: 1, clientX: 200, clientY: 100 });
    await waitFor(() => {
      expect(mediaRecorder).toHaveBeenCalled();
    });
    fireEvent.pointerCancel(mic, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 198,
      clientY: 102
    });
    expect(recorderStop).toHaveBeenCalled();
  });

  it("ignores pointercancel before capture starts", async () => {
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
    fireEvent.pointerDown(mic, { pointerType: "touch", pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerCancel(mic, {
      pointerType: "touch",
      pointerId: 1,
      clientX: 198,
      clientY: 102
    });
    resolveGetUserMedia(stream);
    await waitFor(() => {
      expect(stop).toHaveBeenCalled();
    });
    expect(mediaRecorder).not.toHaveBeenCalled();
  });

  it("arms cancel only after a deliberate left swipe", async () => {
    enableTouchDevice();
    const stream = {
      getTracks: () => [{ stop: vi.fn() }]
    } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) }
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: Object.assign(
        vi.fn(() => ({
          mimeType: "audio/webm",
          state: "recording",
          start: vi.fn(),
          stop: vi.fn(),
          ondataavailable: null,
          onstop: null
        })),
        { isTypeSupported: vi.fn(() => true) }
      )
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
    mockComposerShell();
    fireEvent.pointerDown(mic, { pointerType: "touch", pointerId: 1, clientX: 320, clientY: 100 });
    await waitFor(() => {
      expect(mic).toHaveClass("text-accent");
    });
    const banner = () => screen.getByTestId("voice-recording-banner");
    const trash = () => screen.getByTestId("voice-cancel-trash");
    fireEvent.pointerMove(mic, { pointerType: "touch", pointerId: 1, clientX: 310, clientY: 108 });
    await waitFor(() => {
      expect(banner()).toBeInTheDocument();
    });
    expect(banner()).toHaveAttribute("data-cancel-armed", "false");
    expect(trash()).toBeInTheDocument();
    fireEvent.pointerMove(mic, { pointerType: "touch", pointerId: 1, clientX: 300, clientY: 108 });
    expect(banner()).toHaveAttribute("data-cancel-armed", "false");
    fireEvent.pointerMove(mic, { pointerType: "touch", pointerId: 1, clientX: 240, clientY: 112 });
    await waitFor(() => {
      expect(banner()).toHaveAttribute("data-cancel-armed", "true");
    });
  });

  it("does not arm cancel on mostly vertical finger drift", async () => {
    enableTouchDevice();
    const stream = {
      getTracks: () => [{ stop: vi.fn() }]
    } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) }
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: Object.assign(
        vi.fn(() => ({
          mimeType: "audio/webm",
          state: "recording",
          start: vi.fn(),
          stop: vi.fn(),
          ondataavailable: null,
          onstop: null
        })),
        { isTypeSupported: vi.fn(() => true) }
      )
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
    mockComposerShell();
    fireEvent.pointerDown(mic, { pointerType: "touch", pointerId: 1, clientX: 320, clientY: 100 });
    await waitFor(() => {
      expect(mic).toHaveClass("text-accent");
    });
    fireEvent.pointerMove(mic, { pointerType: "touch", pointerId: 1, clientX: 310, clientY: 230 });
    expect(screen.getByTestId("voice-recording-banner")).toHaveAttribute(
      "data-cancel-armed",
      "false"
    );
  });

  it("reports empty voice transcription with a dedicated issue code", async () => {
    enableTouchDevice();
    const stream = {
      getTracks: () => [{ stop: vi.fn() }]
    } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) }
    });
    const recorderStop = vi.fn();
    const handlers: {
      stop: (() => void) | null;
      data: ((event: { data: Blob }) => void) | null;
    } = {
      stop: null,
      data: null
    };
    const mediaRecorderMock = vi.fn(() => ({
      mimeType: "audio/webm",
      state: "recording",
      start: vi.fn(),
      stop: recorderStop.mockImplementation(() => handlers.stop?.()),
      set ondataavailable(handler: ((event: { data: Blob }) => void) | null) {
        handlers.data = handler;
      },
      get ondataavailable() {
        return handlers.data;
      },
      set onstop(handler: (() => void) | null) {
        handlers.stop = handler;
      },
      get onstop() {
        return handlers.stop;
      }
    }));
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: Object.assign(mediaRecorderMock, { isTypeSupported: vi.fn(() => true) })
    });

    const onVoiceTranscriptionError = vi.fn();
    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "   ")}
        onVoiceTranscriptionError={onVoiceTranscriptionError}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    const mic = await screen.findByTitle("voiceHoldToRecord");
    mockComposerShell();
    fireEvent.pointerDown(mic, { pointerType: "touch", pointerId: 1, clientX: 320, clientY: 100 });
    await waitFor(() => {
      expect(mediaRecorderMock).toHaveBeenCalled();
    });
    const file = new File([new Uint8Array(4096)], "voice.webm", { type: "audio/webm" });
    await new Promise((resolve) => setTimeout(resolve, 320));
    fireEvent.pointerUp(mic, { pointerType: "touch", pointerId: 1, clientX: 320, clientY: 100 });
    if (handlers.data) {
      handlers.data({ data: file });
    }
    if (handlers.stop) {
      handlers.stop();
    }
    await waitFor(() => {
      expect(onVoiceTranscriptionError).toHaveBeenCalled();
    });
    expect(onVoiceTranscriptionError.mock.calls[0]?.[0]).toMatchObject({
      code: "voice_transcription_empty"
    });
  });

  it("shows mic when empty and send when typing", () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        onTranscribeVoice={vi.fn(async () => "")}
        onStop={vi.fn()}
        isStreaming={false}
      />
    );

    expect(screen.getByTitle("voiceMessage")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByTitle("send")).toHaveAttribute("aria-hidden", "true");

    fillComposer(screen.getByPlaceholderText("placeholder"), "hi");

    expect(screen.getByTitle("send")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByTitle("voiceMessage")).toHaveAttribute("aria-hidden", "true");
  });
});
