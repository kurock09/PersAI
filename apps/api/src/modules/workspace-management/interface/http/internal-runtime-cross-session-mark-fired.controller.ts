import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { MarkCrossSessionCarryOverFiredService } from "../../application/mark-cross-session-carry-over-fired.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

interface MarkCrossSessionCarryOverFiredResponse {
  ok: true;
  outcome: "advanced" | "noop_already_newer";
}

/**
 * ADR-074 Slice M3.2 — internal endpoint that bumps the per-thread cooldown
 * bookkeeping cell after the runtime renders a non-empty cross-session
 * carry-over block. Fire-and-forget from the runtime; idempotent under the
 * hood (a stale `firedAt` will not regress the stored value).
 *
 * The runtime is the only legitimate caller; bearer auth uses the same
 * `PERSAI_INTERNAL_API_TOKEN` as the M3 carry-over endpoint.
 */
@Controller("api/v1/internal/runtime/cross-session")
export class InternalRuntimeCrossSessionMarkFiredController {
  constructor(
    private readonly markCrossSessionCarryOverFiredService: MarkCrossSessionCarryOverFiredService
  ) {}

  @HttpCode(200)
  @Post("mark-carry-over-fired")
  async markFired(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<MarkCrossSessionCarryOverFiredResponse> {
    this.assertAuthorized(req);
    const input = this.markCrossSessionCarryOverFiredService.parseInput(body);
    const result = await this.markCrossSessionCarryOverFiredService.execute(input);
    return { ok: true, outcome: result.outcome };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime cross-session endpoints.",
      "Internal runtime cross-session authorization failed."
    );
  }
}
