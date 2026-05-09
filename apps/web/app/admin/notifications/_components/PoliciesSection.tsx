"use client";

import { useState } from "react";
import { Loader2, Save, Send } from "lucide-react";
import type { NotificationPolicyView, PatchNotificationPolicyRequest } from "@persai/contracts";
import {
  listNotificationPolicies,
  patchNotificationPolicy,
  testSendNotificationForSource,
  type TestSendForSourceResult
} from "@/app/app/assistant-api-client";
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

const CHANNEL_LABELS: Record<string, string> = {
  telegram_thread: "Telegram thread",
  web_thread: "Web thread",
  web_notification_center: "Notifications / Уведомления",
  email: "Email",
  admin_webhook: "Admin webhook",
  user_preferred: "User preferred (resolved at delivery)",
  current_thread: "Current thread (resolved at delivery)"
};

const RENDER_STRATEGY_DESCRIPTIONS: Record<string, string> = {
  template: "Text built from a versioned PersAI template per event (used for billing).",
  grounded_llm:
    "Text was generated upstream by the assistant runtime with full chat context and is passed through as-is. The notification platform itself does NOT call an LLM.",
  static_fallback: "Minimal deterministic text from factPayload.message / factPayload.text."
};

/** Real transport channels that can be used as escalation targets. */
const REAL_TRANSPORT_CHANNELS = [
  "telegram_thread",
  "web_thread",
  "web_notification_center",
  "email",
  "admin_webhook"
] as const;

/** Default-channel option list per source. */
const DEFAULT_CHANNEL_OPTIONS: Record<string, readonly string[]> = {
  billing_lifecycle: ["email", "admin_webhook"],
  system_event: ["admin_webhook"],
  idle_reengagement: ["user_preferred", "telegram_thread", "web_notification_center", "email"],
  reminder: ["user_preferred", "telegram_thread", "web_notification_center", "email"],
  background_task_push: ["user_preferred", "telegram_thread", "web_notification_center", "email"],
  quota_advisory: ["current_thread"],
  admin_system: ["admin_webhook"]
};

const BILLING_EVENT_CODES = [
  "trial_ending",
  "trial_expired",
  "renewal_failed",
  "grace_ending",
  "grace_expired",
  "payment_recovered"
] as const;

type DraftState = {
  rawConfig: Record<string, unknown>;
  enabled: boolean;
  cooldownMinutes: string;
  maxPerDay: string;
  escalationAfterMinutes: string;
  escalationChannel: string;
  defaultChannel: string;
  respectQuietHours: boolean;
  idleHours: string;
  postmarkTemplateId: string;
};

function policyToDraft(policy: NotificationPolicyView): DraftState {
  const config =
    policy.config != null && typeof policy.config === "object" && !Array.isArray(policy.config)
      ? (policy.config as Record<string, unknown>)
      : {};
  const postmarkTemplateId =
    typeof config["postmarkTemplateId"] === "number"
      ? String(config["postmarkTemplateId"])
      : typeof config["postmarkTemplateId"] === "string"
        ? config["postmarkTemplateId"]
        : "";
  const idleHours =
    typeof config["idleHours"] === "number"
      ? String(config["idleHours"])
      : typeof config["idleHours"] === "string"
        ? config["idleHours"]
        : "";
  return {
    rawConfig: config,
    enabled: policy.enabled,
    cooldownMinutes: policy.cooldownMinutes != null ? String(policy.cooldownMinutes) : "",
    maxPerDay: policy.maxPerDay != null ? String(policy.maxPerDay) : "",
    escalationAfterMinutes:
      policy.escalationAfterMinutes != null ? String(policy.escalationAfterMinutes) : "",
    escalationChannel: policy.escalationChannel ?? "",
    defaultChannel: policy.channels[0] ?? "",
    respectQuietHours: policy.respectQuietHours,
    idleHours,
    postmarkTemplateId
  };
}

const TEST_REASON_LABELS: Record<string, string> = {
  current_thread_requires_live_surface_context: "requires live chat context",
  user_preferred_unavailable: "preferred channel unavailable",
  channel_registry_row_missing: "channel not configured",
  no_adapter_registered: "adapter not found",
  postmark_token_unavailable: "Postmark token missing",
  email_to_address_not_configured: "recipient address missing"
};

