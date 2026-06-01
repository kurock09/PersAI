import { createHash } from "node:crypto";
import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  hashAssistantRuntimeBundleDocument,
  type AssistantRuntimeBundle
} from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeFailedEvent,
  RuntimeMediaJobRunRequest,
  RuntimeMediaJobRunResult,
  RuntimeOutputArtifact,
  RuntimeTurnRequest,
  RuntimeTurnResult,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import { RuntimeImageEditToolService } from "./runtime-image-edit-tool.service";
import { RuntimeImageGenerateToolService } from "./runtime-image-generate-tool.service";
import { RuntimeVideoGenerateToolService } from "./runtime-video-generate-tool.service";
import { RuntimeExecutionAdmissionService } from "./runtime-execution-admission.service";
import { TurnAcceptanceService, type AcceptedRuntimeTurn } from "./turn-acceptance.service";
import { TurnFinalizationService } from "./turn-finalization.service";

const MEDIA_JOB_RUN_KEY_PREFIX = "media-job-run";

@Injectable()
export class RuntimeMediaJobRunService {
  constructor(
    private readonly runtimeImageGenerateToolService: RuntimeImageGenerateToolService,
    private readonly runtimeImageEditToolService: RuntimeImageEditToolService,
    private readonly runtimeVideoGenerateToolService: RuntimeVideoGenerateToolService,
    private readonly runtimeExecutionAdmissionService: RuntimeExecutionAdmissionService,
    private readonly turnAcceptanceService: TurnAcceptanceService,
    private readonly turnFinalizationService: TurnFinalizationService
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

      const syntheticTurn = this.buildSyntheticTurnRequest(input, bundle);
      const acceptedTurn = await this.turnAcceptanceService.acceptTurn(syntheticTurn);
      switch (acceptedTurn.outcome) {
        case "busy":
          throw new ServiceUnavailableException(
            `Media-job run session "${acceptedTurn.session.sessionId}" is already processing another turn.`
          );
        case "in_flight":
          throw new ServiceUnavailableException(
            acceptedTurn.requestId === null
              ? "A matching media-job run is already in flight."
              : `Media-job run "${acceptedTurn.requestId}" is already in flight.`
          );
        case "replayed":
          return this.resolveReplayResult(acceptedTurn.receipt);
        case "accepted":
          return this.executeAcceptedRun(acceptedTurn, input, bundle);
      }
    });
  }

  private async executeAcceptedRun(
    acceptedTurn: AcceptedRuntimeTurn,
    input: RuntimeMediaJobRunRequest,
    bundle: AssistantRuntimeBundle
  ): Promise<RuntimeMediaJobRunResult> {
    try {
      const result = await this.runDirectToolExecution(input, bundle);
      const turnResult: RuntimeTurnResult = {
        requestId: acceptedTurn.receipt.requestId,
        sessionId: acceptedTurn.session.sessionId,
        assistantText: result.assistantText,
        artifacts: result.artifacts,
        respondedAt: new Date().toISOString(),
        usage: this.toUsageSnapshot(result.usage),
        ...(result.usage === null || this.isUsageSnapshot(result.usage)
          ? {}
          : { usageAccounting: result.usage }),
        toolInvocations: result.toolInvocations
      };
      await this.turnFinalizationService.completeAcceptedTurn(acceptedTurn, turnResult);
      return result;
    } catch (error) {
      const failure = this.toFailedEvent(acceptedTurn, error);
      await this.turnFinalizationService.failAcceptedTurn(acceptedTurn, failure);
      throw error;
    }
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

  private buildSyntheticTurnRequest(
    input: RuntimeMediaJobRunRequest,
    bundle: AssistantRuntimeBundle
  ): RuntimeTurnRequest {
    const key = this.buildMediaJobRunKey(input);
    const bundleHash = hashAssistantRuntimeBundleDocument(input.runtimeBundleDocument);
    return {
      requestId: key,
      idempotencyKey: key,
      runtimeTier: input.runtimeTier,
      bundle: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        bundleId: `media-job-run:${input.job.id}:${bundle.metadata.publishedVersionId}`,
        publishedVersionId: bundle.metadata.publishedVersionId,
        bundleHash,
        compiledAt: new Date().toISOString()
      },
      conversation: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        channel: input.job.surface,
        externalThreadKey: `system:media-job-run:${input.job.id}`,
        externalUserKey: null,
        mode: "direct"
      },
      message: {
        text: `Run async media job ${input.job.id}`,
        attachments: [],
        locale: bundle.userContext.locale,
        timezone: bundle.userContext.timezone,
        receivedAt: new Date().toISOString()
      },
      modelRoleOverride: "system_tool"
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

  private resolveReplayResult(receipt: AcceptedRuntimeTurn["receipt"]): RuntimeMediaJobRunResult {
    switch (receipt.status) {
      case "completed": {
        const result = this.asObject(receipt.resultPayload);
        if (
          result === null ||
          typeof result.assistantText !== "string" ||
          !Array.isArray(result.artifacts) ||
          ("toolInvocations" in result && !Array.isArray(result.toolInvocations))
        ) {
          throw new BadRequestException("Replayed media-job run result payload is invalid.");
        }
        const artifacts = result.artifacts as RuntimeOutputArtifact[];
        return {
          assistantText: result.assistantText,
          artifacts,
          usage: this.readReplayUsage(result),
          billingFacts: artifacts.find((artifact) => artifact.billingFacts)?.billingFacts ?? null,
          toolInvocations: Array.isArray(result.toolInvocations)
            ? (result.toolInvocations as RuntimeMediaJobRunResult["toolInvocations"])
            : [],
          rawText: null
        };
      }
      case "failed": {
        const message = receipt.errorMessage ?? "Media-job run failed.";
        if (receipt.errorCode === "image_provider_safety_rejected") {
          throw new BadRequestException({
            error: {
              code: receipt.errorCode,
              message
            }
          });
        }
        throw new ServiceUnavailableException({
          error: {
            code: receipt.errorCode ?? "media_job_run_failed",
            message
          }
        });
      }
      default:
        throw new ServiceUnavailableException(
          `Media-job run "${receipt.requestId}" is already accepted and still processing.`
        );
    }
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private readReplayUsage(result: Record<string, unknown>): RuntimeMediaJobRunResult["usage"] {
    if (this.asObject(result.usageAccounting) !== null) {
      return result.usageAccounting as never;
    }
    return this.asObject(result.usage) !== null ? (result.usage as never) : null;
  }

  private isUsageSnapshot(usage: RuntimeMediaJobRunResult["usage"]): usage is RuntimeUsageSnapshot {
    return (
      usage !== null &&
      typeof usage === "object" &&
      !Array.isArray(usage) &&
      ("providerKey" in usage || "modelKey" in usage || "totalTokens" in usage)
    );
  }

  private toUsageSnapshot(usage: RuntimeMediaJobRunResult["usage"]) {
    return this.isUsageSnapshot(usage) ? usage : null;
  }

  private toFailedEvent(acceptedTurn: AcceptedRuntimeTurn, error: unknown): RuntimeFailedEvent {
    const payload =
      error instanceof BadRequestException || error instanceof ServiceUnavailableException
        ? (error.getResponse() as { error?: { code?: string; message?: string } })
        : null;
    return {
      type: "failed",
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId,
      code: payload?.error?.code ?? "media_job_run_failed",
      message:
        payload?.error?.message ??
        (error instanceof Error ? error.message : "Media-job run failed."),
      willRetry: false
    };
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
