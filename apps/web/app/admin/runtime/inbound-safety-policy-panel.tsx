"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2, Save, ShieldAlert } from "lucide-react";
import type {
  SafetyHeuristicPack,
  SafetyHeuristicRuleState,
  SafetyPolicySettingsState
} from "@persai/contracts";
import {
  getAdminSafetyPolicyHeuristicRules,
  getAdminSafetyPolicySettings,
  putAdminSafetyPolicyHeuristicRules,
  putAdminSafetyPolicySettings
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";
import {
  SAFETY_HEURISTIC_PACKS,
  createDraftHeuristicRule,
  filterRulesByPack,
  parseBoundedIntegerField,
  replacePackRules,
  safetyPackLabel,
  toHeuristicRuleUpsertPayload
} from "./inbound-safety-policy.helpers";

function Fold({
  t,
  open: init = true,
  children
}: {
  t: string;
  open?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(init);
  return (
    <section className="rounded-lg border border-border/60 bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-2.5 py-2 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text">{t}</span>
        <span className="text-[10px] text-text-subtle">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border/50 px-2.5 pb-2.5 pt-2">{children}</div>
      ) : null}
    </section>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded border border-border/50 bg-background/40 p-2.5">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function InboundSafetyPolicyPanel({ getToken }: { getToken: () => Promise<string | null> }) {
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<SafetyHeuristicRuleState[]>([]);
  const [settings, setSettings] = useState<SafetyPolicySettingsState | null>(null);
  const [selectedPack, setSelectedPack] = useState<SafetyHeuristicPack>(
    "violence_extremism_explicit"
  );
  const [syncHoldTimeoutMsText, setSyncHoldTimeoutMsText] = useState("2500");
  const [moderationModelId, setModerationModelId] = useState("omni-moderation-latest");
  const [contour2Enabled, setContour2Enabled] = useState(true);
  const [instantBlockPackAllowlist, setInstantBlockPackAllowlist] = useState<SafetyHeuristicPack[]>(
    []
  );
  const [rulesSaving, setRulesSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const packRules = filterRulesByPack(rules, selectedPack);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setError("Not signed in.");
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const [loadedRules, loadedSettings] = await Promise.all([
        getAdminSafetyPolicyHeuristicRules(token),
        getAdminSafetyPolicySettings(token)
      ]);
      setRules(loadedRules);
      setSettings(loadedSettings);
      setSyncHoldTimeoutMsText(String(loadedSettings.syncHoldTimeoutMs));
      setModerationModelId(loadedSettings.moderationModelId);
      setContour2Enabled(loadedSettings.contour2Enabled);
      setInstantBlockPackAllowlist(loadedSettings.instantBlockPackAllowlist);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load inbound safety policy."
      );
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const updatePackRule = (ruleId: string, patch: Partial<SafetyHeuristicRuleState>) => {
    setRules((current) =>
      replacePackRules(
        current,
        selectedPack,
        filterRulesByPack(current, selectedPack).map((rule) =>
          rule.id === ruleId ? { ...rule, ...patch } : rule
        )
      )
    );
  };

  const removePackRule = (ruleId: string) => {
    setRules((current) =>
      replacePackRules(
        current,
        selectedPack,
        filterRulesByPack(current, selectedPack).filter((rule) => rule.id !== ruleId)
      )
    );
  };

  const handleSaveRules = async () => {
    const token = await getToken();
    if (!token) {
      setError("Not signed in.");
      return;
    }
    setRulesSaving(true);
    setFeedback(null);
    setError(null);
    try {
      const saved = await putAdminSafetyPolicyHeuristicRules(token, {
        rules: toHeuristicRuleUpsertPayload(rules)
      });
      setRules(saved);
      setFeedback("Inbound safety heuristic rules saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save heuristic rules.");
    } finally {
      setRulesSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    const token = await getToken();
    if (!token) {
      setError("Not signed in.");
      return;
    }
    setSettingsSaving(true);
    setFeedback(null);
    setError(null);
    try {
      const syncHoldTimeoutMs = parseBoundedIntegerField(
        syncHoldTimeoutMsText,
        "Sync hold timeout (ms)",
        {
          min: 0,
          max: 10_000
        }
      );
      const trimmedModelId = moderationModelId.trim();
      if (trimmedModelId.length === 0) {
        throw new Error("Moderation model id is required.");
      }
      const saved = await putAdminSafetyPolicySettings(token, {
        syncHoldTimeoutMs,
        moderationModelId: trimmedModelId,
        contour2Enabled,
        instantBlockPackAllowlist
      });
      setSettings(saved);
      setSyncHoldTimeoutMsText(String(saved.syncHoldTimeoutMs));
      setModerationModelId(saved.moderationModelId);
      setContour2Enabled(saved.contour2Enabled);
      setInstantBlockPackAllowlist(saved.instantBlockPackAllowlist);
      setFeedback("Inbound safety routing settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save routing settings.");
    } finally {
      setSettingsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <Fold t="Inbound Safety">
      <p className="text-[10px] leading-relaxed text-text-muted">
        Platform harmful-content policy (contour 1 heuristics + routing knobs). This is separate
        from turn-router precheck term lists above and from per-user safety restrictions in{" "}
        <span className="font-mono text-text">Admin &gt; Ops</span>.
      </p>
      {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
      {feedback ? <p className="text-[10px] text-text-muted">{feedback}</p> : null}

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card title="Routing knobs">
          <label className="flex flex-col gap-1 text-[11px] text-text-muted">
            <span>Sync contour-2 hold timeout (ms)</span>
            <input
              value={syncHoldTimeoutMsText}
              onChange={(event) => setSyncHoldTimeoutMsText(event.target.value)}
              className="h-8 rounded border border-border bg-bg px-2 text-[11px] text-text focus:border-accent/50 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-text-muted">
            <span>Moderation model id (contour 2 display)</span>
            <input
              value={moderationModelId}
              onChange={(event) => setModerationModelId(event.target.value)}
              className="h-8 rounded border border-border bg-bg px-2 font-mono text-[11px] text-text focus:border-accent/50 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-[10px] text-text-muted">
            <input
              type="checkbox"
              checked={contour2Enabled}
              onChange={(event) => setContour2Enabled(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-border accent-accent"
            />
            Contour 2 async moderation enabled
          </label>
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-text-muted">Instant-block pack allowlist</p>
            {SAFETY_HEURISTIC_PACKS.map((pack) => (
              <label key={pack} className="flex items-center gap-2 text-[10px] text-text-muted">
                <input
                  type="checkbox"
                  checked={instantBlockPackAllowlist.includes(pack)}
                  onChange={(event) => {
                    setInstantBlockPackAllowlist((current) =>
                      event.target.checked
                        ? [...current, pack]
                        : current.filter((entry) => entry !== pack)
                    );
                  }}
                  className="h-3.5 w-3.5 rounded border-border accent-accent"
                />
                {safetyPackLabel(pack)}
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={settingsSaving}
            onClick={() => void handleSaveSettings()}
            className="inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-surface px-2.5 py-1 text-[10px] font-medium text-text hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {settingsSaving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save routing settings
          </button>
          {settings ? (
            <p className="text-[9px] text-text-subtle">
              Last updated {new Date(settings.updatedAt).toLocaleString()}.
            </p>
          ) : null}
        </Card>

        <Card title="Contour-1 heuristic rules">
          <div className="flex flex-wrap gap-1">
            {SAFETY_HEURISTIC_PACKS.map((pack) => (
              <button
                key={pack}
                type="button"
                onClick={() => setSelectedPack(pack)}
                className={cn(
                  "rounded border px-2 py-1 text-[10px] font-medium transition-colors",
                  selectedPack === pack
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-border/60 bg-surface text-text-muted hover:text-text"
                )}
              >
                {safetyPackLabel(pack)}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto rounded border border-border/50">
            <table className="w-full min-w-[640px] text-[10px]">
              <thead>
                <tr className="border-b border-border/50 text-left text-text-muted">
                  <th className="px-2 py-1.5 font-medium">On</th>
                  <th className="px-2 py-1.5 font-medium">Signal</th>
                  <th className="px-2 py-1.5 font-medium">Locale</th>
                  <th className="px-2 py-1.5 font-medium">Type</th>
                  <th className="px-2 py-1.5 font-medium">Pattern</th>
                  <th className="px-2 py-1.5 font-medium">Wt</th>
                  <th className="px-2 py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {packRules.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-2 py-3 text-center text-text-subtle">
                      No rules in this pack.
                    </td>
                  </tr>
                ) : (
                  packRules.map((rule) => (
                    <tr key={rule.id} className="border-b border-border/30">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(event) =>
                            updatePackRule(rule.id, { enabled: event.target.checked })
                          }
                          className="h-3.5 w-3.5 rounded border-border accent-accent"
                        />
                      </td>
                      <td className="px-2 py-1.5 font-mono text-text">{rule.signalId}</td>
                      <td className="px-2 py-1.5">
                        <select
                          value={rule.locale}
                          onChange={(event) =>
                            updatePackRule(rule.id, {
                              locale: event.target.value as SafetyHeuristicRuleState["locale"]
                            })
                          }
                          className="h-7 rounded border border-border bg-bg px-1 text-[10px]"
                        >
                          <option value="any">any</option>
                          <option value="ru">ru</option>
                          <option value="en">en</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={rule.patternType}
                          onChange={(event) =>
                            updatePackRule(rule.id, {
                              patternType: event.target
                                .value as SafetyHeuristicRuleState["patternType"]
                            })
                          }
                          className="h-7 rounded border border-border bg-bg px-1 text-[10px]"
                        >
                          <option value="literal">literal</option>
                          <option value="regex">regex</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={rule.pattern}
                          onChange={(event) =>
                            updatePackRule(rule.id, { pattern: event.target.value })
                          }
                          className="h-7 w-full min-w-[180px] rounded border border-border bg-bg px-2 font-mono text-[10px]"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={String(rule.weight)}
                          onChange={(event) => {
                            const parsed = Number.parseInt(event.target.value, 10);
                            if (Number.isInteger(parsed)) {
                              updatePackRule(rule.id, { weight: parsed });
                            }
                          }}
                          className="h-7 w-12 rounded border border-border bg-bg px-2 text-[10px]"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removePackRule(rule.id)}
                          className="text-[9px] font-semibold uppercase tracking-wide text-text-subtle hover:text-destructive"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                setRules((current) =>
                  replacePackRules(current, selectedPack, [
                    ...filterRulesByPack(current, selectedPack),
                    createDraftHeuristicRule(selectedPack)
                  ])
                )
              }
              className="rounded border border-border/60 px-2 py-1 text-[10px] font-medium text-text-muted hover:text-text"
            >
              Add rule
            </button>
            <button
              type="button"
              disabled={rulesSaving}
              onClick={() => void handleSaveRules()}
              className="inline-flex cursor-pointer items-center gap-1 rounded border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] font-medium text-accent hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rulesSaving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ShieldAlert className="h-3 w-3" />
              )}
              Save heuristic rules
            </button>
          </div>
        </Card>
      </div>
    </Fold>
  );
}
