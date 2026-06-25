import { Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";

type ResolvedSandboxConfig = ReturnType<typeof loadApiConfig>;

/**
 * ADR-126 v3 amendment (2026-06-25) — best-effort control-plane bridge from
 * the api into the sandbox process for operations that exist outside a
 * runtime turn (most notably: pushing freshly uploaded inbound bytes into
 * the workspace's running pod so the model sees them on its next turn).
 *
 * Design constraints:
 *   * The api MUST treat this client as best-effort. The canonical store for
 *     inbound bytes is GCS (already written by `manage-chat-media`). The
 *     sandbox cold-start hydrate path (`hydrateSharedMountFromGcs`) is the
 *     authoritative recovery mechanism. Failing or skipping the hot-pod push
 *     never blocks the upload or corrupts state.
 *   * The api MUST NOT throw on misconfiguration, network failure, or
 *     sandbox-side rejection. All such cases are logged at warn and the
 *     caller treats them as `deferred` (i.e. "the cold-start hydrate will
 *     pick this up at the next pod boot").
 *   * No quota accounting happens here. The api already booked the inbound
 *     bytes on the `media_storage_quota` ledger.
 */
@Injectable()
export class SandboxControlPlaneClientService {
  private readonly logger = new Logger(SandboxControlPlaneClientService.name);
  private readonly config: ResolvedSandboxConfig;

  constructor() {
    this.config = loadApiConfig(process.env);
  }

  /**
   * Returns `true` if both `PERSAI_SANDBOX_BASE_URL` and
   * `PERSAI_INTERNAL_API_TOKEN` are set. When not configured (e.g. local
   * dev without a sandbox process), callers should skip the push silently
   * and rely on the cold-start hydrate path.
   */
  isConfigured(): boolean {
    return Boolean(
      this.config.PERSAI_SANDBOX_BASE_URL?.trim() && this.config.PERSAI_INTERNAL_API_TOKEN?.trim()
    );
  }

  async pushSharedInboundBytes(input: {
    assistantId: string;
    workspaceId: string;
    basename: string;
    contents: Buffer;
    mimeType: string;
  }): Promise<{ mode: "written" | "deferred" | "error"; reason: string | null }> {
    const baseUrl = this.config.PERSAI_SANDBOX_BASE_URL?.trim();
    const token = this.config.PERSAI_INTERNAL_API_TOKEN?.trim();
    if (!baseUrl || !token) {
      return { mode: "deferred", reason: "not_configured" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.PERSAI_SANDBOX_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/api/v1/jobs/shared-inbound-write`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          basename: input.basename,
          contentBase64: input.contents.toString("base64"),
          mimeType: input.mimeType
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const body = await this.safeReadBodyText(response);
        this.logger.warn(
          `shared_inbound_push_http_error workspace=${input.workspaceId} assistant=${input.assistantId} basename=${input.basename} status=${String(response.status)} body=${body.slice(0, 256)}`
        );
        return { mode: "error", reason: `http_${response.status}` };
      }
      const body = (await this.safeParseJson(response)) as Record<string, unknown> | null;
      const mode = body?.mode === "written" ? "written" : "deferred";
      return { mode, reason: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `shared_inbound_push_failed workspace=${input.workspaceId} assistant=${input.assistantId} basename=${input.basename} error=${message}`
      );
      return { mode: "error", reason: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async safeReadBodyText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }

  private async safeParseJson(response: Response): Promise<unknown> {
    try {
      const text = await response.text();
      if (text.trim().length === 0) {
        return null;
      }
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}
