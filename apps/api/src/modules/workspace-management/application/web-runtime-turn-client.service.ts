import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  RuntimeJobDeliveryUpdate,
  RuntimeOpenMediaJobContext,
  RuntimeOpenDocumentJobContext,
  RuntimeAttachmentRef,
  RuntimeSkillStateContext,
  RuntimeTurnRequest,
  RuntimeTurnResult
} from "@persai/runtime-contract";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import {
  AssistantRuntimeError,
  runtimeOutputArtifactsToMediaArtifacts,
  type AssistantRuntimeWebChatTurnResult
} from "./assistant-runtime.facade";
import {
  createAssistantInboundConflict,
  createAssistantInboundValidationError
} from "./assistant-inbound-error";
import { resolveNativeRuntimeTurnTimeoutMs } from "./native-runtime-turn-timeout";
import { createRuntimeTurnWallClockDeadline } from "./runtime-turn-deadline";
import { resolveMaterializedNativeRuntimeBundle } from "./native-runtime-bundle-hash";
import type { RuntimeTier } from "./runtime-assignment";

export interface WebRuntimeTurnClientInput {
  assistantId: string;
  publishedVersionId: string;
  runtimeTier: RuntimeTier;
  surfaceThreadKey: string;
  bridgeDeviceId?: string;
  bridgeDeviceKind?: "extension" | "capacitor";
  userId: string;
  workspaceId: string;
  userMessageId: string;
  userMessage: string;
  attachments: RuntimeAttachmentRef[];
  openMediaJobs?: RuntimeOpenMediaJobContext[];
  openDocumentJobs?: RuntimeOpenDocumentJobContext[];
  jobDeliveryUpdates?: RuntimeJobDeliveryUpdate[];
  userTimezone?: string;
  currentTimeIso?: string;
  chatMode?: RuntimeTurnRequest["chatMode"];
  deepMode?: RuntimeTurnRequest["deepMode"];
  modelRoleOverride?: RuntimeTurnRequest["modelRoleOverride"];
  providerOverride?: "openai" | "anthropic" | "deepseek";
  modelOverride?: string;
  skillStateContext?: RuntimeSkillStateContext;
  chatId: string;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

@Injectable()
export class WebRuntimeTurnClientService {
  constructor(
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository
  ) {}

