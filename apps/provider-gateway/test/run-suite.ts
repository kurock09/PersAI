import { runProviderAudioTranscriptionServiceTest } from "./provider-audio-transcription.service.test";
import { runProviderBrowserServiceTest } from "./provider-browser.service.test";
import { runProviderImageGenerationServiceTest } from "./provider-image-generation.service.test";
import { runProviderSpeechGenerationServiceTest } from "./provider-speech-generation.service.test";
import { runAnthropicProviderClientTest } from "./anthropic-provider.client.test";
import { runOpenAIProviderClientTest } from "./openai-provider.client.test";
import { runProviderGatewayConfigTest } from "./provider-gateway-config.test";
import { runProviderTextGenerationServiceTest } from "./provider-text-generation.service.test";
import { runProviderWebFetchServiceTest } from "./provider-web-fetch.service.test";
import { runProviderWebSearchServiceTest } from "./provider-web-search.service.test";
import { runProviderWarmupServiceTest } from "./provider-warmup.service.test";

async function run(): Promise<void> {
  await runProviderGatewayConfigTest();
  await runAnthropicProviderClientTest();
  await runOpenAIProviderClientTest();
  await runProviderAudioTranscriptionServiceTest();
  await runProviderBrowserServiceTest();
  await runProviderImageGenerationServiceTest();
  await runProviderSpeechGenerationServiceTest();
  await runProviderWarmupServiceTest();
  await runProviderTextGenerationServiceTest();
  await runProviderWebSearchServiceTest();
  await runProviderWebFetchServiceTest();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
