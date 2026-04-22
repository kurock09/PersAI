import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  CloseMostSimilarOpenLoopService,
  type CloseMostSimilarOpenLoopResult
} from "../../application/close-most-similar-open-loop.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

/**
 * ADR-074 Slice M3 — opt-in explicit close path for the memory_write tool.
 *
 * The runtime calls this endpoint after a `memory_write` whose payload set
 * `closeOpenLoop: true`. It is intentionally separate from
 * `/api/v1/internal/runtime/memory/write` so the close side-effect is
 * observable in the audit trail and so M3.1 can replace it with a
 * structured close-by-id action without disturbing the write path.
 */
@Controller("api/v1/internal/runtime/memory")
export class InternalRuntimeMemoryCloseMostSimilarController {
  constructor(private readonly closeMostSimilarOpenLoopService: CloseMostSimilarOpenLoopService) {}

  @HttpCode(200)
  @Post("close-most-similar-open-loop")
  async closeMostSimilarOpenLoop(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{
    ok: true;
    closed: boolean;
    closedItemId: string | null;
    reason: CloseMostSimilarOpenLoopResult["reason"];
  }> {
    this.assertAuthorized(req);
    const input = this.closeMostSimilarOpenLoopService.parseInput(body);
    const result = await this.closeMostSimilarOpenLoopService.execute(input);
    return {
      ok: true,
      closed: result.closed,
      closedItemId: result.closedItemId,
      reason: result.reason
    };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime memory endpoints.",
      "Internal runtime memory authorization failed."
    );
  }
}
