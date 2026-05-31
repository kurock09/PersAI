import { describe, expect, it } from "vitest";
import { DEMO_INITIAL_MESSAGES, DEMO_LIMITS, DEMO_SCRIPT, type DemoMessage } from "./demo-script";
import { demoReducer, getInitialDemoState, type DemoMachineState } from "./use-demo-machine";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function autoplayState(overrides?: Partial<DemoMachineState>): DemoMachineState {
  return { ...getInitialDemoState(), status: "autoplay", ...overrides };
}

function thinkingState(overrides?: Partial<DemoMachineState>): DemoMachineState {
  return { ...getInitialDemoState(), status: "thinking", ...overrides };
}

function autoTypingState(overrides?: Partial<DemoMachineState>): DemoMachineState {
  return { ...getInitialDemoState(), status: "autoTyping", ...overrides };
}

function streamingState(overrides?: Partial<DemoMachineState>): DemoMachineState {
  return {
    ...getInitialDemoState(),
    status: "assistantStreaming",
    streamingId: "some-msg",
    autoplayContext: true,
    ...overrides
  };
}

const STUB_REPLY: DemoMessage[] = [
  {
    id: "r-0",
    role: "assistant",
    kind: "text",
    textKey: "landing.demo.stub.genericAck"
  }
];

/* ------------------------------------------------------------------ */
/* Initial state                                                         */
/* ------------------------------------------------------------------ */

