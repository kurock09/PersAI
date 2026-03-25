"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Bell,
  Check,
  KeyRound,
  Loader2,
  Pencil,
  X,
} from "lucide-react";
import type {
  AdminNotificationChannelState,
  PatchAdminNotificationWebhookChannelRequest,
} from "@persai/contracts";
import {
  AdminNotificationChannelStatus,
  AdminNotificationChannelType,
} from "@persai/contracts";
import {
  getAdminNotificationChannels,
  patchAdminNotificationWebhookChannel,
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

type WebhookDraft = {
  enabled: boolean;
  endpointUrl: string;
  signingSecret: string;
};

function emptyWebhookDraft(ch: AdminNotificationChannelState): WebhookDraft {
  return {
    enabled: ch.status === AdminNotificationChannelStatus.active,
    endpointUrl: ch.endpointUrl ?? "",
    signingSecret: "",
  };
}

function ChannelStatusBadge({ status }: { status: AdminNotificationChannelState["status"] }) {
  const active = status === AdminNotificationChannelStatus.active;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
        active ? "bg-success/15 text-success" : "bg-surface-hover text-text-muted"
      )}
    >
      {status}
    </span>
  );
}

export default function AdminNotificationsPage() {
  const { getToken } = useAuth();
  const [channels, setChannels] = useState<AdminNotificationChannelState[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"ok" | "err">("ok");

  const [editingWebhook, setEditingWebhook] = useState(false);
  const [webhookDraft, setWebhookDraft] = useState<WebhookDraft | null>(null);
  const [savingWebhook, setSavingWebhook] = useState(false);

  const webhookChannel = channels.find(
    (c) => c.channelType === AdminNotificationChannelType.webhook
  );

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      const token = await getToken();
      if (!token) {
        setListError("Missing session.");
        setLoading(false);
        return;
      }
      if (opts?.quiet) setRefreshing(true);
      else setLoading(true);
      setListError(null);
      try {
        setChannels(await getAdminNotificationChannels(token));
      } catch (e) {
        setListError(
          e instanceof Error ? e.message : "Could not load notification channels."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [getToken]
  );

  useEffect(() => {
    void load();
  }, [load]);

  function openWebhookEdit(): void {
    if (!webhookChannel) return;
    setWebhookDraft(emptyWebhookDraft(webhookChannel));
    setEditingWebhook(true);
    setFeedback(null);
  }

  function cancelWebhookEdit(): void {
    setEditingWebhook(false);
    setWebhookDraft(null);
    setFeedback(null);
  }

  async function saveWebhook(): Promise<void> {
    if (!webhookDraft) return;
    const token = await getToken();
    if (!token) {
      setFeedbackTone("err");
      setFeedback("Missing session.");
      return;
    }
    const input: PatchAdminNotificationWebhookChannelRequest = {
      enabled: webhookDraft.enabled,
      endpointUrl: webhookDraft.endpointUrl.trim() === "" ? null : webhookDraft.endpointUrl.trim(),
    };
    if (webhookDraft.signingSecret.trim() !== "") {
      input.signingSecret = webhookDraft.signingSecret.trim();
    }
    setSavingWebhook(true);
    setFeedback(null);
    try {
      const updated = await patchAdminNotificationWebhookChannel(token, input);
      setChannels((prev) =>
        prev.map((c) =>
          c.channelType === AdminNotificationChannelType.webhook ? updated : c
        )
      );
      setFeedbackTone("ok");
      setFeedback("Webhook channel saved.");
      setEditingWebhook(false);
      setWebhookDraft(null);
      await load({ quiet: true });
    } catch (e) {
      setFeedbackTone("err");
      setFeedback(e instanceof Error ? e.message : "Could not save webhook.");
    } finally {
      setSavingWebhook(false);
    }
  }

  if (loading && channels.length === 0) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-border bg-surface">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 shrink-0 text-accent" />
          <h1 className="text-lg font-bold text-text">Notification Channels</h1>
          {refreshing && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />
          )}
        </div>
      </div>

      {listError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {listError}
        </div>
      )}

      {feedback && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            feedbackTone === "ok"
              ? "border-success/40 bg-success/10 text-success"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          )}
        >
          {feedback}
        </div>
      )}

      {channels.length === 0 ? (
        <p className="text-sm text-text-muted">No notification channels configured.</p>
      ) : (
        <div className="space-y-2.5">
          {channels.map((ch) => {
            const isWebhook = ch.channelType === AdminNotificationChannelType.webhook;
            const showForm = isWebhook && editingWebhook && webhookDraft !== null;

            return (
              <div
                key={ch.channelType}
                className="rounded-lg border border-border bg-surface-raised p-3 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold capitalize text-text">
                        {ch.channelType}
                      </span>
                      <ChannelStatusBadge status={ch.status} />
                    </div>
                    {ch.endpointUrl ? (
                      <p className="break-all font-mono text-[11px] text-text-muted">
                        {ch.endpointUrl}
                      </p>
                    ) : (
                      <p className="text-[11px] text-text-subtle">No endpoint URL</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
                      <span className="inline-flex items-center gap-1">
                        <KeyRound className="h-3 w-3" />
                        Signing secret:{" "}
                        {ch.hasSigningSecret ? (
                          <span className="text-success">configured</span>
                        ) : (
                          <span className="text-text-subtle">none</span>
                        )}
                      </span>
                      <span className="text-text-subtle">
                        Updated {new Date(ch.updatedAt).toLocaleString()}
                      </span>
                    </div>
                    {ch.lastDelivery ? (
                      <p className="text-[10px] text-text-subtle">
                        Last delivery: {ch.lastDelivery.deliveryStatus} at{" "}
                        {new Date(ch.lastDelivery.attemptedAt).toLocaleString()}
                        {ch.lastDelivery.errorMessage && (
                          <span className="text-destructive">
                            {" "}
                            — {ch.lastDelivery.errorMessage}
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="text-[10px] text-text-subtle">No deliveries yet</p>
                    )}
                  </div>

                  {isWebhook && !showForm && (
                    <button
                      type="button"
                      onClick={openWebhookEdit}
                      className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-text-muted hover:border-accent/40 hover:text-accent"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                  )}
                </div>

                {showForm && webhookDraft && (
                  <div className="mt-3 space-y-3 border-t border-border pt-3">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-text">
                      <input
                        type="checkbox"
                        checked={webhookDraft.enabled}
                        onChange={(ev) =>
                          setWebhookDraft((d) =>
                            d ? { ...d, enabled: ev.target.checked } : d
                          )
                        }
                        className="rounded border-border accent-accent"
                      />
                      Enabled
                    </label>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        Endpoint URL
                      </label>
                      <input
                        type="url"
                        value={webhookDraft.endpointUrl}
                        onChange={(ev) =>
                          setWebhookDraft((d) =>
                            d ? { ...d, endpointUrl: ev.target.value } : d
                          )
                        }
                        placeholder="https://…"
                        className="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-text"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        Signing secret
                      </label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={webhookDraft.signingSecret}
                        onChange={(ev) =>
                          setWebhookDraft((d) =>
                            d ? { ...d, signingSecret: ev.target.value } : d
                          )
                        }
                        placeholder={
                          ch.hasSigningSecret
                            ? "Leave blank to keep existing"
                            : "Optional"
                        }
                        className="w-full rounded border border-border bg-bg px-2 py-1.5 font-mono text-xs text-text"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={savingWebhook}
                        onClick={() => void saveWebhook()}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90 disabled:opacity-50"
                      >
                        {savingWebhook ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={savingWebhook}
                        onClick={cancelWebhookEdit}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
