/* ------------------------------------------------------------------ */
/* Types                                                                 */
/* ------------------------------------------------------------------ */

export type DemoMessageKind = "text" | "artifact" | "memory" | "channel";

export interface DemoArtifact {
  kind: "pdf" | "pptx" | "docx";
  filenameKey: string;
  metaKey?: string | undefined;
}

/**
 * A single message in the demo thread.
 *
 * `textKey`  — i18n key for assistant/scripted user copy (never used for
 *              raw user-typed text).
 * `text`     — raw user-typed text from takeover; NOT an i18n key.
 * `artifact` — present when `kind === "artifact"`.
 * `channel`  — present when `kind === "channel"`.
 */
export interface DemoMessage {
  id: string;
  role: "user" | "assistant";
  kind: DemoMessageKind;
  textKey?: string | undefined;
  text?: string | undefined;
  artifact?: DemoArtifact | undefined;
  channel?: "telegram" | undefined;
}

export type DemoPhase = "setup" | "value" | "action" | "memory";

export interface DemoStep {
  phase: DemoPhase;
  message: DemoMessage;
}

/* ------------------------------------------------------------------ */
/* Limits (frozen constants)                                            */
/* ------------------------------------------------------------------ */

export const DEMO_LIMITS = {
  maxReplies: 3,
  idleResetMs: 9000,
  thinkingMs: 520,
  /** Pause before auto-typing a user turn begins. */
  autoTypeStartDelayMs: 360,
  /** Pause after typing completes before the user bubble is committed. */
  autoTypeSubmitDelayMs: 220,
  /** Pause before instant (non-text) assistant steps appear. */
  autoStepDelayMs: 160,
  /** Pause before a standalone assistant text streams (e.g. CTA beat). */
  autoStreamStartDelayMs: 220
} as const;

/* ------------------------------------------------------------------ */
/* Seed (first frame — static, no-JS-safe)                             */
/* ------------------------------------------------------------------ */

export const DEMO_INITIAL_MESSAGES: DemoMessage[] = [
  {
    id: "seed-0",
    role: "assistant",
    kind: "text",
    textKey: "landing.demo.steps.initialGreeting"
  }
];

/* ------------------------------------------------------------------ */
/* Script — the ordered autoplay narrative                              */
/* ------------------------------------------------------------------ */
/*
 * Rule: a user turn MUST precede every assistant text reply.
 * The only exception is a standalone assistant beat (e.g. the CTA),
 * which is reached only after the main user/assistant exchange.
 *
 * Autoplay driver classifies steps as:
 *   user + text    → AUTO_TYPE_START (compose in input, then commit bubble)
 *   assistant + text → THINKING_DONE or AUTOPLAY_STREAM_START (stream in)
 *   assistant + !text → AUTOPLAY_STEP (instant appearance after streaming)
 */

export const DEMO_SCRIPT: DemoStep[] = [
  // ── Action beat ──────────────────────────────────────────────────
  // USER: requests PDF summary + slide deck
  {
    phase: "action",
    message: {
      id: "script-user-0",
      role: "user",
      kind: "text",
      textKey: "landing.demo.steps.summarizePdf"
    }
  },
  // ASSISTANT: streaming ack
  {
    phase: "action",
    message: {
      id: "script-action-ack-0",
      role: "assistant",
      kind: "text",
      textKey: "landing.demo.steps.preparing"
    }
  },
  // ASSISTANT: source PDF artifact pill (instant, after streaming)
  {
    phase: "action",
    message: {
      id: "script-action-pdf-0",
      role: "assistant",
      kind: "artifact",
      artifact: {
        kind: "pdf",
        filenameKey: "landing.demo.artifacts.reportPdf",
        metaKey: "landing.demo.artifacts.reportPdfMeta"
      }
    }
  },
  // ASSISTANT: produced PPTX summary pill (instant)
  {
    phase: "action",
    message: {
      id: "script-action-pptx-0",
      role: "assistant",
      kind: "artifact",
      artifact: {
        kind: "pptx",
        filenameKey: "landing.demo.artifacts.summaryPptx",
        metaKey: "landing.demo.artifacts.summaryPptxMeta"
      }
    }
  },

  // ── Memory beat ───────────────────────────────────────────────────
  // USER: sets tone preference
  {
    phase: "memory",
    message: {
      id: "script-memory-user-0",
      role: "user",
      kind: "text",
      textKey: "landing.demo.steps.rememberPreference"
    }
  },
  // ASSISTANT: streaming ack for memory preference
  {
    phase: "memory",
    message: {
      id: "script-memory-ack-0",
      role: "assistant",
      kind: "text",
      textKey: "landing.demo.steps.memoryAck"
    }
  }
];

/* ------------------------------------------------------------------ */
/* Suggested prompts (takeover chips)                                   */
/* ------------------------------------------------------------------ */

export type StubIntent = "document" | "memory" | "generic";

export const SUGGESTED_PROMPTS: {
  id: string;
  labelKey: string;
  intent: StubIntent;
}[] = [
  {
    id: "prompt-document",
    labelKey: "landing.demo.prompts.summarizePdf",
    intent: "document"
  },
  {
    id: "prompt-memory",
    labelKey: "landing.demo.prompts.rememberPreference",
    intent: "memory"
  }
];

/* ------------------------------------------------------------------ */
/* Intent classifier                                                    */
/* ------------------------------------------------------------------ */

const DOCUMENT_RE = /pdf|summary|document|слайд|презентац/i;
const MEMORY_RE = /remember|запомни|memory/i;

/** Keyword-based intent classifier for takeover user input. Pure and deterministic. */
export function classifyIntent(userText: string): StubIntent {
  if (DOCUMENT_RE.test(userText)) return "document";
  if (MEMORY_RE.test(userText)) return "memory";
  return "generic";
}

/* ------------------------------------------------------------------ */
/* Stub reply resolver                                                  */
/* ------------------------------------------------------------------ */

/**
 * Returns 1–2 deterministic assistant `DemoMessage`s for a given intent.
 * All copy is represented as i18n keys; no marketing prose is hardcoded.
 * IDs are derived from `idSeed` so callers remain pure (no Date.now/random).
 */
export function getStubReply(intent: StubIntent, idSeed: string): DemoMessage[] {
  switch (intent) {
    case "document":
      return [
        {
          id: `${idSeed}-0`,
          role: "assistant",
          kind: "text",
          textKey: "landing.demo.stub.documentAck"
        },
        {
          id: `${idSeed}-1`,
          role: "assistant",
          kind: "artifact",
          artifact: {
            kind: "pdf",
            filenameKey: "landing.demo.stub.documentFilename",
            metaKey: "landing.demo.stub.documentMeta"
          }
        }
      ];
    case "memory":
      return [
        {
          id: `${idSeed}-0`,
          role: "assistant",
          kind: "text",
          textKey: "landing.demo.stub.memoryAck"
        }
      ];
    default:
      return [
        {
          id: `${idSeed}-0`,
          role: "assistant",
          kind: "text",
          textKey: "landing.demo.stub.genericAck"
        }
      ];
  }
}
