import { describe, expect, it, vi } from "vitest";
import { releaseAudioFocus, requestAudioFocus } from "./audio-focus";

describe("audio-focus", () => {
  it("stops the previous owner when a new owner takes focus", () => {
    const firstStop = vi.fn();
    const secondStop = vi.fn();

    requestAudioFocus("voice-preview", firstStop);
    requestAudioFocus("live-voice", secondStop);

    expect(firstStop).toHaveBeenCalledTimes(1);
    expect(secondStop).not.toHaveBeenCalled();
  });

  it("release unregisters the owner without affecting others", () => {
    const firstStop = vi.fn();
    const secondStop = vi.fn();

    const releaseFirst = requestAudioFocus("voice-preview", firstStop);
    releaseFirst();
    releaseAudioFocus("voice-preview");
    requestAudioFocus("voice-message", secondStop);

    expect(firstStop).not.toHaveBeenCalled();
    expect(secondStop).not.toHaveBeenCalled();
  });
});
