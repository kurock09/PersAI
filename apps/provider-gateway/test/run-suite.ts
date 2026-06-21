import { runProviderAudioTranscriptionServiceTest } from "./provider-audio-transcription.service.test";
import { runProviderBrowserServiceTest } from "./provider-browser.service.test";
import { runProviderImageGenerationServiceTest } from "./provider-image-generation.service.test";
import { runProviderSpeechGenerationServiceTest } from "./provider-speech-generation.service.test";
import { runProviderVideoGenerationServiceTest } from "./provider-video-generation.service.test";
import { runAnthropicProviderClientTest } from "./anthropic-provider.client.test";
import { runAnthropicEmptyCompletionTest } from "./anthropic-empty-completion.test";
import { runOpenAIProviderClientTest } from "./openai-provider.client.test";
import { runOpenAIEmptyCompletionTest } from "./openai-empty-completion.test";
import { runDeepSeekProviderClientTest } from "./deepseek-provider.client.test";
import { runProviderDebugPayloadLoggerTest } from "./provider-debug-payload-logger.test";
import { runProviderGatewayConfigTest } from "./provider-gateway-config.test";
import { runProviderTextGenerationControllerTest } from "./provider-text-generation.controller.test";
import { runProviderTextGenerationServiceTest } from "./provider-text-generation.service.test";
import { runProviderWebFetchServiceTest } from "./provider-web-fetch.service.test";
import { runProviderWebSearchServiceTest } from "./provider-web-search.service.test";
import { runProviderWarmupServiceTest } from "./provider-warmup.service.test";
import {
  runProviderWarmupBootRecoveryTest,
  runProviderWarmupBootRecoveryLoopTest
} from "./provider-warmup-boot-recovery.test";
import { runHeyGenProviderClientTest } from "./heygen-provider.client.test";
import { runKlingProviderClientTest } from "./kling-provider.client.test";
import { runRunwayProviderClientTest } from "./runway-provider.client.test";
import { runYandexProviderClientTest } from "./yandex-provider.client.test";
import { runElevenLabsProviderClientTest } from "./elevenlabs-provider.client.test";
import { runElevenLabsV3TagCompilerTest } from "./elevenlabs-v3-tag-compiler.test";

async function run(): Promise<void> {
  await runProviderGatewayConfigTest();
  await runProviderDebugPayloadLoggerTest();
  await runElevenLabsV3TagCompilerTest();
  await runElevenLabsProviderClientTest();
  await runAnthropicProviderClientTest();
  await runAnthropicEmptyCompletionTest();
  await runOpenAIProviderClientTest();
  await runOpenAIEmptyCompletionTest();
  await runDeepSeekProviderClientTest();
  await runYandexProviderClientTest();
  await runProviderAudioTranscriptionServiceTest();
  await runProviderBrowserServiceTest();
  await runProviderImageGenerationServiceTest();
  await runRunwayProviderClientTest();
  await runKlingProviderClientTest();
  await runHeyGenProviderClientTest();
  await runProviderVideoGenerationServiceTest();
  await runProviderSpeechGenerationServiceTest();
  await runProviderWarmupServiceTest();
  await runProviderWarmupBootRecoveryTest();
  await runProviderWarmupBootRecoveryLoopTest();
  await runProviderTextGenerationControllerTest();
  await runProviderTextGenerationServiceTest();
  await runProviderWebSearchServiceTest();
  await runProviderWebFetchServiceTest();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
