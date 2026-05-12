import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminAbusePage from "./page";

const authMocks = vi.hoisted(() => ({
  getToken: vi.fn(async () => "token-1")
}));

const apiMocks = vi.hoisted(() => ({
  lookupAdminAbuseAssistantsByEmail: vi.fn(),
  postAdminAbuseUnblock: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: authMocks.getToken
  })
}));

vi.mock("@/app/app/assistant-api-client", () => ({
  lookupAdminAbuseAssistantsByEmail: apiMocks.lookupAdminAbuseAssistantsByEmail,
  postAdminAbuseUnblock: apiMocks.postAdminAbuseUnblock
}));

afterEach(() => {
  cleanup();
  authMocks.getToken.mockReset();
  authMocks.getToken.mockResolvedValue("token-1");
  apiMocks.lookupAdminAbuseAssistantsByEmail.mockReset();
  apiMocks.postAdminAbuseUnblock.mockReset();
});

describe("AdminAbusePage", () => {
  it("enables load-test override after email lookup and assistant selection", async () => {
    apiMocks.lookupAdminAbuseAssistantsByEmail.mockResolvedValue([
      {
        assistantId: "assistant-1",
        assistantDisplayName: "Load Test Assistant",
        userId: "user-1",
        userEmail: "owner@example.com",
        userDisplayName: "Owner",
        workspaceId: "ws-1"
      }
    ]);
    apiMocks.postAdminAbuseUnblock.mockResolvedValue({
      assistantId: "assistant-1",
      userId: null,
      surface: "telegram",
      adminOverrideUntil: "2026-05-12T11:30:00.000Z",
      affectedUserRows: 1,
      affectedAssistantRows: 1
    });

    render(<AdminAbusePage />);

    fireEvent.change(screen.getByLabelText("User email"), {
      target: { value: "owner@example.com" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Find assistants" }));

    await waitFor(() => {
      expect(apiMocks.lookupAdminAbuseAssistantsByEmail).toHaveBeenCalledWith(
        "token-1",
        "owner@example.com"
      );
    });

    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "telegram" } });
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Enable load-test mode" }));

    await waitFor(() => {
      expect(apiMocks.postAdminAbuseUnblock).toHaveBeenCalledWith("token-1", {
        assistantId: "assistant-1",
        userId: null,
        surface: "telegram",
        overrideMinutes: 120
      });
    });

    expect(screen.getByText("Active load-test override")).toBeInTheDocument();
    expect(screen.getAllByText(/Load Test Assistant/).length).toBeGreaterThan(0);
    expect(screen.getByText(/owner@example.com/)).toBeInTheDocument();
    expect(screen.getAllByText("Telegram").length).toBeGreaterThan(0);
  });

  it("shows a clear message when no assistants are found", async () => {
    apiMocks.lookupAdminAbuseAssistantsByEmail.mockResolvedValue([]);

    render(<AdminAbusePage />);

    fireEvent.change(screen.getByLabelText("User email"), {
      target: { value: "missing@example.com" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Find assistants" }));

    await waitFor(() => {
      expect(screen.getByText("No assistants were found for this email.")).toBeInTheDocument();
    });
  });

  it("clears the previous activation summary when the email changes", async () => {
    apiMocks.lookupAdminAbuseAssistantsByEmail.mockResolvedValue([
      {
        assistantId: "assistant-1",
        assistantDisplayName: "Load Test Assistant",
        userId: "user-1",
        userEmail: "owner@example.com",
        userDisplayName: "Owner",
        workspaceId: "ws-1"
      }
    ]);
    apiMocks.postAdminAbuseUnblock.mockResolvedValue({
      assistantId: "assistant-1",
      userId: null,
      surface: "web_chat",
      adminOverrideUntil: "2026-05-12T11:30:00.000Z",
      affectedUserRows: 1,
      affectedAssistantRows: 1
    });

    render(<AdminAbusePage />);

    fireEvent.change(screen.getByLabelText("User email"), {
      target: { value: "owner@example.com" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Find assistants" }));

    await waitFor(() => {
      expect(screen.getByText("Found 1 assistant for this email.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Enable load-test mode" }));

    await waitFor(() => {
      expect(screen.getByText("Active load-test override")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("User email"), {
      target: { value: "other@example.com" }
    });

    expect(screen.queryByText("Active load-test override")).toBeNull();
  });
});
