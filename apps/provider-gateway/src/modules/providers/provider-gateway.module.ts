import { Module } from "@nestjs/common";
import { ProviderAudioTranscriptionController } from "./interface/http/provider-audio-transcription.controller";
import { ProviderBrowserController } from "./interface/http/provider-browser.controller";
import { ProviderCatalogController } from "./interface/http/provider-catalog.controller";
import { ProviderTextGenerationController } from "./interface/http/provider-text-generation.controller";
import { ProviderWebFetchController } from "./interface/http/provider-web-fetch.controller";
import { ProviderWebSearchController } from "./interface/http/provider-web-search.controller";
import { ProviderWarmupController } from "./interface/http/provider-warmup.controller";
import { AnthropicProviderClient } from "./anthropic/anthropic-provider.client";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { ProviderAudioTranscriptionService } from "./provider-audio-transcription.service";
import { ProviderBrowserService } from "./provider-browser.service";
import { ProviderCatalogService } from "./provider-catalog.service";
import { ProviderTextGenerationService } from "./provider-text-generation.service";
import { ProviderWebFetchService } from "./provider-web-fetch.service";
import { ProviderWebSearchService } from "./provider-web-search.service";
import { ProviderWarmupService } from "./provider-warmup.service";

@Module({
  controllers: [
    ProviderAudioTranscriptionController,
    ProviderBrowserController,
    ProviderCatalogController,
    ProviderWarmupController,
    ProviderTextGenerationController,
    ProviderWebFetchController,
    ProviderWebSearchController
  ],
  providers: [
    OpenAIProviderClient,
    AnthropicProviderClient,
    PersaiInternalApiClientService,
    ProviderCatalogService,
    ProviderWarmupService,
    ProviderAudioTranscriptionService,
    ProviderBrowserService,
    ProviderTextGenerationService,
    ProviderWebFetchService,
    ProviderWebSearchService
  ],
  exports: [
    ProviderCatalogService,
    ProviderWarmupService,
    ProviderAudioTranscriptionService,
    ProviderTextGenerationService,
    PersaiInternalApiClientService,
    ProviderBrowserService,
    ProviderWebFetchService,
    ProviderWebSearchService
  ]
})
export class ProviderGatewayModule {}
