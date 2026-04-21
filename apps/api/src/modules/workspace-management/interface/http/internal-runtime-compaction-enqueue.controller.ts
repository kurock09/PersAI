import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { EnqueueBackgroundCompactionJobService } from "../../application/enqueue-background-compaction-job.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/compaction")
export class InternalRuntimeCompactionEnqueueController {
  constructor(
    private readonly enqueueBackgroundCompactionJobService: EnqueueBackgroundCompactionJobService
  ) {}

  @HttpCode(202)
  @Post("enqueue")
  async enqueue(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{
    ok: true;
    enqueued: boolean;
    jobId: string | null;
    superseded: boolean;
  }> {
    this.assertAuthorized(req);
    const input = this.enqueueBackgroundCompactionJobService.parseInput(body);
    const outcome = await this.enqueueBackgroundCompactionJobService.execute(input);
    return {
      ok: true,
      enqueued: outcome.enqueued,
      jobId: outcome.jobId,
      superseded: outcome.superseded
    };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for the background compaction enqueue endpoint.",
      "Internal background compaction enqueue authorization failed."
    );
  }
}
