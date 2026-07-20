import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ResolveCrossSessionCarryOverSnapshotService } from "../../application/resolve-cross-session-carry-over-snapshot.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = { headers: Record<string, string | string[] | undefined> };

@Controller("api/v1/internal/runtime/cross-session")
export class InternalRuntimeCrossSessionSnapshotController {
  constructor(
    private readonly resolveCrossSessionCarryOverSnapshotService: ResolveCrossSessionCarryOverSnapshotService
  ) {}

  @HttpCode(200)
  @Post("resolve-carry-over-snapshot")
  async resolve(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{ ok: true; snapshot: string }> {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime cross-session endpoints.",
      "Internal runtime cross-session authorization failed."
    );
    const input = this.resolveCrossSessionCarryOverSnapshotService.parseInput(body);
    const result = await this.resolveCrossSessionCarryOverSnapshotService.execute(input);
    return { ok: true, snapshot: result.snapshot };
  }
}
