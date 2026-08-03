import assert from "node:assert/strict";
import type { RuntimeOutputArtifact, TurnEventDraft } from "@persai/runtime-contract";
import { TurnExecutionService } from "../src/modules/turns/turn-execution.service";

/**
 * ADR-170 S1 — turn event emission tests.
 *
 * Exercises the private emission points directly (the same technique used by
 * `runRecentPdfsHintTests` above via an accessor cast) on a realistic
 * multi-iteration turn: a narration note, a tool call, an accepted async
 * job, a synchronous in-loop artifact, and the final answer. Asserts the
 * drafts are accumulated in the order the underlying facts occurred, that
 * each is a distinct event (no merging of unrelated kinds), that a
 * whitespace-only step produces no `note` event, that no draft carries an
 * `iteration` field (the loop counter is deliberately not part of the
 * ADR-170 D2 vocabulary), and — per ADR-170 D2.1 — that the runtime emits NO
 * `delivery` event for a synchronous in-loop artifact: `delivery` is
 * appended exclusively by the server-side append primitive, at the moment
 * the durable attachment row is created, so a runtime-emitted `delivery`
 * carrying only a non-durable artifact id must never reappear.
 */

type TurnEventEmissionAccessor = {
  createTurnExecutionState(): { turnEvents: TurnEventDraft[] } & Record<string, unknown>;
  recordNoteTurnEvent(
    turnState: unknown,
    bodySlice: string,
    visibleStepText: string
  ): TurnEventDraft | null;
  mergeAssistantTurnText(existingText: string, nextText: string | null): string;
  applyToolExecutionOutcome(turnState: unknown, outcome: unknown, iteration: number): void;
  createAsyncJobAcceptedStreamEvent(
    turnState: unknown,
    acceptedTurn: unknown,
    outcome: unknown
  ): { type: "async_job_accepted"; kind: string; jobRef: string } | null;
  buildTurnResult(
    acceptedTurn: unknown,
    providerResult: unknown,
    turnState: unknown,
    routeDecision?: unknown,
    trace?: unknown
  ): { assistantText: string; turnEvents?: TurnEventDraft[] };
};

function buildMinimalTurnExecutionServiceForEvents(): TurnExecutionService {
  return new TurnExecutionService(
    null as never, // runtimeBundleRegistryService
    null as never, // providerGatewayClientService
    null as never, // persaiInternalApiClientService
    null as never, // runtimeBundleAutoRefreshService
    null as never, // turnContextHydrationService
    null as never, // turnAcceptanceService
    null as never, // turnRoutingService
    null as never, // turnFinalizationService
    null as never, // turnLeaseHeartbeatService
    null as never, // sessionCompactionService
    null as never, // runtimeBrowserToolService
    null as never, // runtimeDocumentToolService
    null as never, // runtimeFilesToolService
    null as never, // runtimeImageEditToolService
    null as never, // runtimeImageGenerateToolService
    null as never, // runtimeKnowledgeToolService
    null as never, // runtimeMemoryWriteToolService
    null as never, // runtimeTodoWriteToolService
    null as never, // runtimeQuotaStatusToolService
    null as never, // runtimeSandboxToolService
    null as never, // runtimeScriptToolService
    null as never, // runtimeGrepGlobToolService
    null as never, // runtimeBackgroundTaskToolService
    null as never, // runtimeScheduledActionToolService
    null as never, // runtimeTtsToolService
    null as never, // runtimeVideoGenerateToolService
    null as never, // runtimeSkillToolService
    null as never, // buildActiveScenarioBlockService
    null as never, // buildSystemReminderBlocksService
    null as never, // runtimeObservabilityService
    null as never, // runtimeExecutionAdmissionService
    null as never, // runtimeAwaitToolService
    null as never, // mediaObjectStorage
    null as never, // storagePlaneFilesService
    null as never // runtimeEmailSendToolService
  );
}

