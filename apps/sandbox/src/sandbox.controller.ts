import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import type { SandboxConfig } from "@persai/config";
import type { RuntimeSandboxJobRequest } from "@persai/runtime-contract";
import { SandboxService } from "./sandbox.service";
import { Inject } from "@nestjs/common";
import { SANDBOX_CONFIG } from "./sandbox-config";

@Controller()
export class SandboxController {
  constructor(
    private readonly sandboxService: SandboxService,
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
    @Param("jobId") jobId: string
  ) {
    this.assertAuthorized(authorization);
    return this.sandboxService.pollJob(jobId);
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
}
