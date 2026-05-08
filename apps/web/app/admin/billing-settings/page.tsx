"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@clerk/nextjs";
import { Loader2, Save } from "lucide-react";
import Link from "next/link";
import type {
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
}): AdminBillingLifecycleSettingsRequest {
  const gracePeriodDays = Number(input.gracePeriodDays);
  if (!Number.isInteger(gracePeriodDays) || gracePeriodDays <= 0 || gracePeriodDays > 90) {
    throw new Error("Grace period must be a whole number from 1 to 90 days.");
  }
  return {
    gracePeriodDays,
    globalFallbackPlanCode:
      input.globalFallbackPlanCode.trim().length > 0 ? input.globalFallbackPlanCode.trim() : null
  };
}

export default function AdminBillingSettingsPage() {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<AdminBillingLifecycleSettingsState | null>(null);
  const [plans, setPlans] = useState<AdminPlanState[]>([]);
  const [gracePeriodDays, setGracePeriodDays] = useState("");
  const [globalFallbackPlanCode, setGlobalFallbackPlanCode] = useState("");
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
        toBillingLifecycleSettingsRequest({ gracePeriodDays, globalFallbackPlanCode })
      );
      setSettings(response.settings);
      setGracePeriodDays(String(response.settings.gracePeriodDays));
      setGlobalFallbackPlanCode(response.settings.globalFallbackPlanCode ?? "");
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

      <div className="rounded-xl border border-border/60 bg-surface-raised px-4 py-3 text-sm text-text-muted">
        Billing notification policy (which rules to send, assistant push, offset days) is now
        managed in{" "}
        <Link href="/admin/notifications" className="text-accent underline hover:opacity-80">
          Admin &rsaquo; Notifications
        </Link>{" "}
        (source: <span className="font-mono text-xs">billing_lifecycle</span>).
      </div>

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
