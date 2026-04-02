"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import hljs from "highlight.js/lib/core";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import "katex/dist/katex.min.css";
import {
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  EyeOff,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  FileText,
  Download,
  Loader2
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { AssistantAvatar } from "./assistant-avatar";
import { getAttachmentDownloadUrl } from "../assistant-api-client";
import type { ChatAttachment, ChatMessage } from "./use-chat";

hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", cpp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("bash", shell);
hljs.registerLanguage("sh", shell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

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
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!codeRef.current) return;
    try {
      const result =
        lang && hljs.getLanguage(lang)
          ? hljs.highlight(text, { language: lang })
          : hljs.highlightAuto(text);
      codeRef.current.innerHTML = result.value;
    } catch {
      codeRef.current.textContent = text;
    }
  }, [text, lang]);

  return (
    <div className="code-block group relative my-3 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-medium text-text-subtle">
          {lang || "code"}
          {isLong && <span className="ml-1.5 text-text-subtle/50">{lineCount} lines</span>}
        </span>
        <CopyButton text={text} />
      </div>
      <div className={cn("relative", !expanded && "max-h-[240px] overflow-hidden")}>
        <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
          <code ref={codeRef} className={className} />
        </pre>
        {!expanded && (
          <div className="code-block-fade absolute inset-x-0 bottom-0 flex items-end justify-center pb-2 pt-10">
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentStrip({ attachments }: { attachments: ChatAttachment[] }) {
  if (attachments.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((att) => {
        const isPending = att.processingStatus === "pending";
        const isFailed = att.processingStatus === "failed";
        const downloadUrl = att.id.startsWith("local-")
          ? undefined
          : getAttachmentDownloadUrl(att.id);
        const previewUrl = att.localPreviewUrl ?? downloadUrl;

        if (att.attachmentType === "image") {
          return (
            <div key={att.id} className="relative">
              {previewUrl ? (
                <a href={downloadUrl ?? "#"} target="_blank" rel="noopener noreferrer">
                  <img
                    src={previewUrl}
                    alt={att.originalFilename ?? "image"}
                    className={cn(
                      "max-h-48 max-w-[240px] rounded-lg border border-border object-cover transition-opacity",
                      isPending && "opacity-50"
                    )}
                  />
                </a>
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-surface-raised">
                  <FileText className="h-6 w-6 text-text-subtle" />
                </div>
              )}
              {isPending && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-accent" />
                </div>
              )}
              {isFailed && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-destructive/10">
                  <span className="text-[10px] font-medium text-destructive">Upload failed</span>
                </div>
              )}
            </div>
          );
        }

        if (att.attachmentType === "audio" || att.attachmentType === "voice") {
          return (
            <div key={att.id} className="w-full max-w-xs">
              {downloadUrl && !isPending ? (
                <audio controls preload="metadata" className="w-full h-9" src={downloadUrl}>
                  <track kind="captions" />
                </audio>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-muted">
                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  <span>{att.originalFilename ?? "Audio"}</span>
                </div>
              )}
            </div>
          );
        }

        if (att.attachmentType === "video") {
          return (
            <div key={att.id} className="w-full max-w-sm">
              {downloadUrl && !isPending ? (
                <video
                  controls
                  preload="metadata"
                  className="max-h-56 w-full rounded-lg border border-border"
                  src={downloadUrl}
                >
                  <track kind="captions" />
                </video>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-muted">
                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  <span>{att.originalFilename ?? "Video"}</span>
                </div>
              )}
            </div>
          );
        }

        return (
          <a
            key={att.id}
            href={downloadUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs transition-colors",
              downloadUrl ? "hover:border-border-strong hover:bg-surface-hover" : "opacity-50"
            )}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-text-subtle" />
            ) : (
              <Download className="h-3.5 w-3.5 text-text-subtle" />
            )}
            <span className="max-w-[150px] truncate text-text-muted">
              {att.originalFilename ?? "File"}
            </span>
            <span className="text-text-subtle">{formatBytes(att.sizeBytes)}</span>
          </a>
        );
      })}
    </div>
  );
}

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
    <div className={cn("group flex gap-2 px-3 py-2 md:gap-3 md:px-4 md:py-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <AssistantAvatar
          avatarUrl={assistantAvatarUrl}
          avatarEmoji={assistantAvatarEmoji}
          size="sm"
          className="mt-1 hidden sm:block"
        />
      )}

      <div
        className={cn(
          "max-w-[92%] min-w-0 sm:max-w-[85%] md:max-w-[75%]",
          isUser
            ? "rounded-2xl rounded-br-md bg-accent/15 px-3 py-2 text-text md:px-4 md:py-2.5"
            : "flex-1 md:max-w-2xl"
        )}
      >
        {isUser ? (
          <>
            <p className="whitespace-pre-wrap text-sm leading-relaxed break-words">
              {message.content}
            </p>
            {message.attachments && message.attachments.length > 0 && (
              <AttachmentStrip attachments={message.attachments} />
            )}
          </>
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
            {message.attachments && message.attachments.length > 0 && (
              <AttachmentStrip attachments={message.attachments} />
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
