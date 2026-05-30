import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectFilesPanel } from "./project-files-panel";
import {
  dispatchProjectModeActivated,
  resetProjectFilesHintStateForTests
} from "./project-files-events";

const getTokenMock = vi.fn(async () => "token-1");
const getChatMessagesMock = vi.fn(async () => ({
  messages: [],
  nextCursor: null
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: getTokenMock
  })
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

vi.mock("../assistant-api-client", () => ({
  getChatMessages: () => getChatMessagesMock(),
  getAssistantFileDownloadUrl: (fileRef: string) => `/api/assistant-file/${fileRef}`,
  stageWebChatAttachment: vi.fn(),
  deleteAssistantFile: vi.fn()
}));

describe("ProjectFilesPanel — project mode hint", () => {
  beforeEach(() => {
    resetProjectFilesHintStateForTests();
    getTokenMock.mockClear();
    getChatMessagesMock.mockClear();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
    resetProjectFilesHintStateForTests();
  });

  it("applies the hint pulse when project mode activation is signaled", async () => {
    render(<ProjectFilesPanel chatId="chat-1" threadKey="thread-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("project-files-empty")).toBeInTheDocument();
    });

    dispatchProjectModeActivated("chat-1");

    await waitFor(() => {
      expect(screen.getByTestId("project-files-panel")).toHaveClass("project-files-hint");
    });
  });

  it("consumes a pending highlight on mount after a delayed panel render", async () => {
    dispatchProjectModeActivated("chat-1");

    render(<ProjectFilesPanel chatId="chat-1" threadKey="thread-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("project-files-panel")).toHaveClass("project-files-hint");
    });
  });
});
