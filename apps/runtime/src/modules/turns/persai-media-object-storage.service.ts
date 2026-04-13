import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import { Storage } from "@google-cloud/storage";
import { RUNTIME_CONFIG } from "../../runtime-config";

export interface PersaiStoredMediaObject {
  objectKey: string;
  sizeBytes: number;
  mimeType: string;
}

@Injectable()
export class PersaiMediaObjectStorageService {
  private readonly logger = new Logger(PersaiMediaObjectStorageService.name);
  private readonly storage: Storage;

  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {
    this.storage =
      config.APP_ENV === "dev" ? new Storage({ projectId: config.GCP_PROJECT_ID }) : new Storage();
  }

  buildRuntimeOutputObjectKey(input: {
    assistantId: string;
    sessionId: string;
    requestId: string;
    artifactId?: string;
    extension: string | null;
  }): string {
    const ext = this.normalizeExtension(input.extension);
    const artifactId = input.artifactId ?? randomUUID();
    return `${this.getObjectPrefix()}/assistants/${input.assistantId}/runtime-output/sessions/${input.sessionId}/requests/${input.requestId}/${artifactId}.${ext}`;
  }

  async saveObject(input: {
    objectKey: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<PersaiStoredMediaObject> {
    const bucketName = this.config.PERSAI_MEDIA_BUCKET_NAME?.trim();
    if (!bucketName) {
      throw new Error(
        "PersAI media object storage is not configured: PERSAI_MEDIA_BUCKET_NAME is required."
      );
    }

    await this.storage
      .bucket(bucketName)
      .file(input.objectKey)
      .save(input.buffer, {
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

  async downloadObject(objectKey: string): Promise<Buffer | null> {
    if (typeof this.config.PERSAI_MEDIA_BUCKET_NAME !== "string") {
      return null;
    }

    try {
      const [buffer] = await this.storage
        .bucket(this.config.PERSAI_MEDIA_BUCKET_NAME)
        .file(objectKey)
        .download();
      return buffer;
    } catch (error) {
      this.logger.warn(`Failed to download staged media object "${objectKey}": ${String(error)}`);
      return null;
    }
  }

  private getObjectPrefix(): string {
    return (this.config.PERSAI_MEDIA_OBJECT_PREFIX ?? "assistant-media")
      .trim()
      .replace(/\/+$/g, "");
  }

  private normalizeExtension(extension: string | null): string {
    if (extension === null) {
      return "bin";
    }
    const trimmed = extension.trim().replace(/^\.+/, "").toLowerCase();
    return trimmed.length > 0 ? trimmed : "bin";
  }
}
