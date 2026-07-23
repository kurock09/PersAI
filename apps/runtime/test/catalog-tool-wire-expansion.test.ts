import assert from "node:assert/strict";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { ProviderGatewayToolCall } from "@persai/runtime-contract";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";
import {
  createToolContractNotLoadedPayload,
  shouldGuardCatalogToolExecution
} from "../src/modules/turns/runtime-tool-contract-describe";
import { createEmptyCatalogToolTurnMetrics } from "../src/modules/turns/catalog-tool-turn-metrics";
import {
  buildFullNativeToolDefinition,
  projectRuntimeNativeTools
} from "../src/modules/turns/native-tool-projection";

function buildMinimalCatalogBundle(): AssistantRuntimeBundle {
  return {
    metadata: {
      assistantId: "assistant-catalog",
      workspaceId: "workspace-1"
    },
    runtime: {
      sharedCompaction: {
        summarizeToolCode: "summarize_context",
        compactToolCode: "compact_context"
      },
      knowledgeAccess: { sources: [] },
      workerTools: { tools: [] }
    },
    governance: {
      toolPolicies: [
        {
          toolCode: "summarize_context",
          displayName: "Summarize",
          description: "Summarize context.",
          usageGuidance: null,
          enabled: true,
          usageRule: "allowed",
          visibleToModel: true,
          executionMode: "inline",
          modelExposure: "catalog"
        }
      ],
      toolCredentialRefs: {}
    }
  } as unknown as AssistantRuntimeBundle;
}

function buildMinimalTurnExecutionService(): TurnExecutionService {
  return new TurnExecutionService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never
  );
}

type CatalogTurnState = {
  loadedCatalogToolCodes: Set<string>;
  catalogToolMetrics: ReturnType<typeof createEmptyCatalogToolTurnMetrics>;
};

type CatalogExecutionAccessor = {
  executeProjectedToolCall: (
    execution: {
      bundle: AssistantRuntimeBundle;
      projectedTools: ReturnType<typeof projectRuntimeNativeTools>;
    },
    acceptedTurn: {
      session: {
        sessionId: string;
        conversation: { channel: string; externalThreadKey: string };
      };
      receipt: { requestId: string };
    },
    input: {
      message: { text: string; attachments: [] };
      conversation: { channel: string; externalThreadKey: string };
      idempotencyKey: string;
    },
    toolCall: ProviderGatewayToolCall,
    currentUserMessageId: string | null,
    currentArtifacts: [],
    currentFileHandles: [],
    availableWorkingFileHandles: [],
    turnState: CatalogTurnState
  ) => Promise<{ payload: Record<string, unknown> }>;
};

export async function runCatalogToolWireExpansionTest(): Promise<void> {
  const bundle = buildMinimalCatalogBundle();
  const before = projectRuntimeNativeTools(bundle).tools;
  const beforeJson = JSON.stringify(before);
  const stub = before.find((tool) => tool.name === "summarize_context");
  assert.ok(stub);
  assert.equal(stub.inputSchema.additionalProperties, true);
  assert.equal(
    (stub.inputSchema.properties as Record<string, unknown>).instructions,
    undefined,
    "the provider tool list must retain only the catalog stub"
  );

  const turnState: CatalogTurnState = {
    loadedCatalogToolCodes: new Set<string>(),
    catalogToolMetrics: createEmptyCatalogToolTurnMetrics()
  };
  assert.equal(
    shouldGuardCatalogToolExecution({
      bundle,
      toolCode: "summarize_context",
      arguments: { instructions: "short" },
      loadedCatalogToolCodes: turnState.loadedCatalogToolCodes
    }),
    true
  );

  const service = buildMinimalTurnExecutionService() as unknown as CatalogExecutionAccessor;
  const projection = projectRuntimeNativeTools(bundle);
  const describeOutcome = await service.executeProjectedToolCall(
    { bundle, projectedTools: projection },
    {
      session: {
        sessionId: "session-1",
        conversation: { channel: "web", externalThreadKey: "thread-1" }
      },
      receipt: { requestId: "req-1" }
    },
    {
      message: { text: "summarize", attachments: [] },
      conversation: { channel: "web", externalThreadKey: "thread-1" },
      idempotencyKey: "msg-1"
    },
    {
      id: "tool-describe-1",
      name: "summarize_context",
      arguments: { action: "describe" }
    },
    "msg-1",
    [],
    [],
    [],
    turnState
  );

  assert.equal(describeOutcome.payload.action, "described_contract");
  assert.equal(describeOutcome.payload.toolCode, "summarize_context");
  assert.equal(typeof describeOutcome.payload.description, "string");
  assert.equal(typeof describeOutcome.payload.inputSchema, "object");
  assert.ok(turnState.loadedCatalogToolCodes.has("summarize_context"));
  assert.equal(
    shouldGuardCatalogToolExecution({
      bundle,
      toolCode: "summarize_context",
      arguments: { instructions: "short" },
      loadedCatalogToolCodes: turnState.loadedCatalogToolCodes
    }),
    false
  );

  assert.equal(
    JSON.stringify(projection.tools),
    beforeJson,
    "describe must not mutate providerRequest.tools"
  );
  assert.equal(JSON.stringify(projectRuntimeNativeTools(bundle).tools), beforeJson);
  const full = buildFullNativeToolDefinition(bundle, "summarize_context");
  assert.ok(full);
  assert.notEqual(JSON.stringify(full), JSON.stringify(stub));
  assert.equal(
    createToolContractNotLoadedPayload("summarize_context").reason,
    "tool_contract_not_loaded"
  );
}
