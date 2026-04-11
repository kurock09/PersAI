import { Global, Module } from "@nestjs/common";
import { loadRuntimeConfig, type RuntimeConfig } from "@persai/config";
import { RUNTIME_CONFIG } from "./runtime-config";

@Global()
@Module({
  providers: [
    {
      provide: RUNTIME_CONFIG,
      useFactory: (): RuntimeConfig => loadRuntimeConfig(process.env)
    }
  ],
  exports: [RUNTIME_CONFIG]
})
export class RuntimeConfigModule {}
