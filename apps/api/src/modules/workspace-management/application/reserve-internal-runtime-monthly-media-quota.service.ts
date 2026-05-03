import { BadRequestException, Injectable } from "@nestjs/common";
import { createAssistantInboundConflict } from "./assistant-inbound-error";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./resolve-internal-runtime-tool-daily-policy.service";
import {
  TrackWorkspaceQuotaUsageService,
  type ReserveAssistantMonthlyMediaQuotaResult
} from "./track-workspace-quota-usage.service";
import type { WorkspaceMonthlyMediaQuotaToolCode } from "../domain/workspace-quota-accounting.repository";

export interface ReserveInternalRuntimeMonthlyMediaQuotaRequest {
  assistantId: string;
  toolCode: WorkspaceMonthlyMediaQuotaToolCode;
  units: number;
}

const MONTHLY_MEDIA_QUOTA_TOOL_CODES = new Set<string>([
  "image_generate",
  "image_edit",
  "video_generate"
]);

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeMonthlyMediaToolCode(value: unknown): WorkspaceMonthlyMediaQuotaToolCode {
  const toolCode = normalizeRequiredString(value, "toolCode");
  if (MONTHLY_MEDIA_QUOTA_TOOL_CODES.has(toolCode)) {
    return toolCode as WorkspaceMonthlyMediaQuotaToolCode;
  }
  throw new BadRequestException(
    "toolCode must be one of image_generate, image_edit, video_generate."
  );
}

function normalizeUnits(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException("units must be a positive integer.");
  }
  return value;
}

@Injectable()
export class ReserveInternalRuntimeMonthlyMediaQuotaService {
  constructor(
    private readonly resolveInternalRuntimeToolDailyPolicyService: ResolveInternalRuntimeToolDailyPolicyService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {}

  parseInput(payload: unknown): ReserveInternalRuntimeMonthlyMediaQuotaRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Monthly media quota payload must be an object.");
    }

    const row = payload as Record<string, unknown>;
    return {
      assistantId: normalizeRequiredString(row.assistantId, "assistantId"),
      toolCode: normalizeMonthlyMediaToolCode(row.toolCode),
      units: normalizeUnits(row.units)
    };
  }

  async execute(input: ReserveInternalRuntimeMonthlyMediaQuotaRequest): Promise<
    ReserveAssistantMonthlyMediaQuotaResult & {
      ok: true;
    }
  > {
    const resolved = await this.resolveInternalRuntimeToolDailyPolicyService.execute({
      assistantId: input.assistantId,
      toolCode: input.toolCode
    });
    const effectiveTool = resolved.tools[0];
    if (effectiveTool === undefined || effectiveTool.activationStatus !== "active") {
      throw createAssistantInboundConflict(
        "monthly_media_quota_rejected",
        `Media generation tool "${input.toolCode}" is no longer active on the effective plan.`,
        {
          toolCode: input.toolCode,
          effectivePlanCode: resolved.planCode
        }
      );
    }

    const result = await this.trackWorkspaceQuotaUsageService.reserveAssistantMonthlyMediaQuota({
      assistant: resolved.assistant,
      toolCode: input.toolCode,
      units: input.units
    });
    if (!result.allowed) {
      throw createAssistantInboundConflict(
        "monthly_media_quota_exceeded",
        `Monthly media quota reached for "${input.toolCode}".`,
        {
          toolCode: input.toolCode,
          currentUsedUnits: result.currentUsedUnits,
          limitUnits: result.limitUnits,
          requestedUnits: input.units,
          periodStartedAt: result.periodStartedAt,
          periodEndsAt: result.periodEndsAt,
          periodSource: result.periodSource
        }
      );
    }

    return {
      ok: true,
      ...result
    };
  }
}
