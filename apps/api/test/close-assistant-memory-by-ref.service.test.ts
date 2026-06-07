import assert from "node:assert/strict";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { CloseAssistantMemoryByRefService } from "../src/modules/workspace-management/application/close-assistant-memory-by-ref.service";
import type { AppendAssistantAuditEventService } from "../src/modules/workspace-management/application/append-assistant-audit-event.service";
import type { Assistant } from "../src/modules/workspace-management/domain/assistant.entity";
import type { AssistantGovernance } from "../src/modules/workspace-management/domain/assistant-governance.entity";
import type { AssistantGovernanceRepository } from "../src/modules/workspace-management/domain/assistant-governance.repository";
import type { AssistantMemoryRegistryItem } from "../src/modules/workspace-management/domain/assistant-memory-registry-item.entity";
import type { AssistantMemoryRegistryRepository } from "../src/modules/workspace-management/domain/assistant-memory-registry.repository";
import type { AssistantRepository } from "../src/modules/workspace-management/domain/assistant.repository";

const NOW = new Date("2026-04-22T12:00:00.000Z");

function buildAssistant(overrides: Partial<Assistant> = {}): Assistant {
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function buildOpenLoop(
  overrides: Partial<AssistantMemoryRegistryItem> = {}
): AssistantMemoryRegistryItem {
  return {
    id: "loop-1",
    assistantId: "assistant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    chatId: null,
    relatedUserMessageId: null,
    relatedAssistantMessageId: null,
    summary: "Confirm Barcelona retreat venue.",
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
    createdAt: new Date("2026-04-21T00:00:00.000Z"),
    ...overrides
  };
}

interface HarnessOptions {
  assistantById?: Assistant | null;
  assistantByUserId?: Assistant | null;
  governance?: AssistantGovernance | null;
  // Returned by findActiveByIdAndAssistantId. `undefined` → null (no row).
  existing?: AssistantMemoryRegistryItem | null;
  setResolvedReturns?: boolean;
  governanceForReadDisabled?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const findByIdCalls: string[] = [];
  const findActiveCalls: Array<{ itemId: string; assistantId: string }> = [];
  const setResolvedCalls: Array<{ id: string; assistantId: string }> = [];
  const auditCalls: Array<Record<string, unknown>> = [];
  const findGovernanceCalls: string[] = [];

  const assistantById =
    options.assistantById === undefined ? buildAssistant() : options.assistantById;
  const assistantByUserId =
    options.assistantByUserId === undefined ? buildAssistant() : options.assistantByUserId;

  const assistantRepository: Pick<AssistantRepository, "findById"> = {
    async findById(id) {
      findByIdCalls.push(id);
      return assistantById !== null && assistantById.id === id ? assistantById : null;
    }
  };
  const resolveActiveAssistantService = {
    async execute({ userId }: { userId: string }) {
      if (assistantByUserId !== null && assistantByUserId.userId === userId) {
        return { assistantId: assistantByUserId.id, assistant: assistantByUserId };
      }
      throw new NotFoundException("Assistant does not exist for this workspace.");
    }
  };

  const governance: AssistantGovernance | null =
    options.governanceForReadDisabled === true
      ? ({
          assistantId: "assistant-1",
          memoryControl: { policy: { globalMemoryReadAllSurfaces: false } },
          policyEnvelope: null,
          capabilityEnvelope: null,
          secretRefs: null,
          createdAt: NOW,
          updatedAt: NOW
        } as unknown as AssistantGovernance)
      : (options.governance ?? null);

  const assistantGovernanceRepository: Pick<AssistantGovernanceRepository, "findByAssistantId"> = {
    async findByAssistantId(assistantId) {
      findGovernanceCalls.push(assistantId);
      return governance;
    }
  };

  const memoryRegistryRepository: Pick<
    AssistantMemoryRegistryRepository,
    "findActiveByIdAndAssistantId" | "setResolvedAtById"
  > = {
    async findActiveByIdAndAssistantId(itemId, assistantId) {
      findActiveCalls.push({ itemId, assistantId });
      return options.existing ?? null;
    },
    async setResolvedAtById(id, assistantId) {
      setResolvedCalls.push({ id, assistantId });
      return options.setResolvedReturns ?? true;
    }
  };

  const appendAuditService: Pick<AppendAssistantAuditEventService, "execute"> = {
    async execute(input) {
      auditCalls.push(input as Record<string, unknown>);
    }
  };

  return {
    service: new CloseAssistantMemoryByRefService(
      assistantRepository as AssistantRepository,
      assistantGovernanceRepository as AssistantGovernanceRepository,
      memoryRegistryRepository as AssistantMemoryRegistryRepository,
      appendAuditService as AppendAssistantAuditEventService,
      resolveActiveAssistantService as never
    ),
    findByIdCalls,
    findActiveCalls,
    setResolvedCalls,
    auditCalls,
    findGovernanceCalls
  };
}

async function runParseRuntimeInput(): Promise<void> {
  const { service } = createHarness();
  // Reject non-objects, missing fields, blank strings, unknown keys.
  assert.throws(
    () => service.parseRuntimeInput(null),
    (err) => err instanceof BadRequestException
  );
  assert.throws(
    () => service.parseRuntimeInput("string"),
    (err) => err instanceof BadRequestException
  );
  assert.throws(
    () => service.parseRuntimeInput({ assistantId: "a" }),
    (err) => err instanceof BadRequestException
  );
  assert.throws(
    () => service.parseRuntimeInput({ assistantId: "  ", itemId: "loop", requestId: null }),
    (err) => err instanceof BadRequestException
  );
  assert.throws(
    () =>
      service.parseRuntimeInput({
        assistantId: "a",
        itemId: "loop",
        requestId: null,
        rogue: 1
      }),
    (err) => err instanceof BadRequestException
  );

  // Trims whitespace, accepts a null requestId, returns a normalized payload.
  const parsed = service.parseRuntimeInput({
    assistantId: "  assistant-1  ",
    itemId: "  loop-7  ",
    requestId: null
  });
  assert.deepEqual(parsed, {
    assistantId: "assistant-1",
    itemId: "loop-7",
    requestId: null
  });
}

async function runRuntimeMissingAssistant(): Promise<void> {
  const harness = createHarness({ assistantById: null });
  await assert.rejects(
    () =>
      harness.service.executeForRuntime({
        assistantId: "assistant-1",
        itemId: "loop-1",
        requestId: "req"
      }),
    (err) => err instanceof NotFoundException
  );
  assert.equal(harness.findActiveCalls.length, 0);
  assert.equal(harness.setResolvedCalls.length, 0);
  assert.equal(harness.auditCalls.length, 0);
}

async function runRuntimeNotFound(): Promise<void> {
  const harness = createHarness({ existing: null });
  await assert.rejects(
    () =>
      harness.service.executeForRuntime({
        assistantId: "assistant-1",
        itemId: "loop-missing",
        requestId: "req"
      }),
    (err) => err instanceof NotFoundException
  );
  assert.deepEqual(harness.findActiveCalls[0], {
    itemId: "loop-missing",
    assistantId: "assistant-1"
  });
  assert.equal(harness.setResolvedCalls.length, 0);
  assert.equal(harness.auditCalls.length, 0);
}

async function runRuntimeNotOpenLoop(): Promise<void> {
  // A `fact` row is a registered memory item but cannot be closed via this
  // path. The service must reject (BadRequest) so the runtime can map it to
  // a `not_open_loop` outcome rather than silently no-op.
  const harness = createHarness({
    existing: buildOpenLoop({ kind: "fact" })
  });
  await assert.rejects(
    () =>
      harness.service.executeForRuntime({
        assistantId: "assistant-1",
        itemId: "loop-1",
        requestId: "req"
      }),
    (err) => err instanceof BadRequestException
  );
  assert.equal(harness.setResolvedCalls.length, 0);
  assert.equal(harness.auditCalls.length, 0);
}

async function runRuntimeAlreadyResolved(): Promise<void> {
  const harness = createHarness({
    existing: buildOpenLoop({ resolvedAt: new Date("2026-04-21T00:00:00.000Z") })
  });
  const result = await harness.service.executeForRuntime({
    assistantId: "assistant-1",
    itemId: "loop-1",
    requestId: "req"
  });
  assert.deepEqual(result, {
    closed: true,
    closedItemId: "loop-1",
    reason: "already_closed"
  });
  assert.equal(
    harness.setResolvedCalls.length,
    0,
    "already-resolved row must NOT call setResolvedAtById"
  );
  assert.equal(
    harness.auditCalls.length,
    0,
    "already-resolved row must NOT emit a fresh audit event (avoids double-counting)"
  );
}

async function runRuntimeCooldownActive(): Promise<void> {
  const harness = createHarness({
    existing: buildOpenLoop({ createdAt: new Date(Date.now() - 2_000) })
  });
  const result = await harness.service.executeForRuntime({
    assistantId: "assistant-1",
    itemId: "loop-1",
    requestId: "req-cooldown"
  });
  assert.deepEqual(result, {
    closed: false,
    closedItemId: "loop-1",
    reason: "cooldown_active"
  });
  assert.equal(harness.setResolvedCalls.length, 0);
  assert.equal(harness.auditCalls.length, 0);
}

async function runRuntimeHappyPath(): Promise<void> {
  const harness = createHarness({
    existing: buildOpenLoop({ id: "loop-42" })
  });
  const result = await harness.service.executeForRuntime({
    assistantId: "assistant-1",
    itemId: "loop-42",
    requestId: "req-runtime"
  });
  assert.deepEqual(result, {
    closed: true,
    closedItemId: "loop-42",
    reason: "closed"
  });
  assert.equal(harness.setResolvedCalls.length, 1);
  assert.deepEqual(harness.setResolvedCalls[0], {
    id: "loop-42",
    assistantId: "assistant-1"
  });
  assert.equal(harness.auditCalls.length, 1);
  const audit = harness.auditCalls[0]!;
  assert.equal(audit.eventCode, "assistant.open_loop_closed_by_ref");
  assert.equal(audit.eventCategory, "memory_registry");
  assert.equal(audit.assistantId, "assistant-1");
  assert.equal(audit.workspaceId, "workspace-1");
  assert.equal(audit.actorUserId, "user-1");
  const details = audit.details as Record<string, unknown>;
  assert.equal(details.closedItemId, "loop-42");
  assert.equal(details.requestId, "req-runtime");
  // ADR-074 Slice M3.1 — runtime-driven close must stamp source =
  // `memory_write_action_close` so audit-log dashboards can break down
  // close paths.
  assert.equal(details.closeSource, "memory_write_action_close");
}

async function runRuntimeRaceCondition(): Promise<void> {
  // Lookup found an open row but the conditional update returned 0 rows
  // (another writer raced us). We must still report closed:true (the
  // post-condition holds) and skip the audit event.
  const harness = createHarness({
    existing: buildOpenLoop({ id: "loop-race" }),
    setResolvedReturns: false
  });
  const result = await harness.service.executeForRuntime({
    assistantId: "assistant-1",
    itemId: "loop-race",
    requestId: "req-race"
  });
  assert.deepEqual(result, {
    closed: true,
    closedItemId: "loop-race",
    reason: "already_closed"
  });
  assert.equal(harness.setResolvedCalls.length, 1);
  assert.equal(
    harness.auditCalls.length,
    0,
    "race path must NOT emit an audit event for the close"
  );
}

async function runUserMissingAssistant(): Promise<void> {
  const harness = createHarness({ assistantByUserId: null });
  await assert.rejects(
    () => harness.service.executeForUser("user-unknown", "loop-1", "req"),
    (err) => err instanceof NotFoundException
  );
  assert.equal(harness.findGovernanceCalls.length, 0);
  assert.equal(harness.findActiveCalls.length, 0);
}

async function runUserGovernanceDisabled(): Promise<void> {
  const harness = createHarness({ governanceForReadDisabled: true });
  await assert.rejects(
    () => harness.service.executeForUser("user-1", "loop-1", "req"),
    (err) => err instanceof ConflictException
  );
  assert.equal(
    harness.findActiveCalls.length,
    0,
    "governance-disabled path must NOT touch the registry"
  );
}

async function runUserHappyPath(): Promise<void> {
  const harness = createHarness({
    existing: buildOpenLoop({ id: "loop-ui" })
  });
  const result = await harness.service.executeForUser("user-1", "loop-ui", "req-ui");
  assert.deepEqual(result, {
    closed: true,
    closedItemId: "loop-ui",
    reason: "closed"
  });
  assert.equal(harness.setResolvedCalls.length, 1);
  assert.equal(harness.auditCalls.length, 1);
  const details = harness.auditCalls[0]?.details as Record<string, unknown>;
  // ADR-074 Slice M3.1 — UI-driven close must stamp source = `user_ui_close`.
  assert.equal(details.closeSource, "user_ui_close");
}

async function run(): Promise<void> {
  await runParseRuntimeInput();
  await runRuntimeMissingAssistant();
  await runRuntimeNotFound();
  await runRuntimeNotOpenLoop();
  await runRuntimeAlreadyResolved();
  await runRuntimeCooldownActive();
  await runRuntimeHappyPath();
  await runRuntimeRaceCondition();
  await runUserMissingAssistant();
  await runUserGovernanceDisabled();
  await runUserHappyPath();
}

void run();
