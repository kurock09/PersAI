import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { CheckpointMediaJobAcceptedProviderTaskService } from "../../application/checkpoint-media-job-accepted-provider-task.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/media-jobs")
export class InternalRuntimeMediaJobsCheckpointController {
  constructor(
    private readonly checkpointMediaJobAcceptedProviderTaskService: CheckpointMediaJobAcceptedProviderTaskService
  ) {}

  @HttpCode(200)
  @Post("checkpoint-accepted-provider-task")
  async checkpointAcceptedProviderTask(
    @Req() req: InternalRequestLike,
    @Body() body: unknown
  ): Promise<{ ok: true; checkpointed: boolean }> {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for the media-job checkpoint endpoint.",
      "Internal media-job checkpoint authorization failed."
    );
    const input = this.checkpointMediaJobAcceptedProviderTaskService.parseInput(body);
    return this.checkpointMediaJobAcceptedProviderTaskService.execute(input);
  }
}
