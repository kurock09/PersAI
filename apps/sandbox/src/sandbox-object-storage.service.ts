import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import type { SandboxConfig } from "@persai/config";
import { Storage } from "@google-cloud/storage";
import { SANDBOX_CONFIG } from "./sandbox-config";

@Injectable()
export class SandboxObjectStorageService {
  private readonly storage: Storage;

  constructor(@Inject(SANDBOX_CONFIG) private readonly config: SandboxConfig) {
    this.storage =
      config.APP_ENV === "dev" ? new Storage({ projectId: config.GCP_PROJECT_ID }) : new Storage();
  }

  buildSandboxObjectKey(input: {
    assistantId: string;
    jobId: string;
    relativePath: string;
  }): string {
    const prefix = (this.config.PERSAI_MEDIA_OBJECT_PREFIX ?? "assistant-media")
      .trim()
      .replace(/\/+$/g, "");
    const normalized = input.relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const extension = extname(normalized).replace(/^\./, "").toLowerCase() || "bin";
    return `${prefix}/assistants/${input.assistantId}/sandbox/jobs/${input.jobId}/${randomUUID()}.${extension}`;
  }

  async saveObject(input: {
    objectKey: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<number> {
    const bucketName = this.config.PERSAI_MEDIA_BUCKET_NAME?.trim();
    if (!bucketName) {
      throw new Error("PERSAI_MEDIA_BUCKET_NAME is required for sandbox object persistence.");
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
    return input.buffer.length;
  }

  async downloadObject(objectKey: string): Promise<Buffer> {
    const bucketName = this.config.PERSAI_MEDIA_BUCKET_NAME?.trim();
    if (!bucketName) {
      throw new Error("PERSAI_MEDIA_BUCKET_NAME is required for sandbox object downloads.");
    }
    const [buffer] = await this.storage.bucket(bucketName).file(objectKey).download();
    return buffer;
  }
}
