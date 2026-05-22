import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { SupportTicketMessageAuthor } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import { AdminAuthorizationService } from "../admin-authorization.service";
import { UserSupportNotificationProducerService } from "./user-support-notification-producer.service";
import { SUPPORT_SYSTEM_MESSAGE_CODE_PENDING } from "./support-user-messages";
import { ManageSupportAttachmentsService } from "./manage-support-attachments.service";
import {
  formatSupportTicketShortId,
  type SupportTicketDetailView,
  type SupportTicketMessageView,
  type SupportTicketSummaryView
} from "./support.types";

const MAX_BODY_LENGTH = 8_000;

type TicketRow = {
  id: string;
  userId: string;
  workspaceId: string;
  assistantId: string;
  status: SupportTicketDetailView["status"];
  subject: string | null;
  createdAt: Date;
  updatedAt: Date;
  answeredAt: Date | null;
  closedAt: Date | null;
  user: { email: string };
  assistant: { draftDisplayName: string | null };
  messages: Array<{
    id: string;
    author: SupportTicketMessageView["author"];
    body: string;
    createdAt: Date;
    adminUser: { displayName: string | null; email: string } | null;
    attachments: Array<{
      id: string;
      mimeType: string;
      fileName: string | null;
      sizeBytes: number;
      createdAt: Date;
    }>;
  }>;
};

@Injectable()
export class ManageAdminSupportService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly userSupportNotificationProducerService: UserSupportNotificationProducerService,
    private readonly manageSupportAttachmentsService: ManageSupportAttachmentsService
  ) {}

  parseReplyInput(body: unknown): { body: string } {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const rawBody = (body as Record<string, unknown>).body;
    const messageBody = typeof rawBody === "string" ? rawBody.trim() : "";
    if (messageBody.length < 3) {
      throw new BadRequestException("Reply body must be at least 3 characters.");
    }
    if (messageBody.length > MAX_BODY_LENGTH) {
      throw new BadRequestException(`Reply body must be at most ${MAX_BODY_LENGTH} characters.`);
    }
    return { body: messageBody };
  }

  async listTickets(
    callerUserId: string,
    query: { status?: string | null; limit?: number }
  ): Promise<{ tickets: SupportTicketSummaryView[] }> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    const status = this.parseStatusFilter(query.status);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const rows = await this.prisma.supportTicket.findMany({
      ...(status ? { where: { status } } : {}),
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        messages: { orderBy: { createdAt: "asc" }, take: 1 },
        user: { select: { email: true } }
      }
    });
    return {
      tickets: rows.map((row) => ({
        id: row.id,
        shortId: formatSupportTicketShortId(row.id),
        status: row.status,
        subject: row.subject,
        preview: (row.messages[0]?.body ?? row.subject ?? "").slice(0, 120),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        answeredAt: row.answeredAt?.toISOString() ?? null,
        closedAt: row.closedAt?.toISOString() ?? null,
        hasUnread: false,
        userEmail: row.user.email
      }))
    };
  }

  async getTicket(callerUserId: string, ticketId: string): Promise<SupportTicketDetailView> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    const ticket = await this.requireTicket(ticketId);
    return this.toDetailView(ticket);
  }

  async reply(
    callerUserId: string,
    ticketId: string,
    input: { body: string }
  ): Promise<SupportTicketDetailView> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    const existing = await this.requireTicket(ticketId);
    if (existing.status === "closed") {
      throw new BadRequestException("Cannot reply to a closed ticket.");
    }

    const replyMessage = await this.prisma.supportTicketMessage.create({
      data: {
        ticketId,
        author: SupportTicketMessageAuthor.admin,
        body: input.body,
        adminUserId: callerUserId
      }
    });

    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: "answered",
        answeredAt: new Date(),
        updatedAt: new Date()
      }
    });

    const ticket = await this.requireTicket(ticketId);
    await this.userSupportNotificationProducerService.notifyReplySent({
      ticket: this.toDetailView(ticket),
      replyMessageId: replyMessage.id,
      replyBody: input.body,
      recipientEmail: ticket.user.email
    });

    return this.toDetailView(ticket);
  }

  async markPending(callerUserId: string, ticketId: string): Promise<SupportTicketDetailView> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    await this.requireTicket(ticketId);
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: "pending", updatedAt: new Date() }
    });
    await this.prisma.supportTicketMessage.create({
      data: {
        ticketId,
        author: SupportTicketMessageAuthor.system,
        body: SUPPORT_SYSTEM_MESSAGE_CODE_PENDING,
        adminUserId: null
      }
    });
    return this.toDetailView(await this.requireTicket(ticketId));
  }

  async close(callerUserId: string, ticketId: string): Promise<SupportTicketDetailView> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(callerUserId);
    await this.requireTicket(ticketId);
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: "closed",
        closedAt: new Date(),
        updatedAt: new Date()
      }
    });
    return this.toDetailView(await this.requireTicket(ticketId));
  }

  private parseStatusFilter(value: string | null | undefined) {
    if (value === undefined || value === null || value.trim() === "") {
      return null;
    }
    const normalized = value.trim();
    if (
      normalized === "open" ||
      normalized === "pending" ||
      normalized === "answered" ||
      normalized === "closed"
    ) {
      return normalized;
    }
    throw new BadRequestException("Invalid status filter.");
  }

  private async requireTicket(ticketId: string): Promise<TicketRow> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: {
            adminUser: { select: { displayName: true, email: true } },
            attachments: { orderBy: { createdAt: "asc" } }
          }
        },
        user: { select: { email: true } },
        assistant: { select: { draftDisplayName: true } }
      }
    });
    if (ticket === null) {
      throw new NotFoundException("Support ticket not found.");
    }
    return ticket;
  }

  private toDetailView(row: TicketRow): SupportTicketDetailView {
    const previewSource = row.messages[0]?.body ?? row.subject ?? "";
    return {
      id: row.id,
      shortId: formatSupportTicketShortId(row.id),
      status: row.status,
      subject: row.subject,
      preview: previewSource.slice(0, 120),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      answeredAt: row.answeredAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      assistantId: row.assistantId,
      workspaceId: row.workspaceId,
      userId: row.userId,
      userEmail: row.user.email,
      assistantDisplayName: row.assistant.draftDisplayName,
      hasUnread: false,
      messages: row.messages.map((message) => ({
        id: message.id,
        author: message.author,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
        adminDisplayName:
          message.adminUser?.displayName ?? message.adminUser?.email?.split("@")[0] ?? null,
        attachments: message.attachments.map((attachment) =>
          this.manageSupportAttachmentsService.toView(attachment)
        )
      }))
    };
  }
}
