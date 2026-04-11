import { Module } from "@nestjs/common";
import { ProviderGatewayConfigModule } from "./provider-gateway-config.module";
import { PlatformCoreModule } from "./modules/platform-core/platform-core.module";
import { ProviderGatewayModule } from "./modules/providers/provider-gateway.module";

@Module({
  imports: [ProviderGatewayConfigModule, PlatformCoreModule, ProviderGatewayModule]
})
export class AppModule {}
