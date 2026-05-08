import { BadRequestException, Injectable } from "@nestjs/common";
import { createAssistantInboundConflict } from "./assistant-inbound-error";
import { QuotaGroundedLimitCopyService } from "./quota-grounded-limit-copy.service";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./resolve-internal-runtime-tool-daily-policy.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";

export interface ConsumeInternalRuntimeToolDailyLimitRequest {
  assistantId: string;
  toolCode: string;
  /**
   * The daily-call-limit the *runtime* observed in its bundle when it
   * decided to make this call. Reported back to the API for telemetry
   * and conflict-error context only — the API always re-resolves the
   * effective limit from the live plan as the source of truth. May be
   * null when the runtime sees no limit; the call still counts for
   * observability (ADR-074 L1.1 always-count anchor).
   */
  dailyCallLimit: number | null;
  units: number;
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeOptionalPositiveInteger(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(`${fieldName} must be a positive integer or null when provided.`);
  }
  return value;
}

/**
 * ADR-074 L1.1 — `units` is the artifact-weight of this single tool call
 * (defaults to 1 for backward-compatible callers). Cost tools that
 * legitimately produce N artifacts per single call (canonical case:
 * `image_generate({ count: N })`) advance the daily counter by N. The
 * value is optional in the wire payload to keep older runtime workers
 * compatible during a rolling deploy: an absent or null `units` field is
 * treated as 1, while non-positive integers are rejected so a buggy
 * caller cannot zero or reverse the counter.
 */
function normalizeOptionalUnits(value: unknown, fieldName: string): number {
  if (value === undefined || value === null) {
    return 1;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(`${fieldName} must be a positive integer when provided.`);
  }
  return value;
}

@Injectable()
export class ConsumeInternalRuntimeToolDailyLimitService {
  constructor(
    private readonly resolveInternalRuntimeToolDailyPolicyService: ResolveInternalRuntimeToolDailyPolicyService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly quotaGroundedLimitCopyService: QuotaGroundedLimitCopyService
  ) {}

  parseInput(payload: unknown): ConsumeInternalRuntimeToolDailyLimitRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Tool limit payload must be an object.");
    }

    const row = payload as Record<string, unknown>;
    return {
      assistantId: normalizeRequiredString(row.assistantId, "assistantId"),
      toolCode: normalizeRequiredString(row.toolCode, "toolCode"),
      dailyCallLimit: normalizeOptionalPositiveInteger(row.dailyCallLimit, "dailyCallLimit"),
      units: normalizeOptionalUnits(row.units, "units")
    };
  }

  async execute(input: ConsumeInternalRuntimeToolDailyLimitRequest): Promise<{
    ok: true;
    currentCount: number;
    limit: number | null;
  }> {
    const resolved = await this.resolveInternalRuntimeToolDailyPolicyService.execute({
      assistantId: input.assistantId,
      toolCode: input.toolCode
    });
    const effectiveTool = resolved.tools[0];
    const effectiveLimit = effectiveTool?.dailyCallLimit ?? null;

    // ADR-074 L1.1 — the only blocking condition here is "tool was
    // deactivated on the plan after the runtime started its turn".
    // A null/zero `effectiveLimit` is now legal: we still consume one
    // observability unit per call so the founder dashboard sees
    // unlimited-tool traffic, instead of treating "no cap" as "no
    // counter" (the second hole the L1.1 audit closed).
    if (effectiveTool === undefined || effectiveTool.activationStatus !== "active") {
      const copy = await this.quotaGroundedLimitCopyService.build({
        assistantId: input.assistantId,
        code: "tool_daily_limit_reached",
        details: {
          toolCode: input.toolCode,
          runtimeReportedLimit: input.dailyCallLimit,
          effectivePlanCode: resolved.planCode
        }
      });
      throw createAssistantInboundConflict(
        "tool_daily_limit_reached",
        copy?.message ??
          `Daily tool usage policy for "${input.toolCode}" is no longer active on the effective plan.`,
        {
          toolCode: input.toolCode,
          runtimeReportedLimit: input.dailyCallLimit,
          effectivePlanCode: resolved.planCode,
          ...(copy?.guidance ? { userFacingGuidance: copy.guidance } : {})
        }
      );
    }

    const result = await this.trackWorkspaceQuotaUsageService.consumeToolDailyLimit({
      assistant: resolved.assistant,
      toolCode: input.toolCode,
      dailyCallLimit: effectiveLimit,
      units: input.units
    });

    if (!result.allowed) {
      const copy = await this.quotaGroundedLimitCopyService.build({
        assistantId: input.assistantId,
        code: "tool_daily_limit_reached",
        details: {
          toolCode: input.toolCode,
          currentCount: result.currentCount,
          limit: result.limit,
          requestedUnits: input.units,
          runtimeReportedLimit: input.dailyCallLimit
        }
      });
      throw createAssistantInboundConflict(
        "tool_daily_limit_reached",
        copy?.message ?? `Daily tool usage limit reached for "${input.toolCode}".`,
        {
          toolCode: input.toolCode,
          currentCount: result.currentCount,
          limit: result.limit,
          requestedUnits: input.units,
          runtimeReportedLimit: input.dailyCallLimit,
          ...(copy?.guidance ? { userFacingGuidance: copy.guidance } : {})
        }
      );
    }

    return {
      ok: true,
      currentCount: result.currentCount,
      limit: result.limit
    };
  }
}
