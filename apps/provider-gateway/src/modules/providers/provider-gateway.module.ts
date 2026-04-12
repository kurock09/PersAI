import { Module } from "@nestjs/common";
import { ProviderAudioTranscriptionController } from "./interface/http/provider-audio-transcription.controller";
import { ProviderCatalogController } from "./interface/http/provider-catalog.controller";
import { ProviderTextGenerationController } from "./interface/http/provider-text-generation.controller";
import { ProviderWarmupController } from "./interface/http/provider-warmup.controller";
import { AnthropicProviderClient } from "./anthropic/anthropic-provider.client";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import { ProviderAudioTranscriptionService } from "./provider-audio-transcription.service";
import { ProviderCatalogService } from "./provider-catalog.service";
import { ProviderTextGenerationService } from "./provider-text-generation.service";
import { ProviderWarmupService } from "./provider-warmup.service";

@Module({
  controllers: [
    ProviderAudioTranscriptionController,
    ProviderCatalogController,
    ProviderWarmupController,
    ProviderTextGenerationController
  ],
  providers: [
    OpenAIProviderClient,
    AnthropicProviderClient,
    ProviderCatalogService,
    ProviderWarmupService,
    ProviderAudioTranscriptionService,
    ProviderTextGenerationService
  ],
  exports: [
    ProviderCatalogService,
    ProviderWarmupService,
    ProviderAudioTranscriptionService,
    ProviderTextGenerationService
  ]
})
export class ProviderGatewayModule {}
