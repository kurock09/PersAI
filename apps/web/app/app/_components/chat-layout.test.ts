import { describe, expect, it } from "vitest";
import {
  CHAT_ASSISTANT_AVATAR_SIZE_PX,
  CHAT_CHROME_PADDING_DESKTOP_PX,
  CHAT_CONTENT_MAX_WIDTH_PX,
  shouldShowChatAssistantAvatars
} from "./chat-layout";

describe("shouldShowChatAssistantAvatars", () => {
  it("hides avatars when the pill sits near the stage wall", () => {
    // Narrow desktop pane: content fills the stage, gutter ~= chrome padding (16).
    expect(
      shouldShowChatAssistantAvatars({
        stageWidthPx: 420,
        chromePaddingPx: CHAT_CHROME_PADDING_DESKTOP_PX
      })
    ).toBe(false);
  });

  it("shows avatars only when pill-edge-to-wall exceeds two avatar widths", () => {
    const minGutter = CHAT_ASSISTANT_AVATAR_SIZE_PX * 2;
    // With a capped content column, pillEdgeToWall = (stage - contentMax) / 2.
    const thresholdStage = CHAT_CONTENT_MAX_WIDTH_PX + minGutter * 2;
    expect(
      shouldShowChatAssistantAvatars({
        stageWidthPx: thresholdStage,
        chromePaddingPx: CHAT_CHROME_PADDING_DESKTOP_PX
      })
    ).toBe(false);

    expect(
      shouldShowChatAssistantAvatars({
        stageWidthPx: thresholdStage + 2,
        chromePaddingPx: CHAT_CHROME_PADDING_DESKTOP_PX
      })
    ).toBe(true);
  });
});
