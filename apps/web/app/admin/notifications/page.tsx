"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Bell,
  ChevronDown,
  ChevronUp,
  Link,
  Loader2,
  Mail,
  MessageSquare,
  Send,
  Smartphone
} from "lucide-react";
import type {
  NotificationChannelView,
  NotificationPolicyView,
  NotificationQuietHoursView
} from "@persai/contracts";
import {
  getAdminNotificationChannels,
  listNotificationDeadLetters,
  listNotificationDeliveries,
  listNotificationPolicies,
  getNotificationQuietHours
} from "@/app/app/assistant-api-client";
import { ChannelRegistrySection } from "./_components/ChannelRegistrySection";
import { PoliciesSection } from "./_components/PoliciesSection";
import { QuietHoursSection } from "./_components/QuietHoursSection";
import { DeliveryHistorySection } from "./_components/DeliveryHistorySection";
import { DeadLettersSection } from "./_components/DeadLettersSection";

// ── helpers ────────────────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  telegram_thread: <Send className="h-3.5 w-3.5" />,
  web_thread: <MessageSquare className="h-3.5 w-3.5" />,
  web_notification_center: <Bell className="h-3.5 w-3.5" />,
  admin_webhook: <Link className="h-3.5 w-3.5" />,
  web_push: <Smartphone className="h-3.5 w-3.5" />,
  mobile_push: <Smartphone className="h-3.5 w-3.5" />
};

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  telegram_thread: "Telegram",
  web_thread: "Web thread",
  web_notification_center: "Notifications / Уведомления",
  admin_webhook: "Admin webhook",
  web_push: "Web push",
  mobile_push: "Mobile push"
};

const HEALTH_DOT: Record<string, string> = {
  healthy: "bg-success",
  degraded: "bg-warning",
  down: "bg-destructive",
  unconfigured: "bg-text-subtle"
};

const HEALTH_TEXT: Record<string, string> = {
  healthy: "text-success",
  degraded: "text-warning",
  down: "text-destructive",
  unconfigured: "text-text-subtle"
};

function CollapsibleSection({
  title,
  badge,
  badgeVariant = "muted",
  defaultOpen = false,
  children,
  sectionRef
}: {
  title: string;
  badge?: string;
  badgeVariant?: "muted" | "destructive";
  defaultOpen?: boolean;
  children: React.ReactNode;
  sectionRef?: React.RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section ref={sectionRef as React.RefObject<HTMLElement>} className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-raised"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text">{title}</span>
          {badge !== undefined && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                badgeVariant === "destructive"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-surface-raised text-text-muted"
              }`}
            >
              {badge}
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        )}
      </button>
      {open && <div>{children}</div>}
    </section>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

export default function AdminNotificationsPage() {
  const { getToken } = useAuth();
  const [channels, setChannels] = useState<NotificationChannelView[]>([]);
  const [policies, setPolicies] = useState<NotificationPolicyView[]>([]);
  const [quietHours, setQuietHours] = useState<NotificationQuietHoursView | null>(null);
  const [deadLetterCount, setDeadLetterCount] = useState<number | null>(null);
  const [deliveryCount24h, setDeliveryCount24h] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const deliveryRef = useRef<HTMLElement | null>(null);
  const deadLettersRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setLoadError("Missing session.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [ch, pol, qh, dlResult, histResult] = await Promise.all([
        getAdminNotificationChannels(token),
        listNotificationPolicies(token),
        getNotificationQuietHours(token),
        listNotificationDeadLetters(token, { page: 1, pageSize: 1 }),
        listNotificationDeliveries(token, { page: 1, pageSize: 1, dateFrom: yesterday })
      ]);
      setChannels(ch);
      setPolicies(pol);
      setQuietHours(qh);
      setDeadLetterCount(dlResult.total ?? 0);
      setDeliveryCount24h(histResult.total ?? 0);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load notification settings.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-border bg-surface">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
        {loadError}
      </div>
    );
  }

  const enabledPolicies = policies.filter((p) => p.enabled).length;

  return (
    <div className="space-y-6">
      {/* ── Compact channel health strip ───────────────────────── */}
      <div className="rounded-xl border border-border bg-surface-raised px-4 py-3 space-y-3">
        <div className="flex flex-wrap gap-3">
          {channels.map((ch) => (
            <div key={ch.channelType} className="flex items-center gap-1.5">
              <span className="text-text-muted">
                {CHANNEL_ICONS[ch.channelType] ?? <Bell className="h-3.5 w-3.5" />}
              </span>
              <span className="text-[11px] font-medium text-text">
                {CHANNEL_LABELS[ch.channelType] ?? ch.channelType}
              </span>
              <span
                className={`inline-block h-2 w-2 rounded-full ${HEALTH_DOT[ch.healthStatus] ?? "bg-text-subtle"}`}
                title={ch.healthStatus}
              />
              <span className={`text-[10px] ${HEALTH_TEXT[ch.healthStatus] ?? "text-text-subtle"}`}>
                {ch.healthStatus}
              </span>
              {ch.lastDeliveryAt && (
                <span className="text-[10px] text-text-muted">
                  · {new Date(ch.lastDeliveryAt).toLocaleString()}
                </span>
              )}
            </div>
          ))}
          {channels.length === 0 && (
            <span className="text-[11px] text-text-muted">No channels configured yet.</span>
          )}
        </div>

        {/* One-line summary */}
        <p className="text-[11px] text-text-muted">
          <span className="text-text">{enabledPolicies}</span> policies enabled
          {" · "}
          quiet hours <span className="text-text">{quietHours?.enabled ? "on" : "off"}</span>
          {deliveryCount24h !== null && (
            <>
              {" · "}
              <button
                type="button"
                onClick={() =>
                  deliveryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="cursor-pointer underline decoration-dotted hover:text-text"
              >
                {deliveryCount24h} intents (24h)
              </button>
            </>
          )}
          {deadLetterCount !== null && (
            <>
              {" · "}
              <button
                type="button"
                onClick={() =>
                  deadLettersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className={`cursor-pointer underline decoration-dotted hover:text-text ${
                  deadLetterCount > 0 ? "text-destructive" : ""
                }`}
              >
                {deadLetterCount} dead letters
              </button>
            </>
          )}
        </p>
      </div>

      {/* ── Channels ───────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">Channels</h2>
        <ChannelRegistrySection
          channels={channels}
          getToken={getToken}
          onRefresh={() => void load()}
        />
      </section>

      {/* ── Policies ───────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">Policies</h2>
        <PoliciesSection policies={policies} getToken={getToken} onRefresh={() => void load()} />
      </section>

      {/* ── Quiet hours ────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">Quiet hours</h2>
        <QuietHoursSection
          quietHours={quietHours}
          getToken={getToken}
          onRefresh={() => void load()}
        />
      </section>

      {/* ── Delivery history (collapsed by default) ────────────── */}
      <CollapsibleSection
        title="Delivery history"
        badge={
          deliveryCount24h !== null ? `${String(deliveryCount24h)} in last 24h` : "Show last 24h"
        }
        sectionRef={deliveryRef}
      >
        <DeliveryHistorySection getToken={getToken} />
      </CollapsibleSection>

      {/* ── Dead letters (collapsed by default) ────────────────── */}
      <CollapsibleSection
        title="Dead letters"
        badge={deadLetterCount !== null ? `${String(deadLetterCount)} unresolved` : "Show"}
        badgeVariant={deadLetterCount !== null && deadLetterCount > 0 ? "destructive" : "muted"}
        sectionRef={deadLettersRef}
      >
        <DeadLettersSection getToken={getToken} />
      </CollapsibleSection>
    </div>
  );
}
