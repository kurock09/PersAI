import { Body, Controller, Post } from "@nestjs/common";
import type { WarmRuntimeBundleRequest, WarmRuntimeBundleResponse } from "../../bundle.types";
import { RuntimeBundleCoordinatorService } from "../../runtime-bundle-coordinator.service";

@Controller("api/v1/bundles")
export class BundleWarmController {
  constructor(private readonly runtimeBundleCoordinatorService: RuntimeBundleCoordinatorService) {}

  @Post("warm")
  warmBundle(@Body() body: WarmRuntimeBundleRequest): Promise<WarmRuntimeBundleResponse> {
    return this.runtimeBundleCoordinatorService.warmBundle(body);
  }
}
