import { runProviderGatewayConfigTest } from "./provider-gateway-config.test";
import { runProviderTextGenerationServiceTest } from "./provider-text-generation.service.test";
import { runProviderWarmupServiceTest } from "./provider-warmup.service.test";

async function run(): Promise<void> {
  await runProviderGatewayConfigTest();
  await runProviderWarmupServiceTest();
  await runProviderTextGenerationServiceTest();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
