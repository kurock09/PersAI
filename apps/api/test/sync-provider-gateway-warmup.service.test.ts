import assert from "node:assert/strict";
import type { AssistantMaterializedSpec } from "../src/modules/workspace-management/domain/assistant-materialized-spec.entity";
import { AssistantRuntimeError } from "../src/modules/workspace-management/application/assistant-runtime.facade";
import { SyncProviderGatewayWarmupService } from "../src/modules/workspace-management/application/sync-provider-gateway-warmup.service";

function createMaterializedSpec(): AssistantMaterializedSpec {
  return {
    id: "spec-1",
    assistantId: "assistant-1",
    publishedVersionId: "version-1",
    sourceAction: "publish",
    algorithmVersion: 1,
    materializedAtConfigGeneration: 1,
    layers: {
      layers: {
        governance: {
          runtimeProviderProfile: {
            availableModelsByProvider: {
              openai: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4"],
              anthropic: ["claude-sonnet-4-5"]
            }
          }
        }
      }
    },
    runtimeBundle: null,
    openclawBootstrap: {},
    openclawWorkspace: {},
    layersDocument: "{}",
    runtimeBundleDocument: null,
    runtimeBundleHash: null,
    openclawBootstrapDocument: "{}",
    openclawWorkspaceDocument: "{}",
    contentHash: "content-hash-1",
    createdAt: new Date("2026-04-11T12:30:00.000Z")
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
    delete process.env.PERSAI_PROVIDER_GATEWAY_BASE_URL;

    const service = new SyncProviderGatewayWarmupService();
    const skipped = await service.execute({
      materializedSpec: createMaterializedSpec()
    });
    assert.equal(skipped, "skipped_unconfigured");

    const calls: Array<{ url: string; body: unknown }> = [];
    process.env.PERSAI_PROVIDER_GATEWAY_BASE_URL = "http://provider-gateway.internal:3011";
    process.env.PERSAI_PROVIDER_GATEWAY_WARMUP_TIMEOUT_MS = "1500";
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
      materializedSpec: createMaterializedSpec()
    });
    assert.equal(warmed, "warmed");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "http://provider-gateway.internal:3011/api/v1/providers/warmup");
    assert.deepEqual(calls[0]?.body, {
      schema: "persai.providerGatewayWarmupRequest.v1",
      source: "control_plane_apply",
      availableModelsByProvider: {
        openai: ["gpt-5.4", "gpt-5.4-mini"],
        anthropic: ["claude-sonnet-4-5"]
      }
    });

    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 503
      } as Response;
    }) as typeof fetch;

    await assert.rejects(
      service.execute({
        materializedSpec: createMaterializedSpec()
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
