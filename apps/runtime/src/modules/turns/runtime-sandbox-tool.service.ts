import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  classifyVisibleWorkspacePath,
  type ProviderGatewayToolCall,
  type RuntimeSandboxDocumentSyncOutcome,
  type RuntimeSandboxJobRequest,
  type RuntimeSandboxToolResult,
  type RuntimeToolPolicy,
  type RuntimeSandboxProducedFile
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { SandboxClientService } from "./sandbox-client.service";
import type { TurnToolProgressSink } from "./tool-progress-sink";

export interface RuntimeSandboxToolExecutionResult {
  payload: RuntimeSandboxToolResult;
  isError: boolean;
}

@Injectable()
export class RuntimeSandboxToolService {
  private readonly logger = new Logger(RuntimeSandboxToolService.name);

  constructor(
    private readonly sandboxClientService: SandboxClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
    chatId?: string | null;
    sourceUserMessageText?: string | null;
    sourceUserMessageCreatedAt?: string | null;
    abortSignal?: AbortSignal;
    toolProgressSink?: TurnToolProgressSink;
  }): Promise<RuntimeSandboxToolExecutionResult> {
    const policy = this.resolveAllowedSandboxToolPolicy(params.bundle, params.toolCall.name);
    if (policy === null) {
      return {
        payload: {
          toolCode: params.toolCall.name,
          executionMode: "sandbox",
          action: "skipped",
          reason: "tool_unavailable",
          warning: null,
          job: null,
          paths: []
        },
        isError: false
      };
    }
    if (!this.sandboxClientService.isConfigured()) {
      return {
        payload: {
          toolCode: params.toolCall.name,
          executionMode: "sandbox",
          action: "skipped",
          reason: "sandbox_unconfigured",
          warning: "Sandbox service is not configured.",
          job: null,
          paths: []
        },
        isError: true
      };
    }
    if (params.abortSignal?.aborted) {
      return {
        payload: {
          toolCode: params.toolCall.name,
          executionMode: "sandbox",
          action: "skipped",
          reason: "user_stopped",
          warning: "Sandbox tool execution was cancelled because the turn was stopped.",
          job: null,
          paths: []
        },
        isError: true
      };
    }
    try {
      // ADR-074 L1.1 — always count for observability (sandbox CPU
      // minutes are billed by Daytona regardless of plan cap).
      const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
        assistantId: params.bundle.metadata.assistantId,
        toolCode: params.toolCall.name,
        dailyCallLimit: policy.dailyCallLimit
      });
      if (!quotaOutcome.allowed) {
        return {
          payload: {
            toolCode: params.toolCall.name,
            executionMode: "sandbox",
            action: "skipped",
            reason: quotaOutcome.code,
            warning: quotaOutcome.message,
            job: null,
            paths: []
          },
          isError: false
        };
      }

      const job = await this.sandboxClientService.waitForCompletion(
        {
          assistantId: params.bundle.metadata.assistantId,
          assistantHandle: params.bundle.metadata.assistantHandle,
          siblingHandles: params.bundle.metadata.siblingAssistantHandles,
          workspaceId: params.bundle.metadata.workspaceId,
          runtimeRequestId: params.requestId,
          runtimeSessionId: params.sessionId,
          toolCode: params.toolCall.name,
          policy: params.bundle.runtime.sandbox ?? {
            enabled: false,
            maxSingleFileWriteBytes: 0,
            maxWorkspaceBytesPerJob: 0,
            maxPersistedArtifactsPerJob: 0,
            maxFileCountPerJob: 0,
            maxDirectoryCountPerJob: 0,
            maxProcessRuntimeMs: 0,
            maxCpuMsPerJob: 0,
            maxMemoryBytesPerJob: 0,
            maxConcurrentProcesses: 0,
            maxStdoutBytes: 0,
            maxStderrBytes: 0,
            artifactMimeAllowlist: [],
            webMaxOutboundBytes: 0,
            telegramMaxOutboundBytes: 0,
            sandboxJobsPerDay: null,
            maxArtifactSendCountPerTurn: 0
          },
          args: this.asObject(params.toolCall.arguments)
        } satisfies RuntimeSandboxJobRequest,
        {
          ...(params.abortSignal === undefined ? {} : { signal: params.abortSignal }),
          ...(params.toolProgressSink === undefined
            ? {}
            : {
                onPoll: (polledJob) => {
                  params.toolProgressSink?.trackSandboxPoll({
                    toolCallId: params.toolCall.id,
                    toolName: params.toolCall.name,
                    job: polledJob
                  });
                }
              })
        }
      );

      if (job.status !== "completed") {
        return {
          payload: {
            toolCode: params.toolCall.name,
            executionMode: "sandbox",
            action: job.status === "blocked" ? "blocked" : "skipped",
            reason: job.reason,
            warning: job.warning ?? job.violationMessage,
            job,
            paths: job.files.map((file) => file.storagePath)
          },
          isError: true
        };
      }

      let documentSync: RuntimeSandboxDocumentSyncOutcome[] | undefined;
      if (job.files.length > 0) {
        try {
          const outcomes = await this.syncVisibleWorkspaceProducedOutputs({
            bundle: params.bundle,
            chatId: params.chatId ?? null,
            files: job.files,
            sourceUserMessageText: params.sourceUserMessageText ?? null,
            sourceUserMessageCreatedAt:
              params.sourceUserMessageCreatedAt ?? new Date().toISOString()
          });
          if (outcomes.length > 0) {
            documentSync = outcomes;
          }
        } catch (error) {
          return {
            payload: {
              toolCode: params.toolCall.name,
              executionMode: "sandbox",
              action: "skipped",
              reason: "manifest_sync_failed",
              warning: error instanceof Error ? error.message : "Manifest sync failed.",
              job,
              paths: job.files.map((file) => file.storagePath)
            },
            isError: true
          };
        }
      }

      return {
        payload: {
          toolCode: params.toolCall.name,
          executionMode: "sandbox",
          action: job.reason === "process_failed" ? "skipped" : "completed",
          reason: job.reason,
          warning: job.warning ?? job.violationMessage,
          job,
          paths: job.files.map((file) => file.storagePath),
          ...(documentSync !== undefined ? { documentSync } : {})
        },
        isError: job.reason === "process_failed"
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return {
          payload: {
            toolCode: params.toolCall.name,
            executionMode: "sandbox",
            action: "skipped",
            reason: "user_stopped",
            warning: "Sandbox tool execution was cancelled because the turn was stopped.",
            job: null,
            paths: []
          },
          isError: true
        };
      }
      return {
        payload: {
          toolCode: params.toolCall.name,
          executionMode: "sandbox",
          action: "skipped",
          reason: "sandbox_failed",
          warning: error instanceof Error ? error.message : "Sandbox tool execution failed.",
          job: null,
          paths: []
        },
        isError: true
      };
    }
  }

  private resolveAllowedSandboxToolPolicy(
    bundle: AssistantRuntimeBundle,
    toolCode: string
  ): RuntimeToolPolicy | null {
    const policy =
      bundle.governance.toolPolicies.find((entry) => entry.toolCode === toolCode) ?? null;
    if (
      policy === null ||
      policy.executionMode !== "sandbox" ||
      policy.enabled !== true ||
      policy.visibleToModel !== true ||
      policy.usageRule !== "allowed" ||
      bundle.runtime.sandbox?.enabled !== true
    ) {
      return null;
    }
    return policy;
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new ServiceUnavailableException("Sandbox tool arguments must be a JSON object.");
    }
    return value as Record<string, unknown>;
  }

  private async syncVisibleWorkspaceProducedOutputs(input: {
    bundle: AssistantRuntimeBundle;
    chatId: string | null;
    files: RuntimeSandboxProducedFile[];
    sourceUserMessageText: string | null;
    sourceUserMessageCreatedAt: string;
  }): Promise<RuntimeSandboxDocumentSyncOutcome[]> {
    const outcomes: RuntimeSandboxDocumentSyncOutcome[] = [];
    for (const file of input.files) {
      if (!this.isVisibleWorkspaceProducedFilePath(file.storagePath)) {
        continue;
      }
      const committedBytes = await this.mediaObjectStorage.downloadByWorkspacePath({
        workspaceId: input.bundle.metadata.workspaceId,
        storagePath: file.storagePath
      });
      if (committedBytes === null || committedBytes.length === 0) {
        throw new Error(`manifest_sync_no_gcs path=${file.storagePath}`);
      }
      const existing = await this.persaiInternalApiClientService.getWorkspaceFileMetadata({
        workspaceId: input.bundle.metadata.workspaceId,
        path: file.storagePath
      });
      const upsertResult = await this.persaiInternalApiClientService.upsertWorkspaceFileMetadata({
        workspaceId: input.bundle.metadata.workspaceId,
        path: file.storagePath,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        contentHash: file.contentHash ?? null,
        replace: existing !== null,
        ...(input.chatId !== null ? { originChatId: input.chatId } : {}),
        originAssistantId: input.bundle.metadata.assistantId,
        ...(input.sourceUserMessageText !== null
          ? { sourceUserMessageText: input.sourceUserMessageText }
          : {}),
        sourceUserMessageCreatedAt: input.sourceUserMessageCreatedAt
      });
      const registration = upsertResult.documentRegistration;
      if (registration === null) {
        continue;
      }
      outcomes.push({
        path: file.storagePath,
        registered: registration.registered,
        versionNumber: registration.versionNumber,
        bumped: registration.bumped,
        isOverwrite: registration.isOverwrite,
        contentChanged: registration.contentChanged
      });
    }
    return outcomes;
  }

  private isVisibleWorkspaceProducedFilePath(path: string): boolean {
    const normalizedPath = path.trim();
    const info = classifyVisibleWorkspacePath(normalizedPath);
    return (
      info.kind === "sessionDescendant" ||
      info.kind === "assistantSharedDescendant" ||
      info.kind === "workspaceSharedDescendant"
    );
  }
}
