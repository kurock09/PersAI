import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeSandboxJobRequest,
  RuntimeSandboxToolResult,
  RuntimeToolPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { SandboxClientService } from "./sandbox-client.service";

export interface RuntimeSandboxToolExecutionResult {
  payload: RuntimeSandboxToolResult;
  isError: boolean;
}

@Injectable()
export class RuntimeSandboxToolService {
  constructor(
    private readonly sandboxClientService: SandboxClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
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
          job: null
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
          job: null
        },
        isError: true
      };
    }
    try {
      if (policy.dailyCallLimit !== null) {
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
              job: null
            },
            isError: false
          };
        }
      }

      const job = await this.sandboxClientService.waitForCompletion({
        assistantId: params.bundle.metadata.assistantId,
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
          networkAccessEnabled: false,
          artifactMimeAllowlist: [],
          webMaxOutboundBytes: 0,
          telegramMaxOutboundBytes: 0,
          sandboxJobsPerDay: null,
          maxArtifactSendCountPerTurn: 0
        },
        args: this.asObject(params.toolCall.arguments)
      } satisfies RuntimeSandboxJobRequest);

      return {
        payload: {
          toolCode: params.toolCall.name,
          executionMode: "sandbox",
          action:
            job.status === "completed"
              ? "completed"
              : job.status === "blocked"
                ? "blocked"
                : "skipped",
          reason: job.reason,
          warning: job.warning ?? job.violationMessage,
          job
        },
        isError: job.status !== "completed"
      };
    } catch (error) {
      return {
        payload: {
          toolCode: params.toolCall.name,
          executionMode: "sandbox",
          action: "skipped",
          reason: "sandbox_failed",
          warning: error instanceof Error ? error.message : "Sandbox tool execution failed.",
          job: null
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
}