describe("getInitialDemoState", () => {
  it("returns trailer status (opening animation plays once per mount)", () => {
    expect(getInitialDemoState().status).toBe("trailer");
  });

  it("starts with zero stepIndex and replyCount", () => {
    const s = getInitialDemoState();
    expect(s.stepIndex).toBe(0);
    expect(s.replyCount).toBe(0);
  });

  it("seeds messages from DEMO_INITIAL_MESSAGES", () => {
    expect(getInitialDemoState().messages).toEqual(DEMO_INITIAL_MESSAGES);
  });

  it("starts with null streamingId and autoplayContext false", () => {
    const s = getInitialDemoState();
    expect(s.streamingId).toBeNull();
    expect(s.autoplayContext).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* TRAILER_DONE                                                          */
/* ------------------------------------------------------------------ */

describe("TRAILER_DONE", () => {
  it("transitions from trailer to idle", () => {
    const state = getInitialDemoState(); // starts in "trailer"
    expect(state.status).toBe("trailer");
    const next = demoReducer(state, { type: "TRAILER_DONE" });
    expect(next.status).toBe("idle");
  });

  it("preserves messages, stepIndex, and replyCount", () => {
    const state = getInitialDemoState();
    const next = demoReducer(state, { type: "TRAILER_DONE" });
    expect(next.messages).toEqual(state.messages);
    expect(next.stepIndex).toBe(0);
    expect(next.replyCount).toBe(0);
  });

  it("is a no-op when not in trailer state", () => {
    for (const status of [
      "idle",
      "autoplay",
      "autoTyping",
      "thinking",
      "assistantStreaming",
      "takeover",
      "reply",
      "limitReached",
      "softReset"
    ] as const) {
      const state: DemoMachineState = { ...getInitialDemoState(), status };
      expect(demoReducer(state, { type: "TRAILER_DONE" })).toBe(state);
    }
  });
});

/* ------------------------------------------------------------------ */
/* AUTOPLAY_START                                                        */
/* ------------------------------------------------------------------ */

describe("AUTOPLAY_START", () => {
  it("transitions from idle to autoplay", () => {
    const next = demoReducer(getInitialDemoState(), { type: "AUTOPLAY_START" });
    // initial state is "trailer", not "idle" — AUTOPLAY_START is a no-op from trailer
    expect(next.status).toBe("trailer");
  });

  it("transitions from idle to autoplay when already idle", () => {
    const idleState = { ...getInitialDemoState(), status: "idle" as const };
    const next = demoReducer(idleState, { type: "AUTOPLAY_START" });
    expect(next.status).toBe("autoplay");
  });

  it("is a no-op when already in autoplay", () => {
    const state = autoplayState();
    expect(demoReducer(state, { type: "AUTOPLAY_START" })).toBe(state);
  });

  it("is a no-op in non-idle states", () => {
    for (const status of [
      "trailer",
      "takeover",
      "thinking",
      "reply",
      "limitReached",
      "softReset",
      "autoTyping",
      "assistantStreaming"
    ] as const) {
      const state: DemoMachineState = { ...getInitialDemoState(), status };
      expect(demoReducer(state, { type: "AUTOPLAY_START" })).toBe(state);
    }
  });
});

/* ------------------------------------------------------------------ */
/* AUTO_TYPE_START                                                       */
/* ------------------------------------------------------------------ */

describe("AUTO_TYPE_START", () => {
  it("transitions from autoplay to autoTyping when next step is a user-text step", () => {
    // DEMO_SCRIPT[0] is a user text step.
    const state = autoplayState({ stepIndex: 0 });
    const next = demoReducer(state, { type: "AUTO_TYPE_START" });
    expect(next.status).toBe("autoTyping");
    expect(next.stepIndex).toBe(0); // stepIndex unchanged until AUTO_TYPE_DONE
  });

  it("is a no-op when not in autoplay state", () => {
    for (const status of [
      "idle",
      "autoTyping",
      "thinking",
      "assistantStreaming",
      "takeover",
      "reply",
      "limitReached",
      "softReset"
    ] as const) {
      const state: DemoMachineState = { ...getInitialDemoState(), status };
      expect(demoReducer(state, { type: "AUTO_TYPE_START" })).toBe(state);
    }
  });

  it("is a no-op when next step is NOT a user text step", () => {
    // Find a non-user step index.
    const nonUserIdx = DEMO_SCRIPT.findIndex((s) => s.message.role !== "user");
    const state = autoplayState({ stepIndex: nonUserIdx });
    expect(demoReducer(state, { type: "AUTO_TYPE_START" })).toBe(state);
  });
});

/* ------------------------------------------------------------------ */
/* AUTO_TYPE_DONE                                                        */
/* ------------------------------------------------------------------ */

describe("AUTO_TYPE_DONE", () => {
  it("commits the current user step message and transitions to thinking (autoplay context)", () => {
    // stepIndex 0 is a user step.
    const state = autoTypingState({ stepIndex: 0 });
    const next = demoReducer(state, { type: "AUTO_TYPE_DONE" });
    expect(next.status).toBe("thinking");
    expect(next.autoplayContext).toBe(true);
    expect(next.stepIndex).toBe(1);
    expect(next.messages.at(-1)).toEqual(DEMO_SCRIPT[0]?.message);
  });

  it("is a no-op when not in autoTyping state", () => {
    for (const status of ["idle", "autoplay", "thinking", "takeover"] as const) {
      const state: DemoMachineState = { ...getInitialDemoState(), status };
      expect(demoReducer(state, { type: "AUTO_TYPE_DONE" })).toBe(state);
    }
  });
});

/* ------------------------------------------------------------------ */
/* THINKING_DONE                                                         */
/* ------------------------------------------------------------------ */

describe("THINKING_DONE", () => {
  it("commits the next assistant text step and enters assistantStreaming", () => {
    // After AUTO_TYPE_DONE, stepIndex=1, which is the assistant text ack.
    const state: DemoMachineState = {
      ...getInitialDemoState(),
      status: "thinking",
      stepIndex: 1,
      autoplayContext: true,
      messages: [...DEMO_INITIAL_MESSAGES, DEMO_SCRIPT[0]!.message]
    };
    const next = demoReducer(state, { type: "THINKING_DONE" });
    expect(next.status).toBe("assistantStreaming");
    expect(next.stepIndex).toBe(2);
    expect(next.streamingId).toBe(DEMO_SCRIPT[1]?.message.id);
    expect(next.messages.at(-1)).toEqual(DEMO_SCRIPT[1]?.message);
  });

  it("is a no-op when not in thinking state", () => {
    for (const status of ["autoplay", "autoTyping", "takeover"] as const) {
      const state: DemoMachineState = {
        ...getInitialDemoState(),
        status,
        autoplayContext: true
      };
      expect(demoReducer(state, { type: "THINKING_DONE" })).toBe(state);
    }
  });

  it("is a no-op when autoplayContext is false (takeover thinking)", () => {
    const state = thinkingState({ autoplayContext: false });
    expect(demoReducer(state, { type: "THINKING_DONE" })).toBe(state);
  });

  it("is a no-op when next step is not an assistant text step", () => {
    // Point to a non-text assistant step (artifact at index 2).
    const state: DemoMachineState = {
      ...getInitialDemoState(),
      status: "thinking",
      stepIndex: 2,
      autoplayContext: true
    };
    expect(demoReducer(state, { type: "THINKING_DONE" })).toBe(state);
  });
});

/* ------------------------------------------------------------------ */
/* STREAMING_DONE                                                        */
/* ------------------------------------------------------------------ */

describe("STREAMING_DONE", () => {
  it("returns to autoplay when in autoplay context", () => {
    const state = streamingState({ autoplayContext: true });
    const next = demoReducer(state, { type: "STREAMING_DONE" });
    expect(next.status).toBe("autoplay");
    expect(next.streamingId).toBeNull();
  });

  it("transitions to reply when in takeover context and below maxReplies", () => {
    const state = streamingState({ autoplayContext: false, replyCount: 1 });
    const next = demoReducer(state, { type: "STREAMING_DONE" });
    expect(next.status).toBe("reply");
    expect(next.streamingId).toBeNull();
  });

  it("transitions to limitReached when replyCount equals maxReplies", () => {
    const state = streamingState({
      autoplayContext: false,
      replyCount: DEMO_LIMITS.maxReplies
    });
    const next = demoReducer(state, { type: "STREAMING_DONE" });
    expect(next.status).toBe("limitReached");
  });

  it("is a no-op when not in assistantStreaming state", () => {
    for (const status of ["autoplay", "thinking", "takeover"] as const) {
      const state: DemoMachineState = { ...getInitialDemoState(), status };
      expect(demoReducer(state, { type: "STREAMING_DONE" })).toBe(state);
    }
  });
});

/* ------------------------------------------------------------------ */
/* AUTOPLAY_STEP                                                         */
/* ------------------------------------------------------------------ */

describe("AUTOPLAY_STEP", () => {
  it("appends an instant step and increments stepIndex", () => {
    // Index 2 is a PDF artifact (instant step).
    const state = autoplayState({ stepIndex: 2 });
    const next = demoReducer(state, { type: "AUTOPLAY_STEP" });
    expect(next.stepIndex).toBe(3);
    expect(next.messages.at(-1)).toEqual(DEMO_SCRIPT[2]?.message);
    expect(next.status).toBe("autoplay");
  });

  it("is a no-op when not in autoplay state", () => {
    for (const status of ["thinking", "autoTyping", "assistantStreaming"] as const) {
      const state: DemoMachineState = { ...getInitialDemoState(), status };
      expect(demoReducer(state, { type: "AUTOPLAY_STEP" })).toBe(state);
    }
  });

  it("is a no-op when stepIndex is out of bounds", () => {
    const state = autoplayState({ stepIndex: DEMO_SCRIPT.length });
    expect(demoReducer(state, { type: "AUTOPLAY_STEP" })).toBe(state);
  });
});

/* ------------------------------------------------------------------ */
/* AUTOPLAY_STREAM_START                                                 */
/* ------------------------------------------------------------------ */

describe("AUTOPLAY_STREAM_START", () => {
  it("appends an assistant text step, enters assistantStreaming, sets streamingId", () => {
    // Use the first standalone assistant text step in the script.
    const asstTextIdx = DEMO_SCRIPT.findIndex(
      (s) => s.message.role === "assistant" && s.message.kind === "text"
    );
    const state = autoplayState({ stepIndex: asstTextIdx });
    const next = demoReducer(state, { type: "AUTOPLAY_STREAM_START" });
    expect(next.status).toBe("assistantStreaming");
    expect(next.streamingId).toBe(DEMO_SCRIPT[asstTextIdx]?.message.id);
    expect(next.stepIndex).toBe(asstTextIdx + 1);
    expect(next.autoplayContext).toBe(true);
  });

  it("is a no-op when not in autoplay state", () => {
    const asstTextIdx = DEMO_SCRIPT.findIndex(
      (s) => s.message.role === "assistant" && s.message.kind === "text"
    );
    for (const status of ["thinking", "autoTyping", "assistantStreaming"] as const) {
      const state: DemoMachineState = {
        ...getInitialDemoState(),
        status,
        stepIndex: asstTextIdx
      };
      expect(demoReducer(state, { type: "AUTOPLAY_STREAM_START" })).toBe(state);
    }
  });

  it("is a no-op when next step is not an assistant text step", () => {
    // Index 2 is an artifact step.
    const state = autoplayState({ stepIndex: 2 });
    expect(demoReducer(state, { type: "AUTOPLAY_STREAM_START" })).toBe(state);
  });
});

/* ------------------------------------------------------------------ */
/* USER_FOCUS                                                            */
/* ------------------------------------------------------------------ */

describe("USER_FOCUS", () => {
  it("pauses autoplay → takeover without changing messages", () => {
    const state = autoplayState();
    const next = demoReducer(state, { type: "USER_FOCUS" });
    expect(next.status).toBe("takeover");
    expect(next.messages).toEqual(state.messages);
    expect(next.streamingId).toBeNull();
    expect(next.autoplayContext).toBe(false);
  });

  it("transitions from idle → takeover", () => {
    const idleState = { ...getInitialDemoState(), status: "idle" as const };
    expect(demoReducer(idleState, { type: "USER_FOCUS" }).status).toBe("takeover");
  });

  it("interrupts autoTyping → takeover", () => {
    const state = autoTypingState();
    expect(demoReducer(state, { type: "USER_FOCUS" }).status).toBe("takeover");
  });

  it("interrupts assistantStreaming → takeover and clears streamingId", () => {
    const state = streamingState({ autoplayContext: true, streamingId: "m-1" });
    const next = demoReducer(state, { type: "USER_FOCUS" });
    expect(next.status).toBe("takeover");
    expect(next.streamingId).toBeNull();
  });

  it("does not regress from thinking", () => {
    const state = thinkingState();
    expect(demoReducer(state, { type: "USER_FOCUS" })).toBe(state);
  });

  it("is a no-op in reply, limitReached, softReset, and takeover states", () => {
    for (const status of ["reply", "limitReached", "softReset", "takeover"] as const) {
      const state: DemoMachineState = { ...getInitialDemoState(), status };
      expect(demoReducer(state, { type: "USER_FOCUS" })).toBe(state);
    }
  });
});

/* ------------------------------------------------------------------ */
/* USER_SEND                                                             */
/* ------------------------------------------------------------------ */

describe("USER_SEND", () => {
  it("appends a user message with raw text and transitions to thinking", () => {
    const state: DemoMachineState = { ...getInitialDemoState(), status: "takeover" };
    const next = demoReducer(state, { type: "USER_SEND", text: "Hello!", idSeed: "abc" });
    expect(next.status).toBe("thinking");
    const lastMsg = next.messages.at(-1);
    expect(lastMsg).toMatchObject({ id: "abc-u", role: "user", kind: "text", text: "Hello!" });
  });

  it("sets autoplayContext to false (takeover context)", () => {
    const state: DemoMachineState = { ...getInitialDemoState(), status: "takeover" };
    const next = demoReducer(state, { type: "USER_SEND", text: "hi", idSeed: "s1" });
    expect(next.autoplayContext).toBe(false);
  });

  it("stores raw text in the text field, not textKey", () => {
    const state: DemoMachineState = { ...getInitialDemoState(), status: "takeover" };
    const next = demoReducer(state, { type: "USER_SEND", text: "raw input", idSeed: "s1" });
    const lastMsg = next.messages.at(-1);
    expect(lastMsg?.text).toBe("raw input");
    expect(lastMsg?.textKey).toBeUndefined();
  });

  it("derives the message id from idSeed", () => {
    const state: DemoMachineState = { ...getInitialDemoState(), status: "takeover" };
    const next = demoReducer(state, { type: "USER_SEND", text: "x", idSeed: "seed42" });
    expect(next.messages.at(-1)?.id).toBe("seed42-u");
  });

  it("is a no-op when already thinking", () => {
    const state = thinkingState();
    expect(demoReducer(state, { type: "USER_SEND", text: "nope", idSeed: "z" })).toBe(state);
  });

  it("works from autoplay, idle, reply states", () => {
    for (const status of ["autoplay", "idle", "reply"] as const) {
      const state: DemoMachineState = { ...getInitialDemoState(), status };
      expect(demoReducer(state, { type: "USER_SEND", text: "hi", idSeed: "t" }).status).toBe(
        "thinking"
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* REPLY_RECEIVED                                                        */
/* ------------------------------------------------------------------ */

describe("REPLY_RECEIVED", () => {
  it("appends assistant messages and increments replyCount", () => {
    const state = thinkingState({ autoplayContext: false });
    const next = demoReducer(state, { type: "REPLY_RECEIVED", messages: STUB_REPLY });
    expect(next.replyCount).toBe(1);
    expect(next.messages.at(-1)).toEqual(STUB_REPLY[0]);
  });

  it("enters assistantStreaming when first reply is assistant text", () => {
    const state = thinkingState({ autoplayContext: false });
    const next = demoReducer(state, { type: "REPLY_RECEIVED", messages: STUB_REPLY });
    expect(next.status).toBe("assistantStreaming");
    expect(next.streamingId).toBe(STUB_REPLY[0]?.id);
  });

  it("transitions to reply (via streaming) and then limitReached correctly", () => {
    let state = thinkingState({ autoplayContext: false });
    // First reply: → assistantStreaming
    let next = demoReducer(state, { type: "REPLY_RECEIVED", messages: STUB_REPLY });
    expect(next.status).toBe("assistantStreaming");

    // After streaming done → reply
    next = demoReducer(next, { type: "STREAMING_DONE" });
    expect(next.status).toBe("reply");

    // Second reply
    state = { ...next, status: "thinking", autoplayContext: false };
    next = demoReducer(state, { type: "REPLY_RECEIVED", messages: STUB_REPLY });
    next = demoReducer(next, { type: "STREAMING_DONE" });
    expect(next.status).toBe("reply");

    // Third reply → limitReached (via streaming)
    state = { ...next, status: "thinking", autoplayContext: false };
    next = demoReducer(state, { type: "REPLY_RECEIVED", messages: STUB_REPLY });
    next = demoReducer(next, { type: "STREAMING_DONE" });
    expect(next.status).toBe("limitReached");
    expect(next.replyCount).toBe(DEMO_LIMITS.maxReplies);
  });

  it("skips streaming and goes to reply when first reply is not assistant text", () => {
    const nonTextReply: DemoMessage[] = [
      {
        id: "r-0",
        role: "assistant",
        kind: "artifact",
        artifact: { kind: "pdf", filenameKey: "k" }
      }
    ];
    const state = thinkingState({ autoplayContext: false });
    const next = demoReducer(state, { type: "REPLY_RECEIVED", messages: nonTextReply });
    expect(next.status).toBe("reply");
    expect(next.streamingId).toBeNull();
  });

  it("appends multiple reply messages in order", () => {
    const replies: DemoMessage[] = [
      { id: "r1", role: "assistant", kind: "text", textKey: "k1" },
      { id: "r2", role: "assistant", kind: "memory", textKey: "k2" }
    ];
    const state = thinkingState({ autoplayContext: false });
    const next = demoReducer(state, { type: "REPLY_RECEIVED", messages: replies });
    const tail = next.messages.slice(-2);
    expect(tail).toEqual(replies);
  });

  it("is a no-op when not in thinking state", () => {
    for (const status of [
      "idle",
      "autoplay",
      "takeover",
      "reply",
      "limitReached",
      "softReset"
    ] as const) {
      const state: DemoMachineState = { ...getInitialDemoState(), status };
      expect(demoReducer(state, { type: "REPLY_RECEIVED", messages: STUB_REPLY })).toBe(state);
    }
  });
});

/* ------------------------------------------------------------------ */
/* IDLE_RESET                                                            */
/* ------------------------------------------------------------------ */

describe("IDLE_RESET", () => {
  it("transitions to softReset and preserves messages", () => {
    const state = autoplayState({ stepIndex: 3 });
    const next = demoReducer(state, { type: "IDLE_RESET" });
    expect(next.status).toBe("softReset");
    expect(next.messages).toEqual(state.messages);
    expect(next.stepIndex).toBe(state.stepIndex);
  });

  it("works from any state", () => {
    for (const status of [
      "trailer",
      "idle",
      "autoplay",
      "autoTyping",
      "takeover",
      "thinking",
      "assistantStreaming",
      "reply",
      "limitReached",
      "softReset"
    ] as const) {
      const state: DemoMachineState = { ...getInitialDemoState(), status };
      expect(demoReducer(state, { type: "IDLE_RESET" }).status).toBe("softReset");
    }
  });
});

/* ------------------------------------------------------------------ */
/* RESET_DONE                                                            */
/* ------------------------------------------------------------------ */

describe("RESET_DONE", () => {
  it("resets to autoplay with initial messages and zero counters", () => {
    const state: DemoMachineState = {
      status: "softReset",
      stepIndex: 7,
      replyCount: 2,
      messages: [{ id: "x", role: "assistant", kind: "text" }],
      streamingId: "x",
      autoplayContext: true
    };
    const next = demoReducer(state, { type: "RESET_DONE" });
    expect(next.status).toBe("autoplay");
    expect(next.stepIndex).toBe(0);
    expect(next.replyCount).toBe(0);
    expect(next.messages).toEqual(DEMO_INITIAL_MESSAGES);
    expect(next.streamingId).toBeNull();
    expect(next.autoplayContext).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Full autoplay cycle integration                                       */
/* ------------------------------------------------------------------ */

describe("full autoplay cycle: user-turn → thinking → streaming → instant steps", () => {
  it("walks user-0 → assistant-ack-0 → pdf → pptx without state corruption", () => {
    // Start from idle (after trailer done) so the test doesn't depend on
    // TRAILER_DONE timer behavior — that is covered in the TRAILER_DONE suite.
    let state: DemoMachineState = { ...getInitialDemoState(), status: "idle" };

    // Start autoplay
    state = demoReducer(state, { type: "AUTOPLAY_START" });
    expect(state.status).toBe("autoplay");

    // Autoplay drives AUTO_TYPE_START → autoTyping
    state = demoReducer(state, { type: "AUTO_TYPE_START" });
    expect(state.status).toBe("autoTyping");
    expect(state.stepIndex).toBe(0);

    // Typing done → user bubble committed → thinking
    state = demoReducer(state, { type: "AUTO_TYPE_DONE" });
    expect(state.status).toBe("thinking");
    expect(state.autoplayContext).toBe(true);
    expect(state.stepIndex).toBe(1);
    expect(state.messages.at(-1)).toEqual(DEMO_SCRIPT[0]?.message); // user turn

    // Thinking done → assistant text committed → assistantStreaming
    state = demoReducer(state, { type: "THINKING_DONE" });
    expect(state.status).toBe("assistantStreaming");
    expect(state.streamingId).toBe(DEMO_SCRIPT[1]?.message.id);
    expect(state.stepIndex).toBe(2);
    expect(state.messages.at(-1)).toEqual(DEMO_SCRIPT[1]?.message); // assistant ack

    // Streaming done → back to autoplay
    state = demoReducer(state, { type: "STREAMING_DONE" });
    expect(state.status).toBe("autoplay");
    expect(state.streamingId).toBeNull();
    expect(state.stepIndex).toBe(2);

    // Autoplay drives instant PDF artifact step
    state = demoReducer(state, { type: "AUTOPLAY_STEP" });
    expect(state.stepIndex).toBe(3);
    expect(state.messages.at(-1)).toEqual(DEMO_SCRIPT[2]?.message); // pdf artifact

    // Autoplay drives instant PPTX artifact step
    state = demoReducer(state, { type: "AUTOPLAY_STEP" });
    expect(state.stepIndex).toBe(4);
    expect(state.messages.at(-1)).toEqual(DEMO_SCRIPT[3]?.message); // pptx artifact
  });
});

/* ------------------------------------------------------------------ */
/* Full takeover → limitReached → softReset cycle integration           */
/* ------------------------------------------------------------------ */

describe("full autoplay → takeover → limitReached → softReset cycle", () => {
  it("walks the complete happy path without state corruption", () => {
    // Start from idle (trailer is tested separately).
    let state: DemoMachineState = { ...getInitialDemoState(), status: "idle" };

    // Start autoplay
    state = demoReducer(state, { type: "AUTOPLAY_START" });
    state = demoReducer(state, { type: "AUTO_TYPE_START" });
    expect(state.status).toBe("autoTyping");

    // User takes over mid-typing
    state = demoReducer(state, { type: "USER_FOCUS" });
    expect(state.status).toBe("takeover");

    // User sends message
    state = demoReducer(state, { type: "USER_SEND", text: "summarize pdf", idSeed: "turn1" });
    expect(state.status).toBe("thinking");
    expect(state.autoplayContext).toBe(false);

    // Exhaust reply limit (each reply goes through streaming → reply cycle)
    for (let i = 0; i < DEMO_LIMITS.maxReplies; i++) {
      state = demoReducer(state, { type: "REPLY_RECEIVED", messages: STUB_REPLY });
      // First reply enters streaming
      expect(state.status).toBe("assistantStreaming");
      // Streaming completes
      state = demoReducer(state, { type: "STREAMING_DONE" });
      if (i < DEMO_LIMITS.maxReplies - 1) {
        expect(state.status).toBe("reply");
        // Force another thinking round
        state = { ...state, status: "thinking", autoplayContext: false };
      } else {
        expect(state.status).toBe("limitReached");
        expect(state.replyCount).toBe(DEMO_LIMITS.maxReplies);
      }
    }

    // Soft reset
    state = demoReducer(state, { type: "IDLE_RESET" });
    expect(state.status).toBe("softReset");

    state = demoReducer(state, { type: "RESET_DONE" });
    expect(state.status).toBe("autoplay");
    expect(state.stepIndex).toBe(0);
    expect(state.replyCount).toBe(0);
    expect(state.messages).toEqual(DEMO_INITIAL_MESSAGES);
  });
});
