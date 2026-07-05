import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  buildAssistantSessionRoot,
  buildAssistantWorkspaceRoot,
  classifyVisibleWorkspacePath,
  type ProviderGatewayMessageContentBlock,
  type ProviderGatewayToolCall,
  type RuntimeFileHandle,
  type RuntimeOutputArtifact,
  type RuntimeFilesToolAction,
  type RuntimeFilesToolItem,
  type RuntimeFilesToolResult,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import {
  buildFilePreviewBlocks,
  resolveFilePreviewCapSource
} from "./runtime-file-preview-hydration";
import { readFilesToolEffectivePreviewLimits } from "./runtime-file-capabilities";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { RuntimeStoragePlaneFilesService } from "./runtime-storage-plane-files.service";

const DEFAULT_READ_MAX_BYTES = 1_048_576;
const DEFAULT_PREVIEW_MAX_BYTES = 256 * 1024;
const DEFAULT_LIST_MAX_DEPTH = 1;

type FilesScope = "chat" | "assistant" | "workspace";

type FilesListRequest = {
  action: "list";
  path: string | null;
  maxDepth: number;
};

type FilesReadRequest = {
  action: "read";
  path: string;
  maxBytes: number;
};

type FilesPreviewRequest = {
  action: "preview";
  path: string;
  maxBytes: number;
};

type FilesWriteRequest = {
  action: "write";
  path: string | null;
  requestedName: string | null;
  content: string;
  mode?: "create_only";
  replace?: boolean;
};

type FilesDeleteRequest = {
  action: "delete";
  path: string;
};

type FilesAttachRequest = {
  action: "attach";
  path: string;
};

type FilesSearchRequest = {
  action: "search";
  query: string;
  path: string | null;
};

type ParsedFilesToolRequest =
  | FilesListRequest
  | FilesReadRequest
  | FilesPreviewRequest
  | FilesWriteRequest
  | FilesDeleteRequest
  | FilesAttachRequest
  | FilesSearchRequest;

export interface RuntimeFilesToolExecutionResult {
  payload: RuntimeFilesToolResult;
  isError: boolean;
  discoveredFileHandles?: RuntimeFileHandle[];
  artifacts?: RuntimeOutputArtifact[];
  pendingFilePreviewBlocks?: ProviderGatewayMessageContentBlock[];
}

@Injectable()
export class RuntimeFilesToolService {
  private readonly logger = new Logger(RuntimeFilesToolService.name);

