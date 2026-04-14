import assert from "node:assert/strict";
import { PERSAI_RUNTIME_KNOWLEDGE_EXECUTION_MODES } from "@persai/runtime-contract";
import { buildRuntimeKnowledgeAccessConfig } from "../src/modules/workspace-management/application/runtime-knowledge-access";

async function run(): Promise<void> {
  const knowledgeAccess = buildRuntimeKnowledgeAccessConfig();

  assert.deepEqual(knowledgeAccess, {
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
      },
      {
        source: "chat",
        searchAliasToolCode: null,
        fetchAliasToolCode: null,
        searchCredentialToolCode: null,
        fetchCredentialToolCode: null
      },
      {
        source: "preset",
        searchAliasToolCode: null,
        fetchAliasToolCode: null,
        searchCredentialToolCode: null,
        fetchCredentialToolCode: null
      },
      {
        source: "subscription",
        searchAliasToolCode: null,
        fetchAliasToolCode: null,
        searchCredentialToolCode: null,
        fetchCredentialToolCode: null
      },
      {
        source: "global",
        searchAliasToolCode: null,
        fetchAliasToolCode: null,
        searchCredentialToolCode: null,
        fetchCredentialToolCode: null
      },
      {
        source: "document",
        searchAliasToolCode: null,
        fetchAliasToolCode: null,
        searchCredentialToolCode: null,
        fetchCredentialToolCode: null
      }
    ]
  });
}

void run();
