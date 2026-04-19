import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolCall,
  RuntimeFileRef,
  RuntimeFilesToolAction,
  RuntimeFilesToolItem,
  RuntimeFilesToolResult,
  RuntimeOutputArtifact,
  RuntimeSandboxJobRequest,
  RuntimeSandboxJobResult,
  RuntimeToolPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { RuntimeAssistantFileRegistryService } from "./runtime-assistant-file-registry.service";
import { SandboxClientService } from "./sandbox-client.service";

const DEFAULT_FILES_SEARCH_LIMIT = 8;
const MAX_FILES_SEARCH_LIMIT = 20;

type FilesSearchRequest = {
  action: "search";
  query: string;
  limit: number;
};

type FilesLookupTarget = {
  fileRef: string | null;
  path: string | null;
  query: string | null;
};

type FilesGetRequest = FilesLookupTarget & {
  action: "get";
};

type FilesReadRequest = FilesLookupTarget & {
  action: "read";
};

type FilesWriteRequest = {
  action: "write";
  path: string;
  content: string;
};

type FilesEditRequest = {
  action: "edit";
  fileRef: string | null;
  path: string | null;
  query: string | null;
  oldText: string;
  newText: string;
};

type FilesSendRequest = {
  action: "send";
  fileRef: string | null;
  path: string | null;
  query: string | null;
  fileRefs: string[];
  artifactIds: string[];
  caption: string | null;
  filename: string | null;
};

type ParsedFilesToolRequest =
  | FilesSearchRequest
  | FilesGetRequest
  | FilesReadRequest
  | FilesWriteRequest
  | FilesEditRequest
  | FilesSendRequest;

type ResolvedFilesToolTarget =
  | { item: RuntimeFilesToolItem; warning: string | null }
  | { item: null; reason: string; warning: string | null; items?: RuntimeFilesToolItem[] };

type SandboxFilesAction = "read" | "write" | "edit";
type RuntimeResolvedQueuedArtifacts = {
  artifacts: RuntimeOutputArtifact[];
  queuedArtifacts: number;
  reason: string | null;
  warning: string | null;
  isError: boolean;
};

export interface RuntimeFilesToolExecutionResult {
  payload: RuntimeFilesToolResult;
  artifacts: RuntimeOutputArtifact[];
  isError: boolean;
}

