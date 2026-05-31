"use client";

import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useTranslations } from "next-intl";
import { AssistantRow, UserBubble } from "./chat-atoms";
import { DemoComposer } from "./demo-window";
import { useScrollToBottom } from "./use-autoscroll";

interface InteractiveBlockChatProps {
  placeholder: string;
  children: ReactNode;
  /** Scrollable thread viewport — kept pinned to newest message on submit. */
  viewportRef?: RefObject<HTMLDivElement | null> | undefined;
  reducedMotion?: boolean | null | undefined;
}

export function useInteractiveBlockChat({
  placeholder,
  children,
  viewportRef,
  reducedMotion = false
}: InteractiveBlockChatProps) {
  const t = useTranslations();
  const [value, setValue] = useState("");
  const [messages, setMessages] = useState<string[]>([]);

  // Pin the thread to the newest user turn + assistant reply on submit.
  const emptyRef = useRef<HTMLDivElement | null>(null);
  useScrollToBottom(viewportRef ?? emptyRef, messages.length, reducedMotion);

  const handleSubmit = useCallback((nextValue: string) => {
    const trimmed = nextValue.trim();
    if (!trimmed) return;
    setMessages((current) => [...current, trimmed]);
    setValue("");
  }, []);

  const composer = (
    <DemoComposer
      placeholder={placeholder}
      value={value}
      onChange={setValue}
      onSubmit={handleSubmit}
    />
  );

  return {
    thread: (
      <>
        {children}
        {messages.map((message, index) => (
          <div key={`${message}-${index}`}>
            <UserBubble>{message}</UserBubble>
            <AssistantRow showAvatar>
              <span>{t("landing.demo.stub.genericAckPrefix")} </span>
              <Link
                href={"/sign-up" as Route}
                className="font-medium text-accent transition-colors hover:text-accent-hover"
              >
                {t("landing.demo.stub.genericAckLink")}
              </Link>
            </AssistantRow>
          </div>
        ))}
      </>
    ),
    composer
  };
}
