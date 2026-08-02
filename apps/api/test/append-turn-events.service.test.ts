import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NotFoundException } from "@nestjs/common";
import type { TurnEvent, TurnEventDraft } from "@persai/runtime-contract";
import { AppendTurnEventsService } from "../src/modules/workspace-management/application/append-turn-events.service";

const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";

function createPrismaDouble(
  input: {
    messageExists?: boolean;
    initialTurnEvents?: TurnEvent[];
    initialMetadata?: Record<string, unknown>;
    /** ADR-170 D3.3 — 1-indexed `$transaction` call numbers that should throw, simulating a transient DB hiccup on that specific attempt only. */
    failTransactionCalls?: Set<number>;
  } = {}
) {
  const exists = input.messageExists !== false;
  let metadata: Record<string, unknown> = {
    ...(input.initialMetadata ?? {}),
    ...(input.initialTurnEvents === undefined ? {} : { turnEvents: input.initialTurnEvents })
  };
  let updateCalls = 0;
  let transactionCallCount = 0;
  // Serializes concurrent `$transaction` bodies onto a single queue, the same
  // way a real Postgres `FOR UPDATE` row lock serializes concurrent
  // transactions targeting the same row — sufficient here because every test
  // in this file targets exactly one message id.
  let queue: Promise<unknown> = Promise.resolve();

  const tx = {
    $queryRaw: async () => (exists ? [{ id: MESSAGE_ID }] : []),
    assistantChatMessage: {
      findUniqueOrThrow: async () => {
        if (!exists) {
          throw new Error("record not found");
        }
        return { metadata };
      },
      update: async (args: { data: { metadata: Record<string, unknown> } }) => {
        updateCalls += 1;
        metadata = args.data.metadata;
        return { metadata };
      }
    }
  };

  const prisma = {
    assistantChatMessage: {
      findUnique: async () => (exists ? { metadata } : null)
    },
    $transaction: async <T>(fn: (client: typeof tx) => Promise<T>): Promise<T> => {
      transactionCallCount += 1;
      const callNumber = transactionCallCount;
      const run = queue.then(
        () => {
          if (input.failTransactionCalls?.has(callNumber) === true) {
            throw new Error(`simulated transient append failure (call #${String(callNumber)})`);
          }
          return fn(tx);
        },
        () => fn(tx)
      );
      queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  };

  return {
    prisma,
    getMetadata: () => metadata,
    updateCalls: () => updateCalls
  };
}

// ADR-170 D3.3 — every runtime-emitted draft carries a turn-scoped
// `draftKey`; auto-assigning a fresh one per call keeps existing
// key-agnostic tests unaffected while letting key-specific tests pass an
// explicit one to exercise replay/coalescing-by-key behaviour.
let nextDefaultDraftKeyIndex = 0;
function nextDefaultDraftKey(): string {
  nextDefaultDraftKeyIndex += 1;
  return `test-request#${String(nextDefaultDraftKeyIndex)}`;
}

function note(text: string, draftKey: string = nextDefaultDraftKey()): TurnEventDraft {
  return { kind: "note", at: new Date().toISOString(), draftKey, text, display: "step" };
}

function answerText(text: string, draftKey: string = nextDefaultDraftKey()): TurnEventDraft {
  return { kind: "answer_text", at: new Date().toISOString(), draftKey, text };
}

function delivery(attachmentId: string): TurnEventDraft {
  return {
    kind: "delivery",
    at: new Date().toISOString(),
    attachmentId,
    artifactKind: "image",
    filename: "picture.png",
    sizeBytes: 1024
  };
}

function captureProcessStdoutSync<T>(action: () => Promise<T>): Promise<{
  result: T;
  captured: string;
}> {
  // Nest's default Logger writes ERROR-level lines to stderr and other
  // levels to stdout, so both are captured here — the overflow test below
  // asserts on an `error`-level line.
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  let captured = "";
  const capture = (chunk: string | Uint8Array): void => {
    captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  };
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    capture(chunk);
    return originalStdout(chunk as never, ...(rest as never[]));
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    capture(chunk);
    return originalStderr(chunk as never, ...(rest as never[]));
  }) as typeof process.stderr.write;
  const restore = (): void => {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  };
  return action()
    .then((result) => {
      restore();
      return { result, captured };
    })
    .catch((error) => {
      restore();
      throw error;
    });
}

