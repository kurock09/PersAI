import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { RequestWithPlatformContext } from "../../../platform-core/interface/http/request-http.types";
import { ManageUserSupportService } from "../../application/support/manage-user-support.service";
import type {
  SupportTicketDetailView,
  SupportTicketSummaryView
} from "../../application/support/support.types";

@Controller("api/v1/support")
export class UserSupportController {
  constructor(private readonly manageUserSupportService: ManageUserSupportService) {}

  @Post("tickets")
  async createTicket(
    @Req() req: RequestWithPlatformContext,
    @Body() body: unknown
  ): Promise<{ requestId: string | null; ticket: SupportTicketDetailView }> {
    const userId = this.resolveUserId(req);
    const input = this.manageUserSupportService.parseCreateInput(body);
    const assistantId = this.parseAssistantId(body);
    const ticket = await this.manageUserSupportService.createTicket(userId, assistantId, input);
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

  private resolveUserId(req: RequestWithPlatformContext): string {
    if (req.resolvedAppUser === undefined) {
      throw new UnauthorizedException("Authenticated user context is missing.");
    }
    return req.resolvedAppUser.id;
  }

  private parseAssistantId(body: unknown): string {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("assistantId is required.");
    }
    const assistantId = (body as Record<string, unknown>).assistantId;
    if (typeof assistantId !== "string" || assistantId.trim().length === 0) {
      throw new BadRequestException("assistantId is required.");
    }
    return assistantId.trim();
  }
}
