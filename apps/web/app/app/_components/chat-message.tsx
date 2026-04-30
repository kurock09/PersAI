"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
import { useTranslations } from "next-intl";
import { AssistantAvatar } from "./assistant-avatar";
import {
  buildStreamingMarkdownTailPreview,
  splitStreamingMarkdownContent
} from "./chat-message-streaming";
import { VoiceMessagePlayer } from "./voice-message-player";
import { ImageLightbox } from "./image-lightbox";
import { getAttachmentDownloadUrl } from "../assistant-api-client";
import type { ChatAttachment, ChatMessage } from "./use-chat";
import { isAttachmentsOnlyPlaceholderText } from "./attachments-only-placeholder";

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

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath];
const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex];

type AssistantResponseBlock =
  | { type: "header"; content: string }
  | {
      type: "body";
      content: string;
      title?: string | undefined;
      titleLevel?: 1 | 2 | 3 | undefined;
    }
  | { type: "callout"; content: string; label?: string | undefined }
  | { type: "actions"; actions: string[] }
  | { type: "divider" };

const HEADER_WORDS = new Set([
  "понял",
  "готово",
  "собрал",
  "давай так",
  "принял",
  "окей",
  "хорошо",
  "итак",
  "done",
  "ready",
  "got it",
  "understood"
]);

const ACTION_HEADING_RE =
  /^(actions?|quick actions?|next|next steps?|действия|быстрые действия|варианты|дальше|следующие шаги|что можно сделать дальше)$/i;
const CALLOUT_HEADING_RE =
  /^(важно|итог|фокус|вывод|результат|следующий шаг|note|important|summary|focus|result)$/i;

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^[*>_`~]+|[*>_`~]+$/g, "")
    .trim();
}

function isShortHeaderCandidate(value: string): boolean {
  const text = stripInlineMarkdown(value)
    .replace(/[.!?:;]+$/g, "")
    .trim();
  if (!text || text.length > 48) return false;
  if (HEADER_WORDS.has(text.toLowerCase())) return true;
  return text.split(/\s+/).length <= 3 && !/[,.!?;:]/.test(text);
}

function isDividerLine(line: string): boolean {
  return /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function parseActionLine(line: string): string | null {
  const explicit = line.match(/^\s*(?:[-*]\s*)?\[\[?action:\s*(.+?)\]?\]\s*$/i);
  if (explicit) return stripInlineMarkdown(explicit[1] ?? "");

  const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/);
  if (!bullet) return null;

  const text = stripInlineMarkdown(bullet[1] ?? "");
  if (!text || text.length > 72) return null;
  if (/```|`{3,}/.test(text)) return null;
  return text;
}

function isExplicitActionLine(line: string): boolean {
  return /^\s*(?:[-*]\s*)?\[\[?action:\s*.+?\]?\]\s*$/i.test(line);
}

function maybeExtractActionBlock(
  lines: string[],
  startIndex = 0
): { actions: string[]; consumed: number } | null {
  let idx = startIndex;
  while (idx < lines.length && lines[idx]?.trim() === "") idx += 1;
  if (idx >= lines.length) return null;

  const heading = stripInlineMarkdown(lines[idx] ?? "");
  const hasActionHeading = ACTION_HEADING_RE.test(heading);
  if (hasActionHeading) idx += 1;

  const actions: string[] = [];
  let consumed = idx;
  let hasExplicitAction = false;
  while (consumed < lines.length) {
    const line = lines[consumed] ?? "";
    if (line.trim() === "") {
      consumed += 1;
      continue;
    }
    const action = parseActionLine(line);
    if (!action) break;
    hasExplicitAction = hasExplicitAction || isExplicitActionLine(line);
    actions.push(action);
    consumed += 1;
    if (actions.length === 4) break;
  }

  if (actions.length === 0) return null;
  if (!hasActionHeading && !hasExplicitAction) return null;
  return { actions, consumed: consumed - startIndex };
}

