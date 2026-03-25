"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ShieldAlert, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { postAdminAbuseUnblock } from "@/app/app/assistant-api-client";

const SURFACES = [
  { value: "", label: "All surfaces" },
  { value: "web_chat", label: "Web Chat" },
  { value: "telegram", label: "Telegram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "max", label: "MAX" }
] as const;

type Feedback = { type: "ok" | "err"; text: string } | null;

export default function AdminAbusePage() {
  const { getToken } = useAuth();
  const [assistantId, setAssistantId] = useState("");
  const [userId, setUserId] = useState("");
  const [surface, setSurface] = useState("");
  const [overrideMinutes, setOverrideMinutes] = useState("60");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const handleUnblock = useCallback(async () => {
    const token = await getToken();
    if (!token || !assistantId.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await postAdminAbuseUnblock(token, {
        assistantId: assistantId.trim(),
        userId: userId.trim() || null,
        surface: (surface as "web_chat" | "telegram" | "whatsapp" | "max") || null,
        overrideMinutes: parseInt(overrideMinutes) || 60
      });
      setFeedback({
        type: "ok",
        text: `Unblocked. Affected ${result.affectedUserRows} user rows, ${result.affectedAssistantRows} assistant rows.`
      });
    } catch (e) {
      setFeedback({ type: "err", text: e instanceof Error ? e.message : "Unblock failed." });
    }
    setBusy(false);
  }, [getToken, assistantId, userId, surface, overrideMinutes]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <ShieldAlert className="h-5 w-5 text-destructive" />
        <h1 className="text-lg font-bold text-text">Abuse Controls</h1>
      </div>

      <div className="rounded-lg border border-border bg-surface-raised p-5 max-w-lg">
        <h2 className="text-sm font-semibold text-text mb-4">Unblock Assistant</h2>
        <p className="text-xs text-text-muted mb-4">
          Temporarily override abuse blocks for a specific assistant. The override expires after the
          specified duration.
        </p>

        <div className="space-y-3">
          <Field
            label="Assistant ID *"
            value={assistantId}
            onChange={setAssistantId}
            placeholder="UUID of the assistant"
          />
          <Field
            label="User ID (optional)"
            value={userId}
            onChange={setUserId}
            placeholder="Target specific user"
          />
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">Surface</label>
            <select
              value={surface}
              onChange={(e) => setSurface(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
            >
              {SURFACES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Override duration (minutes)"
            value={overrideMinutes}
            onChange={setOverrideMinutes}
            placeholder="1-1440"
            type="number"
          />
        </div>

        <button
          type="button"
          disabled={busy || !assistantId.trim()}
          onClick={() => void handleUnblock()}
          className={cn(
            "mt-4 flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors",
            !assistantId.trim()
              ? "cursor-default bg-surface text-text-subtle"
              : "cursor-pointer bg-destructive/15 text-destructive hover:bg-destructive/25",
            "disabled:opacity-50"
          )}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5" />
          )}
          Unblock
        </button>

        {feedback && (
          <div
            className={cn(
              "mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
              feedback.type === "ok"
                ? "bg-success/10 text-success"
                : "bg-destructive/10 text-destructive"
            )}
          >
            {feedback.type === "ok" ? (
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            )}
            {feedback.text}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
      />
    </div>
  );
}
