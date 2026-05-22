import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { SupportTicketMessageAuthor } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../../infrastructure/persistence/workspace-management-prisma.service";
import { AdminSystemNotificationProducerService } from "../admin-system-notification-producer.service";
import { ManageSupportAttachmentsService } from "./manage-support-attachments.service";
import {
  computeSupportTicketHasUnread,
  formatSupportTicketShortId,
  type SupportTicketDetailView,
  type SupportTicketMessageView,
  type SupportTicketSummaryView
} from "./support.types";

const MAX_BODY_LENGTH = 8_000;
const MAX_SUBJECT_LENGTH = 200;

type TicketWithMessages = {
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
  userLastReadAt: Date | null;
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
export class ManageUserSupportService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly adminSystemNotificationProducerService: AdminSystemNotificationProducerService,
    private readonly manageSupportAttachmentsService: ManageSupportAttachmentsService
  ) {}

  parseCreateInput(body: unknown): { body: string; subject: string | null } {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const record = body as Record<string, unknown>;
    const messageBody = typeof record.body === "string" ? record.body.trim() : "";
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

  parseCreateMultipart(input: {
    body: unknown;
    file?: { buffer: Buffer; mimetype: string; originalname: string } | undefined;
  }): {
    assistantId: string;
    body: string;
    subject: string | null;
    file?: { buffer: Buffer; mimetype: string; originalname: string };
  } {
    if (input.body === null || typeof input.body !== "object" || Array.isArray(input.body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const record = input.body as Record<string, unknown>;
    const assistantId = typeof record.assistantId === "string" ? record.assistantId.trim() : "";
    if (assistantId.length === 0) {
      throw new BadRequestException("assistantId is required.");
    }
    const parsed = this.parseCreateInput(record);
    if (parsed.body.length < 3 && input.file === undefined) {
      throw new BadRequestException(
        "Message body must be at least 3 characters when no attachment is provided."
      );
    }
    return {
      assistantId,
      body: parsed.body,
      subject: parsed.subject,
      ...(input.file !== undefined ? { file: input.file } : {})
    };
  }

  async createTicket(
    userId: string,
    assistantId: string,
    input: { body: string; subject: string | null },
    file?: { buffer: Buffer; mimetype: string; originalname: string }
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

    const now = new Date();
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        subject: input.subject,
        status: "open",
        userLastReadAt: now,
        messages: {
          create: {
            author: SupportTicketMessageAuthor.user,
            body: input.body.length > 0 ? input.body : " "
          }
        }
      },
      include: this.ticketInclude()
    });

    const firstMessage = ticket.messages[0];
    if (firstMessage === undefined) {
      throw new NotFoundException("Support ticket message missing.");
    }

    if (file !== undefined) {
      await this.manageSupportAttachmentsService.validateAndStoreForMessage({
        assistantId: assistant.id,
        ticketId: ticket.id,
        messageId: firstMessage.id,
        file
      });
    }

    const hydratedTicket =
      file !== undefined
        ? await this.prisma.supportTicket.findUniqueOrThrow({
            where: { id: ticket.id },
            include: this.ticketInclude()
          })
        : ticket;

    const shortId = formatSupportTicketShortId(ticket.id);
    const preview = input.body.length > 0 ? input.body.slice(0, 120) : (file?.originalname ?? "");
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
          preview,
          hasAttachment: file !== undefined
        },
        traceId: ticket.id,
        priority: "immediate"
      })
      .catch(() => undefined);

    return this.toDetailView(hydratedTicket);
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
    return rows.map((row) => this.toSummaryView(row));
  }

  async getTicket(userId: string, ticketId: string): Promise<SupportTicketDetailView> {
    const ticket = await this.requireTicketForUser(userId, ticketId);
    return this.toDetailView(ticket);
  }

  async markTicketRead(userId: string, ticketId: string): Promise<SupportTicketDetailView> {
    await this.requireTicketForUser(userId, ticketId);
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { userLastReadAt: new Date() },
      include: this.ticketInclude()
    });
    return this.toDetailView(updated);
  }

  private ticketInclude() {
    return {
      messages: {
        orderBy: { createdAt: "asc" as const },
        include: {
          adminUser: { select: { displayName: true, email: true } },
          attachments: { orderBy: { createdAt: "asc" as const } }
        }
      },
      user: { select: { email: true } },
      assistant: { select: { draftDisplayName: true } }
    };
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

  private async requireTicketForUser(
    userId: string,
    ticketId: string
  ): Promise<TicketWithMessages> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: this.ticketInclude()
    });
    if (ticket === null || ticket.userId !== userId) {
      throw new NotFoundException("Support ticket not found.");
    }
    return ticket;
  }

  private toSummaryView(row: TicketWithMessages): SupportTicketSummaryView {
    const previewSource =
      row.messages.find((message) => message.body.trim().length > 0)?.body ??
      row.messages[0]?.attachments[0]?.fileName ??
      row.subject ??
      "";
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
      hasUnread: computeSupportTicketHasUnread({
        userLastReadAt: row.userLastReadAt,
        messages: row.messages
      })
    };
  }

  private toDetailView(row: TicketWithMessages): SupportTicketDetailView {
    const summary = this.toSummaryView(row);
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
          message.adminUser?.displayName ?? message.adminUser?.email?.split("@")[0] ?? null,
        attachments: message.attachments.map((attachment) =>
          this.manageSupportAttachmentsService.toView(attachment)
        )
      }))
    };
  }
}
