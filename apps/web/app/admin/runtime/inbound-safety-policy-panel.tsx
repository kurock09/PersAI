"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Loader2, RefreshCcw, ShieldAlert } from "lucide-react";
import type {
  SafetyHeuristicPack,
  SafetyHeuristicRuleState,
  SafetyPolicySettingsState
} from "@persai/contracts";
import {
  getAdminSafetyPolicyHeuristicRules,
  getAdminSafetyPolicySettings,
  putAdminSafetyPolicyHeuristicRules,
  putAdminSafetyPolicySettings,
  usesAdminBffProxy
} from "@/app/app/assistant-api-client";
import { getAdminSessionToken } from "@/app/admin/admin-session";
import { cn } from "@/app/lib/utils";
import { RuntimeCard, RuntimeFold } from "./runtime-layout";
import {
  SAFETY_HEURISTIC_PACKS,
  createDraftHeuristicRule,
  filterRulesByPack,
  parseBoundedIntegerField,
  replacePackRules,
  safetyPackLabel,
  toHeuristicRuleUpsertPayload
} from "./inbound-safety-policy.helpers";

export function InboundSafetyPolicyPanel() {
  const { getToken, isLoaded } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [rules, setRules] = useState<SafetyHeuristicRuleState[]>([]);
  const [settings, setSettings] = useState<SafetyPolicySettingsState | null>(null);
  const [selectedPack, setSelectedPack] = useState<SafetyHeuristicPack>(
    "violence_extremism_explicit"
  );
  const [syncHoldTimeoutMsText, setSyncHoldTimeoutMsText] = useState("");
  const [moderationModelId, setModerationModelId] = useState("");
  const [contour2Enabled, setContour2Enabled] = useState(true);
  const [instantBlockPackAllowlist, setInstantBlockPackAllowlist] = useState<SafetyHeuristicPack[]>(
    []
  );
  const [saving, setSaving] = useState(false);
  const [foldOpen, setFoldOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const packRules = filterRulesByPack(rules, selectedPack);

  const load = useCallback(async () => {
    if (!isLoaded) {
      return;
    }
    const token = await getAdminSessionToken(getToken);
    if (!usesAdminBffProxy() && !token) {
      setError("Not signed in.");
      setLoading(false);
      setLoaded(false);
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
      setLoaded(true);
    } catch (loadError) {
      setLoaded(false);
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load inbound safety policy."
      );
    } finally {
      setLoading(false);
    }
  }, [getToken, isLoaded]);

  useEffect(() => {
    if (!foldOpen) {
      return;
    }
    void load();
  }, [foldOpen, load]);

  const resolveSessionToken = async (): Promise<string | null> => {
    if (!isLoaded) {
      setError("Auth is still loading. Try again in a moment.");
      return null;
    }
    const token = await getAdminSessionToken(getToken);
    if (!usesAdminBffProxy() && !token) {
      setError("Not signed in.");
      return null;
    }
    return token;
  };

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

  const handleSave = async () => {
    const token = await resolveSessionToken();
    if (!token) {
      return;
    }
    setSaving(true);
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
      const [savedSettings, savedRules] = await Promise.all([
        putAdminSafetyPolicySettings(token, {
          syncHoldTimeoutMs,
          moderationModelId: trimmedModelId,
          contour2Enabled,
          instantBlockPackAllowlist
        }),
        putAdminSafetyPolicyHeuristicRules(token, {
          rules: toHeuristicRuleUpsertPayload(rules)
        })
      ]);
      setSettings(savedSettings);
      setRules(savedRules);
      setSyncHoldTimeoutMsText(String(savedSettings.syncHoldTimeoutMs));
      setModerationModelId(savedSettings.moderationModelId);
      setContour2Enabled(savedSettings.contour2Enabled);
      setInstantBlockPackAllowlist(savedSettings.instantBlockPackAllowlist);
      setFeedback("Inbound safety policy saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save inbound safety policy."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <RuntimeFold t="Inbound Safety" onOpenChange={setFoldOpen}>
      <p className="text-[10px] leading-relaxed text-text-muted">
        Harmful-content checks on inbound user messages (contour 1 heuristics + contour 2
        moderation). Independent from <span className="font-medium text-text">Router Policy</span>{" "}
        precheck term lists and from per-user blocks in{" "}
        <span className="font-mono text-text">Admin &gt; Ops</span>.
      </p>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
        </div>
      ) : !loaded ? (
        <div className="space-y-2">
          {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-surface px-2.5 py-1 text-[10px] font-medium text-text hover:bg-surface-hover"
          >
            <RefreshCcw className="h-3 w-3" />
            Retry load
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
          {feedback ? <p className="text-[10px] text-text-muted">{feedback}</p> : null}

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <RuntimeCard title="Moderation policy">
              <label className="flex flex-col gap-1 text-[11px] text-text-muted">
                <span>Sync contour-2 hold timeout (ms)</span>
                <input
                  value={syncHoldTimeoutMsText}
                  onChange={(event) => setSyncHoldTimeoutMsText(event.target.value)}
                  className="h-8 rounded border border-border bg-bg px-2 text-[11px] text-text focus:border-accent/50 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-text-muted">
                <span>Moderation model id (contour 2)</span>
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
                <p className="text-[10px] font-medium text-text-muted">
                  Instant-block pack allowlist
                </p>
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
              {settings ? (
                <p className="text-[9px] text-text-subtle">
                  Last updated {new Date(settings.updatedAt).toLocaleString()}.
                </p>
              ) : null}
            </RuntimeCard>

            <RuntimeCard title="Contour-1 heuristic rules">
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
            </RuntimeCard>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/40 bg-surface px-2.5 py-2">
            <p className="text-[10px] text-text-subtle">
              Saves moderation policy and all contour-1 rules together. Does not change runtime
              provider settings above.
            </p>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex cursor-pointer items-center gap-1 rounded border border-accent bg-accent px-2.5 py-1 text-[10px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ShieldAlert className="h-3 w-3" />
              )}
              Save inbound safety
            </button>
          </div>
        </div>
      )}
    </RuntimeFold>
  );
}
