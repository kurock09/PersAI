import type {
  RuntimeToolPolicy,
  RuntimeWorkerToolConfig,
  RuntimeWorkerToolsConfig
} from "@persai/runtime-contract";

const WORKER_TOOL_BASELINES: Record<string, Omit<RuntimeWorkerToolConfig, "toolCode">> = {
  browser: {
    family: "browser_interaction",
    outcomeKind: "structured_output",
    timeoutMs: 45_000,
    confirmationRule: "required_for_mutations",
    supportsProviderRouting: true,
    failureBehavior: "surface_error"
  },
  image_generate: {
    family: "media_generation",
    outcomeKind: "artifact_refs",
    timeoutMs: 300_000,
    confirmationRule: "none",
    supportsProviderRouting: true,
    failureBehavior: "surface_error"
  },
  image_edit: {
    family: "media_generation",
    outcomeKind: "artifact_refs",
    timeoutMs: 300_000,
    confirmationRule: "none",
    supportsProviderRouting: true,
    failureBehavior: "surface_error"
  },
  document: {
    family: "media_generation",
    outcomeKind: "artifact_refs",
    timeoutMs: 300_000,
    confirmationRule: "none",
    supportsProviderRouting: true,
    failureBehavior: "surface_error"
  },
  presentation: {
    family: "media_generation",
    outcomeKind: "artifact_refs",
    timeoutMs: 300_000,
    confirmationRule: "none",
    supportsProviderRouting: true,
    failureBehavior: "surface_error"
  },
  video_generate: {
    family: "media_generation",
    outcomeKind: "artifact_refs",
    timeoutMs: 600_000,
    confirmationRule: "none",
    supportsProviderRouting: true,
    failureBehavior: "surface_error"
  },
  tts: {
    family: "media_generation",
    outcomeKind: "artifact_refs",
    timeoutMs: 60_000,
    confirmationRule: "none",
    supportsProviderRouting: true,
    failureBehavior: "surface_error"
  },
  scheduled_action: {
    family: "scheduled_action",
    outcomeKind: "state_mutation",
    timeoutMs: 30_000,
    confirmationRule: "required_for_mutations",
    supportsProviderRouting: false,
    failureBehavior: "retry_then_surface_error"
  },
  background_task: {
    family: "background_task",
    outcomeKind: "state_mutation",
    timeoutMs: 30_000,
    confirmationRule: "required_for_mutations",
    supportsProviderRouting: false,
    failureBehavior: "retry_then_surface_error"
  },
  cron: {
    family: "internal_scheduler",
    outcomeKind: "state_mutation",
    timeoutMs: 30_000,
    confirmationRule: "none",
    supportsProviderRouting: false,
    failureBehavior: "retry_then_surface_error"
  }
};

export function buildRuntimeWorkerToolsConfig(
  toolPolicies: RuntimeToolPolicy[]
): RuntimeWorkerToolsConfig {
  return {
    tools: toolPolicies
      .filter((tool) => tool.executionMode === "worker")
      .map((tool) => {
        const baseline = WORKER_TOOL_BASELINES[tool.toolCode];
        if (!baseline) {
          throw new Error(`Missing explicit runtime worker-tool baseline for "${tool.toolCode}".`);
        }
        return {
          toolCode: tool.toolCode,
          ...baseline
        };
      })
  };
}
