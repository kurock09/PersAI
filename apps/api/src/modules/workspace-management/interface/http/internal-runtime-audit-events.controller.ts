import { BadRequestException, Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { AssistantAuditOutcome } from "../../application/append-assistant-audit-event.service";
import { AppendAssistantAuditEventService } from "../../application/append-assistant-audit-event.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readOptionalString(row: Record<string, unknown>, key: string): string | null | undefined {
  const value = row[key];
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`${key} must be a string or null.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseInput(body: unknown) {
  if (!isRecord(body)) {
    throw new BadRequestException("Request body must be an object.");
  }
  const eventCategory = readOptionalString(body, "eventCategory");
  const eventCode = readOptionalString(body, "eventCode");
  const summary = readOptionalString(body, "summary");
  if (eventCategory === undefined || eventCategory === null) {
    throw new BadRequestException("eventCategory must be a non-empty string.");
  }
  if (eventCode === undefined || eventCode === null) {
    throw new BadRequestException("eventCode must be a non-empty string.");
  }
  if (summary === undefined || summary === null) {
    throw new BadRequestException("summary must be a non-empty string.");
  }
  const details = body.details;
  if (details !== undefined && !isRecord(details)) {
    throw new BadRequestException("details must be an object when provided.");
  }
  const outcomeRaw = readOptionalString(body, "outcome");
  if (
    outcomeRaw !== undefined &&
    outcomeRaw !== null &&
    outcomeRaw !== "succeeded" &&
    outcomeRaw !== "failed" &&
    outcomeRaw !== "degraded" &&
    outcomeRaw !== "denied"
  ) {
    throw new BadRequestException("outcome must be one of: succeeded, failed, degraded, denied.");
  }
  const outcome: AssistantAuditOutcome | undefined =
    outcomeRaw === undefined || outcomeRaw === null ? undefined : outcomeRaw;
  return {
    workspaceId: readOptionalString(body, "workspaceId") ?? null,
    assistantId: readOptionalString(body, "assistantId") ?? null,
    actorUserId: readOptionalString(body, "actorUserId") ?? null,
    eventCategory,
    eventCode,
    summary,
    ...(outcome === undefined ? {} : { outcome }),
    details: (details as Record<string, unknown> | undefined) ?? {}
  };
}

@Controller("api/v1/internal/runtime/audit-events")
export class InternalRuntimeAuditEventsController {
  constructor(
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  @HttpCode(204)
  @Post()
  async append(@Req() req: InternalRequestLike, @Body() body: unknown): Promise<void> {
    this.assertAuthorized(req);
    await this.appendAssistantAuditEventService.execute(parseInput(body));
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal endpoints.",
      "Internal authorization failed."
    );
  }
}
