import { loadApiConfig } from "@persai/config";
import type { RuntimeBundleRef } from "@persai/runtime-contract";
import { Injectable } from "@nestjs/common";
import { AssistantRuntimeError, type AssistantRuntimeErrorCode } from "./assistant-runtime.facade";
import type { AssistantMaterializedSpec } from "../domain/assistant-materialized-spec.entity";
import type { RuntimeTier } from "./runtime-assignment";
import { resolveMaterializedNativeRuntimeBundle } from "./native-runtime-bundle-hash";

type NativeRuntimeBundleSyncStatus = "skipped_unconfigured" | "warmed";

@Injectable()
export class SyncNativeRuntimeBundleService {
  async execute(input: {
    materializedSpec: AssistantMaterializedSpec;
    runtimeTier: RuntimeTier;
  }): Promise<NativeRuntimeBundleSyncStatus> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    if (!baseUrl) {
      return "skipped_unconfigured";
    }

    const { bundleDocument, bundleHash } = resolveMaterializedNativeRuntimeBundle({
      materializedSpec: input.materializedSpec,
      context: "Native runtime"
    });

    const bundleRef: RuntimeBundleRef = {
      bundleId: input.materializedSpec.id,
      assistantId: input.materializedSpec.assistantId,
      workspaceId: this.readWorkspaceIdFromMaterializedSpec(input.materializedSpec),
      publishedVersionId: input.materializedSpec.publishedVersionId,
      bundleHash,
      compiledAt: new Date().toISOString()
    };

    await this.postJson(
      new URL("/api/v1/bundles/invalidate", baseUrl).toString(),
      {
        assistantId: input.materializedSpec.assistantId
      },
      config.PERSAI_RUNTIME_BUNDLE_SYNC_TIMEOUT_MS
    );

    await this.postJson(
      new URL("/api/v1/bundles/warm", baseUrl).toString(),
      {
        bundle: bundleRef,
        bundleDocument,
        materializedSpecId: input.materializedSpec.id,
        runtimeTier: input.runtimeTier
      },
      config.PERSAI_RUNTIME_BUNDLE_SYNC_TIMEOUT_MS
    );

    return "warmed";
  }

  private readWorkspaceIdFromMaterializedSpec(spec: AssistantMaterializedSpec): string {
    const runtimeBundle = spec.runtimeBundle;
    if (runtimeBundle && typeof runtimeBundle === "object" && !Array.isArray(runtimeBundle)) {
      const metadata = (runtimeBundle as { metadata?: unknown }).metadata;
      if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
        const workspaceId = (metadata as { workspaceId?: unknown }).workspaceId;
        if (typeof workspaceId === "string" && workspaceId.trim().length > 0) {
          return workspaceId;
        }
      }
    }

    throw new AssistantRuntimeError(
      "runtime_degraded",
      "Native runtime bundle metadata.workspaceId is missing after materialization."
    );
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
          `Native runtime bundle sync failed with HTTP ${response.status}.`
        );
      }
    } catch (error) {
      if (error instanceof AssistantRuntimeError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new AssistantRuntimeError(
          "runtime_degraded",
          `Native runtime bundle sync timed out after ${timeoutMs}ms.`
        );
      }
      const message =
        error instanceof Error ? error.message : "Unknown native runtime bundle sync failure.";
      throw new AssistantRuntimeError(
        "runtime_degraded",
        `Native runtime bundle sync failed: ${message}`
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
