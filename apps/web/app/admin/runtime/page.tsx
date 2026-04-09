"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ChevronDown, ChevronRight, Loader2, Save, Server } from "lucide-react";
import type {
  AdminRuntimeProviderSettingsState,
  AdminRuntimeProviderSettingsRequest,
  ManagedRuntimeProvider,
  RuntimeOptimizationPolicyState,
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

function cloneOptimizationPolicy(
  policy: RuntimeOptimizationPolicyState
): RuntimeOptimizationPolicyState {
  return JSON.parse(JSON.stringify(policy)) as RuntimeOptimizationPolicyState;
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
  const [optimizationPolicy, setOptimizationPolicy] =
    useState<RuntimeOptimizationPolicyState | null>(null);
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
        setFallbackModel("");
      }
      setAvailableModels(res.availableModelsByProvider);
      setOptimizationPolicy(cloneOptimizationPolicy(res.optimizationPolicy));
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
    if (!token || !settings || !optimizationPolicy) return;
    setSaving(true);
    setFeedback(null);
    try {
      const parsedOpenai = parseModelCatalogInput(openaiModelsText);
      const parsedAnthropic = parseModelCatalogInput(anthropicModelsText);
      const parsedCatalog = {
        openai: parsedOpenai,
        anthropic: parsedAnthropic
      } satisfies RuntimeProviderAvailableModelsByProviderState;

      if (!parsedCatalog[primaryProvider].includes(primaryModel.trim())) {
        throw new Error("System primary model must be selected from the available catalog.");
      }
      if (
        fallbackEnabled &&
        fallbackModel.trim().length > 0 &&
        !parsedCatalog[fallbackProvider].includes(fallbackModel.trim())
      ) {
        throw new Error("Fallback model must be selected from the available catalog.");
      }

      const request: AdminRuntimeProviderSettingsRequest = {
        primary: { provider: primaryProvider, model: primaryModel },
        ...(fallbackEnabled && fallbackModel.trim()
          ? { fallback: { provider: fallbackProvider, model: fallbackModel.trim() } }
          : { fallback: null }),
        availableModelsByProvider: parsedCatalog,
        optimizationPolicy,
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
    optimizationPolicy,
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
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Server className="h-5 w-5 text-accent" />
          <h1 className="text-lg font-bold text-text">Runtime Settings</h1>
        </div>
        {settings && (
          <div className="grid gap-3 lg:grid-cols-[1.8fr_1fr]">
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
                Runtime policy surface
              </div>
              <p className="mt-2 text-sm text-text">
                System model, runtime fallback, heartbeat, context economy, OpenAI tuning, and
                read-only sandbox policy.
              </p>
              <p className="mt-2 text-xs text-text-subtle">
                Plan tariff model selection still lives in `Admin &gt; Plans`.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
                Current mode
              </div>
              <div className="mt-2 text-sm font-medium text-text">{settings.mode}</div>
              {settings.notes.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {settings.notes.map((n, i) => (
                    <p key={i} className="text-xs text-text-subtle">
                      {n}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <SectionHeading>Model authority</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
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
                <ModelSelect
                  label="Model"
                  value={fallbackModel}
                  onChange={setFallbackModel}
                  options={availableModels[fallbackProvider]}
                  emptyLabel="Select from available models"
                />
              </>
            ) : (
              <p className="text-xs text-text-subtle py-1">
                Use this only for runtime failure/degraded fallback. Plan-level tariff model
                selection still lives in Plans.
              </p>
            )}
          </Card>
        </div>
      </div>

      {optimizationPolicy ? (
        <>
          <div className="space-y-3">
            <SectionHeading>Optimization policy</SectionHeading>
            <div className="grid gap-4 xl:grid-cols-2">
              <CompactPolicyCard
                title="Heartbeat"
                summary={`every ${optimizationPolicy.heartbeat.every} · target ${optimizationPolicy.heartbeat.target}`}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Interval"
                    value={optimizationPolicy.heartbeat.every}
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              heartbeat: { ...current.heartbeat, every: value }
                            }
                          : current
                      )
                    }
                    placeholder="0m"
                  />
                  <SelectField
                    label="Target"
                    value={optimizationPolicy.heartbeat.target}
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              heartbeat: {
                                ...current.heartbeat,
                                target:
                                  value as RuntimeOptimizationPolicyState["heartbeat"]["target"]
                              }
                            }
                          : current
                      )
                    }
                    options={[
                      { value: "none", label: "none" },
                      { value: "last", label: "last active chat" }
                    ]}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ToggleField
                    label="Light context"
                    checked={optimizationPolicy.heartbeat.lightContext}
                    onChange={(checked) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              heartbeat: { ...current.heartbeat, lightContext: checked }
                            }
                          : current
                      )
                    }
                  />
                  <ToggleField
                    label="Isolated session"
                    checked={optimizationPolicy.heartbeat.isolatedSession}
                    onChange={(checked) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              heartbeat: { ...current.heartbeat, isolatedSession: checked }
                            }
                          : current
                      )
                    }
                  />
                </div>
              </CompactPolicyCard>

              <CompactPolicyCard
                title="Context pruning"
                summary={`${optimizationPolicy.contextPruning.mode} · ttl ${optimizationPolicy.contextPruning.ttl}`}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField
                    label="Mode"
                    value={optimizationPolicy.contextPruning.mode}
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              contextPruning: {
                                ...current.contextPruning,
                                mode: value as RuntimeOptimizationPolicyState["contextPruning"]["mode"]
                              }
                            }
                          : current
                      )
                    }
                    options={[
                      { value: "off", label: "off" },
                      { value: "cache-ttl", label: "cache-ttl" }
                    ]}
                  />
                  <Field
                    label="TTL"
                    value={optimizationPolicy.contextPruning.ttl}
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              contextPruning: { ...current.contextPruning, ttl: value }
                            }
                          : current
                      )
                    }
                    placeholder="5m"
                  />
                  <NumberField
                    label="Keep assistants"
                    value={optimizationPolicy.contextPruning.keepLastAssistants}
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              contextPruning: {
                                ...current.contextPruning,
                                keepLastAssistants: value
                              }
                            }
                          : current
                      )
                    }
                  />
                  <NumberField
                    label="Min tool chars"
                    value={optimizationPolicy.contextPruning.minPrunableToolChars}
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              contextPruning: {
                                ...current.contextPruning,
                                minPrunableToolChars: value
                              }
                            }
                          : current
                      )
                    }
                  />
                  <NumberField
                    label="Soft trim ratio"
                    value={optimizationPolicy.contextPruning.softTrimRatio}
                    step="0.05"
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              contextPruning: { ...current.contextPruning, softTrimRatio: value }
                            }
                          : current
                      )
                    }
                  />
                  <NumberField
                    label="Hard clear ratio"
                    value={optimizationPolicy.contextPruning.hardClearRatio}
                    step="0.05"
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              contextPruning: { ...current.contextPruning, hardClearRatio: value }
                            }
                          : current
                      )
                    }
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ToggleField
                    label="Hard clear enabled"
                    checked={optimizationPolicy.contextPruning.hardClear.enabled}
                    onChange={(checked) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              contextPruning: {
                                ...current.contextPruning,
                                hardClear: { ...current.contextPruning.hardClear, enabled: checked }
                              }
                            }
                          : current
                      )
                    }
                  />
                  <StatPill
                    label="Soft trim max chars"
                    value={String(optimizationPolicy.contextPruning.softTrim.maxChars)}
                  />
                </div>
              </CompactPolicyCard>
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid gap-4 xl:grid-cols-2">
              <CompactPolicyCard
                title="Compaction"
                summary={`${optimizationPolicy.compaction.mode} · reserve ${optimizationPolicy.compaction.reserveTokens}`}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField
                    label="Mode"
                    value={optimizationPolicy.compaction.mode}
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              compaction: {
                                ...current.compaction,
                                mode: value as RuntimeOptimizationPolicyState["compaction"]["mode"]
                              }
                            }
                          : current
                      )
                    }
                    options={[
                      { value: "default", label: "default" },
                      { value: "safeguard", label: "safeguard" }
                    ]}
                  />
                  <SelectField
                    label="Identifier policy"
                    value={optimizationPolicy.compaction.identifierPolicy}
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              compaction: {
                                ...current.compaction,
                                identifierPolicy:
                                  value as RuntimeOptimizationPolicyState["compaction"]["identifierPolicy"]
                              }
                            }
                          : current
                      )
                    }
                    options={[
                      { value: "strict", label: "strict" },
                      { value: "off", label: "off" },
                      { value: "custom", label: "custom" }
                    ]}
                  />
                  <SelectField
                    label="Post-index sync"
                    value={optimizationPolicy.compaction.postIndexSync}
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              compaction: {
                                ...current.compaction,
                                postIndexSync:
                                  value as RuntimeOptimizationPolicyState["compaction"]["postIndexSync"]
                              }
                            }
                          : current
                      )
                    }
                    options={[
                      { value: "off", label: "off" },
                      { value: "async", label: "async" },
                      { value: "await", label: "await" }
                    ]}
                  />
                  <ToggleField
                    label="Truncate after compaction"
                    checked={optimizationPolicy.compaction.truncateAfterCompaction}
                    onChange={(checked) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              compaction: {
                                ...current.compaction,
                                truncateAfterCompaction: checked
                              }
                            }
                          : current
                      )
                    }
                  />
                  <NumberField
                    label="Reserve tokens"
                    value={optimizationPolicy.compaction.reserveTokens}
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              compaction: { ...current.compaction, reserveTokens: value }
                            }
                          : current
                      )
                    }
                  />
                  <NumberField
                    label="Keep recent tokens"
                    value={optimizationPolicy.compaction.keepRecentTokens}
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              compaction: { ...current.compaction, keepRecentTokens: value }
                            }
                          : current
                      )
                    }
                  />
                </div>
              </CompactPolicyCard>

              <CompactPolicyCard
                title="OpenAI tuning"
                summary={`${optimizationPolicy.openai.serviceTier} tier · fast ${optimizationPolicy.openai.fastMode ? "on" : "off"}`}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <ToggleField
                    label="Fast mode"
                    checked={optimizationPolicy.openai.fastMode}
                    onChange={(checked) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              openai: { ...current.openai, fastMode: checked }
                            }
                          : current
                      )
                    }
                  />
                  <SelectField
                    label="Service tier"
                    value={optimizationPolicy.openai.serviceTier}
                    onChange={(value) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              openai: {
                                ...current.openai,
                                serviceTier:
                                  value as RuntimeOptimizationPolicyState["openai"]["serviceTier"]
                              }
                            }
                          : current
                      )
                    }
                    options={[
                      { value: "auto", label: "auto" },
                      { value: "default", label: "default" },
                      { value: "flex", label: "flex" },
                      { value: "priority", label: "priority" }
                    ]}
                  />
                  <ToggleField
                    label="Responses server compaction"
                    checked={optimizationPolicy.openai.responsesServerCompaction}
                    onChange={(checked) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              openai: { ...current.openai, responsesServerCompaction: checked }
                            }
                          : current
                      )
                    }
                  />
                  <ToggleField
                    label="OpenAI websocket warmup"
                    checked={optimizationPolicy.openai.openaiWsWarmup}
                    onChange={(checked) =>
                      setOptimizationPolicy((current) =>
                        current
                          ? {
                              ...current,
                              openai: { ...current.openai, openaiWsWarmup: checked }
                            }
                          : current
                      )
                    }
                  />
                </div>
              </CompactPolicyCard>
            </div>
          </div>
        </>
      ) : null}

      <div className="space-y-3">
        <SectionHeading>Available models</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="OpenAI">
            <Field
              label="Models (comma or newline separated)"
              value={openaiModelsText}
              onChange={setOpenaiModelsText}
              placeholder="gpt-5.4, gpt-4.1"
            />
          </Card>
          <Card title="Anthropic">
            <Field
              label="Models (comma or newline separated)"
              value={anthropicModelsText}
              onChange={setAnthropicModelsText}
              placeholder="claude-sonnet-4-5"
            />
          </Card>
        </div>
      </div>

      <div className="space-y-3">
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

      <div className="sticky bottom-0 z-10 -mx-2 rounded-xl border border-border/70 bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-text-subtle">
            Runtime settings are global platform policy. Changes propagate lazily after save.
          </p>
          <div className="flex items-center gap-3">
            {feedback && <p className="text-xs text-text-muted">{feedback}</p>}
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
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <SectionHeading>Sandbox security</SectionHeading>
        <p className="text-xs text-text-subtle">
          Read-only. This page shows effective tier security shape but does not expose infra
          topology as editable product state.
        </p>
      </div>

      {settings?.tierSecurityPolicies?.length ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {settings.tierSecurityPolicies.map((policy) => (
            <TierSecurityCard key={policy.tier} policy={policy} />
          ))}
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

function CompactPolicyCard({
  title,
  summary,
  children
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-text">{title}</h3>
          <p className="mt-1 text-xs text-text-subtle">{summary}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface-raised px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-text-subtle">{label}</div>
      <div className="mt-1 text-sm font-medium text-text">{value}</div>
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
      <label className="mb-1 block text-xs font-medium text-text-muted">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
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

function SelectField({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-muted">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
      <span className="text-sm text-text">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border accent-accent"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step,
  disabled = false
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-muted">{label}</label>
      <input
        type="number"
        value={String(value)}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong disabled:opacity-60"
      />
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
