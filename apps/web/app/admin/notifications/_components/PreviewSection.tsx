"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import type { NotificationPreviewRequest, NotificationPreviewResult } from "@persai/contracts";
import { previewNotification } from "@/app/app/assistant-api-client";

type Props = {
  getToken: () => Promise<string | null>;
};

export function PreviewSection({ getToken }: Props) {
  const [renderStrategy, setRenderStrategy] = useState<
    "grounded_llm" | "template" | "static_fallback"
  >("static_fallback");
  const [templateId, setTemplateId] = useState("");
  const [renderInstructionRef, setRenderInstructionRef] = useState("");
  const [factPayloadText, setFactPayloadText] = useState(
    '{\n  "message": "Hello, this is a test notification."\n}'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<NotificationPreviewResult | null>(null);

  async function runPreview(): Promise<void> {
    const token = await getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let factPayload: Record<string, unknown>;
      try {
        factPayload = JSON.parse(factPayloadText) as Record<string, unknown>;
      } catch {
        setError("Invalid JSON in fact payload.");
        return;
      }
      const input: NotificationPreviewRequest = {
        renderStrategy,
        factPayload,
        ...(templateId ? { templateId } : {}),
        ...(renderInstructionRef ? { renderInstructionRef } : {})
      };
      const preview = await previewNotification(token, input);
      setResult(preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4 shadow-sm">
      <p className="mb-3 text-[10px] text-text-muted">
        Dry-run renderer preview. Never persists or sends to real recipients. Safe to use at any
        time.
      </p>

      <div className="space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-text-muted">Render strategy</label>
          <select
            value={renderStrategy}
            onChange={(e) => setRenderStrategy(e.target.value as typeof renderStrategy)}
            className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="static_fallback">Static fallback</option>
            <option value="template">Template</option>
            <option value="grounded_llm">Grounded LLM (dry-run)</option>
          </select>
        </div>

        {renderStrategy === "template" && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-text-muted">Template ID</label>
            <input
              type="text"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              placeholder="e.g. billing.payment_recovered"
              className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        )}

        {renderStrategy === "grounded_llm" && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-text-muted">
              Render instruction ref (optional)
            </label>
            <input
              type="text"
              value={renderInstructionRef}
              onChange={(e) => setRenderInstructionRef(e.target.value)}
              placeholder="instruction ID"
              className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-text-muted">Fact payload (JSON)</label>
          <textarea
            value={factPayloadText}
            onChange={(e) => setFactPayloadText(e.target.value)}
            rows={6}
            spellCheck={false}
            className="rounded border border-border bg-bg px-2 py-1 font-mono text-[10px] text-text focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        {error && <p className="text-[10px] text-destructive">{error}</p>}

        <button
          type="button"
          onClick={() => void runPreview()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Run preview
        </button>

        {result && (
          <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
            <p className="text-[10px] font-semibold text-success">Preview result (dry-run only)</p>
            {result.subject && (
              <div>
                <p className="text-[10px] text-text-muted mb-0.5">Subject</p>
                <p className="text-xs text-text">{result.subject}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] text-text-muted mb-0.5">Body</p>
              <pre className="whitespace-pre-wrap text-[10px] text-text">{result.body}</pre>
            </div>
            {result.plainText && result.plainText !== result.body && (
              <div>
                <p className="text-[10px] text-text-muted mb-0.5">Plain text</p>
                <pre className="whitespace-pre-wrap text-[10px] text-text">{result.plainText}</pre>
              </div>
            )}
            {result.html && (
              <div>
                <p className="text-[10px] text-text-muted mb-0.5">HTML preview</p>
                <div
                  className="rounded border border-border bg-white p-2 text-[10px]"
                  dangerouslySetInnerHTML={{ __html: result.html }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
