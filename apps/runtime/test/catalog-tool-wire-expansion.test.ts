import assert from "node:assert/strict";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type { ProviderGatewayToolCall } from "@persai/runtime-contract";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";
import {
  createToolContractNotLoadedPayload,
  markCatalogToolWireExpandedForTurn,
  shouldGuardCatalogToolExecution
} from "../src/modules/turns/runtime-tool-contract-describe";
import { createEmptyCatalogToolTurnMetrics } from "../src/modules/turns/catalog-tool-turn-metrics";
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

type CatalogTurnState = {
  wireExpandedCatalogToolCodes: Set<string>;
  catalogToolMetrics: ReturnType<typeof createEmptyCatalogToolTurnMetrics>;
};

type CatalogWireExpansionAccessor = {
  refreshTurnProjectedToolsForWireExpansion: (
    execution: {
      bundle: AssistantRuntimeBundle;
      projectedTools: ReturnType<typeof projectRuntimeNativeTools>;
      nativeToolProjectionOptions: Record<string, unknown>;
      providerRequest: { tools?: unknown[] };
    },
    turnState: CatalogTurnState
  ) => void;
  recordCatalogToolWireExpansionFromOutcome: (
    turnState: CatalogTurnState,
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
    turnState: CatalogTurnState
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
  const turnState = {
    wireExpandedCatalogToolCodes: new Set<string>(),
    catalogToolMetrics: createEmptyCatalogToolTurnMetrics()
  };
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
    {
      wireExpandedCatalogToolCodes: new Set(),
      catalogToolMetrics: createEmptyCatalogToolTurnMetrics()
    }
  );
  assert.equal(guardedOutcome.payload.reason, "tool_contract_not_loaded");

  const filesBundle = buildMinimalCatalogBundle("files");
  const filesProjection = projectRuntimeNativeTools(filesBundle);
  const filesExecution = {
    bundle: filesBundle,
    projectedTools: filesProjection,
    nativeToolProjectionOptions: {},
    providerRequest: { tools: filesProjection.tools }
  };
  const filesDescribeOutcome = await service.executeProjectedToolCall(
    filesExecution,
    {
      session: {
        sessionId: "session-files",
        conversation: { channel: "web", externalThreadKey: "thread-files" }
      },
      receipt: { requestId: "req-files" }
    },
    {
      message: { text: "list files", attachments: [] },
      conversation: { channel: "web", externalThreadKey: "thread-files" },
      idempotencyKey: "msg-files"
    },
    {
      id: "tool-files-describe",
      name: "files",
      arguments: { action: "describe" }
    },
    "msg-files",
    [],
    [],
    [],
    {
      wireExpandedCatalogToolCodes: new Set(),
      catalogToolMetrics: createEmptyCatalogToolTurnMetrics()
    }
  );
  assert.equal(
    filesDescribeOutcome.payload.action,
    "described_contract",
    "catalog-tier full-default tools must dispatch describe before tool-specific services"
  );
  assert.equal(filesDescribeOutcome.payload.toolCode, "files");

  const videoService =
    buildMinimalTurnExecutionService() as unknown as CatalogWireExpansionAccessor;
  const videoTurnState = {
    wireExpandedCatalogToolCodes: new Set<string>(),
    catalogToolMetrics: createEmptyCatalogToolTurnMetrics()
  };
  videoService.recordCatalogToolWireExpansionFromOutcome(videoTurnState, {
    exchange: { toolResult: { isError: false } },
    payload: {
      toolCode: "video_generate",
      action: "listed_personas",
      personas: []
    }
  });
  assert.ok(
    videoTurnState.wireExpandedCatalogToolCodes.has("video_generate"),
    "video read-only lookups should expand catalog wire for the rest of the turn"
  );

  const videoTurnStateAfterFailure = {
    wireExpandedCatalogToolCodes: new Set(["video_generate"]),
    catalogToolMetrics: createEmptyCatalogToolTurnMetrics()
  };
  videoService.recordCatalogToolWireExpansionFromOutcome(videoTurnStateAfterFailure, {
    exchange: { toolResult: { isError: true } },
    payload: {
      toolCode: "video_generate",
      action: "skipped",
      reason: "video_generation_failed"
    }
  });
  assert.ok(
    videoTurnStateAfterFailure.wireExpandedCatalogToolCodes.has("video_generate"),
    "provider failures must not clear turn-local catalog wire expansion"
  );

  const persistBundle = buildMinimalCatalogBundle("summarize_context");
  const persistTurnState = {
    wireExpandedCatalogToolCodes: new Set<string>(),
    catalogToolMetrics: createEmptyCatalogToolTurnMetrics()
  };
  assert.equal(
    markCatalogToolWireExpandedForTurn(
      persistBundle,
      "summarize_context",
      persistTurnState.wireExpandedCatalogToolCodes
    ),
    true
  );
  assert.equal(
    markCatalogToolWireExpandedForTurn(
      persistBundle,
      "summarize_context",
      persistTurnState.wireExpandedCatalogToolCodes
    ),
    false,
    "re-marking the same catalog tool in the same turn is a no-op"
  );
  const persistedProjection = projectRuntimeNativeTools(persistBundle, {
    wireExpandedCatalogToolCodes: persistTurnState.wireExpandedCatalogToolCodes
  });
  const persistedTool = persistedProjection.tools.find((tool) => tool.name === "summarize_context");
  assert.ok(persistedTool);
  assert.doesNotMatch(persistedTool.description, /Call summarize_context\(\{action:"describe"\}\)/);
}
