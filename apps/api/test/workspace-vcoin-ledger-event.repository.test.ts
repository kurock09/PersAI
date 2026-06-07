import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { PrismaWorkspaceVcoinLedgerEventRepository } from "../src/modules/workspace-management/infrastructure/persistence/prisma-workspace-vcoin-ledger-event.repository";

/**
 * ADR-108 Slice 3 — `WorkspaceVcoinLedgerEventRepository` unit tests.
 *
 * Covers:
 *   - Successful insert → `{ recorded: true }`.
 *   - Duplicate insert (P2002) → `{ recorded: false }` — the idempotency path.
 *   - Different `kind` with same workspace + reference key is allowed (P2002
 *     only fires on the composite (workspaceId, kind, referenceKey) triple).
 *   - Non-P2002 errors are re-thrown unmodified.
 */

type CreateArgs = {
  data: {
    workspaceId: string;
    kind: string;
    amountVc: number;
    referenceKey: string;
    planCode?: string | null;
  };
};

function makeTx(createImpl: (args: CreateArgs) => Promise<unknown>) {
  return {
    workspaceVcoinLedgerEvent: {
      create: createImpl
    }
  };
}

// ── Record once succeeds ──────────────────────────────────────────────────────

async function runRecordOnceSuceeds(): Promise<void> {
  let createCalls = 0;
  const tx = makeTx(async (args: CreateArgs) => {
    createCalls += 1;
    assert.equal(args.data.workspaceId, "ws-1");
    assert.equal(args.data.kind, "monthly_grant");
    assert.equal(args.data.amountVc, 500);
    assert.equal(args.data.referenceKey, "2026-06-01T00:00:00.000Z");
    assert.equal(args.data.planCode, "pro");
    return { id: "evt-1" };
  });

  const repo = new PrismaWorkspaceVcoinLedgerEventRepository();
  const result = await repo.recordEvent({
    workspaceId: "ws-1",
    kind: "monthly_grant",
    amountVc: 500,
    referenceKey: "2026-06-01T00:00:00.000Z",
    planCode: "pro",
    tx: tx as never
  });

  assert.equal(result.recorded, true);
  assert.equal(createCalls, 1);
}

// ── Duplicate (P2002) → recorded: false ──────────────────────────────────────

async function runDuplicateReturnsRecordedFalse(): Promise<void> {
  const tx = makeTx(async (_args: CreateArgs) => {
    throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test"
    });
  });

  const repo = new PrismaWorkspaceVcoinLedgerEventRepository();
  const result = await repo.recordEvent({
    workspaceId: "ws-1",
    kind: "monthly_grant",
    amountVc: 500,
    referenceKey: "2026-06-01T00:00:00.000Z",
    planCode: "pro",
    tx: tx as never
  });

  assert.equal(result.recorded, false, "P2002 must translate to recorded: false");
}

// ── Different kind with same workspace+ref is allowed ────────────────────────

async function runDifferentKindIsAllowed(): Promise<void> {
  // The unique constraint covers (workspaceId, kind, referenceKey). Two events
  // with different kinds but the same workspace+referenceKey are both valid.
  const inserted: Array<{ kind: string }> = [];
  const tx = makeTx(async (args: CreateArgs) => {
    inserted.push({ kind: args.data.kind });
    return { id: `evt-${inserted.length}` };
  });

  const repo = new PrismaWorkspaceVcoinLedgerEventRepository();

  const result1 = await repo.recordEvent({
    workspaceId: "ws-2",
    kind: "monthly_grant",
    amountVc: 300,
    referenceKey: "2026-06-01T00:00:00.000Z",
    tx: tx as never
  });
  assert.equal(result1.recorded, true);

  const result2 = await repo.recordEvent({
    workspaceId: "ws-2",
    kind: "package_purchase",
    amountVc: 1000,
    referenceKey: "2026-06-01T00:00:00.000Z",
    tx: tx as never
  });
  assert.equal(result2.recorded, true, "different kind with same ref must be allowed");
  assert.equal(inserted.length, 2);
  assert.equal(inserted[0]!.kind, "monthly_grant");
  assert.equal(inserted[1]!.kind, "package_purchase");
}

// ── Non-P2002 errors are re-thrown ───────────────────────────────────────────

async function runNonP2002ErrorIsRethrown(): Promise<void> {
  const originalError = new Prisma.PrismaClientKnownRequestError("Foreign key violated", {
    code: "P2003",
    clientVersion: "test"
  });
  const tx = makeTx(async (_args: CreateArgs) => {
    throw originalError;
  });

  const repo = new PrismaWorkspaceVcoinLedgerEventRepository();
  await assert.rejects(
    () =>
      repo.recordEvent({
        workspaceId: "ws-3",
        kind: "monthly_grant",
        amountVc: 100,
        referenceKey: "2026-06-01T00:00:00.000Z",
        tx: tx as never
      }),
    (err: unknown) => err === originalError,
    "non-P2002 errors must be re-thrown unmodified"
  );
}

// ── Negative amountVc (package_refund) round-trips successfully ───────────────

async function runNegativeAmountVcIsAccepted(): Promise<void> {
  // The schema stores signed integers; package_refund events use negative amountVc
  // to represent a debit in the audit ledger. The repository must NOT validate
  // the sign — it stores whatever the caller supplies.
  let storedAmountVc: number | null = null;
  const tx = makeTx(async (args: CreateArgs) => {
    storedAmountVc = args.data.amountVc;
    return { id: "evt-refund-1" };
  });

  const repo = new PrismaWorkspaceVcoinLedgerEventRepository();
  const result = await repo.recordEvent({
    workspaceId: "ws-refund-1",
    kind: "package_refund",
    amountVc: -1000,
    referenceKey: "pi-refund-uuid-1111",
    planCode: null,
    tx: tx as never
  });

  assert.equal(result.recorded, true, "negative amountVc must be accepted");
  assert.equal(storedAmountVc, -1000, "negative amountVc must be stored as-is");
}

// ── ADR-111 Slice 3 kind union accepts voice_clone_creation ───────────────────

async function runVoiceCloneCreationKindIsAccepted(): Promise<void> {
  let storedKind: string | null = null;
  let storedReferenceKey: string | null = null;
  const tx = makeTx(async (args: CreateArgs) => {
    storedKind = args.data.kind;
    storedReferenceKey = args.data.referenceKey;
    return { id: "evt-voice-clone-1" };
  });

  const repo = new PrismaWorkspaceVcoinLedgerEventRepository();
  const result = await repo.recordEvent({
    workspaceId: "ws-clone-1",
    kind: "voice_clone_creation",
    amountVc: -50,
    referenceKey: "00000000-0000-0000-0000-000000000321",
    tx: tx as never
  });

  assert.equal(result.recorded, true);
  assert.equal(storedKind, "voice_clone_creation");
  assert.equal(storedReferenceKey, "00000000-0000-0000-0000-000000000321");
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  await runRecordOnceSuceeds();
  await runDuplicateReturnsRecordedFalse();
  await runDifferentKindIsAllowed();
  await runNonP2002ErrorIsRethrown();
  await runNegativeAmountVcIsAccepted();
  await runVoiceCloneCreationKindIsAccepted();
  console.log("workspace-vcoin-ledger-event.repository: all assertions passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