export function parseAssistantResponseBlocks(content: string): AssistantResponseBlock[] {
  const lines = content.replace(/\r\n/g, "\n").trim().split("\n");
  const blocks: AssistantResponseBlock[] = [];
  let bodyLines: string[] = [];
  let bodyHasText = false;
  let pendingTitle: string | undefined;
  let pendingTitleLevel: 1 | 2 | 3 | undefined;
  let inFence = false;
  let sawContent = false;

  const pushBodyLine = (line: string) => {
    bodyLines.push(line);
    if (line.trim().length > 0) {
      bodyHasText = true;
    }
  };

  const flushBody = () => {
    const body = bodyLines.join("\n").trim();
    if (body) {
      blocks.push({
        type: "body",
        content: body,
        title: pendingTitle,
        titleLevel: pendingTitleLevel
      });
      sawContent = true;
    }
    bodyLines = [];
    bodyHasText = false;
    pendingTitle = undefined;
    pendingTitleLevel = undefined;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      pushBodyLine(line);
      continue;
    }

    if (inFence) {
      pushBodyLine(line);
      continue;
    }

    if (isDividerLine(line)) {
      flushBody();
      blocks.push({ type: "divider" });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const title = stripInlineMarkdown(heading[2] ?? "");
      const titleLevel = heading[1]!.length as 1 | 2 | 3;
      const actionBlock = maybeExtractActionBlock(lines, i + 1);
      if (ACTION_HEADING_RE.test(title) && actionBlock) {
        flushBody();
        blocks.push({ type: "actions", actions: actionBlock.actions });
        i += actionBlock.consumed;
        continue;
      }
      flushBody();
      pendingTitle = title;
      pendingTitleLevel = titleLevel;
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      flushBody();
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i] ?? "")) {
        quoteLines.push((lines[i] ?? "").replace(/^\s{0,3}>\s?/, ""));
        i += 1;
      }
      i -= 1;
      const [first, ...rest] = quoteLines;
      const firstText = stripInlineMarkdown(first ?? "");
      const hasLabel = CALLOUT_HEADING_RE.test(firstText);
      blocks.push({
        type: "callout",
        label: hasLabel ? firstText : undefined,
        content: (hasLabel ? rest : quoteLines).join("\n").trim()
      });
      sawContent = true;
      continue;
    }

    if (pendingTitle === undefined && !sawContent && !bodyHasText && isShortHeaderCandidate(line)) {
      blocks.push({ type: "header", content: stripInlineMarkdown(line) });
      sawContent = true;
      continue;
    }

    const actionBlock = maybeExtractActionBlock(lines, i);
    if (actionBlock) {
      flushBody();
      blocks.push({ type: "actions", actions: actionBlock.actions });
      i += actionBlock.consumed - 1;
      continue;
    }

    pushBodyLine(line);
  }

  flushBody();
  return blocks.length > 0 ? blocks : [{ type: "body", content }];
}

interface ChatMessageBubbleProps {
  message: ChatMessage;
  assistantAvatarUrl?: string | undefined;
  assistantAvatarEmoji?: string | undefined;
  preResponseStatus?: "thinking" | "working" | undefined;
  onAssistantAction?: ((text: string) => void) | undefined;
  onDoNotRemember?: ((messageId: string) => void) | undefined;
  forgotten?: boolean | undefined;
  /**
   * When this bubble is the single failed pending-send slot, the parent
   * passes retry/cancel handlers so the user can recover in place.
   * Both are undefined when there is nothing to recover.
   */
  onRetryPendingSend?: (() => void) | undefined;
  onCancelPendingSend?: (() => void) | undefined;
}

function CopyButton({ text }: { text: string }) {
  const t = useTranslations("chat");
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
      title={t("copy")}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const COLLAPSE_LINE_THRESHOLD = 15;

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
  const t = useTranslations("chat");
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
    <div className="code-block group relative my-3 overflow-hidden rounded-xl border border-border">
      <div className="flex w-full items-center justify-between border-b border-border bg-surface-raised/45 py-1.5 ps-4 pe-1.5 md:ps-5">
        <span className="min-w-0 max-w-[75%] truncate text-[11px] font-medium text-text-subtle">
          {lang || t("code")}
          {isLong && (
            <span className="ml-1.5 text-text-subtle/50">{t("lines", { count: lineCount })}</span>
          )}
        </span>
        <CopyButton text={text} />
      </div>
      <div className={cn("relative", !expanded && "max-h-[240px] overflow-hidden")}>
        <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed md:p-4">
          <code ref={codeRef} className={className} />
        </pre>
        {!expanded && (
          <div className="code-block-fade absolute inset-x-0 bottom-0 flex items-end justify-center pb-2 pt-10">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="cursor-pointer rounded-md bg-surface-raised px-3 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              {t("showAllLines", { count: lineCount })}
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
            {t("collapse")}
          </button>
        </div>
      )}
    </div>
  );
}

