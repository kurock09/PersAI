import { runProviderAudioTranscriptionServiceTest } from "./provider-audio-transcription.service.test";
import { runProviderBrowserServiceTest } from "./provider-browser.service.test";
import { runProviderImageGenerationServiceTest } from "./provider-image-generation.service.test";
import { runProviderSpeechGenerationServiceTest } from "./provider-speech-generation.service.test";
import { runProviderVideoGenerationServiceTest } from "./provider-video-generation.service.test";
import { runAnthropicProviderClientTest } from "./anthropic-provider.client.test";
import { runAnthropicEmptyCompletionTest } from "./anthropic-empty-completion.test";
import { runOpenAIProviderClientTest } from "./openai-provider.client.test";
import { runOpenAIEmptyCompletionTest } from "./openai-empty-completion.test";
import { runProviderGatewayConfigTest } from "./provider-gateway-config.test";
import { runProviderTextGenerationControllerTest } from "./provider-text-generation.controller.test";
import { runProviderTextGenerationServiceTest } from "./provider-text-generation.service.test";
import { runProviderWebFetchServiceTest } from "./provider-web-fetch.service.test";
import { runProviderWebSearchServiceTest } from "./provider-web-search.service.test";
import { runProviderWarmupServiceTest } from "./provider-warmup.service.test";
import { runPdfMonkeyProviderClientTest } from "./pdfmonkey-provider.client.test";
import { runYandexProviderClientTest } from "./yandex-provider.client.test";

async function run(): Promise<void> {
  await runProviderGatewayConfigTest();
  await runAnthropicProviderClientTest();
  await runAnthropicEmptyCompletionTest();
  await runOpenAIProviderClientTest();
  await runOpenAIEmptyCompletionTest();
  await runYandexProviderClientTest();
  await runPdfMonkeyProviderClientTest();
  await runProviderAudioTranscriptionServiceTest();
  await runProviderBrowserServiceTest();
  await runProviderImageGenerationServiceTest();
  await runProviderVideoGenerationServiceTest();
  await runProviderSpeechGenerationServiceTest();
  await runProviderWarmupServiceTest();
  await runProviderTextGenerationControllerTest();
  await runProviderTextGenerationServiceTest();
  await runProviderWebSearchServiceTest();
  await runProviderWebFetchServiceTest();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
