import { useReducer, type Dispatch } from "react";
import { DEMO_INITIAL_MESSAGES, DEMO_LIMITS, DEMO_SCRIPT, type DemoMessage } from "./demo-script";

/* ------------------------------------------------------------------ */
/* State shape                                                           */
/* ------------------------------------------------------------------ */

export type DemoStatus =
  | "trailer" // opening setup-wizard animation (plays once per mount)
  | "idle"
  | "autoplay" // between script steps, deciding what to execute next
  | "autoTyping" // typing a user message into the composer char-by-char
  | "thinking" // brief pause before the assistant replies
  | "assistantStreaming" // streaming an assistant text message into the thread
  | "takeover" // visitor has taken over (autoplay paused)
  | "reply" // a takeover stub reply has been committed
  | "limitReached" // visitor used all allowed takeover replies
  | "softReset"; // thread fading out before restarting

export interface DemoMachineState {
  status: DemoStatus;
  /** 0-based cursor into DEMO_SCRIPT — the NEXT step to execute. */
  stepIndex: number;
  /** Number of visitor-triggered stub reply rounds consumed. */
  replyCount: number;
  /** Full visible thread. */
  messages: DemoMessage[];
  /**
   * ID of the assistant text message currently streaming.
   * Null when nothing is streaming.
   */
  streamingId: string | null;
  /**
   * True when `thinking` / `assistantStreaming` is part of the autoplay
   * sequence. False during a visitor-triggered (takeover) exchange.
   */
  autoplayContext: boolean;
}

/* ------------------------------------------------------------------ */
/* Events                                                               */
/* ------------------------------------------------------------------ */

export type DemoEvent =
  // ── Trailer lifecycle ────────────────────────────────────────────
  /** Opening animation finished — transition to idle so autoplay can start. */
  | { type: "TRAILER_DONE" }
  /** Opening animation finished, but keep autoplay paused on an alternate chat. */
  | { type: "TRAILER_DONE_PAUSED" }
  // ── Autoplay lifecycle ───────────────────────────────────────────
  | { type: "AUTOPLAY_START" }
  /** Begin typing the current user-turn step into the composer. */
  | { type: "AUTO_TYPE_START" }
  /** Typing complete — commit the user bubble and start thinking. */
  | { type: "AUTO_TYPE_DONE" }
  /** Thinking pause over — start streaming the next assistant text step. */
  | { type: "THINKING_DONE" }
  /** Streaming complete — return to autoplay (or reply/limitReached). */
  | { type: "STREAMING_DONE" }
  /** Commit an instant (non-text) assistant step and stay in autoplay. */
  | { type: "AUTOPLAY_STEP" }
  /** Start streaming a standalone assistant text step reached in autoplay. */
  | { type: "AUTOPLAY_STREAM_START" }
  // ── Visitor takeover ─────────────────────────────────────────────
  | { type: "USER_FOCUS" }
  | { type: "USER_SEND"; text: string; idSeed: string }
  | { type: "REPLY_RECEIVED"; messages: DemoMessage[] }
  // ── Reset lifecycle ───────────────────────────────────────────────
  | { type: "IDLE_RESET" }
  | { type: "RESET_DONE" };

/* ------------------------------------------------------------------ */
/* Initial state                                                         */
/* ------------------------------------------------------------------ */

export function getInitialDemoState(): DemoMachineState {
  return {
    status: "trailer",
    stepIndex: 0,
    replyCount: 0,
    messages: [...DEMO_INITIAL_MESSAGES],
    streamingId: null,
    autoplayContext: false
  };
}

/* ------------------------------------------------------------------ */
/* Pure reducer                                                          */
/* ------------------------------------------------------------------ */

/**
 * Pure reducer — no side effects, no timers, no Date.now/Math.random.
 *
 * Trailer transition table:
 *   TRAILER_DONE : trailer → idle (then AUTOPLAY_START fires after 600ms delay)
 *
 * Autoplay transition table:
 *   AUTOPLAY_START        : idle → autoplay
 *   AUTO_TYPE_START       : autoplay (user-text step) → autoTyping
 *   AUTO_TYPE_DONE        : autoTyping → commit user bubble → thinking (autoplayContext=true)
 *   THINKING_DONE         : thinking (autoplay) → commit assistant text → assistantStreaming
 *   STREAMING_DONE        : assistantStreaming (autoplay) → autoplay
 *                         : assistantStreaming (takeover) → reply | limitReached
 *   AUTOPLAY_STEP         : autoplay (instant step) → append step, stepIndex++
 *   AUTOPLAY_STREAM_START : autoplay (standalone asst text) → assistantStreaming
 *
 * Takeover transition table:
 *   USER_FOCUS    : autoplay | idle | autoTyping | assistantStreaming → takeover
 *   USER_SEND     : non-thinking → append user msg → thinking (autoplayContext=false)
 *   REPLY_RECEIVED: thinking → append reply msgs → assistantStreaming | reply | limitReached
 *
 * Reset table:
 *   IDLE_RESET : * → softReset
 *   RESET_DONE : * → autoplay, clear to seed state  (trailer is NOT replayed on loops)
 */
