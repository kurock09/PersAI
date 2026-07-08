import { Module } from "@nestjs/common";
import { ProviderAudioTranscriptionController } from "./interface/http/provider-audio-transcription.controller";
import { ProviderBrowserController } from "./interface/http/provider-browser.controller";
import { ProviderCatalogController } from "./interface/http/provider-catalog.controller";
import { ProviderDocumentGenerationController } from "./interface/http/provider-document-generation.controller";
import { ProviderImageGenerationController } from "./interface/http/provider-image-generation.controller";
import { ProviderSpeechGenerationController } from "./interface/http/provider-speech-generation.controller";
import { ProviderTextGenerationController } from "./interface/http/provider-text-generation.controller";
import { ProviderHeyGenAvatarsController } from "./interface/http/provider-heygen-avatars.controller";
import { ProviderHeyGenVoicesController } from "./interface/http/provider-heygen-voices.controller";
import { ProviderVideoGenerationController } from "./interface/http/provider-video-generation.controller";
import { ProviderWebFetchController } from "./interface/http/provider-web-fetch.controller";
import { ProviderWebSearchController } from "./interface/http/provider-web-search.controller";
import { ProviderWarmupController } from "./interface/http/provider-warmup.controller";
import { ElevenLabsProviderClient } from "./elevenlabs/elevenlabs-provider.client";
import { AnthropicProviderClient } from "./anthropic/anthropic-provider.client";
import { DeepSeekProviderClient } from "./deepseek/deepseek-provider.client";
import { HeyGenProviderClient } from "./heygen/heygen-provider.client";
import { KlingProviderClient } from "./kling/kling-provider.client";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { ProviderAudioTranscriptionService } from "./provider-audio-transcription.service";
import { HostBrowserScriptRegistryService } from "./host-browser-script-registry.service";
import { ProviderBrowserService } from "./provider-browser.service";
import { ProviderCatalogService } from "./provider-catalog.service";
import { ProviderDocumentGenerationService } from "./provider-document-generation.service";
import { ProviderImageGenerationService } from "./provider-image-generation.service";
import { ProviderSpeechGenerationService } from "./provider-speech-generation.service";
import { ProviderTextGenerationService } from "./provider-text-generation.service";
import { ProviderHeyGenAvatarsService } from "./provider-heygen-avatars.service";
import { ProviderHeyGenVoicesService } from "./provider-heygen-voices.service";
import { ProviderVideoGenerationService } from "./provider-video-generation.service";
import { ProviderWebFetchService } from "./provider-web-fetch.service";
import { ProviderWebSearchService } from "./provider-web-search.service";
import { ProviderStreamObservabilityService } from "./provider-stream-observability.service";
import { ProviderWarmupService } from "./provider-warmup.service";
import { YandexProviderClient } from "./yandex/yandex-provider.client";
import { GammaProviderClient } from "./gamma/gamma-provider.client";
import { RunwayProviderClient } from "./runway/runway-provider.client";

@Module({
  controllers: [
    ProviderAudioTranscriptionController,
    ProviderBrowserController,
    ProviderCatalogController,
    ProviderDocumentGenerationController,
    ProviderImageGenerationController,
    ProviderSpeechGenerationController,
    ProviderHeyGenAvatarsController,
    ProviderHeyGenVoicesController,
    ProviderVideoGenerationController,
    ProviderWarmupController,
    ProviderTextGenerationController,
    ProviderWebFetchController,
    ProviderWebSearchController
  ],
  providers: [
    ElevenLabsProviderClient,
    OpenAIProviderClient,
    AnthropicProviderClient,
    DeepSeekProviderClient,
    RunwayProviderClient,
    KlingProviderClient,
    HeyGenProviderClient,
    YandexProviderClient,
    GammaProviderClient,
    PersaiInternalApiClientService,
    HostBrowserScriptRegistryService,
    ProviderCatalogService,
    ProviderWarmupService,
    ProviderAudioTranscriptionService,
    ProviderBrowserService,
    ProviderDocumentGenerationService,
    ProviderImageGenerationService,
    ProviderSpeechGenerationService,
    ProviderHeyGenAvatarsService,
    ProviderHeyGenVoicesService,
    ProviderVideoGenerationService,
    ProviderTextGenerationService,
    ProviderStreamObservabilityService,
    ProviderWebFetchService,
    ProviderWebSearchService
  ],
  exports: [
    ProviderCatalogService,
    ProviderWarmupService,
    ProviderAudioTranscriptionService,
    ProviderDocumentGenerationService,
    ProviderImageGenerationService,
    ProviderVideoGenerationService,
    ProviderSpeechGenerationService,
    ProviderTextGenerationService,
    ProviderStreamObservabilityService,
    PersaiInternalApiClientService,
    ProviderBrowserService,
    ProviderWebFetchService,
    ProviderWebSearchService
  ]
})
export class ProviderGatewayModule {}
