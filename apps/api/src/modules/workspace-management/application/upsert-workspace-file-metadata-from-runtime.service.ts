import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  resolveVisibleWorkspaceOutputFormatFromPath,
  buildDefaultInspectionPath
} from "./document-workspace-deliverable-gating";
import { DocumentWorkspaceVersionRegistrationService } from "./document-workspace-version-registration.service";
import { WorkspaceFileMicroDescriptionJobService } from "./workspace-file-micro-description-job.service";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";
import { normalizeActiveWorkspaceFilePath } from "./workspace-visible-paths";

export type WorkspaceFileMetadataDocumentRegistrationOutcome = {
  registered: boolean;
  versionNumber: number | null;
  bumped: boolean;
  isOverwrite: boolean;
};

export type UpsertWorkspaceFileMetadataFromRuntimeResult = {
  documentRegistration: WorkspaceFileMetadataDocumentRegistrationOutcome | null;
};

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
    private readonly documentWorkspaceVersionRegistrationService: DocumentWorkspaceVersionRegistrationService,
    private readonly workspaceFileMicroDescriptionJobService: WorkspaceFileMicroDescriptionJobService
  ) {}

  parseInput(body: unknown): UpsertWorkspaceFileMetadataFromRuntimeInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    const rawPath = this.requiredString(row.path, "path");
    const path = normalizeActiveWorkspaceFilePath(rawPath);
    if (path === null) {
      throw new BadRequestException(
        'path must be an active hierarchical "/workspace/..." file path tracked by the manifest.'
      );
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

  async execute(
    input: UpsertWorkspaceFileMetadataFromRuntimeInput
  ): Promise<UpsertWorkspaceFileMetadataFromRuntimeResult> {
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
    const documentRegistration = await this.maybeRegisterVisibleWorkspaceDocumentVersion(input);
    if (input.shortDescription === null && input.originAssistantId !== null) {
      void this.workspaceFileMicroDescriptionJobService
        .enqueueIfNeeded({
          workspaceId: input.workspaceId,
          path: input.path,
          assistantId: input.originAssistantId,
          sourceKind: "generated",
          sourceChatId: input.originChatId,
          chatMode: await this.resolveChatMode(input.originChatId)
        })
        .catch(() => undefined);
    }
    return { documentRegistration };
  }

  private async resolveChatMode(chatId: string | null): Promise<string | null> {
    if (chatId === null) {
      return null;
    }
    const chat = await this.prisma.assistantChat.findUnique({
      where: { id: chatId },
      select: { chatMode: true }
    });
    return chat?.chatMode ?? null;
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
  private async maybeRegisterVisibleWorkspaceDocumentVersion(
    input: UpsertWorkspaceFileMetadataFromRuntimeInput
  ): Promise<WorkspaceFileMetadataDocumentRegistrationOutcome | null> {
    const outputFormat = resolveVisibleWorkspaceOutputFormatFromPath(input.path);
    if (outputFormat !== "pdf" && outputFormat !== "xlsx" && outputFormat !== "docx") {
      return null;
    }
    if (input.originAssistantId === null || input.originChatId === null) {
      return null;
    }
    if (input.sourceUserMessageText === null) {
      return {
        registered: false,
        versionNumber: null,
        bumped: false,
        isOverwrite: false
      };
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
      return null;
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
      inspectionPath: buildDefaultInspectionPath(input.path)
    });
    if (!registration.accepted) {
      return {
        registered: false,
        versionNumber: null,
        bumped: false,
        isOverwrite: false
      };
    }
    const isOverwrite = registration.descriptorMode === "revise_document";
    return {
      registered: true,
      versionNumber: registration.versionNumber,
      bumped: isOverwrite,
      isOverwrite
    };
  }
}
