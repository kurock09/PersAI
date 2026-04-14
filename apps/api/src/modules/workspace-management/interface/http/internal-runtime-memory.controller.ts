import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { RuntimeMemoryWriteItem } from "@persai/runtime-contract";
import { WriteAssistantMemoryService } from "../../application/write-assistant-memory.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/memory")
export class InternalRuntimeMemoryController {
  constructor(private readonly writeAssistantMemoryService: WriteAssistantMemoryService) {}

  @HttpCode(200)
  @Post("write")
  async write(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{
    ok: true;
    written: boolean;
    code: string | null;
    message: string | null;
    item: RuntimeMemoryWriteItem | null;
  }> {
    this.assertAuthorized(req);
    const input = this.writeAssistantMemoryService.parseInput(body);
    const result = await this.writeAssistantMemoryService.execute(input);
    return {
      ok: true,
      written: result.written,
      code: result.code,
      message: result.message,
      item: result.item
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
