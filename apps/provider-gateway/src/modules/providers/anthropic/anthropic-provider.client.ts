import { Inject, Injectable } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult
} from "@persai/runtime-contract";
import Anthropic from "@anthropic-ai/sdk";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";
import type { ProviderWarmableClient } from "../provider-client.types";

@Injectable()
export class AnthropicProviderClient implements ProviderWarmableClient {
  readonly provider = "anthropic" as const;
  readonly catalogSource = "bootstrap_config" as const;
  private client: Anthropic | null = null;

  constructor(
    @Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig
  ) {}

  isConfigured(): boolean {
    return typeof this.config.PROVIDER_GATEWAY_ANTHROPIC_API_KEY === "string";
  }

  getCatalogModels(): string[] {
    return [...this.config.PROVIDER_GATEWAY_ANTHROPIC_MODELS];
  }

  async warm(): Promise<void> {
    const apiKey = this.config.PROVIDER_GATEWAY_ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.client = null;
      return;
    }
    this.client = new Anthropic({
      apiKey,
      timeout: this.config.PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS
    });
  }

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    if (this.client === null) {
      throw new Error("Anthropic provider client is not warmed.");
    }

    const response = await this.client.messages.create({
      model: input.model,
      max_tokens: input.maxOutputTokens ?? 1_024,
      ...(input.systemPrompt === null ? {} : { system: input.systemPrompt }),
      messages: input.messages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    });

    const text = response.content
      .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!text) {
      throw new Error("Anthropic provider response did not contain text output.");
    }

    const inputTokens = response.usage?.input_tokens ?? null;
    const outputTokens = response.usage?.output_tokens ?? null;
    const totalTokens =
      inputTokens === null && outputTokens === null
        ? null
        : (inputTokens ?? 0) + (outputTokens ?? 0);

    return {
      provider: "anthropic",
      model: input.model,
      text,
      respondedAt: new Date().toISOString(),
      usage: {
        providerKey: "anthropic",
        modelKey: input.model,
        inputTokens,
        outputTokens,
        totalTokens
      }
    };
  }

  getClient(): Anthropic | null {
    return this.client;
  }
}
