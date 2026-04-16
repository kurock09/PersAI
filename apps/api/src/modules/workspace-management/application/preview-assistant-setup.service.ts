import { randomUUID } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  RuntimeBundleRef,
  RuntimeTurnRequest,
  RuntimeTurnResult
} from "@persai/runtime-contract";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import type { AssistantPublishedVersion } from "../domain/assistant-published-version.entity";
import { MaterializeAssistantPublishedVersionService } from "./materialize-assistant-published-version.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { toAssistantInboundHttpException } from "./assistant-inbound-error";
import {
  applyAssistantGenderVoiceDefaults,
  normalizeAssistantVoiceProfile
} from "./assistant-voice-profile";
import { normalizeAssistantGender } from "./assistant-gender";
import {
  AssistantRuntimeError,
  type AssistantRuntimeWebChatTurnResult
} from "./assistant-runtime.facade";
import {
  readRuntimeAssignmentStateFromMaterializedLayers,
  type RuntimeTier
} from "./runtime-assignment";

export interface AssistantSetupPreviewState {
  message: string;
  respondedAt: string;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

@Injectable()
export class PreviewAssistantSetupService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    private readonly materializeAssistantPublishedVersionService: MaterializeAssistantPublishedVersionService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(userId: string): Promise<AssistantSetupPreviewState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const latestVersion = await this.assistantPublishedVersionRepository.findLatestByAssistantId(
      assistant.id
    );
    const assistantGender = normalizeAssistantGender(assistant.draftAssistantGender);
    const draftVoiceProfile = applyAssistantGenderVoiceDefaults({
      assistantGender,
      voiceProfile: normalizeAssistantVoiceProfile(assistant.draftVoiceProfile)
    });
    const previewVersion: AssistantPublishedVersion = {
      id: randomUUID(),
      assistantId: assistant.id,
      version: (latestVersion?.version ?? 0) + 1,
      snapshotDisplayName: assistant.draftDisplayName,
      snapshotInstructions: assistant.draftInstructions,
      snapshotTraits: assistant.draftTraits,
      snapshotAvatarEmoji: assistant.draftAvatarEmoji,
      snapshotAvatarUrl: assistant.draftAvatarUrl,
      snapshotAssistantGender: assistantGender,
      snapshotVoiceProfile: draftVoiceProfile,
      publishedByUserId: userId,
      createdAt: new Date()
    };
    const artifacts = await this.materializeAssistantPublishedVersionService.buildRuntimeArtifacts(
      assistant,
      previewVersion
    );

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: assistant.workspaceId },
      select: { timezone: true }
    });

    const runtimeAssignment = readRuntimeAssignmentStateFromMaterializedLayers(artifacts.layers);
    const result = await this.previewSetupTurnNative({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      userId,
      previewPublishedVersionId: previewVersion.id,
      runtimeTier: runtimeAssignment?.effectiveTier ?? "free_shared_restricted",
      runtimeBundleDocument: artifacts.runtimeBundleDocument,
      runtimeBundleHash: artifacts.runtimeBundleHash,
      userMessage: artifacts.runtimeBundle.promptConstructor.onboarding.firstTurnPrompt,
      userTimezone: workspace?.timezone ?? "UTC",
      currentTimeIso: new Date().toISOString()
    }).catch((error: unknown) => {
      throw toAssistantInboundHttpException(error);
    });

    return {
      message: result.assistantMessage,
      respondedAt: result.respondedAt
    };
  }

  private async previewSetupTurnNative(input: {
    assistantId: string;
    workspaceId: string;
    userId: string;
    previewPublishedVersionId: string;
    runtimeTier: RuntimeTier;
    runtimeBundleDocument: string;
    runtimeBundleHash: string | null;
    userMessage: string;
    userTimezone: string;
    currentTimeIso: string;
  }): Promise<Pick<AssistantRuntimeWebChatTurnResult, "assistantMessage" | "respondedAt">> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    if (!baseUrl) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Native runtime setup preview is enabled but PERSAI_RUNTIME_BASE_URL is not configured."
      );
    }
    const bundleDocument = input.runtimeBundleDocument.trim();
    const bundleHash = input.runtimeBundleHash?.trim() ?? "";
    if (!bundleDocument || !bundleHash) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Native runtime setup preview bundle document/hash is missing."
      );
    }

    const bundleRef: RuntimeBundleRef = {
      bundleId: input.previewPublishedVersionId,
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      publishedVersionId: input.previewPublishedVersionId,
      bundleHash,
      compiledAt: input.currentTimeIso
    };
    const timeoutMs = config.PERSAI_RUNTIME_BUNDLE_SYNC_TIMEOUT_MS;
    await this.postJson(
      new URL("/api/v1/bundles/warm", baseUrl).toString(),
      {
        bundle: bundleRef,
        bundleDocument,
        materializedSpecId: `preview:${input.previewPublishedVersionId}`,
        runtimeTier: input.runtimeTier
      },
      timeoutMs
    ).then((response) => {
      if (!response.ok) {
        this.throwForFailedResponse(response, "setup preview bundle warm");
      }
    });

    try {
      const response = await this.postJson(
        new URL("/api/v1/turns/create", baseUrl).toString(),
        this.buildPreviewTurnRequest(input, bundleRef),
        config.PERSAI_RUNTIME_TURN_TIMEOUT_MS
      );
      if (!response.ok) {
        this.throwForFailedResponse(response, "setup preview turn");
      }
      if (!this.isRuntimeTurnResult(response.body)) {
        throw new AssistantRuntimeError(
          "invalid_response",
          "Native runtime returned an invalid setup preview response."
        );
      }
      return {
        assistantMessage: response.body.assistantText,
        respondedAt: response.body.respondedAt
      };
    } finally {
      await this.invalidatePreviewBundleBestEffort({
        assistantId: input.assistantId,
        publishedVersionId: input.previewPublishedVersionId,
        baseUrl,
        timeoutMs
      });
    }
  }

  private buildPreviewTurnRequest(
    input: {
      assistantId: string;
      workspaceId: string;
      userId: string;
      runtimeTier: RuntimeTier;
      userMessage: string;
      userTimezone: string;
      currentTimeIso: string;
    },
    bundleRef: RuntimeBundleRef
  ): RuntimeTurnRequest {
    return {
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      runtimeTier: input.runtimeTier,
      bundle: bundleRef,
      conversation: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        channel: "web",
        externalThreadKey: `setup-preview:${input.assistantId}:${randomUUID()}`,
        externalUserKey: input.userId,
        mode: "direct"
      },
      message: {
        text: input.userMessage,
        attachments: [],
        locale: null,
        timezone: input.userTimezone,
        receivedAt: input.currentTimeIso
      }
    };
  }

  private async invalidatePreviewBundleBestEffort(input: {
    assistantId: string;
    publishedVersionId: string;
    baseUrl: string;
    timeoutMs: number;
  }): Promise<void> {
    try {
      await this.postJson(
        new URL("/api/v1/bundles/invalidate", input.baseUrl).toString(),
        {
          assistantId: input.assistantId,
          publishedVersionId: input.publishedVersionId
        },
        input.timeoutMs
      );
    } catch {
      return;
    }
  }

  private async postJson(url: string, body: unknown, timeoutMs: number): Promise<JsonResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
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
          `Native runtime preview request timed out after ${timeoutMs}ms.`
        );
      }
      const message = error instanceof Error ? error.message : "Unknown native preview failure.";
      throw new AssistantRuntimeError(
        "runtime_unreachable",
        `Native runtime preview request failed: ${message}`
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private throwForFailedResponse(response: JsonResponse, action: string): never {
    const message =
      this.extractErrorMessage(response.body) ??
      `Native runtime ${action} failed with HTTP ${response.status}.`;

    if (response.status === 400 || response.status === 413) {
      throw new AssistantRuntimeError("runtime_degraded", message);
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
      return body.trim();
    }
    const row = this.asObject(body);
    const nestedError = this.asObject(row?.error);
    const nestedMessage = this.readMessageField(nestedError?.message);
    return nestedMessage ?? this.readMessageField(row?.message);
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
      typeof row.respondedAt === "string"
    );
  }
}
