import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  CloseAssistantMemoryByRefService,
  type CloseAssistantMemoryByRefResult
} from "../../application/close-assistant-memory-by-ref.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

/**
 * ADR-074 Slice M3.1 — deterministic close-by-id path for the memory_write
 * tool's structured `action: "close"` shape.
 *
 * The runtime calls this endpoint when the model emits
 * `memory_write({ action: "close", ref })`. The runtime resolves `ref` to the
 * underlying `assistant_memory_registry_items.id` it earlier exposed in the
 * cross-session carry-over block and forwards it here. Kept separate from
 * `/close-most-similar-open-loop` so the M3 lexical-match path and the M3.1
 * id path each have their own audit-source marker, even though both
 * ultimately stamp the same `resolved_at` column.
 */
@Controller("api/v1/internal/runtime/memory")
export class InternalRuntimeMemoryCloseByRefController {
  constructor(
    private readonly closeAssistantMemoryByRefService: CloseAssistantMemoryByRefService
  ) {}

  @HttpCode(200)
  @Post("close-by-ref")
  async closeByRef(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{
    ok: true;
    closed: boolean;
    closedItemId: string | null;
    reason: CloseAssistantMemoryByRefResult["reason"];
  }> {
    this.assertAuthorized(req);
    const input = this.closeAssistantMemoryByRefService.parseRuntimeInput(body);
    const result = await this.closeAssistantMemoryByRefService.executeForRuntime(input);
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
