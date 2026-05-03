"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@clerk/nextjs";
import { Loader2, Save } from "lucide-react";
import type {
  AdminBillingLifecycleNotificationPolicy,
  AdminBillingLifecycleNotificationRule,
  AdminBillingLifecycleSettingsRequest,
  AdminBillingLifecycleSettingsState,
  AdminPlanState
} from "@persai/contracts";
import {
  getAdminBillingLifecycleSettings,
  getAdminPlans,
  putAdminBillingLifecycleSettings
} from "@/app/app/assistant-api-client";

export function toBillingLifecycleSettingsRequest(input: {
  gracePeriodDays: string;
  globalFallbackPlanCode: string;
  assistantPushEnabled: boolean;
  rules: AdminBillingLifecycleNotificationRule[];
}): AdminBillingLifecycleSettingsRequest {
  const gracePeriodDays = Number(input.gracePeriodDays);
  if (!Number.isInteger(gracePeriodDays) || gracePeriodDays <= 0 || gracePeriodDays > 90) {
    throw new Error("Grace period must be a whole number from 1 to 90 days.");
  }
  return {
    gracePeriodDays,
    globalFallbackPlanCode:
      input.globalFallbackPlanCode.trim().length > 0 ? input.globalFallbackPlanCode.trim() : null,
    notificationPolicy: {
      emailEnabled: true,
      assistantPushEnabled: input.assistantPushEnabled,
      rules: input.rules
    }
  };
}

function defaultNotificationPolicy(): AdminBillingLifecycleNotificationPolicy {
  return {
    emailEnabled: true,
    assistantPushEnabled: false,
    rules: [
      { notificationCode: "trial_ending", enabled: true, offsetDays: 3 },
      { notificationCode: "trial_expired", enabled: true, offsetDays: null },
      { notificationCode: "renewal_failed", enabled: true, offsetDays: null },
      { notificationCode: "grace_ending", enabled: true, offsetDays: 1 },
      { notificationCode: "grace_expired", enabled: true, offsetDays: null },
      { notificationCode: "payment_recovered", enabled: true, offsetDays: null }
    ]
  };
}

const NOTIFICATION_LABELS: Record<
  AdminBillingLifecycleNotificationRule["notificationCode"],
  string
> = {
  trial_ending: "Before trial ends",
  trial_expired: "Trial expired / fallback applied",
  renewal_failed: "Paid renewal failed",
  grace_ending: "Before grace ends",
  grace_expired: "Grace expired / fallback applied",
  payment_recovered: "Payment recovered"
};