function TestSendBadge({ result }: { result: TestSendForSourceResult }) {
  if (result.ok) {
    return (
      <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
        ✓ Delivered via {result.channelType}
      </span>
    );
  }
  const rawReason =
    typeof result.error?.["reason"] === "string" ? result.error["reason"] : result.status;
  const hint = typeof result.error?.["hint"] === "string" ? result.error["hint"] : undefined;
  const label = TEST_REASON_LABELS[rawReason] ?? rawReason;
  return (
    <span
      className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive"
      title={hint ?? rawReason}
    >
      ✗ {label}
    </span>
  );
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
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [testResult, setTestResult] = useState<TestSendForSourceResult | null>(null);
  const [billingEventCode, setBillingEventCode] = useState<string>(BILLING_EVENT_CODES[0]);

  const isBilling = policy.source === "billing_lifecycle";
  const isIdleReengagement = policy.source === "idle_reengagement";
  const defaultChannelOptions = DEFAULT_CHANNEL_OPTIONS[policy.source] ?? REAL_TRANSPORT_CHANNELS;
  const label = SOURCE_LABELS[policy.source] ?? policy.source;
  const effectiveChannel = policy.channels[0] ?? "—";
  const channelLabel = CHANNEL_LABELS[effectiveChannel] ?? effectiveChannel;

  async function save(): Promise<void> {
    const token = await getToken();
    if (!token) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const config: Record<string, unknown> = { ...draft.rawConfig };
      if (isBilling && draft.postmarkTemplateId.trim().length > 0) {
        const num = Number(draft.postmarkTemplateId.trim());
        config["postmarkTemplateId"] = isNaN(num) ? draft.postmarkTemplateId.trim() : num;
      } else {
        delete config["postmarkTemplateId"];
      }
      if (isIdleReengagement && draft.idleHours.trim().length > 0) {
        config["idleHours"] = Number(draft.idleHours.trim());
      } else if (isIdleReengagement) {
        delete config["idleHours"];
      }

      const input: PatchNotificationPolicyRequest = {
        enabled: draft.enabled,
        channels: draft.defaultChannel !== "" ? [draft.defaultChannel] : policy.channels,
        cooldownMinutes: draft.cooldownMinutes !== "" ? Number(draft.cooldownMinutes) : null,
        maxPerDay: draft.maxPerDay !== "" ? Number(draft.maxPerDay) : null,
        escalationAfterMinutes:
          draft.escalationAfterMinutes !== "" ? Number(draft.escalationAfterMinutes) : null,
        escalationChannel: draft.escalationChannel !== "" ? draft.escalationChannel : null,
        respectQuietHours: draft.respectQuietHours,
        config
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

  async function runTest(): Promise<void> {
    const token = await getToken();
    if (!token) return;
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await testSendNotificationForSource(token, policy.source, {
        ...(isBilling ? { eventCode: billingEventCode } : {})
      });
      setTestResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-raised shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-text">{label}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              policy.enabled ? "bg-success/15 text-success" : "bg-surface-hover text-text-muted"
            )}
          >
            {policy.enabled ? "enabled" : "disabled"}
          </span>
          <span className="rounded-full border border-border/60 bg-surface px-2 py-0.5 text-[10px] text-text-muted">
            {channelLabel}
          </span>
          {testResult && <TestSendBadge result={testResult} />}
        </div>
        <span className="text-xs text-text-muted">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
          {/* Operational fields */}
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
          </div>

          {isIdleReengagement && (
            <div className="space-y-2 rounded-lg border border-border/50 bg-surface px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Idle Re-Engagement
              </div>
              <div className="max-w-xs space-y-1">
                <label className="text-[10px] font-medium text-text-muted">
                  Idle after (hours)
                </label>
                <input
                  type="number"
                  min="1"
                  value={draft.idleHours}
                  onChange={(e) => setDraft((d) => ({ ...d, idleHours: e.target.value }))}
                  placeholder="24"
                  className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <p className="text-[10px] leading-relaxed text-text-muted">
                  Runtime starts evaluating idle re-engagement only after this many hours since the
                  last user message.
                </p>
              </div>
            </div>
          )}

          {/* Routing */}
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Routing
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-text-muted">Default channel</label>
                <select
                  value={draft.defaultChannel}
                  onChange={(e) => setDraft((d) => ({ ...d, defaultChannel: e.target.value }))}
                  className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {defaultChannelOptions.map((v) => (
                    <option key={v} value={v}>
                      {CHANNEL_LABELS[v] ?? v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-text-muted">
                  Escalation channel
                </label>
                <select
                  value={draft.escalationChannel}
                  onChange={(e) => setDraft((d) => ({ ...d, escalationChannel: e.target.value }))}
                  className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">None</option>
                  {REAL_TRANSPORT_CHANNELS.map((v) => (
                    <option key={v} value={v}>
                      {CHANNEL_LABELS[v] ?? v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Info (read-only) */}
          <div className="space-y-2 rounded-lg border border-border/50 bg-surface px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Info
            </div>
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-text-muted">Render strategy</div>
              <div className="text-[11px] text-text">
                <span className="font-medium">{policy.renderStrategy}</span>
                {" — "}
                <span className="text-text-muted">
                  {RENDER_STRATEGY_DESCRIPTIONS[policy.renderStrategy] ?? policy.renderStrategy}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-text-muted">Channels (current)</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {policy.channels.map((ch) => (
                  <li key={ch} className="text-[11px] text-text">
                    {CHANNEL_LABELS[ch] ?? ch}
                  </li>
                ))}
                {policy.channels.length === 0 && (
                  <li className="text-[11px] text-text-muted">none</li>
                )}
              </ul>
            </div>
          </div>

          {/* Billing lifecycle extras */}
          {isBilling && (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Billing-specific
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-[10px] font-medium text-text-muted">
                  Postmark Template ID
                </label>
                <input
                  type="text"
                  value={draft.postmarkTemplateId}
                  onChange={(e) => setDraft((d) => ({ ...d, postmarkTemplateId: e.target.value }))}
                  placeholder="Leave empty — PersAI renders the email"
                  className="w-64 rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <div className="space-y-1 text-[10px] text-text-muted leading-relaxed">
                  <p>
                    <span className="font-medium text-text">Empty (recommended PROD path):</span>{" "}
                    PersAI renders the complete email — subject, HTML and plain-text — from its
                    internal billing templates and sends it via the standard Postmark{" "}
                    <code className="rounded bg-surface-hover px-0.5 font-mono">POST /email</code>{" "}
                    API. No Postmark template is needed.
                  </p>
                  <p>
                    <span className="font-medium text-text">Numeric ID (optional override):</span>{" "}
                    Skips PersAI rendering and sends the raw billing event data to your
                    Postmark-hosted template via{" "}
                    <code className="rounded bg-surface-hover px-0.5 font-mono">
                      POST /email/withTemplate
                    </code>
                    . Your Postmark template receives fields like{" "}
                    <code className="rounded bg-surface-hover px-0.5 font-mono">{"{{rule}}"}</code>,{" "}
                    <code className="rounded bg-surface-hover px-0.5 font-mono">
                      {"{{planDisplayName}}"}
                    </code>{" "}
                    etc. and is responsible for all formatting.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[10px] font-medium text-text-muted">Test event</label>
                <select
                  value={billingEventCode}
                  onChange={(e) => setBillingEventCode(e.target.value)}
                  className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {BILLING_EVENT_CODES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void runTest()}
                  disabled={testing || saving}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-muted transition hover:border-accent/50 hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {testing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Test event
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-[10px] text-destructive">{error}</p>}
          {success && <p className="text-[10px] text-success">Saved.</p>}

          <div className="flex items-center justify-between">
            {/* Non-billing test send */}
            {!isBilling && (
              <button
                type="button"
                onClick={() => void runTest()}
                disabled={testing || saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-muted transition hover:border-accent/50 hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Test
              </button>
            )}
            <div className={isBilling ? "ml-auto" : ""}>
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
