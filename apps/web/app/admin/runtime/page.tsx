"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ChevronDown, ChevronRight, Loader2, Save, Server, Shield } from "lucide-react";
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

const TIER_LABELS: Record<string, string> = {
  free_shared_restricted: "Free",
  paid_shared_restricted: "Paid shared",
  paid_isolated: "Paid isolated"
};

const POOL_CLASS_LABELS: Record<string, string> = {
  shared_restricted: "Shared",
  isolated: "Isolated"
};

function tierLabel(tier: string): string {
  return TIER_LABELS[tier] ?? tier;
}

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
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Server className="h-5 w-5 text-accent" />
          <h1 className="text-lg font-bold text-text">Runtime Settings</h1>
        </div>
        {settings && (
          <div className="space-y-1">
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
              Model routing, provider keys, and per-tier sandbox security policy.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <SectionHeading>Model routing</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="Primary">
            <ProviderSelect value={primaryProvider} onChange={setPrimaryProvider} />
            <Field
              label="Model"
              value={primaryModel}
              onChange={setPrimaryModel}
              placeholder="gpt-4o"
            />
          </Card>

          <Card
            title="Graceful fallback"
            trailing={
              <label className="flex items-center gap-1.5 text-[11px] text-text-subtle cursor-pointer">
                <input
                  type="checkbox"
                  checked={fallbackEnabled}
                  onChange={(e) => setFallbackEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-accent"
                />
                Enabled
              </label>
            }
          >
            {fallbackEnabled ? (
              <>
                <ProviderSelect value={fallbackProvider} onChange={setFallbackProvider} />
                <Field
                  label="Model"
                  value={fallbackModel}
                  onChange={setFallbackModel}
                  placeholder="gpt-4o-mini"
                />
              </>
            ) : (
              <p className="text-xs text-text-subtle py-1">
                Enable to set a cheaper fallback model for degraded or quota-limited turns.
              </p>
            )}
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        <SectionHeading>Available models</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="OpenAI">
            <Field
              label="Models (comma-separated)"
              value={openaiModelsText}
              onChange={setOpenaiModelsText}
              placeholder="gpt-4o, gpt-4o-mini"
            />
          </Card>
          <Card title="Anthropic">
            <Field
              label="Models (comma-separated)"
              value={anthropicModelsText}
              onChange={setAnthropicModelsText}
              placeholder="claude-sonnet-4-20250514"
            />
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        <SectionHeading>API keys</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="OpenAI">
            <Field
              label="API key"
              value={openaiKey}
              onChange={setOpenaiKey}
              type="password"
              placeholder={
                settings?.providerKeys.openai.configured
                  ? `Configured ••••${settings.providerKeys.openai.lastFour ?? ""}`
                  : "sk-..."
              }
            />
          </Card>
          <Card title="Anthropic">
            <Field
              label="API key"
              value={anthropicKey}
              onChange={setAnthropicKey}
              type="password"
              placeholder={
                settings?.providerKeys.anthropic.configured
                  ? `Configured ••••${settings.providerKeys.anthropic.lastFour ?? ""}`
                  : "sk-ant-..."
              }
            />
          </Card>
        </div>
      </div>

      <div className="flex items-center gap-3">
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
        {feedback && <p className="text-xs text-text-muted">{feedback}</p>}
      </div>

      {settings?.tierSecurityPolicies?.length ? (
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-4 w-4 text-text-subtle" />
              <SectionHeading>Sandbox security per tier</SectionHeading>
            </div>
            <p className="text-xs text-text-subtle">
              Read-only. Resource limits are set in Helm values, policy flags in code.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {settings.tierSecurityPolicies.map((policy) => (
              <TierSecurityCard key={policy.tier} policy={policy} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TierSecurityCard({ policy }: { policy: RuntimeTierSecurityPolicyState }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-text">{tierLabel(policy.tier)}</div>
          <div className="text-[11px] text-text-subtle">
            {POOL_CLASS_LABELS[policy.poolClass] ?? policy.poolClass} pool
          </div>
        </div>
        <StatusDot ok />
      </div>

      {policy.sandboxLimits && (
        <div className="grid grid-cols-3 gap-2">
          <Metric label="PIDs" value={String(policy.sandboxLimits.pidsLimit)} />
          <Metric
            label="RAM"
            value={
              policy.sandboxLimits.memoryMb >= 1024
                ? `${String(policy.sandboxLimits.memoryMb / 1024)}G`
                : `${String(policy.sandboxLimits.memoryMb)}M`
            }
          />
          <Metric label="CPU" value={String(policy.sandboxLimits.cpus)} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <MiniTag
          label="Exec"
          value={policy.execPolicy === "sandbox_only" ? "sandbox" : policy.execPolicy}
        />
        <MiniTag
          label="Write"
          value={policy.writePolicy === "sandbox_workspace_only" ? "workspace" : policy.writePolicy}
        />
        <MiniTag label="Network" value={policy.sandbox.network} />
        <MiniTag label="Root FS" value={policy.sandbox.readOnlyRoot ? "read-only" : "writable"} />
      </div>

      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[11px] text-text-subtle hover:text-text transition-colors cursor-pointer"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Tool policy details
      </button>

      {expanded && (
        <div className="space-y-2 text-[11px] text-text-subtle">
          <ToolList label="Denied built-ins" items={policy.alwaysDeniedBuiltIns} />
          <ToolList label="Platform-managed" items={policy.platformManagedTools} />
          <ToolList label="Plan-managed" items={policy.planManagedServiceTools} />
          <ToolList label="Hidden internal" items={policy.hiddenInternalTools} />
          <div>
            <span className="text-text-muted">User tools:</span>{" "}
            {policy.userPlanTools === "plan_managed_only"
              ? "plan-managed only"
              : policy.userPlanTools}
          </div>
          {policy.notes.length > 0 && (
            <ul className="list-disc pl-3 space-y-0.5 text-text-subtle">
              {policy.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-raised px-2.5 py-2 text-center">
      <div className="text-sm font-semibold text-text tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-text-subtle mt-0.5">{label}</div>
    </div>
  );
}

function MiniTag({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 px-2 py-1">
      <span className="text-[10px] uppercase tracking-wide text-text-subtle">{label}</span>
      <span className="text-[11px] font-medium text-text">{value}</span>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`}
      title={ok ? "Active" : "Inactive"}
    />
  );
}

function ToolList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <span className="text-text-muted">{label}:</span>{" "}
      <span className="break-all">{items.join(", ")}</span>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-bold text-text uppercase tracking-wider">{children}</h2>;
}

function Card({
  title,
  trailing,
  children
}: {
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-text uppercase tracking-wider">{title}</h3>
        {trailing}
      </div>
      {children}
    </div>
  );
}

function ProviderSelect({
  value,
  onChange
}: {
  value: ManagedRuntimeProvider;
  onChange: (v: ManagedRuntimeProvider) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-muted">Provider</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ManagedRuntimeProvider)}
        className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
      >
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
      </select>
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
