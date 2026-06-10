import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import type { LiveVoiceError, LiveVoiceStatus, LiveVoiceTransport } from "./live-voice-types";
import { LiveVoiceOverlay } from "./live-voice-overlay";

function renderOverlay(options?: {
  status?: LiveVoiceStatus;
  error?: LiveVoiceError | null;
  transport?: LiveVoiceTransport | null;
  onStop?: () => void;
  onClose?: () => void;
}) {
  const onStop = options?.onStop ?? vi.fn();
  const onClose = options?.onClose ?? vi.fn();

  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LiveVoiceOverlay
        status={options?.status ?? "connecting"}
        error={options?.error ?? null}
        transport={options?.transport ?? "direct-webrtc"}
        onStop={onStop}
        onClose={onClose}
      />
    </NextIntlClientProvider>
  );

  return { onStop, onClose };
}

describe("LiveVoiceOverlay", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders major active states", () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LiveVoiceOverlay
          status="connecting"
          error={null}
          transport="direct-webrtc"
          onStop={vi.fn()}
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByText(enMessages.chat.liveVoice.connecting)).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LiveVoiceOverlay
          status="listening"
          error={null}
          transport="direct-webrtc"
          onStop={vi.fn()}
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(screen.getByText(enMessages.chat.liveVoice.listening)).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LiveVoiceOverlay
          status="speaking"
          error={null}
          transport="direct-webrtc"
          onStop={vi.fn()}
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(screen.getByText(enMessages.chat.liveVoice.speaking)).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LiveVoiceOverlay
          status="recovering"
          error={null}
          transport="relay-websocket"
          onStop={vi.fn()}
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(screen.getByText(enMessages.chat.liveVoice.recovering)).toBeInTheDocument();
  });

  it("calls onStop from the stop button in active states", () => {
    const { onStop } = renderOverlay({ status: "listening" });

    fireEvent.click(screen.getByRole("button", { name: enMessages.chat.liveVoice.stop }));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("shows error state with message and close button", () => {
    const { onClose } = renderOverlay({
      status: "error",
      error: {
        code: "live_voice_connection_failed",
        message: "Socket closed."
      },
      transport: null
    });

    expect(screen.getByText(enMessages.chat.liveVoice.error)).toBeInTheDocument();
    expect(screen.getByText("Socket closed.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: enMessages.chat.liveVoice.close })[1]!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows unavailable hint", () => {
    renderOverlay({
      status: "unavailable",
      error: null,
      transport: null
    });

    expect(screen.getByText(enMessages.chat.liveVoice.unavailable)).toBeInTheDocument();
    expect(screen.getByText(enMessages.chat.liveVoice.unavailableHint)).toBeInTheDocument();
  });

  it("shows microphone denied copy for microphone-denied errors", () => {
    renderOverlay({
      status: "error",
      error: {
        code: "live_voice_microphone_denied",
        message: "Permission denied."
      },
      transport: null
    });

    expect(screen.getByText(enMessages.chat.liveVoice.micDenied)).toBeInTheDocument();
  });
});
