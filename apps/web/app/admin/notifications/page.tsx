"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Bell,
  Check,
  Gauge,
  KeyRound,
  Loader2,
  MessageSquareMore,
  MoonStar,
  Pencil,
  Save,
  TriangleAlert,
  X
} from "lucide-react";
import type {
  AdminNotificationChannelState,
  IdleReengagementNotificationPolicyState,
  PatchAdminIdleReengagementNotificationPolicyRequest,
  PatchAdminNotificationWebhookChannelRequest
} from "@persai/contracts";
import { AdminNotificationChannelStatus, AdminNotificationChannelType } from "@persai/contracts";
import {
  getAdminIdleReengagementNotificationPolicy,
  getAdminNotificationChannels,
  getAdminQuotaAdvisoryNotificationPolicy,
  patchAdminIdleReengagementNotificationPolicy,
  patchAdminNotificationWebhookChannel,
  patchAdminQuotaAdvisoryNotificationPolicy,
  type PatchAdminQuotaAdvisoryNotificationPolicyRequest,
  type QuotaAdvisoryNotificationPolicyState
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

type WebhookDraft = {
  enabled: boolean;
  endpointUrl: string;
  signingSecret: string;
};

type IdlePolicyDraft = {
  enabled: boolean;
  idleHours: string;
  cooldownHours: string;
  llmInstruction: string;
};

type QuotaAdvisoryPolicyDraft = {
  enabled: boolean;
  llmInstruction: string;
};

function emptyWebhookDraft(ch: AdminNotificationChannelState): WebhookDraft {
  return {
    enabled: ch.status === AdminNotificationChannelStatus.active,
    endpointUrl: ch.endpointUrl ?? "",
    signingSecret: ""
  };
}

function idlePolicyToDraft(policy: IdleReengagementNotificationPolicyState): IdlePolicyDraft {
  return {
    enabled: policy.enabled,
    idleHours: String(policy.idleHours),
    cooldownHours: String(policy.cooldownHours),
    llmInstruction: policy.llmInstruction
  };
}

function quotaAdvisoryPolicyToDraft(
  policy: QuotaAdvisoryNotificationPolicyState
): QuotaAdvisoryPolicyDraft {
  return {
    enabled: policy.enabled,
    llmInstruction: policy.llmInstruction
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

function CompactSettingCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 text-text-muted">{props.icon}</div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            {props.label}
          </p>
          <p className="text-xs font-medium text-text">{props.value}</p>
          <p className="mt-0.5 text-[10px] text-text-subtle">{props.detail}</p>
        </div>
      </div>
    </div>
  );
}

export default function AdminNotificationsPage() {
  const { getToken } = useAuth();
  const [channels, setChannels] = useState<AdminNotificationChannelState[]>([]);
  const [idlePolicy, setIdlePolicy] = useState<IdleReengagementNotificationPolicyState | null>(
    null
  );
  const [quotaAdvisoryPolicy, setQuotaAdvisoryPolicy] =
    useState<QuotaAdvisoryNotificationPolicyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"ok" | "err">("ok");

  const [editingWebhook, setEditingWebhook] = useState(false);
  const [webhookDraft, setWebhookDraft] = useState<WebhookDraft | null>(null);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [idleDraft, setIdleDraft] = useState<IdlePolicyDraft | null>(null);
  const [savingIdlePolicy, setSavingIdlePolicy] = useState(false);
  const [quotaAdvisoryDraft, setQuotaAdvisoryDraft] = useState<QuotaAdvisoryPolicyDraft | null>(
    null
  );
  const [savingQuotaAdvisoryPolicy, setSavingQuotaAdvisoryPolicy] = useState(false);

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
        const [nextChannels, nextIdlePolicy, nextQuotaAdvisoryPolicy] = await Promise.all([
          getAdminNotificationChannels(token),
          getAdminIdleReengagementNotificationPolicy(token),
          getAdminQuotaAdvisoryNotificationPolicy(token)
        ]);
        setChannels(nextChannels);
        setIdlePolicy(nextIdlePolicy);
        setIdleDraft(idlePolicyToDraft(nextIdlePolicy));
        setQuotaAdvisoryPolicy(nextQuotaAdvisoryPolicy);
        setQuotaAdvisoryDraft(quotaAdvisoryPolicyToDraft(nextQuotaAdvisoryPolicy));
      } catch (e) {
        setListError(e instanceof Error ? e.message : "Could not load notification settings.");
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
      endpointUrl: webhookDraft.endpointUrl.trim() === "" ? null : webhookDraft.endpointUrl.trim()
    };
    if (webhookDraft.signingSecret.trim() !== "") {
      input.signingSecret = webhookDraft.signingSecret.trim();
    }
    setSavingWebhook(true);
    setFeedback(null);
    try {
      const updated = await patchAdminNotificationWebhookChannel(token, input);
      setChannels((prev) =>
        prev.map((c) => (c.channelType === AdminNotificationChannelType.webhook ? updated : c))
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

  async function saveIdlePolicy(): Promise<void> {
    if (!idleDraft) return;
    const token = await getToken();
    if (!token) {
      setFeedbackTone("err");
      setFeedback("Missing session.");
      return;
    }
    const idleHours = Number(idleDraft.idleHours);
    const cooldownHours = Number(idleDraft.cooldownHours);
    if (!Number.isInteger(idleHours) || idleHours < 1 || idleHours > 720) {
      setFeedbackTone("err");
      setFeedback("Idle threshold must be an integer between 1 and 720 hours.");
      return;
    }
    if (!Number.isInteger(cooldownHours) || cooldownHours < 1 || cooldownHours > 720) {
      setFeedbackTone("err");
      setFeedback("Cooldown must be an integer between 1 and 720 hours.");
      return;
    }
    if (idleDraft.llmInstruction.trim() === "") {
      setFeedbackTone("err");
      setFeedback("LLM instruction is required.");
      return;
    }
    const input: PatchAdminIdleReengagementNotificationPolicyRequest = {
      enabled: idleDraft.enabled,
      idleHours,
      cooldownHours,
      llmInstruction: idleDraft.llmInstruction.trim()
    };
    setSavingIdlePolicy(true);
    setFeedback(null);
    try {
      const updated = await patchAdminIdleReengagementNotificationPolicy(token, input);
      setIdlePolicy(updated);
      setIdleDraft(idlePolicyToDraft(updated));
      setFeedbackTone("ok");
      setFeedback("Idle reengagement policy saved.");
    } catch (e) {
      setFeedbackTone("err");
      setFeedback(e instanceof Error ? e.message : "Could not save idle reengagement policy.");
    } finally {
      setSavingIdlePolicy(false);
    }
  }

  async function saveQuotaAdvisoryPolicy(): Promise<void> {
    if (!quotaAdvisoryDraft) return;
    const token = await getToken();
    if (!token) {
      setFeedbackTone("err");
      setFeedback("Missing session.");
      return;
    }
    if (quotaAdvisoryDraft.llmInstruction.trim() === "") {
      setFeedbackTone("err");
      setFeedback("Quota advisory LLM instruction is required.");
      return;
    }
    const input: PatchAdminQuotaAdvisoryNotificationPolicyRequest = {
      enabled: quotaAdvisoryDraft.enabled,
      llmInstruction: quotaAdvisoryDraft.llmInstruction.trim()
    };
    setSavingQuotaAdvisoryPolicy(true);
    setFeedback(null);
    try {
      const updated = await patchAdminQuotaAdvisoryNotificationPolicy(token, input);
      setQuotaAdvisoryPolicy(updated);
      setQuotaAdvisoryDraft(quotaAdvisoryPolicyToDraft(updated));
      setFeedbackTone("ok");
      setFeedback("Quota advisory policy saved.");
    } catch (e) {
      setFeedbackTone("err");
      setFeedback(e instanceof Error ? e.message : "Could not save quota advisory policy.");
    } finally {
      setSavingQuotaAdvisoryPolicy(false);
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
          <h1 className="text-lg font-bold text-text">Notification Settings</h1>
          {refreshing && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface px-4 py-3 text-xs text-text-muted">
        <div className="mb-1">
          <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
            Outbox enabled
          </span>
        </div>
        User-facing assistant notifications now enqueue through the durable outbox before delivery.
        User notification policy, system webhooks, and future push transports are managed here.
      </div>

      <div className="rounded-lg border border-border bg-surface-raised p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text">Quota advisories and light mode</h2>
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                ADR-087
              </span>
              <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-muted">
                Slice 1
              </span>
            </div>
            <p className="max-w-2xl text-xs text-text-muted">
              Product policy and model instruction for near-limit warnings and paid token light mode
              follow-ups in active user threads.
            </p>
          </div>
          {quotaAdvisoryPolicy && (
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-muted">
              Updated {new Date(quotaAdvisoryPolicy.updatedAt).toLocaleString()}
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <CompactSettingCard
            icon={<TriangleAlert className="h-3.5 w-3.5" />}
            label="Trigger"
            value="90% of finite limits"
            detail="Warn only for finite token, monthly media, daily tool, and storage limits."
          />
          <CompactSettingCard
            icon={<MessageSquareMore className="h-3.5 w-3.5" />}
            label="Delivery"
            value="Second assistant message"
            detail="Arrives in the active user surface/thread after the main reply."
          />
          <CompactSettingCard
            icon={<MoonStar className="h-3.5 w-3.5" />}
            label="Paid token cap"
            value="Light mode until reset"
            detail="Paid token exhaustion degrades text chat instead of hard-stopping it."
          />
          <CompactSettingCard
            icon={<Gauge className="h-3.5 w-3.5" />}
            label="Free plans"
            value="Warnings only"
            detail="Free/zero-price plans may be warned, but do not enter paid light mode."
          />
          <CompactSettingCard
            icon={<Bell className="h-3.5 w-3.5" />}
            label="Upgrade hint"
            value="Only if a higher paid plan exists"
            detail="Upsell copy should not appear on the highest-priced visible paid plan."
          />
        </div>

        {quotaAdvisoryDraft && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2">
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-text">Enabled</p>
                <p className="text-[10px] text-text-subtle">
                  Turns active-thread quota follow-ups on or off without touching the quota truth.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-text">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={quotaAdvisoryDraft.enabled}
                  onChange={(event) =>
                    setQuotaAdvisoryDraft((prev) =>
                      prev ? { ...prev, enabled: event.target.checked } : prev
                    )
                  }
                />
                {quotaAdvisoryDraft.enabled ? "enabled" : "inactive"}
              </label>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-text" htmlFor="quota-advisory-llm">
                LLM instruction
              </label>
              <p className="text-[10px] text-text-subtle">
                Product guardrails stay in code; use this field for tone, emphasis, and how the
                assistant should phrase grounded quota follow-ups.
              </p>
              <textarea
                id="quota-advisory-llm"
                className="min-h-[140px] w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-text outline-none transition focus:border-accent"
                value={quotaAdvisoryDraft.llmInstruction}
                onChange={(event) =>
                  setQuotaAdvisoryDraft((prev) =>
                    prev ? { ...prev, llmInstruction: event.target.value } : prev
                  )
                }
                placeholder="Explain how the assistant should write grounded quota follow-ups."
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  quotaAdvisoryPolicy &&
                  setQuotaAdvisoryDraft(quotaAdvisoryPolicyToDraft(quotaAdvisoryPolicy))
                }
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted transition hover:bg-bg"
              >
                <X className="h-3.5 w-3.5" />
                Reset
              </button>
              <button
                type="button"
                onClick={() => void saveQuotaAdvisoryPolicy()}
                disabled={savingQuotaAdvisoryPolicy}
                className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingQuotaAdvisoryPolicy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save quota policy
              </button>
            </div>
          </div>
        )}
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

      <div className="space-y-1">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          User notification policy
        </h2>
      </div>

      <div className="rounded-lg border border-border bg-surface-raised p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text">Idle reengagement</h3>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  idleDraft?.enabled
                    ? "bg-success/15 text-success"
                    : "bg-surface-hover text-text-muted"
                )}
              >
                {idleDraft?.enabled ? "enabled" : "inactive"}
              </span>
            </div>
            <p className="text-xs text-text-muted">
              Quiet follow-up for long-idle users through their preferred channel.
            </p>
          </div>
          {idlePolicy && (
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-muted">
              Updated {new Date(idlePolicy.updatedAt).toLocaleString()}
            </span>
          )}
        </div>

        {idleDraft && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2">
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-text">Enabled</p>
                <p className="text-[10px] text-text-subtle">
                  When off, the scheduler skips idle nudges entirely.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-text">
                <input
                  type="checkbox"
                  checked={idleDraft.enabled}
                  onChange={(ev) =>
                    setIdleDraft((d) => (d ? { ...d, enabled: ev.target.checked } : d))
                  }
                  className="rounded border-border accent-accent"
                />
                Enabled
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Idle threshold, hours
                </label>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={idleDraft.idleHours}
                  onChange={(ev) =>
                    setIdleDraft((d) => (d ? { ...d, idleHours: ev.target.value } : d))
                  }
                  className="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-text"
                />
                <p className="text-[10px] text-text-subtle">Example: `24` means one day idle.</p>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Cooldown, hours
                </label>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={idleDraft.cooldownHours}
                  onChange={(ev) =>
                    setIdleDraft((d) => (d ? { ...d, cooldownHours: ev.target.value } : d))
                  }
                  className="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-text"
                />
                <p className="text-[10px] text-text-subtle">
                  Example: `72` means at most one nudge in three days.
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                LLM instruction
              </label>
              <textarea
                value={idleDraft.llmInstruction}
                onChange={(ev) =>
                  setIdleDraft((d) => (d ? { ...d, llmInstruction: ev.target.value } : d))
                }
                rows={4}
                className="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-text"
              />
              <p className="text-[10px] text-text-subtle">
                The evaluator must return `push` or `no_push` and write one short warm user-facing
                message when pushing.
              </p>
            </div>

            <button
              type="button"
              disabled={savingIdlePolicy}
              onClick={() => void saveIdlePolicy()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90 disabled:opacity-50"
            >
              {savingIdlePolicy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save policy
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          System channels
        </h2>
        <p className="text-xs text-text-muted">
          Existing admin webhook/system event delivery stays here.
        </p>
      </div>

      <div className="space-y-2.5">
        {channels.map((ch) => {
          const isWebhook = ch.channelType === AdminNotificationChannelType.webhook;
          const showForm = isWebhook && editingWebhook && webhookDraft !== null;

          return (
            <div
              key={ch.channelType}
              className="rounded-lg border border-border bg-surface-raised p-4 shadow-sm"
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
                    <p className="text-[11px] text-text-subtle">
                      Not configured yet. Add an endpoint URL to enable webhook delivery.
                    </p>
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
                    {ch.updatedAt !== new Date(0).toISOString() && (
                      <span className="text-text-subtle">
                        Updated {new Date(ch.updatedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {ch.lastDelivery ? (
                    <p className="text-[10px] text-text-subtle">
                      Last delivery: {ch.lastDelivery.deliveryStatus} at{" "}
                      {new Date(ch.lastDelivery.attemptedAt).toLocaleString()}
                      {ch.lastDelivery.errorMessage && (
                        <span className="text-destructive"> — {ch.lastDelivery.errorMessage}</span>
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
                        setWebhookDraft((d) => (d ? { ...d, enabled: ev.target.checked } : d))
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
                        setWebhookDraft((d) => (d ? { ...d, endpointUrl: ev.target.value } : d))
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
                        setWebhookDraft((d) => (d ? { ...d, signingSecret: ev.target.value } : d))
                      }
                      placeholder={
                        ch.hasSigningSecret ? "Leave blank to keep existing" : "Optional"
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
    </div>
  );
}
