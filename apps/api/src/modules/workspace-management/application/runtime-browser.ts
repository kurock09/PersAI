import {
  PERSAI_RUNTIME_BROWSER_ACTIONS,
  PERSAI_RUNTIME_BROWSER_PROVIDER_IDS,
  type RuntimeBrowserConfig
} from "@persai/runtime-contract";

const CONFIRMATION_REQUIRED_ACTIONS: RuntimeBrowserConfig["confirmationRequiredActions"] = ["act"];

export function buildRuntimeBrowserConfig(): RuntimeBrowserConfig {
  return {
    toolCode: "browser",
    executionMode: "worker",
    credentialToolCode: "browser",
    providerIds: [...PERSAI_RUNTIME_BROWSER_PROVIDER_IDS],
    defaultProviderId: "browserless",
    actions: [...PERSAI_RUNTIME_BROWSER_ACTIONS],
    confirmationRequiredActions: [...CONFIRMATION_REQUIRED_ACTIONS]
  };
}
