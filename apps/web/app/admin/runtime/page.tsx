"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ChevronDown, Loader2, Save, Server } from "lucide-react";
import type {
  AdminRuntimeProviderSettingsRequest,
  AdminRuntimeProviderSettingsState,
  ManagedRuntimeProvider,
  RuntimeProviderAvailableModelsByProviderState
} from "@persai/contracts";
import {
  getAdminRuntimeProviderSettings,
  putAdminRuntimeProviderSettings
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

function parseModelCatalogInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\r\n,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function modeLabel(mode: AdminRuntimeProviderSettingsState["mode"]): string {
  return mode === "global_settings" ? "Global settings" : "Unconfigured default";
}

function providerLabel(provider: ManagedRuntimeProvider): string {
  return provider === "openai" ? "OpenAI" : "Anthropic";
}

export default function AdminRuntimePage() {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<AdminRuntimeProviderSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [primaryProvider, setPrimaryProvider] = useState<ManagedRuntimeProvider>("openai");
  const [primaryModel, setPrimaryModel] = useState("");
  const [fallbackProvider, setFallbackProvider] = useState<ManagedRuntimeProvider>("openai");
  const [fallbackModel, setFallbackModel] = useState("");
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [availableModels, setAvailableModels] =
    useState<RuntimeProviderAvailableModelsByProviderState>({
      openai: [],
      anthropic: []
    });
  const [openaiModelsText, setOpenaiModelsText] = useState("");
  const [anthropicModelsText, setAnthropicModelsText] = useState("");

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      return;
    }
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
        setFallbackModel("");
      }
      setAvailableModels(res.availableModelsByProvider);
      setOpenaiModelsText(res.availableModelsByProvider.openai.join("\n"));
      setAnthropicModelsText(res.availableModelsByProvider.anthropic.join("\n"));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load runtime settings.");
    }
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    const token = await getToken();
    if (!token || !settings) {
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const parsedCatalog = {
        openai: parseModelCatalogInput(openaiModelsText),
        anthropic: parseModelCatalogInput(anthropicModelsText)
      } satisfies RuntimeProviderAvailableModelsByProviderState;

      if (!parsedCatalog[primaryProvider].includes(primaryModel.trim())) {
        throw new Error("Primary model must be selected from the listed catalog.");
      }
      if (
        fallbackEnabled &&
        fallbackModel.trim().length > 0 &&
        !parsedCatalog[fallbackProvider].includes(fallbackModel.trim())
      ) {
        throw new Error("Fallback model must be selected from the listed catalog.");
      }

      const request: AdminRuntimeProviderSettingsRequest = {
        primary: { provider: primaryProvider, model: primaryModel.trim() },
        ...(fallbackEnabled && fallbackModel.trim()
          ? { fallback: { provider: fallbackProvider, model: fallbackModel.trim() } }
          : { fallback: null }),
        availableModelsByProvider: parsedCatalog,
        providerKeys: {
          ...(openaiKey ? { openai: openaiKey } : {}),
          ...(anthropicKey ? { anthropic: anthropicKey } : {})
        }
      };
      await putAdminRuntimeProviderSettings(token, request);
      setFeedback("Saved successfully. Changes propagate lazily after save.");
      setOpenaiKey("");
      setAnthropicKey("");
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Save failed.");
    }
    setSaving(false);
  }, [
    anthropicKey,
    anthropicModelsText,
    fallbackEnabled,
    fallbackModel,
    fallbackProvider,
    getToken,
    load,
    openaiKey,
    openaiModelsText,
    primaryModel,
    primaryProvider,
    settings
  ]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-2.5 px-1 pb-24">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Server className="h-4 w-4 text-accent" />
          <h1 className="text-sm font-bold tracking-tight text-text">Runtime</h1>
        </div>
      </div>

      {settings && (
        <div className="flex flex-wrap items-center gap-1.5 rounded border border-border/40 bg-surface px-2.5 py-1.5 text-[10px] text-text-muted">
          <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-semibold text-accent">
            {modeLabel(settings.mode)}
          </span>
          <span>Global provider and model routing for the active native runtime.</span>
          <span>
            Plan-level tier selection and native context-hydration budgets still live in{" "}
            <span className="font-mono text-text">Admin &gt; Plans</span>.
          </span>
          {settings.notes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>
      )}

      <Fold t="Model Routing" open>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <Card title="Primary">
            <ProviderSelect value={primaryProvider} onChange={setPrimaryProvider} />
            <ModelSelect
              label="Model"
              value={primaryModel}
              onChange={setPrimaryModel}
              options={availableModels[primaryProvider]}
              emptyLabel="Select from available models"
            />
          </Card>
          <Card
            title="Graceful Fallback"
            trailing={
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-text-subtle">
                <input
                  type="checkbox"
                  checked={fallbackEnabled}
                  onChange={(event) => setFallbackEnabled(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-accent"
                />
                Enabled
              </label>
            }
          >
            {fallbackEnabled ? (
              <>
                <ProviderSelect value={fallbackProvider} onChange={setFallbackProvider} />
                <ModelSelect
                  label="Model"
                  value={fallbackModel}
                  onChange={setFallbackModel}
                  options={availableModels[fallbackProvider]}
                  emptyLabel="Select from available models"
                />
              </>
            ) : (
              <p className="text-[10px] text-text-muted">
                Keep this off unless you really want degraded runtime fallback.
              </p>
            )}
          </Card>
        </div>
      </Fold>

      <Fold t="Available Models">
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <Card title="OpenAI">
            <TextareaField
              label="One model id per line"
              value={openaiModelsText}
              onChange={setOpenaiModelsText}
              placeholder={"gpt-5.4\ngpt-4.1"}
            />
          </Card>
          <Card title="Anthropic">
            <TextareaField
              label="One model id per line"
              value={anthropicModelsText}
              onChange={setAnthropicModelsText}
              placeholder="claude-sonnet-4-5"
            />
          </Card>
        </div>
      </Fold>

      <Fold t="API Keys">
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <Card title="OpenAI">
            <Field
              label="API key"
              value={openaiKey}
              onChange={setOpenaiKey}
              type="password"
              autoComplete="new-password"
              placeholder={
                settings?.providerKeys.openai.configured
                  ? `Configured ••••${settings.providerKeys.openai.lastFour ?? ""}`
                  : "sk-..."
              }
            />
            <p className="text-[10px] text-text-subtle">
              {settings?.providerKeys.openai.configured
                ? `${providerLabel("openai")} key is already configured. Leave blank to keep it.`
                : "Required when OpenAI is selected and no stored key exists yet."}
            </p>
          </Card>
          <Card title="Anthropic">
            <Field
              label="API key"
              value={anthropicKey}
              onChange={setAnthropicKey}
              type="password"
              autoComplete="new-password"
              placeholder={
                settings?.providerKeys.anthropic.configured
                  ? `Configured ••••${settings.providerKeys.anthropic.lastFour ?? ""}`
                  : "sk-ant-..."
              }
            />
            <p className="text-[10px] text-text-subtle">
              {settings?.providerKeys.anthropic.configured
                ? `${providerLabel("anthropic")} key is already configured. Leave blank to keep it.`
                : "Required when Anthropic is selected and no stored key exists yet."}
            </p>
          </Card>
        </div>
      </Fold>

      <div className="sticky bottom-0 z-10 -mx-2 rounded-xl border border-border/70 bg-surface/95 px-3 py-2.5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] text-text-subtle">
            Runtime settings are global platform policy. Save applies provider/model/optimization
            updates together.
          </p>
          <div className="flex items-center gap-2">
            {feedback && <p className="text-[10px] text-text-muted">{feedback}</p>}
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex cursor-pointer items-center gap-1 rounded border border-accent bg-accent px-2.5 py-1 text-[10px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fold({
  t,
  open: init = false,
  children
}: {
  t: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  const [o, setO] = useState(init);
  return (
    <section>
      <button
        type="button"
        onClick={() => setO((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-1.5 py-0.5"
      >
        <ChevronDown
          className={cn("h-3 w-3 text-text-subtle transition-transform", !o && "-rotate-90")}
        />
        <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted">{t}</span>
      </button>
      {o && <div className="mt-1">{children}</div>}
    </section>
  );
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
    <div className="space-y-2 rounded border border-border/40 bg-surface px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[9px] font-bold uppercase tracking-widest text-text-subtle">{title}</h3>
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
      <label className="mb-1 block text-[10px] font-medium text-text-muted">Provider</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ManagedRuntimeProvider)}
        className="w-full rounded border border-border bg-surface-raised px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-border-strong"
      >
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
      </select>
    </div>
  );
}

function ModelSelect({
  label,
  value,
  onChange,
  options,
  emptyLabel
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  emptyLabel: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium text-text-muted">{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded border border-border bg-surface-raised px-2.5 py-1.5 text-[13px] text-text outline-none focus:border-border-strong"
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete = "off"
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium text-text-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="w-full rounded border border-border bg-surface-raised px-2.5 py-1.5 text-[13px] text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
      />
    </div>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium text-text-muted">{label}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={5}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="w-full resize-y rounded border border-border bg-surface-raised px-2.5 py-1.5 text-[13px] text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
      />
    </div>
  );
}
