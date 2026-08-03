import assert from "node:assert/strict";
import {
  extractConversationalPublishFromMetadata,
  extractAssistantWebChatPlatformNotice,
  extractTurnEventsFromMetadata,
  mapAssistantChatMessageToWebState
} from "../src/modules/workspace-management/application/web-chat-message-state.mapper";

function run(): void {
  assert.deepEqual(
    extractAssistantWebChatPlatformNotice({
      kind: "safety_inbound_warn",
      reasonCode: "hack_abuse",
      moderationCaseId: "case-1"
    }),
    { kind: "safety_inbound_warn", reasonCode: "hack_abuse" }
  );
  assert.equal(extractAssistantWebChatPlatformNotice(null), null);
  assert.equal(extractAssistantWebChatPlatformNotice({ kind: "other" }), null);
  assert.equal(extractConversationalPublishFromMetadata({ conversationalPublish: true }), true);
  assert.equal(extractConversationalPublishFromMetadata({ conversationalPublish: false }), false);
  assert.equal(extractConversationalPublishFromMetadata(null), false);

  // ADR-170 — turnEvents projection.
  assert.deepEqual(
    extractTurnEventsFromMetadata({
      turnEvents: [
        { kind: "note", at: "2026-08-02T00:00:00.000Z", text: "hi", display: "step", seq: 1 },
        { kind: "not_a_real_kind", at: "2026-08-02T00:00:01.000Z", seq: 2 },
        { kind: "answer_text", at: "2026-08-02T00:00:02.000Z", text: "done", seq: 3 }
      ]
    }),
    [
      { kind: "note", at: "2026-08-02T00:00:00.000Z", text: "hi", display: "step", seq: 1 },
      { kind: "answer_text", at: "2026-08-02T00:00:02.000Z", text: "done", seq: 3 }
    ]
  );
  assert.deepEqual(extractTurnEventsFromMetadata(null), []);
  assert.deepEqual(extractTurnEventsFromMetadata({}), []);
  assert.deepEqual(extractTurnEventsFromMetadata({ turnEvents: "not-an-array" }), []);

  // ADR-170 D3.3.1 — the durable row's `draftKey`/`draftKeys` server-side
  // idempotency bookkeeping must never reach the client projection.
  const projected = extractTurnEventsFromMetadata({
    turnEvents: [
      {
        kind: "note",
        at: "2026-08-02T00:00:00.000Z",
        text: "hi",
        display: "step",
        seq: 1,
        draftKey: "req-1#0",
        draftKeys: ["req-1#0"]
      },
      {
        kind: "answer_text",
        at: "2026-08-02T00:00:02.000Z",
        text: "Hello, world",
        seq: 2,
        draftKeys: ["req-1#1", "req-1#2"]
      }
    ]
  });
  assert.deepEqual(projected, [
    { kind: "note", at: "2026-08-02T00:00:00.000Z", text: "hi", display: "step", seq: 1 },
    { kind: "answer_text", at: "2026-08-02T00:00:02.000Z", text: "Hello, world", seq: 2 }
  ]);
  for (const event of projected) {
    assert.equal("draftKey" in event, false);
    assert.equal("draftKeys" in event, false);
  }

  const baseMessage = {
    id: "message-1",
    chatId: "chat-1",
    assistantId: "assistant-1",
    author: "assistant" as const,
    content: "Done.",
    createdAt: new Date("2026-08-02T00:00:00.000Z")
  };

  // D7 — a message with no log projects with no `turnEvents` key at all; not
  // an empty array, and not a special-cased legacy branch.
  const historical = mapAssistantChatMessageToWebState({
    message: { ...baseMessage, metadata: null },
    attachments: []
  });
  assert.equal("turnEvents" in historical, false);

  const withLog = mapAssistantChatMessageToWebState({
    message: {
      ...baseMessage,
      metadata: {
        turnEvents: [{ kind: "answer_text", at: "2026-08-02T00:00:02.000Z", text: "Done.", seq: 1 }]
      }
    },
    attachments: []
  });
  assert.deepEqual(withLog.turnEvents, [
    { kind: "answer_text", at: "2026-08-02T00:00:02.000Z", text: "Done.", seq: 1 }
  ]);

  const conversationalPublish = mapAssistantChatMessageToWebState({
    message: { ...baseMessage, metadata: { conversationalPublish: true } },
    attachments: []
  });
  assert.equal(conversationalPublish.conversationalPublish, true);

  const ordinary = mapAssistantChatMessageToWebState({
    message: { ...baseMessage, metadata: { conversationalPublish: false } },
    attachments: []
  });
  assert.equal("conversationalPublish" in ordinary, false);
}

run();
console.log("web-chat-message-state.mapper.test.ts: ok");
