import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import type { SandboxConfig } from "@persai/config";
import type { RuntimeSandboxJobRequest } from "@persai/runtime-contract";
import { SandboxMetricsService } from "./sandbox-metrics.service";
import { SandboxService } from "./sandbox.service";
import { Inject } from "@nestjs/common";
import { SANDBOX_CONFIG } from "./sandbox-config";

interface MetricsResponseHeaders {
  setHeader(name: string, value: string): void;
}

@Controller()
export class SandboxController {
  constructor(
    private readonly sandboxService: SandboxService,
    private readonly sandboxMetricsService: SandboxMetricsService,
    @Inject(SANDBOX_CONFIG) private readonly config: SandboxConfig
  ) {}

  @Get("/health")
  health() {
    return { ok: true };
  }

  @Get("/ready")
  async ready() {
    try {
      await this.sandboxService.ready();
      return { ok: true };
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : "Sandbox is not ready."
      );
    }
  }

  @Get("/metrics")
  getMetrics(@Res({ passthrough: true }) res: MetricsResponseHeaders): Promise<string> {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return this.sandboxMetricsService.renderMetrics();
  }

  @Post("/api/v1/jobs")
  async createJob(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: RuntimeSandboxJobRequest
  ) {
    this.assertAuthorized(authorization);
    return this.sandboxService.submitJob(body);
  }

  /**
   * ADR-128 Slice 4 — model-driven workspace write.
   * Lands artefacts directly at `/workspace/<basename>` with optional macOS-style
   * collision-suffix resolution.
   */
  @Post("/api/v1/jobs/workspace-write")
  async writeWorkspace(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    this.assertAuthorized(authorization);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new ServiceUnavailableException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    const assistantId = this.requireNonEmptyString(row.assistantId, "assistantId");
    const workspaceId = this.requireNonEmptyString(row.workspaceId, "workspaceId");
    const basename = this.requireNonEmptyString(row.basename, "basename");
    const contentBase64 = this.requireNonEmptyString(row.contentBase64, "contentBase64");
    const mimeType =
      typeof row.mimeType === "string" && row.mimeType.trim().length > 0
        ? row.mimeType.trim()
        : "application/octet-stream";
    const collisionStrategy =
      row.collisionStrategy === "overwrite" ? "overwrite" : "numeric_suffix";
    const assistantHandle =
      typeof row.handle === "string" && row.handle.trim().length > 0 ? row.handle.trim() : null;
    const siblingHandles = Array.isArray(row.siblingHandles)
      ? row.siblingHandles.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        )
      : null;
    const contents = Buffer.from(contentBase64, "base64");
    const workspaceQuotaBytes = this.parseOptionalNullableNumber(row.workspaceQuotaBytes);
    const sharedQuotaBytes = this.parseOptionalNullableNumber(row.sharedQuotaBytes);
    const result = await this.sandboxService.writeWorkspaceFile({
      assistantId,
      workspaceId,
      assistantHandle,
      siblingHandles,
      basename,
      contents,
      mimeType,
      collisionStrategy,
      workspaceQuotaBytes,
      sharedQuotaBytes
    });
    if (!result.ok) {
      throw new ServiceUnavailableException({
        reason: result.reason,
        message: result.message
      });
    }
    return {
      workspaceRelPath: result.workspaceRelPath,
      sizeBytes: result.sizeBytes
    };
  }

  /**
   * ADR-128 Slice 4 — control-plane workspace bytes-push.
   * The api calls this from `manage-chat-media.stageForWebThread` right after
   * the GCS upload so the running pod can see the bytes immediately (instead
   * of only after the next cold-start hydrate).
   */
  @Post("/api/v1/jobs/workspace-write-control-plane")
  async writeWorkspaceControlPlane(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    this.assertAuthorized(authorization);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new ServiceUnavailableException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    const assistantId = this.requireNonEmptyString(row.assistantId, "assistantId");
    const workspaceId = this.requireNonEmptyString(row.workspaceId, "workspaceId");
    const basename = this.requireNonEmptyString(row.basename, "basename");
    const contentBase64 = this.requireNonEmptyString(row.contentBase64, "contentBase64");
    const mimeType =
      typeof row.mimeType === "string" && row.mimeType.trim().length > 0
        ? row.mimeType.trim()
        : "application/octet-stream";
    const assistantHandle =
      typeof row.handle === "string" && row.handle.trim().length > 0 ? row.handle.trim() : null;
    const siblingHandles = Array.isArray(row.siblingHandles)
      ? row.siblingHandles.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        )
      : null;
    const contents = Buffer.from(contentBase64, "base64");
    const result = await this.sandboxService.writeWorkspaceFileControlPlane({
      assistantId,
      workspaceId,
      assistantHandle,
      siblingHandles,
      basename,
      contents,
      mimeType
    });
    if (!result.ok) {
      throw new ServiceUnavailableException({
        reason: result.reason,
        message: result.message
      });
    }
    return {
      mode: result.mode,
      workspaceRelPath: result.workspaceRelPath,
      sizeBytes: result.sizeBytes
    };
  }

  @Post("/api/v1/control/workspaces/:workspaceId/workspace/rm")
  async removeWorkspaceFileFromHotPods(
    @Headers("authorization") authorization: string | undefined,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown
  ) {
    this.assertAuthorized(authorization);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new ServiceUnavailableException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    const path = this.requireNonEmptyString(row.path, "path");
    const result = await this.sandboxService.removeWorkspaceFileFromHotPods({
      workspaceId,
      path
    });
    return {
      removedFromPods: result.removedFromPods,
      failures: result.failures
    };
  }

  @Get("/api/v1/jobs/:jobId")
  async getJob(
    @Headers("authorization") authorization: string | undefined,
    @Param("jobId") jobId: string,
    @Query("waitMs") waitMs: string | undefined
  ) {
    this.assertAuthorized(authorization);
    return this.sandboxService.pollJob(jobId, this.parseOptionalWaitMs(waitMs));
  }

  private assertAuthorized(authorization: string | undefined): void {
    const expected = this.config.PERSAI_INTERNAL_API_TOKEN?.trim();
    if (!expected) {
      throw new ServiceUnavailableException("Sandbox internal API token is not configured.");
    }
    const value = authorization?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (value !== expected) {
      throw new UnauthorizedException("Unauthorized sandbox request.");
    }
  }

  private parseOptionalWaitMs(value: string | undefined): number {
    if (value === undefined) {
      return 0;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }
    return parsed;
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ServiceUnavailableException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }

  private parseOptionalNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    return value;
  }
}
