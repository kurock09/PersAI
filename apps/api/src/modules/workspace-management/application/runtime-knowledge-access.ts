import {
  PERSAI_RUNTIME_KNOWLEDGE_EXECUTION_MODES,
  type RuntimeKnowledgeAccessConfig
} from "@persai/runtime-contract";

export function buildRuntimeKnowledgeAccessConfig(): RuntimeKnowledgeAccessConfig {
  return {
    searchToolCode: "knowledge_search",
    fetchToolCode: "knowledge_fetch",
    executionModes: [...PERSAI_RUNTIME_KNOWLEDGE_EXECUTION_MODES],
    ragMode: "pattern_only",
    sources: [
      {
        source: "web",
        searchAliasToolCode: "web_search",
        fetchAliasToolCode: "web_fetch",
        searchCredentialToolCode: "web_search",
        fetchCredentialToolCode: "web_fetch"
      },
      {
        source: "memory",
        searchAliasToolCode: "memory_search",
        fetchAliasToolCode: "memory_get",
        searchCredentialToolCode: "memory_search",
        fetchCredentialToolCode: null
      }
    ]
  };
}
