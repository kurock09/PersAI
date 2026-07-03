import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { resolveVisibleWorkspaceOutputFormatFromPath } from "./document-workspace-deliverable-gating";
import { DocumentWorkspaceVersionRegistrationService } from "./document-workspace-version-registration.service";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";

export type UpsertWorkspaceFileMetadataFromRuntimeInput = {
  workspaceId: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string | null;
  replace: boolean;
  shortDescription: string | null;
  originChatId: string | null;
  originAssistantId: string | null;
  sourceUserMessageText: string | null;
  sourceUserMessageCreatedAt: string | null;
};

// ADR-128 Slice 4 — runtime-driven manifest writes after a successful sandbox
// `files.write` on any `/workspace/...` path. The flat workspace has no role
// carve-out, so every successful write feeds the manifest. The api owns the
// upsert so the sandbox does not need DB access.
@Injectable()
export class UpsertWorkspaceFileMetadataFromRuntimeService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    private readonly documentWorkspaceVersionRegistrationService: DocumentWorkspaceVersionRegistrationService
  ) {}

  parseInput(body: unknown): UpsertWorkspaceFileMetadataFromRuntimeInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    const path = this.requiredString(row.path, "path");
    if (!this.isPersistedWorkspacePath(path)) {
      throw new BadRequestException(
        'path must start with "/workspace/" — only files inside the workspace mount are tracked in the manifest.'
      );
    }
    if (path.includes("..")) {
      throw new BadRequestException('path must not contain "..".');
    }
    const mimeType = this.requiredString(row.mimeType, "mimeType");
    const sizeBytes = row.sizeBytes;
    if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
      throw new BadRequestException('Field "sizeBytes" must be a non-negative number.');
    }
    const shortDescriptionRaw = row.shortDescription;
    const shortDescription =
      typeof shortDescriptionRaw === "string" && shortDescriptionRaw.length > 0
        ? shortDescriptionRaw
        : null;
    const originChatId = this.optionalUuid(row.originChatId, "originChatId");
    const originAssistantId = this.optionalUuid(row.originAssistantId, "originAssistantId");
    const contentHash = this.optionalContentHash(row.contentHash);
    const sourceUserMessageText = this.optionalString(row.sourceUserMessageText);
    const sourceUserMessageCreatedAt = this.optionalString(row.sourceUserMessageCreatedAt);
    return {
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      path,
      mimeType,
      sizeBytes: Math.floor(sizeBytes),
      contentHash,
      replace: row.replace === true,
      shortDescription,
      originChatId,
      originAssistantId,
      sourceUserMessageText,
      sourceUserMessageCreatedAt
    };
  }

  async execute(input: UpsertWorkspaceFileMetadataFromRuntimeInput): Promise<void> {
    await this.workspaceFileMetadataService.upsert({
      workspaceId: input.workspaceId,
      path: input.path,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      ...(input.contentHash === null ? {} : { contentHash: input.contentHash }),
      ...(input.shortDescription !== null ? { shortDescription: input.shortDescription } : {}),
      ...(input.originChatId !== null ? { originChatId: input.originChatId } : {}),
      ...(input.originAssistantId !== null ? { originAssistantId: input.originAssistantId } : {})
    });
    if (input.replace) {
      await this.attachmentRepository.refreshWorkspacePathProjection({
        workspaceId: input.workspaceId,
        storagePath: input.path,
        mimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes)
      });
    }
    await this.maybeRegisterVisibleWorkspaceDocumentVersion(input);
  }

  private optionalContentHash(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException("contentHash must be a non-empty string when provided.");
    }
    return value.trim();
  }

  private optionalString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private optionalUuid(value: unknown, field: string): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a UUID string when provided.`);
    }
    return value.trim();
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }

  private isPersistedWorkspacePath(path: string): boolean {
    return path.startsWith("/workspace/");
  }

  private async maybeRegisterVisibleWorkspaceDocumentVersion(
    input: UpsertWorkspaceFileMetadataFromRuntimeInput
  ): Promise<void> {
    const outputFormat = resolveVisibleWorkspaceOutputFormatFromPath(input.path);
    if (outputFormat !== "pdf" && outputFormat !== "xlsx" && outputFormat !== "docx") {
      return;
    }
    if (input.originAssistantId === null || input.originChatId === null) {
      return;
    }
    if (input.sourceUserMessageText === null) {
      return;
    }
    const chat = await this.prisma.assistantChat.findFirst({
      where: {
        id: input.originChatId,
        assistantId: input.originAssistantId,
        workspaceId: input.workspaceId
      },
      select: {
        surface: true,
        surfaceThreadKey: true
      }
    });
    if (chat === null || (chat.surface !== "web" && chat.surface !== "telegram")) {
      return;
    }
    const registration = await this.documentWorkspaceVersionRegistrationService.execute({
      assistantId: input.originAssistantId,
      workspaceId: input.workspaceId,
      channel: chat.surface,
      externalThreadKey: chat.surfaceThreadKey,
      sourceUserMessageText: input.sourceUserMessageText,
      sourceUserMessageCreatedAt: input.sourceUserMessageCreatedAt ?? new Date().toISOString(),
      descriptorMode: null,
      docId: null,
      requestedName: null,
      workspaceProjectPath: null,
      outputPath: input.path,
      sourceManifestPath: null,
      inspectionPath: null
    });
    if (!registration.accepted) {
      throw new BadRequestException(
        `Workspace document registration failed for ${input.path} (${registration.code}): ${registration.message}`
      );
    }
  }
}
