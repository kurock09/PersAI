import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type {
  ProviderGatewayHeyGenCreatePhotoAvatarRequest,
  ProviderGatewayHeyGenCreatePhotoAvatarResult
} from "@persai/runtime-contract";
import { ProviderHeyGenAvatarsService } from "../../provider-heygen-avatars.service";

@Controller("api/v1/providers/heygen")
export class ProviderHeyGenAvatarsController {
  constructor(private readonly providerHeyGenAvatarsService: ProviderHeyGenAvatarsService) {}

  @Post("create-photo-avatar")
  @HttpCode(HttpStatus.OK)
  createPhotoAvatar(
    @Body() body: ProviderGatewayHeyGenCreatePhotoAvatarRequest
  ): Promise<ProviderGatewayHeyGenCreatePhotoAvatarResult> {
    return this.providerHeyGenAvatarsService.createPhotoAvatar(body);
  }
}