function ThoughtBlock({ message }: { message: ChatMessage }) {
  const t = useTranslations("chat");
  const thought = message.thought?.trim() ?? "";
  const [expanded, setExpanded] = useState(message.status === "streaming");

  if (!thought) {
    return null;
  }

  const preview = buildThoughtPreview(thought);

  const thoughtLabel =
    !message.thoughtStartedAt || !message.thoughtFinishedAt
      ? t("thinking")
      : (() => {
          const s = Date.parse(message.thoughtStartedAt);
          const f = Date.parse(message.thoughtFinishedAt);
          if (Number.isNaN(s) || Number.isNaN(f)) return t("thinking");
          return t("thoughtFor", { seconds: Math.max(1, Math.round((f - s) / 1000)) });
        })();

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-border/70 bg-surface-raised/50">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-hover/60"
      >
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">
          {thoughtLabel}
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

function MarkdownFragment({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_REMARK_PLUGINS}
      rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
}

function AssistantActionChips({
  actions,
  onAction
}: {
  actions: string[];
  onAction?: ((text: string) => void) | undefined;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 pt-1" data-testid="assistant-response-actions">
      {actions.slice(0, 4).map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => onAction?.(action)}
          className="inline-flex h-8 cursor-pointer items-center rounded-full border border-accent/20 bg-accent/8 px-3 text-[12px] font-medium text-accent transition-colors hover:border-accent/35 hover:bg-accent/12 disabled:cursor-default disabled:opacity-70"
          disabled={!onAction}
        >
          {action}
        </button>
      ))}
    </div>
  );
}

function AssistantSectionTitle({ title, level }: { title: string; level?: 1 | 2 | 3 | undefined }) {
  const effectiveLevel = level ?? 3;
  const className =
    effectiveLevel === 1
      ? "mb-3 mt-2 text-[19px] font-semibold leading-[1.35] tracking-[-0.02em] text-text"
      : effectiveLevel === 2
        ? "mb-3 mt-1.5 text-[17px] font-semibold leading-[1.4] tracking-[-0.015em] text-text"
        : "mb-2.5 mt-1 text-[14px] font-semibold leading-[1.45] tracking-[-0.005em] text-text";

  return <div className={className}>{title}</div>;
}

const MarkdownMessageContent = memo(function MarkdownMessageContent({
  content,
  onAction
}: {
  content: string;
  onAction?: ((text: string) => void) | undefined;
}) {
  const blocks = useMemo(() => parseAssistantResponseBlocks(content), [content]);

  return (
    <div className="assistant-response-blocks space-y-3">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "header") {
          return (
            <div
              key={key}
              className="inline-flex max-w-full items-center rounded-full border border-accent/15 bg-accent/8 px-3 py-1 text-[12px] font-semibold tracking-[0.01em] text-accent"
            >
              {block.content}
            </div>
          );
        }
        if (block.type === "divider") {
          return <div key={key} className="h-px bg-border/70" />;
        }
        if (block.type === "actions") {
          return <AssistantActionChips key={key} actions={block.actions} onAction={onAction} />;
        }
        if (block.type === "callout") {
          return (
            <div
              key={key}
              className="rounded-2xl border border-accent/20 bg-accent/8 px-3.5 py-3 text-sm shadow-[inset_3px_0_0_rgba(191,148,84,0.45)]"
            >
              {block.label ? (
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent/90">
                  {block.label}
                </div>
              ) : null}
              {block.content ? (
                <div className="text-text-muted">
                  <MarkdownFragment content={block.content} />
                </div>
              ) : null}
            </div>
          );
        }
        return (
          <section key={key} className="py-1.5 first:pt-0 last:pb-0">
            {block.title ? (
              <AssistantSectionTitle title={block.title} level={block.titleLevel} />
            ) : null}
            <MarkdownFragment content={block.content} />
          </section>
        );
      })}
    </div>
  );
});

