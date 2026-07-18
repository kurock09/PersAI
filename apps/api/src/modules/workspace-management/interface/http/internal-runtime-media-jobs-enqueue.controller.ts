import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  EnqueueRuntimeDeferredMediaJobService,
  type EnqueueRuntimeDeferredMediaJobRejection
} from "../../application/enqueue-runtime-deferred-media-job.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

type EnqueueResponse =
  | {
      ok: true;
      accepted: true;
      jobId: string;
      jobRef: string;
      kind: "image" | "video";
    }
  | ({ ok: true } & EnqueueRuntimeDeferredMediaJobRejection);

@Controller("api/v1/internal/runtime/media-jobs")
export class InternalRuntimeMediaJobsEnqueueController {
  constructor(
    private readonly enqueueRuntimeDeferredMediaJobService: EnqueueRuntimeDeferredMediaJobService
  ) {}

  @HttpCode(202)
  @Post(["enqueue", "v1/enqueue"])
  async enqueue(@Req() req: InternalRequestLike, @Body() body: unknown): Promise<EnqueueResponse> {
    this.assertAuthorized(req);
    const input = this.enqueueRuntimeDeferredMediaJobService.parseInput(body);
    const outcome = await this.enqueueRuntimeDeferredMediaJobService.execute(input);
    return {
      ok: true,
      ...outcome
    };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for the deferred media enqueue endpoint.",
      "Internal deferred media enqueue authorization failed."
    );
  }
}
