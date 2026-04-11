import { Body, Controller, Post } from "@nestjs/common";
import type {
  InvalidateRuntimeBundleRequest,
  InvalidateRuntimeBundleResponse
} from "../../bundle.types";
import { RuntimeBundleCoordinatorService } from "../../runtime-bundle-coordinator.service";

@Controller("api/v1/bundles")
export class BundleInvalidateController {
  constructor(private readonly runtimeBundleCoordinatorService: RuntimeBundleCoordinatorService) {}

  @Post("invalidate")
  invalidateBundles(
    @Body() body: InvalidateRuntimeBundleRequest
  ): Promise<InvalidateRuntimeBundleResponse> {
    return this.runtimeBundleCoordinatorService.invalidateBundles(body);
  }
}