function StreamingMarkdownMessageContent({
  content,
  onAction
}: {
  content: string;
  onAction?: ((text: string) => void) | undefined;
}) {
  const { stableContent, liveTailPreview } = useMemo(() => {
    const segments = splitStreamingMarkdownContent(content);
    return {
      ...segments,
      liveTailPreview: buildStreamingMarkdownTailPreview(segments.liveTail)
    };
  }, [content]);

  return (
    <>
      {stableContent.length > 0 ? (
        <MarkdownMessageContent content={stableContent} onAction={onAction} />
      ) : null}
      {liveTailPreview.length > 0 ? (
        <div className="streaming-markdown-live text-text/95">
          <MarkdownFragment content={liveTailPreview} />
        </div>
      ) : null}
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function userMessageHasVoiceAttachment(attachments: ChatAttachment[] | undefined): boolean {
  return (
    attachments?.some((a) => a.attachmentType === "audio" || a.attachmentType === "voice") ?? false
  );
}

function AttachmentStrip({
  attachments,
  className
}: {
  attachments: ChatAttachment[];
  className?: string;
}) {
  const t = useTranslations("chat");
  // Lightbox state is keyed by attachment id so we can open/close
  // independently per image without lifting the state to the message bubble.
  const [openImageId, setOpenImageId] = useState<string | null>(null);
  if (attachments.length === 0) return null;

  return (
    <div className={cn("mt-2 flex w-full min-w-0 flex-wrap gap-2", className)}>
      {attachments.map((att) => {
        const isPending = att.processingStatus === "pending";
        const isFailed = att.processingStatus === "failed";
        const progressLabel =
          isPending && typeof att.uploadProgressPercent === "number"
            ? `${String(att.uploadProgressPercent)}%`
            : null;
        const inlineUrl = att.id.startsWith("local-")
          ? undefined
          : getAttachmentDownloadUrl(att.id);
        const downloadUrl = att.id.startsWith("local-")
          ? undefined
          : getAttachmentDownloadUrl(att.id, { download: true });
        const previewUrl = att.localPreviewUrl ?? inlineUrl;

        if (att.attachmentType === "image") {
          const fullUrl = inlineUrl ?? previewUrl;
          return (
            <div key={att.id} className="relative">
              {previewUrl ? (
                <button
                  type="button"
                  onClick={() => fullUrl && setOpenImageId(att.id)}
                  disabled={!fullUrl}
                  className="block overflow-hidden rounded-lg border border-border transition hover:border-border-strong focus:ring-2 focus:ring-accent focus:outline-none"
                >
                  <img
                    src={previewUrl}
                    alt={att.originalFilename ?? "image"}
                    className={cn(
                      "max-h-48 max-w-[240px] object-cover transition-opacity",
                      isPending && "opacity-50"
                    )}
                  />
                </button>
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-surface-raised">
                  <FileText className="h-6 w-6 text-text-subtle" />
                </div>
              )}
              {fullUrl && (
                <ImageLightbox
                  open={openImageId === att.id}
                  src={fullUrl}
                  downloadUrl={downloadUrl ?? fullUrl}
                  filename={att.originalFilename ?? undefined}
                  alt={att.originalFilename ?? undefined}
                  onClose={() => setOpenImageId(null)}
                />
              )}
              {isPending && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/10 backdrop-blur-[1px]">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-raised/85 px-2 py-1 text-[10px] font-medium text-text-muted shadow-sm">
                    <Loader2 className="h-3 w-3 animate-spin text-accent" />
                    {progressLabel}
                  </span>
                </div>
              )}
              {isFailed && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-destructive/10">
                  <span className="text-[10px] font-medium text-destructive">
                    {t("uploadFailed")}
                  </span>
                </div>
              )}
            </div>
          );
        }

        if (att.attachmentType === "audio" || att.attachmentType === "voice") {
          const audioSrc = previewUrl ?? inlineUrl;
          return (
            <div
              key={att.id}
              className={cn(
                "w-full max-w-[min(100%,320px)]",
                isPending && audioSrc && "opacity-80"
              )}
            >
              {audioSrc ? (
                <VoiceMessagePlayer src={audioSrc} />
              ) : (
                <div className="flex items-center gap-2 rounded-full border border-border bg-surface-raised px-3 py-2 text-xs text-text-muted">
                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  <span className="truncate">{att.originalFilename ?? "Audio"}</span>
                  {progressLabel ? <span className="text-text-subtle">{progressLabel}</span> : null}
                </div>
              )}
            </div>
          );
        }

        if (att.attachmentType === "video") {
          return (
            <div key={att.id} className="w-full max-w-sm">
              {inlineUrl && !isPending ? (
                <video
                  controls
                  preload="metadata"
                  className="max-h-56 w-full rounded-lg border border-border"
                  src={inlineUrl}
                >
                  <track kind="captions" />
                </video>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-muted">
                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  <span>{att.originalFilename ?? "Video"}</span>
                  {progressLabel ? <span className="text-text-subtle">{progressLabel}</span> : null}
                </div>
              )}
            </div>
          );
        }

        return (
          <a
            key={att.id}
            href={downloadUrl ?? "#"}
            download={att.originalFilename ?? undefined}
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
            <span className="text-text-subtle">{progressLabel ?? formatBytes(att.sizeBytes)}</span>
          </a>
        );
      })}
    </div>
  );
}

