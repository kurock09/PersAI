import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectFilesPanel } from "./project-files-panel";

const getTokenMock = vi.fn(async () => "token-1");
const openSettingsMock = vi.fn();
const listChatWorkspaceFilesMock = vi.fn(async () => ({
  files: [],
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

vi.mock("./app-shell", () => ({
  useShellActions: () => ({
    openSettings: openSettingsMock
  })
}));

vi.mock("../assistant-api-client", () => ({
  listChatWorkspaceFiles: () => listChatWorkspaceFilesMock()
}));

describe("ProjectFilesPanel", () => {
  beforeEach(() => {
    getTokenMock.mockClear();
    openSettingsMock.mockClear();
    listChatWorkspaceFilesMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders collapsed project files affordance", () => {
    render(<ProjectFilesPanel chatId="chat-1" />);
    expect(screen.getByTestId("project-files-open-settings")).toBeInTheDocument();
    expect(screen.getByText("projectFilesTitle")).toBeInTheDocument();
  });

  it("opens assistant settings on the files tab", () => {
    render(<ProjectFilesPanel chatId="chat-1" />);
    fireEvent.click(screen.getByTestId("project-files-open-settings"));
    expect(openSettingsMock).toHaveBeenCalledWith("files");
  });
});