  async execute(input: WebRuntimeTurnClientInput): Promise<AssistantRuntimeWebChatTurnResult> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    if (!baseUrl) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Web runtime turn client requires PERSAI_RUNTIME_BASE_URL."
      );
    }

    const materializedSpec =
      await this.assistantMaterializedSpecRepository.findByPublishedVersionId(
        input.publishedVersionId
      );
    if (materializedSpec === null) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Web runtime materialized spec is missing for the current published version."
      );
    }
    if (materializedSpec.assistantId !== input.assistantId) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Web runtime materialized spec assistant identity does not match the prepared turn."
      );
    }

    const { bundleHash } = resolveMaterializedNativeRuntimeBundle({
      materializedSpec,
      context: "Web runtime"
    });

    const request: RuntimeTurnRequest = {
      requestId: randomUUID(),
      idempotencyKey: input.userMessageId,
      runtimeTier: input.runtimeTier,
      bundle: {
        bundleId: materializedSpec.id,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        publishedVersionId: input.publishedVersionId,
        bundleHash,
        compiledAt: materializedSpec.createdAt.toISOString()
      },
      conversation: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        channel: "web",
        externalThreadKey: input.surfaceThreadKey,
        externalUserKey: input.userId,
        mode: "direct"
      },
      message: {
        text: input.userMessage,
        attachments: input.attachments,
        locale: null,
        timezone: input.userTimezone ?? null,
        receivedAt: input.currentTimeIso ?? new Date().toISOString()
      },
      ...(input.openMediaJobs === undefined ? {} : { openMediaJobs: input.openMediaJobs }),
      ...(input.openDocumentJobs === undefined ? {} : { openDocumentJobs: input.openDocumentJobs }),
      ...(input.jobDeliveryUpdates === undefined
        ? {}
        : { jobDeliveryUpdates: input.jobDeliveryUpdates }),
      ...(input.chatMode === undefined ? {} : { chatMode: input.chatMode }),
      ...(input.deepMode === undefined ? {} : { deepMode: input.deepMode }),
      ...(input.modelRoleOverride === undefined
        ? {}
        : { modelRoleOverride: input.modelRoleOverride }),
      ...(input.providerOverride === undefined ? {} : { providerOverride: input.providerOverride }),
      ...(input.modelOverride === undefined ? {} : { modelOverride: input.modelOverride }),
      ...(input.skillStateContext === undefined
        ? {}
        : { skillStateContext: input.skillStateContext }),
      channelContext: {
        chatId: input.chatId,
        web: {
          chatId: input.chatId,
          ...(input.bridgeDeviceId === undefined
            ? {}
            : { localBrowserBridgeDeviceId: input.bridgeDeviceId }),
          ...(input.bridgeDeviceKind === undefined
            ? {}
            : { localBrowserBridgeDeviceKind: input.bridgeDeviceKind })
        }
      }
    };
    const wallClockMs = resolveNativeRuntimeTurnTimeoutMs(
      materializedSpec.runtimeBundle,
      config.PERSAI_RUNTIME_TURN_WALL_CLOCK_MS
    );

    const response = await this.postJson(
      new URL("/api/v1/turns/create", baseUrl).toString(),
      request,
      wallClockMs
    );
    if (!response.ok) {
      this.throwForFailedResponse(response);
    }
    if (!this.isRuntimeTurnResult(response.body)) {
      throw new AssistantRuntimeError(
        "invalid_response",
        "Web runtime returned an invalid sync turn response."
      );
    }
    return {
      assistantMessage: response.body.assistantText,
      respondedAt: response.body.respondedAt,
      media: runtimeOutputArtifactsToMediaArtifacts(response.body.artifacts),
      ...(response.body.textUsageAccounting === undefined
        ? {}
        : { textUsageAccounting: response.body.textUsageAccounting }),
      ...(response.body.toolInvocations === undefined
        ? {}
        : { toolInvocations: response.body.toolInvocations }),
      ...(response.body.toolExchanges === undefined
        ? {}
        : { toolExchanges: response.body.toolExchanges }),
      ...(response.body.deferredMediaJobs === undefined
        ? {}
        : { deferredMediaJobs: response.body.deferredMediaJobs }),
      ...(response.body.turnRouting === undefined
        ? {}
        : { turnRouting: response.body.turnRouting }),
      ...(response.body.autoCompaction === undefined
        ? {}
        : { autoCompaction: response.body.autoCompaction }),
      ...(response.body.trace === undefined ? {} : { runtimeTrace: response.body.trace }),
      ...(response.body.discoveredFilePaths === undefined ||
      response.body.discoveredFilePaths.length === 0
        ? {}
        : { discoveredFilePaths: response.body.discoveredFilePaths })
    };
  }

  private async buildRuntimeTurnRequest(
    input: WebRuntimeTurnClientInput
  ): Promise<RuntimeTurnRequest> {
    const materializedSpec =
      await this.assistantMaterializedSpecRepository.findByPublishedVersionId(
        input.publishedVersionId
      );
    if (materializedSpec === null) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Web runtime materialized spec is missing for the current published version."
      );
    }
    if (materializedSpec.assistantId !== input.assistantId) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Web runtime materialized spec assistant identity does not match the prepared turn."
      );
    }
    const { bundleHash } = resolveMaterializedNativeRuntimeBundle({
      materializedSpec,
      context: "Web runtime"
    });
    return {
      requestId: randomUUID(),
      idempotencyKey: input.userMessageId,
      runtimeTier: input.runtimeTier,
      bundle: {
        bundleId: materializedSpec.id,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        publishedVersionId: input.publishedVersionId,
        bundleHash,
        compiledAt: materializedSpec.createdAt.toISOString()
      },
      conversation: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        channel: "web",
        externalThreadKey: input.surfaceThreadKey,
        externalUserKey: input.userId,
        mode: "direct"
      },
      message: {
        text: input.userMessage,
        attachments: input.attachments,
        locale: null,
        timezone: input.userTimezone ?? null,
        receivedAt: input.currentTimeIso ?? new Date().toISOString()
      },
      ...(input.openMediaJobs === undefined ? {} : { openMediaJobs: input.openMediaJobs }),
      ...(input.openDocumentJobs === undefined ? {} : { openDocumentJobs: input.openDocumentJobs }),
      ...(input.jobDeliveryUpdates === undefined
        ? {}
        : { jobDeliveryUpdates: input.jobDeliveryUpdates }),
      ...(input.chatMode === undefined ? {} : { chatMode: input.chatMode }),
      ...(input.deepMode === undefined ? {} : { deepMode: input.deepMode }),
      ...(input.modelRoleOverride === undefined
        ? {}
        : { modelRoleOverride: input.modelRoleOverride }),
      ...(input.providerOverride === undefined ? {} : { providerOverride: input.providerOverride }),
      ...(input.modelOverride === undefined ? {} : { modelOverride: input.modelOverride }),
      ...(input.skillStateContext === undefined
        ? {}
        : { skillStateContext: input.skillStateContext }),
      channelContext: {
        chatId: input.chatId,
        web: {
          chatId: input.chatId
        }
      }
    };
  }

  private async postJson(url: string, body: unknown, wallClockMs: number): Promise<JsonResponse> {
    const deadline = createRuntimeTurnWallClockDeadline({ wallClockMs });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: deadline.signal
      });
      const contentType = response.headers.get("content-type") ?? "";
      let responseBody: unknown = null;

      if (contentType.includes("application/json")) {
        responseBody = await response.json();
      } else {
        const text = await response.text();
        responseBody = text.length > 0 ? text : null;
      }

      return {
        ok: response.ok,
        status: response.status,
        body: responseBody
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AssistantRuntimeError(
          "timeout",
          `Web runtime sync turn timed out after ${wallClockMs}ms.`
        );
      }
      const message = error instanceof Error ? error.message : "Unknown web runtime sync failure.";
      throw new AssistantRuntimeError(
        "runtime_unreachable",
        `Web runtime sync turn failed: ${message}`
      );
    } finally {
      deadline.dispose();
    }
  }

  private throwForFailedResponse(response: JsonResponse): never {
    const message =
      this.extractErrorMessage(response.body) ??
      `Web runtime sync turn failed with HTTP ${response.status}.`;

    if (response.status === 400 || response.status === 413) {
      throw createAssistantInboundValidationError("native_runtime_request_invalid", message);
    }
    if (response.status === 409) {
      throw createAssistantInboundConflict("native_runtime_conflict", message);
    }
    if (response.status === 401 || response.status === 403) {
      throw new AssistantRuntimeError("auth_failure", message);
    }
    if (response.status === 408 || response.status === 504) {
      throw new AssistantRuntimeError("timeout", message);
    }
    if (response.status >= 500) {
      throw new AssistantRuntimeError("runtime_unreachable", message);
    }

    throw new AssistantRuntimeError("runtime_degraded", message);
  }

  private extractErrorMessage(body: unknown): string | null {
    if (typeof body === "string" && body.trim().length > 0) {
      return body;
    }

    const row = this.asObject(body);
    const nestedError = this.asObject(row?.error);
    const nestedErrorMessage = this.readMessageField(nestedError?.message);
    if (nestedErrorMessage !== null) {
      return nestedErrorMessage;
    }

    return this.readMessageField(row?.message);
  }

  private readMessageField(value: unknown): string | null {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const messages = value.filter((entry): entry is string => typeof entry === "string");
      return messages.length > 0 ? messages.join("; ") : null;
    }
    return null;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private isRuntimeTurnResult(value: unknown): value is RuntimeTurnResult {
    const row = this.asObject(value);
    return (
      typeof row?.requestId === "string" &&
      typeof row.sessionId === "string" &&
      typeof row.assistantText === "string" &&
      Array.isArray(row.artifacts) &&
      typeof row.respondedAt === "string" &&
      (row.turnRouting === undefined ||
        row.turnRouting === null ||
        this.isRuntimeTurnRoutingSnapshot(row.turnRouting))
    );
  }

  private isRuntimeTurnRoutingSnapshot(
    value: unknown
  ): value is NonNullable<RuntimeTurnResult["turnRouting"]> {
    const row = this.asObject(value);
    return (
      (row?.mode === "shadow" || row?.mode === "active") &&
      (row.executionMode === "normal" ||
        row.executionMode === "premium" ||
        row.executionMode === "reasoning") &&
      (row.source === "precheck" || row.source === "llm" || row.source === "fallback") &&
      (row.retrievalPlan === undefined ||
        row.retrievalPlan === null ||
        this.isRuntimeRetrievalPlan(row.retrievalPlan))
    );
  }

  private isRuntimeRetrievalPlan(value: unknown): boolean {
    const row = this.asObject(value);
    return (
      typeof row?.useSkills === "boolean" &&
      Array.isArray(row.selectedSkillIds) &&
      row.selectedSkillIds.every((item) => typeof item === "string") &&
      typeof row.useUserKnowledge === "boolean" &&
      typeof row.useProductKnowledge === "boolean" &&
      typeof row.useWeb === "boolean" &&
      (row.ordinarySourcePriorityMode === "personal_first" ||
        row.ordinarySourcePriorityMode === "product_first" ||
        row.ordinarySourcePriorityMode === "web_first" ||
        row.ordinarySourcePriorityMode === "mixed_ambiguous" ||
        row.ordinarySourcePriorityMode === "not_applicable") &&
      (row.confidence === "low" || row.confidence === "medium" || row.confidence === "high") &&
      typeof row.reasonCode === "string"
    );
  }
}
