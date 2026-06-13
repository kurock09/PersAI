import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import { PROVIDER_GATEWAY_CONFIG } from "../../provider-gateway-config";
import { AnthropicProviderClient } from "./anthropic/anthropic-provider.client";
import { OpenAIProviderClient } from "./openai/openai-provider.client";
import { toNormalizedNonEmptyModelKey } from "./model-key-normalization";
import type {
  ProviderCatalogByProvider,
  ProviderCatalogSource,
  ProviderGatewayWarmupRequest,
  ProviderGatewayProvider,
  ProviderWarmStatus,
  ProviderWarmableClient,
  ProviderWarmupSnapshot
} from "./provider-client.types";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import {
  hasRetryableWarmupFailures,
  isProviderGatewayWarmupReady,
  sleep
} from "./provider-warmup-boot-recovery";

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
    const normalized = toNormalizedNonEmptyModelKey(entry);
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

const MANAGED_PROVIDER_SECRET_IDS: Record<ProviderGatewayProvider, string> = {
  openai: "openai/api-key",
  anthropic: "anthropic/api-key"
};

@Injectable()
export class ProviderWarmupService implements OnModuleInit, OnModuleDestroy {
  private readonly clients: ProviderWarmableClient[];
  private runs = 0;
  private failures = 0;
  private lastAttemptedAt: string | null = null;
  private lastCompletedAt: string | null = null;
  private lastDurationMs: number | null = null;
  private readonly providerState = new Map<ProviderGatewayProvider, ProviderWarmStatus>();
  private bootWarmupRecoveryTimer: NodeJS.Timeout | null = null;
  private bootWarmupRecoveryInFlight = false;

  constructor(
    @Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
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
    await this.runBootWarmupWithRetry();
    this.scheduleBootWarmupRecoveryIfNeeded();
  }

  onModuleDestroy(): void {
    this.clearBootWarmupRecoveryTimer();
  }

  private async runBootWarmupWithRetry(): Promise<void> {
    const maxAttempts = this.config.PROVIDER_GATEWAY_BOOT_WARMUP_MAX_ATTEMPTS;
    const baseDelayMs = this.config.PROVIDER_GATEWAY_BOOT_WARMUP_RETRY_DELAY_MS;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const snapshot = await this.warmProviders();
      if (isProviderGatewayWarmupReady(snapshot)) {
        return;
      }
      if (!hasRetryableWarmupFailures(snapshot) || attempt >= maxAttempts) {
        return;
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  private scheduleBootWarmupRecoveryIfNeeded(): void {
    if (!this.config.PROVIDER_GATEWAY_WARM_ON_BOOT) {
      return;
    }
    if (isProviderGatewayWarmupReady(this.getSnapshot())) {
      return;
    }
    if (!hasRetryableWarmupFailures(this.getSnapshot())) {
      return;
    }
    if (this.bootWarmupRecoveryTimer !== null) {
      return;
    }

    const intervalMs = this.config.PROVIDER_GATEWAY_BOOT_WARMUP_RECOVERY_INTERVAL_MS;
    this.bootWarmupRecoveryTimer = setInterval(() => {
      void this.runBootWarmupRecoveryTick();
    }, intervalMs);
    this.bootWarmupRecoveryTimer.unref?.();
  }

  private async runBootWarmupRecoveryTick(): Promise<void> {
    if (this.bootWarmupRecoveryInFlight) {
      return;
    }

    const snapshot = this.getSnapshot();
    if (isProviderGatewayWarmupReady(snapshot)) {
      this.clearBootWarmupRecoveryTimer();
      return;
    }
    if (!hasRetryableWarmupFailures(snapshot)) {
      this.clearBootWarmupRecoveryTimer();
      return;
    }

    this.bootWarmupRecoveryInFlight = true;
    try {
      const nextSnapshot = await this.warmProviders();
      if (isProviderGatewayWarmupReady(nextSnapshot)) {
        this.clearBootWarmupRecoveryTimer();
        return;
      }
      if (!hasRetryableWarmupFailures(nextSnapshot)) {
        this.clearBootWarmupRecoveryTimer();
      }
    } finally {
      this.bootWarmupRecoveryInFlight = false;
    }
  }

  private clearBootWarmupRecoveryTimer(): void {
    if (this.bootWarmupRecoveryTimer === null) {
      return;
    }
    clearInterval(this.bootWarmupRecoveryTimer);
    this.bootWarmupRecoveryTimer = null;
  }

  async warmProviders(input?: unknown): Promise<ProviderWarmupSnapshot> {
    const controlPlaneRequest = this.parseWarmupRequest(input);
    const startedAt = Date.now();
    this.lastAttemptedAt = new Date(startedAt).toISOString();
    this.runs += 1;

    let encounteredFailure = false;

    for (const client of this.clients) {
      const catalogState = this.resolveCatalogState(client, controlPlaneRequest);

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
        const managedApiKey = await this.resolveManagedApiKey(client.provider);
        if (!client.isConfigured() && managedApiKey === null) {
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
        await client.warm(managedApiKey ?? undefined);
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

  async ensureReadyForRequest(input: {
    provider: ProviderGatewayProvider;
    model: string;
  }): Promise<ProviderWarmStatus> {
    let state = this.getSnapshot().providers.find(
      (provider) => provider.provider === input.provider
    );
    if (this.matchesRequest(state, input.model)) {
      return state!;
    }

    if (this.persaiInternalApiClientService.isConfigured()) {
      const settings = await this.persaiInternalApiClientService.getDefaultProviderSettings();
      await this.warmProviders({
        schema: "persai.providerGatewayWarmupRequest.v1",
        source: "control_plane_apply",
        availableModelsByProvider: settings.availableModelsByProvider
      });
      state = this.getSnapshot().providers.find((provider) => provider.provider === input.provider);
    }

    if (!state || state.state !== "ready") {
      throw new ServiceUnavailableException(`Provider "${input.provider}" is not ready.`);
    }
    if (!this.matchesCatalogModel(state, input.model)) {
      throw new BadRequestException(
        `Model "${input.model}" is not present in the warmed provider catalog for "${input.provider}".`
      );
    }
    return state;
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

  private async resolveManagedApiKey(provider: ProviderGatewayProvider): Promise<string | null> {
    if (!this.persaiInternalApiClientService.isConfigured()) {
      return null;
    }

    try {
      const value = await this.persaiInternalApiClientService.resolveSecretValue(
        MANAGED_PROVIDER_SECRET_IDS[provider]
      );
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch (error) {
      if (this.isMissingManagedSecretError(error)) {
        return null;
      }
      throw error;
    }
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

  private isMissingManagedSecretError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return (
      error.message.includes("PersAI-managed runtime secret") &&
      error.message.includes("is not configured")
    );
  }

  private matchesRequest(state: ProviderWarmStatus | undefined, model: string): boolean {
    return state !== undefined && state.state === "ready" && this.matchesCatalogModel(state, model);
  }

  private matchesCatalogModel(state: ProviderWarmStatus, model: string): boolean {
    const requestedModel = toNormalizedNonEmptyModelKey(model);
    if (requestedModel === null) {
      return false;
    }
    if (state.catalogModels.length === 0) {
      return true;
    }
    return state.catalogModels.some(
      (catalogModel) => toNormalizedNonEmptyModelKey(catalogModel) === requestedModel
    );
  }
}
