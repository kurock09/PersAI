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
}
