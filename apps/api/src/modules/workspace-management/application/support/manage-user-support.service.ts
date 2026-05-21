import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { SupportTicketMessageAuthor } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import { AdminSystemNotificationProducerService } from "../admin-system-notification-producer.service";
import {
  formatSupportTicketShortId,
  type SupportTicketDetailView,
  type SupportTicketMessageView,
  type SupportTicketSummaryView
} from "./support.types";

const MAX_BODY_LENGTH = 8_000;
const MAX_SUBJECT_LENGTH = 200;

@Injectable()
export class ManageUserSupportService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminSystemNotificationProducerService: AdminSystemNotificationProducerService
  ) {}

  parseCreateInput(body: unknown): { body: string; subject: string | null } {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const record = body as Record<string, unknown>;
    const messageBody = typeof record.body === "string" ? record.body.trim() : "";
    if (messageBody.length < 3) {
      throw new BadRequestException("Message body must be at least 3 characters.");
    }
    if (messageBody.length > MAX_BODY_LENGTH) {
      throw new BadRequestException(`Message body must be at most ${MAX_BODY_LENGTH} characters.`);
    }
    const subjectRaw = typeof record.subject === "string" ? record.subject.trim() : "";
    const subject =
      subjectRaw.length > 0
        ? subjectRaw.length > MAX_SUBJECT_LENGTH
          ? subjectRaw.slice(0, MAX_SUBJECT_LENGTH)
          : subjectRaw
        : null;
    return { body: messageBody, subject };
  }

  async createTicket(
    userId: string,
    assistantId: string,
    input: { body: string; subject: string | null }
  ): Promise<SupportTicketDetailView> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: assistantId },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        draftDisplayName: true,
        user: { select: { email: true } }
      }
    });
    if (assistant === null || assistant.userId !== userId) {
      throw new ForbiddenException("Assistant not found for this user.");
    }

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        subject: input.subject,
        status: "open",
        messages: {
          create: {
            author: SupportTicketMessageAuthor.user,
            body: input.body
          }
        }
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: { adminUser: { select: { displayName: true, email: true } } }
        },
        user: { select: { email: true } },
        assistant: { select: { draftDisplayName: true } }
      }
    });

    const shortId = formatSupportTicketShortId(ticket.id);
    const preview = input.body.slice(0, 120);
    void this.adminSystemNotificationProducerService
      .emitEvent({
        eventCode: "support_ticket_opened",
        summary: `New support ticket #${shortId} from ${assistant.user.email}`,
        details: {
          ticketId: ticket.id,
          ticketShortId: shortId,
          userId,
          userEmail: assistant.user.email,
          assistantId: assistant.id,
          subject: input.subject,
          preview
        },
        traceId: ticket.id,
        priority: "immediate"
      })
      .catch(() => undefined);

    return this.toDetailView(ticket);
  }

  async listTicketsForAssistant(
    userId: string,
    assistantId: string
  ): Promise<SupportTicketSummaryView[]> {
    await this.assertAssistantOwned(userId, assistantId);
    const rows = await this.prisma.supportTicket.findMany({
      where: { userId, assistantId },
      orderBy: { updatedAt: "desc" },
      include: {
        messages: { orderBy: { createdAt: "asc" }, take: 1 }
      }
    });
    return rows.map((row) => this.toSummaryView(row));
  }

  async getTicket(userId: string, ticketId: string): Promise<SupportTicketDetailView> {
    const ticket = await this.requireTicketForUser(userId, ticketId);
    return this.toDetailView(ticket);
  }

  private async assertAssistantOwned(userId: string, assistantId: string): Promise<void> {
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: assistantId },
      select: { userId: true }
    });
    if (assistant === null || assistant.userId !== userId) {
      throw new ForbiddenException("Assistant not found for this user.");
    }
  }

  private async requireTicketForUser(userId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: { adminUser: { select: { displayName: true, email: true } } }
        },
        user: { select: { email: true } },
        assistant: { select: { draftDisplayName: true } }
      }
    });
    if (ticket === null || ticket.userId !== userId) {
      throw new NotFoundException("Support ticket not found.");
    }
    return ticket;
  }

  private toSummaryView(row: {
    id: string;
    status: SupportTicketDetailView["status"];
    subject: string | null;
    createdAt: Date;
    updatedAt: Date;
    answeredAt: Date | null;
    closedAt: Date | null;
    messages: Array<{ body: string }>;
  }): SupportTicketSummaryView {
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
      closedAt: row.closedAt?.toISOString() ?? null
    };
  }

  private toDetailView(row: {
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
    }>;
  }): SupportTicketDetailView {
    const summary = this.toSummaryView({ ...row, messages: row.messages.slice(0, 1) });
    return {
      ...summary,
      assistantId: row.assistantId,
      workspaceId: row.workspaceId,
      userId: row.userId,
      userEmail: row.user.email,
      assistantDisplayName: row.assistant.draftDisplayName,
      messages: row.messages.map((message) => ({
        id: message.id,
        author: message.author,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
        adminDisplayName:
          message.adminUser?.displayName ?? message.adminUser?.email?.split("@")[0] ?? null
      }))
    };
  }
}
