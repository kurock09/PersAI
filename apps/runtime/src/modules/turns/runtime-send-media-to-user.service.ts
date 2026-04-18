import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeOutputArtifact,
  RuntimeSendMediaToUserToolResult,
  RuntimeToolPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { RuntimeStatePrismaService } from "../runtime-state/infrastructure/persistence/runtime-state-prisma.service";

export interface RuntimeSendMediaToUserExecutionResult {
  payload: RuntimeSendMediaToUserToolResult;
  artifacts: RuntimeOutputArtifact[];
  isError: boolean;
}

@Injectable()
export class RuntimeSendMediaToUserService {
  constructor(
    private readonly prisma: RuntimeStatePrismaService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    currentArtifacts: RuntimeOutputArtifact[];
    channel: "web" | "telegram" | "max_ru";
  }): Promise<RuntimeSendMediaToUserExecutionResult> {
    const policy = this.resolveAllowedToolPolicy(params.bundle);
    if (policy === null) {
      return {
        payload: {
          toolCode: "send_media_to_user",
          executionMode: "inline",
          action: "skipped",
          reason: "tool_unavailable",
          warning: null,
          fileRefs: [],
          artifactIds: [],
          queuedArtifacts: 0
        },
        artifacts: [],
        isError: false
      };
    }
    const request = this.parseArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: {
          toolCode: "send_media_to_user",
          executionMode: "inline",
          action: "skipped",
          reason: "invalid_arguments",
          warning: request.message,
          fileRefs: [],
          artifactIds: [],
          queuedArtifacts: 0
        },
        artifacts: [],
        isError: true
      };
    }
    try {
      if (policy.dailyCallLimit !== null) {
        const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
          assistantId: params.bundle.metadata.assistantId,
          toolCode: "send_media_to_user",
          dailyCallLimit: policy.dailyCallLimit
        });
        if (!quotaOutcome.allowed) {
          return {
            payload: {
              toolCode: "send_media_to_user",
              executionMode: "inline",
              action: "skipped",
              reason: quotaOutcome.code,
              warning: quotaOutcome.message,
              fileRefs: request.fileRefs,
              artifactIds: request.artifactIds,
              queuedArtifacts: 0
            },
            artifacts: [],
            isError: false
          };
        }
      }

      const queuedArtifacts = await this.resolveArtifacts({
        bundle: params.bundle,
        currentArtifacts: params.currentArtifacts,
        fileRefs: request.fileRefs,
        artifactIds: request.artifactIds,
        caption: request.caption,
        filename: request.filename
      });

      const maxCount = params.bundle.runtime.sandbox?.maxArtifactSendCountPerTurn ?? 0;
      const existingArtifactIds = new Set(
        params.currentArtifacts.map((artifact) => artifact.artifactId)
      );
      const additionalArtifacts = queuedArtifacts.filter(
        (artifact) => !existingArtifactIds.has(artifact.artifactId)
      );
      const finalArtifacts = [...params.currentArtifacts, ...additionalArtifacts];
      if (params.currentArtifacts.length + additionalArtifacts.length > maxCount) {
        return {
          payload: {
            toolCode: "send_media_to_user",
            executionMode: "inline",
            action: "skipped",
            reason: "artifact_send_limit_exceeded",
            warning: `Turn would deliver ${String(
              params.currentArtifacts.length + additionalArtifacts.length
            )} artifacts, above the per-turn cap of ${String(maxCount)}.`,
            fileRefs: request.fileRefs,
            artifactIds: request.artifactIds,
            queuedArtifacts: 0
          },
          artifacts: [],
          isError: true
        };
      }

      const channelCap =
        params.channel === "telegram"
          ? params.bundle.runtime.sandbox?.telegramMaxOutboundBytes
          : params.bundle.runtime.sandbox?.webMaxOutboundBytes;
      const totalOutboundBytes = finalArtifacts.reduce((sum, artifact) => {
        return (
          sum +
          (typeof artifact.sizeBytes === "number" && Number.isFinite(artifact.sizeBytes)
            ? artifact.sizeBytes
            : 0)
        );
      }, 0);
      if (channelCap !== undefined && totalOutboundBytes > channelCap) {
        return {
          payload: {
            toolCode: "send_media_to_user",
            executionMode: "inline",
            action: "skipped",
            reason: "channel_size_limit_exceeded",
            warning: `Turn would deliver ${String(totalOutboundBytes)} bytes on ${params.channel}, above the channel cap of ${String(channelCap)} bytes.`,
            fileRefs: request.fileRefs,
            artifactIds: request.artifactIds,
            queuedArtifacts: 0
          },
          artifacts: [],
          isError: true
        };
      }

      return {
        payload: {
          toolCode: "send_media_to_user",
          executionMode: "inline",
          action: "queued",
          reason: null,
          warning: null,
          fileRefs: request.fileRefs,
          artifactIds: request.artifactIds,
          queuedArtifacts: queuedArtifacts.length
        },
        artifacts: queuedArtifacts,
        isError: false
      };
    } catch (error) {
      return {
        payload: {
          toolCode: "send_media_to_user",
          executionMode: "inline",
          action: "skipped",
          reason: "send_media_resolution_failed",
          warning: error instanceof Error ? error.message : "Failed to resolve file references.",
          fileRefs: request.fileRefs,
          artifactIds: request.artifactIds,
          queuedArtifacts: 0
        },
        artifacts: [],
        isError: true
      };
    }
  }

  private resolveAllowedToolPolicy(bundle: AssistantRuntimeBundle): RuntimeToolPolicy | null {
    const policy =
      bundle.governance.toolPolicies.find((entry) => entry.toolCode === "send_media_to_user") ??
      null;
    if (
      policy === null ||
      policy.executionMode !== "inline" ||
      policy.enabled !== true ||
      policy.visibleToModel !== true ||
      policy.usageRule !== "allowed" ||
      bundle.runtime.sandbox?.enabled !== true
    ) {
      return null;
    }
    return policy;
  }

  private parseArguments(value: unknown):
    | {
        fileRefs: string[];
        artifactIds: string[];
        caption: string | null;
        filename: string | null;
      }
    | Error {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return new Error("send_media_to_user arguments must be an object.");
    }
    const row = value as Record<string, unknown>;
    const fileRefs = Array.isArray(row.fileRefs)
      ? row.fileRefs.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : [];
    const artifactIds = Array.isArray(row.artifactIds)
      ? row.artifactIds.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : [];
    if (fileRefs.length === 0 && artifactIds.length === 0) {
      return new Error("At least one fileRef or artifactId is required.");
    }
    const caption =
      typeof row.caption === "string" && row.caption.trim().length > 0 ? row.caption : null;
    const filename =
      typeof row.filename === "string" && row.filename.trim().length > 0 ? row.filename : null;
    return { fileRefs, artifactIds, caption, filename };
  }

  private async resolveArtifacts(input: {
    bundle: AssistantRuntimeBundle;
    currentArtifacts: RuntimeOutputArtifact[];
    fileRefs: string[];
    artifactIds: string[];
    caption: string | null;
    filename: string | null;
  }): Promise<RuntimeOutputArtifact[]> {
    const allowlist = new Set(
      (input.bundle.runtime.sandbox?.artifactMimeAllowlist ?? []).map((entry) =>
        entry.toLowerCase()
      )
    );
    const artifactMap = new Map(
      input.currentArtifacts.map((artifact) => [artifact.artifactId, artifact] as const)
    );
    const selectedCurrentArtifacts = input.artifactIds.map(
      (artifactId) => artifactMap.get(artifactId) ?? null
    );
    if (selectedCurrentArtifacts.some((artifact) => artifact === null)) {
      throw new Error("One or more artifactIds do not refer to current-turn artifacts.");
    }
    for (const artifact of selectedCurrentArtifacts) {
      this.assertMimeAllowed(artifact!.mimeType, allowlist);
    }

    const refs = await this.prisma.sandboxFileRef.findMany({
      where: {
        id: { in: input.fileRefs },
        assistantId: input.bundle.metadata.assistantId,
        workspaceId: input.bundle.metadata.workspaceId
      }
    });
    if (refs.length !== input.fileRefs.length) {
      throw new Error("One or more fileRefs are unavailable for this assistant.");
    }

    const resolvedFileArtifacts = refs.map((ref) => {
      this.assertMimeAllowed(ref.mimeType, allowlist);
      return {
        artifactId: randomUUID(),
        kind: this.toArtifactKind(ref.mimeType),
        objectKey: ref.objectKey,
        mimeType: ref.mimeType,
        filename:
          input.filename !== null && input.fileRefs.length + input.artifactIds.length === 1
            ? input.filename
            : (ref.displayName ?? ref.relativePath.split("/").pop() ?? "file"),
        sizeBytes: Number(ref.sizeBytes),
        voiceNote: false,
        caption: input.caption
      } satisfies RuntimeOutputArtifact;
    });

    const resolvedCurrentArtifacts = selectedCurrentArtifacts.map((artifact) => ({
      ...artifact!,
      ...(input.caption !== null ? { caption: input.caption } : {}),
      ...(input.filename !== null && input.fileRefs.length + input.artifactIds.length === 1
        ? { filename: input.filename }
        : {})
    }));

    return [...resolvedFileArtifacts, ...resolvedCurrentArtifacts];
  }

  private assertMimeAllowed(mimeType: string, allowlist: Set<string>): void {
    if (allowlist.size > 0 && !allowlist.has(mimeType.toLowerCase())) {
      throw new Error(`Mime type "${mimeType}" is blocked by sandbox delivery policy.`);
    }
  }

  private toArtifactKind(mimeType: string): RuntimeOutputArtifact["kind"] {
    if (mimeType.startsWith("image/")) {
      return "image";
    }
    if (mimeType.startsWith("audio/")) {
      return "audio";
    }
    if (mimeType.startsWith("video/")) {
      return "video";
    }
    return "file";
  }
}
