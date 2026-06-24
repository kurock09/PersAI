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

  /**
   * GCS key for the whole-workspace tar snapshot for a session.
   * Keyed by assistant + session so that a recreated session pod can restore all files
   * (including ephemeral bash-produced files not mirrored to shared GCS).
   * GCS creds stay control-plane-only; exec pods never see this key.
   */
  buildSessionSnapshotKey(input: { assistantId: string; runtimeSessionId: string }): string {
    const prefix = (this.config.PERSAI_MEDIA_OBJECT_PREFIX ?? "assistant-media")
      .trim()
      .replace(/\/+$/g, "");
    return `${prefix}/assistants/${input.assistantId}/sandbox-sessions/${input.runtimeSessionId}/workspace.tar`;
  }

  /**
   * ADR-126 Slice 3 — GCS object key for a `/shared/<workspaceId>/...` pod
   * path. `workspaceRelPath` is the path the model sees inside the pod, e.g.
   * `/shared/input/<name>` or `/shared/outbound/<handle>/<name>`. The
   * workspace-id and the leading `/shared` are stripped (the workspace-id is
   * implicit from the object prefix) so renaming an assistant handle never
   * affects the input/ prefix.
   */
  buildSharedObjectKey(input: {
    workspaceId: string;
    /** `/shared/input/<name>` or `/shared/outbound/<handle>/<name>` form. */
    workspaceRelPath: string;
  }): string {
    const prefix = (this.config.PERSAI_MEDIA_OBJECT_PREFIX ?? "assistant-media")
      .trim()
      .replace(/\/+$/g, "");
    const relative = input.workspaceRelPath
      .replace(/^\/shared\//, "")
      .replace(/^\/+/, "")
      .replace(/\\+/g, "/");
    return `${prefix}/workspaces/${input.workspaceId}/shared/${relative}`;
  }

  /** Prefix used by the GC reaper when bulk-deleting shared workspace state. */
  buildSharedPrefix(input: { workspaceId: string; subPath?: string }): string {
    const prefix = (this.config.PERSAI_MEDIA_OBJECT_PREFIX ?? "assistant-media")
      .trim()
      .replace(/\/+$/g, "");
    const tail = input.subPath === undefined ? "" : `${input.subPath.replace(/^\/+|\/+$/g, "")}/`;
    return `${prefix}/workspaces/${input.workspaceId}/shared/${tail}`;
  }

  /**
   * ADR-126 Slice 3 C2 — list all GCS object keys under `prefix`. Used by the
   * shared-mount bootstrap hydrate to enumerate workspace-shared blobs to pull
   * into a cold pod. Returns an empty array if the bucket is not configured or
   * the list call fails — callers treat this as "nothing to hydrate".
   */
  async listPrefix(prefix: string): Promise<string[]> {
    const bucketName = this.config.PERSAI_MEDIA_BUCKET_NAME?.trim();
    if (!bucketName) {
      return [];
    }
    const [files] = await this.storage.bucket(bucketName).getFiles({ prefix });
    return files.map((file) => file.name);
  }

  /**
   * Delete every GCS object whose key starts with `prefix`. Returns the number
   * of objects removed.
   */
  async deletePrefix(prefix: string): Promise<number> {
    const bucketName = this.config.PERSAI_MEDIA_BUCKET_NAME?.trim();
    if (!bucketName) {
      throw new Error("PERSAI_MEDIA_BUCKET_NAME is required for sandbox prefix deletion.");
    }
    let removed = 0;
    // Iterate in pages so workspaces with many shared objects don't OOM the
    // control-plane pod.
    const bucket = this.storage.bucket(bucketName);
    let pageToken: string | undefined;
    do {
      const [files, nextQuery] = await bucket.getFiles({
        prefix,
        autoPaginate: false,
        pageToken
      } as { prefix: string; autoPaginate: boolean; pageToken?: string });
      await Promise.all(
        files.map(async (file) => {
          await file.delete({ ignoreNotFound: true } as { ignoreNotFound: boolean });
          removed += 1;
        })
      );
      pageToken = (nextQuery as { pageToken?: string } | undefined)?.pageToken;
    } while (pageToken !== undefined);
    return removed;
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
