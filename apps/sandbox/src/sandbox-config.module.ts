import { Global, Module } from "@nestjs/common";
import { loadSandboxConfig } from "@persai/config";
import { SANDBOX_CONFIG } from "./sandbox-config";

@Global()
@Module({
  providers: [
    {
      provide: SANDBOX_CONFIG,
      useFactory: () => loadSandboxConfig(process.env)
    }
  ],
  exports: [SANDBOX_CONFIG]
})
export class SandboxConfigModule {}
