"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import type {
  NotificationQuietHoursView,
  PatchNotificationQuietHoursRequest
} from "@persai/contracts";
import { patchNotificationQuietHours } from "@/app/app/assistant-api-client";

const ALL_SOURCES = [
  { value: "idle_reengagement", label: "Idle re-engagement" },
  { value: "quota_advisory", label: "Quota advisory" },
  { value: "reminder", label: "Reminder (off by default; opt in explicitly)" },
  { value: "background_task_push", label: "Background task push" },
  { value: "billing_lifecycle", label: "Billing lifecycle" },
  { value: "admin_system", label: "Admin system" },
  { value: "user_support", label: "User support" },
  { value: "system_event", label: "System event" }
];

type Props = {
  quietHours: NotificationQuietHoursView | null;
  onRefresh: () => void;
  getToken: () => Promise<string | null>;
};

type DraftState = {
  enabled: boolean;
  startLocal: string;
  endLocal: string;
  timezoneMode: string;
  defaultTimezone: string;
  appliesToSources: string[];
};

function toDraft(qh: NotificationQuietHoursView | null): DraftState {
  return {
    enabled: qh?.enabled ?? false,
    startLocal: qh?.startLocal ?? "22:00",
    endLocal: qh?.endLocal ?? "08:00",
    timezoneMode: qh?.timezoneMode ?? "workspace_default",
    defaultTimezone: qh?.defaultTimezone ?? "",
    appliesToSources: qh?.appliesToSources ?? []
  };
}

export function QuietHoursSection({ quietHours, getToken, onRefresh }: Props) {
  const [draft, setDraft] = useState<DraftState>(toDraft(quietHours));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function toggleSource(source: string): void {
    setDraft((d) => {
      const has = d.appliesToSources.includes(source);
      return {
        ...d,
        appliesToSources: has
          ? d.appliesToSources.filter((s) => s !== source)
          : [...d.appliesToSources, source]
      };
    });
  }

  async function save(): Promise<void> {
    const token = await getToken();
    if (!token) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const input: PatchNotificationQuietHoursRequest = {
        enabled: draft.enabled,
        startLocal: draft.startLocal,
        endLocal: draft.endLocal,
        ...(draft.timezoneMode ? { timezoneMode: draft.timezoneMode } : {}),
        defaultTimezone: draft.defaultTimezone !== "" ? draft.defaultTimezone : null,
        appliesToSources: draft.appliesToSources
      };
      await patchNotificationQuietHours(token, input);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save quiet hours.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4 shadow-sm">
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-xs text-text">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
            className="h-3.5 w-3.5 accent-accent"
          />
          Enable quiet hours
        </label>

        {draft.enabled && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-text-muted">
                  Start (local HH:MM)
                </label>
                <input
                  type="time"
                  value={draft.startLocal}
                  onChange={(e) => setDraft((d) => ({ ...d, startLocal: e.target.value }))}
                  className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-text-muted">End (local HH:MM)</label>
                <input
                  type="time"
                  value={draft.endLocal}
                  onChange={(e) => setDraft((d) => ({ ...d, endLocal: e.target.value }))}
                  className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-text-muted">Timezone mode</label>
                <select
                  value={draft.timezoneMode}
                  onChange={(e) => setDraft((d) => ({ ...d, timezoneMode: e.target.value }))}
                  className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="workspace_default">Workspace default</option>
                  <option value="per_user_resolved">Per-user resolved</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-text-muted">
                  Default timezone (IANA, e.g. Europe/Moscow)
                </label>
                <input
                  type="text"
                  value={draft.defaultTimezone}
                  onChange={(e) => setDraft((d) => ({ ...d, defaultTimezone: e.target.value }))}
                  placeholder="e.g. Europe/Moscow"
                  className="rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[10px] font-medium text-text-muted">
                Applies to sources (check to enable quiet hours for that source):
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {ALL_SOURCES.map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2 text-xs text-text">
                    <input
                      type="checkbox"
                      checked={draft.appliesToSources.includes(value)}
                      onChange={() => toggleSource(value)}
                      className="h-3.5 w-3.5 accent-accent"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        {error && <p className="text-[10px] text-destructive">{error}</p>}
        {success && <p className="text-[10px] text-success">Saved.</p>}

        <div className="flex justify-end">
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
  );
}
