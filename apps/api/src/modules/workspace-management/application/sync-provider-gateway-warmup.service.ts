import { loadApiConfig } from "@persai/config";
import { Injectable } from "@nestjs/common";
import { AssistantRuntimeError, type AssistantRuntimeErrorCode } from "./assistant-runtime.facade";
import type { AssistantMaterializedSpec } from "../domain/assistant-materialized-spec.entity";
import { toNormalizedNonEmptyModelKey } from "./model-key-normalization";

type ProviderGatewayWarmupStatus = "skipped_unconfigured" | "warmed";
type ManagedRuntimeProvider = "openai" | "anthropic";

type ProviderGatewayWarmupRequest = {
  schema: "persai.providerGatewayWarmupRequest.v1";
  source: "control_plane_apply";
  availableModelsByProvider: Record<ManagedRuntimeProvider, string[]>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

@Injectable()
export class SyncProviderGatewayWarmupService {
  async execute(input: {
    materializedSpec: AssistantMaterializedSpec;
  }): Promise<ProviderGatewayWarmupStatus> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_PROVIDER_GATEWAY_BASE_URL?.trim();
    if (!baseUrl) {
      return "skipped_unconfigured";
    }

    const request: ProviderGatewayWarmupRequest = {
      schema: "persai.providerGatewayWarmupRequest.v1",
      source: "control_plane_apply",
      availableModelsByProvider: this.readAvailableModelsByProvider(input.materializedSpec)
    };

    await this.postJson(
      new URL("/api/v1/providers/warmup", baseUrl).toString(),
      request,
      config.PERSAI_PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS
    );

    return "warmed";
  }

  private readAvailableModelsByProvider(
    materializedSpec: AssistantMaterializedSpec
  ): Record<ManagedRuntimeProvider, string[]> {
    const layers = isObject(materializedSpec.layers) ? materializedSpec.layers : null;
    const layerEnvelope = isObject(layers?.layers) ? layers.layers : null;
    const governance = isObject(layerEnvelope?.governance) ? layerEnvelope.governance : null;
    const runtimeProviderProfile = isObject(governance?.runtimeProviderProfile)
      ? governance.runtimeProviderProfile
      : null;
    const availableModelsByProvider = isObject(runtimeProviderProfile?.availableModelsByProvider)
      ? runtimeProviderProfile.availableModelsByProvider
      : null;

    return {
      openai: normalizeModelList(availableModelsByProvider?.openai),
      anthropic: normalizeModelList(availableModelsByProvider?.anthropic)
    };
  }

  private async postJson(url: string, body: unknown, timeoutMs: number): Promise<void> {
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
        throw new AssistantRuntimeError(
          this.toErrorCode(response.status),
          `Provider gateway warmup failed with HTTP ${response.status}.`
        );
      }
    } catch (error) {
      if (error instanceof AssistantRuntimeError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new AssistantRuntimeError(
          "runtime_degraded",
          `Provider gateway warmup timed out after ${timeoutMs}ms.`
        );
      }
      const message =
        error instanceof Error ? error.message : "Unknown provider gateway warmup failure.";
      throw new AssistantRuntimeError(
        "runtime_degraded",
        `Provider gateway warmup failed: ${message}`
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private toErrorCode(status: number): AssistantRuntimeErrorCode {
    if (status === 401 || status === 403) {
      return "auth_failure";
    }
    if (status === 408 || status === 504) {
      return "timeout";
    }
    return "runtime_degraded";
  }
}
