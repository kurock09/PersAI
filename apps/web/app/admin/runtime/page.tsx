"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Server, Loader2, Save } from "lucide-react";
import type {
  AdminRuntimeProviderSettingsState,
  AdminRuntimeProviderSettingsRequest,
  ManagedRuntimeProvider
} from "@persai/contracts";
import {
  getAdminRuntimeProviderSettings,
  putAdminRuntimeProviderSettings
} from "@/app/app/assistant-api-client";

export default function AdminRuntimePage() {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<AdminRuntimeProviderSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [primaryProvider, setPrimaryProvider] = useState<ManagedRuntimeProvider>("openai");
  const [primaryModel, setPrimaryModel] = useState("gpt-4o");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await getAdminRuntimeProviderSettings(token);
      setSettings(res);
      if (res.primary) {
        setPrimaryProvider(res.primary.provider);
        setPrimaryModel(res.primary.model);
      }
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
    if (!token || !settings) return;
    setSaving(true);
    setFeedback(null);
    try {
      const request: AdminRuntimeProviderSettingsRequest = {
        primary: { provider: primaryProvider, model: primaryModel },
        availableModelsByProvider: settings.availableModelsByProvider,
        providerKeys: {
          ...(openaiKey ? { openai: openaiKey } : {}),
          ...(anthropicKey ? { anthropic: anthropicKey } : {})
        }
      };
      await putAdminRuntimeProviderSettings(token, request);
      setFeedback("Saved.");
      setOpenaiKey("");
      setAnthropicKey("");
      await load();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Save failed.");
    }
    setSaving(false);
  }, [getToken, settings, primaryProvider, primaryModel, openaiKey, anthropicKey, load]);

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
        <Server className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-bold text-text">Runtime Provider Settings</h1>
      </div>

      {settings && (
        <div className="mb-6 space-y-1">
          <p className="text-xs text-text-muted">
            Mode: <span className="font-medium text-text">{settings.mode}</span>
          </p>
          {settings.notes.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-text-subtle">
              {settings.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="max-w-lg space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Primary provider</label>
          <select
            value={primaryProvider}
            onChange={(e) => setPrimaryProvider(e.target.value as ManagedRuntimeProvider)}
            className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>

        <Field
          label="Primary model"
          value={primaryModel}
          onChange={setPrimaryModel}
          placeholder="gpt-4o"
        />

        <Field
          label="OpenAI API key"
          value={openaiKey}
          onChange={setOpenaiKey}
          placeholder={
            settings?.providerKeys.openai.configured
              ? `••••${settings.providerKeys.openai.lastFour ?? ""}`
              : "Enter key..."
          }
          type="password"
        />
        <Field
          label="Anthropic API key"
          value={anthropicKey}
          onChange={setAnthropicKey}
          placeholder={
            settings?.providerKeys.anthropic.configured
              ? `••••${settings.providerKeys.anthropic.lastFour ?? ""}`
              : "Enter key..."
          }
          type="password"
        />

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
          Save settings
        </button>

        {feedback && <p className="text-xs text-text-muted mt-2">{feedback}</p>}
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
        className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
      />
    </div>
  );
}
