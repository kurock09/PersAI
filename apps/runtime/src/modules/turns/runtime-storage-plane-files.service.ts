import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  buildAssistantSessionRoot,
  buildAssistantWorkspaceRoot,
  classifyVisibleWorkspacePath,
  isSessionHiddenModelSupportPath,
  isToolSpillPath,
  normalizeWorkspacePath
} from "@persai/runtime-contract";
import { buildGeneratedFileSemanticSummary } from "./generated-file-semantic-summary";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";
import { resolveMacOsCollisionBasename } from "./resolve-macos-collision-basename";

type FilesScope = "chat" | "assistant" | "workspace";

export type StoragePlaneReadOutcome =
  | {
      ok: true;
      content: string;
      sizeBytes: number;
      sha256: string;
      truncated: boolean;
    }
  | { ok: false; reason: string; warning: string | null };

export type StoragePlaneWriteOutcome =
  | { ok: true; resolvedPath: string; sizeBytes: number }
  | { ok: false; reason: string; warning: string | null };

export type StoragePlaneDeleteOutcome =
  | { ok: true }
  | { ok: false; reason: string; warning: string | null };

export type StoragePlaneAttachOutcome =
  | {
      ok: true;
      workspaceRelPath: string;
      mimeType: string;
      sizeBytes: number;
      displayName: string;
    }
  | { ok: false; reason: string; warning: string | null };

const ATTACHABLE_FILE_KINDS = new Set([
  "sessionDescendant",
  "assistantSharedDescendant",
  "workspaceSharedDescendant"
]);

@Injectable()
export class RuntimeStoragePlaneFilesService {
  private readonly logger = new Logger(RuntimeStoragePlaneFilesService.name);

  constructor(
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService
  ) {}

  isPersistedWorkspacePath(path: string): boolean {
    return path.startsWith("/workspace/");
  }

  isScratchPath(path: string): boolean {
    return path === "/tmp" || path.startsWith("/tmp/");
  }

  async deletePersistedWorkspaceFile(input: {
    workspaceId: string;
    path: string;
  }): Promise<StoragePlaneDeleteOutcome> {
    if (!this.isAttachableWorkspaceFilePath(input.path)) {
      const info = classifyVisibleWorkspacePath(normalizeWorkspacePath(input.path));
      if (info.kind === "rootFlatFile") {
        return {
          ok: false,
          reason: "path_not_found",
          warning: null
        };
      }
      return {
        ok: false,
        reason: "invalid_arguments",
        warning: 'files.delete requires an active hierarchical "/workspace/..." file path.'
      };
    }
    try {
      await this.persaiInternalApiClientService.deleteWorkspaceFileFromManifest({
        workspaceId: input.workspaceId,
        path: input.path
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: "files_failed",
        warning: error instanceof Error ? error.message : "Workspace file delete failed."
      };
    }
  }

  async attachPersistedWorkspaceFile(input: {
    workspaceId: string;
    path: string;
  }): Promise<StoragePlaneAttachOutcome> {
    const normalizedPath = normalizeWorkspacePath(input.path);
    const pathInfo = classifyVisibleWorkspacePath(normalizedPath);
    if (pathInfo.kind === "rootFlatFile") {
      return {
        ok: false,
        reason: "path_not_attachable",
        warning: "files.attach accepts only active hierarchical /workspace/... paths"
      };
    }
    if (!ATTACHABLE_FILE_KINDS.has(pathInfo.kind)) {
      return {
        ok: false,
        reason: "path_not_attachable",
        warning: "files.attach accepts only paths under /workspace/"
      };
    }
    const metadata = await this.persaiInternalApiClientService.getWorkspaceFileMetadata({
      workspaceId: input.workspaceId,
      path: normalizedPath
    });
    if (metadata === null) {
      return {
        ok: false,
        reason: "path_not_found",
        warning: null
      };
    }
    const buffer = await this.mediaObjectStorage.downloadByWorkspacePath({
      workspaceId: input.workspaceId,
      storagePath: normalizedPath
    });
    if (buffer === null || buffer.length === 0) {
      return {
        ok: false,
        reason: "path_not_found",
        warning: `Workspace file ${normalizedPath} has no committed bytes in storage.`
      };
    }
    const displayName = normalizedPath.split("/").pop() ?? normalizedPath;
    return {
      ok: true,
      workspaceRelPath: normalizedPath,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      displayName
    };
  }

  isAttachableWorkspaceFilePath(path: string): boolean {
    const info = classifyVisibleWorkspacePath(normalizeWorkspacePath(path));
    return ATTACHABLE_FILE_KINDS.has(info.kind);
  }

  async resolveWritePath(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    chatId: string | null;
    targetPath: string;
    replace: boolean;
  }): Promise<string> {
    const resolved = await this.resolveCollisionPath({
      bundle: input.bundle,
      sessionId: input.sessionId,
      chatId: input.chatId,
      targetPath: input.targetPath,
      replace: input.replace,
      createOnly: false
    });
    if (resolved instanceof Error) {
      throw resolved;
    }
    return resolved;
  }