export function demoReducer(state: DemoMachineState, event: DemoEvent): DemoMachineState {
  switch (event.type) {
    // ── Trailer lifecycle ──────────────────────────────────────────

    case "TRAILER_DONE": {
      if (state.status !== "trailer") return state;
      return { ...state, status: "idle" };
    }

    case "TRAILER_DONE_PAUSED": {
      if (state.status !== "trailer") return state;
      return { ...state, status: "takeover" };
    }

    // ── Autoplay lifecycle ─────────────────────────────────────────

    case "AUTOPLAY_START": {
      if (state.status !== "idle") return state;
      return { ...state, status: "autoplay" };
    }

    case "AUTO_TYPE_START": {
      if (state.status !== "autoplay") return state;
      const step = DEMO_SCRIPT[state.stepIndex];
      if (step === undefined || step.message.role !== "user" || step.message.kind !== "text") {
        return state;
      }
      return { ...state, status: "autoTyping" };
    }

    case "AUTO_TYPE_DONE": {
      if (state.status !== "autoTyping") return state;
      const step = DEMO_SCRIPT[state.stepIndex];
      if (step === undefined || step.message.role !== "user") return state;
      return {
        ...state,
        status: "thinking",
        messages: [...state.messages, step.message],
        stepIndex: state.stepIndex + 1,
        autoplayContext: true
      };
    }

    case "THINKING_DONE": {
      if (state.status !== "thinking" || !state.autoplayContext) return state;
      const step = DEMO_SCRIPT[state.stepIndex];
      if (step === undefined || step.message.role !== "assistant" || step.message.kind !== "text") {
        return state;
      }
      return {
        ...state,
        status: "assistantStreaming",
        messages: [...state.messages, step.message],
        stepIndex: state.stepIndex + 1,
        streamingId: step.message.id
      };
    }

    case "STREAMING_DONE": {
      if (state.status !== "assistantStreaming") return state;
      if (state.autoplayContext) {
        return { ...state, status: "autoplay", streamingId: null };
      }
      const doneStatus = state.replyCount >= DEMO_LIMITS.maxReplies ? "limitReached" : "reply";
      return { ...state, status: doneStatus, streamingId: null };
    }

    case "AUTOPLAY_STEP": {
      if (state.status !== "autoplay") return state;
      const step = DEMO_SCRIPT[state.stepIndex];
      if (step === undefined) return state;
      return {
        ...state,
        messages: [...state.messages, step.message],
        stepIndex: state.stepIndex + 1
      };
    }

    case "AUTOPLAY_STREAM_START": {
      if (state.status !== "autoplay") return state;
      const step = DEMO_SCRIPT[state.stepIndex];
      if (step === undefined || step.message.role !== "assistant" || step.message.kind !== "text") {
        return state;
      }
      return {
        ...state,
        status: "assistantStreaming",
        messages: [...state.messages, step.message],
        stepIndex: state.stepIndex + 1,
        streamingId: step.message.id,
        autoplayContext: true
      };
    }

    // ── Visitor takeover ───────────────────────────────────────────

    case "USER_FOCUS": {
      // Never regress from thinking; pause from any autoplay-phase or idle.
      if (state.status === "thinking") return state;
      if (
        state.status === "autoplay" ||
        state.status === "idle" ||
        state.status === "autoTyping" ||
        state.status === "assistantStreaming"
      ) {
        return {
          ...state,
          status: "takeover",
          streamingId: null,
          autoplayContext: false
        };
      }
      return state;
    }

    case "USER_SEND": {
      if (state.status === "thinking") return state;
      const userMsg: DemoMessage = {
        id: `${event.idSeed}-u`,
        role: "user",
        kind: "text",
        text: event.text
      };
      return {
        ...state,
        status: "thinking",
        messages: [...state.messages, userMsg],
        autoplayContext: false
      };
    }

    case "REPLY_RECEIVED": {
      if (state.status !== "thinking") return state;
      const newReplyCount = state.replyCount + 1;
      const firstMsg = event.messages[0];
      const shouldStream =
        firstMsg !== undefined && firstMsg.role === "assistant" && firstMsg.kind === "text";
      return {
        ...state,
        status: shouldStream
          ? "assistantStreaming"
          : newReplyCount >= DEMO_LIMITS.maxReplies
            ? "limitReached"
            : "reply",
        replyCount: newReplyCount,
        messages: [...state.messages, ...event.messages],
        streamingId: shouldStream ? firstMsg.id : null
      };
    }

    // ── Reset lifecycle ────────────────────────────────────────────

    case "IDLE_RESET": {
      return { ...state, status: "softReset" };
    }

    case "RESET_DONE": {
      return {
        status: "autoplay",
        stepIndex: 0,
        replyCount: 0,
        messages: [...DEMO_INITIAL_MESSAGES],
        streamingId: null,
        autoplayContext: false
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Hook                                                                  */
/* ------------------------------------------------------------------ */

export function useDemoMachine(): { state: DemoMachineState; dispatch: Dispatch<DemoEvent> } {
  const [state, dispatch] = useReducer(demoReducer, undefined, getInitialDemoState);
  return { state, dispatch };
}
