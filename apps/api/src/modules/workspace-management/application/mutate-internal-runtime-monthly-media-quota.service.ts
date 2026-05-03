import { BadRequestException, Injectable } from "@nestjs/common";
import { ResolveInternalRuntimeToolDailyPolicyService } from "./resolve-internal-runtime-tool-daily-policy.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type { WorkspaceMonthlyMediaQuotaToolCode } from "../domain/workspace-quota-accounting.repository";

export interface MutateInternalRuntimeMonthlyMediaQuotaRequest {
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
export class MutateInternalRuntimeMonthlyMediaQuotaService {
  constructor(
    private readonly resolveInternalRuntimeToolDailyPolicyService: ResolveInternalRuntimeToolDailyPolicyService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {}

  parseInput(payload: unknown): MutateInternalRuntimeMonthlyMediaQuotaRequest {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Monthly media quota mutation payload must be an object.");
    }

    const row = payload as Record<string, unknown>;
    return {
      assistantId: normalizeRequiredString(row.assistantId, "assistantId"),
      toolCode: normalizeMonthlyMediaToolCode(row.toolCode),
      units: normalizeUnits(row.units)
    };
  }

  async release(input: MutateInternalRuntimeMonthlyMediaQuotaRequest): Promise<{ ok: true }> {
    const resolved = await this.resolveInternalRuntimeToolDailyPolicyService.execute({
      assistantId: input.assistantId,
      toolCode: input.toolCode
    });
    await this.trackWorkspaceQuotaUsageService.releaseAssistantMonthlyMediaQuota({
      assistant: resolved.assistant,
      toolCode: input.toolCode,
      units: input.units
    });
    return { ok: true };
  }

  async markReconciliationRequired(
    input: MutateInternalRuntimeMonthlyMediaQuotaRequest
  ): Promise<{ ok: true }> {
    const resolved = await this.resolveInternalRuntimeToolDailyPolicyService.execute({
      assistantId: input.assistantId,
      toolCode: input.toolCode
    });
    await this.trackWorkspaceQuotaUsageService.markAssistantMonthlyMediaQuotaReconciliationRequired(
      {
        assistant: resolved.assistant,
        toolCode: input.toolCode,
        units: input.units
      }
    );
    return { ok: true };
  }
}