  async readTextFile(input: {
    workspaceId: string;
    path: string;
    maxBytes: number;
  }): Promise<StoragePlaneReadOutcome> {
    const normalizedPath = normalizeWorkspacePath(input.path);
    // ADR-164 — tool-spill is storage-plane addressable without manifest pollution.
    // P2 will further bound files.read of spill via the same wire soft-max helper;
    // P1 already runs the wire projector on files.read results so a huge read
    // becomes a receipt (closing the OUT re-read loop).
    if (isToolSpillPath(normalizedPath)) {
      const buffer = await this.mediaObjectStorage.downloadByWorkspacePath({
        workspaceId: input.workspaceId,
        storagePath: normalizedPath
      });
      if (buffer === null || buffer.length === 0) {
        return {
          ok: false,
          reason: "file_not_found",
          warning: `Tool spill file ${normalizedPath} has no committed bytes in storage.`
        };
      }
      const truncated = buffer.length > input.maxBytes;
      const slice = truncated ? buffer.subarray(0, input.maxBytes) : buffer;
      return {
        ok: true,
        content: slice.toString("utf8"),
        sizeBytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        truncated
      };
    }

    const metadata = await this.persaiInternalApiClientService.getWorkspaceFileMetadata({
      workspaceId: input.workspaceId,
      path: input.path
    });
    if (metadata === null) {
      return {
        ok: false,
        reason: "file_not_found",
        warning: `Workspace file ${input.path} was not found in the manifest.`
      };
    }
    const buffer = await this.mediaObjectStorage.downloadByWorkspacePath({
      workspaceId: input.workspaceId,
      storagePath: input.path
    });
    if (buffer === null || buffer.length === 0) {
      return {
        ok: false,
        reason: "file_not_found",
        warning: `Workspace file ${input.path} has no committed bytes in storage.`
      };
    }
    const truncated = buffer.length > input.maxBytes;
    const slice = truncated ? buffer.subarray(0, input.maxBytes) : buffer;
    return {
      ok: true,
      content: slice.toString("utf8"),
      sizeBytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      truncated
    };
  }

