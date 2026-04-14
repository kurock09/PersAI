import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { RuntimeKnowledgeDocument, RuntimeKnowledgeSearchHit } from "@persai/runtime-contract";
import { ReadAssistantKnowledgeService } from "../../application/read-assistant-knowledge.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/knowledge")
export class InternalRuntimeKnowledgeController {
  constructor(private readonly readAssistantKnowledgeService: ReadAssistantKnowledgeService) {}

  @HttpCode(200)
  @Post("search")
  async search(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{ ok: true; hits: RuntimeKnowledgeSearchHit[] }> {
    this.assertAuthorized(req);
    const input = this.readAssistantKnowledgeService.parseSearchInput(body);
    const hits = await this.readAssistantKnowledgeService.search(input);
    return { ok: true, hits };
  }

  @HttpCode(200)
  @Post("fetch")
  async fetch(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{ ok: true; document: RuntimeKnowledgeDocument | null }> {
    this.assertAuthorized(req);
    const input = this.readAssistantKnowledgeService.parseFetchInput(body);
    const document = await this.readAssistantKnowledgeService.fetch(input);
    return { ok: true, document };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime knowledge endpoints.",
      "Internal runtime knowledge authorization failed."
    );
  }
}
