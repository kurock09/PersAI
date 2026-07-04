import assert from "node:assert/strict";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { ProviderGatewayToolCall } from "@persai/runtime-contract";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";
import {
  createToolContractNotLoadedPayload,
  shouldGuardCatalogToolExecution
} from "../src/modules/turns/runtime-tool-contract-describe";
import { projectRuntimeNativeTools } from "../src/modules/turns/native-tool-projection";

function buildMinimalCatalogBundle(toolCode: string): AssistantRuntimeBundle {
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
          toolCode,
          displayName: toolCode,
          description: `${toolCode} tool`,
          usageGuidance: null,
          enabled: true,
          usageRule: "allowed",
          visibleToModel: true,
          executionMode: "inline",
          modelExposure: "catalog"
        },
        {
          toolCode: "web_search",
          displayName: "Web Search",
          description: "Search the web.",
          usageGuidance: null,
          enabled: true,
          usageRule: "allowed",
          visibleToModel: true,
          executionMode: "inline",
          modelExposure: "full"
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
    null as never
  );
}

type CatalogWireExpansionAccessor = {
  refreshTurnProjectedToolsForWireExpansion: (
    execution: {
      bundle: AssistantRuntimeBundle;
      projectedTools: ReturnType<typeof projectRuntimeNativeTools>;
      nativeToolProjectionOptions: Record<string, unknown>;
      providerRequest: { tools?: unknown[] };
    },
    turnState: { wireExpandedCatalogToolCodes: Set<string> }
  ) => void;
  recordCatalogToolWireExpansionFromOutcome: (
    turnState: { wireExpandedCatalogToolCodes: Set<string> },
    outcome: {
      exchange: { toolResult: { isError?: boolean } };
      payload: unknown;
    }
  ) => void;
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
    turnState: { wireExpandedCatalogToolCodes: Set<string> }
  ) => Promise<{ payload: Record<string, unknown> }>;
};

export async function runCatalogToolWireExpansionTest(): Promise<void> {
  const bundle = buildMinimalCatalogBundle("summarize_context");

  assert.equal(
    shouldGuardCatalogToolExecution({
      bundle,
      toolCode: "summarize_context",
      arguments: { instructions: "shorter please" },
      wireExpandedCatalogToolCodes: new Set()
    }),
    true
  );
  assert.equal(
    shouldGuardCatalogToolExecution({
      bundle,
      toolCode: "summarize_context",
      arguments: { action: "describe" },
      wireExpandedCatalogToolCodes: new Set()
    }),
    false
  );
  assert.equal(
    shouldGuardCatalogToolExecution({
      bundle,
      toolCode: "summarize_context",
      arguments: { instructions: "shorter please" },
      wireExpandedCatalogToolCodes: new Set(["summarize_context"])
    }),
    false
  );
  assert.equal(
    shouldGuardCatalogToolExecution({
      bundle,
      toolCode: "web_search",
      arguments: { query: "news" },
      wireExpandedCatalogToolCodes: new Set()
    }),
    false
  );

  const notLoaded = createToolContractNotLoadedPayload("summarize_context");
  assert.equal(notLoaded.reason, "tool_contract_not_loaded");
  assert.match(notLoaded.guidance, /summarize_context\(\{action:"describe"\}\)/);

  const catalogProjection = projectRuntimeNativeTools(bundle);
  const service = buildMinimalTurnExecutionService() as unknown as CatalogWireExpansionAccessor;
  const turnState = { wireExpandedCatalogToolCodes: new Set<string>() };
  const execution = {
    bundle,
    projectedTools: catalogProjection,
    nativeToolProjectionOptions: {},
    providerRequest: { tools: catalogProjection.tools }
  };

  const describeOutcome = await service.executeProjectedToolCall(
    execution,
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
  service.recordCatalogToolWireExpansionFromOutcome(turnState, {
    exchange: { toolResult: { isError: false } },
    payload: describeOutcome.payload
  });
  assert.ok(turnState.wireExpandedCatalogToolCodes.has("summarize_context"));

  service.refreshTurnProjectedToolsForWireExpansion(execution, turnState);
  const expandedTool = execution.projectedTools.tools.find(
    (tool) => tool.name === "summarize_context"
  );
  assert.ok(expandedTool);
  assert.doesNotMatch(expandedTool.description, /Call summarize_context\(\{action:"describe"\}\)/);

  const guardedOutcome = await service.executeProjectedToolCall(
    execution,
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
      id: "tool-summarize-unguarded",
      name: "summarize_context",
      arguments: { instructions: "shorter please" }
    },
    "msg-1",
    [],
    [],
    [],
    { wireExpandedCatalogToolCodes: new Set() }
  );
  assert.equal(guardedOutcome.payload.reason, "tool_contract_not_loaded");
}
