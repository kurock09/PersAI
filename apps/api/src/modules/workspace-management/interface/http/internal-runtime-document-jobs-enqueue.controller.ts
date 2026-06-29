import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { EnqueueRuntimeDeferredDocumentJobService } from "../../application/enqueue-runtime-deferred-document-job.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/document-jobs")
export class InternalRuntimeDocumentJobsEnqueueController {
  constructor(
    private readonly enqueueRuntimeDeferredDocumentJobService: EnqueueRuntimeDeferredDocumentJobService
  ) {}

  @HttpCode(202)
  @Post("enqueue")
  async enqueue(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<
    | {
        ok: true;
        accepted: true;
        docId: string;
        versionId: string;
        renderJobId: string;
        documentType: "presentation";
      }
    | {
        ok: true;
        accepted: false;
        code: string;
        message: string;
        guidance?: string | null;
      }
  > {
    this.assertAuthorized(req);
    const input = this.enqueueRuntimeDeferredDocumentJobService.parseInput(body);
    const outcome = await this.enqueueRuntimeDeferredDocumentJobService.execute(input);
    return {
      ok: true,
      ...outcome
    };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for the deferred document enqueue endpoint.",
      "Internal deferred document enqueue authorization failed."
    );
  }
}