function buildToolExecutionOutcomeFixture(input: {
  toolCallId: string;
  name: string;
  payload: unknown;
  artifacts?: RuntimeOutputArtifact[];
}): unknown {
  return {
    exchange: {
      toolCall: { id: input.toolCallId, name: input.name, arguments: {} },
      toolResult: {
        toolCallId: input.toolCallId,
        name: input.name,
        content: JSON.stringify(input.payload),
        isError: false
      }
    },
    payload: input.payload,
    ...(input.artifacts === undefined ? {} : { artifacts: input.artifacts })
  };
}

export async function runTurnEventEmissionTest(): Promise<void> {
  const service = buildMinimalTurnExecutionServiceForEvents();
  const accessor = service as unknown as TurnEventEmissionAccessor;
  const turnState = accessor.createTurnExecutionState();

  const acceptedTurn = {
    receipt: { requestId: "req-event-1" },
    session: { sessionId: "sess-event-1" }
  };

  // ── Whitespace-only step text produces no `note` event ──
  const whitespaceNote = accessor.recordNoteTurnEvent(turnState, "", "   \n\t  ");
  assert.equal(whitespaceNote, null, "whitespace-only step text must not produce a note draft");
  assert.equal(
    turnState.turnEvents.length,
    0,
    "no event may be accumulated for whitespace-only text"
  );

  // ── Fact 1: a pre-tool narration note ──
  const noteDraft = accessor.recordNoteTurnEvent(
    turnState,
    "Let me check that file for you.",
    "Let me check that file for you."
  );
  assert.notEqual(noteDraft, null);
  assert.equal(turnState.turnEvents.length, 1);
  assert.equal(turnState.turnEvents[0]?.kind, "note");

  // ── Fact 2: a tool call completes (files lookup, unrelated to delivery/job) ──
  accessor.applyToolExecutionOutcome(
    turnState,
    buildToolExecutionOutcomeFixture({ toolCallId: "call-files-1", name: "files", payload: {} }),
    0
  );
  assert.equal(turnState.turnEvents.length, 2);
  assert.equal(turnState.turnEvents[1]?.kind, "tool_call");

  // ── Fact 3: an async media job is accepted (its own preceding tool_call,
  // then the job_accepted draft), mirroring the production call order in
  // `streamAcceptedTurn`: `applyToolExecutionOutcome` first, then
  // `createAsyncJobAcceptedStreamEvent` for the same outcome. ──
  const jobOutcome = buildToolExecutionOutcomeFixture({
    toolCallId: "call-image-1",
    name: "image_generate",
    payload: {
      toolCode: "image_generate",
      action: "pending_delivery",
      jobRef: "job-ref-abc",
      jobId: "img-job-1"
    }
  });
  accessor.applyToolExecutionOutcome(turnState, jobOutcome, 1);
  assert.equal(turnState.turnEvents.length, 3);
  assert.equal(turnState.turnEvents[2]?.kind, "tool_call");

  const jobAcceptedStreamEvent = accessor.createAsyncJobAcceptedStreamEvent(
    turnState,
    acceptedTurn,
    jobOutcome
  );
  assert.notEqual(jobAcceptedStreamEvent, null, "a pending_delivery image job must be accepted");
  assert.equal(turnState.turnEvents.length, 4);
  assert.equal(turnState.turnEvents[3]?.kind, "job_accepted");

  // ── ADR-170 D2.1 regression guard: a synchronous in-loop artifact must
  // produce ONLY the ordinary `tool_call` draft (from the same
  // `applyToolExecutionOutcome` call that recorded it) and NO `delivery`
  // draft. The runtime has no durable chat attachment id at this point —
  // only the artifact's own non-durable `artifactId` — so a future change
  // must not quietly reintroduce a runtime-side `delivery` here; `delivery`
  // is appended exclusively by the server-side append primitive, at
  // attachment-row creation. ──
  const deliveredArtifact: RuntimeOutputArtifact = {
    artifactId: "artifact-1",
    storagePath: "assistant-media/generated/cat.png",
    kind: "image",
    sourceToolCode: "image_generate",
    mimeType: "image/png",
    filename: "cat.png",
    sizeBytes: 4096,
    voiceNote: false
  };
  accessor.applyToolExecutionOutcome(
    turnState,
    buildToolExecutionOutcomeFixture({
      toolCallId: "call-image-2",
      name: "image_generate",
      payload: {},
      artifacts: [deliveredArtifact]
    }),
    1
  );
  assert.equal(
    turnState.turnEvents.length,
    5,
    "a synchronous artifact must add exactly one draft (its tool_call), never a delivery"
  );
  assert.equal(turnState.turnEvents[4]?.kind, "tool_call");
  assert.equal(
    turnState.turnEvents.some((event) => event.kind === "delivery"),
    false,
    "ADR-170 D2.1 — the runtime must never emit a delivery draft"
  );

  // ── Fact 5: the final answer resolves via `buildTurnResult` ──
  const providerResult = {
    provider: "openai",
    model: "gpt-5.4",
    text: "Here is the cat picture you asked for.",
    respondedAt: "2026-08-02T00:00:00.000Z",
    usage: null,
    textUsage: { status: "usage_unavailable", reason: "test_fixture" },
    stopReason: "completed",
    toolCalls: []
  };
  const result = accessor.buildTurnResult(acceptedTurn, providerResult, turnState);
  assert.equal(turnState.turnEvents.length, 6);
  assert.equal(turnState.turnEvents[5]?.kind, "answer_text");
  const answerDraft = turnState.turnEvents[5];
  if (answerDraft?.kind === "answer_text") {
    assert.equal(answerDraft.text, "Here is the cat picture you asked for.");
  }

  // ── `RuntimeTurnResult.turnEvents` carries every accumulated draft, in
  // the exact same emission order, and `buildTurnResult` returned the same
  // ordered array `turnState` accumulated. Still no `delivery` anywhere. ──
  assert.deepEqual(result.turnEvents, turnState.turnEvents);
  assert.deepEqual(
    result.turnEvents?.map((event) => event.kind),
    ["note", "tool_call", "tool_call", "job_accepted", "tool_call", "answer_text"],
    "drafts must appear in the order the underlying facts occurred, with no delivery draft"
  );

  // ── No draft ever carries an `iteration` field: the loop counter passed
  // to `applyToolExecutionOutcome` (0, 1, 1 above) must never leak onto the
  // ADR-170 D2 vocabulary, even though the sibling `toolInvocations` entry
  // does carry one. ──
  for (const event of turnState.turnEvents) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(event, "iteration"),
      false,
      `turn event of kind "${event.kind}" must not carry an "iteration" field`
    );
  }

  // D5.4 acceptance: both sides come from the runtime in this run. Provider
  // segments are merged by its production assembly, then its emission points
  // produce the durable text drafts; no expected body is fixture-authored.
  const d54State = accessor.createTurnExecutionState();
  let assembled = "";
  for (const [index, segment] of ["First narration.", "Second narration."].entries()) {
    const before = assembled;
    assembled = accessor.mergeAssistantTurnText(assembled, segment);
    accessor.recordNoteTurnEvent(d54State, assembled.slice(before.length), segment);
    accessor.applyToolExecutionOutcome(
      d54State,
      buildToolExecutionOutcomeFixture({
        toolCallId: `d54-tool-${String(index)}`,
        name: "web_search",
        payload: {}
      }),
      index
    );
  }
  const finalBefore = assembled;
  assembled = accessor.mergeAssistantTurnText(assembled, "Final answer.");
  const d54Result = accessor.buildTurnResult(
    acceptedTurn,
    { ...providerResult, text: assembled },
    d54State
  );
  const emittedText = (d54Result.turnEvents ?? [])
    .filter((event) => event.kind === "note" || event.kind === "answer_text")
    .map((event) => (event as { text: string }).text)
    .join("");
  assert.equal(emittedText, d54Result.assistantText);
  assert.equal(finalBefore.length > 0, true);
}
