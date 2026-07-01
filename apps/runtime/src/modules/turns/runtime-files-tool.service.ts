import { createHash, randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  type ProviderGatewayToolCall,
  type RuntimeFileHandle,
  type RuntimeOutputArtifact,
  type RuntimeFilesToolAction,
  type RuntimeFilesToolItem,
  type RuntimeFilesToolResult,
  type RuntimeSandboxJobRequest,
  type RuntimeSandboxJobResult,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { SandboxClientService } from "./sandbox-client.service";

const DEFAULT_READ_MAX_BYTES = 1_048_576;
const DEFAULT_PREVIEW_MAX_BYTES = 256 * 1024;
const DEFAULT_LIST_MAX_DEPTH = 1;

type FilesScope = "chat" | "assistant" | "workspace_shared";

type FilesListRequest = {
  action: "list";
  path: string;
  maxDepth: number;
  scope: FilesScope;
};

type FilesReadRequest = {
  action: "read";
  path: string;
  maxBytes: number;
  crossScope?: boolean;
};

type FilesPreviewRequest = {
  action: "preview";
  path: string;
  maxBytes: number;
  crossScope?: boolean;
};

type FilesWriteRequest = {
  action: "write";
  path: string;
  content: string;
  mode?: "overwrite" | "create_only";
  replace?: boolean;
};

type FilesDeleteRequest = {
  action: "delete";
  path: string;
  crossScope?: boolean;
};

type FilesAttachRequest = {
  action: "attach";
  path: string;
  crossScope?: boolean;
};

type ParsedFilesToolRequest =
  | FilesListRequest
  | FilesReadRequest
  | FilesPreviewRequest
  | FilesWriteRequest
  | FilesDeleteRequest
  | FilesAttachRequest;

export interface RuntimeFilesToolExecutionResult {
  payload: RuntimeFilesToolResult;
  isError: boolean;
  discoveredFileHandles?: RuntimeFileHandle[];
  artifacts?: RuntimeOutputArtifact[];
}

const BINARY_PREVIEW_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

@Injectable()
export class RuntimeFilesToolService {
  private readonly logger = new Logger(RuntimeFilesToolService.name);

  constructor(
    private readonly sandboxClientService: SandboxClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    sessionId: string;
    requestId: string;
    channel: "web" | "telegram" | "max_ru";
    chatId: string | null;
    externalThreadKey: string | null;
    messageId: string | null;
  }): Promise<RuntimeFilesToolExecutionResult> {
    const policy = this.resolveAllowedToolPolicy(params.bundle);
    if (policy === null) {
      return this.skipped({
        requestedAction: this.readRequestedAction(params.toolCall.arguments),
        reason: "tool_unavailable",
        warning: null,
        path: this.readPathFromArguments(params.toolCall.arguments)
      });
    }

    if (!this.sandboxClientService.isConfigured()) {
      return this.skipped({
        requestedAction: this.readRequestedAction(params.toolCall.arguments),
        reason: "sandbox_unconfigured",
        warning: "Sandbox service is not configured.",
        path: this.readPathFromArguments(params.toolCall.arguments)
      });
    }

    const parsed = this.parseArguments(params.toolCall.arguments);
    if (parsed instanceof Error) {
      return this.skipped({
        requestedAction: this.readRequestedAction(params.toolCall.arguments),
        reason: "invalid_arguments",
        warning: parsed.message,
        path: this.readPathFromArguments(params.toolCall.arguments)
      });
    }

    try {
      const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
        assistantId: params.bundle.metadata.assistantId,
        toolCode: "files",
        dailyCallLimit: policy.dailyCallLimit
      });
      if (!quotaOutcome.allowed) {
        return this.skipped({
          requestedAction: parsed.action,
          reason: quotaOutcome.code,
          warning: quotaOutcome.message,
          path: parsed.path
        });
      }

      switch (parsed.action) {
        case "list":
          return await this.executeListAction(params, parsed);
        case "read":
          return await this.executeReadAction(params, parsed);
        case "preview":
          return await this.executePreviewAction(params, parsed);
        case "write":
          return await this.executeWriteAction(params, parsed);
        case "delete":
          return await this.executeDeleteAction(params, parsed);
        case "attach":
          return await this.executeAttachAction(params, parsed);
      }
    } catch (error) {
      return this.skipped({
        requestedAction: parsed.action,
        reason: "files_failed",
        warning: error instanceof Error ? error.message : "Files tool execution failed.",
        path: parsed.path
      });
    }
  }

  private async executeListAction(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      requestId: string;
      chatId: string | null;
    },
    request: FilesListRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    // ADR-128 Slice 4 — the flat workspace is fully manifest-backed; every
    // path under `/workspace/` lists from `workspace_file_metadata` instead
    // of a pod `find` because the pod FS is a cache and may be stale.
    if (this.isPersistedWorkspaceListPath(request.path)) {
      return this.executeListFromManifest(params, request);
    }
    const job = await this.runSandboxJob(params, {
      action: "list",
      path: request.path,
      maxDepth: request.maxDepth
    });
    if (job.status !== "completed") {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "list",
          action: "skipped",
          reason: job.reason ?? "files_failed",
          warning: job.warning ?? job.violationMessage,
          path: request.path
        },
        isError: true
      };
    }
    const parsedItems = this.parseListContent(job.content);
    const enrichedItems = await this.enrichListWithShortDescriptions(
      params.bundle.metadata.workspaceId,
      parsedItems
    );
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "list",
        action: "listed",
        reason: null,
        warning: job.warning,
        path: request.path,
        items: enrichedItems,
        item: enrichedItems[0] ?? null
      },
      isError: false
    };
  }

  private async executeListFromManifest(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      requestId: string;
      chatId: string | null;
    },
    request: FilesListRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    const assistantHandle = params.bundle.metadata.assistantHandle ?? "";
    try {
      const result = await this.persaiInternalApiClientService.listWorkspaceFilesFromManifest({
        workspaceId: params.bundle.metadata.workspaceId,
        pathPrefix: request.path,
        assistantHandle,
        scope: request.scope,
        currentChatId: params.chatId,
        currentAssistantId: params.bundle.metadata.assistantId
      });
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "list",
          action: "listed",
          reason: null,
          warning: null,
          path: request.path,
          items: result.items,
          item: result.items[0] ?? null
        },
        isError: false
      };
    } catch (error) {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "list",
          action: "skipped",
          reason: "files_failed",
          warning: error instanceof Error ? error.message : "Files list (manifest) failed.",
          path: request.path
        },
        isError: true
      };
    }
  }

  private isPersistedWorkspaceListPath(path: string): boolean {
    return path === "/workspace" || path === "/workspace/" || path.startsWith("/workspace/");
  }

  private async checkWorkspacePathScope(
    params: {
      bundle: AssistantRuntimeBundle;
      chatId: string | null;
    },
    action: RuntimeFilesToolAction,
    path: string,
    crossScope: boolean
  ): Promise<RuntimeFilesToolExecutionResult | null> {
    if (!path.startsWith("/workspace/") || crossScope) {
      return null;
    }
    try {
      const metadata = await this.persaiInternalApiClientService.getWorkspaceFileMetadata({
        workspaceId: params.bundle.metadata.workspaceId,
        path
      });
      // Missing manifest rows are allowed for current-turn shell-created files;
      // Block 3 later adds freshness guards for document project outputs.
      if (metadata === null) {
        return null;
      }
      if (params.chatId !== null && metadata.originChatId === params.chatId) {
        return null;
      }
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: action,
          action: "skipped",
          reason: "cross_scope_required",
          warning:
            'This file is outside the current chat scope. Run files.list with scope="assistant" or scope="workspace_shared" first, then retry with crossScope:true if the user explicitly wants that file.',
          path
        },
        isError: true
      };
    } catch (error) {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: action,
          action: "skipped",
          reason: "scope_check_failed",
          warning: error instanceof Error ? error.message : "Workspace file scope check failed.",
          path
        },
        isError: true
      };
    }
  }

  private async executeReadAction(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      requestId: string;
      chatId: string | null;
    },
    request: FilesReadRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    const scopeGuard = await this.checkWorkspacePathScope(
      params,
      request.action,
      request.path,
      request.crossScope === true
    );
    if (scopeGuard !== null) {
      return scopeGuard;
    }
    const job = await this.runSandboxJob(params, {
      action: "read",
      path: request.path,
      maxBytes: request.maxBytes
    });
    if (job.status !== "completed") {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "read",
          action: "skipped",
          reason: job.reason ?? "files_failed",
          warning: job.warning ?? job.violationMessage,
          path: request.path
        },
        isError: true
      };
    }
    const parsedRead = this.parseReadContent(job.content);
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "read",
        action: "read",
        reason: null,
        warning: job.warning,
        path: request.path,
        content: parsedRead.content,
        sizeBytes: parsedRead.sizeBytes,
        sha256: parsedRead.sha256,
        truncated: parsedRead.truncated,
        charCount: parsedRead.content === null ? null : Array.from(parsedRead.content).length,
        contentTruncated: parsedRead.truncated
      },
      isError: false
    };
  }

  private async executePreviewAction(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      requestId: string;
      chatId: string | null;
    },
    request: FilesPreviewRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    const scopeGuard = await this.checkWorkspacePathScope(
      params,
      request.action,
      request.path,
      request.crossScope === true
    );
    if (scopeGuard !== null) {
      return scopeGuard;
    }
    // Stat the file via the sandbox to classify text vs binary. Text-like MIME
    // types return inline preview content from stat; binary types fall back to
    // sandbox `read` with the caller's bounded `maxBytes`.
    const statJob = await this.runSandboxJob(params, {
      action: "stat",
      path: request.path
    });
    if (statJob.status !== "completed") {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "preview",
          action: "skipped",
          reason: statJob.reason ?? "files_failed",
          warning: statJob.warning ?? statJob.violationMessage,
          path: request.path
        },
        isError: true
      };
    }
    const stat = this.parseStatContent(statJob.content);
    const mimeType = stat?.mimeType ?? null;
    if (mimeType !== null && this.isBinaryPreviewMime(mimeType)) {
      const readJob = await this.runSandboxJob(params, {
        action: "read",
        path: request.path,
        maxBytes: request.maxBytes
      });
      if (readJob.status !== "completed") {
        return {
          payload: {
            toolCode: "files",
            executionMode: "inline",
            requestedAction: "preview",
            action: "skipped",
            reason: readJob.reason ?? "files_failed",
            warning: readJob.warning ?? readJob.violationMessage,
            path: request.path
          },
          isError: true
        };
      }
      const previewRead = this.parseReadContent(readJob.content);
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "preview",
          action: "previewed",
          reason: null,
          warning: readJob.warning,
          path: request.path,
          content: previewRead.content,
          mimeType,
          sizeBytes: previewRead.sizeBytes ?? stat?.sizeBytes ?? null,
          sha256: previewRead.sha256,
          truncated: previewRead.truncated,
          charCount: previewRead.content === null ? null : Array.from(previewRead.content).length,
          contentTruncated: previewRead.truncated
        },
        isError: false
      };
    }
    // Text/unknown: do a bounded sandbox read.
    const readJob = await this.runSandboxJob(params, {
      action: "read",
      path: request.path,
      maxBytes: request.maxBytes
    });
    if (readJob.status !== "completed") {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "preview",
          action: "skipped",
          reason: readJob.reason ?? "files_failed",
          warning: readJob.warning ?? readJob.violationMessage,
          path: request.path
        },
        isError: true
      };
    }
    const previewRead = this.parseReadContent(readJob.content);
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "preview",
        action: "previewed",
        reason: null,
        warning: readJob.warning,
        path: request.path,
        content: previewRead.content,
        sizeBytes: previewRead.sizeBytes ?? stat?.sizeBytes ?? null,
        sha256: previewRead.sha256,
        truncated: previewRead.truncated,
        charCount: previewRead.content === null ? null : Array.from(previewRead.content).length,
        contentTruncated: previewRead.truncated
      },
      isError: false
    };
  }

  private async executeWriteAction(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      requestId: string;
      chatId: string | null;
    },
    request: FilesWriteRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    const job = await this.runSandboxJob(params, {
      action: "write",
      path: request.path,
      content: request.content,
      ...(request.mode === undefined ? {} : { mode: request.mode }),
      ...(request.replace === undefined ? {} : { replace: request.replace })
    });
    if (job.status !== "completed") {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "write",
          action: "skipped",
          reason: job.reason ?? "files_failed",
          warning: job.warning ?? job.violationMessage,
          path: request.path
        },
        isError: true
      };
    }
    if (typeof job.reason === "string" && job.reason.length > 0) {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "write",
          action: "skipped",
          reason: job.reason,
          warning: job.warning,
          path: request.path
        },
        isError: true
      };
    }
    const writeOutcome = this.parseWriteContent(job.content);
    const resolvedPath = writeOutcome.resolvedPath ?? request.path;
    // ADR-128 Slice 4 — every successful write under `/workspace/` mirrors to
    // the authoritative manifest. The upsert is best-effort: failure is logged
    // at warn and the write outcome is still surfaced to the model.
    if (this.isPersistedWorkspaceWritePath(resolvedPath)) {
      const sizeBytes = writeOutcome.sizeBytes ?? request.content.length;
      try {
        await this.persaiInternalApiClientService.upsertWorkspaceFileMetadata({
          workspaceId: params.bundle.metadata.workspaceId,
          path: resolvedPath,
          mimeType: this.inferMimeForWrite(request.path, request.content),
          sizeBytes,
          contentHash: createHash("sha256").update(request.content, "utf8").digest("hex"),
          replace: request.replace === true || request.mode === "overwrite",
          ...(params.chatId === null
            ? {}
            : {
                originChatId: params.chatId,
                originAssistantId: params.bundle.metadata.assistantId
              })
        });
      } catch (error) {
        this.logger.warn(
          `files_write_manifest_upsert_failed path=${resolvedPath} reason=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "write",
        action: "written",
        reason: null,
        warning: job.warning,
        path: resolvedPath,
        sizeBytes: writeOutcome.sizeBytes
      },
      isError: false
    };
  }

  private isPersistedWorkspaceWritePath(path: string): boolean {
    return path.startsWith("/workspace/");
  }

  // The model passes raw text content via `files.write`. Without sniffing
  // file bytes (which the sandbox already did), pick a conservative mime
  // type from the extension and fall back to `text/plain` so the manifest
  // can store something meaningful.
  private inferMimeForWrite(path: string, content: string): string {
    const lower = path.toLowerCase();
    if (lower.endsWith(".json")) return "application/json";
    if (lower.endsWith(".csv")) return "text/csv";
    if (lower.endsWith(".tsv")) return "text/tab-separated-values";
    if (lower.endsWith(".md")) return "text/markdown";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
    if (lower.endsWith(".xml")) return "application/xml";
    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "application/yaml";
    if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain";
    // Heuristic: structured JSON-like content with no extension still benefits
    // from a richer mime than octet-stream so the gallery can categorise it.
    const trimmed = content.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(trimmed);
        return "application/json";
      } catch {
        // Fall through to text/plain.
      }
    }
    return "text/plain";
  }

  private async executeDeleteAction(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      requestId: string;
      chatId: string | null;
    },
    request: FilesDeleteRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    const scopeGuard = await this.checkWorkspacePathScope(
      params,
      request.action,
      request.path,
      request.crossScope === true
    );
    if (scopeGuard !== null) {
      return scopeGuard;
    }
    const job = await this.runSandboxJob(params, {
      action: "delete",
      path: request.path
    });
    if (job.status !== "completed") {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "delete",
          action: "skipped",
          reason: job.reason ?? "files_failed",
          warning: job.warning ?? job.violationMessage,
          path: request.path
        },
        isError: true
      };
    }
    if (this.isPersistedWorkspaceWritePath(request.path)) {
      try {
        await this.persaiInternalApiClientService.deleteWorkspaceFileFromManifest({
          workspaceId: params.bundle.metadata.workspaceId,
          path: request.path
        });
      } catch (error) {
        this.logger.warn(
          `files_delete_manifest_delete_failed path=${request.path} reason=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "delete",
        action: "deleted",
        reason: null,
        warning: job.warning,
        path: request.path
      },
      isError: false
    };
  }

  private async executeAttachAction(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      requestId: string;
      channel: "web" | "telegram" | "max_ru";
      chatId: string | null;
      externalThreadKey: string | null;
      messageId: string | null;
    },
    request: FilesAttachRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    const scopeGuard = await this.checkWorkspacePathScope(
      params,
      request.action,
      request.path,
      request.crossScope === true
    );
    if (scopeGuard !== null) {
      return scopeGuard;
    }
    const job = await this.runSandboxJob(params, {
      action: "attach",
      path: request.path
    });
    if (job.status !== "completed") {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "attach",
          action: "skipped",
          reason: job.reason ?? "files_failed",
          warning: job.warning ?? job.violationMessage,
          path: request.path
        },
        isError: true
      };
    }
    if (typeof job.reason === "string" && job.reason.length > 0) {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "attach",
          action: "skipped",
          reason: job.reason,
          warning: job.warning,
          path: request.path
        },
        isError: true
      };
    }
    const attachOutcome = this.parseAttachContent(job.content);
    if (attachOutcome === null) {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "attach",
          action: "skipped",
          reason: "files_attach_failed",
          warning: "Sandbox attach completed without attachment payload.",
          path: request.path
        },
        isError: true
      };
    }
    const outputArtifact: RuntimeOutputArtifact = {
      artifactId: randomUUID(),
      storagePath: attachOutcome.workspaceRelPath,
      kind: this.resolveOutputArtifactKindForMime(attachOutcome.mimeType),
      mimeType: attachOutcome.mimeType,
      filename: attachOutcome.displayName,
      sizeBytes: attachOutcome.sizeBytes,
      voiceNote: false
    };
    if (this.isPersistedWorkspaceWritePath(attachOutcome.workspaceRelPath)) {
      try {
        await this.persaiInternalApiClientService.upsertWorkspaceFileMetadata({
          workspaceId: params.bundle.metadata.workspaceId,
          path: attachOutcome.workspaceRelPath,
          mimeType: attachOutcome.mimeType,
          sizeBytes: attachOutcome.sizeBytes,
          ...(params.chatId === null
            ? {}
            : {
                originChatId: params.chatId,
                originAssistantId: params.bundle.metadata.assistantId
              })
        });
      } catch (error) {
        this.logger.warn(
          `files_attach_manifest_upsert_failed path=${attachOutcome.workspaceRelPath} reason=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "attach",
        action: "attached",
        reason: null,
        warning: job.warning,
        path: attachOutcome.workspaceRelPath,
        mimeType: attachOutcome.mimeType,
        displayName: attachOutcome.displayName,
        sizeBytes: attachOutcome.sizeBytes
      },
      artifacts: [outputArtifact],
      isError: false
    };
  }

  private async runSandboxJob(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      requestId: string;
    },
    args: Record<string, unknown>
  ): Promise<RuntimeSandboxJobResult> {
    const policy = params.bundle.runtime.sandbox;
    if (policy === undefined) {
      throw new Error("Sandbox policy is unavailable for files tool execution.");
    }
    const assistantHandle = params.bundle.metadata.assistantHandle ?? "";
    if (assistantHandle.length === 0) {
      throw new Error("Assistant handle is missing from the runtime bundle.");
    }
    const siblingHandles: readonly string[] = params.bundle.metadata.siblingAssistantHandles ?? [];
    const quota = params.bundle.governance.quota;
    return await this.sandboxClientService.waitForCompletion({
      assistantId: params.bundle.metadata.assistantId,
      assistantHandle,
      siblingHandles,
      workspaceId: params.bundle.metadata.workspaceId,
      runtimeRequestId: params.requestId,
      runtimeSessionId: params.sessionId,
      toolCode: "files",
      policy,
      workspaceQuotaBytes: quota.workspaceQuotaBytes ?? null,
      sharedQuotaBytes: quota.sharedQuotaBytes ?? null,
      args
    } satisfies RuntimeSandboxJobRequest);
  }

  private async enrichListWithShortDescriptions(
    workspaceId: string,
    items: RuntimeFilesToolItem[]
  ): Promise<RuntimeFilesToolItem[]> {
    if (items.length === 0) {
      return items;
    }
    try {
      const lookups = await this.persaiInternalApiClientService.listWorkspaceFileShortDescriptions({
        workspaceId,
        paths: items.map((item) => item.path)
      });
      const byPath = new Map(lookups.map((row) => [row.path, row.shortDescription] as const));
      return items.map((item) => {
        const descriptor = byPath.get(item.path);
        return {
          ...item,
          shortDescription: descriptor === undefined ? null : descriptor
        };
      });
    } catch (error) {
      this.logger.warn(
        `files_list_short_description_enrich_failed workspaceId=${workspaceId} reason=${error instanceof Error ? error.message : String(error)}`
      );
      return items.map((item) => ({ ...item, shortDescription: null }));
    }
  }

  private parseArguments(value: unknown): ParsedFilesToolRequest | Error {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return new Error("files arguments must be an object.");
    }
    const row = value as Record<string, unknown>;
    const action = this.readRequestedAction(row);
    if (action === null) {
      return new Error(
        'files.action must be one of "list", "read", "preview", "write", "delete", or "attach".'
      );
    }
    switch (action) {
      case "list": {
        const path = this.readNonEmptyString(row.path) ?? this.readNonEmptyString(row.dir);
        if (path === null) {
          return new Error("files.list requires a non-empty path or dir.");
        }
        const maxDepth =
          typeof row.maxDepth === "number" && Number.isInteger(row.maxDepth) && row.maxDepth > 0
            ? Math.min(row.maxDepth, 4)
            : DEFAULT_LIST_MAX_DEPTH;
        const scope = this.readFilesScope(row.scope);
        if (scope instanceof Error) {
          return scope;
        }
        return { action: "list", path, maxDepth, scope };
      }
      case "read": {
        const path = this.readNonEmptyString(row.path);
        if (path === null) {
          return new Error("files.read requires a non-empty path.");
        }
        const maxBytes =
          typeof row.maxBytes === "number" && Number.isInteger(row.maxBytes) && row.maxBytes > 0
            ? Math.min(row.maxBytes, DEFAULT_READ_MAX_BYTES)
            : DEFAULT_READ_MAX_BYTES;
        return {
          action: "read",
          path,
          maxBytes,
          ...(row.crossScope === true ? { crossScope: true } : {})
        };
      }
      case "preview": {
        const path = this.readNonEmptyString(row.path);
        if (path === null) {
          return new Error("files.preview requires a non-empty path.");
        }
        const maxBytes =
          typeof row.maxBytes === "number" && Number.isInteger(row.maxBytes) && row.maxBytes > 0
            ? Math.min(row.maxBytes, DEFAULT_PREVIEW_MAX_BYTES)
            : DEFAULT_PREVIEW_MAX_BYTES;
        return {
          action: "preview",
          path,
          maxBytes,
          ...(row.crossScope === true ? { crossScope: true } : {})
        };
      }
      case "write": {
        const path = this.readNonEmptyString(row.path);
        const content = this.readString(row.content);
        if (path === null || content === null) {
          return new Error("files.write requires a non-empty path and string content.");
        }
        const mode = row.mode === "create_only" || row.mode === "overwrite" ? row.mode : undefined;
        const replace = row.replace === true ? true : undefined;
        return {
          action: "write",
          path,
          content,
          ...(mode === undefined ? {} : { mode }),
          ...(replace === undefined ? {} : { replace })
        };
      }
      case "delete": {
        const path = this.readNonEmptyString(row.path);
        if (path === null) {
          return new Error("files.delete requires a non-empty path.");
        }
        return {
          action: "delete",
          path,
          ...(row.crossScope === true ? { crossScope: true } : {})
        };
      }
      case "attach": {
        const path = this.readNonEmptyString(row.path);
        if (path === null) {
          return new Error("files.attach requires a non-empty path.");
        }
        return {
          action: "attach",
          path,
          ...(row.crossScope === true ? { crossScope: true } : {})
        };
      }
    }
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

  private readFilesScope(value: unknown): FilesScope | Error {
    if (value === undefined || value === null) {
      return "chat";
    }
    if (value === "chat" || value === "assistant" || value === "workspace_shared") {
      return value;
    }
    return new Error('files.list scope must be "chat", "assistant", or "workspace_shared".');
  }

  private skipped(input: {
    requestedAction: RuntimeFilesToolAction | null;
    reason: string;
    warning: string | null;
    path: string | null;
  }): RuntimeFilesToolExecutionResult {
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: input.requestedAction,
        action: "skipped",
        reason: input.reason,
        warning: input.warning,
        path: input.path
      },
      isError: true
    };
  }

  private resolveOutputArtifactKindForMime(mimeType: string): RuntimeOutputArtifact["kind"] {
    const attachmentType = this.resolveAttachmentTypeForMime(mimeType);
    return attachmentType === "document" || attachmentType === "voice" ? "file" : attachmentType;
  }

  private resolveAttachmentTypeForMime(
    mimeType: string
  ): "image" | "document" | "audio" | "video" | "voice" {
    const normalized = mimeType.trim().toLowerCase();
    if (normalized.startsWith("image/")) {
      return "image";
    }
    if (normalized.startsWith("audio/")) {
      return "audio";
    }
    if (normalized.startsWith("video/")) {
      return "video";
    }
    return "document";
  }

  private isBinaryPreviewMime(mimeType: string): boolean {
    const normalized = mimeType.toLowerCase().trim().split(";")[0] ?? "";
    return BINARY_PREVIEW_MIME_TYPES.has(normalized) || normalized.startsWith("image/");
  }

  private parseListContent(content: string | null): RuntimeFilesToolItem[] {
    if (content === null) {
      return [];
    }
    try {
      const parsed = JSON.parse(content) as { items?: unknown };
      if (!Array.isArray(parsed.items)) {
        return [];
      }
      const items: RuntimeFilesToolItem[] = [];
      for (const entry of parsed.items) {
        if (entry === null || typeof entry !== "object") {
          continue;
        }
        const row = entry as Record<string, unknown>;
        const path = typeof row.path === "string" ? row.path : null;
        const type = row.type === "directory" ? "directory" : "file";
        if (path === null) {
          continue;
        }
        items.push({
          path,
          type,
          sizeBytes: typeof row.sizeBytes === "number" ? row.sizeBytes : 0,
          mimeType: typeof row.mimeType === "string" ? row.mimeType : null,
          modifiedAt: typeof row.modifiedAt === "string" ? row.modifiedAt : null
        });
      }
      return items;
    } catch {
      return [];
    }
  }

  private parseReadContent(content: string | null): {
    content: string | null;
    sizeBytes: number | null;
    sha256: string | null;
    truncated: boolean;
  } {
    if (content === null) {
      return { content: null, sizeBytes: null, sha256: null, truncated: false };
    }
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const body = typeof parsed.content === "string" ? parsed.content : null;
      return {
        content: body,
        sizeBytes: typeof parsed.sizeBytes === "number" ? parsed.sizeBytes : null,
        sha256: typeof parsed.sha256 === "string" ? parsed.sha256 : null,
        truncated: parsed.truncated === true
      };
    } catch {
      return { content, sizeBytes: null, sha256: null, truncated: false };
    }
  }

  private parseStatContent(content: string | null): {
    sizeBytes: number | null;
    mimeType: string | null;
  } | null {
    if (content === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return {
        sizeBytes: typeof parsed.sizeBytes === "number" ? parsed.sizeBytes : null,
        mimeType: typeof parsed.mimeType === "string" ? parsed.mimeType : null
      };
    } catch {
      return null;
    }
  }

  private parseWriteContent(content: string | null): {
    sizeBytes: number | null;
    resolvedPath: string | null;
  } {
    if (content === null) {
      return { sizeBytes: null, resolvedPath: null };
    }
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return {
        sizeBytes: typeof parsed.sizeBytes === "number" ? parsed.sizeBytes : null,
        resolvedPath: typeof parsed.resolvedPath === "string" ? parsed.resolvedPath : null
      };
    } catch {
      return { sizeBytes: null, resolvedPath: null };
    }
  }

  private parseAttachContent(content: string | null): {
    workspaceRelPath: string;
    sourcePath: string;
    sizeBytes: number;
    mimeType: string;
    displayName: string;
  } | null {
    if (content === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const attachment =
        parsed.attachment !== null && typeof parsed.attachment === "object"
          ? (parsed.attachment as Record<string, unknown>)
          : null;
      if (attachment === null) {
        return null;
      }
      const workspaceRelPath =
        typeof attachment.workspaceRelPath === "string" ? attachment.workspaceRelPath : null;
      const sourcePath = typeof attachment.sourcePath === "string" ? attachment.sourcePath : null;
      const sizeBytes = typeof attachment.sizeBytes === "number" ? attachment.sizeBytes : null;
      const mimeType = typeof attachment.mimeType === "string" ? attachment.mimeType : null;
      const displayName =
        typeof attachment.displayName === "string" ? attachment.displayName : null;
      if (
        workspaceRelPath === null ||
        sourcePath === null ||
        sizeBytes === null ||
        mimeType === null ||
        displayName === null
      ) {
        return null;
      }
      return { workspaceRelPath, sourcePath, sizeBytes, mimeType, displayName };
    } catch {
      return null;
    }
  }

  private readRequestedAction(value: unknown): RuntimeFilesToolAction | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const action = (value as Record<string, unknown>).action;
    return action === "list" ||
      action === "read" ||
      action === "preview" ||
      action === "write" ||
      action === "delete" ||
      action === "attach"
      ? action
      : null;
  }

  private readPathFromArguments(value: unknown): string | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    return this.readNonEmptyString(row.path) ?? this.readNonEmptyString(row.dir);
  }

  private readNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private readString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
  }
}
