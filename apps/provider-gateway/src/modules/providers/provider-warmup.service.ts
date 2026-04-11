import { BadRequestException, Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import { PROVIDER_GATEWAY_CONFIG } from "../../provider-gateway-config";
import { AnthropicProviderClient } from "./anthropic/anthropic-provider.client";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import type {
  ProviderCatalogByProvider,
  ProviderCatalogSource,
  ProviderGatewayWarmupRequest,
  ProviderGatewayProvider,
  ProviderWarmStatus,
  ProviderWarmableClient,
  ProviderWarmupSnapshot
} from "./provider-client.types";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createEmptyCatalogByProvider(): ProviderCatalogByProvider {
  return {
    openai: [],
    anthropic: []
  };
}

function normalizeModelList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const normalized = entry.trim();
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return Array.from(deduped);
}

type ProviderCatalogState = {
  catalogModels: string[];
  catalogSource: ProviderCatalogSource;
};

@Injectable()
export class ProviderWarmupService implements OnModuleInit {
  private readonly clients: ProviderWarmableClient[];
  private runs = 0;
  private failures = 0;
  private lastAttemptedAt: string | null = null;
  private lastCompletedAt: string | null = null;
  private lastDurationMs: number | null = null;
  private readonly providerState = new Map<ProviderGatewayProvider, ProviderWarmStatus>();

  constructor(
    @Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig,
    openaiProviderClient: OpenAIProviderClient,
    anthropicProviderClient: AnthropicProviderClient
  ) {
    this.clients = [openaiProviderClient, anthropicProviderClient];

    for (const client of this.clients) {
      const catalogState = this.resolveCatalogState(client, null);
      this.providerState.set(client.provider, {
        provider: client.provider,
        configured: client.isConfigured(),
        state: client.isConfigured() ? "pending" : "unconfigured",
        catalogModels: catalogState.catalogModels,
        catalogSource: catalogState.catalogSource,
        warmedAt: null,
        error: null
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.PROVIDER_GATEWAY_WARM_ON_BOOT) {
      return;
    }
    await this.warmProviders();
  }

  async warmProviders(input?: unknown): Promise<ProviderWarmupSnapshot> {
    const controlPlaneRequest = this.parseWarmupRequest(input);
    const startedAt = Date.now();
    this.lastAttemptedAt = new Date(startedAt).toISOString();
    this.runs += 1;

    let encounteredFailure = false;

    for (const client of this.clients) {
      const catalogState = this.resolveCatalogState(client, controlPlaneRequest);
      if (!client.isConfigured()) {
        this.providerState.set(client.provider, {
          provider: client.provider,
          configured: false,
          state: "unconfigured",
          catalogModels: catalogState.catalogModels,
          catalogSource: catalogState.catalogSource,
          warmedAt: null,
          error: null
        });
        continue;
      }

      this.providerState.set(client.provider, {
        provider: client.provider,
        configured: true,
        state: "warming",
        catalogModels: catalogState.catalogModels,
        catalogSource: catalogState.catalogSource,
        warmedAt: null,
        error: null
      });

      try {
        await client.warm();
        this.providerState.set(client.provider, {
          provider: client.provider,
          configured: true,
          state: "ready",
          catalogModels: catalogState.catalogModels,
          catalogSource: catalogState.catalogSource,
          warmedAt: new Date().toISOString(),
          error: null
        });
      } catch (error) {
        encounteredFailure = true;
        this.providerState.set(client.provider, {
          provider: client.provider,
          configured: true,
          state: "failed",
          catalogModels: catalogState.catalogModels,
          catalogSource: catalogState.catalogSource,
          warmedAt: null,
          error: this.normalizeError(error)
        });
      }
    }

    this.lastCompletedAt = new Date().toISOString();
    this.lastDurationMs = Date.now() - startedAt;

    if (encounteredFailure) {
      this.failures += 1;
    }

    return this.getSnapshot();
  }

  getSnapshot(): ProviderWarmupSnapshot {
    return {
      schema: "persai.providerGatewayWarmup.v1",
      warmOnBoot: this.config.PROVIDER_GATEWAY_WARM_ON_BOOT,
      runs: this.runs,
      failures: this.failures,
      lastAttemptedAt: this.lastAttemptedAt,
      lastCompletedAt: this.lastCompletedAt,
      lastDurationMs: this.lastDurationMs,
      providers: this.clients.map((client) => {
        const state = this.providerState.get(client.provider);
        if (state) {
          return {
            ...state,
            catalogModels: [...state.catalogModels]
          };
        }
        const catalogState = this.resolveCatalogState(client, null);
        return {
          provider: client.provider,
          configured: client.isConfigured(),
          state: client.isConfigured() ? "pending" : "unconfigured",
          catalogModels: catalogState.catalogModels,
          catalogSource: catalogState.catalogSource,
          warmedAt: null,
          error: null
        };
      })
    };
  }

  private resolveCatalogState(
    client: ProviderWarmableClient,
    request: ProviderGatewayWarmupRequest | null
  ): ProviderCatalogState {
    if (request !== null) {
      return {
        catalogModels: [...request.availableModelsByProvider[client.provider]],
        catalogSource: request.source
      };
    }

    const existing = this.providerState.get(client.provider);
    if (existing) {
      return {
        catalogModels: [...existing.catalogModels],
        catalogSource: existing.catalogSource
      };
    }

    return {
      catalogModels: client.getCatalogModels(),
      catalogSource: client.catalogSource
    };
  }

  private parseWarmupRequest(input: unknown): ProviderGatewayWarmupRequest | null {
    if (input === undefined || input === null) {
      return null;
    }
    if (isObject(input) && Object.keys(input).length === 0) {
      return null;
    }
    if (!isObject(input)) {
      throw new BadRequestException("Provider warmup request body must be an object.");
    }

    const schema =
      typeof input.schema === "string" && input.schema.trim().length > 0
        ? input.schema.trim()
        : null;
    if (schema !== "persai.providerGatewayWarmupRequest.v1") {
      throw new BadRequestException(
        'Provider warmup request schema must equal "persai.providerGatewayWarmupRequest.v1".'
      );
    }
    if (input.source !== "control_plane_apply") {
      throw new BadRequestException(
        'Provider warmup request source must equal "control_plane_apply".'
      );
    }

    const rawCatalog = isObject(input.availableModelsByProvider)
      ? input.availableModelsByProvider
      : null;
    if (rawCatalog === null) {
      throw new BadRequestException(
        "Provider warmup request availableModelsByProvider must be an object."
      );
    }

    const availableModelsByProvider = createEmptyCatalogByProvider();
    for (const provider of this.clients.map((client) => client.provider)) {
      availableModelsByProvider[provider] = normalizeModelList(rawCatalog[provider]);
    }

    return {
      schema: "persai.providerGatewayWarmupRequest.v1",
      source: "control_plane_apply",
      availableModelsByProvider
    };
  }

  private normalizeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
