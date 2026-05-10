import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ListRuntimeOpenLoopRefsService } from "../../application/list-runtime-open-loop-refs.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/memory")
export class InternalRuntimeMemoryOpenLoopRefsController {
  constructor(private readonly listRuntimeOpenLoopRefsService: ListRuntimeOpenLoopRefsService) {}

  @HttpCode(200)
  @Post("open-loop-refs")
  async listOpenLoopRefs(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{
    ok: true;
    unresolvedOpenLoops: Array<{
      id: string;
      summary: string;
      createdAt: string;
    }>;
    totalUnresolvedOpenLoops: number;
  }> {
    this.assertAuthorized(req);
    const input = this.listRuntimeOpenLoopRefsService.parseInput(body);
    const result = await this.listRuntimeOpenLoopRefsService.execute(input);
    return {
      ok: true,
      unresolvedOpenLoops: result.unresolvedOpenLoops,
      totalUnresolvedOpenLoops: result.totalUnresolvedOpenLoops
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
