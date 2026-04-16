import assert from "node:assert/strict";
import type { AssistantMaterializedSpec } from "../src/modules/workspace-management/domain/assistant-materialized-spec.entity";
import { AssistantRuntimeError } from "../src/modules/workspace-management/application/assistant-runtime.facade";
import { SyncNativeRuntimeBundleService } from "../src/modules/workspace-management/application/sync-native-runtime-bundle.service";

function createMaterializedSpec(): AssistantMaterializedSpec {
  return {
    id: "spec-1",
    assistantId: "assistant-1",
    publishedVersionId: "version-1",
    sourceAction: "publish",
    algorithmVersion: 1,
    materializedAtConfigGeneration: 1,
    layers: {},
    runtimeBundle: {
      metadata: {
        workspaceId: "workspace-1"
      }
    },
    assistantConfig: {},
    assistantWorkspace: {},
    layersDocument: "{}",
    runtimeBundleDocument: '{"metadata":{"workspaceId":"workspace-1"}}',
    runtimeBundleHash: "bundle-hash-1",
    assistantConfigDocument: "{}",
    assistantWorkspaceDocument: "{}",
    contentHash: "content-hash-1",
    createdAt: new Date("2026-04-11T12:00:00.000Z")
  };
}

function applyBaseApiEnv(): void {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL = "postgresql://persai:persai@localhost:5432/persai";
  process.env.CLERK_SECRET_KEY = "clerk_test_key";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-token";
}

async function run(): Promise<void> {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  try {
    applyBaseApiEnv();
    delete process.env.PERSAI_RUNTIME_BASE_URL;

    const service = new SyncNativeRuntimeBundleService();
    const skipped = await service.execute({
      materializedSpec: createMaterializedSpec(),
      runtimeTier: "paid_shared_restricted"
    });
    assert.equal(skipped, "skipped_unconfigured");

    const calls: Array<{ url: string; body: unknown }> = [];
    process.env.PERSAI_RUNTIME_BASE_URL = "http://runtime.internal:3012";
    process.env.PERSAI_RUNTIME_BUNDLE_SYNC_TIMEOUT_MS = "1500";
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      return {
        ok: true,
        status: 200
      } as Response;
    }) as typeof fetch;

    const warmed = await service.execute({
      materializedSpec: createMaterializedSpec(),
      runtimeTier: "paid_shared_restricted"
    });
    assert.equal(warmed, "warmed");
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, "http://runtime.internal:3012/api/v1/bundles/invalidate");
    assert.deepEqual(calls[0]?.body, {
      assistantId: "assistant-1"
    });
    assert.equal(calls[1]?.url, "http://runtime.internal:3012/api/v1/bundles/warm");
    assert.deepEqual(calls[1]?.body, {
      bundle: {
        bundleId: "spec-1",
        assistantId: "assistant-1",
        workspaceId: "workspace-1",
        publishedVersionId: "version-1",
        bundleHash: "bundle-hash-1",
        compiledAt: (calls[1]?.body as { bundle: { compiledAt: string } }).bundle.compiledAt
      },
      bundleDocument: '{"metadata":{"workspaceId":"workspace-1"}}',
      materializedSpecId: "spec-1",
      runtimeTier: "paid_shared_restricted"
    });

    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 503
      } as Response;
    }) as typeof fetch;

    await assert.rejects(
      service.execute({
        materializedSpec: createMaterializedSpec(),
        runtimeTier: "free_shared_restricted"
      }),
      (error: unknown) =>
        error instanceof AssistantRuntimeError &&
        error.code === "runtime_degraded" &&
        /HTTP 503/.test(error.message)
    );
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  }
}

void run();
