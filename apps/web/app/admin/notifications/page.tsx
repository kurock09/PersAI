"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import type {
  NotificationChannelView,
  NotificationPolicyView,
  NotificationQuietHoursView
} from "@persai/contracts";
import {
  getAdminNotificationChannels,
  listNotificationPolicies,
  getNotificationQuietHours
} from "@/app/app/assistant-api-client";
import { ChannelRegistrySection } from "./_components/ChannelRegistrySection";
import { PoliciesSection } from "./_components/PoliciesSection";
import { QuietHoursSection } from "./_components/QuietHoursSection";
import { DeliveryHistorySection } from "./_components/DeliveryHistorySection";
import { DeadLettersSection } from "./_components/DeadLettersSection";
import { PreviewSection } from "./_components/PreviewSection";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

export default function AdminNotificationsPage() {
  const { getToken } = useAuth();
  const [channels, setChannels] = useState<NotificationChannelView[]>([]);
  const [policies, setPolicies] = useState<NotificationPolicyView[]>([]);
  const [quietHours, setQuietHours] = useState<NotificationQuietHoursView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
      const [ch, pol, qh] = await Promise.all([
        getAdminNotificationChannels(token),
        listNotificationPolicies(token),
        getNotificationQuietHours(token)
      ]);
      setChannels(ch);
      setPolicies(pol);
      setQuietHours(qh);
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

  return (
    <div className="space-y-8">
      <Section title="Channels">
        <ChannelRegistrySection
          channels={channels}
          getToken={getToken}
          onRefresh={() => void load()}
        />
      </Section>
      <Section title="Policies">
        <PoliciesSection policies={policies} getToken={getToken} onRefresh={() => void load()} />
      </Section>
      <Section title="Quiet hours">
        <QuietHoursSection
          quietHours={quietHours}
          getToken={getToken}
          onRefresh={() => void load()}
        />
      </Section>
      <Section title="Delivery history">
        <DeliveryHistorySection getToken={getToken} />
      </Section>
      <Section title="Dead letters">
        <DeadLettersSection getToken={getToken} />
      </Section>
      <Section title="Preview / dry-run">
        <PreviewSection getToken={getToken} />
      </Section>
    </div>
  );
}
