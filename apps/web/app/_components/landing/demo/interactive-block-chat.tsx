"use client";

import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useTranslations } from "next-intl";
import { AssistantRow, UserBubble } from "./chat-atoms";
import { DemoComposer } from "./demo-window";

interface InteractiveBlockChatProps {
  placeholder: string;
  children: ReactNode;
}

export function useInteractiveBlockChat({ placeholder, children }: InteractiveBlockChatProps) {
  const t = useTranslations();
  const [value, setValue] = useState("");
  const [messages, setMessages] = useState<string[]>([]);

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
