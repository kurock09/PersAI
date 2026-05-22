import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import type { ResponseWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageSupportAttachmentsService } from "../../application/support/manage-support-attachments.service";
import { ManageUserSupportService } from "../../application/support/manage-user-support.service";
import { SUPPORT_ATTACHMENT_MAX_BYTES } from "../../application/support/manage-support-attachments.service";
import type {
  SupportTicketDetailView,
  SupportTicketSummaryView
} from "../../application/support/support.types";

@Controller("api/v1/support")
export class UserSupportController {
  constructor(
    private readonly manageUserSupportService: ManageUserSupportService,
    private readonly manageSupportAttachmentsService: ManageSupportAttachmentsService
  ) {}

  @Post("tickets")
  @UseInterceptors(
    FileInterceptor("attachment", { limits: { fileSize: SUPPORT_ATTACHMENT_MAX_BYTES } })
  )
  async createTicket(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown,
    @UploadedFile()
    attachment: { buffer: Buffer; mimetype: string; originalname: string } | undefined
  ): Promise<{ requestId: string | null; ticket: SupportTicketDetailView }> {
    const userId = this.resolveUserId(req);
    const parsed = this.manageUserSupportService.parseCreateMultipart({ body, file: attachment });
    const ticket = await this.manageUserSupportService.createTicket(
      userId,
      parsed.assistantId,
      { body: parsed.body, subject: parsed.subject },
      parsed.file
    );
    return { requestId: req.requestId ?? null, ticket };
  }

  @Get("assistants/:assistantId/tickets")
  async listAssistantTickets(
    @Req() req: RequestWithPlatformContext,
    @Param("assistantId") assistantId: string
  ): Promise<{ requestId: string | null; tickets: SupportTicketSummaryView[] }> {
    const userId = this.resolveUserId(req);
    const tickets = await this.manageUserSupportService.listTicketsForAssistant(
      userId,
      assistantId.trim()
    );
    return { requestId: req.requestId ?? null, tickets };
  }

  @Get("tickets/:ticketId")
  async getTicket(
    @Req() req: RequestWithPlatformContext,
    @Param("ticketId") ticketId: string
  ): Promise<{ requestId: string | null; ticket: SupportTicketDetailView }> {
    const userId = this.resolveUserId(req);
    const ticket = await this.manageUserSupportService.getTicket(userId, ticketId.trim());
    return { requestId: req.requestId ?? null, ticket };
  }

  @Post("tickets/:ticketId/read")
  async markTicketRead(
    @Req() req: RequestWithPlatformContext,
    @Param("ticketId") ticketId: string
  ): Promise<{ requestId: string | null; ticket: SupportTicketDetailView }> {
    const userId = this.resolveUserId(req);
    const ticket = await this.manageUserSupportService.markTicketRead(userId, ticketId.trim());
    return { requestId: req.requestId ?? null, ticket };
  }

  @Get("attachments/:attachmentId")
  async downloadAttachment(
    @Req() req: RequestWithPlatformContext,
    @Param("attachmentId") attachmentId: string,
    @Res() res: ResponseWithPlatformContext
  ): Promise<void> {
    const userId = this.resolveUserId(req);
    await this.manageSupportAttachmentsService.streamForUser(userId, attachmentId.trim(), res);
  }

  private resolveUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
