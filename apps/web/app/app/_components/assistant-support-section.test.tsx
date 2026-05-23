import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantSupportSection } from "./assistant-support-section";

const clerkMocks = vi.hoisted(() => ({
  getToken: vi.fn()
}));

const assistantApiMocks = vi.hoisted(() => ({
  getAssistantSupportTickets: vi.fn(),
  getAssistantSupportTicket: vi.fn(),
  postAssistantSupportTicket: vi.fn(),
  postAssistantSupportTicketRead: vi.fn()
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: clerkMocks.getToken
  })
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key
}));

vi.mock("../assistant-api-client", () => ({
  getAssistantSupportTickets: assistantApiMocks.getAssistantSupportTickets,
  getAssistantSupportTicket: assistantApiMocks.getAssistantSupportTicket,
  postAssistantSupportTicket: assistantApiMocks.postAssistantSupportTicket,
  postAssistantSupportTicketRead: assistantApiMocks.postAssistantSupportTicketRead
}));

vi.mock("./support-attachment-links", () => ({
  SupportAttachmentLinks: () => null
}));

describe("AssistantSupportSection", () => {
  beforeEach(() => {
    clerkMocks.getToken.mockResolvedValue("token-1");
    assistantApiMocks.getAssistantSupportTickets.mockResolvedValue([]);
    assistantApiMocks.getAssistantSupportTicket.mockResolvedValue(null);
    assistantApiMocks.postAssistantSupportTicket.mockResolvedValue(null);
    assistantApiMocks.postAssistantSupportTicketRead.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("keeps the new request form collapsed by default", async () => {
    render(<AssistantSupportSection assistantId="assistant-1" />);

    await waitFor(() => {
      expect(assistantApiMocks.getAssistantSupportTickets).toHaveBeenCalled();
    });

    expect(screen.getByText("supportNewRequest")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("supportSubjectOptional")).toBeNull();
    expect(screen.queryByPlaceholderText("supportBodyPlaceholder")).toBeNull();
  });

  it("expands the new request form only after the user opens it", async () => {
    render(<AssistantSupportSection assistantId="assistant-1" />);

    await waitFor(() => {
      expect(assistantApiMocks.getAssistantSupportTickets).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: /supportNewRequest/i }));

    expect(screen.getByPlaceholderText("supportSubjectOptional")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("supportBodyPlaceholder")).toBeInTheDocument();
  });
});
