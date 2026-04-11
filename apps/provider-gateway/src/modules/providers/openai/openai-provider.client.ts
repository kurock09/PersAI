import { Inject, Injectable } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult
} from "@persai/runtime-contract";
import OpenAI from "openai";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";
import type { ProviderWarmableClient } from "../provider-client.types";

@Injectable()
export class OpenAIProviderClient implements ProviderWarmableClient {
  readonly provider = "openai" as const;
  readonly catalogSource = "bootstrap_config" as const;
  private client: OpenAI | null = null;

  constructor(
    @Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig
  ) {}

  isConfigured(): boolean {
    return typeof this.config.PROVIDER_GATEWAY_OPENAI_API_KEY === "string";
  }

  getCatalogModels(): string[] {
    return [...this.config.PROVIDER_GATEWAY_OPENAI_MODELS];
  }

  async warm(): Promise<void> {
    const apiKey = this.config.PROVIDER_GATEWAY_OPENAI_API_KEY;
    if (!apiKey) {
      this.client = null;
      return;
    }
    this.client = new OpenAI({
      apiKey,
      timeout: this.config.PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS
    });
  }

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    if (this.client === null) {
      throw new Error("OpenAI provider client is not warmed.");
    }

    const response = await this.client.responses.create({
      model: input.model,
      ...(input.systemPrompt === null ? {} : { instructions: input.systemPrompt }),
      input: input.messages.map((message) => ({
        role: message.role,
        content: [{ type: "input_text", text: message.content }]
      })),
      ...(input.maxOutputTokens === undefined
        ? {}
        : { max_output_tokens: input.maxOutputTokens })
    });

    const text = typeof response.output_text === "string" ? response.output_text.trim() : "";
    if (!text) {
      throw new Error("OpenAI provider response did not contain text output.");
    }

    return {
      provider: "openai",
      model: input.model,
      text,
      respondedAt: new Date().toISOString(),
      usage:
        response.usage === undefined
          ? null
          : {
              providerKey: "openai",
              modelKey: input.model,
              inputTokens: response.usage.input_tokens ?? null,
              outputTokens: response.usage.output_tokens ?? null,
              totalTokens: response.usage.total_tokens ?? null
            }
    };
  }

  getClient(): OpenAI | null {
    return this.client;
  }
}
