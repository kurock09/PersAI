import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantSupportSection } from "./assistant-support-section";
import type { SupportTicketDetail, SupportTicketSummary } from "../assistant-api-client";

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

const translateMock = vi.hoisted(() =>
  vi.fn((key: string, values?: { count?: number }) => {
    if (key === "supportShowClosed" && values?.count !== undefined) {
      return `${key}:${values.count}`;
    }
    return key;
  })
);

vi.mock("next-intl", () => ({
  useTranslations: () => translateMock
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

function makeTicket(overrides: Partial<SupportTicketSummary> = {}): SupportTicketSummary {
  return {
    id: "ticket-1",
    shortId: "AAB845D3",
    status: "open",
    subject: null,
    preview: "Расскажи про себя",
    createdAt: "2026-05-30T10:00:00.000Z",
    updatedAt: "2026-05-30T10:00:00.000Z",
    answeredAt: null,
    closedAt: null,
    hasUnread: false,
    ...overrides
  };
}

function makeDetail(ticket: SupportTicketSummary): SupportTicketDetail {
  return {
    ...ticket,
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    userEmail: "user@example.com",
    assistantDisplayName: "Assistant",
    messages: [
      {
        id: "message-1",
        author: "user",
        body: ticket.preview,
        createdAt: ticket.createdAt,
        attachments: [],
        adminDisplayName: null
      }
    ]
  };
}

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

  it("hides closed tickets by default and reveals them on demand", async () => {
    const openTicket = makeTicket({
      id: "ticket-open",
      shortId: "OPEN0001",
      status: "open",
      preview: "Active request"
    });
    const closedTicket = makeTicket({
      id: "ticket-closed",
      shortId: "CLOSED01",
      status: "closed",
      preview: "Closed request"
    });
    assistantApiMocks.getAssistantSupportTickets.mockResolvedValue([openTicket, closedTicket]);

    render(<AssistantSupportSection assistantId="assistant-1" />);

    await waitFor(() => {
      expect(screen.getByText("Active request")).toBeInTheDocument();
    });

    expect(screen.queryByText("Closed request")).toBeNull();
    expect(screen.getByText("supportShowClosed:1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /supportShowClosed:1/i }));

    expect(screen.getByText("Closed request")).toBeInTheDocument();
    expect(screen.getByText("supportHideClosed")).toBeInTheDocument();
  });

  it("opens the ticket dialogue in a modal instead of expanding inline", async () => {
    const ticket = makeTicket({
      id: "ticket-open",
      shortId: "OPEN0001",
      preview: "Need help"
    });
    assistantApiMocks.getAssistantSupportTickets.mockResolvedValue([ticket]);
    assistantApiMocks.getAssistantSupportTicket.mockResolvedValue(makeDetail(ticket));
    assistantApiMocks.postAssistantSupportTicketRead.mockResolvedValue(
      makeDetail({ ...ticket, hasUnread: false })
    );

    render(<AssistantSupportSection assistantId="assistant-1" />);

    await waitFor(() => {
      expect(screen.getByText("Need help")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /#OPEN0001/i }));

    await waitFor(() => {
      expect(assistantApiMocks.getAssistantSupportTicket).toHaveBeenCalledWith(
        "token-1",
        "ticket-open"
      );
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /#OPEN0001/i })).toBeInTheDocument();
    expect(screen.getAllByText("Need help").length).toBeGreaterThan(1);
  });
});
