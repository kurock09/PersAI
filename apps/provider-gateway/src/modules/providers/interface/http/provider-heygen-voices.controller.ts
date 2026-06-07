import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type {
  ProviderGatewayHeyGenCreateVoiceCloneRequest,
  ProviderGatewayHeyGenCreateVoiceCloneResult
} from "@persai/runtime-contract";
import { ProviderHeyGenVoicesService } from "../../provider-heygen-voices.service";

@Controller("api/v1/providers/heygen")
export class ProviderHeyGenVoicesController {
  constructor(private readonly providerHeyGenVoicesService: ProviderHeyGenVoicesService) {}

  @Post("create-voice-clone")
  @HttpCode(HttpStatus.OK)
  createVoiceClone(
    @Body() body: ProviderGatewayHeyGenCreateVoiceCloneRequest
  ): Promise<ProviderGatewayHeyGenCreateVoiceCloneResult> {
    return this.providerHeyGenVoicesService.createVoiceClone(body);
  }
}
