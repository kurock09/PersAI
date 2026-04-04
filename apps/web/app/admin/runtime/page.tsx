"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Server, Loader2, Save } from "lucide-react";
import type {
  AdminRuntimeProviderSettingsState,
  AdminRuntimeProviderSettingsRequest,
  ManagedRuntimeProvider,
  RuntimeProviderAvailableModelsByProviderState,
  RuntimeTierSecurityPolicyState
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
  const [fallbackProvider, setFallbackProvider] = useState<ManagedRuntimeProvider>("openai");
  const [fallbackModel, setFallbackModel] = useState("");
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [, setAvailableModels] = useState<RuntimeProviderAvailableModelsByProviderState>({
    openai: [],
    anthropic: []
  });
  const [openaiModelsText, setOpenaiModelsText] = useState("");
  const [anthropicModelsText, setAnthropicModelsText] = useState("");

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
      if (res.fallback) {
        setFallbackEnabled(true);
        setFallbackProvider(res.fallback.provider);
        setFallbackModel(res.fallback.model);
      } else {
        setFallbackEnabled(false);
      }
      setAvailableModels(res.availableModelsByProvider);
      setOpenaiModelsText(res.availableModelsByProvider.openai.join(", "));
      setAnthropicModelsText(res.availableModelsByProvider.anthropic.join(", "));
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
      const parsedOpenai = openaiModelsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const parsedAnthropic = anthropicModelsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const request: AdminRuntimeProviderSettingsRequest = {
        primary: { provider: primaryProvider, model: primaryModel },
        ...(fallbackEnabled && fallbackModel.trim()
          ? { fallback: { provider: fallbackProvider, model: fallbackModel.trim() } }
          : { fallback: null }),
        availableModelsByProvider: {
          openai: parsedOpenai,
          anthropic: parsedAnthropic
        },
        providerKeys: {
          ...(openaiKey ? { openai: openaiKey } : {}),
          ...(anthropicKey ? { anthropic: anthropicKey } : {})
        }
      };
      await putAdminRuntimeProviderSettings(token, request);
      setFeedback("Saved successfully. Changes will propagate lazily to all assistants.");
      setOpenaiKey("");
      setAnthropicKey("");
      await load();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Save failed.");
    }
    setSaving(false);
  }, [
    getToken,
    settings,
    primaryProvider,
    primaryModel,
    fallbackEnabled,
    fallbackProvider,
    fallbackModel,
    openaiKey,
    anthropicKey,
    openaiModelsText,
    anthropicModelsText,
    load
  ]);

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
          <p className="text-xs text-text-subtle">
            These settings define the primary model path and the safe fallback path used when the
            normal runtime/model route is degraded or policy forces a cheaper turn.
          </p>
        </div>
      )}

      <div className="max-w-lg space-y-4">
        <div className="rounded border border-border bg-surface p-3 space-y-3">
          <h2 className="text-xs font-bold text-text uppercase tracking-wider">Primary</h2>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">Provider</label>
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
            label="Model"
            value={primaryModel}
            onChange={setPrimaryModel}
            placeholder="gpt-4o"
          />
        </div>

        <div className="rounded border border-border bg-surface p-3 space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold text-text uppercase tracking-wider">
              Graceful fallback
            </h2>
            <label className="flex items-center gap-1 text-[10px] text-text-subtle">
              <input
                type="checkbox"
                checked={fallbackEnabled}
                onChange={(e) => setFallbackEnabled(e.target.checked)}
                className="h-3 w-3 rounded border-border"
              />
              Enabled
            </label>
          </div>
          <p className="text-xs text-text-subtle">
            Used when the main model path is degraded or PersAI intentionally degrades a turn to a
            safer/lower-cost route under current plan limits.
          </p>
          {fallbackEnabled && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">Provider</label>
                <select
                  value={fallbackProvider}
                  onChange={(e) => setFallbackProvider(e.target.value as ManagedRuntimeProvider)}
                  className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </div>
              <Field
                label="Model"
                value={fallbackModel}
                onChange={setFallbackModel}
                placeholder="gpt-4o-mini"
              />
            </>
          )}
        </div>

        <div className="rounded border border-border bg-surface p-3 space-y-3">
          <h2 className="text-xs font-bold text-text uppercase tracking-wider">
            Available models by provider
          </h2>
          <Field
            label="OpenAI models (comma-separated)"
            value={openaiModelsText}
            onChange={setOpenaiModelsText}
            placeholder="gpt-4o, gpt-4o-mini, gpt-4-turbo"
          />
          <Field
            label="Anthropic models (comma-separated)"
            value={anthropicModelsText}
            onChange={setAnthropicModelsText}
            placeholder="claude-sonnet-4-20250514, claude-3-haiku-20240307"
          />
        </div>

        <div className="rounded border border-border bg-surface p-3 space-y-3">
          <h2 className="text-xs font-bold text-text uppercase tracking-wider">API Keys</h2>
          <Field
            label="OpenAI API key"
            value={openaiKey}
            onChange={setOpenaiKey}
            placeholder={
              settings?.providerKeys.openai.configured
                ? `Configured ••••${settings.providerKeys.openai.lastFour ?? ""}`
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
                ? `Configured ••••${settings.providerKeys.anthropic.lastFour ?? ""}`
                : "Enter key..."
            }
            type="password"
          />
        </div>

        {settings?.tierSecurityPolicies?.length ? (
          <div className="rounded border border-border bg-surface p-3 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-text">
              Runtime tier security matrix
            </h2>
            <p className="text-xs text-text-subtle">
              Read-only control-plane baseline for sandbox, `exec`/`write`, service tools, and
              always-denied built-ins by product tier.
            </p>
            <div className="space-y-3">
              {settings.tierSecurityPolicies.map((policy) => (
                <TierSecurityCard key={policy.tier} policy={policy} />
              ))}
            </div>
          </div>
        ) : null}

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

function TierSecurityCard({ policy }: { policy: RuntimeTierSecurityPolicyState }) {
  return (
    <div className="rounded border border-border bg-surface-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text">{policy.tier}</span>
        <Badge>{policy.poolClass}</Badge>
        <Badge>{policy.execPolicy}</Badge>
        <Badge>{policy.writePolicy}</Badge>
      </div>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div className="space-y-1 text-xs text-text-subtle">
          <div>
            Sandbox: {policy.sandbox.mode} / {policy.sandbox.backend} / scope {policy.sandbox.scope}
          </div>
          <div>
            Workspace: {policy.sandbox.workspaceAccess}, network {policy.sandbox.network}, read-only
            root {policy.sandbox.readOnlyRoot ? " on" : " off"}
          </div>
          <div>User tools: {policy.userPlanTools}</div>
        </div>
        <div className="space-y-1 text-xs text-text-subtle">
          <ListLine label="Platform-managed" items={policy.platformManagedTools} />
          <ListLine label="Plan-managed service" items={policy.planManagedServiceTools} />
          <ListLine label="Hidden internal" items={policy.hiddenInternalTools} />
          <ListLine label="Always denied built-ins" items={policy.alwaysDeniedBuiltIns} />
        </div>
      </div>
      {policy.notes.length > 0 ? (
        <ul className="mt-2 list-disc pl-4 text-xs text-text-subtle">
          {policy.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ListLine({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <span className="text-text">{label}:</span> {items.join(", ")}
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-subtle">
      {children}
    </span>
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
