import assert from "node:assert/strict";
import {
  PERSAI_RUNTIME_BROWSER_ACTIONS,
  PERSAI_RUNTIME_BROWSER_PROVIDER_IDS
} from "@persai/runtime-contract";
import { buildRuntimeBrowserConfig } from "../src/modules/workspace-management/application/runtime-browser";

async function run(): Promise<void> {
  const browser = buildRuntimeBrowserConfig();

  assert.deepEqual(browser, {
    toolCode: "browser",
    executionMode: "worker",
    credentialToolCode: "browser",
    providerIds: [...PERSAI_RUNTIME_BROWSER_PROVIDER_IDS],
    defaultProviderId: "browserless",
    actions: [...PERSAI_RUNTIME_BROWSER_ACTIONS],
    confirmationRequiredActions: ["act"]
  });
}

void run();
