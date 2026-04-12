import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES,
  type ProviderGatewayToolDefinition,
  type RuntimeKnowledgeAccessSourceConfig,
  type RuntimeToolPolicy
} from "@persai/runtime-contract";

export interface RuntimeNativeToolProjection {
  tools: ProviderGatewayToolDefinition[];
  knowledgeSearchSources: RuntimeKnowledgeAccessSourceConfig[];
  knowledgeFetchSources: RuntimeKnowledgeAccessSourceConfig[];
}

const WEB_FETCH_MAX_CHARS_CAP = 50_000;
const WEB_SEARCH_MAX_COUNT = 20;

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
  const projectedTools: ProviderGatewayToolDefinition[] = [
    createSummarizeContextToolDefinition(bundle),
    createCompactContextToolDefinition(bundle)
  ];
  const webSearchPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "web_search");
  const webSearchCredential = resolveConfiguredCredentialRef(bundle, "web_search");
  if (
    webSearchPolicy !== null &&
    webSearchCredential !== null &&
    supportsCurrentNativeWebSearchProvider(webSearchCredential.providerId ?? null)
  ) {
    projectedTools.push(createWebSearchToolDefinition());
  }
  const webFetchPolicy = resolveAllowedModelVisibleToolPolicy(bundle, "web_fetch");
  const webFetchCredential = resolveConfiguredCredentialRef(bundle, "web_fetch");
  if (webFetchPolicy !== null && webFetchCredential !== null) {
    projectedTools.push(createWebFetchToolDefinition());
  }

  return {
    tools: projectedTools,
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

function createWebSearchToolDefinition(): ProviderGatewayToolDefinition {
  return {
    name: "web_search",
    description:
      "Search the public web through the currently configured search provider. Use this when you need sources or links about a topic and do not already have one exact URL to fetch.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Search query string."
        },
        count: {
          type: "integer",
          minimum: 1,
          maximum: WEB_SEARCH_MAX_COUNT,
          description: "Maximum number of search results to return."
        }
      }
    }
  };
}

function createWebFetchToolDefinition(): ProviderGatewayToolDefinition {
  return {
    name: "web_fetch",
    description:
      "Fetch and extract the main content of a public webpage through the current web-fetch provider. Use this when you already know the exact URL and need page content, not a search results list.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "HTTP or HTTPS URL to fetch."
        },
        extractMode: {
          type: "string",
          enum: [...PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES],
          description: 'Return content as "markdown" (default) or "text".'
        },
        maxChars: {
          type: "integer",
          minimum: 100,
          maximum: WEB_FETCH_MAX_CHARS_CAP,
          description: "Maximum number of characters to return after extraction."
        }
      }
    }
  };
}

function resolveAllowedModelVisibleToolPolicy(
  bundle: AssistantRuntimeBundle,
  toolCode: string
): RuntimeToolPolicy | null {
  const policy =
    bundle.governance.toolPolicies.find((entry) => entry.toolCode === toolCode) ?? null;
  if (
    policy === null ||
    policy.visibleToModel !== true ||
    policy.enabled !== true ||
    policy.usageRule !== "allowed" ||
    policy.executionMode !== "inline"
  ) {
    return null;
  }
  return policy;
}

function resolveConfiguredCredentialRef(
  bundle: AssistantRuntimeBundle,
  toolCode: string
): AssistantRuntimeBundleToolCredentialRef | null {
  const credential = bundle.governance.toolCredentialRefs[toolCode] ?? null;
  if (credential === null || credential.configured !== true) {
    return null;
  }
  return credential;
}

function supportsCurrentNativeWebSearchProvider(providerId: string | null): boolean {
  return (
    providerId === null ||
    providerId === "tavily" ||
    providerId === "brave" ||
    providerId === "perplexity" ||
    providerId === "google"
  );
}
