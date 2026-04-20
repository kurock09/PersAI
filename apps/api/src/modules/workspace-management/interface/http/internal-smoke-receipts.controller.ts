import { Controller, Get, Query, Req } from "@nestjs/common";
import {
  ReadSmokeTurnReceiptsService,
  type SmokeTurnReceiptItem
} from "../../application/read-smoke-turn-receipts.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/smoke")
export class InternalSmokeReceiptsController {
  constructor(private readonly readSmokeTurnReceiptsService: ReadSmokeTurnReceiptsService) {}

  @Get("turn-receipts")
  async listTurnReceipts(
    @Req() req: InternalRequestLike,
    @Query() query: Record<string, string | string[] | undefined>
  ): Promise<{
    ok: true;
    items: SmokeTurnReceiptItem[];
    nextCursor: string | null;
  }> {
    this.assertAuthorized(req);
    const input = this.readSmokeTurnReceiptsService.parseInput(query);
    const result = await this.readSmokeTurnReceiptsService.execute(input);
    return { ok: true, items: result.items, nextCursor: result.nextCursor };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for the internal smoke receipts endpoint.",
      "Internal smoke receipts authorization failed."
    );
  }
}
