"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { Route } from "next";
import { useDemoMachine } from "./use-demo-machine";
import { useIdleTimer } from "./use-idle-timer";
import { useTypewriter } from "./use-typewriter";
import {
  DEMO_LIMITS,
  DEMO_SCRIPT,
  SUGGESTED_PROMPTS,
  classifyIntent,
  getStubReply,
  type DemoMessage,
  type StubIntent
} from "./demo-script";
import { DemoWindow, DemoComposer, type DemoChatMode, type DemoModeChipProps } from "./demo-window";
import {
  AssistantRow,
  UserBubble,
  ArtifactPill,
  MemoryChip,
  ChannelFrame,
  StreamingCursor
} from "./chat-atoms";
import { AssistantBuilder } from "./assistant-builder";

/* ------------------------------------------------------------------ */
/* Timing constants                                                      */
/* ------------------------------------------------------------------ */

/**
 * Delay between TRAILER_DONE → idle and AUTOPLAY_START (ms).
 * Kept at 600 ms matching the original mount-delay behaviour.
 */
const AUTOPLAY_START_DELAY_MS = 600;

/* ------------------------------------------------------------------ */
/* Static thread content for non-primary sidebar chats                  */
/* ------------------------------------------------------------------ */

const PRIMARY_CHAT_ID = "c1";
const MEDIA_ORIGINAL_SRC = "/landing/media-demo/selfie-original.png";
const MEDIA_RESULT_SRC = "/landing/media-demo/selfie-cartoon.png";

