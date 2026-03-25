"use client";

import { useCallback, useRef, type KeyboardEvent } from "react";
import { SendHorizonal, Square, Paperclip } from "lucide-react";
import { cn } from "@/app/lib/utils";

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

export function ChatInput({ onSend, onStop, isStreaming, disabled }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const handleSend = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const text = el.value.trim();
    if (text.length === 0) return;
    onSend(text);
    el.value = "";
    el.style.height = "auto";
  }, [onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!isStreaming && !disabled) {
          handleSend();
        }
      }
    },
    [handleSend, isStreaming, disabled]
  );

  return (
    <div className="border-t border-border bg-bg px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-border bg-surface p-2 transition-colors focus-within:border-border-strong">
        {/* Attach button (UI-ready) */}
        <button
          type="button"
          disabled
          className="mb-0.5 cursor-default rounded-lg p-2 text-text-subtle/40"
          title="Attach file (coming soon)"
        >
          <Paperclip className="h-4 w-4" />
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          placeholder="Message your assistant..."
          disabled={disabled}
          onInput={resize}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex-1 resize-none bg-transparent text-sm text-text placeholder:text-text-subtle",
            "outline-none",
            "max-h-[200px] py-2"
          )}
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className="mb-0.5 cursor-pointer rounded-lg bg-destructive/15 p-2 text-destructive transition-colors hover:bg-destructive/25"
            title="Stop"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled}
            className={cn(
              "mb-0.5 rounded-lg p-2 transition-colors",
              disabled
                ? "cursor-default text-text-subtle/40"
                : "cursor-pointer bg-accent text-white hover:bg-accent-hover"
            )}
            title="Send"
          >
            <SendHorizonal className="h-4 w-4" />
          </button>
        )}
      </div>

      <p className="mt-2 text-center text-[11px] text-text-subtle">
        Your assistant may make mistakes. Verify important information.
      </p>
    </div>
  );
}
