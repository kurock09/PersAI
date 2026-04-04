import assert from "node:assert/strict";
import { resolveRuntimeBaseUrl } from "../src/modules/workspace-management/application/runtime-endpoint-routing";

async function run(): Promise<void> {
  const config = {
    tierBaseUrls: {
      free_shared_restricted: "http://openclaw-free:18789",
      paid_shared_restricted: "http://openclaw-paid-shared:18789",
      paid_isolated: "http://openclaw-paid-isolated:18789"
    }
  } as const;

  assert.deepEqual(
    resolveRuntimeBaseUrl({
      config,
      runtimeTier: "free_shared_restricted"
    }),
    {
      baseUrl: "http://openclaw-free:18789",
      resolvedTier: "free_shared_restricted",
      source: "tier_specific"
    }
  );

  assert.deepEqual(
    resolveRuntimeBaseUrl({
      config,
      runtimeTier: "paid_shared_restricted"
    }),
    {
      baseUrl: "http://openclaw-paid-shared:18789",
      resolvedTier: "paid_shared_restricted",
      source: "tier_specific"
    }
  );

  assert.deepEqual(
    resolveRuntimeBaseUrl({
      config,
      runtimeTier: undefined
    }),
    {
      baseUrl: "http://openclaw-free:18789",
      resolvedTier: "free_shared_restricted",
      source: "platform_default"
    }
  );
}

void run();