/**
 * ADR-076 Section M — delay before showing the off-bubble `sending` spinner.
 *
 * Fast sends (commit < 1 s) render no visual artifact at all; the optimistic
 * user bubble settles silently. Only when the request is still in flight
 * past this threshold does a small spinner fade in to the right of the
 * bubble. Lives locally inside `ChatMessageBubble` so neither `useChat` nor
 * the message status union needs to change.
 */
const SENDING_INDICATOR_DELAY_MS = 1000;

export const ChatMessageBubble = memo(function ChatMessageBubble({
  message,
  assistantAvatarUrl,
  assistantAvatarEmoji,
  onDoNotRemember,
  forgotten,
  onAssistantAction,
  onRetryPendingSend,
  onCancelPendingSend,
  preResponseStatus
}: ChatMessageBubbleProps) {
  const t = useTranslations("chat");
  const tSend = useTranslations("send");
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming" && message.role === "assistant";
  const showPreResponseStatus =
    isStreaming && message.content.trim().length === 0 && preResponseStatus !== undefined;
  const isUserSending =
    isUser && (message.status === "sending" || message.status === "reconciling");
  const isUserSendFailed = isUser && message.status.startsWith("send_failed");
  const hasUserAttachments = isUser && (message.attachments?.length ?? 0) > 0;
  const hideUserVoiceTranscript = isUser && userMessageHasVoiceAttachment(message.attachments);
  // FIX 3 — when a user sends only attachments, the composer fills `content`
  // with the canonical placeholder so the API contract stays satisfied. The
  // bubble must not echo that placeholder back as visible text — the
  // attachment strip below already conveys what was sent.
  const hideUserTextForAttachmentsOnly =
    isUser &&
    (message.attachments?.length ?? 0) > 0 &&
    isAttachmentsOnlyPlaceholderText(message.content);

  // ADR-076 Section M — arm the 1 s delay only while the bubble is in
  // `sending`. Any status change (committed / send_failed) clears the timer
  // and removes the spinner immediately, so a fast-path commit produces no
  // visible artifact and a pre-1 s failure flows straight to the existing
  // `Not delivered` block without a spinner flash.
  const [showSendingIndicator, setShowSendingIndicator] = useState(false);
  useEffect(() => {
    if (!isUserSending || hasUserAttachments) {
      setShowSendingIndicator(false);
      return;
    }
    const timer = setTimeout(() => {
      setShowSendingIndicator(true);
    }, SENDING_INDICATOR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasUserAttachments, isUserSending]);

  return (
    <div
      className={cn(
        "group relative flex py-2 md:py-3",
        isUser ? "items-center justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <AssistantAvatar
          avatarUrl={assistantAvatarUrl}
          avatarEmoji={assistantAvatarEmoji}
          size="sm"
          className="absolute top-3 -left-11 hidden md:block"
        />
      )}

      <div
        className={cn(
          "min-w-0",
          isUser
            ? cn(
                "flex max-w-[92%] flex-col items-end gap-1 sm:max-w-[85%] md:max-w-[75%]",
                hideUserVoiceTranscript && "w-[min(100%,320px)] max-w-[min(100%,320px)]"
              )
            : "w-full flex-1"
        )}
      >
        {isUser ? (
          <>
            <div
              className={cn(
                "min-w-0 max-w-full rounded-2xl rounded-br-md bg-accent/15 px-3 py-2 text-text md:px-4 md:py-2.5",
                isUserSendFailed && "opacity-80"
              )}
            >
              {!hideUserVoiceTranscript && !hideUserTextForAttachmentsOnly && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed break-words">
                  {message.content}
                </p>
              )}
              {message.attachments && message.attachments.length > 0 && (
                <AttachmentStrip
                  attachments={message.attachments}
                  {...(hideUserVoiceTranscript || hideUserTextForAttachmentsOnly
                    ? { className: "mt-0" }
                    : {})}
                />
              )}
            </div>
            {isUserSendFailed && (
              <div
                role="group"
                aria-label={tSend("failedShort")}
                className="flex items-center gap-2 px-1 text-[11px] leading-none text-text-subtle"
              >
                <span className="flex items-center gap-1.5 text-destructive/85">
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 rounded-full bg-destructive/80"
                  />
                  <span>
                    {message.status === "send_failed_unconfirmed"
                      ? tSend("failedUnconfirmed")
                      : message.status === "send_failed_confirmed"
                        ? tSend("failedConfirmed")
                        : tSend("failedShort")}
                  </span>
                </span>
                {onRetryPendingSend ? (
                  <>
                    <span aria-hidden="true" className="text-border-strong">
                      ·
                    </span>
                    <button
                      type="button"
                      onClick={onRetryPendingSend}
                      className="cursor-pointer font-medium text-text-muted underline-offset-4 transition-colors hover:text-text hover:underline"
                    >
                      {tSend("retry")}
                    </button>
                  </>
                ) : null}
                {onCancelPendingSend ? (
                  <>
                    <span aria-hidden="true" className="text-border-strong">
                      ·
                    </span>
                    <button
                      type="button"
                      onClick={onCancelPendingSend}
                      className="cursor-pointer text-text-subtle underline-offset-4 transition-colors hover:text-text hover:underline"
                    >
                      {tSend("cancel")}
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <div className="prose-invert min-w-0 max-w-full text-sm break-words text-text [overflow-wrap:anywhere]">
            <ThoughtBlock message={message} />
            {showPreResponseStatus ? (
              <span className="inline-flex items-center gap-2 text-sm font-medium text-text-muted">
                <span className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent/70 align-middle" />
                <span>
                  {preResponseStatus === "working"
                    ? t("preResponseWorking")
                    : t("preResponseThinking")}
                </span>
              </span>
            ) : (
              <>
                {isStreaming ? (
                  <StreamingMarkdownMessageContent
                    content={message.content}
                    onAction={onAssistantAction}
                  />
                ) : (
                  <MarkdownMessageContent content={message.content} onAction={onAssistantAction} />
                )}

                {/* Streaming cursor */}
                {isStreaming && (
                  <span className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent/70 align-middle" />
                )}
              </>
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
              <span className="rounded-md p-1.5 text-text-subtle/40" title={t("wontRemember")}>
                <EyeOff className="h-3.5 w-3.5" />
              </span>
            ) : onDoNotRemember ? (
              <button
                type="button"
                onClick={() => onDoNotRemember(message.id)}
                className="cursor-pointer rounded-md p-1.5 text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-muted"
                title={t("dontRemember")}
              >
                <EyeOff className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              disabled
              className="cursor-default rounded-md p-1.5 text-text-subtle/40"
              title={t("regenerate")}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled
              className="cursor-default rounded-md p-1.5 text-text-subtle/40"
              title={t("helpful")}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled
              className="cursor-default rounded-md p-1.5 text-text-subtle/40"
              title={t("notHelpful")}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ADR-076 Section M — quiet, off-bubble pending-send indicator. The
          motion.div animates its own width so the user bubble naturally
          shifts left as the spinner enters; AnimatePresence ties the exit
          animation to the same path on commit / pre-headers failure. */}
      {isUser && (
        <AnimatePresence initial={false}>
          {showSendingIndicator && (
            <motion.div
              key="sending-indicator"
              data-testid="message-sending-indicator"
              role="status"
              aria-label={message.status === "reconciling" ? tSend("checking") : tSend("sending")}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 22, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="flex shrink-0 items-center justify-end overflow-hidden"
            >
              <Loader2 className="h-3 w-3 animate-spin text-text-subtle" aria-hidden="true" />
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
});
