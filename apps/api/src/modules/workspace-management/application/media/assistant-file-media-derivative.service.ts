import { Injectable, Logger } from "@nestjs/common";
import { AssistantFileRegistryService } from "../assistant-file-registry.service";
import { MediaPreprocessorService } from "./media-preprocessor.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";

@Injectable()
export class AssistantFileMediaDerivativeService {
  private readonly logger = new Logger(AssistantFileMediaDerivativeService.name);

  constructor(
    private readonly assistantFileRegistryService: AssistantFileRegistryService,
    private readonly mediaPreprocessorService: MediaPreprocessorService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  async processParentFile(input: {
    assistantId: string;
    workspaceId: string;
    fileRef: string;
  }): Promise<void> {
    const downloaded = await this.assistantFileRegistryService.downloadAssistantFile(input);
    const parent = downloaded.file;
    try {
      if (parent.mimeType.startsWith("image/")) {
        const thumbnail = await this.mediaPreprocessorService.createImageThumbnail(
          downloaded.buffer
        );
        if (thumbnail === null) {
          await this.assistantFileRegistryService.markMediaDerivativesStatus({
            ...input,
            status: "failed",
            lastError: "thumbnail_generation_failed"
          });
          return;
        }
        const objectKey = `${parent.objectKey}.thumbnail.webp`;
        const stored = await this.mediaObjectStorage.saveObject({
          objectKey,
          buffer: thumbnail.buffer,
          mimeType: thumbnail.mimeType
        });
        const descriptor = await this.assistantFileRegistryService.upsertMediaDerivativeFile({
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          parentFileRef: input.fileRef,
          parentOrigin: parent.origin,
          derivativeKind: "thumbnail",
          objectKey: stored.objectKey,
          filename: this.deriveDerivativeFilename(parent.displayName, "thumbnail", "webp"),
          mimeType: stored.mimeType,
          sizeBytes: BigInt(stored.sizeBytes),
          width: thumbnail.width,
          height: thumbnail.height
        });
        await this.assistantFileRegistryService.markMediaDerivativesStatus({
          ...input,
          status: "ready",
          thumbnail: descriptor,
          lastError: null
        });
        return;
      }

      if (parent.mimeType.startsWith("video/")) {
        const poster = await this.mediaPreprocessorService.createVideoPoster(downloaded.buffer);
        if (poster === null) {
          await this.assistantFileRegistryService.markMediaDerivativesStatus({
            ...input,
            status: "failed",
            lastError: "poster_generation_failed"
          });
          return;
        }
        const objectKey = `${parent.objectKey}.poster.jpg`;
        const stored = await this.mediaObjectStorage.saveObject({
          objectKey,
          buffer: poster.buffer,
          mimeType: poster.mimeType
        });
        const descriptor = await this.assistantFileRegistryService.upsertMediaDerivativeFile({
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          parentFileRef: input.fileRef,
          parentOrigin: parent.origin,
          derivativeKind: "poster",
          objectKey: stored.objectKey,
          filename: this.deriveDerivativeFilename(parent.displayName, "poster", "jpg"),
          mimeType: stored.mimeType,
          sizeBytes: BigInt(stored.sizeBytes),
          width: poster.width,
          height: poster.height
        });
        await this.assistantFileRegistryService.markMediaDerivativesStatus({
          ...input,
          status: "ready",
          poster: descriptor,
          lastError: null
        });
        return;
      }

      await this.assistantFileRegistryService.markMediaDerivativesStatus({
        ...input,
        status: "failed",
        lastError: "unsupported_media_type"
      });
    } catch (error) {
      this.logger.warn(
        `assistant_file_media_derivative_failed fileRef=${input.fileRef} message=${error instanceof Error ? error.message : String(error)}`
      );
      await this.assistantFileRegistryService.markMediaDerivativesStatus({
        ...input,
        status: "failed",
        lastError: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private deriveDerivativeFilename(
    filename: string | null,
    suffix: "thumbnail" | "poster",
    extension: string
  ): string {
    const base = (filename ?? "file").trim().replace(/[\\/:*?"<>|]+/g, "_");
    const withoutExt = base.replace(/\.[A-Za-z0-9]+$/g, "").trim() || "file";
    return `${withoutExt}.${suffix}.${extension}`;
  }
}
