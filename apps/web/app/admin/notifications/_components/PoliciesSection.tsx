"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import type { NotificationPolicyView, PatchNotificationPolicyRequest } from "@persai/contracts";
import { listNotificationPolicies, patchNotificationPolicy } from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

type Props = {
  policies: NotificationPolicyView[];
  onRefresh: () => void;
  getToken: () => Promise<string | null>;
};

const SOURCE_LABELS: Record<string, string> = {
  idle_reengagement: "Idle re-engagement",
  quota_advisory: "Quota advisory",
  reminder: "Reminder",
  background_task_push: "Background task push",
  billing_lifecycle: "Billing lifecycle",
  admin_system: "Admin system",
  system_event: "System event"
};

const STRATEGY_LABELS: Record<string, string> = {
  grounded_llm: "Grounded LLM",
  template: "Template",
  static_fallback: "Static fallback"
};

type DraftState = {
  enabled: boolean;
  cooldownMinutes: string;
  maxPerDay: string;
  escalationAfterMinutes: string;
  escalationChannel: string;
  renderStrategy: string;
  templateId: string;
  llmInstruction: string;
  respectQuietHours: boolean;
};

function policyToDraft(policy: NotificationPolicyView): DraftState {
  const config =
    policy.config != null && typeof policy.config === "object" && !Array.isArray(policy.config)
      ? (policy.config as Record<string, unknown>)
      : {};
  return {
    enabled: policy.enabled,
    cooldownMinutes: policy.cooldownMinutes != null ? String(policy.cooldownMinutes) : "",
    maxPerDay: policy.maxPerDay != null ? String(policy.maxPerDay) : "",
    escalationAfterMinutes:
      policy.escalationAfterMinutes != null ? String(policy.escalationAfterMinutes) : "",
    escalationChannel: policy.escalationChannel ?? "",
    renderStrategy: policy.renderStrategy,
    templateId: policy.templateId ?? "",
    llmInstruction: typeof config["llmInstruction"] === "string" ? config["llmInstruction"] : "",
    respectQuietHours: policy.respectQuietHours
  };
}

function PolicyRow({
  policy,
  getToken,
  onUpdated
}: {
  policy: NotificationPolicyView;
  getToken: () => Promise<string | null>;
  onUpdated: (updated: NotificationPolicyView) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<DraftState>(policyToDraft(policy));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function save(): Promise<void> {
    const token = await getToken();
    if (!token) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const input: PatchNotificationPolicyRequest = {
        enabled: draft.enabled,
        cooldownMinutes: draft.cooldownMinutes !== "" ? Number(draft.cooldownMinutes) : null,
        maxPerDay: draft.maxPerDay !== "" ? Number(draft.maxPerDay) : null,
        escalationAfterMinutes:
          draft.escalationAfterMinutes !== "" ? Number(draft.escalationAfterMinutes) : null,
        escalationChannel: draft.escalationChannel !== "" ? draft.escalationChannel : null,
        ...(draft.renderStrategy ? { renderStrategy: draft.renderStrategy } : {}),
        templateId:
          draft.renderStrategy === "template" && draft.templateId !== "" ? draft.templateId : null,
        renderInstructionRef: null,
        config:
          draft.renderStrategy === "grounded_llm"
            ? { llmInstruction: draft.llmInstruction !== "" ? draft.llmInstruction : null }
            : {},
        respectQuietHours: draft.respectQuietHours
      };
      const updated = await patchNotificationPolicy(token, policy.source, input);
      onUpdated(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save policy.");
    } finally {
      setSaving(false);
    }
  }

  const label = SOURCE_LABELS[policy.source] ?? policy.source;

  return (
    <div className="rounded-lg border border-border bg-surface-raised shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text">{label}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              policy.enabled ? "bg-success/15 text-success" : "bg-surface-hover text-text-muted"
            )}
          >
            {policy.enabled ? "enabled" : "disabled"}
          </span>
          <span className="text-[10px] text-text-muted">
            {STRATEGY_LABELS[policy.renderStrategy] ?? policy.renderStrategy}
          </span>
        </div>
        <span className="text-xs text-text-muted">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-xs text-text">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                className="h-3.5 w-3.5 accent-accent"
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-xs text-text">
              <input
                type="checkbox"
                checked={draft.respectQuietHours}
                onChange={(e) => setDraft((d) => ({ ...d, respectQuietHours: e.target.checked }))}
                className="h-3.5 w-3.5 accent-accent"
              />
              Respect quiet hours
            </label>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-text-muted">Cooldown (min)</label>
              <input
                type="number"
                value={draft.cooldownMinutes}
                onChange={(e) => setDraft((d) => ({ ...d, cooldownMinutes: e.target.value }))}
                placeholder="none"
                className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-text-muted">Max per day</label>
              <input
                type="number"
                value={draft.maxPerDay}
                onChange={(e) => setDraft((d) => ({ ...d, maxPerDay: e.target.value }))}
                placeholder="none"
                className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-text-muted">
                Escalation after (min)
              </label>
              <input
                type="number"
                value={draft.escalationAfterMinutes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, escalationAfterMinutes: e.target.value }))
                }
                placeholder="none"
                className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-text-muted">Escalation channel</label>
              <input
                type="text"
                value={draft.escalationChannel}
                onChange={(e) => setDraft((d) => ({ ...d, escalationChannel: e.target.value }))}
                placeholder="e.g. email"
                className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-text-muted">Render strategy</label>
              <select
                value={draft.renderStrategy}
                onChange={(e) => setDraft((d) => ({ ...d, renderStrategy: e.target.value }))}
                className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="grounded_llm">Grounded LLM</option>
                <option value="template">Template</option>
                <option value="static_fallback">Static fallback</option>
              </select>
            </div>
            {draft.renderStrategy === "template" && (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-[10px] font-medium text-text-muted">
                  Postmark Template ID
                </label>
                <input
                  type="text"
                  value={draft.templateId}
                  onChange={(e) => setDraft((d) => ({ ...d, templateId: e.target.value }))}
                  placeholder="e.g. 12345678"
                  className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            )}
            {draft.renderStrategy === "grounded_llm" && (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-[10px] font-medium text-text-muted">
                  LLM instruction
                  <span className="ml-1 font-normal text-text-muted/70">
                    (overrides built-in prompt; leave blank to use default)
                  </span>
                </label>
                <textarea
                  value={draft.llmInstruction}
                  onChange={(e) => setDraft((d) => ({ ...d, llmInstruction: e.target.value }))}
                  placeholder="Write one short, calm message when this notification fires. Base it only on the provided facts…"
                  rows={4}
                  className="rounded border border-border bg-bg px-2 py-1.5 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent resize-y"
                />
              </div>
            )}
          </div>

          {error && <p className="mt-2 text-[10px] text-destructive">{error}</p>}
          {success && <p className="mt-2 text-[10px] text-success">Saved.</p>}

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PoliciesSection({ policies, getToken, onRefresh }: Props) {
  const [localPolicies, setLocalPolicies] = useState(policies);

  function handleUpdated(updated: NotificationPolicyView): void {
    setLocalPolicies((prev) => prev.map((p) => (p.source === updated.source ? updated : p)));
    onRefresh();
  }

  if (localPolicies.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-xs text-text-muted">
        No policies configured. Run seed to populate notification policies.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {localPolicies.map((policy) => (
        <PolicyRow
          key={policy.source}
          policy={policy}
          getToken={getToken}
          onUpdated={handleUpdated}
        />
      ))}
    </div>
  );
}

export async function loadPolicies(token: string): Promise<NotificationPolicyView[]> {
  return listNotificationPolicies(token);
}
