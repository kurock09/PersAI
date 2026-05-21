import type { SupportTicketMessageAuthor, SupportTicketStatus } from "@prisma/client";

export type SupportTicketMessageView = {
  id: string;
  author: SupportTicketMessageAuthor;
  body: string;
  createdAt: string;
  adminDisplayName: string | null;
};

export type SupportTicketSummaryView = {
  id: string;
  shortId: string;
  status: SupportTicketStatus;
  subject: string | null;
  preview: string;
  createdAt: string;
  updatedAt: string;
  answeredAt: string | null;
  closedAt: string | null;
  userEmail?: string;
};

export type SupportTicketDetailView = SupportTicketSummaryView & {
  assistantId: string;
  workspaceId: string;
  userId: string;
  userEmail: string;
  assistantDisplayName: string | null;
  messages: SupportTicketMessageView[];
};

export function formatSupportTicketShortId(ticketId: string): string {
  return ticketId.replace(/-/g, "").slice(0, 8).toUpperCase();
}
