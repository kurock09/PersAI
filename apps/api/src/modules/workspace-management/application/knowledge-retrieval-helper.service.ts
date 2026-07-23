import { Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult
} from "@persai/runtime-contract";
import { KnowledgeModelPolicyService } from "./knowledge-model-policy.service";
import { ResolvePlatformRuntimeProviderSettingsService } from "./resolve-platform-runtime-provider-settings.service";

const KNOWLEDGE_HELPER_TIMEOUT_MS = 20_000;
const KNOWLEDGE_HELPER_OUTPUT_SCHEMA = {
  name: "knowledge_search_rerank",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["rankedReferenceIds"],
    properties: {
      rankedReferenceIds: {
        type: "array",
        items: { type: "string" }
      }
    }
  }
} as const;

export type KnowledgeRetrievalHelperRankingResult = {
  rankedReferenceIds: string[];
  modelKey: string;
  providerKey: "openai" | "anthropic" | "deepseek" | "kimi";
  usage: ProviderGatewayTextGenerateResult["usage"];
};

@Injectable()
export class KnowledgeRetrievalHelperService {
  private readonly logger = new Logger(KnowledgeRetrievalHelperService.name);

  constructor(
    private readonly knowledgeModelPolicyService: KnowledgeModelPolicyService,
    private readonly resolvePlatformRuntimeProviderSettingsService: ResolvePlatformRuntimeProviderSettingsService
  ) {}

  async rerankCandidates(params: {
    assistantId: string;
    query: string;
    retrievalModelKey?: string | null;
    candidates: Array<{
      referenceId: string;
      title: string | null;
      locator: string | null;
      snippet: string | null;
    }>;
  }): Promise<KnowledgeRetrievalHelperRankingResult | null> {
    if (params.candidates.length < 2) {
      return null;
    }
    const retrievalPolicy = await this.knowledgeModelPolicyService.resolveAssistantRetrievalPolicy(
      params.assistantId
    );
    if (!retrievalPolicy.helperEnabled || retrievalPolicy.helperCandidateLimit < 2) {
      return null;
    }
    const retrievalModelKey =
      params.retrievalModelKey === undefined
        ? await this.knowledgeModelPolicyService.resolveAssistantRetrievalModelKey(
            params.assistantId
          )
        : params.retrievalModelKey;
    if (retrievalModelKey === null) {
      return null;
    }
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_PROVIDER_GATEWAY_BASE_URL?.trim();
    if (!baseUrl) {
      return null;
    }
    const runtimeSettings = await this.resolvePlatformRuntimeProviderSettingsService.execute();
    if (runtimeSettings.primary === null) {
      return null;
    }

    const limitedCandidates = params.candidates.slice(0, retrievalPolicy.helperCandidateLimit);
    const request: ProviderGatewayTextGenerateRequest = {
      provider: runtimeSettings.primary.provider,
      model: retrievalModelKey,
      systemPrompt:
        "You are a hidden knowledge-retrieval helper. Rank candidate references for relevance to the query. Prefer directly answering references, concise titles/snippets, and product-safe precision. Return only the ranked reference ids that should stay, most relevant first.",
      messages: [
        {
          role: "user",
          content: [
            `Query: ${params.query}`,
            "",
            "Candidates:",
            ...limitedCandidates.map((candidate, index) =>
              [
                `${String(index + 1)}. referenceId=${candidate.referenceId}`,
                candidate.title ? `title=${candidate.title}` : null,
                candidate.locator ? `locator=${candidate.locator}` : null,
                candidate.snippet ? `snippet=${candidate.snippet}` : null
              ]
                .filter((row): row is string => row !== null)
                .join("\n")
            )
          ].join("\n")
        }
      ],
      maxOutputTokens: retrievalPolicy.helperMaxOutputTokens,
      outputSchema: KNOWLEDGE_HELPER_OUTPUT_SCHEMA,
      requestMetadata: {
        classification: "turn_routing",
        runtimeRequestId: null,
        runtimeSessionId: null,
        toolLoopIteration: null,
        compactionToolCode: null
      }
    };

    try {
      const response = await this.postJsonWithFallback({
        url: new URL("/api/v1/providers/generate-text", baseUrl).toString(),
        request,
        timeoutMs: KNOWLEDGE_HELPER_TIMEOUT_MS,
        fallback:
          runtimeSettings.fallback === null
            ? null
            : {
                provider: runtimeSettings.fallback.provider,
                model: runtimeSettings.fallback.model
              }
      });
      const payload = response.text
        ? (JSON.parse(response.text) as { rankedReferenceIds?: unknown })
        : {};
      const ranked = Array.isArray(payload.rankedReferenceIds)
        ? payload.rankedReferenceIds.filter(
            (value): value is string =>
              typeof value === "string" &&
              limitedCandidates.some((candidate) => candidate.referenceId === value)
          )
        : [];
      return {
        rankedReferenceIds: ranked,
        modelKey: response.model,
        providerKey: response.provider,
        usage: response.usage
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Knowledge retrieval helper failed: ${message}`);
      return null;
    }
  }

  private async postJson(
    url: string,
    body: ProviderGatewayTextGenerateRequest,
    timeoutMs: number
  ): Promise<ProviderGatewayTextGenerateResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
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
      return (await response.json()) as ProviderGatewayTextGenerateResult;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async postJsonWithFallback(input: {
    url: string;
    request: ProviderGatewayTextGenerateRequest;
    timeoutMs: number;
    fallback: { provider: "openai" | "anthropic" | "deepseek" | "kimi"; model: string } | null;
  }): Promise<ProviderGatewayTextGenerateResult> {
    try {
      return await this.postJson(input.url, input.request, input.timeoutMs);
    } catch (error) {
      if (!this.isRetryableProviderFailure(error)) {
        throw error;
      }
      if (
        input.fallback === null ||
        (input.fallback.provider === input.request.provider &&
          input.fallback.model === input.request.model)
      ) {
        throw error;
      }
      this.logger.warn(
        `[knowledge-helper-fallback-primary-failed] provider=${input.request.provider} model=${input.request.model} fallbackProvider=${input.fallback.provider} fallbackModel=${input.fallback.model} error=${
          error instanceof Error ? error.message : String(error)
        }`
      );
      try {
        const result = await this.postJson(
          input.url,
          {
            ...input.request,
            provider: input.fallback.provider,
            model: input.fallback.model
          },
          input.timeoutMs
        );
        this.logger.log(
          `[knowledge-helper-fallback-succeeded] primaryProvider=${input.request.provider} primaryModel=${input.request.model} fallbackProvider=${result.provider} fallbackModel=${result.model}`
        );
        return result;
      } catch (fallbackError) {
        this.logger.warn(
          `[knowledge-helper-fallback-failed] primaryProvider=${input.request.provider} primaryModel=${input.request.model} fallbackProvider=${input.fallback.provider} fallbackModel=${input.fallback.model} error=${
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          }`
        );
        throw fallbackError;
      }
    }
  }

  private isRetryableProviderFailure(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    return /^HTTP 5\d{2}\b/.test(message);
  }
}