  constructor(
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
    private readonly storagePlaneFilesService: RuntimeStoragePlaneFilesService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
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
    sourceUserMessageText?: string | null;
    sourceUserMessageCreatedAt?: string | null;
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
        case "search":
          return await this.executeSearchAction(params, parsed);
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

  private scratchPathSkipped(
    action: RuntimeFilesToolAction,
    path: string | null
  ): RuntimeFilesToolExecutionResult {
    return this.skipped({
      requestedAction: action,
      reason: "scratch_path_unsupported",
      warning:
        "Scratch paths under /tmp are pod-only during shell/exec; use shell for ephemeral files.",
      path
    });
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
    const path = request.path ?? this.resolveDefaultListPath(params);
    // ADR-133 keeps `/workspace/...` manifest-backed: persisted hierarchical
    // paths list from `workspace_file_metadata` instead of a pod `find`
    // because the pod FS is a cache and may be stale.
    if (this.isPersistedWorkspaceListPath(path)) {
      return this.executeListFromManifest(params, { ...request, path });
    }
    if (this.storagePlaneFilesService.isScratchPath(path)) {
      return this.scratchPathSkipped("list", path);
    }
    return this.skipped({
      requestedAction: "list",
      reason: "invalid_arguments",
      warning: "files.list supports manifest-backed /workspace/... paths only.",
      path
    });
  }

  private async executeListFromManifest(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      requestId: string;
      chatId: string | null;
    },
    request: FilesListRequest & { path: string }
  ): Promise<RuntimeFilesToolExecutionResult> {
    const assistantId = params.bundle.metadata.assistantId;
    try {
      const result = await this.persaiInternalApiClientService.listWorkspaceFilesFromManifest({
        workspaceId: params.bundle.metadata.workspaceId,
        pathPrefix: request.path,
        assistantId,
        scope: this.resolveManifestListScope({
          path: request.path,
          assistantId,
          sessionId: params.sessionId
        }),
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

  private resolveDefaultListPath(params: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
  }): string {
    const assistantId = params.bundle.metadata.assistantId;
    if (assistantId.length === 0) {
      return "/workspace";
    }
    return buildAssistantSessionRoot(assistantId, params.sessionId);
  }

  private resolveManifestListScope(input: {
    path: string;
    assistantId: string;
    sessionId: string;
  }): FilesScope {
    if (input.assistantId.length === 0) {
      return "workspace";
    }
    const sessionRoot = buildAssistantSessionRoot(input.assistantId, input.sessionId);
    if (input.path === sessionRoot || input.path.startsWith(`${sessionRoot}/`)) {
      return "chat";
    }
    const assistantRoot = buildAssistantWorkspaceRoot(input.assistantId);
    if (input.path === assistantRoot || input.path.startsWith(`${assistantRoot}/`)) {
      return "assistant";
    }
    return "workspace";
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
    if (this.storagePlaneFilesService.isPersistedWorkspacePath(request.path)) {
      const outcome = await this.storagePlaneFilesService.readTextFile({
        workspaceId: params.bundle.metadata.workspaceId,
        path: request.path,
        maxBytes: request.maxBytes
      });
      if (!outcome.ok) {
        return {
          payload: {
            toolCode: "files",
            executionMode: "inline",
            requestedAction: "read",
            action: "skipped",
            reason: outcome.reason,
            warning: outcome.warning,
            path: request.path
          },
          isError: true
        };
      }
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "read",
          action: "read",
          reason: null,
          warning: null,
          path: request.path,
          content: outcome.content,
          sizeBytes: outcome.sizeBytes,
          sha256: outcome.sha256,
          truncated: outcome.truncated,
          charCount: Array.from(outcome.content).length,
          contentTruncated: outcome.truncated
        },
        isError: false
      };
    }
    if (this.storagePlaneFilesService.isScratchPath(request.path)) {
      return this.scratchPathSkipped("read", request.path);
    }
    return this.skipped({
      requestedAction: "read",
      reason: "invalid_arguments",
      warning: "files.read supports manifest-backed /workspace/... paths only.",
      path: request.path
    });
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
    if (this.storagePlaneFilesService.isScratchPath(request.path)) {
      return this.scratchPathSkipped("preview", request.path);
    }
    if (!this.storagePlaneFilesService.isPersistedWorkspacePath(request.path)) {
      return this.skipped({
        requestedAction: "preview",
        reason: "invalid_arguments",
        warning: "files.preview supports manifest-backed /workspace/... paths only.",
        path: request.path
      });
    }
    const metadata = await this.persaiInternalApiClientService.getWorkspaceFileMetadata({
      workspaceId: params.bundle.metadata.workspaceId,
      path: request.path
    });
    if (metadata === null) {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "preview",
          action: "skipped",
          reason: "file_not_found",
          warning: `Workspace file ${request.path} was not found in the manifest.`,
          path: request.path
        },
        isError: true
      };
    }
    const mimeType = metadata.mimeType;
    const normalizedMime = mimeType.trim().toLowerCase();
    const isImage = normalizedMime.startsWith("image/");
    const isPdf = normalizedMime === "application/pdf" || normalizedMime === "application/x-pdf";
    const displayName = request.path.split("/").pop() ?? request.path;

