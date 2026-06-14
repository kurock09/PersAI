import { Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";
import type { OpenAiModerationResult } from "./safety-moderation-decision";

const OPENAI_MODERATIONS_URL = "https://api.openai.com/v1/moderations";

type OpenAiModerationApiResponse = {
  results?: Array<{
    flagged?: boolean;
    categories?: Record<string, boolean>;
    category_scores?: Record<string, number>;
  }>;
};

@Injectable()
export class OpenAiModerationClientService {
  private readonly logger = new Logger(OpenAiModerationClientService.name);

  constructor(
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  async moderateText(input: {
    model: string;
    text: string;
    timeoutMs?: number;
  }): Promise<OpenAiModerationResult> {
    const trimmed = input.text.trim();
    if (trimmed.length === 0) {
      return {
        flagged: false,
        categories: {},
        categoryScores: {}
      };
    }
    const config = loadApiConfig(process.env);
    const apiKey =
      config.SAFETY_MODERATION_OPENAI_API_KEY?.trim() ??
      (await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        "openai"
      ));
    if (apiKey === null || apiKey.length === 0) {
      throw new Error("OpenAI moderation API key is not configured.");
    }
    const requestTimeoutMs = input.timeoutMs ?? config.SAFETY_MODERATION_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(OPENAI_MODERATIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: input.model,
          input: trimmed
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `OpenAI moderation request failed (${response.status}): ${body.slice(0, 500)}`
        );
      }
      const payload = (await response.json()) as OpenAiModerationApiResponse;
      const result = payload.results?.[0];
      if (result === undefined) {
        throw new Error("OpenAI moderation response did not include results.");
      }
      return {
        flagged: result.flagged === true,
        categories: result.categories ?? {},
        categoryScores: result.category_scores ?? {}
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`OpenAI moderation call failed: ${message}`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
