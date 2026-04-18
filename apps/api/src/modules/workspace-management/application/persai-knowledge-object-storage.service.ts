import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { Storage } from "@google-cloud/storage";
import { loadApiConfig } from "@persai/config";

export interface PersaiStoredKnowledgeObject {
  objectKey: string;
  sizeBytes: number;
  mimeType: string;
}

export interface PersaiDownloadedKnowledgeObject {
  buffer: Buffer;
  contentType: string;
}

@Injectable()
export class PersaiKnowledgeObjectStorageService {
  private readonly logger = new Logger(PersaiKnowledgeObjectStorageService.name);
  private storageClient: Storage | null = null;

  buildKnowledgeSourceObjectKey(input: {
    assistantId: string;
    extension: string | null;
    originalFilename: string | null;
  }): string {
    const ext = this.normalizeExtension(input.extension);
    const safeFilename = this.normalizeFilename(input.originalFilename, ext);
    return `${this.getObjectPrefix()}/assistants/${input.assistantId}/sources/${randomUUID()}/${safeFilename}`;
  }

  buildGlobalKnowledgeSourceObjectKey(input: {
    scope: "product" | "skill";
    extension: string | null;
    originalFilename: string | null;
  }): string {
    const ext = this.normalizeExtension(input.extension);
    const safeFilename = this.normalizeFilename(input.originalFilename, ext);
    return `${this.getObjectPrefix()}/global/${input.scope}/${randomUUID()}/${safeFilename}`;
  }

  buildAssistantPrefix(assistantId: string): string {
    return `${this.getObjectPrefix()}/assistants/${assistantId}/`;
  }

  async saveObject(input: {
    objectKey: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<PersaiStoredKnowledgeObject> {
    const file = this.getBucket().file(input.objectKey);
    await file.save(input.buffer, {
      resumable: false,
      contentType: input.mimeType,
      metadata: {
        contentType: input.mimeType
      }
    });

    return {
      objectKey: input.objectKey,
      sizeBytes: input.buffer.length,
      mimeType: input.mimeType
    };
  }

  async downloadObject(objectKey: string): Promise<PersaiDownloadedKnowledgeObject | null> {
    const file = this.getBucket().file(objectKey);
    const [exists] = await file.exists();
    if (!exists) {
      return null;
    }

    const [buffer] = await file.download();
    const [metadata] = await file.getMetadata();
    return {
      buffer,
      contentType: metadata.contentType ?? "application/octet-stream"
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    try {
      await this.getBucket().file(objectKey).delete({ ignoreNotFound: true });
    } catch (error) {
      this.logger.warn(`Failed to delete knowledge object "${objectKey}": ${String(error)}`);
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    try {
      const [files] = await this.getBucket().getFiles({ prefix });
      await Promise.all(
        files.map(async (file) => {
          try {
            await file.delete({ ignoreNotFound: true });
          } catch (error) {
            this.logger.warn(`Failed to delete knowledge object "${file.name}": ${String(error)}`);
          }
        })
      );
    } catch (error) {
      this.logger.warn(`Failed to list knowledge objects for prefix "${prefix}": ${String(error)}`);
    }
  }

  private getBucket() {
    const config = loadApiConfig(process.env);
    const bucketName = config.PERSAI_MEDIA_BUCKET_NAME?.trim();
    if (!bucketName) {
      throw new Error(
        "PersAI knowledge object storage is not configured: PERSAI_MEDIA_BUCKET_NAME is required."
      );
    }

    return this.getStorageClient(
      config.APP_ENV === "dev" ? config.GCP_PROJECT_ID : undefined
    ).bucket(bucketName);
  }

  private getStorageClient(projectId: string | undefined): Storage {
    if (this.storageClient === null) {
      this.storageClient = projectId ? new Storage({ projectId }) : new Storage();
    }
    return this.storageClient;
  }

  private getObjectPrefix(): string {
    const config = loadApiConfig(process.env);
    return config.PERSAI_KNOWLEDGE_OBJECT_PREFIX.trim().replace(/\/+$/g, "");
  }

  private normalizeExtension(extension: string | null): string {
    if (extension === null) {
      return "bin";
    }

    const trimmed = extension.trim().replace(/^\.+/, "").toLowerCase();
    return trimmed.length > 0 ? trimmed : "bin";
  }

  private normalizeFilename(filename: string | null, ext: string): string {
    const base =
      typeof filename === "string" && filename.trim().length > 0
        ? filename.trim().replace(/[^\w.\- ]+/g, "_")
        : `source.${ext}`;
    return /\.[a-z0-9]+$/i.test(base) ? base : `${base}.${ext}`;
  }
}
