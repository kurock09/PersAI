import assert from "node:assert/strict";
import { RuntimeBundleAutoRefreshService } from "../src/modules/turns/runtime-bundle-auto-refresh.service";
import type { PersaiInternalApiClientService } from "../src/modules/turns/persai-internal-api.client.service";
import type { RuntimeBundleCoordinatorService } from "../src/modules/bundles/runtime-bundle-coordinator.service";
import type {
  WarmRuntimeBundleRequest,
  WarmRuntimeBundleResponse
} from "../src/modules/bundles/bundle.types";

export async function runRuntimeBundleAutoRefreshServiceTest(): Promise<void> {
  const warmCalls: WarmRuntimeBundleRequest[] = [];
  const service = new RuntimeBundleAutoRefreshService(
    {
      async ensureFreshSpec() {
        return {
          generation: 6,
          assistantId: "assistant-1",
          materializedSpecId: "bundle-1",
          publishedVersionId: "version-1",
          contentHash: "content-hash-1",
          bundleHash: "bundle-hash-1",
          bundleDocument: '{"metadata":{"assistantId":"assistant-1"}}'
        };
      }
    } as Pick<PersaiInternalApiClientService, "ensureFreshSpec"> as PersaiInternalApiClientService,
    {
      async warmBundle(input: WarmRuntimeBundleRequest): Promise<WarmRuntimeBundleResponse> {
        warmCalls.push(input);
        return {
          bundle: input.bundle,
          warmedAt: "2026-04-18T12:00:00.000Z",
          replaced: false,
          cacheEntries: 1,
          evictedBundleIds: []
        };
      }
    } as Pick<RuntimeBundleCoordinatorService, "warmBundle"> as RuntimeBundleCoordinatorService
  );

  const warmed = await service.ensureRequestedBundle({
    bundle: {
      bundleId: "bundle-1",
      assistantId: "assistant-1",
      workspaceId: "workspace-1",
      publishedVersionId: "version-1",
      bundleHash: "bundle-hash-1",
      compiledAt: "2026-04-18T11:59:00.000Z"
    },
    runtimeTier: "paid_shared_restricted"
  });
  assert.equal(warmed, true);
  assert.equal(warmCalls.length, 1);

  const mismatched = new RuntimeBundleAutoRefreshService(
    {
      async ensureFreshSpec() {
        return {
          generation: 6,
          assistantId: "assistant-1",
          materializedSpecId: "bundle-2",
          publishedVersionId: "version-1",
          contentHash: "content-hash-2",
          bundleHash: "bundle-hash-2",
          bundleDocument: '{"metadata":{"assistantId":"assistant-1"}}'
        };
      }
    } as Pick<PersaiInternalApiClientService, "ensureFreshSpec"> as PersaiInternalApiClientService,
    {
      async warmBundle() {
        throw new Error("warmBundle should not be called for mismatched bundle");
      }
    } as Pick<RuntimeBundleCoordinatorService, "warmBundle"> as RuntimeBundleCoordinatorService
  );

  assert.equal(
    await mismatched.ensureRequestedBundle({
      bundle: {
        bundleId: "bundle-1",
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        publishedVersionId: "version-1",
        bundleHash: "bundle-hash-1",
        compiledAt: "2026-04-18T11:59:00.000Z"
      },
      runtimeTier: "paid_shared_restricted"
    }),
    false
  );
}

void runRuntimeBundleAutoRefreshServiceTest();
