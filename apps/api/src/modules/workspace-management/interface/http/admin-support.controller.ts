import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import type {
  RequestWithPlatformContext,
  ResponseWithPlatformContext
} from "../../../platform-core/interface/http/request-http.types";
import { ManageSupportAttachmentsService } from "../../application/support/manage-support-attachments.service";
import { ManageAdminSupportService } from "../../application/support/manage-admin-support.service";
import type {
  SupportTicketDetailView,
  SupportTicketSummaryView
} from "../../application/support/support.types";

@Controller("api/v1/admin/support")
export class AdminSupportController {
  constructor(
    private readonly manageAdminSupportService: ManageAdminSupportService,
    private readonly manageSupportAttachmentsService: ManageSupportAttachmentsService
  ) {}

  @Get("tickets")
  async listTickets(
    @Req() req: RequestWithPlatformContext,
    @Query("status") status?: string,
    @Query("limit") limitRaw?: string
  ): Promise<{ requestId: string | null; tickets: SupportTicketSummaryView[] }> {
    const callerId = this.resolveUserId(req);
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const listQuery: { status?: string | null; limit?: number } = {
      status: status ?? null
    };
    if (typeof limit === "number" && Number.isFinite(limit)) {
      listQuery.limit = limit;
    }
    const result = await this.manageAdminSupportService.listTickets(callerId, listQuery);
    return { requestId: req.requestId ?? null, tickets: result.tickets };
  }

  @Get("tickets/:ticketId")
  async getTicket(
    @Req() req: RequestWithPlatformContext,
    @Param("ticketId") ticketId: string
  ): Promise<{ requestId: string | null; ticket: SupportTicketDetailView }> {
    const callerId = this.resolveUserId(req);
    const ticket = await this.manageAdminSupportService.getTicket(callerId, ticketId.trim());
    return { requestId: req.requestId ?? null, ticket };
  }

  @Post("tickets/:ticketId/reply")
  @HttpCode(HttpStatus.OK)
  async reply(
    @Req() req: RequestWithPlatformContext,
    @Param("ticketId") ticketId: string,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; ticket: SupportTicketDetailView }> {
    const callerId = this.resolveUserId(req);
    const input = this.manageAdminSupportService.parseReplyInput(body);
    const ticket = await this.manageAdminSupportService.reply(callerId, ticketId.trim(), input);
    return { requestId: req.requestId ?? null, ticket };
  }

  @Post("tickets/:ticketId/pending")
  @HttpCode(HttpStatus.OK)
  async markPending(
    @Req() req: RequestWithPlatformContext,
    @Param("ticketId") ticketId: string
  ): Promise<{ requestId: string | null; ticket: SupportTicketDetailView }> {
    const callerId = this.resolveUserId(req);
    const ticket = await this.manageAdminSupportService.markPending(callerId, ticketId.trim());
    return { requestId: req.requestId ?? null, ticket };
  }

  @Get("attachments/:attachmentId")
  async downloadAttachment(
    @Req() req: RequestWithPlatformContext,
    @Param("attachmentId") attachmentId: string,
    @Res() res: ResponseWithPlatformContext
  ): Promise<void> {
    const callerId = this.resolveUserId(req);
    await this.manageSupportAttachmentsService.streamForAdmin(callerId, attachmentId.trim(), res);
  }

  @Post("tickets/:ticketId/close")
  @HttpCode(HttpStatus.OK)
  async close(
    @Req() req: RequestWithPlatformContext,
    @Param("ticketId") ticketId: string
  ): Promise<{ requestId: string | null; ticket: SupportTicketDetailView }> {
    const callerId = this.resolveUserId(req);
    const ticket = await this.manageAdminSupportService.close(callerId, ticketId.trim());
    return { requestId: req.requestId ?? null, ticket };
  }

  private resolveUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }
}
