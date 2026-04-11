import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextStreamEvent
} from "@persai/runtime-contract";
import { AnthropicProviderClient } from "./anthropic/anthropic-provider.client";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import { ProviderWarmupService } from "./provider-warmup.service";

@Injectable()
export class ProviderTextGenerationService {
  constructor(
    private readonly providerWarmupService: ProviderWarmupService,
    private readonly openaiProviderClient: OpenAIProviderClient,
    private readonly anthropicProviderClient: AnthropicProviderClient
  ) {}

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    this.assertValidRequest(input);
    this.assertProviderReady(input);

    switch (input.provider) {
      case "openai":
        return this.openaiProviderClient.generateText(input);
      case "anthropic":
        return this.anthropicProviderClient.generateText(input);
    }
  }

  async streamText(
    input: ProviderGatewayTextGenerateRequest,
    signal?: AbortSignal
  ): Promise<AsyncGenerator<ProviderGatewayTextStreamEvent>> {
    this.assertValidRequest(input);
    this.assertProviderReady(input);

    switch (input.provider) {
      case "openai":
        return this.openaiProviderClient.streamText(input, signal);
      case "anthropic":
        return this.anthropicProviderClient.streamText(input, signal);
    }
  }

  private assertValidRequest(input: ProviderGatewayTextGenerateRequest): void {
    if (input.model.trim().length === 0) {
      throw new BadRequestException("model must be a non-empty string");
    }
    if (input.messages.length === 0) {
      throw new BadRequestException("messages must include at least one item");
    }
    for (const [index, message] of input.messages.entries()) {
      if (message.content.trim().length === 0) {
        throw new BadRequestException(`messages[${index}].content must be non-empty`);
      }
    }
    if (
      input.maxOutputTokens !== undefined &&
      (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0)
    ) {
      throw new BadRequestException("maxOutputTokens must be a positive integer when provided");
    }
  }

  private assertProviderReady(input: ProviderGatewayTextGenerateRequest): void {
    const providerState = this.providerWarmupService
      .getSnapshot()
      .providers.find((provider) => provider.provider === input.provider);
    if (!providerState || providerState.state !== "ready") {
      throw new ServiceUnavailableException(`Provider "${input.provider}" is not ready.`);
    }
    if (
      providerState.catalogModels.length > 0 &&
      !providerState.catalogModels.includes(input.model.trim())
    ) {
      throw new BadRequestException(
        `Model "${input.model}" is not present in the warmed provider catalog for "${input.provider}".`
      );
    }
  }
}
