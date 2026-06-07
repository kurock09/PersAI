import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { AssistantMemoryRegistryItem } from "../src/modules/workspace-management/domain/assistant-memory-registry-item.entity";
import type { AssistantMemoryRegistryRepository } from "../src/modules/workspace-management/domain/assistant-memory-registry.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";
import { CloseMostSimilarOpenLoopService } from "../src/modules/workspace-management/application/close-most-similar-open-loop.service";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";

function buildAssistant(overrides: Partial<Assistant> = {}): Assistant {
  const now = new Date("2026-04-22T00:00:00.000Z");
  return {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    draftDisplayName: null,
    draftInstructions: null,
    draftTraits: null,
    draftAvatarEmoji: null,
    draftAvatarUrl: null,
    draftAssistantGender: null,
    draftVoiceProfile: null,
    draftArchetypeKey: null,
    draftUpdatedAt: null,
    applyStatus: "succeeded",
    applyTargetVersionId: null,
    applyAppliedVersionId: null,
    applyRequestedAt: null,
    applyStartedAt: null,
    applyFinishedAt: null,
    applyErrorCode: null,
    applyErrorMessage: null,
    configDirtyAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function buildOpenLoop(
  overrides: Partial<AssistantMemoryRegistryItem>
): AssistantMemoryRegistryItem {
  return {
    id: "loop-1",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: null,
    relatedUserMessageId: null,
    relatedAssistantMessageId: null,
    summary: "Pick a venue for the retreat",
    sourceType: "memory_write",
    sourceLabel: "Memory write: open loop",
    memoryClass: "core",
    kind: "open_loop",
    durability: "episodic",
    stability: "time_bound",
    confidence: null,
    lastUsedAt: null,
    resolvedAt: null,
    forgottenAt: null,
    supersededAt: null,
    supersededByMemoryId: null,
    createdAt: new Date("2026-04-21T00:00:00.000Z"),
    ...overrides
  };
}

function createHarness(options?: {
  assistant?: Assistant | null;
  candidate?: AssistantMemoryRegistryItem | null;
  setResolvedReturns?: boolean;
}) {
  const findCalls: Array<{ assistantId: string; userId: string; referenceText: string }> = [];
  const setCalls: Array<{ id: string; assistantId: string }> = [];
  const auditCalls: Array<Record<string, unknown>> = [];
  const assistant = options?.assistant === undefined ? buildAssistant() : options.assistant;
  const assistantRepository: Pick<AssistantRepository, "findById"> = {
    async findById(id) {
      return assistant !== null && assistant.id === id ? assistant : null;
    }
  };
  const memoryRegistryRepository: Pick<
    AssistantMemoryRegistryRepository,
    "findMostSimilarActiveOpenLoop" | "setResolvedAtById"
  > = {
    async findMostSimilarActiveOpenLoop(assistantId, userId, referenceText) {
      findCalls.push({ assistantId, userId, referenceText });
      return options?.candidate ?? null;
    },
    async setResolvedAtById(id, assistantId) {
      setCalls.push({ id, assistantId });
      return options?.setResolvedReturns ?? true;
    }
  };
  const appendAuditService: Pick<AppendAssistantAuditEventService, "execute"> = {
    async execute(input) {
      auditCalls.push(input as Record<string, unknown>);
    }
  };
  return {
    service: new CloseMostSimilarOpenLoopService(
      assistantRepository as AssistantRepository,
      memoryRegistryRepository as AssistantMemoryRegistryRepository,
      appendAuditService as AppendAssistantAuditEventService
    ),
    findCalls,
    setCalls,
    auditCalls
  };
}

async function run(): Promise<void> {
  const validate = createHarness();

  // parseInput rejects junk
  assert.throws(
    () => validate.service.parseInput(null),
    (err) => err instanceof BadRequestException
  );
  assert.throws(
    () => validate.service.parseInput({ assistantId: "a" }),
    (err) => err instanceof BadRequestException
  );
  assert.throws(
    () => validate.service.parseInput({ assistantId: "a", referenceText: "  ", requestId: null }),
    (err) => err instanceof BadRequestException
  );
  assert.throws(
    () =>
      validate.service.parseInput({
        assistantId: "a",
        referenceText: "x",
        requestId: null,
        unknown: 1
      }),
    (err) => err instanceof BadRequestException
  );

  // parseInput trims whitespace, collapses spaces, accepts a non-empty payload
  const parsed = validate.service.parseInput({
    assistantId: "  assistant-1  ",
    referenceText: "  Picked   the   venue  ",
    requestId: null
  });
  assert.equal(parsed.assistantId, "assistant-1");
  assert.equal(parsed.referenceText, "Picked the venue");
  assert.equal(parsed.requestId, null);

  // execute throws on missing assistant
  const missing = createHarness({ assistant: null });
  await assert.rejects(
    () =>
      missing.service.execute({
        assistantId: "assistant-1",
        referenceText: "hello",
        requestId: null
      }),
    (err) => err instanceof NotFoundException
  );

  // no candidate → returns no_active_open_loop_matched, audit logs no-match,
  // setResolvedAtById is NOT called
  const noMatch = createHarness({ candidate: null });
  const noMatchResult = await noMatch.service.execute({
    assistantId: "assistant-1",
    referenceText: "Picked the venue for the retreat",
    requestId: "req-1"
  });
  assert.deepEqual(noMatchResult, {
    closed: false,
    closedItemId: null,
    reason: "no_active_open_loop_matched"
  });
  assert.equal(noMatch.findCalls.length, 1);
  assert.equal(noMatch.setCalls.length, 0);
  assert.equal(noMatch.auditCalls.length, 1);
  assert.equal(noMatch.auditCalls[0]?.eventCode, "assistant.open_loop_close_no_match");

  // fresh candidate within cooldown window -> soft no-op, no update, no audit
  const cooldown = createHarness({
    candidate: buildOpenLoop({ id: "loop-cooldown", createdAt: new Date(Date.now() - 2_000) })
  });
  const cooldownResult = await cooldown.service.execute({
    assistantId: "assistant-1",
    referenceText: "Picked the venue for the retreat",
    requestId: "req-cooldown"
  });
  assert.deepEqual(cooldownResult, {
    closed: false,
    closedItemId: "loop-cooldown",
    reason: "cooldown_active"
  });
  assert.equal(cooldown.setCalls.length, 0);
  assert.equal(cooldown.auditCalls.length, 0);

  // happy path: candidate found → setResolvedAtById called, audit explicit
  const candidate = buildOpenLoop({ id: "loop-42" });
  const happy = createHarness({ candidate, setResolvedReturns: true });
  const happyResult = await happy.service.execute({
    assistantId: "assistant-1",
    referenceText: "Picked the venue for the retreat in Barcelona",
    requestId: "req-2"
  });
  assert.deepEqual(happyResult, {
    closed: true,
    closedItemId: "loop-42",
    reason: "matched"
  });
  assert.equal(happy.setCalls.length, 1);
  assert.deepEqual(happy.setCalls[0], { id: "loop-42", assistantId: "assistant-1" });
  // ownership: setResolvedAtById receives the assistantId (not userId), so the
  // repository can scope the update to the assistant.
  assert.equal(happy.auditCalls.length, 1);
  assert.equal(happy.auditCalls[0]?.eventCode, "assistant.open_loop_closed_explicit");
  const details = happy.auditCalls[0]?.details as Record<string, unknown>;
  assert.equal(details.closedItemId, "loop-42");
  assert.equal(details.requestId, "req-2");
  // ADR-074 Slice M3.1 — every close path must stamp a distinct closeSource
  // so ops can tell the legacy `closeOpenLoop:true` lexical match apart from
  // the M3.1 deterministic `memory_write({ action: "close", ref })` path and
  // the M3 implicit close-by-overwrite.
  assert.equal(details.closeSource, "closeOpenLoop_flag");

  // race: candidate found but setResolvedAtById returns false (already
  // resolved by a concurrent writer). Treated as success, no extra audit.
  const race = createHarness({ candidate, setResolvedReturns: false });
  const raceResult = await race.service.execute({
    assistantId: "assistant-1",
    referenceText: "Anything",
    requestId: null
  });
  assert.deepEqual(raceResult, {
    closed: true,
    closedItemId: "loop-42",
    reason: "matched"
  });
  assert.equal(race.setCalls.length, 1);
  assert.equal(race.auditCalls.length, 0, "race path skips the explicit-close audit event");
}

void run();
