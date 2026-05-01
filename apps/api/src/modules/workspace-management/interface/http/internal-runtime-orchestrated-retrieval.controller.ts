import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { RuntimeRetrievedKnowledgeContext } from "@persai/runtime-contract";
import { OrchestrateRuntimeRetrievalService } from "../../application/orchestrate-runtime-retrieval.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/knowledge")
export class InternalRuntimeOrchestratedRetrievalController {
  constructor(
    private readonly orchestrateRuntimeRetrievalService: OrchestrateRuntimeRetrievalService
  ) {}

  @HttpCode(200)
  @Post("orchestrate")
  async orchestrate(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{ ok: true; context: RuntimeRetrievedKnowledgeContext }> {
    this.assertAuthorized(req);
    const input = this.orchestrateRuntimeRetrievalService.parseInput(body);
    const context = await this.orchestrateRuntimeRetrievalService.execute(input);
    return { ok: true, context };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime retrieval endpoints.",
      "Internal runtime retrieval authorization failed."
    );
  }
}
