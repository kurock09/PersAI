import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  HydrateMemoryForTurnService,
  type HydratedDurableMemoryItem
} from "../../application/hydrate-memory-for-turn.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/memory")
export class InternalRuntimeMemoryHydrationController {
  constructor(private readonly hydrateMemoryForTurnService: HydrateMemoryForTurnService) {}

  @HttpCode(200)
  @Post("hydrate-for-turn")
  async hydrateForTurn(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{
    ok: true;
    core: HydratedDurableMemoryItem[];
  }> {
    this.assertAuthorized(req);
    const input = this.hydrateMemoryForTurnService.parseInput(body);
    const result = await this.hydrateMemoryForTurnService.execute(input);
    return {
      ok: true,
      core: result.core
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
