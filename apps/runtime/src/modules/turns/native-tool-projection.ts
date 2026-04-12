import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayToolDefinition,
  RuntimeKnowledgeAccessSourceConfig
} from "@persai/runtime-contract";

export interface RuntimeNativeToolProjection {
  tools: ProviderGatewayToolDefinition[];
  knowledgeSearchSources: RuntimeKnowledgeAccessSourceConfig[];
  knowledgeFetchSources: RuntimeKnowledgeAccessSourceConfig[];
}

export function projectRuntimeNativeTools(
  bundle: AssistantRuntimeBundle,
  options?: { allowModelToolExposure?: boolean }
): RuntimeNativeToolProjection {
  if (options?.allowModelToolExposure === false) {
    return {
      tools: [],
      knowledgeSearchSources: [],
      knowledgeFetchSources: []
    };
  }

  // T15-3a keeps ordinary model-visible knowledge/system-helper families gated off
  // until real PersAI-native executors exist for them.
  return {
    tools: [
      createSummarizeContextToolDefinition(bundle),
      createCompactContextToolDefinition(bundle)
    ],
    knowledgeSearchSources: [],
    knowledgeFetchSources: []
  };
}

function createSummarizeContextToolDefinition(
  bundle: AssistantRuntimeBundle
): ProviderGatewayToolDefinition {
  return {
    name: bundle.runtime.sharedCompaction.summarizeToolCode,
    description:
      "Create a concise shared-context summary for the current session without changing later-turn compaction state. Use when the user explicitly asks to summarize earlier context or when you need a temporary summary to continue reasoning.",
    inputSchema: createCompactionInputSchema()
  };
}

function createCompactContextToolDefinition(
  bundle: AssistantRuntimeBundle
): ProviderGatewayToolDefinition {
  return {
    name: bundle.runtime.sharedCompaction.compactToolCode,
    description:
      "Compress earlier session context into the durable shared compaction state for this conversation. Use when the user explicitly asks to compact/compress context or when context pressure blocks progress.",
    inputSchema: createCompactionInputSchema()
  };
}

function createCompactionInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      instructions: {
        type: "string",
        description: "Optional guidance about what the summary should preserve."
      }
    }
  };
}
