import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ProviderWarmupService } from "../../provider-warmup.service";
import type { ProviderWarmupSnapshot } from "../../provider-client.types";

@Controller("api/v1/providers")
export class ProviderWarmupController {
  constructor(private readonly providerWarmupService: ProviderWarmupService) {}

  @Post("warmup")
  @HttpCode(HttpStatus.OK)
  async warmupProviders(@Body() body?: unknown): Promise<ProviderWarmupSnapshot> {
    return this.providerWarmupService.warmProviders(body);
  }
}
