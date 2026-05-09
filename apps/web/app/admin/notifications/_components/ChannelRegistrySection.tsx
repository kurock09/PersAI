"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Send, XCircle } from "lucide-react";
import type { NotificationChannelView, PatchNotificationChannelRequest } from "@persai/contracts";
import {
  patchUnifiedNotificationChannel,
  testSendNotificationChannel,
  type TestSendNotificationChannelResult
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

type Props = {
  channels: NotificationChannelView[];
  onRefresh: () => void;
  getToken: () => Promise<string | null>;
};

const CHANNEL_LABELS: Record<string, string> = {
  telegram_thread: "Telegram thread",
  web_thread: "Web thread",
  web_notification_center: "Web notification center",
  email: "Email (Postmark)",
  admin_webhook: "Admin webhook",
  web_push: "Web push",
  mobile_push: "Mobile push"
};

const PUSH_PLACEHOLDER: Record<string, string> = {
  web_push: "VAPID endpoint URL (future ADR)",
  mobile_push: "FCM server key (future ADR)"
};

function HealthBadge({ status, failures }: { status: string; failures: number }) {
  const healthy = status === "healthy";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        healthy
          ? "bg-success/15 text-success"
          : status === "degraded"
            ? "bg-warning/15 text-warning"
            : "bg-destructive/15 text-destructive"
      )}
    >
      {healthy ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {status}
      {failures > 0 && ` (${failures} failures)`}
    </span>
  );
}

function TestSendBadge({ result }: { result: TestSendNotificationChannelResult }) {
  if (result.ok) {
    return (
      <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
        ✓ Delivered
      </span>
    );
  }
  const reason =
    typeof result.error?.["reason"] === "string" ? result.error["reason"] : result.status;
  return (
    <span
      className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive"
      title={reason}
    >
      ✗ {reason}
    </span>
  );
}

function ChannelRow({
  channel,
  getToken,
  onUpdated
}: {
  channel: NotificationChannelView;
  getToken: () => Promise<string | null>;
  onUpdated: (updated: NotificationChannelView) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestSendNotificationChannelResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushUrl, setPushUrl] = useState<string>(
    typeof channel.config["endpointUrl"] === "string" ? channel.config["endpointUrl"] : ""
  );
  const [savingConfig, setSavingConfig] = useState(false);

  const isPushSlot = channel.channelType === "web_push" || channel.channelType === "mobile_push";

  async function toggleEnabled(): Promise<void> {
    const token = await getToken();
    if (!token) return;
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const input: PatchNotificationChannelRequest = { enabled: !channel.enabled };
      const updated = await patchUnifiedNotificationChannel(token, channel.channelType, input);
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update channel.");
    } finally {
      setSaving(false);
    }
  }

  async function savePushConfig(): Promise<void> {
    const token = await getToken();
    if (!token) return;
    setSavingConfig(true);
    setError(null);
    try {
      const input: PatchNotificationChannelRequest = {
        config: { ...channel.config, endpointUrl: pushUrl }
      };
      const updated = await patchUnifiedNotificationChannel(token, channel.channelType, input);
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save config.");
    } finally {
      setSavingConfig(false);
    }
  }

  async function runTestSend(): Promise<void> {
    const token = await getToken();
    if (!token) return;
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await testSendNotificationChannel(token, channel.channelType);
      setTestResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test send failed.");
    } finally {
      setTesting(false);
    }
  }

  const label = CHANNEL_LABELS[channel.channelType] ?? channel.channelType;

  return (
    <div className="rounded-lg border border-border bg-surface-raised px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-text">{label}</span>
            <HealthBadge status={channel.healthStatus} failures={channel.consecutiveFailures} />
            {!channel.enabled && (
              <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-muted">
                disabled
              </span>
            )}
            {testResult && <TestSendBadge result={testResult} />}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-text-muted">
            {channel.lastDeliveryAt && (
              <span>Last delivery: {new Date(channel.lastDeliveryAt).toLocaleString()}</span>
            )}
            {channel.lastFailureAt && (
              <span className="text-destructive">
                Last failure: {new Date(channel.lastFailureAt).toLocaleString()}
              </span>
            )}
            <span>Updated: {new Date(channel.updatedAt).toLocaleString()}</span>
          </div>
          {isPushSlot && (
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                value={pushUrl}
                onChange={(e) => setPushUrl(e.target.value)}
                placeholder={PUSH_PLACEHOLDER[channel.channelType] ?? "Endpoint URL"}
                className="w-64 rounded border border-border bg-bg px-2 py-1 text-[11px] text-text focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => void savePushConfig()}
                disabled={savingConfig}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium border border-border text-text-muted hover:text-text disabled:opacity-60"
              >
                {savingConfig ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
              </button>
              <span className="text-[10px] text-text-muted italic">Real adapter in future ADR</span>
            </div>
          )}
          {error && <p className="text-[10px] text-destructive">{error}</p>}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void runTestSend()}
            disabled={testing || saving}
            title={`Test send on ${label}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-muted transition hover:border-accent/50 hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Test
          </button>
          <button
            type="button"
            onClick={() => void toggleEnabled()}
            disabled={saving}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
              channel.enabled
                ? "border border-border bg-bg text-text-muted hover:border-destructive/40 hover:text-destructive"
                : "bg-accent text-accent-foreground hover:opacity-90"
            )}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : channel.enabled ? (
              "Disable"
            ) : (
              "Enable"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChannelRegistrySection({ channels, getToken, onRefresh }: Props) {
  const [localChannels, setLocalChannels] = useState(channels);

  function handleUpdated(updated: NotificationChannelView): void {
    setLocalChannels((prev) =>
      prev.map((c) => (c.channelType === updated.channelType ? updated : c))
    );
    onRefresh();
  }

  if (localChannels.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-xs text-text-muted">
        No channels configured yet. Run seed to populate channel registry.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {localChannels.map((ch) => (
        <ChannelRow
          key={ch.channelType}
          channel={ch}
          getToken={getToken}
          onUpdated={handleUpdated}
        />
      ))}
    </div>
  );
}
