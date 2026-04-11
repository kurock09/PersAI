import { Global, Module } from "@nestjs/common";
import { loadProviderGatewayConfig, type ProviderGatewayConfig } from "@persai/config";
import { PROVIDER_GATEWAY_CONFIG } from "./provider-gateway-config";

@Global()
@Module({
  providers: [
    {
      provide: PROVIDER_GATEWAY_CONFIG,
      useFactory: (): ProviderGatewayConfig => loadProviderGatewayConfig(process.env)
    }
  ],
  exports: [PROVIDER_GATEWAY_CONFIG]
})
export class ProviderGatewayConfigModule {}
