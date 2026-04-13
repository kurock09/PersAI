import { Module } from "@nestjs/common";
import { ProviderAudioTranscriptionController } from "./interface/http/provider-audio-transcription.controller";
import { ProviderBrowserController } from "./interface/http/provider-browser.controller";
import { ProviderCatalogController } from "./interface/http/provider-catalog.controller";
import { ProviderImageGenerationController } from "./interface/http/provider-image-generation.controller";
import { ProviderSpeechGenerationController } from "./interface/http/provider-speech-generation.controller";
import { ProviderTextGenerationController } from "./interface/http/provider-text-generation.controller";
import { ProviderWebFetchController } from "./interface/http/provider-web-fetch.controller";
import { ProviderWebSearchController } from "./interface/http/provider-web-search.controller";
import { ProviderWarmupController } from "./interface/http/provider-warmup.controller";
import { ElevenLabsProviderClient } from "./elevenlabs/elevenlabs-provider.client";
import { AnthropicProviderClient } from "./anthropic/anthropic-provider.client";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { ProviderAudioTranscriptionService } from "./provider-audio-transcription.service";
import { ProviderBrowserService } from "./provider-browser.service";
import { ProviderCatalogService } from "./provider-catalog.service";
import { ProviderImageGenerationService } from "./provider-image-generation.service";
import { ProviderSpeechGenerationService } from "./provider-speech-generation.service";
import { ProviderTextGenerationService } from "./provider-text-generation.service";
import { ProviderWebFetchService } from "./provider-web-fetch.service";
import { ProviderWebSearchService } from "./provider-web-search.service";
import { ProviderWarmupService } from "./provider-warmup.service";
import { YandexProviderClient } from "./yandex/yandex-provider.client";

@Module({
  controllers: [
    ProviderAudioTranscriptionController,
    ProviderBrowserController,
    ProviderCatalogController,
    ProviderImageGenerationController,
    ProviderSpeechGenerationController,
    ProviderWarmupController,
    ProviderTextGenerationController,
    ProviderWebFetchController,
    ProviderWebSearchController
  ],
  providers: [
    ElevenLabsProviderClient,
    OpenAIProviderClient,
    AnthropicProviderClient,
    YandexProviderClient,
    PersaiInternalApiClientService,
    ProviderCatalogService,
    ProviderWarmupService,
    ProviderAudioTranscriptionService,
    ProviderBrowserService,
    ProviderImageGenerationService,
    ProviderSpeechGenerationService,
    ProviderTextGenerationService,
    ProviderWebFetchService,
    ProviderWebSearchService
  ],
  exports: [
    ProviderCatalogService,
    ProviderWarmupService,
    ProviderAudioTranscriptionService,
    ProviderImageGenerationService,
    ProviderSpeechGenerationService,
    ProviderTextGenerationService,
    PersaiInternalApiClientService,
    ProviderBrowserService,
    ProviderWebFetchService,
    ProviderWebSearchService
  ]
})
export class ProviderGatewayModule {}
