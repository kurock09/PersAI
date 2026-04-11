import { runOpenAIProviderClientTest } from "./openai-provider.client.test";
import { runProviderGatewayConfigTest } from "./provider-gateway-config.test";
import { runProviderTextGenerationServiceTest } from "./provider-text-generation.service.test";
import { runProviderWarmupServiceTest } from "./provider-warmup.service.test";

async function run(): Promise<void> {
  await runProviderGatewayConfigTest();
  await runOpenAIProviderClientTest();
  await runProviderWarmupServiceTest();
  await runProviderTextGenerationServiceTest();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
