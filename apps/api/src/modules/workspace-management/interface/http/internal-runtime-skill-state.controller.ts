import { BadRequestException, Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  InternalRuntimeSkillStateService,
  type SkillStateInput
} from "../../application/internal-runtime-skill-state.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

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
    action: string;
    skillId: string | null;
    skillDisplayName: string | null;
    scenarioKey: null;
    previousSkillId: string | null;
  }> {
    this.assertAuthorized(req);
    const input = this.parseBody(body);
    const result = await this.internalRuntimeSkillStateService.apply(input);
    if (result.action === "engaged") {
      return {
        ok: true,
        action: "engaged",
        skillId: result.skillId,
        skillDisplayName: result.skillDisplayName,
        scenarioKey: null,
        previousSkillId: null
      };
    }
    return {
      ok: true,
      action: "released",
      skillId: null,
      skillDisplayName: null,
      scenarioKey: null,
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
    return { assistantId, channel, surfaceThreadKey, action, skillId, scenarioKey };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime skill endpoints.",
      "Internal runtime skill authorization failed."
    );
  }
}
