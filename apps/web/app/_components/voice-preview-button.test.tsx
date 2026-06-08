import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoicePreviewButton } from "./voice-preview-button";

// Mock HTMLAudioElement for jsdom environment
type MockAudio = {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  src: string;
  currentTime: number;
  _eventHandlers: Record<string, (() => void)[]>;
  addEventListener: (event: string, handler: () => void) => void;
};

function createMockAudio(): MockAudio {
  const audio: MockAudio = {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    src: "",
    currentTime: 0,
    _eventHandlers: {},
    addEventListener(event: string, handler: () => void) {
      if (!this._eventHandlers[event]) {
        this._eventHandlers[event] = [];
      }
      this._eventHandlers[event]!.push(handler);
    }
  };
  return audio;
}

let mockAudioInstances: MockAudio[] = [];

beforeEach(() => {
  mockAudioInstances = [];
  vi.stubGlobal(
    "Audio",
    vi.fn().mockImplementation((_src: string) => {
      const audio = createMockAudio();
      audio.src = _src;
      mockAudioInstances.push(audio);
      return audio;
    })
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("VoicePreviewButton", () => {
  it("renders an active play button when previewAudioUrl is non-null", () => {
    render(
      <VoicePreviewButton
        previewAudioUrl="https://cdn.heygen.com/voice.mp3"
        voiceLabel="Amy"
        previewUnavailableLabel="Preview unavailable"
      />
    );

    const btn = screen.getByRole("button", { name: "Play preview: Amy" });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toHaveAttribute("aria-disabled");
    expect(btn).toBeEnabled();
  });

  it("renders a disabled play button when previewAudioUrl is null", () => {
    render(
      <VoicePreviewButton
        previewAudioUrl={null}
        voiceLabel="Unknown"
        previewUnavailableLabel="Preview unavailable"
      />
    );

    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-disabled", "true");
  });

  it("renders a disabled play button when previewAudioUrl is empty string", () => {
    render(
      <VoicePreviewButton
        previewAudioUrl=""
        voiceLabel="Unknown"
        previewUnavailableLabel="Preview unavailable"
      />
    );

    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-disabled", "true");
  });

  it("click triggers audio.play()", async () => {
    render(
      <VoicePreviewButton
        previewAudioUrl="https://cdn.heygen.com/voice.mp3"
        voiceLabel="Amy"
        previewUnavailableLabel="Preview unavailable"
      />
    );

    const btn = screen.getByRole("button", { name: "Play preview: Amy" });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockAudioInstances[0]!.play).toHaveBeenCalledTimes(1);
    });
  });

  it("second click pauses audio (shows pause icon after play)", async () => {
    render(
      <VoicePreviewButton
        previewAudioUrl="https://cdn.heygen.com/voice.mp3"
        voiceLabel="Amy"
        previewUnavailableLabel="Preview unavailable"
      />
    );

    const btn = screen.getByRole("button", { name: "Play preview: Amy" });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause preview: Amy" })).toBeInTheDocument();
    });

    const pauseBtn = screen.getByRole("button", { name: "Pause preview: Amy" });
    fireEvent.click(pauseBtn);

    await waitFor(() => {
      expect(mockAudioInstances[0]!.pause).toHaveBeenCalledTimes(1);
    });
  });

  it("does not get stuck in playing state when a rapid second click interrupts the first play", async () => {
    let resolveFirstPlay: (() => void) | null = null;
    mockAudioInstances = [];
    vi.stubGlobal(
      "Audio",
      vi.fn().mockImplementation((_src: string) => {
        const audio = createMockAudio();
        audio.src = _src;
        audio.play = vi.fn().mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              resolveFirstPlay = resolve;
            })
        );
        mockAudioInstances.push(audio);
        return audio;
      })
    );

    render(
      <VoicePreviewButton
        previewAudioUrl="https://cdn.heygen.com/voice.mp3"
        voiceLabel="Amy"
        previewUnavailableLabel="Preview unavailable"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Play preview: Amy" }));
    fireEvent.click(screen.getByRole("button", { name: "Play preview: Amy" }));
    if (typeof resolveFirstPlay === "function") {
      (resolveFirstPlay as () => void)();
    }

    await waitFor(() => {
      expect(mockAudioInstances[0]!.play).toHaveBeenCalledTimes(1);
      expect(mockAudioInstances[0]!.pause).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Play preview: Amy" })).toBeInTheDocument();
    });
  });

  it("recreates the audio element when previewAudioUrl changes", async () => {
    const { rerender } = render(
      <VoicePreviewButton
        previewAudioUrl="https://cdn.heygen.com/voice-1.mp3"
        voiceLabel="Amy"
        previewUnavailableLabel="Preview unavailable"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Play preview: Amy" }));
    await waitFor(() => {
      expect(mockAudioInstances[0]!.play).toHaveBeenCalledTimes(1);
    });

    rerender(
      <VoicePreviewButton
        previewAudioUrl="https://cdn.heygen.com/voice-2.mp3"
        voiceLabel="Amy"
        previewUnavailableLabel="Preview unavailable"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Play preview: Amy" }));
    await waitFor(() => {
      expect(mockAudioInstances).toHaveLength(2);
      expect(mockAudioInstances[1]!.src).toBe("https://cdn.heygen.com/voice-2.mp3");
      expect(mockAudioInstances[1]!.play).toHaveBeenCalledTimes(1);
    });
  });
});
