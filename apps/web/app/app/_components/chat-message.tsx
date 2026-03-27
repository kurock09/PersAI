"use client";

import { memo, useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  EyeOff,
  RefreshCw,
  ThumbsUp,
  ThumbsDown
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { AssistantAvatar } from "./assistant-avatar";
import type { ChatMessage } from "./use-chat";

interface ChatMessageBubbleProps {
  message: ChatMessage;
  assistantAvatarUrl?: string | undefined;
  assistantAvatarEmoji?: string | undefined;
  onDoNotRemember?: ((messageId: string) => void) | undefined;
  forgotten?: boolean | undefined;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="cursor-pointer rounded-md p-1.5 text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-muted"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const COLLAPSE_LINE_THRESHOLD = 15;

function formatThoughtDurationLabel(message: ChatMessage): string {
  if (!message.thoughtStartedAt || !message.thoughtFinishedAt) {
    return "Thinking";
  }

  const startedAt = Date.parse(message.thoughtStartedAt);
  const finishedAt = Date.parse(message.thoughtFinishedAt);
  if (Number.isNaN(startedAt) || Number.isNaN(finishedAt)) {
    return "Thought";
  }

  const seconds = Math.max(1, Math.round((finishedAt - startedAt) / 1000));
  return `Thought for ${seconds}s`;
}

function buildThoughtPreview(thought: string): string {
  return thought
    .replace(/^Reasoning:\s*/i, "")
    .replace(/[_*`>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function CodeBlock({
  className,
  children
}: {
  className: string | undefined;
  children?: React.ReactNode;
}) {
  const text = String(children).replace(/\n$/, "");
  const lang = className?.replace("language-", "") ?? "";
  const lineCount = text.split("\n").length;
  const isLong = lineCount > COLLAPSE_LINE_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLong);

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border bg-[#0d0d14]">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-medium text-text-subtle">
          {lang || "code"}
          {isLong && <span className="ml-1.5 text-text-subtle/50">{lineCount} lines</span>}
        </span>
        <CopyButton text={text} />
      </div>
      <div className={cn("relative", !expanded && "max-h-[240px] overflow-hidden")}>
        <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
          <code className={className}>{children}</code>
        </pre>
        {!expanded && (
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-center bg-gradient-to-t from-[#0d0d14] via-[#0d0d14]/80 to-transparent pb-2 pt-10">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="cursor-pointer rounded-md bg-surface-raised px-3 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              Show all {lineCount} lines
            </button>
          </div>
        )}
      </div>
      {expanded && isLong && (
        <div className="border-t border-border px-3 py-1">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="cursor-pointer text-[11px] text-text-subtle transition-colors hover:text-text-muted"
          >
            Collapse
          </button>
        </div>
      )}
    </div>
  );
}

function ThoughtBlock({ message }: { message: ChatMessage }) {
  const thought = message.thought?.trim() ?? "";
  const [expanded, setExpanded] = useState(message.status === "streaming");

  if (!thought) {
    return null;
  }

  const preview = buildThoughtPreview(thought);

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-border/70 bg-surface-raised/50">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-hover/60"
      >
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">
          {formatThoughtDurationLabel(message)}
        </span>
        <span className="ml-auto text-text-subtle">
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-border/70 px-3 py-2 text-xs text-text-muted">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={markdownComponents}
          >
            {thought}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="relative border-t border-border/70 px-3 py-2 text-xs text-text-subtle">
          <div className="max-h-10 overflow-hidden pr-6">{preview}</div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-raised/90 to-transparent" />
        </div>
      )}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const markdownComponents: Record<string, React.ComponentType<any>> = {
  code: ({
    className,
    children,
    ...props
  }: {
    className: string | undefined;
    children?: React.ReactNode;
  }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return <CodeBlock className={className}>{children}</CodeBlock>;
    }
    return (
      <code className="rounded bg-surface-raised px-1.5 py-0.5 text-[13px] text-accent" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<"table">) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }: React.ComponentPropsWithoutRef<"th">) => (
    <th
      className="border-b border-border bg-surface-raised px-3 py-2 text-left text-xs font-semibold text-text-muted"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.ComponentPropsWithoutRef<"td">) => (
    <td className="border-b border-border px-3 py-2 text-text" {...props}>
      {children}
    </td>
  ),
  a: ({ children, ...props }: React.ComponentPropsWithoutRef<"a">) => (
    <a
      className="text-accent underline decoration-accent/30 hover:decoration-accent"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<"p">) => (
    <p className="mb-3 last:mb-0 leading-relaxed" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }: React.ComponentPropsWithoutRef<"ul">) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.ComponentPropsWithoutRef<"ol">) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0" {...props}>
      {children}
    </ol>
  ),
  blockquote: ({ children, ...props }: React.ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote className="my-3 border-l-2 border-accent/40 pl-4 text-text-muted italic" {...props}>
      {children}
    </blockquote>
  ),
  h1: ({ children, ...props }: React.ComponentPropsWithoutRef<"h1">) => (
    <h1 className="mb-3 mt-5 text-xl font-bold first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.ComponentPropsWithoutRef<"h2">) => (
    <h2 className="mb-2 mt-4 text-lg font-semibold first:mt-0" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.ComponentPropsWithoutRef<"h3">) => (
    <h3 className="mb-2 mt-3 text-base font-semibold first:mt-0" {...props}>
      {children}
    </h3>
  )
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const ChatMessageBubble = memo(function ChatMessageBubble({
  message,
  assistantAvatarUrl,
  assistantAvatarEmoji,
  onDoNotRemember,
  forgotten
}: ChatMessageBubbleProps) {
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming" && message.role === "assistant";

  return (
    <div className={cn("group flex gap-3 px-4 py-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <AssistantAvatar
          avatarUrl={assistantAvatarUrl}
          avatarEmoji={assistantAvatarEmoji}
          size="sm"
          className="mt-1"
        />
      )}

      <div
        className={cn(
          "max-w-[75%] min-w-0",
          isUser
            ? "rounded-2xl rounded-br-md bg-accent/15 px-4 py-2.5 text-text"
            : "flex-1 max-w-2xl"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed break-words">
            {message.content}
          </p>
        ) : (
          <div className="prose-invert text-sm text-text">
            <ThoughtBlock message={message} />
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={markdownComponents}
            >
              {message.content}
            </ReactMarkdown>

            {/* Streaming cursor */}
            {isStreaming && (
              <span className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent/70 align-middle" />
            )}
          </div>
        )}

        {/* Message actions (assistant only, on hover) */}
        {!isUser && message.status === "committed" && message.content.length > 0 && (
          <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton text={message.content} />
            {forgotten ? (
              <span className="rounded-md p-1.5 text-text-subtle/40" title="Won't be remembered">
                <EyeOff className="h-3.5 w-3.5" />
              </span>
            ) : onDoNotRemember ? (
              <button
                type="button"
                onClick={() => onDoNotRemember(message.id)}
                className="cursor-pointer rounded-md p-1.5 text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-muted"
                title="Don't remember this"
              >
                <EyeOff className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              disabled
              className="cursor-default rounded-md p-1.5 text-text-subtle/40"
              title="Regenerate (coming soon)"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled
              className="cursor-default rounded-md p-1.5 text-text-subtle/40"
              title="Helpful (coming soon)"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled
              className="cursor-default rounded-md p-1.5 text-text-subtle/40"
              title="Not helpful (coming soon)"
            >
              <ThumbsDown className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
