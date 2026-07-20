import assert from "node:assert/strict";
import type {
  ProviderGatewayToolCall,
  ProviderGatewayToolExchange,
  RuntimeFileHandle,
  RuntimeFilesToolResult,
  RuntimeOutputArtifact
} from "@persai/runtime-contract";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

const TEST_SESSION_ROOT = "/workspace/assistants/assistant-handle/sessions/session-id";

function wp(relativePath: string): string {
  return `${TEST_SESSION_ROOT}/${relativePath.replace(/^\/+/, "")}`;
}

type TurnExecutionState = {
  artifacts: RuntimeOutputArtifact[];
  fileHandles: RuntimeFileHandle[];
  toolInvocations: unknown[];
  deferredMediaJobs: unknown[];
  deferredDocumentJobs: unknown[];
  closedOpenLoopRefs: string[];
  sharedCompaction: { invoked: boolean; durableStatePersisted: boolean };
  discoveredFilePathSet: string[];
};

type ToolExecutionOutcomeShape = {
  exchange: ProviderGatewayToolExchange;
  payload: RuntimeFilesToolResult;
  artifacts?: RuntimeOutputArtifact[];
  discoveredFileHandles?: RuntimeFileHandle[];
};

function createTurnState(): TurnExecutionState {
  return {
    artifacts: [],
    fileHandles: [],
    toolInvocations: [],
    deferredMediaJobs: [],
    deferredDocumentJobs: [],
    closedOpenLoopRefs: [],
    sharedCompaction: { invoked: false, durableStatePersisted: false },
    discoveredFilePathSet: []
  };
}

function createFilesSearchExchange(toolCallId: string): ProviderGatewayToolExchange {
  const toolCall: ProviderGatewayToolCall = {
    id: toolCallId,
    name: "files",
    arguments: { action: "list", path: TEST_SESSION_ROOT }
  };
  return {
    toolCall,
    toolResult: {
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: "{}",
      isError: false
    }
  };
}

function createSearchPayload(): RuntimeFilesToolResult {
  return {
    toolCode: "files",
    executionMode: "inline",
    requestedAction: "list",
    action: "listed",
    reason: null,
    warning: null,
    path: TEST_SESSION_ROOT,
    items: []
  };
}

function createDiscoveredFileHandle(input: {
  storagePath: string;
  aliases: string[];
  mimeType?: string;
  displayName?: string | null;
}): RuntimeFileHandle {
  return {
    storagePath: input.storagePath,
    displayName: input.displayName ?? "file.bin",
    mimeType: input.mimeType ?? "application/octet-stream",
    sizeBytes: 64,
    workspaceId: "workspace-1",
    sourceToolCode: "files",
    aliases: input.aliases,
    semanticSummaryHint: null,
    authorLabel: "user"
  };
}

async function run(): Promise<void> {
  const service = Object.create(TurnExecutionService.prototype) as TurnExecutionService;
  Object.defineProperty(service, "logger", {
    value: {
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      verbose: () => undefined
    },
    writable: false
  });

  const apply = (
    service as unknown as {
      applyToolExecutionOutcome: (
        turnState: TurnExecutionState,
        outcome: ToolExecutionOutcomeShape,
        iteration: number
      ) => void;
    }
  ).applyToolExecutionOutcome.bind(service);

  const discoveredPath = wp("persai_logo.png");
  const sharedPath1 = "/workspace.png";
  const sharedPath2 = wp("report.txt");

  {
    const turnState = createTurnState();
    const discovered = createDiscoveredFileHandle({
      storagePath: discoveredPath,
      aliases: ["image #1", "file #1"],
      mimeType: "image/png",
      displayName: "persai_logo.png"
    });
    apply(
      turnState,
      {
        exchange: createFilesSearchExchange("tool-call-search-1"),
        payload: createSearchPayload(),
        discoveredFileHandles: [discovered]
      },
      0
    );
    assert.equal(turnState.fileHandles.length, 1);
    assert.equal(turnState.fileHandles[0]?.storagePath, discoveredPath);
    assert.deepEqual(turnState.fileHandles[0]?.aliases, ["image #1", "file #1"]);
    assert.deepEqual(turnState.discoveredFilePathSet, [discoveredPath]);
  }

  {
    const turnState = createTurnState();
    turnState.fileHandles.push(
      createDiscoveredFileHandle({
        storagePath: sharedPath1,
        aliases: ["file #1", "image #1"],
        mimeType: "image/png",
        displayName: "input.png"
      })
    );
    const discovered = createDiscoveredFileHandle({
      storagePath: sharedPath1,
      aliases: ["image #1", "file #1"],
      mimeType: "image/png",
      displayName: "input.png"
    });
    apply(
      turnState,
      {
        exchange: createFilesSearchExchange("tool-call-search-2"),
        payload: createSearchPayload(),
        discoveredFileHandles: [discovered]
      },
      0
    );
    assert.equal(turnState.fileHandles.length, 1);
    assert.deepEqual(turnState.fileHandles[0]?.aliases, ["file #1", "image #1"]);
  }

  {
    const turnState = createTurnState();
    turnState.fileHandles.push(
      createDiscoveredFileHandle({
        storagePath: sharedPath2,
        aliases: ["file #1"],
        mimeType: "text/plain",
        displayName: "report.txt"
      })
    );
    const discovered = createDiscoveredFileHandle({
      storagePath: sharedPath2,
      aliases: ["FILE #1", "file #2"],
      mimeType: "text/plain",
      displayName: "report.txt"
    });
    apply(
      turnState,
      {
        exchange: createFilesSearchExchange("tool-call-search-3"),
        payload: createSearchPayload(),
        discoveredFileHandles: [discovered]
      },
      0
    );
    assert.equal(turnState.fileHandles.length, 1);
    assert.deepEqual(turnState.fileHandles[0]?.aliases, ["file #1", "file #2"]);
  }

  {
    const turnState = createTurnState();
    apply(
      turnState,
      {
        exchange: createFilesSearchExchange("tool-call-search-4"),
        payload: createSearchPayload()
      },
      0
    );
    assert.equal(turnState.fileHandles.length, 0);

    apply(
      turnState,
      {
        exchange: createFilesSearchExchange("tool-call-search-4b"),
        payload: createSearchPayload(),
        discoveredFileHandles: []
      },
      0
    );
    assert.equal(turnState.fileHandles.length, 0);
  }
}

void run();