  /**
   * ADR-164 — write a tool-spill body to the storage plane without manifest upsert.
   * Model `files.write` must not use this path; use {@link writeTextFile} for user files.
   */
  async writeToolSpillFile(input: {
    workspaceId: string;
    path: string;
    content: string;
  }): Promise<
    | { ok: true; path: string; sizeBytes: number; sha256: string }
    | { ok: false; reason: string; warning: string | null }
  > {
    const normalizedPath = normalizeWorkspacePath(input.path);
    if (!isToolSpillPath(normalizedPath)) {
      return {
        ok: false,
        reason: "invalid_arguments",
        warning: "writeToolSpillFile accepts only session /.tool-spill/ paths."
      };
    }
    const buffer = Buffer.from(input.content, "utf8");
    const mimeType = normalizedPath.endsWith(".json")
      ? "application/json"
      : "text/plain; charset=utf-8";
    const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
      workspaceId: input.workspaceId,
      workspaceRelPath: normalizedPath
    });
    try {
      await this.mediaObjectStorage.saveObject({
        objectKey,
        buffer,
        mimeType
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`tool_spill_write_failed path=${normalizedPath} reason=${detail}`);
      return {
        ok: false,
        reason: "files_failed",
        warning: `Tool spill write failed for ${normalizedPath}: ${detail}`
      };
    }
    return {
      ok: true,
      path: normalizedPath,
      sizeBytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex")
    };
  }

  async writeTextFile(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    chatId: string | null;
    targetPath: string;
    content: string;
    replace?: boolean;
    mode?: "create_only";
    requestedName: string | null;
    sourceUserMessageText?: string | null;
    sourceUserMessageCreatedAt?: string | null;
  }): Promise<StoragePlaneWriteOutcome> {
    const replace = input.replace === true;
    const createOnly = input.mode === "create_only";
    const quotaReason = await this.checkStorageQuotaBeforeWrite({
      bundle: input.bundle,
      targetPath: input.targetPath,
      replace,
      newBytes: Buffer.byteLength(input.content, "utf8")
    });
    if (quotaReason !== null) {
      return { ok: false, reason: quotaReason, warning: null };
    }

    const resolvedPath = await this.resolveCollisionPath({
      bundle: input.bundle,
      sessionId: input.sessionId,
      chatId: input.chatId,
      targetPath: input.targetPath,
      replace,
      createOnly
    });
    if (resolvedPath instanceof Error) {
      return {
        ok: false,
        reason:
          resolvedPath.message === "create_only_collision"
            ? "create_only_collision"
            : "invalid_arguments",
        warning: resolvedPath.message === "create_only_collision" ? null : resolvedPath.message
      };
    }
    if (isSessionHiddenModelSupportPath(resolvedPath)) {
      return {
        ok: false,
        reason: "invalid_arguments",
        warning:
          "Session hidden support paths (.local, .npm-global, node_modules, .tool-spill) cannot be written via files.write."
      };
    }

    const buffer = Buffer.from(input.content, "utf8");
    const mimeType = this.inferMimeForWrite(resolvedPath, input.content);
    const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
      workspaceId: input.bundle.metadata.workspaceId,
      workspaceRelPath: resolvedPath
    });
    await this.mediaObjectStorage.saveObject({
      objectKey,
      buffer,
      mimeType
    });

    const shortDescription = buildGeneratedFileSemanticSummary({
      requestText: input.sourceUserMessageText ?? null,
      requestedName: input.requestedName ?? resolvedPath.split("/").pop() ?? null,
      allowWeakRequestFallback: false
    });
    try {
      await this.persaiInternalApiClientService.upsertWorkspaceFileMetadata({
        workspaceId: input.bundle.metadata.workspaceId,
        path: resolvedPath,
        mimeType,
        sizeBytes: buffer.length,
        contentHash: createHash("sha256").update(input.content, "utf8").digest("hex"),
        replace,
        ...(shortDescription === null ? {} : { shortDescription }),
        ...(input.sourceUserMessageText === undefined || input.sourceUserMessageText === null
          ? {}
          : { sourceUserMessageText: input.sourceUserMessageText }),
        ...(input.sourceUserMessageCreatedAt === undefined ||
        input.sourceUserMessageCreatedAt === null
          ? {}
          : { sourceUserMessageCreatedAt: input.sourceUserMessageCreatedAt }),
        ...(input.chatId === null
          ? {}
          : {
              originChatId: input.chatId,
              originAssistantId: input.bundle.metadata.assistantId
            })
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`files_write_manifest_upsert_failed path=${resolvedPath} reason=${detail}`);
      return {
        ok: false,
        reason: "files_failed",
        warning: `Workspace file metadata registration failed for ${resolvedPath}: ${detail}`
      };
    }

    return { ok: true, resolvedPath, sizeBytes: buffer.length };
  }

  private async checkStorageQuotaBeforeWrite(input: {
    bundle: AssistantRuntimeBundle;
    targetPath: string;
    replace: boolean;
    newBytes: number;
  }): Promise<"workspace_quota_exhausted" | "shared_quota_exhausted" | null> {
    const workspaceQuotaBytes = input.bundle.governance.quota?.workspaceQuotaBytes ?? null;
    const sharedQuotaBytes = input.bundle.governance.quota?.sharedQuotaBytes ?? null;
    const candidateCaps = [workspaceQuotaBytes, sharedQuotaBytes].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value)
    );
    if (candidateCaps.length === 0) {
      return null;
    }
    const cap = candidateCaps.reduce(
      (acc, value) => Math.min(acc, value),
      Number.POSITIVE_INFINITY
    );
    const usedBytes = await this.persaiInternalApiClientService.sumWorkspaceFileStorageBytes({
      workspaceId: input.bundle.metadata.workspaceId
    });
    let priorBytes = 0;
    if (input.replace) {
      const prior = await this.persaiInternalApiClientService.getWorkspaceFileMetadata({
        workspaceId: input.bundle.metadata.workspaceId,
        path: input.targetPath
      });
      priorBytes = prior?.sizeBytes ?? 0;
    }
    const delta = Math.max(0, input.newBytes - priorBytes);
    if (usedBytes + delta > cap) {
      return sharedQuotaBytes !== null &&
        typeof workspaceQuotaBytes === "number" &&
        sharedQuotaBytes < workspaceQuotaBytes
        ? "shared_quota_exhausted"
        : "workspace_quota_exhausted";
    }
    return null;
  }

  private async resolveCollisionPath(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    chatId: string | null;
    targetPath: string;
    replace: boolean;
    createOnly: boolean;
  }): Promise<string | Error> {
    if (input.replace) {
      return input.targetPath;
    }
    const slashIdx = input.targetPath.lastIndexOf("/");
    const parentDir = slashIdx > 0 ? input.targetPath.slice(0, slashIdx) : "/workspace";
    const basename =
      slashIdx >= 0 && slashIdx < input.targetPath.length - 1
        ? input.targetPath.slice(slashIdx + 1)
        : input.targetPath;
    const existingNames = await this.listSiblingBasenames({
      bundle: input.bundle,
      sessionId: input.sessionId,
      chatId: input.chatId,
      parentDir
    });
    if (input.createOnly && existingNames.has(basename)) {
      return new Error("create_only_collision");
    }
    if (!existingNames.has(basename)) {
      return input.targetPath;
    }
    const resolvedBasename = resolveMacOsCollisionBasename(basename, existingNames);
    return `${parentDir}/${resolvedBasename}`;
  }

  private async listSiblingBasenames(input: {
    bundle: AssistantRuntimeBundle;
    sessionId: string;
    chatId: string | null;
    parentDir: string;
  }): Promise<Set<string>> {
    const assistantId = input.bundle.metadata.assistantId;
    const scope = this.resolveManifestListScope({
      path: input.parentDir,
      assistantId,
      sessionId: input.sessionId
    });
    const listed = await this.persaiInternalApiClientService.listWorkspaceFilesFromManifest({
      workspaceId: input.bundle.metadata.workspaceId,
      pathPrefix: input.parentDir,
      assistantId,
      scope,
      currentChatId: input.chatId,
      currentAssistantId: assistantId
    });
    const names = new Set<string>();
    for (const item of listed.items) {
      if (item.type !== "file") {
        continue;
      }
      const slash = item.path.lastIndexOf("/");
      names.add(slash >= 0 ? item.path.slice(slash + 1) : item.path);
    }
    return names;
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
    const trimmed = content.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return "application/json";
    }
    return "text/plain";
  }
}
