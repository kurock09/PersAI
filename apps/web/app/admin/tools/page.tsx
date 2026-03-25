"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Wrench, Loader2, Save, CheckCircle, XCircle } from "lucide-react";

type ToolCredentialStatus = {
  credentialKey: string;
  toolCode: string;
  displayName: string;
  configured: boolean;
  lastFour: string | null;
  updatedAt: string | null;
};

type AdminToolCredentialsState = {
  schema: string;
  credentials: ToolCredentialStatus[];
  notes: string[];
};

export default function AdminToolsPage() {
  const { getToken } = useAuth();
  const [state, setState] = useState<AdminToolCredentialsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/runtime/tool-credentials", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      const data = await res.json();
      setState(data.credentials ?? data);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Failed to load.");
    }
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setSaving(true);
    setFeedback(null);
    try {
      const challengeRes = await fetch("/api/v1/admin/security/step-up", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "admin.tool_credentials.update" }),
      });
      if (!challengeRes.ok) throw new Error("Step-up challenge failed.");
      const { token: stepUpToken } = await challengeRes.json();

      const keysToSend: Record<string, string> = {};
      for (const [key, value] of Object.entries(keyInputs)) {
        if (value.trim()) keysToSend[key] = value.trim();
      }

      if (Object.keys(keysToSend).length === 0) {
        setFeedback("No keys to save.");
        setSaving(false);
        return;
      }

      const res = await fetch("/api/v1/admin/runtime/tool-credentials", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-persai-step-up-token": stepUpToken,
        },
        body: JSON.stringify({ keys: keysToSend }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `Save failed: ${res.status}`);
      }
      setFeedback("Saved successfully.");
      setKeyInputs({});
      await load();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Save failed.");
    }
    setSaving(false);
  }, [getToken, keyInputs, load]);

  const updateKeyInput = (credentialKey: string, value: string) => {
    setKeyInputs((prev) => ({ ...prev, [credentialKey]: value }));
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Wrench className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-bold text-text">Tool Credentials</h1>
      </div>

      {state && state.notes.length > 0 && (
        <div className="mb-6 space-y-1">
          <ul className="list-disc pl-4 text-xs text-text-subtle">
            {state.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="max-w-lg space-y-4">
        {state?.credentials.map((cred) => (
          <div
            key={cred.credentialKey}
            className="rounded-lg border border-border bg-surface-raised p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-text">{cred.displayName}</p>
                <p className="text-[11px] text-text-muted">
                  Tool: <span className="font-mono">{cred.toolCode}</span>
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {cred.configured ? (
                  <>
                    <CheckCircle className="h-3.5 w-3.5 text-success" />
                    <span className="text-[11px] text-success">Configured</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5 text-text-subtle" />
                    <span className="text-[11px] text-text-subtle">Not set</span>
                  </>
                )}
              </div>
            </div>
            <input
              type="password"
              value={keyInputs[cred.credentialKey] ?? ""}
              onChange={(e) => updateKeyInput(cred.credentialKey, e.target.value)}
              placeholder={
                cred.configured
                  ? `••••${cred.lastFour ?? ""}`
                  : "Enter API key..."
              }
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
            />
            {cred.updatedAt && (
              <p className="mt-1 text-[10px] text-text-muted">
                Last updated: {new Date(cred.updatedAt).toLocaleString()}
              </p>
            )}
          </div>
        ))}

        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save credentials
        </button>

        {feedback && (
          <p className="text-xs text-text-muted mt-2">{feedback}</p>
        )}
      </div>
    </div>
  );
}
