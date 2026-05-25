import { createHash } from "node:crypto";
import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { type AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeMediaJobRunRequest,
  RuntimeMediaJobRunResult
} from "@persai/runtime-contract";
import { RuntimeImageEditToolService } from "./runtime-image-edit-tool.service";
import { RuntimeImageGenerateToolService } from "./runtime-image-generate-tool.service";
import { RuntimeVideoGenerateToolService } from "./runtime-video-generate-tool.service";
import { RuntimeExecutionAdmissionService } from "./runtime-execution-admission.service";

const MEDIA_JOB_RUN_KEY_PREFIX = "media-job-run";

@Injectable()
export class RuntimeMediaJobRunService {
  constructor(
    private readonly runtimeImageGenerateToolService: RuntimeImageGenerateToolService,
    private readonly runtimeImageEditToolService: RuntimeImageEditToolService,
    private readonly runtimeVideoGenerateToolService: RuntimeVideoGenerateToolService,
    private readonly runtimeExecutionAdmissionService: RuntimeExecutionAdmissionService
  ) {}

  async run(input: RuntimeMediaJobRunRequest): Promise<RuntimeMediaJobRunResult> {
    return this.runtimeExecutionAdmissionService.runWithAdmission("background", async () => {
      const bundle = this.parseBundle(input.runtimeBundleDocument);
      if (bundle.metadata.assistantId !== input.assistantId) {
        throw new BadRequestException("runtimeBundleDocument assistantId does not match request.");
      }
      if (bundle.metadata.workspaceId !== input.workspaceId) {
        throw new BadRequestException("runtimeBundleDocument workspaceId does not match request.");
      }

      return this.runDirectToolExecution(input, bundle);
    });
  }

  private async runDirectToolExecution(
    input: RuntimeMediaJobRunRequest,
    bundle: AssistantRuntimeBundle
  ): Promise<RuntimeMediaJobRunResult> {
    const toolRunKey = this.buildMediaJobRunKey(input);
    const toolCall = this.buildDirectToolCall(input, toolRunKey);
    switch (input.directToolExecution?.toolCode) {
      case "image_generate": {
        const result = await this.runtimeImageGenerateToolService.executeToolCall({
          bundle,
          toolCall,
          sessionId: `media-job:${input.job.id}`,
          requestId: toolRunKey
        });
        this.assertImageToolResultAccepted(
          result.payload.reason,
          result.payload.warning,
          result.isError
        );
        return {
          assistantText: "",
          artifacts: result.artifacts,
          usage: result.payload.usage,
          billingFacts: result.artifacts[0]?.billingFacts ?? null,
          toolInvocations: [
            {
              name: "image_generate",
              iteration: 1,
              ok: result.isError !== true,
              executionMode: "worker"
            }
          ],
          rawText: null
        };
      }
      case "image_edit": {
        const result = await this.runtimeImageEditToolService.executeToolCall({
          bundle,
          toolCall,
          availableAttachments: input.attachments,
          sessionId: `media-job:${input.job.id}`,
          requestId: toolRunKey
        });
        this.assertImageToolResultAccepted(
          result.payload.reason,
          result.payload.warning,
          result.isError
        );
        return {
          assistantText: "",
          artifacts: result.artifacts,
          usage: result.payload.usage,
          billingFacts: result.artifacts[0]?.billingFacts ?? null,
          toolInvocations: [
            {
              name: "image_edit",
              iteration: 1,
              ok: result.isError !== true,
              executionMode: "worker"
            }
          ],
          rawText: null
        };
      }
      case "video_generate": {
        const result = await this.runtimeVideoGenerateToolService.executeToolCall({
          bundle,
          toolCall,
          availableAttachments: input.attachments,
          sessionId: `media-job:${input.job.id}`,
          requestId: toolRunKey
        });
        return {
          assistantText: "",
          artifacts: result.artifacts,
          usage: result.payload.usage,
          billingFacts: result.artifacts[0]?.billingFacts ?? null,
          toolInvocations: [
            {
              name: "video_generate",
              iteration: 1,
              ok: result.isError !== true,
              executionMode: "worker"
            }
          ],
          rawText: null
        };
      }
      default:
        throw new BadRequestException("directToolExecution must target a supported media tool.");
    }
  }

  private buildDirectToolCall(
    input: RuntimeMediaJobRunRequest,
    toolRunKey: string
  ): ProviderGatewayToolCall {
    return {
      id: `${toolRunKey}:tool`,
      name: input.directToolExecution.toolCode,
      arguments: input.directToolExecution.request as unknown as Record<string, unknown>
    };
  }

  private parseBundle(document: string): AssistantRuntimeBundle {
    let parsed: unknown;
    try {
      parsed = JSON.parse(document);
    } catch {
      throw new BadRequestException("runtimeBundleDocument must be valid JSON.");
    }
    const row = this.asObject(parsed);
    if (
      row === null ||
      this.asObject(row.metadata) === null ||
      this.asObject(row.runtime) === null ||
      this.asObject(row.promptConstructor) === null
    ) {
      throw new BadRequestException("runtimeBundleDocument has an invalid runtime bundle shape.");
    }
    return parsed as AssistantRuntimeBundle;
  }

  private buildMediaJobRunKey(input: RuntimeMediaJobRunRequest): string {
    const digest = createHash("sha256")
      .update(`${input.job.id}:${input.job.sourceUserMessageId}:${input.job.kind}`)
      .digest("hex")
      .slice(0, 16);
    return `${MEDIA_JOB_RUN_KEY_PREFIX}:${input.job.id}:${digest}`;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private assertImageToolResultAccepted(
    reason: string | null,
    warning: string | null,
    isError: boolean
  ): void {
    if (reason === null) {
      return;
    }
    const message =
      typeof warning === "string" && warning.trim().length > 0
        ? warning.trim()
        : "Media-job image worker did not produce deliverable artifacts.";
    if (reason === "image_provider_safety_rejected") {
      throw new BadRequestException({
        error: {
          code: reason,
          message
        }
      });
    }
    if (isError) {
      throw new ServiceUnavailableException({
        error: {
          code: reason,
          message
        }
      });
    }
    throw new BadRequestException({
      error: {
        code: reason,
        message
      }
    });
  }
}