@Injectable()
export class RuntimeFilesToolService {
  constructor(
    private readonly runtimeAssistantFileRegistryService: RuntimeAssistantFileRegistryService,
    private readonly sandboxClientService: SandboxClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
    currentArtifacts: RuntimeOutputArtifact[];
    currentFileRefs: RuntimeFileRef[];
    channel: "web" | "telegram" | "max_ru";
  }): Promise<RuntimeFilesToolExecutionResult> {
    const policy = this.resolveAllowedToolPolicy(params.bundle);
    if (policy === null) {
      return {
        payload: this.createSkippedResult({
          reason: "tool_unavailable",
          requestedAction: this.readRequestedAction(params.toolCall.arguments),
          warning: null
        }),
        artifacts: [],
        isError: false
      };
    }

    if (!this.sandboxClientService.isConfigured()) {
      return {
        payload: this.createSkippedResult({
          reason: "sandbox_unconfigured",
          requestedAction: this.readRequestedAction(params.toolCall.arguments),
          warning: "Sandbox service is not configured."
        }),
        artifacts: [],
        isError: true
      };
    }

    const request = this.parseArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: this.createSkippedResult({
          reason: "invalid_arguments",
          requestedAction: this.readRequestedAction(params.toolCall.arguments),
          warning: request.message
        }),
        artifacts: [],
        isError: true
      };
    }

    try {
      if (policy.dailyCallLimit !== null) {
        const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
          assistantId: params.bundle.metadata.assistantId,
          toolCode: "files",
          dailyCallLimit: policy.dailyCallLimit
        });
        if (!quotaOutcome.allowed) {
          return {
            payload: this.createSkippedResult({
              reason: quotaOutcome.code,
              requestedAction: request.action,
              warning: quotaOutcome.message
            }),
            artifacts: [],
            isError: false
          };
        }
      }

      switch (request.action) {
        case "search":
          return await this.executeSearchAction(params.bundle, request);
        case "get":
          return await this.executeGetAction(params.bundle, request, params.currentFileRefs);
        case "read":
          return await this.executeReadAction(params, request);
        case "write":
          return await this.executeWriteAction(params, request);
        case "edit":
          return await this.executeEditAction(params, request);
        case "send":
          return await this.executeSendAction(params, request);
      }
    } catch (error) {
      return {
        payload: this.createSkippedResult({
          reason: "files_failed",
          requestedAction: request.action,
          warning: error instanceof Error ? error.message : "Files tool execution failed."
        }),
        artifacts: [],
        isError: true
      };
    }
  }

  private async executeSearchAction(
    bundle: AssistantRuntimeBundle,
    request: FilesSearchRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    const items = (
      await this.runtimeAssistantFileRegistryService.search({
        assistantId: bundle.metadata.assistantId,
        workspaceId: bundle.metadata.workspaceId,
        query: request.query,
        limit: request.limit
      })
    ).map((item) => this.runtimeAssistantFileRegistryService.toRuntimeFilesToolItem(item));
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "search",
        action: "results",
        reason: null,
        warning: null,
        item: items[0] ?? null,
        items,
        content: null,
        job: null,
        fileRefs: items.map((item) => item.fileRef),
        artifactIds: [],
        queuedArtifacts: 0
      },
      artifacts: [],
      isError: false
    };
  }

  private async executeGetAction(
    bundle: AssistantRuntimeBundle,
    request: FilesGetRequest,
    currentFileRefs: RuntimeFileRef[]
  ): Promise<RuntimeFilesToolExecutionResult> {
    const resolved = await this.resolveTarget({
      assistantId: bundle.metadata.assistantId,
      workspaceId: bundle.metadata.workspaceId,
      currentFileRefs,
      fileRef: request.fileRef,
      path: request.path,
      query: request.query
    });
    if (resolved.item === null) {
      return {
        payload: {
          ...this.createSkippedResult({
            reason: resolved.reason,
            requestedAction: "get",
            warning: resolved.warning
          }),
          items: resolved.items ?? []
        },
        artifacts: [],
        isError: resolved.reason !== "file_not_found"
      };
    }
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "get",
        action: "fetched",
        reason: null,
        warning: resolved.warning,
        item: resolved.item,
        items: [resolved.item],
        content: null,
        job: null,
        fileRefs: [resolved.item.fileRef],
        artifactIds: [],
        queuedArtifacts: 0
      },
      artifacts: [],
      isError: false
    };
  }

  private async executeReadAction(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      requestId: string;
      currentArtifacts: RuntimeOutputArtifact[];
      currentFileRefs: RuntimeFileRef[];
      channel: "web" | "telegram" | "max_ru";
    },
    request: FilesReadRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    const resolved = await this.resolveTarget({
      assistantId: params.bundle.metadata.assistantId,
      workspaceId: params.bundle.metadata.workspaceId,
      currentFileRefs: params.currentFileRefs,
      fileRef: request.fileRef,
      path: request.path,
      query: request.query
    });
    if (resolved.item === null) {
      return {
        payload: {
          ...this.createSkippedResult({
            reason: resolved.reason,
            requestedAction: "read",
            warning: resolved.warning
          }),
          items: resolved.items ?? []
        },
        artifacts: [],
        isError: resolved.reason !== "file_not_found"
      };
    }

    const job = await this.executeSandboxJob({
      bundle: params.bundle,
      sessionId: params.sessionId,
      requestId: params.requestId,
      action: "read",
      args: {
        action: "read",
        path: resolved.item.relativePath
      },
      mountedFileRefs: []
    });

    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "read",
        action: job.status === "completed" ? "read" : "skipped",
        reason: job.reason,
        warning: job.warning ?? job.violationMessage,
        item: resolved.item,
        items: [resolved.item],
        content: job.content,
        job,
        fileRefs: [resolved.item.fileRef],
        artifactIds: [],
        queuedArtifacts: 0
      },
      artifacts: [],
      isError: job.status !== "completed"
    };
  }

  private async executeWriteAction(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      requestId: string;
      currentArtifacts: RuntimeOutputArtifact[];
      currentFileRefs: RuntimeFileRef[];
      channel: "web" | "telegram" | "max_ru";
    },
    request: FilesWriteRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    const job = await this.executeSandboxJob({
      bundle: params.bundle,
      sessionId: params.sessionId,
      requestId: params.requestId,
      action: "write",
      args: {
        action: "write",
        path: request.path,
        content: request.content
      },
      mountedFileRefs: []
    });
    const items = this.toItemsFromJob(job);
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "write",
        action: job.status === "completed" ? "written" : "skipped",
        reason: job.reason,
        warning: job.warning ?? job.violationMessage,
        item: items[0] ?? null,
        items,
        content: null,
        job,
        fileRefs: items.map((item) => item.fileRef),
        artifactIds: [],
        queuedArtifacts: 0
      },
      artifacts: [],
      isError: job.status !== "completed"
    };
  }

  private async executeEditAction(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      requestId: string;
      currentArtifacts: RuntimeOutputArtifact[];
      currentFileRefs: RuntimeFileRef[];
      channel: "web" | "telegram" | "max_ru";
    },
    request: FilesEditRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    const resolved = await this.resolveTarget({
      assistantId: params.bundle.metadata.assistantId,
      workspaceId: params.bundle.metadata.workspaceId,
      currentFileRefs: params.currentFileRefs,
      fileRef: request.fileRef,
      path: request.path,
      query: request.query
    });
    if (resolved.item === null) {
      return {
        payload: {
          ...this.createSkippedResult({
            reason: resolved.reason,
            requestedAction: "edit",
            warning: resolved.warning
          }),
          items: resolved.items ?? []
        },
        artifacts: [],
        isError: resolved.reason !== "file_not_found"
      };
    }

    const job = await this.executeSandboxJob({
      bundle: params.bundle,
      sessionId: params.sessionId,
      requestId: params.requestId,
      action: "edit",
      args: {
        action: "edit",
        path: resolved.item.relativePath,
        oldText: request.oldText,
        newText: request.newText
      },
      mountedFileRefs: []
    });
    const items = this.toItemsFromJob(job);
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "edit",
        action: job.status === "completed" ? "edited" : "skipped",
        reason: job.reason,
        warning: job.warning ?? job.violationMessage ?? resolved.warning,
        item: items[0] ?? resolved.item,
        items,
        content: null,
        job,
        fileRefs: items.map((item) => item.fileRef),
        artifactIds: [],
        queuedArtifacts: 0
      },
      artifacts: [],
      isError: job.status !== "completed"
    };
  }

  private async executeSendAction(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      requestId: string;
      currentArtifacts: RuntimeOutputArtifact[];
      currentFileRefs: RuntimeFileRef[];
      channel: "web" | "telegram" | "max_ru";
    },
    request: FilesSendRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    const selectedFileRefs = [...request.fileRefs];
    if (request.fileRef !== null || request.path !== null || request.query !== null) {
      const resolved = await this.resolveTarget({
        assistantId: params.bundle.metadata.assistantId,
        workspaceId: params.bundle.metadata.workspaceId,
        currentFileRefs: params.currentFileRefs,
        fileRef: request.fileRef,
        path: request.path,
        query: request.query
      });
      if (resolved.item === null) {
        return {
          payload: {
            ...this.createSkippedResult({
              reason: resolved.reason,
              requestedAction: "send",
              warning: resolved.warning
            }),
            items: resolved.items ?? []
          },
          artifacts: [],
          isError: resolved.reason !== "file_not_found"
        };
      }
      selectedFileRefs.push(resolved.item.fileRef);
    }

    const dedupedFileRefs = [...new Set(selectedFileRefs)];
    const queued = await this.queueResolvedSelection({
      bundle: params.bundle,
      currentArtifacts: params.currentArtifacts,
      channel: params.channel,
      selection: {
        fileRefs: dedupedFileRefs,
        artifactIds: request.artifactIds,
        caption: request.caption,
        filename: request.filename
      }
    });

    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "send",
        action: queued.isError ? "skipped" : "queued",
        reason: queued.reason,
        warning: queued.warning,
        item: null,
        items: [],
        content: null,
        job: null,
        fileRefs: dedupedFileRefs,
        artifactIds: request.artifactIds,
        queuedArtifacts: queued.queuedArtifacts
      },
      artifacts: queued.artifacts,
      isError: queued.isError
    };
  }

  private resolveAllowedToolPolicy(bundle: AssistantRuntimeBundle): RuntimeToolPolicy | null {
    const policy =
      bundle.governance.toolPolicies.find((entry) => entry.toolCode === "files") ?? null;
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

  private async queueResolvedSelection(params: {
    bundle: AssistantRuntimeBundle;
    currentArtifacts: RuntimeOutputArtifact[];
    channel: "web" | "telegram" | "max_ru";
    selection: {
      fileRefs: string[];
      artifactIds: string[];
      caption: string | null;
      filename: string | null;
    };
  }): Promise<RuntimeResolvedQueuedArtifacts> {
    const queuedArtifacts = await this.resolveArtifacts({
      bundle: params.bundle,
      currentArtifacts: params.currentArtifacts,
      fileRefs: params.selection.fileRefs,
      artifactIds: params.selection.artifactIds,
      caption: params.selection.caption,
      filename: params.selection.filename
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
        artifacts: [],
        queuedArtifacts: 0,
        reason: "artifact_send_limit_exceeded",
        warning: `Turn would deliver ${String(
          params.currentArtifacts.length + additionalArtifacts.length
        )} artifacts, above the per-turn cap of ${String(maxCount)}.`,
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
        artifacts: [],
        queuedArtifacts: 0,
        reason: "channel_size_limit_exceeded",
        warning: `Turn would deliver ${String(totalOutboundBytes)} bytes on ${params.channel}, above the channel cap of ${String(channelCap)} bytes.`,
        isError: true
      };
    }

    return {
      artifacts: queuedArtifacts,
      queuedArtifacts: queuedArtifacts.length,
      reason: null,
      warning: null,
      isError: false
    };
  }

  private parseArguments(value: unknown): ParsedFilesToolRequest | Error {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return new Error("files arguments must be an object.");
    }
    const row = value as Record<string, unknown>;
    const action = this.readRequestedAction(row);
    if (action === null) {
      return new Error("files.action must be one of search, get, read, write, edit, or send.");
    }
    switch (action) {
      case "search": {
        const query = this.readNonEmptyString(row.query);
        if (query === null) {
          return new Error("files.search requires a non-empty query.");
        }
        const limit =
          typeof row.limit === "number" &&
          Number.isInteger(row.limit) &&
          row.limit > 0 &&
          row.limit <= MAX_FILES_SEARCH_LIMIT
            ? row.limit
            : DEFAULT_FILES_SEARCH_LIMIT;
        return { action, query, limit };
      }
      case "get":
        return {
          action: "get",
          fileRef: this.readNonEmptyString(row.fileRef),
          path: this.readNonEmptyString(row.path),
          query: this.readNonEmptyString(row.query)
        };
      case "read":
        return {
          action: "read",
          fileRef: this.readNonEmptyString(row.fileRef),
          path: this.readNonEmptyString(row.path),
          query: this.readNonEmptyString(row.query)
        };
      case "write": {
        const path = this.readNonEmptyString(row.path);
        const content = this.readString(row.content);
        if (path === null || content === null) {
          return new Error("files.write requires a non-empty path and string content.");
        }
        return { action, path, content };
      }
      case "edit": {
        const oldText = this.readString(row.oldText);
        const newText = this.readString(row.newText);
        if (oldText === null || newText === null) {
          return new Error("files.edit requires string oldText and newText values.");
        }
        return {
          action,
          fileRef: this.readNonEmptyString(row.fileRef),
          path: this.readNonEmptyString(row.path),
          query: this.readNonEmptyString(row.query),
          oldText,
          newText
        };
      }
      case "send": {
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
        const fileRef = this.readNonEmptyString(row.fileRef);
        const path = this.readNonEmptyString(row.path);
        const query = this.readNonEmptyString(row.query);
        if (
          fileRefs.length === 0 &&
          artifactIds.length === 0 &&
          fileRef === null &&
          path === null &&
          query === null
        ) {
          return new Error(
            "files.send requires fileRefs, artifactIds, or one target selector: fileRef, path, or query."
          );
        }
        return {
          action,
          fileRef,
          path,
          query,
          fileRefs,
          artifactIds,
          caption: this.readNonEmptyString(row.caption),
          filename: this.readNonEmptyString(row.filename)
        };
      }
    }
  }

  private async resolveTarget(input: {
    assistantId: string;
    workspaceId: string;
    currentFileRefs: RuntimeFileRef[];
    fileRef: string | null;
    path: string | null;
    query: string | null;
  }): Promise<ResolvedFilesToolTarget> {
    if (input.fileRef !== null) {
      const current = input.currentFileRefs.find((item) => item.fileRef === input.fileRef);
      if (current !== undefined) {
        return { item: this.toItemFromRuntimeFileRef(current), warning: null };
      }
      const stored = await this.runtimeAssistantFileRegistryService.findByFileRef({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        fileRef: input.fileRef
      });
      return stored === null
        ? { item: null, reason: "file_not_found", warning: "Requested fileRef is unavailable." }
        : {
            item: this.runtimeAssistantFileRegistryService.toRuntimeFilesToolItem(stored),
            warning: null
          };
    }

    if (input.path !== null) {
      const current = input.currentFileRefs.find((item) => item.relativePath === input.path);
      if (current !== undefined) {
        return { item: this.toItemFromRuntimeFileRef(current), warning: null };
      }
      const stored = await this.runtimeAssistantFileRegistryService.findLatestByPath({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        relativePath: input.path
      });
      return stored === null
        ? { item: null, reason: "file_not_found", warning: `No file found at "${input.path}".` }
        : {
            item: this.runtimeAssistantFileRegistryService.toRuntimeFilesToolItem(stored),
            warning: null
          };
    }

    if (input.query !== null) {
      const matches = (
        await this.runtimeAssistantFileRegistryService.search({
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          query: input.query,
          limit: 2
        })
      ).map((item) => this.runtimeAssistantFileRegistryService.toRuntimeFilesToolItem(item));
      if (matches.length === 0) {
        return {
          item: null,
          reason: "file_not_found",
          warning: `No assistant file matched "${input.query}".`
        };
      }
      if (matches.length > 1) {
        return {
          item: null,
          reason: "ambiguous_file_query",
          warning: `Multiple assistant files matched "${input.query}". Refine the query or use fileRef.`,
          items: matches
        };
      }
      return { item: matches[0]!, warning: null };
    }

    return {
      item: null,
      reason: "file_selector_required",
      warning: "Provide fileRef, path, or query for this files action."
    };
  }

  private async executeSandboxJob(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    requestId: string;
    action: SandboxFilesAction;
    args: Record<string, unknown>;
    mountedFileRefs: string[];
  }): Promise<RuntimeSandboxJobResult> {
    const policy = input.bundle.runtime.sandbox;
    if (policy === undefined) {
      throw new Error("Sandbox policy is unavailable for files tool execution.");
    }
    return await this.sandboxClientService.waitForCompletion({
      assistantId: input.bundle.metadata.assistantId,
      workspaceId: input.bundle.metadata.workspaceId,
      runtimeRequestId: input.requestId,
      runtimeSessionId: input.sessionId,
      toolCode: "files",
      policy,
      mountedFileRefs: input.mountedFileRefs,
      args: input.args
    } satisfies RuntimeSandboxJobRequest);
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

    const refs = await this.runtimeAssistantFileRegistryService.listByFileRefs({
      assistantId: input.bundle.metadata.assistantId,
      workspaceId: input.bundle.metadata.workspaceId,
      fileRefs: input.fileRefs
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
        sizeBytes: ref.sizeBytes,
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

  private toItemsFromJob(job: RuntimeSandboxJobResult): RuntimeFilesToolItem[] {
    return job.files.map((file) => ({
      fileRef: file.fileRef.fileRef,
      origin: file.fileRef.origin,
      sourceToolCode: file.fileRef.sourceToolCode,
      relativePath: file.fileRef.relativePath,
      displayName: file.fileRef.displayName,
      mimeType: file.fileRef.mimeType,
      sizeBytes: file.fileRef.sizeBytes,
      logicalSizeBytes: file.fileRef.logicalSizeBytes
    }));
  }

  private toItemFromRuntimeFileRef(fileRef: RuntimeFileRef): RuntimeFilesToolItem {
    return {
      fileRef: fileRef.fileRef,
      origin: fileRef.origin,
      sourceToolCode: fileRef.sourceToolCode,
      relativePath: fileRef.relativePath,
      displayName: fileRef.displayName,
      mimeType: fileRef.mimeType,
      sizeBytes: fileRef.sizeBytes,
      logicalSizeBytes: fileRef.logicalSizeBytes
    };
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

  private createSkippedResult(input: {
    reason: string;
    requestedAction: RuntimeFilesToolAction | null;
    warning: string | null;
  }): RuntimeFilesToolResult {
    return {
      toolCode: "files",
      executionMode: "inline",
      requestedAction: input.requestedAction,
      action: "skipped",
      reason: input.reason,
      warning: input.warning,
      item: null,
      items: [],
      content: null,
      job: null,
      fileRefs: [],
      artifactIds: [],
      queuedArtifacts: 0
    };
  }

  private readRequestedAction(value: unknown): RuntimeFilesToolAction | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const action = (value as Record<string, unknown>).action;
    return action === "search" ||
      action === "get" ||
      action === "read" ||
      action === "write" ||
      action === "edit" ||
      action === "send"
      ? action
      : null;
  }

  private readNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private readString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
  }
}
