import { Injectable, Logger } from "@nestjs/common";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDINGS_TIMEOUT_MS = 30_000;
const OPENAI_PROVIDER_SECRET_KEY = "openai";

@Injectable()
export class KnowledgeEmbeddingService {
  private readonly logger = new Logger(KnowledgeEmbeddingService.name);
  private missingCredentialWarned = false;

  constructor(
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  async generateEmbeddings(params: { modelKey: string | null; texts: string[] }): Promise<{
    embeddings: Array<number[] | null>;
    usage: {
      providerKey: "openai";
      modelKey: string;
      inputTokens: number;
      totalTokens: number;
    } | null;
  }> {
    const normalizedTexts = params.texts.map((text) => text.trim());
    if (params.modelKey === null || normalizedTexts.length === 0) {
      return { embeddings: normalizedTexts.map(() => null), usage: null };
    }

    const apiKey = await this.resolveEmbeddingApiKey();
    if (apiKey === null) {
      return { embeddings: normalizedTexts.map(() => null), usage: null };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EMBEDDINGS_TIMEOUT_MS);

    try {
      const response = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: params.modelKey,
          input: normalizedTexts
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(
          bodyText.trim().length > 0
            ? `HTTP ${response.status}: ${bodyText.trim()}`
            : `HTTP ${response.status}`
        );
      }

      const payload = (await response.json()) as {
        data?: Array<{ embedding?: unknown }>;
        usage?: { prompt_tokens?: unknown; total_tokens?: unknown };
      };
      const rows = payload.data ?? [];
      const promptTokens =
        typeof payload.usage?.prompt_tokens === "number" &&
        Number.isFinite(payload.usage.prompt_tokens)
          ? Math.max(0, Math.floor(payload.usage.prompt_tokens))
          : 0;
      const totalTokens =
        typeof payload.usage?.total_tokens === "number" &&
        Number.isFinite(payload.usage.total_tokens)
          ? Math.max(0, Math.floor(payload.usage.total_tokens))
          : promptTokens;
      return {
        embeddings: normalizedTexts.map((_, index) => {
          const embedding = rows[index]?.embedding;
          return Array.isArray(embedding) && embedding.every((value) => typeof value === "number")
            ? (embedding as number[])
            : null;
        }),
        usage:
          promptTokens > 0 || totalTokens > 0
            ? {
                providerKey: "openai",
                modelKey: params.modelKey,
                inputTokens: promptTokens,
                totalTokens
              }
            : null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Knowledge embedding request failed: ${message}`);
      return { embeddings: normalizedTexts.map(() => null), usage: null };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async resolveEmbeddingApiKey(): Promise<string | null> {
    const apiKey =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        OPENAI_PROVIDER_SECRET_KEY
      );
    if (apiKey !== null && apiKey.trim().length > 0) {
      return apiKey;
    }
    if (!this.missingCredentialWarned) {
      this.missingCredentialWarned = true;
      this.logger.warn(
        "Knowledge embedding credentials are not configured. Set the openai provider secret before indexing vector knowledge."
      );
    }
    return null;
  }
}