describe("append-turn-events.service", () => {
  test("allocates gapless seq starting at 1 across separate append calls", async () => {
    const double = createPrismaDouble();
    const service = new AppendTurnEventsService(double.prisma as never);

    const first = await service.append({ messageId: MESSAGE_ID, drafts: [note("step one")] });
    const second = await service.append({ messageId: MESSAGE_ID, drafts: [note("step two")] });
    const third = await service.append({ messageId: MESSAGE_ID, drafts: [note("step three")] });

    assert.equal(first[0]?.seq, 1);
    assert.equal(second[0]?.seq, 2);
    assert.equal(third[0]?.seq, 3);

    const log = await service.getLog(MESSAGE_ID);
    assert.deepEqual(
      log.map((event) => event.seq),
      [1, 2, 3]
    );
  });

  test("coalesces consecutive answer_text and splits on an intervening kind", async () => {
    const double = createPrismaDouble();
    const service = new AppendTurnEventsService(double.prisma as never);

    const appended = await service.append({
      messageId: MESSAGE_ID,
      drafts: [answerText("Hello"), answerText(", world"), note("used a tool"), answerText("Done.")]
    });

    // Every draft produces a report entry (the coalesced pair reports both
    // the original and the extended state), but the durable log collapses
    // the two answer_text drafts that had nothing between them into one event.
    assert.equal(appended.length, 4);
    assert.equal(appended[0]?.seq, 1);
    assert.equal((appended[0] as { text: string }).text, "Hello");
    assert.equal(appended[1]?.seq, 1);
    assert.equal((appended[1] as { text: string }).text, "Hello, world");

    const log = await service.getLog(MESSAGE_ID);
    assert.equal(log.length, 3);
    assert.equal(log[0]?.kind, "answer_text");
    assert.equal(log[0]?.seq, 1);
    assert.equal((log[0] as { text: string }).text, "Hello, world");
    assert.equal(log[1]?.kind, "note");
    assert.equal(log[1]?.seq, 2);
    assert.equal(log[2]?.kind, "answer_text");
    assert.equal(log[2]?.seq, 3);
    assert.equal((log[2] as { text: string }).text, "Done.");
  });

  test("delivery is idempotent by attachmentId — a repeat is a no-op, not a duplicate", async () => {
    const double = createPrismaDouble();
    const service = new AppendTurnEventsService(double.prisma as never);

    const first = await service.append({
      messageId: MESSAGE_ID,
      drafts: [delivery("attachment-1")]
    });
    const second = await service.append({
      messageId: MESSAGE_ID,
      drafts: [delivery("attachment-1")]
    });

    assert.equal(first.length, 1);
    assert.equal(first[0]?.seq, 1);
    assert.equal(second.length, 0);

    const log = await service.getLog(MESSAGE_ID);
    assert.equal(log.length, 1);
    assert.equal(double.updateCalls(), 1);
  });

  test("two concurrent appenders produce neither a duplicate nor a gap", async () => {
    const double = createPrismaDouble();
    const service = new AppendTurnEventsService(double.prisma as never);

    const [first, second] = await Promise.all([
      service.append({ messageId: MESSAGE_ID, drafts: [note("from pod A")] }),
      service.append({ messageId: MESSAGE_ID, drafts: [note("from pod B")] })
    ]);

    const seqs = [...first, ...second].map((event) => event.seq).sort((a, b) => a - b);
    assert.deepEqual(seqs, [1, 2]);

    const log = await service.getLog(MESSAGE_ID);
    assert.equal(log.length, 2);
    assert.deepEqual(
      log.map((event) => event.seq),
      [1, 2]
    );
  });

  test("a late delivery after the turn has otherwise closed appends with a higher seq, never restarting numbering", async () => {
    const double = createPrismaDouble({
      initialTurnEvents: [
        {
          kind: "note",
          at: new Date().toISOString(),
          draftKey: "seed#1",
          text: "earlier step",
          display: "step",
          seq: 1
        },
        {
          kind: "turn_stopped",
          at: new Date().toISOString(),
          draftKey: "seed#2",
          reason: "user_stopped",
          seq: 2
        }
      ]
    });
    const service = new AppendTurnEventsService(double.prisma as never);

    const appended = await service.append({
      messageId: MESSAGE_ID,
      drafts: [delivery("late-attachment")]
    });

    assert.equal(appended.length, 1);
    assert.equal(appended[0]?.seq, 3);

    const log = await service.getLog(MESSAGE_ID);
    assert.equal(log.length, 3);
    assert.deepEqual(
      log.map((event) => event.seq),
      [1, 2, 3]
    );
  });

  test("getSince returns exactly the missing tail and nothing else", async () => {
    const double = createPrismaDouble({
      initialTurnEvents: [1, 2, 3, 4].map((seq) => ({
        kind: "note" as const,
        at: new Date().toISOString(),
        draftKey: `seed#${String(seq)}`,
        text: `step ${String(seq)}`,
        display: "step" as const,
        seq
      }))
    });
    const service = new AppendTurnEventsService(double.prisma as never);

    const tail = await service.getSince(MESSAGE_ID, 2);

    assert.deepEqual(
      tail.map((event) => event.seq),
      [3, 4]
    );
  });

  test("preserves other metadata keys untouched (D5.2 — no deletion of coexisting fields)", async () => {
    const double = createPrismaDouble({
      initialMetadata: { workingNotes: ["kept"], sourceUserMessageId: "user-message-1" }
    });
    const service = new AppendTurnEventsService(double.prisma as never);

    await service.append({ messageId: MESSAGE_ID, drafts: [note("first")] });

    const metadata = double.getMetadata();
    assert.deepEqual(metadata.workingNotes, ["kept"]);
    assert.equal(metadata.sourceUserMessageId, "user-message-1");
    assert.ok(Array.isArray(metadata.turnEvents));
  });

  test("fails closed when the assistant message row is missing", async () => {
    const double = createPrismaDouble({ messageExists: false });
    const service = new AppendTurnEventsService(double.prisma as never);

    await assert.rejects(
      () => service.append({ messageId: MESSAGE_ID, drafts: [note("orphan")] }),
      (error: unknown) => error instanceof NotFoundException
    );
  });

  test("append([]) is a no-op and never touches the store", async () => {
    const double = createPrismaDouble();
    const service = new AppendTurnEventsService(double.prisma as never);

    const result = await service.append({ messageId: MESSAGE_ID, drafts: [] });

    assert.deepEqual(result, []);
    assert.equal(double.updateCalls(), 0);
  });

  test("ADR-170 D3.3 — replaying the same draft twice appends once", async () => {
    const double = createPrismaDouble();
    const service = new AppendTurnEventsService(double.prisma as never);
    const draft = note("first note", "request-1#0");

    const first = await service.append({ messageId: MESSAGE_ID, drafts: [draft] });
    const second = await service.append({ messageId: MESSAGE_ID, drafts: [draft] });

    assert.equal(first.length, 1);
    assert.equal(first[0]?.seq, 1);
    assert.equal(second.length, 0);

    const log = await service.getLog(MESSAGE_ID);
    assert.equal(log.length, 1);
    assert.equal(log[0]?.seq, 1);
  });

  test("ADR-170 D3.3 — a mid-stream append failure followed by completion reconciliation produces a complete gapless log in the right order", async () => {
    const double = createPrismaDouble();
    const service = new AppendTurnEventsService(double.prisma as never);

    const draftA = note("first note", "request-1#0");
    const draftB = answerText("Hello", "request-1#1");
    const draftC = answerText(", world", "request-1#2");
    const draftD = note("used a tool", "request-1#3");
    const draftE = answerText("Done.", "request-1#4");
    const allDrafts = [draftA, draftB, draftC, draftD, draftE];

    // Simulates a pod dying mid-stream (D3.3): only the first draft's live
    // append made it through before live appending stopped happening for
    // the rest of the turn.
    const live = await service.append({ messageId: MESSAGE_ID, drafts: [draftA] });
    assert.equal(live.length, 1);

    // Turn completion reconciles the FULL ordered draft list from
    // `RuntimeTurnResult.turnEvents` against the stored log.
    const healed = await service.append({ messageId: MESSAGE_ID, drafts: allDrafts });

    // draftA is already present (idempotent no-op); B, C (coalesced into one
    // stored event), D, and E are healed — 4 report entries.
    assert.equal(healed.length, 4);

    const log = await service.getLog(MESSAGE_ID);
    assert.equal(log.length, 4);
    assert.deepEqual(
      log.map((event) => event.seq),
      [1, 2, 3, 4]
    );
    assert.equal(log[0]?.kind, "note");
    assert.equal(log[1]?.kind, "answer_text");
    assert.equal((log[1] as { text: string }).text, "Hello, world");
    assert.equal(log[2]?.kind, "note");
    assert.equal(log[3]?.kind, "answer_text");
    assert.equal((log[3] as { text: string }).text, "Done.");

    // Reconciling again (e.g. a retried finalize call) is now fully healthy:
    // every key is present, so nothing more is appended.
    const reconciledAgain = await service.append({ messageId: MESSAGE_ID, drafts: allDrafts });
    assert.deepEqual(reconciledAgain, []);
  });

  test("ADR-170 D3.3 — reconciliation in the healthy case appends nothing", async () => {
    const double = createPrismaDouble();
    const service = new AppendTurnEventsService(double.prisma as never);

    const draftA = note("first note", "request-2#0");
    const draftB = answerText("All good.", "request-2#1");
    const allDrafts = [draftA, draftB];

    const live = await service.append({ messageId: MESSAGE_ID, drafts: allDrafts });
    assert.equal(live.length, 2);
    assert.equal(double.updateCalls(), 1);

    // Every live append already succeeded, so completion reconciliation
    // recognizes every key and appends nothing — no extra write either.
    const reconciled = await service.append({ messageId: MESSAGE_ID, drafts: allDrafts });
    assert.deepEqual(reconciled, []);
    assert.equal(double.updateCalls(), 1);
  });

  test("ADR-170 D3.3/D5.1 — a coalesced answer_text event carries every merged draft key, and replaying any one of them is a no-op", async () => {
    const double = createPrismaDouble();
    const service = new AppendTurnEventsService(double.prisma as never);

    const draftA = answerText("Hello", "request-3#0");
    const draftB = answerText(", world", "request-3#1");

    await service.append({ messageId: MESSAGE_ID, drafts: [draftA, draftB] });

    // Replaying either merged draft individually — as reconciliation would
    // if only one of the two keys had actually failed live — is a no-op,
    // not a duplicate or a second coalesced fragment.
    const replayA = await service.append({ messageId: MESSAGE_ID, drafts: [draftA] });
    const replayB = await service.append({ messageId: MESSAGE_ID, drafts: [draftB] });

    assert.deepEqual(replayA, []);
    assert.deepEqual(replayB, []);

    const log = await service.getLog(MESSAGE_ID);
    assert.equal(log.length, 1);
    assert.equal((log[0] as { text: string }).text, "Hello, world");
  });

  test("ADR-170 D3.3 — the ordered pending buffer keeps a transient append failure from landing out of chronological order", async () => {
    // The SECOND `$transaction` attempt (draftB's live append) fails
    // transiently; everything before and after succeeds.
    const double = createPrismaDouble({ failTransactionCalls: new Set([2]) });
    const service = new AppendTurnEventsService(double.prisma as never);

    const draftA = note("first note", "req-buf#0");
    const draftB = note("second note", "req-buf#1");
    const draftC = note("third note", "req-buf#2");
    const deliveryDraft = delivery("attachment-buf-1");

    const first = await service.append({ messageId: MESSAGE_ID, drafts: [draftA] });
    assert.equal(first.length, 1);
    assert.equal(first[0]?.seq, 1);

    // draftB's live append fails — it stays pending rather than being
    // dropped, and is NOT written anywhere yet.
    await assert.rejects(() => service.append({ messageId: MESSAGE_ID, drafts: [draftB] }));
    const logAfterFailure = await service.getLog(MESSAGE_ID);
    assert.equal(logAfterFailure.length, 1);

    // The NEXT append for this message — draftC's live append — must drain
    // the pending draftB FIRST, in order, before its own new draft. Both
    // report as healed/appended in this one call.
    const third = await service.append({ messageId: MESSAGE_ID, drafts: [draftC] });
    assert.equal(third.length, 2);
    assert.equal((third[0] as { text: string }).text, "second note");
    assert.equal((third[1] as { text: string }).text, "third note");

    // A subsequent `delivery` append is unaffected — the buffer already
    // drained — but would equally have drained it first had it not.
    const fourth = await service.append({ messageId: MESSAGE_ID, drafts: [deliveryDraft] });
    assert.equal(fourth.length, 1);

    const log = await service.getLog(MESSAGE_ID);
    assert.equal(log.length, 4);
    assert.deepEqual(
      log.map((event) => event.seq),
      [1, 2, 3, 4]
    );
    // `seq` order matches emission order (A, B, C, delivery) exactly — the
    // healed draftB sits BETWEEN A and C, never at the tail after C.
    assert.equal((log[0] as { text: string }).text, "first note");
    assert.equal((log[1] as { text: string }).text, "second note");
    assert.equal((log[2] as { text: string }).text, "third note");
    assert.equal(log[3]?.kind, "delivery");
  });

  test("ADR-170 D3.3.1 — append(), getLog() and getSince() never expose draftKey or draftKeys on the wire", async () => {
    const double = createPrismaDouble();
    const service = new AppendTurnEventsService(double.prisma as never);

    // A coalesced answer_text (two merged keys) plus a plain note — the two
    // shapes that internally carry `draftKeys`/`draftKey` respectively.
    const appended = await service.append({
      messageId: MESSAGE_ID,
      drafts: [
        answerText("Hello", "wire-req#0"),
        answerText(", world", "wire-req#1"),
        note("a note", "wire-req#2")
      ]
    });

    for (const event of [...appended, ...(await service.getLog(MESSAGE_ID))]) {
      assert.equal("draftKey" in event, false);
      assert.equal("draftKeys" in event, false);
    }
    const since = await service.getSince(MESSAGE_ID, 0);
    for (const event of since) {
      assert.equal("draftKey" in event, false);
      assert.equal("draftKeys" in event, false);
    }
  });

  test("ADR-170 D3.3 — releasePending clears a message's pending buffer even after a failed reconciliation attempt, so a later append does not resurrect a lost draft", async () => {
    const double = createPrismaDouble({ failTransactionCalls: new Set([1, 2]) });
    const service = new AppendTurnEventsService(double.prisma as never);

    const draftA = note("live draft", "req-release#0");
    const draftB = note("reconciliation draft", "req-release#1");

    // The live append fails (call #1) — draftA stays pending.
    await assert.rejects(() => service.append({ messageId: MESSAGE_ID, drafts: [draftA] }));

    // Completion reconciliation re-appends the FULL ordered list, but the DB
    // is still down (call #2 also fails) — without release, the combined
    // [draftA, draftB] would stay pending indefinitely.
    await assert.rejects(() => service.append({ messageId: MESSAGE_ID, drafts: [draftA, draftB] }));

    // `stream-web-chat-turn.service.ts`'s `reconcileTurnEventsAtCompletion`
    // always releases the buffer in a `finally` once reconciliation has run,
    // whether or not that call itself succeeded — the durable log is as
    // complete as it will ever get for this turn on this pod.
    service.releasePending(MESSAGE_ID);

    // A later, unrelated append for this message must NOT resurrect draftA
    // or draftB from a stale pending buffer.
    const draftC = note("much later note", "req-release#2");
    const appended = await service.append({ messageId: MESSAGE_ID, drafts: [draftC] });
    assert.equal(appended.length, 1);
    assert.equal((appended[0] as { text: string }).text, "much later note");

    const log = await service.getLog(MESSAGE_ID);
    assert.equal(log.length, 1);
    assert.equal((log[0] as { text: string }).text, "much later note");
  });

  test("ADR-170 D3.3 — exceeding the pending buffer cap logs an error and clears the buffer instead of growing it unbounded", async () => {
    const double = createPrismaDouble({ failTransactionCalls: new Set([1]) });
    const service = new AppendTurnEventsService(double.prisma as never);

    // Far above any real turn's draft count — a single call already over the
    // 500-draft cap, so the very first failure triggers the overflow path.
    const oversizedDrafts: TurnEventDraft[] = Array.from({ length: 501 }, (_, index) =>
      note(`draft ${String(index)}`, `req-overflow#${String(index)}`)
    );

    const { captured } = await captureProcessStdoutSync(async () => {
      await assert.rejects(() =>
        service.append({ messageId: MESSAGE_ID, drafts: oversizedDrafts })
      );
    });

    assert.match(
      captured,
      /ADR-170 turn_event pending buffer overflow messageId=22222222-2222-4222-8222-222222222222 draftCount=501 cap=500/
    );

    // The buffer was cleared, not grown — a subsequent successful append for
    // this message reports only its OWN new draft, not the 501 that
    // overflowed.
    const afterOverflow = await service.append({
      messageId: MESSAGE_ID,
      drafts: [note("after overflow", "req-overflow#recovery")]
    });
    assert.equal(afterOverflow.length, 1);
    assert.equal((afterOverflow[0] as { text: string }).text, "after overflow");

    const log = await service.getLog(MESSAGE_ID);
    assert.equal(log.length, 1);
  });

  test("ADR-170 D3.3 — a normal successful turn leaves no pending entry behind", async () => {
    const double = createPrismaDouble();
    const service = new AppendTurnEventsService(double.prisma as never);

    const appended = await service.append({ messageId: MESSAGE_ID, drafts: [note("all good")] });
    assert.equal(appended.length, 1);
    const updateCallsAfterSuccess = double.updateCalls();

    // If anything were still pending for this message, an empty-drafts
    // append would still have something to drain and write; the existing
    // "append([]) is a no-op" behavior only holds when nothing is pending —
    // so this proves the healthy path retained no map entry.
    const drained = await service.append({ messageId: MESSAGE_ID, drafts: [] });
    assert.deepEqual(drained, []);
    assert.equal(double.updateCalls(), updateCallsAfterSuccess);
  });
});
