import { BadRequestException, Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  InternalRuntimeSkillStateService,
  type SkillStateInput
} from "../../application/internal-runtime-skill-state.service";
import { createAssistantInboundValidationError } from "../../application/assistant-inbound-error";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/skill")
export class InternalRuntimeSkillStateController {
  constructor(
    private readonly internalRuntimeSkillStateService: InternalRuntimeSkillStateService
  ) {}

  @HttpCode(200)
  @Post("state")
  async updateState(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{
    ok: true;
    applied: boolean;
    action: string;
    code: string | null;
    message: string | null;
    skillId: string | null;
    skillDisplayName: string | null;
    scenarioKey: string | null;
    scenarioDisplayName: string | null;
    previousSkillId: string | null;
  }> {
    this.assertAuthorized(req);
    const input = this.parseBody(body);
    const result = await this.internalRuntimeSkillStateService.apply(input);
    if (result.action === "stale") {
      return {
        ok: true,
        applied: false,
        action: "stale",
        code: result.code,
        message: result.message,
        skillId: null,
        skillDisplayName: null,
        scenarioKey: null,
        scenarioDisplayName: null,
        previousSkillId: null
      };
    }
    if (result.action === "engaged") {
      return {
        ok: true,
        applied: true,
        action: "engaged",
        code: null,
        message: null,
        skillId: result.skillId,
        skillDisplayName: result.skillDisplayName,
        scenarioKey: result.scenarioKey,
        scenarioDisplayName: result.scenarioDisplayName,
        previousSkillId: null
      };
    }
    return {
      ok: true,
      applied: true,
      action: "released",
      code: null,
      message: null,
      skillId: null,
      skillDisplayName: null,
      scenarioKey: null,
      scenarioDisplayName: null,
      previousSkillId: result.previousSkillId
    };
  }

  private parseBody(body: unknown): SkillStateInput {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new BadRequestException("Invalid skill state request body.");
    }
    const row = body as Record<string, unknown>;
    const assistantId = typeof row.assistantId === "string" ? row.assistantId.trim() : null;
    if (!assistantId) {
      throw new BadRequestException("assistantId is required.");
    }
    this.assertUuid(
      assistantId,
      "runtime_skill_state_invalid_assistant_id",
      "assistantId must be a valid UUID."
    );
    const channel = typeof row.channel === "string" ? row.channel.trim() : null;
    if (!channel) {
      throw new BadRequestException("channel is required.");
    }
    const surfaceThreadKey =
      typeof row.surfaceThreadKey === "string" ? row.surfaceThreadKey.trim() : null;
    if (!surfaceThreadKey) {
      throw new BadRequestException("surfaceThreadKey is required.");
    }
    const action = row.action === "engage" || row.action === "release" ? row.action : null;
    if (action === null) {
      throw new BadRequestException('action must be "engage" or "release".');
    }
    const skillId =
      row.skillId === null || row.skillId === undefined
        ? null
        : typeof row.skillId === "string"
          ? row.skillId.trim()
          : null;
    const scenarioKey =
      row.scenarioKey === null || row.scenarioKey === undefined
        ? null
        : typeof row.scenarioKey === "string"
          ? row.scenarioKey.trim() || null
          : null;
    const expectedRoleId = typeof row.expectedRoleId === "string" ? row.expectedRoleId.trim() : "";
    this.assertUuid(
      expectedRoleId,
      "runtime_skill_state_invalid_expected_role_id",
      "expectedRoleId must be a valid UUID."
    );
    if (action === "engage") {
      if (!skillId) {
        throw new BadRequestException("skillId is required for engage action.");
      }
      this.assertUuid(
        skillId,
        "runtime_skill_state_invalid_skill_id",
        "skillId must be a valid UUID."
      );
    }
    return { assistantId, channel, surfaceThreadKey, action, expectedRoleId, skillId, scenarioKey };
  }

  private assertUuid(value: string, code: string, message: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw createAssistantInboundValidationError(code, message);
    }
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime skill endpoints.",
      "Internal runtime skill authorization failed."
    );
  }
}
