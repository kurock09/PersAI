import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { FindCrossSessionCarryOverService } from "../../application/find-cross-session-carry-over.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

interface CrossSessionCarryOverResponse {
  ok: true;
  recentSynopses: Array<{
    runtimeSessionId: string;
    channel: string;
    synopsisUpdatedAt: string;
    summaryPayload: unknown;
  }>;
  unresolvedOpenLoops: Array<{
    id: string;
    summary: string;
    createdAt: string;
  }>;
}

/**
 * ADR-074 Slice M3 — internal endpoint that returns the cross-session
 * carry-over data the runtime needs to render the turn-0 block. The
 * runtime is the only legitimate caller; bearer auth uses the same
 * `PERSAI_INTERNAL_API_TOKEN` as the existing M1 hydrate endpoint.
 */
@Controller("api/v1/internal/runtime/cross-session")
export class InternalRuntimeCrossSessionCarryOverController {
  constructor(
    private readonly findCrossSessionCarryOverService: FindCrossSessionCarryOverService
  ) {}

  @HttpCode(200)
  @Post("carry-over")
  async carryOver(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<CrossSessionCarryOverResponse> {
    this.assertAuthorized(req);
    const input = this.findCrossSessionCarryOverService.parseInput(body);
    const result = await this.findCrossSessionCarryOverService.execute(input);
    return {
      ok: true,
      recentSynopses: result.recentSynopses.map((row) => ({
        runtimeSessionId: row.runtimeSessionId,
        channel: row.channel,
        synopsisUpdatedAt: row.synopsisUpdatedAt.toISOString(),
        summaryPayload: row.summaryPayload
      })),
      unresolvedOpenLoops: result.unresolvedOpenLoops.map((row) => ({
        id: row.id,
        summary: row.summary,
        createdAt: row.createdAt.toISOString()
      }))
    };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime cross-session endpoints.",
      "Internal runtime cross-session authorization failed."
    );
  }
}
