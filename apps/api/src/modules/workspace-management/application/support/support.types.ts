import type { SupportTicketMessageAuthor, SupportTicketStatus } from "@prisma/client";
import type { SupportTicketAttachmentView } from "./manage-support-attachments.service";

export type SupportTicketMessageView = {
  id: string;
  author: SupportTicketMessageAuthor;
  body: string;
  createdAt: string;
  adminDisplayName: string | null;
  attachments: SupportTicketAttachmentView[];
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
  hasUnread: boolean;
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

export function computeSupportTicketHasUnread(input: {
  userLastReadAt: Date | null;
  messages: Array<{ author: SupportTicketMessageAuthor; createdAt: Date }>;
}): boolean {
  const readCursor = input.userLastReadAt?.getTime() ?? 0;
  return input.messages.some(
    (message) => message.author === "admin" && message.createdAt.getTime() > readCursor
  );
}