export default function AdminBillingSettingsPage() {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<AdminBillingLifecycleSettingsState | null>(null);
  const [plans, setPlans] = useState<AdminPlanState[]>([]);
  const [gracePeriodDays, setGracePeriodDays] = useState("");
  const [globalFallbackPlanCode, setGlobalFallbackPlanCode] = useState("");
  const [assistantPushEnabled, setAssistantPushEnabled] = useState(false);
  const [notificationRules, setNotificationRules] = useState<
    AdminBillingLifecycleNotificationRule[]
  >(() => defaultNotificationPolicy().rules);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const activePlans = useMemo(() => plans.filter((plan) => plan.status === "active"), [plans]);

  const load = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Missing auth token.");
      const [nextSettings, nextPlans] = await Promise.all([
        getAdminBillingLifecycleSettings(token),
        getAdminPlans(token)
      ]);
      setSettings(nextSettings);
      setPlans(nextPlans);
      setGracePeriodDays(String(nextSettings.gracePeriodDays));
      setGlobalFallbackPlanCode(nextSettings.globalFallbackPlanCode ?? "");
      setAssistantPushEnabled(nextSettings.notificationPolicy.assistantPushEnabled);
      setNotificationRules(nextSettings.notificationPolicy.rules);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load billing settings.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Missing auth token.");
      const response = await putAdminBillingLifecycleSettings(
        token,
        toBillingLifecycleSettingsRequest({
          gracePeriodDays,
          globalFallbackPlanCode,
          assistantPushEnabled,
          rules: notificationRules
        })
      );
      setSettings(response.settings);
      setGracePeriodDays(String(response.settings.gracePeriodDays));
      setGlobalFallbackPlanCode(response.settings.globalFallbackPlanCode ?? "");
      setAssistantPushEnabled(response.settings.notificationPolicy.assistantPushEnabled);
      setNotificationRules(response.settings.notificationPolicy.rules);
      setFeedback("Billing lifecycle settings saved.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to save billing settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6 text-text">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-text-subtle">Admin</p>
        <h1 className="text-2xl font-semibold">Billing Settings</h1>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          PersAI-owned lifecycle policy for paid renewal grace and fallback. Payment providers only
          report success or failure; these settings decide how the subscription moves through grace.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading billing lifecycle settings...
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={onSubmit}>
            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                Grace period days
              </span>
              <input
                type="number"
                min={1}
                max={90}
                value={gracePeriodDays}
                onChange={(event) => setGracePeriodDays(event.target.value)}
                className="w-40 rounded border border-border bg-surface-raised px-3 py-2 text-sm"
              />
              <span className="text-xs text-text-muted">
                Paid users stay on their paid plan during grace after failed renewal.
              </span>
            </label>

            <section className="grid gap-3 rounded-xl border border-border bg-surface-raised p-3">
              <div>
                <h2 className="text-sm font-semibold">Lifecycle notifications</h2>
                <p className="text-xs text-text-muted">
                  Email work is always created for billing lifecycle events. Assistant push is
                  optional and uses the existing assistant notification channel when available.
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={assistantPushEnabled}
                  onChange={(event) => setAssistantPushEnabled(event.target.checked)}
                  className="mt-1"
                />
                <span>Also enqueue assistant push / Telegram notifications when available</span>
              </label>
              <div className="grid gap-2">
                {notificationRules.map((rule, index) => (
                  <label
                    key={rule.notificationCode}
                    className="flex flex-wrap items-center gap-3 rounded border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(event) =>
                        setNotificationRules((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, enabled: event.target.checked } : item
                          )
                        )
                      }
                    />
                    <span className="min-w-56 font-medium">
                      {NOTIFICATION_LABELS[rule.notificationCode]}
                    </span>
                    {rule.offsetDays !== null && (
                      <>
                        <span className="text-xs text-text-muted">Offset days</span>
                        <input
                          type="number"
                          min={0}
                          max={30}
                          value={rule.offsetDays}
                          onChange={(event) =>
                            setNotificationRules((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, offsetDays: Number(event.target.value) }
                                  : item
                              )
                            )
                          }
                          className="w-20 rounded border border-border bg-surface-raised px-2 py-1 text-sm"
                        />
                      </>
                    )}
                  </label>
                ))}
              </div>
            </section>

            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-subtle">
                Global fallback plan
              </span>
              <select
                value={globalFallbackPlanCode}
                onChange={(event) => setGlobalFallbackPlanCode(event.target.value)}
                className="max-w-md rounded border border-border bg-surface-raised px-3 py-2 text-sm"
              >
                <option value="">Not configured</option>
                {activePlans.map((plan) => (
                  <option key={plan.code} value={plan.code}>
                    {plan.displayName} ({plan.code})
                  </option>
                ))}
              </select>
              <span className="text-xs text-text-muted">
                Used when a paid plan does not define its own paid fallback.
              </span>
            </label>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save settings
              </button>
              {settings && (
                <span className="text-xs text-text-subtle">
                  Last updated {new Date(settings.updatedAt).toLocaleString()}
                </span>
              )}
            </div>
          </form>
        )}
        {feedback && <p className="mt-3 text-sm text-text-muted">{feedback}</p>}
      </section>
    </main>
  );
}
