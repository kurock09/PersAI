import { Inject, Injectable, Logger } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import { Storage } from "@google-cloud/storage";
import { RUNTIME_CONFIG } from "../../runtime-config";

@Injectable()
export class PersaiMediaObjectStorageService {
  private readonly logger = new Logger(PersaiMediaObjectStorageService.name);
  private readonly storage: Storage;

  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {
    this.storage =
      config.APP_ENV === "dev" ? new Storage({ projectId: config.GCP_PROJECT_ID }) : new Storage();
  }

  buildWorkspaceObjectKey(input: { workspaceId: string; workspaceRelPath: string }): string {
    const relative = input.workspaceRelPath
      .replace(/^\/workspace\//, "")
      .replace(/^\/+/, "")
      .replace(/\\/g, "/");
    return `${this.getObjectPrefix()}/workspaces/${input.workspaceId}/workspace/${relative}`;
  }

  async downloadByWorkspacePath(input: {
    workspaceId: string;
    storagePath: string;
  }): Promise<Buffer | null> {
    const objectKey = this.buildWorkspaceObjectKey({
      workspaceId: input.workspaceId,
      workspaceRelPath: input.storagePath
    });
    return this.downloadObject(objectKey);
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
    const prefix = this.config.PERSAI_MEDIA_OBJECT_PREFIX?.trim();
    if (!prefix) {
      throw new Error(
        "PersAI media object storage is not configured: PERSAI_MEDIA_OBJECT_PREFIX is required."
      );
    }
    return prefix.replace(/\/+$/g, "");
  }
}