function StaticMediaImage({
  src,
  alt,
  align = "left"
}: {
  src: string;
  alt: string;
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "flex justify-end py-2" : "flex justify-start py-2"}>
      <img
        src={src}
        alt={alt}
        className="max-h-48 max-w-[240px] rounded-[14px] border border-border object-cover shadow-sm"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MessageRow — renders one thread message, with streaming support      */
/* ------------------------------------------------------------------ */

interface MessageRowProps {
  message: DemoMessage;
  isStreaming: boolean;
  showAssistantAvatar?: boolean | undefined;
  reducedMotion: boolean;
  onStreamDone: (() => void) | undefined;
  /** Stable translation helper. */
  tx: (key: string) => string;
}

/**
 * Renders a single demo thread message. When `isStreaming` is true and the
 * message is assistant text, the text is revealed character-by-character via
 * `useTypewriter` and a `StreamingCursor` is shown until complete.
 * Calls `onStreamDone` once when streaming finishes.
 */
function MessageRow({
  message: m,
  isStreaming,
  showAssistantAvatar = true,
  reducedMotion,
  onStreamDone,
  tx
}: MessageRowProps) {
  const streamText =
    isStreaming && m.kind === "text" ? (m.textKey ? tx(m.textKey) : (m.text ?? "")) : "";

  const { visibleText, isDone } = useTypewriter(streamText, reducedMotion);

  useEffect(() => {
    if (isStreaming && isDone) {
      onStreamDone?.();
    }
  }, [isStreaming, isDone, onStreamDone]);

  if (m.role === "user") {
    return <UserBubble>{m.text ?? tx(m.textKey ?? "")}</UserBubble>;
  }

  switch (m.kind) {
    case "text": {
      if (m.textKey === "landing.demo.stub.genericAck") {
        return (
          <AssistantRow showAvatar={showAssistantAvatar}>
            <span>{tx("landing.demo.stub.genericAckPrefix")} </span>
            <Link
              href={"/sign-up" as Route}
              className="font-medium text-accent transition-colors hover:text-accent-hover"
            >
              {tx("landing.demo.stub.genericAckLink")}
            </Link>
          </AssistantRow>
        );
      }
      const displayText = isStreaming ? visibleText : tx(m.textKey ?? "");
      return (
        <AssistantRow showAvatar={showAssistantAvatar}>
          {displayText}
          {isStreaming && !isDone && <StreamingCursor reducedMotion={reducedMotion} />}
        </AssistantRow>
      );
    }
    case "artifact":
      return (
        <AssistantRow showAvatar={showAssistantAvatar}>
          <ArtifactPill
            kind={m.artifact!.kind}
            filename={tx(m.artifact!.filenameKey)}
            meta={m.artifact?.metaKey ? tx(m.artifact.metaKey) : undefined}
          />
        </AssistantRow>
      );
    case "memory":
      return (
        <div className="flex justify-start py-1 pl-[3.25rem]">
          <MemoryChip label={tx(m.textKey ?? "")} />
        </div>
      );
    case "channel":
      return (
        <AssistantRow showAvatar={showAssistantAvatar}>
          <ChannelFrame label={tx("landing.demo.channelLabel")}>
            <p className="text-sm text-text-muted">{tx(m.textKey ?? "")}</p>
          </ChannelFrame>
        </AssistantRow>
      );
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* HeroDemo island                                                       */
/* ------------------------------------------------------------------ */

export function HeroDemo() {
  const t = useTranslations();
  const { state, dispatch } = useDemoMachine();
  const shouldReduceMotion = useReducedMotion() ?? false;

  // The whole demo (trailer → autoplay) must only START after the visitor has
  // actively scrolled to the product window. Do not auto-start on mount: browsers
  // can restore scroll near the demo, and a mount-time check makes the trailer
  // complete before the visitor ever sees the creation flow.
  const demoWindowRef = useRef<HTMLDivElement>(null);
  const [hasReachedDemoWindow, setHasReachedDemoWindow] = useState(false);

  const [composerValue, setComposerValue] = useState("");

  // Active sidebar chat id — "c1" is the live thread, others show static content.
  const [activeChatId, setActiveChatId] = useState(PRIMARY_CHAT_ID);
  const [secondaryThreadMessages, setSecondaryThreadMessages] = useState<Record<string, string[]>>({
    c2: [],
    c3: []
  });

  // Current mode chip selection — visual only, does not affect thread content.
  const [chatMode, setChatMode] = useState<DemoChatMode>("normal");

  // Monotonically increasing seed for takeover reply IDs.
  const idSeedRef = useRef(0);
  const threadViewportRef = useRef<HTMLDivElement>(null);
  // Holds intent + seed for the in-flight takeover thinking phase.
  const pendingReplyRef = useRef<{ intent: StubIntent; seed: string } | null>(null);
  // Always-current state ref so effect callbacks don't capture stale closures.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Cast dynamic keys to the typed t() parameter.
  const tx = useCallback((key: string) => t(key as Parameters<typeof t>[0]), [t]);

  // Stable callback for STREAMING_DONE dispatch.
  const handleStreamDone = useCallback(() => {
    dispatch({ type: "STREAMING_DONE" });
  }, [dispatch]);

  /* ---------------------------------------------------------------- */
  /* Auto-typing: composer-level typewriter during autoTyping state    */
  /* ---------------------------------------------------------------- */

  const isAutoTyping = state.status === "autoTyping";
  const autoTypingStep = isAutoTyping ? DEMO_SCRIPT[state.stepIndex] : undefined;
  const autoTypingTextKey = autoTypingStep?.message.textKey ?? "";
  const autoTypingText = autoTypingTextKey ? tx(autoTypingTextKey) : "";

  const { visibleText: composerTypedText, isDone: composerTypingDone } = useTypewriter(
    isAutoTyping ? autoTypingText : "",
    shouldReduceMotion
  );

  // Composer display value: auto-typed text during autoTyping, user-controlled otherwise.
  const composerDisplayValue = isAutoTyping ? composerTypedText : composerValue;

  /* ---------------------------------------------------------------- */
  /* Idle timer                                                         */
  /* ---------------------------------------------------------------- */

  const isAutoplayDone = state.status === "autoplay" && state.stepIndex >= DEMO_SCRIPT.length;
  const idleTimerEnabled =
    state.status === "takeover" ||
    state.status === "reply" ||
    state.status === "limitReached" ||
    isAutoplayDone;
  const isOnPrimaryChat = activeChatId === PRIMARY_CHAT_ID;

  const { reset: resetIdleTimer } = useIdleTimer({
    enabled: idleTimerEnabled,
    idleMs: DEMO_LIMITS.idleResetMs,
    onIdle: () => dispatch({ type: "IDLE_RESET" })
  });

  /* ---------------------------------------------------------------- */
  /* Effects / timers                                                   */
  /* ---------------------------------------------------------------- */

  // 0. Park the trailer until the product window is the thing the visitor is
  // actually looking at. We require the window's top to be well inside the
  // viewport, not just barely intersecting near the fold.
  useEffect(() => {
    if (hasReachedDemoWindow) return;

    const checkReached = () => {
      const el = demoWindowRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const reached = rect.top < viewportHeight * 0.72 && rect.bottom > viewportHeight * 0.25;
      if (reached) {
        setHasReachedDemoWindow(true);
      }
    };

    window.addEventListener("scroll", checkReached, { passive: true });
    window.addEventListener("resize", checkReached);
    return () => {
      window.removeEventListener("scroll", checkReached);
      window.removeEventListener("resize", checkReached);
    };
  }, [hasReachedDemoWindow]);

  // 1. Start autoplay after a short delay once we reach idle (after trailer).
  useEffect(() => {
    if (state.status !== "idle") return;
    const id = setTimeout(() => dispatch({ type: "AUTOPLAY_START" }), AUTOPLAY_START_DELAY_MS);
    return () => clearTimeout(id);
  }, [state.status, dispatch]);

  // Keep the live thread pinned to the newest beat during autoplay/streaming.
  useEffect(() => {
    if (!isOnPrimaryChat) return;
    const el = threadViewportRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: shouldReduceMotion ? "auto" : "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [
    isOnPrimaryChat,
    state.messages.length,
    state.status,
    state.streamingId,
    composerDisplayValue,
    shouldReduceMotion
  ]);

  // 2. Autoplay driver: decide what to do with the next script step.
  useEffect(() => {
    if (state.status !== "autoplay") return;
    const nextStep = DEMO_SCRIPT[state.stepIndex];
    if (nextStep === undefined) return; // all steps done — idle timer handles reset

    const { role, kind } = nextStep.message;

    if (role === "user" && kind === "text") {
      // Pause briefly before typing starts.
      const delay = shouldReduceMotion ? 0 : DEMO_LIMITS.autoTypeStartDelayMs;
      const id = setTimeout(() => dispatch({ type: "AUTO_TYPE_START" }), delay);
      return () => clearTimeout(id);
    }

    if (role === "assistant" && kind === "text") {
      // Standalone assistant text (e.g. CTA) — stream directly.
      const delay = shouldReduceMotion ? 0 : DEMO_LIMITS.autoStreamStartDelayMs;
      const id = setTimeout(() => dispatch({ type: "AUTOPLAY_STREAM_START" }), delay);
      return () => clearTimeout(id);
    }

    // Instant steps (artifact, memory, channel) — brief visual pause then commit.
    const delay = shouldReduceMotion ? 0 : DEMO_LIMITS.autoStepDelayMs;
    const id = setTimeout(() => dispatch({ type: "AUTOPLAY_STEP" }), delay);
    return () => clearTimeout(id);
  }, [state.status, state.stepIndex, dispatch, shouldReduceMotion]);

  // 3. Auto-typing → submit: after typing is done, commit the user bubble.
  useEffect(() => {
    if (state.status !== "autoTyping" || !composerTypingDone) return;
    const delay = shouldReduceMotion ? 0 : DEMO_LIMITS.autoTypeSubmitDelayMs;
    const id = setTimeout(() => {
      dispatch({ type: "AUTO_TYPE_DONE" });
    }, delay);
    return () => clearTimeout(id);
  }, [state.status, composerTypingDone, dispatch, shouldReduceMotion]);

  // 4. Thinking (autoplay context) → THINKING_DONE.
  useEffect(() => {
    if (state.status !== "thinking" || !state.autoplayContext) return;
    const id = setTimeout(() => dispatch({ type: "THINKING_DONE" }), DEMO_LIMITS.thinkingMs);
    return () => clearTimeout(id);
  }, [state.status, state.autoplayContext, dispatch]);

  // 5. Thinking (takeover context) → resolve stub reply.
  useEffect(() => {
    if (state.status !== "thinking" || state.autoplayContext) return;
    const pending = pendingReplyRef.current;
    if (!pending) return;
    const messages = getStubReply(pending.intent, pending.seed);
    const id = setTimeout(() => {
      pendingReplyRef.current = null;
      dispatch({ type: "REPLY_RECEIVED", messages });
    }, DEMO_LIMITS.thinkingMs);
    return () => clearTimeout(id);
  }, [state.status, state.autoplayContext, dispatch]);

  // 6. Soft-reset fade: dispatch RESET_DONE after the fade-out duration.
  useEffect(() => {
    if (state.status !== "softReset") return;
    const id = setTimeout(() => {
      // After reset, switch back to the primary chat so the live thread is visible.
      setActiveChatId(PRIMARY_CHAT_ID);
      dispatch({ type: "RESET_DONE" });
    }, 450);
    return () => clearTimeout(id);
  }, [state.status, dispatch]);

  /* ---------------------------------------------------------------- */
  /* Interaction handlers                                               */
  /* ---------------------------------------------------------------- */

  const handleFocus = useCallback(() => {
    const s = stateRef.current;
    if (
      s.status === "autoplay" ||
      s.status === "idle" ||
      s.status === "autoTyping" ||
      s.status === "assistantStreaming"
    ) {
      dispatch({ type: "USER_FOCUS" });
    }
    resetIdleTimer();
  }, [dispatch, resetIdleTimer]);

  const handleChange = useCallback(
    (value: string) => {
      const s = stateRef.current;
      if (
        s.status === "autoplay" ||
        s.status === "autoTyping" ||
        s.status === "assistantStreaming"
      ) {
        dispatch({ type: "USER_FOCUS" });
      }
      setComposerValue(value);
      resetIdleTimer();
    },
    [dispatch, resetIdleTimer]
  );

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      if (activeChatId !== PRIMARY_CHAT_ID) {
        setSecondaryThreadMessages((prev) => ({
          ...prev,
          [activeChatId]: [...(prev[activeChatId] ?? []), trimmed]
        }));
        setComposerValue("");
        resetIdleTimer();
        return;
      }

      const s = stateRef.current;
      if (s.status === "thinking" || s.status === "limitReached") return;
      idSeedRef.current += 1;
      const seed = String(idSeedRef.current);
      pendingReplyRef.current = { intent: classifyIntent(trimmed), seed };
      dispatch({ type: "USER_SEND", text: trimmed, idSeed: seed });
      setComposerValue("");
      resetIdleTimer();
    },
    [activeChatId, dispatch, resetIdleTimer]
  );

  const handleChipClick = useCallback(
    (labelKey: string, intent: StubIntent) => {
      const label = tx(labelKey);
      const s = stateRef.current;
      if (
        s.status === "autoplay" ||
        s.status === "idle" ||
        s.status === "autoTyping" ||
        s.status === "assistantStreaming"
      ) {
        dispatch({ type: "USER_FOCUS" });
      }
      if (s.status === "thinking" || s.status === "limitReached") return;
      idSeedRef.current += 1;
      const seed = String(idSeedRef.current);
      pendingReplyRef.current = { intent, seed };
      dispatch({ type: "USER_SEND", text: label, idSeed: seed });
      resetIdleTimer();
    },
    [dispatch, tx, resetIdleTimer]
  );

  /**
   * Sidebar chat row clicked.
   * - Switching away from the primary chat pauses autoplay (like USER_FOCUS).
   * - Switching back to primary just updates the local active-chat id; machine
   *   state is unchanged (if paused, the user can click "Replay" to resume).
   * - Composer is disabled on non-primary chats (no live machine interaction).
   */
  const handleChatSelect = useCallback(
    (id: string) => {
      setActiveChatId(id);
      if (id !== PRIMARY_CHAT_ID) {
        const s = stateRef.current;
        if (
          s.status === "autoplay" ||
          s.status === "idle" ||
          s.status === "autoTyping" ||
          s.status === "assistantStreaming"
        ) {
          dispatch({ type: "USER_FOCUS" });
        }
      }
    },
    [dispatch]
  );

  const isPaused =
    state.status === "takeover" || state.status === "reply" || state.status === "limitReached";

  const handlePauseReplay = useCallback(() => {
    if (isPaused) {
      dispatch({ type: "RESET_DONE" });
    } else {
      dispatch({ type: "USER_FOCUS" });
    }
  }, [isPaused, dispatch]);

  /* ---------------------------------------------------------------- */
  /* Derived display flags                                              */
  /* ---------------------------------------------------------------- */

  const isComposerDisabled =
    isOnPrimaryChat && (state.status === "thinking" || state.status === "limitReached");

  // Suggested chips are shown only during takeover interaction phases on the primary chat.
  const showSuggestedPrompts =
    isOnPrimaryChat &&
    state.status !== "idle" &&
    state.status !== "trailer" &&
    state.status !== "thinking" &&
    state.status !== "softReset" &&
    state.status !== "limitReached";

  // Fade the thread out during soft reset.
  const threadOpacityClass =
    state.status === "softReset"
      ? "opacity-0 transition-opacity duration-[450ms]"
      : "opacity-100 transition-opacity duration-200";

  /* ---------------------------------------------------------------- */
  /* Mode chip labels                                                   */
  /* ---------------------------------------------------------------- */

  const modeLabels: DemoModeChipProps["labels"] = {
    normal: tx("landing.demo.modes.normal"),
    smart: tx("landing.demo.modes.smart"),
    project: tx("landing.demo.modes.project"),
    normalCaption: tx("landing.demo.modes.normalCaption"),
    smartCaption: tx("landing.demo.modes.smartCaption"),
    projectCaption: tx("landing.demo.modes.projectCaption")
  };

  /* ---------------------------------------------------------------- */
  /* Sidebar chat rows                                                  */
  /* ---------------------------------------------------------------- */

  const chats = [
    { id: "c1", title: tx("landing.demo.sidebar.chat1"), active: activeChatId === "c1" },
    { id: "c2", title: tx("landing.demo.sidebar.chat2"), active: activeChatId === "c2" },
    { id: "c3", title: tx("landing.demo.sidebar.chat3"), active: activeChatId === "c3" }
  ];

  /* ---------------------------------------------------------------- */
  /* Composer                                                            */
  /* ---------------------------------------------------------------- */

  const composer = (
    <DemoComposer
      placeholder={tx("landing.demo.composerPlaceholder")}
      value={isOnPrimaryChat ? composerDisplayValue : composerValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onSubmit={handleSubmit}
      disabled={isComposerDisabled}
    />
  );

  /* ---------------------------------------------------------------- */
  /* Trailer labels                                                     */
  /* ---------------------------------------------------------------- */

  const trailerLabels = {
    ariaLabel: tx("landing.demo.trailer.ariaLabel"),
    title: tx("landing.demo.trailer.title"),
    subtitle: tx("landing.demo.trailer.subtitle"),
    nameLabel: tx("landing.demo.trailer.nameLabel"),
    namePlaceholder: tx("landing.demo.trailer.namePlaceholder"),
    configuring: tx("landing.demo.trailer.configuring"),
    toneName: tx("landing.demo.trailer.toneName"),
    toneCaption: tx("landing.demo.trailer.toneCaption"),
    skillName: tx("landing.demo.trailer.skillName"),
    skillCaption: tx("landing.demo.trailer.skillCaption")
  };

  /* ---------------------------------------------------------------- */
  /* Thread / content area                                              */
  /* ---------------------------------------------------------------- */

  const showTrailer = state.status === "trailer";

  // Static thread for the secondary media chat (c2)
  const staticMediaThread = (
    <div>
      <StaticMediaImage
        src={MEDIA_ORIGINAL_SRC}
        alt={tx("landing.blocks.media.originalAlt")}
        align="right"
      />
      <UserBubble>{tx("landing.blocks.media.userPrompt")}</UserBubble>
      <AssistantRow>{tx("landing.blocks.media.workingReply")}</AssistantRow>
      <AssistantRow showAvatar={false}>{tx("landing.blocks.media.assistantReply")}</AssistantRow>
      <AssistantRow showAvatar={false}>
        <StaticMediaImage src={MEDIA_RESULT_SRC} alt={tx("landing.blocks.media.resultAlt")} />
      </AssistantRow>
      {(secondaryThreadMessages.c2 ?? []).map((message, index) => (
        <UserBubble key={`c2-user-${index}`}>{message}</UserBubble>
      ))}
    </div>
  );

  const newChatMessages = secondaryThreadMessages.c3 ?? [];

  // Empty-state for "New chat" (c3), then local user messages once typed.
  const staticEmptyThread = (
    <>
      {newChatMessages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center py-12 text-center">
          <p className="text-sm text-text-subtle">{tx("landing.demo.staticThread.emptyHint")}</p>
        </div>
      ) : (
        <div>
          {newChatMessages.map((message, index) => (
            <UserBubble key={`c3-user-${index}`}>{message}</UserBubble>
          ))}
        </div>
      )}
    </>
  );

  // Primary (live) thread
  const liveThread = (
    <div className={threadOpacityClass}>
      <AnimatePresence initial={false}>
        {state.messages.map((m, index) => {
          const isStreaming = m.id === state.streamingId;
          const previous = state.messages[index - 1];
          const showAssistantAvatar = m.role === "assistant" && previous?.role !== "assistant";
          return (
            <motion.div
              key={m.id}
              initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                shouldReduceMotion ? { duration: 0 } : { duration: 0.22, ease: "easeOut" }
              }
            >
              <MessageRow
                message={m}
                isStreaming={isStreaming}
                showAssistantAvatar={showAssistantAvatar}
                reducedMotion={shouldReduceMotion}
                onStreamDone={isStreaming ? handleStreamDone : undefined}
                tx={tx}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Thinking indicator — shown during thinking pause (both autoplay and takeover) */}
      {state.status === "thinking" && (
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
        >
          <AssistantRow>
            <StreamingCursor reducedMotion={shouldReduceMotion} />
          </AssistantRow>
        </motion.div>
      )}

      {/* Limit CTA */}
      {state.status === "limitReached" && (
        <div className="mt-2 flex justify-center py-3">
          <Link
            href={"/sign-up" as Route}
            className="inline-flex items-center rounded-full border border-[rgba(72,91,79,0.28)] bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(52,68,58,0.18)] transition-colors hover:bg-accent-hover dark:border-[#a8baa0]/35 dark:bg-[#8faa9a] dark:text-[#f6f0e8] dark:hover:bg-[#9ab5a4]"
          >
            {tx("landing.demo.limitCta")}
          </Link>
        </div>
      )}

      {/* Suggested prompt chips */}
      {showSuggestedPrompts && (
        <div
          className="flex flex-wrap gap-2 pt-3 pb-1"
          role="group"
          aria-label={tx("landing.demo.suggestedPromptsLabel")}
        >
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleChipClick(p.labelKey, p.intent)}
              className="rounded-full border border-border/70 bg-surface-raised/60 px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text"
            >
              {tx(p.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Decide which content to show inside the thread area for non-primary chats.
  const nonPrimaryThreadContent: React.ReactNode =
    activeChatId === "c2" ? staticMediaThread : staticEmptyThread;

  /* ---------------------------------------------------------------- */
  /* Render                                                             */
  /* ---------------------------------------------------------------- */

  return (
    <div className="relative" ref={demoWindowRef}>
      <DemoWindow
        assistantName={tx("landing.demo.sidebar.assistantName")}
        assistantStatusLabel={tx("landing.demo.sidebar.statusLabel")}
        chats={chats}
        onChatSelect={handleChatSelect}
        headerTitle={tx("landing.demo.header.title")}
        chatMode={chatMode}
        onModeChange={setChatMode}
        modeLabels={modeLabels}
        userName={tx("landing.demo.sidebar.userName")}
        userPlanLabel={tx("landing.demo.sidebar.userPlan")}
        composer={composer}
        threadViewportRef={threadViewportRef}
      >
        {isOnPrimaryChat ? (
          /* Primary chat: live thread with trailer overlay.
             The liveThread is always in the DOM for SSR safety (initial greeting
             is findable by screen readers and search bots even during the trailer). */
          <div className="relative min-h-[22rem]">
            <div aria-hidden={showTrailer}>{liveThread}</div>
            <AnimatePresence>
              {showTrailer && (
                <motion.div
                  key="trailer"
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.45, ease: "easeInOut" }}
                  className="absolute inset-0 z-10"
                >
                  <AssistantBuilder
                    onDone={() => dispatch({ type: "TRAILER_DONE" })}
                    shouldPlay={hasReachedDemoWindow}
                    reducedMotion={shouldReduceMotion}
                    labels={trailerLabels}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          /* Non-primary chats: static thread snapshot */
          nonPrimaryThreadContent
        )}
      </DemoWindow>

      {/* Pause / replay control — small, unobtrusive */}
      <div className="mt-2 flex justify-end pr-1">
        <button
          type="button"
          onClick={handlePauseReplay}
          aria-label={isPaused ? tx("landing.demo.replayLabel") : tx("landing.demo.pauseLabel")}
          className="text-[11px] text-text-subtle/70 transition-colors hover:text-text-subtle"
        >
          {isPaused ? tx("landing.demo.replayLabel") : tx("landing.demo.pauseLabel")}
        </button>
      </div>
    </div>
  );
}
