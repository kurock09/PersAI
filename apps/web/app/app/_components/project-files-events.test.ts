import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  consumePendingProjectFilesHighlight,
  dispatchProjectModeActivated,
  markProjectFilesHintShown,
  resetProjectFilesHintStateForTests,
  shouldShowProjectFilesHint
} from "./project-files-events";

describe("project-files-events — project mode hint", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetProjectFilesHintStateForTests();
  });

  afterEach(() => {
    sessionStorage.clear();
    resetProjectFilesHintStateForTests();
  });

  it("shows the sidebar hint once per chat per browser session", () => {
    expect(shouldShowProjectFilesHint("chat-1")).toBe(true);
    markProjectFilesHintShown("chat-1");
    expect(shouldShowProjectFilesHint("chat-1")).toBe(false);
    expect(shouldShowProjectFilesHint("chat-2")).toBe(true);
  });

  it("queues highlight until the matching project files panel consumes it", () => {
    dispatchProjectModeActivated("chat-a");
    expect(consumePendingProjectFilesHighlight("chat-b")).toBe(false);
    expect(consumePendingProjectFilesHighlight("chat-a")).toBe(true);
    expect(consumePendingProjectFilesHighlight("chat-a")).toBe(false);
  });
});