    if (isImage || isPdf) {
      const filesPolicy =
        params.bundle.governance.toolPolicies.find((entry) => entry.toolCode === "files") ?? null;
      const limits = readFilesToolEffectivePreviewLimits(filesPolicy);
      const effectiveMaxPreviewBytes = Math.min(request.maxBytes, limits.effectiveMaxPreviewBytes);
      const hydration = await buildFilePreviewBlocks({
        downloadBytes: () =>
          this.mediaObjectStorage.downloadByWorkspacePath({
            workspaceId: params.bundle.metadata.workspaceId,
            storagePath: request.path
          }),
        mimeType,
        filename: displayName,
        sizeBytes: metadata.sizeBytes,
        effectiveMaxPreviewBytes,
        effectiveMaxPreviewEdgePx: limits.effectiveMaxPreviewEdgePx,
        alias: null,
        instruction: null
      });
      if (!hydration.ok) {
        return {
          payload: {
            toolCode: "files",
            executionMode: "inline",
            requestedAction: "preview",
            action: "skipped",
            reason: hydration.reason,
            warning:
              hydration.reason === "preview_size_limit"
                ? `File exceeds the effective preview byte limit (${String(effectiveMaxPreviewBytes)}). Use files.read for text when supported.`
                : hydration.reason === "preview_unsupported"
                  ? "Visual preview is only available for images and native PDF files under the preview byte limit."
                  : "Failed to download the file for visual preview.",
            path: request.path
          },
          isError: true
        };
      }
      this.logger.log(
        `file_preview assistantId=${params.bundle.metadata.assistantId} path=${request.path} mimeType=${mimeType} bytes=${String(hydration.bytes)} effectiveMaxPreviewBytes=${String(effectiveMaxPreviewBytes)} capSource=${resolveFilePreviewCapSource(filesPolicy?.maxFilePreviewBytes ?? null)}`
      );
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "preview",
          action: "previewed",
          reason: null,
          warning: null,
          path: request.path,
          content: JSON.stringify({
            mimeType,
            visualKind: hydration.visualKind
          }),
          mimeType,
          sizeBytes: hydration.bytes,
          truncated: false,
          charCount: 0,
          contentTruncated: false
        },
        isError: false,
        pendingFilePreviewBlocks: hydration.blocks
      };
    }

    const outcome = await this.storagePlaneFilesService.readTextFile({
      workspaceId: params.bundle.metadata.workspaceId,
      path: request.path,
      maxBytes: request.maxBytes
    });
    if (!outcome.ok) {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "preview",
          action: "skipped",
          reason: outcome.reason,
          warning: outcome.warning,
          path: request.path
        },
        isError: true
      };
    }
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "preview",
        action: "previewed",
        reason: null,
        warning: null,
        path: request.path,
        content: outcome.content,
        mimeType,
        sizeBytes: outcome.sizeBytes,
        sha256: outcome.sha256,
        truncated: outcome.truncated,
        charCount: Array.from(outcome.content).length,
        contentTruncated: outcome.truncated
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
      sourceUserMessageText?: string | null;
      sourceUserMessageCreatedAt?: string | null;
    },
    request: FilesWriteRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    const targetPath = this.resolveWriteTargetPath(params, request);
    if (targetPath instanceof Error) {
      return this.skipped({
        requestedAction: "write",
        reason: "invalid_arguments",
        warning: targetPath.message,
        path: request.path ?? request.requestedName
      });
    }
    if (this.storagePlaneFilesService.isPersistedWorkspacePath(targetPath)) {
      const outcome = await this.storagePlaneFilesService.writeTextFile({
        bundle: params.bundle,
        sessionId: params.sessionId,
        chatId: params.chatId,
        targetPath,
        content: request.content,
        ...(request.mode === undefined ? {} : { mode: request.mode }),
        ...(request.replace === undefined ? {} : { replace: request.replace }),
        requestedName: request.requestedName,
        ...(params.sourceUserMessageText === undefined || params.sourceUserMessageText === null
          ? {}
          : { sourceUserMessageText: params.sourceUserMessageText }),
        ...(params.sourceUserMessageCreatedAt === undefined ||
        params.sourceUserMessageCreatedAt === null
          ? {}
          : { sourceUserMessageCreatedAt: params.sourceUserMessageCreatedAt })
      });
      if (!outcome.ok) {
        return {
          payload: {
            toolCode: "files",
            executionMode: "inline",
            requestedAction: "write",
            action: "skipped",
            reason: outcome.reason,
            warning: outcome.warning,
            path: targetPath
          },
          isError: true
        };
      }
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "write",
          action: "written",
          reason: null,
          warning: null,
          path: outcome.resolvedPath,
          sizeBytes: outcome.sizeBytes
        },
        isError: false
      };
    }
    if (this.storagePlaneFilesService.isScratchPath(targetPath)) {
      return this.scratchPathSkipped("write", targetPath);
    }
    return this.skipped({
      requestedAction: "write",
      reason: "invalid_arguments",
      warning: "files.write supports manifest-backed /workspace/... paths only.",
      path: targetPath
    });
  }

  private resolveWriteTargetPath(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
    },
    request: FilesWriteRequest
  ): string | Error {
    const assistantId = params.bundle.metadata.assistantId?.trim() ?? "";
    if (assistantId.length === 0) {
      return new Error("files.write requires a runtime assistant id.");
    }
    const sessionRoot = buildAssistantSessionRoot(assistantId, params.sessionId);
    const rawPath = request.path?.trim() ?? null;
    const requestedName = request.requestedName?.trim() ?? null;
    if (rawPath !== null && requestedName !== null) {
      return new Error("files.write accepts either path or requestedName, not both.");
    }
    const candidate = rawPath ?? requestedName;
    if (candidate === null || candidate.length === 0) {
      return new Error(
        "files.write requires requestedName for new files or path for an existing file."
      );
    }
    if (candidate.startsWith("/tmp/")) {
      return candidate;
    }
    if (!candidate.startsWith("/")) {
      return this.resolveSessionRelativeWritePath(sessionRoot, candidate);
    }
    const placeholderRoot = "/workspace/assistants/current/sessions/current";
    if (candidate === placeholderRoot || candidate.startsWith(`${placeholderRoot}/`)) {
      return this.resolveSessionRelativeWritePath(
        sessionRoot,
        candidate.slice(placeholderRoot.length).replace(/^\/+/, "")
      );
    }
    const currentSessionPlaceholderRoot = `/workspace/assistants/${assistantId}/sessions/current`;
    if (
      candidate === currentSessionPlaceholderRoot ||
      candidate.startsWith(`${currentSessionPlaceholderRoot}/`)
    ) {
      return this.resolveSessionRelativeWritePath(
        sessionRoot,
        candidate.slice(currentSessionPlaceholderRoot.length).replace(/^\/+/, "")
      );
    }
    const currentAssistantPlaceholderRoot = `/workspace/assistants/current/sessions/${params.sessionId}`;
    if (
      candidate === currentAssistantPlaceholderRoot ||
      candidate.startsWith(`${currentAssistantPlaceholderRoot}/`)
    ) {
      return this.resolveSessionRelativeWritePath(
        sessionRoot,
        candidate.slice(currentAssistantPlaceholderRoot.length).replace(/^\/+/, "")
      );
    }
    const pathInfo = classifyVisibleWorkspacePath(candidate);
    if (
      (pathInfo.kind === "sessionRoot" || pathInfo.kind === "sessionDescendant") &&
      (pathInfo.assistantId !== assistantId || pathInfo.sessionId !== params.sessionId)
    ) {
      return new Error(
        "files.write cannot create files by spelling assistant/session IDs; use requestedName or a relative path for the current session."
      );
    }
    return candidate;
  }

  private resolveSessionRelativeWritePath(
    sessionRoot: string,
    relativePath: string
  ): string | Error {
    const normalizedRelative = relativePath.trim().replace(/^\.\/+/, "");
    if (
      normalizedRelative.length === 0 ||
      normalizedRelative.startsWith("/") ||
      normalizedRelative.includes("\\") ||
      Array.from(normalizedRelative).some((char) => char.charCodeAt(0) < 32)
    ) {
      return new Error("files.write requestedName/path must be a relative file path.");
    }
    const segments = normalizedRelative.split("/");
    if (
      segments.some(
        (segment) =>
          segment.length === 0 || segment === "." || segment === ".." || segment === "..."
      )
    ) {
      return new Error(
        "files.write relative paths must not contain empty, dot, or parent segments."
      );
    }
    return `${sessionRoot}/${segments.join("/")}`;
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
    if (this.storagePlaneFilesService.isScratchPath(request.path)) {
      return this.scratchPathSkipped("delete", request.path);
    }
    const outcome = await this.storagePlaneFilesService.deletePersistedWorkspaceFile({
      workspaceId: params.bundle.metadata.workspaceId,
      path: request.path
    });
    if (!outcome.ok) {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "delete",
          action: "skipped",
          reason: outcome.reason,
          warning: outcome.warning,
          path: request.path
        },
        isError: true
      };
    }
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "delete",
        action: "deleted",
        reason: null,
        warning: null,
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
    if (this.storagePlaneFilesService.isScratchPath(request.path)) {
      return this.scratchPathSkipped("attach", request.path);
    }
    const outcome = await this.storagePlaneFilesService.attachPersistedWorkspaceFile({
      workspaceId: params.bundle.metadata.workspaceId,
      path: request.path
    });
    if (!outcome.ok) {
      return {
        payload: {
          toolCode: "files",
          executionMode: "inline",
          requestedAction: "attach",
          action: "skipped",
          reason: outcome.reason,
          warning: outcome.warning,
          path: request.path
        },
        isError: true
      };
    }
    const outputArtifact: RuntimeOutputArtifact = {
      artifactId: randomUUID(),
      storagePath: outcome.workspaceRelPath,
      kind: this.resolveOutputArtifactKindForMime(outcome.mimeType),
      mimeType: outcome.mimeType,
      filename: outcome.displayName,
      sizeBytes: outcome.sizeBytes,
      voiceNote: false
    };
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "attach",
        action: "attached",
        reason: null,
        warning: null,
        path: outcome.workspaceRelPath,
        mimeType: outcome.mimeType,
        displayName: outcome.displayName,
        sizeBytes: outcome.sizeBytes
      },
      artifacts: [outputArtifact],
      isError: false
    };
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
        'files.action must be one of "list", "read", "preview", "write", "delete", "attach", or "search".'
      );
    }
    switch (action) {
      case "list": {
        const path = this.readNonEmptyString(row.path) ?? this.readNonEmptyString(row.dir);
        const maxDepth =
          typeof row.maxDepth === "number" && Number.isInteger(row.maxDepth) && row.maxDepth > 0
            ? Math.min(row.maxDepth, 4)
            : DEFAULT_LIST_MAX_DEPTH;
        return {
          action: "list",
          path,
          maxDepth
        };
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
          maxBytes
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
          maxBytes
        };
      }
      case "write": {
        const path = this.readNonEmptyString(row.path);
        const requestedName = this.readNonEmptyString(row.requestedName);
        const content = this.readString(row.content);
        if ((path === null && requestedName === null) || content === null) {
          return new Error("files.write requires requestedName or path plus string content.");
        }
        const mode = row.mode === "create_only" ? row.mode : undefined;
        const replace = row.replace === true ? true : undefined;
        return {
          action: "write",
          path,
          requestedName,
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
          path
        };
      }
      case "attach": {
        const path = this.readNonEmptyString(row.path);
        if (path === null) {
          return new Error("files.attach requires a non-empty path.");
        }
        return {
          action: "attach",
          path
        };
      }
      case "search": {
        const query = this.readNonEmptyString(row.query);
        if (query === null) {
          return new Error("files.search requires a non-empty query.");
        }
        const path = this.readNonEmptyString(row.path) ?? this.readNonEmptyString(row.dir);
        return {
          action: "search",
          query,
          path
        };
      }
      default:
        return new Error(`Unsupported files action: ${String(action)}`);
    }
  }

  private async executeSearchAction(
    params: {
      bundle: AssistantRuntimeBundle;
      sessionId: string;
      chatId: string | null;
    },
    request: FilesSearchRequest
  ): Promise<RuntimeFilesToolExecutionResult> {
    const sessionId =
      params.sessionId.trim().length > 0 ? params.sessionId : params.bundle.metadata.assistantId;
    const pathPrefix =
      request.path ?? buildAssistantSessionRoot(params.bundle.metadata.assistantId, sessionId);
    const results = await this.persaiInternalApiClientService.searchWorkspaceFiles({
      workspaceId: params.bundle.metadata.workspaceId,
      assistantId: params.bundle.metadata.assistantId,
      sessionId,
      query: request.query
    });
    const items: RuntimeFilesToolItem[] = results.map((row) => ({
      path: row.path,
      type: "file",
      sizeBytes: row.sizeBytes,
      mimeType: row.mimeType,
      modifiedAt: null,
      shortDescription: row.shortDescription
    }));
    const discoveredFileHandles: RuntimeFileHandle[] = items.map((item, index) => ({
      storagePath: item.path,
      mimeType: item.mimeType ?? "application/octet-stream",
      sizeBytes: item.sizeBytes,
      displayName: item.path.split("/").pop() ?? item.path,
      workspaceId: params.bundle.metadata.workspaceId,
      authorLabel: "sandbox",
      semanticSummaryHint: item.shortDescription ?? null,
      aliases: [`found file #${String(index + 1)}`]
    }));
    return {
      payload: {
        toolCode: "files",
        executionMode: "inline",
        requestedAction: "search",
        action: "searched",
        reason: null,
        warning: null,
        path: pathPrefix,
        items,
        query: request.query
      },
      discoveredFileHandles,
      isError: false
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
      policy.usageRule !== "allowed"
    ) {
      return null;
    }
    return policy;
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
      action === "attach" ||
      action === "search"
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
