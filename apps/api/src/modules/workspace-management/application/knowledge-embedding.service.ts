import { Injectable, Logger } from "@nestjs/common";
import { PlatformRuntimeProviderSecretStoreService } from "./platform-runtime-provider-secret-store.service";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDINGS_TIMEOUT_MS = 30_000;

@Injectable()
export class KnowledgeEmbeddingService {
  private readonly logger = new Logger(KnowledgeEmbeddingService.name);

  constructor(
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService
  ) {}

  async generateEmbeddings(params: {
    modelKey: string | null;
    texts: string[];
  }): Promise<Array<number[] | null>> {
    const normalizedTexts = params.texts.map((text) => text.trim());
    if (params.modelKey === null || normalizedTexts.length === 0) {
      return normalizedTexts.map(() => null);
    }

    const apiKey =
      await this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
        "tool_memory_search"
      );
    if (apiKey === null) {
      return normalizedTexts.map(() => null);
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
      };
      const rows = payload.data ?? [];
      return normalizedTexts.map((_, index) => {
        const embedding = rows[index]?.embedding;
        return Array.isArray(embedding) && embedding.every((value) => typeof value === "number")
          ? (embedding as number[])
          : null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Knowledge embedding request failed: ${message}`);
      return normalizedTexts.map(() => null);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
