import assert from "node:assert/strict";
import type {
  ProviderGatewayToolCall,
  ProviderGatewayToolExchange,
  RuntimeFileRef,
  RuntimeFilesToolResult,
  RuntimeOutputArtifact
} from "@persai/runtime-contract";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

// ADR-100 follow-up — Fix A. The files tool now surfaces registry-resolved
// `discoveredFileRefs` on its execution outcome. The runtime caller has to
// merge those into `turnState.fileRefs` so the next provider iteration's
// Working Files developer block carries the stable sticky labels (`file #N`,
// `image #N`). This focused test exercises the private
// `applyToolExecutionOutcome` merge directly (constructed against a mostly
// empty service shell, since the merge has no dependency surface).

type TurnExecutionState = {
  artifacts: RuntimeOutputArtifact[];
  fileRefs: RuntimeFileRef[];
  usageEntries: unknown[];
  toolInvocations: unknown[];
  deferredMediaJobs: unknown[];
  deferredDocumentJobs: unknown[];
  closedOpenLoopRefs: string[];
  sharedCompaction: { invoked: boolean; durableStatePersisted: boolean };
  /** ADR-100 Piece 1 — canonical ids of files discovered via the files tool this turn. */
  discoveredFileRefIdSet: string[];
};

type ToolExecutionOutcomeShape = {
  exchange: ProviderGatewayToolExchange;
  payload: RuntimeFilesToolResult;
  artifacts?: RuntimeOutputArtifact[];
  discoveredFileRefs?: RuntimeFileRef[];
};

function createTurnState(): TurnExecutionState {
  return {
    artifacts: [],
    fileRefs: [],
    usageEntries: [],
    toolInvocations: [],
    deferredMediaJobs: [],
    deferredDocumentJobs: [],
    closedOpenLoopRefs: [],
    sharedCompaction: { invoked: false, durableStatePersisted: false },
    discoveredFileRefIdSet: []
  };
}

function createFilesSearchExchange(toolCallId: string): ProviderGatewayToolExchange {
  const toolCall: ProviderGatewayToolCall = {
    id: toolCallId,
    name: "files",
    arguments: { action: "search", query: "report" }
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
    requestedAction: "search",
    action: "results",
    reason: null,
    warning: null,
    item: null,
    items: [],
    content: null,
    job: null,
    fileRefs: [],
    queuedArtifacts: 0
  };
}

function createDiscoveredFileRef(input: {
  fileRef: string;
  aliases: string[];
  mimeType?: string;
  displayName?: string | null;
}): RuntimeFileRef {
  return {
    fileRef: input.fileRef,
    origin: "uploaded_attachment",
    sourceToolCode: "files",
    objectKey: `assistant-media/uploads/${input.fileRef}/file.bin`,
    relativePath: `uploads/${input.fileRef}/file.bin`,
    displayName: input.displayName ?? "file.bin",
    mimeType: input.mimeType ?? "application/octet-stream",
    sizeBytes: 64,
    logicalSizeBytes: 64,
    aliases: input.aliases,
    semanticSummaryHint: null
  };
}

async function run(): Promise<void> {
  // We construct a TurnExecutionService instance with no dependencies — the
  // merge code path under test never touches them. Using `Object.create`
  // bypasses the constructor parameter list while preserving the prototype
  // so private methods on the prototype remain callable.
  const service = Object.create(TurnExecutionService.prototype) as TurnExecutionService;
  // The merge body calls a few helpers. Patch a logger placeholder to keep
  // the structure honest if any code path attempts to read it.
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

  // Case 1: discoveredFileRefs on a fresh turnState pushes the ref as-is.
  {
    const turnState = createTurnState();
    const discovered = createDiscoveredFileRef({
      fileRef: "file-ref-discovered-1",
      aliases: ["image #1", "file #1"],
      mimeType: "image/png",
      displayName: "persai_logo.png"
    });
    apply(
      turnState,
      {
        exchange: createFilesSearchExchange("tool-call-search-1"),
        payload: createSearchPayload(),
        discoveredFileRefs: [discovered]
      },
      0
    );
    assert.equal(
      turnState.fileRefs.length,
      1,
      "discoveredFileRefs on fresh turnState pushes a new entry"
    );
    assert.equal(turnState.fileRefs[0]?.fileRef, "file-ref-discovered-1");
    assert.deepEqual(
      turnState.fileRefs[0]?.aliases,
      ["image #1", "file #1"],
      "discoveredFileRefs aliases survive the merge"
    );
    // ADR-100 Piece 1 — fileRef id must also be tracked in discoveredFileRefIdSet.
    assert.deepEqual(
      turnState.discoveredFileRefIdSet,
      ["file-ref-discovered-1"],
      "discoveredFileRefIdSet must be populated with the discovered fileRef id"
    );
  }

  // Case 2: a second discovery for the same fileRef merges aliases instead
  // of duplicating the entry, preserving the existing aliases too.
  {
    const turnState = createTurnState();
    turnState.fileRefs.push(
      createDiscoveredFileRef({
        fileRef: "file-ref-shared-1",
        aliases: ["file #1", "image #1"],
        mimeType: "image/png",
        displayName: "input.png"
      })
    );
    const discovered = createDiscoveredFileRef({
      fileRef: "file-ref-shared-1",
      aliases: ["image #1", "file #1"],
      mimeType: "image/png",
      displayName: "input.png"
    });
    apply(
      turnState,
      {
        exchange: createFilesSearchExchange("tool-call-search-2"),
        payload: createSearchPayload(),
        discoveredFileRefs: [discovered]
      },
      0
    );
    assert.equal(
      turnState.fileRefs.length,
      1,
      "second discovery for the same fileRef must not duplicate the entry"
    );
    assert.deepEqual(
      turnState.fileRefs[0]?.aliases,
      ["file #1", "image #1"],
      "second discovery merges aliases case-insensitively without losing existing markers"
    );
  }

  // Case 3: a third discovery that repeats the same alias on the same
  // fileRef must dedupe without growing the alias list.
  {
    const turnState = createTurnState();
    turnState.fileRefs.push(
      createDiscoveredFileRef({
        fileRef: "file-ref-shared-2",
        aliases: ["file #1"],
        mimeType: "text/plain",
        displayName: "report.txt"
      })
    );
    const discovered = createDiscoveredFileRef({
      fileRef: "file-ref-shared-2",
      aliases: ["FILE #1", "file #2"],
      mimeType: "text/plain",
      displayName: "report.txt"
    });
    apply(
      turnState,
      {
        exchange: createFilesSearchExchange("tool-call-search-3"),
        payload: createSearchPayload(),
        discoveredFileRefs: [discovered]
      },
      0
    );
    assert.equal(turnState.fileRefs.length, 1);
    assert.deepEqual(
      turnState.fileRefs[0]?.aliases,
      ["file #1", "file #2"],
      "case-insensitive dedupe keeps the first-seen alias casing and adds only new aliases"
    );
  }

  // Case 4: empty / undefined discoveredFileRefs is a no-op.
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
    assert.equal(turnState.fileRefs.length, 0);

    apply(
      turnState,
      {
        exchange: createFilesSearchExchange("tool-call-search-4b"),
        payload: createSearchPayload(),
        discoveredFileRefs: []
      },
      0
    );
    assert.equal(turnState.fileRefs.length, 0);
  }
}

void run();
