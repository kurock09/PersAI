"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ShieldAlert, Loader2, CheckCircle2, AlertCircle, RefreshCcw, Clock3 } from "lucide-react";
import { cn } from "@/app/lib/utils";
import {
  listAdminAbuseActiveOverrides,
  lookupAdminAbuseAssistantsByEmail,
  postAdminAbuseUnblock,
  type AdminAbuseActiveOverrideItem,
  type AdminAbuseAssistantLookupItem
} from "@/app/app/assistant-api-client";

const SURFACES = [
  { value: "", label: "All surfaces" },
  { value: "web_chat", label: "Web Chat" },
  { value: "telegram", label: "Telegram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "max", label: "MAX" }
] as const;

const LOAD_TEST_SURFACES = [
  { value: "web_chat", label: "Web Chat" },
  { value: "telegram", label: "Telegram" }
] as const;

const LOAD_TEST_DURATIONS = [
  { value: "30", label: "30 minutes" },
  { value: "60", label: "60 minutes" },
  { value: "120", label: "120 minutes" }
] as const;

type Feedback = { type: "ok" | "err" | "info"; text: string } | null;

type LoadTestActivation = {
  assistantId: string;
  assistantLabel: string;
  userEmail: string;
  surface: "web_chat" | "telegram";
  adminOverrideUntil: string;
};

export default function AdminAbusePage() {
  const { getToken } = useAuth();
  const [assistantId, setAssistantId] = useState("");
  const [userId, setUserId] = useState("");
  const [surface, setSurface] = useState("");
  const [overrideMinutes, setOverrideMinutes] = useState("60");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupFeedback, setLookupFeedback] = useState<Feedback>(null);
  const [matchedAssistants, setMatchedAssistants] = useState<AdminAbuseAssistantLookupItem[]>([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState("");
  const [loadTestSurface, setLoadTestSurface] = useState<"web_chat" | "telegram">("web_chat");
  const [loadTestDuration, setLoadTestDuration] = useState("60");
  const [loadTestBusy, setLoadTestBusy] = useState(false);
  const [loadTestActivation, setLoadTestActivation] = useState<LoadTestActivation | null>(null);
  const [activeOverrides, setActiveOverrides] = useState<AdminAbuseActiveOverrideItem[]>([]);
  const [activeOverridesBusy, setActiveOverridesBusy] = useState(false);
  const [activeOverridesFeedback, setActiveOverridesFeedback] = useState<Feedback>(null);
  const [activeOverrideActionKey, setActiveOverrideActionKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const activeOverrideDurationMinutes = useMemo(() => {
    const parsed = parseInt(loadTestDuration, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
  }, [loadTestDuration]);

  const refreshActiveOverrides = useCallback(
    async (options?: { silent?: boolean }) => {
      const token = await getToken();
      if (!token) return;
      if (!options?.silent) {
        setActiveOverridesBusy(true);
      }
      try {
        const overrides = await listAdminAbuseActiveOverrides(token);
        setActiveOverrides(overrides);
        setActiveOverridesFeedback(null);
      } catch (error) {
        setActiveOverridesFeedback({
          type: "err",
          text: error instanceof Error ? error.message : "Failed to load active overrides."
        });
      } finally {
        if (!options?.silent) {
          setActiveOverridesBusy(false);
        }
      }
    },
    [getToken]
  );

  const handleLookup = useCallback(async () => {
    const token = await getToken();
    if (!token || !lookupEmail.trim()) return;
    setLookupBusy(true);
    setLookupFeedback(null);
    setLoadTestActivation(null);
    try {
      const assistants = await lookupAdminAbuseAssistantsByEmail(token, lookupEmail);
      setMatchedAssistants(assistants);
      setSelectedAssistantId((current) => {
        if (assistants.some((assistant) => assistant.assistantId === current)) {
          return current;
        }
        return assistants.length === 1 ? assistants[0]?.assistantId ?? "" : "";
      });
      setLookupFeedback(
        assistants.length === 0
          ? {
              type: "info",
              text: "No assistants were found for this email."
            }
          : {
              type: "ok",
              text:
                assistants.length === 1
                  ? "Found 1 assistant for this email."
                  : `Found ${assistants.length} assistants for this email.`
            }
      );
    } catch (error) {
      setMatchedAssistants([]);
      setSelectedAssistantId("");
      setLookupFeedback({
        type: "err",
        text: error instanceof Error ? error.message : "Assistant lookup failed."
      });
    }
    setLookupBusy(false);
  }, [getToken, lookupEmail]);

  useEffect(() => {
    void refreshActiveOverrides();
    const refreshInterval = window.setInterval(() => {
      void refreshActiveOverrides({ silent: true });
    }, 30_000);
    const clockInterval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(refreshInterval);
      window.clearInterval(clockInterval);
    };
  }, [refreshActiveOverrides]);

  const handleLoadTestEnable = useCallback(async () => {
    const token = await getToken();
    const assistant = matchedAssistants.find((item) => item.assistantId === selectedAssistantId) ?? null;
    if (!token || assistant === null) return;
    setLoadTestBusy(true);
    setLookupFeedback(null);
    try {
      const result = await postAdminAbuseUnblock(token, {
        assistantId: assistant.assistantId,
        userId: null,
        surface: loadTestSurface,
        overrideMinutes: parseInt(loadTestDuration, 10) || 60
      });
      setLoadTestActivation({
        assistantId: assistant.assistantId,
        assistantLabel: formatAssistantLabel(assistant),
        userEmail: assistant.userEmail,
        surface: loadTestSurface,
        adminOverrideUntil: result.adminOverrideUntil
      });
      setLookupFeedback({
        type: "ok",
        text: "Temporary load-test mode has been enabled."
      });
      await refreshActiveOverrides({ silent: true });
    } catch (error) {
      setLookupFeedback({
        type: "err",
        text: error instanceof Error ? error.message : "Failed to enable temporary load-test mode."
      });
    }
    setLoadTestBusy(false);
  }, [
    getToken,
    matchedAssistants,
    refreshActiveOverrides,
    selectedAssistantId,
    loadTestSurface,
    loadTestDuration
  ]);

  const handleUnblock = useCallback(async () => {
    const token = await getToken();
    if (!token || !assistantId.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await postAdminAbuseUnblock(token, {
        assistantId: assistantId.trim(),
        userId: userId.trim() || null,
        surface: (surface as "web_chat" | "telegram" | "whatsapp" | "max") || null,
        overrideMinutes: parseInt(overrideMinutes, 10) || 60
      });
      setFeedback({
        type: "ok",
        text: `Unblocked. Affected ${result.affectedUserRows} user rows, ${result.affectedAssistantRows} assistant rows.`
      });
      await refreshActiveOverrides({ silent: true });
    } catch (error) {
      setFeedback({ type: "err", text: error instanceof Error ? error.message : "Unblock failed." });
    }
    setBusy(false);
  }, [getToken, assistantId, userId, surface, overrideMinutes, refreshActiveOverrides]);

  const handleExtendActiveOverride = useCallback(
    async (override: AdminAbuseActiveOverrideItem) => {
      const token = await getToken();
      if (!token) return;
      const actionKey = `${override.assistantId}:${override.surface}`;
      setActiveOverrideActionKey(actionKey);
      setActiveOverridesFeedback(null);
      try {
        await postAdminAbuseUnblock(token, {
          assistantId: override.assistantId,
          userId: null,
          surface: override.surface,
          overrideMinutes: activeOverrideDurationMinutes
        });
        await refreshActiveOverrides({ silent: true });
        setActiveOverridesFeedback({
          type: "ok",
          text: `Extended ${formatAssistantLabel(override)} for ${activeOverrideDurationMinutes} minutes.`
        });
      } catch (error) {
        setActiveOverridesFeedback({
          type: "err",
          text: error instanceof Error ? error.message : "Failed to extend active override."
        });
      } finally {
        setActiveOverrideActionKey(null);
      }
    },
    [activeOverrideDurationMinutes, getToken, refreshActiveOverrides]
  );

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-destructive" />
        <h1 className="text-lg font-bold text-text">Abuse Controls</h1>
      </div>

      <div className="space-y-6">
        <div className="rounded-lg border border-border bg-surface-raised p-5 max-w-2xl">
          <h2 className="mb-4 text-sm font-semibold text-text">Load Test</h2>
          <p className="mb-4 text-xs text-text-muted">
            Find the assistant by user email, choose the channel, and enable a temporary abuse
            override for load testing.
          </p>

          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Field
                  id="load-test-email"
                  label="User email"
                  value={lookupEmail}
                  onChange={(value) => {
                    setLookupEmail(value);
                    setMatchedAssistants([]);
                    setSelectedAssistantId("");
                    setLookupFeedback(null);
                    setLoadTestActivation(null);
                  }}
                  placeholder="owner@example.com"
                  type="email"
                />
              </div>
              <button
                type="button"
                disabled={lookupBusy || !lookupEmail.trim()}
                onClick={() => void handleLookup()}
                className={cn(
                  "flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors",
                  lookupEmail.trim()
                    ? "bg-surface text-text hover:bg-surface/80"
                    : "bg-surface text-text-subtle",
                  "border border-border disabled:opacity-50"
                )}
              >
                {lookupBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldAlert className="h-3.5 w-3.5" />
                )}
                Find assistants
              </button>
            </div>

            {matchedAssistants.length > 0 && (
              <>
                <div>
                  <label
                    htmlFor="load-test-assistant"
                    className="mb-1 block text-xs font-medium text-text-muted"
                  >
                    Assistant
                  </label>
                  <select
                    id="load-test-assistant"
                    value={selectedAssistantId}
                    onChange={(event) => setSelectedAssistantId(event.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
                  >
                    <option value="">Select assistant</option>
                    {matchedAssistants.map((assistant) => (
                      <option key={assistant.assistantId} value={assistant.assistantId}>
                        {formatAssistantLabel(assistant)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="load-test-surface"
                      className="mb-1 block text-xs font-medium text-text-muted"
                    >
                      Channel
                    </label>
                    <select
                      id="load-test-surface"
                      value={loadTestSurface}
                      onChange={(event) =>
                        setLoadTestSurface(event.target.value as "web_chat" | "telegram")
                      }
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
                    >
                      {LOAD_TEST_SURFACES.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="load-test-duration"
                      className="mb-1 block text-xs font-medium text-text-muted"
                    >
                      Duration
                    </label>
                    <select
                      id="load-test-duration"
                      value={loadTestDuration}
                      onChange={(event) => setLoadTestDuration(event.target.value)}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
                    >
                      {LOAD_TEST_DURATIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            disabled={loadTestBusy || selectedAssistantId.length === 0}
            onClick={() => void handleLoadTestEnable()}
            className={cn(
              "mt-4 flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors",
              selectedAssistantId.length === 0
                ? "cursor-default bg-surface text-text-subtle"
                : "cursor-pointer bg-destructive/15 text-destructive hover:bg-destructive/25",
              "disabled:opacity-50"
            )}
          >
            {loadTestBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" />
            )}
            Enable load-test mode
          </button>

          <FeedbackBanner feedback={lookupFeedback} />

          {loadTestActivation && (
            <div className="mt-3 rounded-lg border border-border bg-surface p-3 text-xs text-text">
              <div className="font-semibold text-text">Active load-test override</div>
              <div className="mt-2 space-y-1 text-text-muted">
                <p>
                  Assistant: <span className="text-text">{loadTestActivation.assistantLabel}</span>
                </p>
                <p>
                  User email: <span className="text-text">{loadTestActivation.userEmail}</span>
                </p>
                <p>
                  Channel:{" "}
                  <span className="text-text">
                    {renderSurfaceLabel(loadTestActivation.surface)}
                  </span>
                </p>
                <p>
                  Active until:{" "}
                  <span className="text-text">
                    {new Date(loadTestActivation.adminOverrideUntil).toLocaleString()}
                  </span>
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface-raised p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-text">Active load-test windows</h2>
              <p className="mt-1 text-xs text-text-muted">
                Read-only view of assistants with an active abuse override. Countdown updates locally;
                the list refreshes automatically every 30 seconds.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshActiveOverrides()}
              disabled={activeOverridesBusy}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text transition-colors hover:bg-surface",
                "disabled:opacity-50"
              )}
            >
              {activeOverridesBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="h-3.5 w-3.5" />
              )}
              Refresh
            </button>
          </div>

          <FeedbackBanner feedback={activeOverridesFeedback} />

          {activeOverrides.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-text-muted">
              No active assistant overrides right now.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-left text-xs">
                <thead>
                  <tr className="text-text-muted">
                    <th className="px-3 py-2 font-medium">Assistant</th>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Channel</th>
                    <th className="px-3 py-2 font-medium">Active until</th>
                    <th className="px-3 py-2 font-medium">Time left</th>
                    <th className="px-3 py-2 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activeOverrides.map((override) => {
                    const actionKey = `${override.assistantId}:${override.surface}`;
                    const isActing = activeOverrideActionKey === actionKey;
                    return (
                      <tr key={actionKey} className="align-top">
                        <td className="px-3 py-3 text-text">
                          <div className="font-medium">{formatAssistantLabel(override)}</div>
                          <div className="mt-1 text-text-muted">{override.workspaceId}</div>
                        </td>
                        <td className="px-3 py-3 text-text">
                          <div>{override.userEmail}</div>
                          {override.userDisplayName && (
                            <div className="mt-1 text-text-muted">{override.userDisplayName}</div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-text">{renderSurfaceLabel(override.surface)}</td>
                        <td className="px-3 py-3 text-text">
                          {new Date(override.adminOverrideUntil).toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-text">
                          <div className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-[11px]">
                            <Clock3 className="h-3 w-3" />
                            {formatRemainingTime(override.adminOverrideUntil, nowMs)}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            disabled={isActing}
                            onClick={() => void handleExtendActiveOverride(override)}
                            className={cn(
                              "inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text transition-colors hover:bg-surface",
                              "disabled:opacity-50"
                            )}
                          >
                            {isActing ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ShieldAlert className="h-3.5 w-3.5" />
                            )}
                            Extend {activeOverrideDurationMinutes}m
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface-raised p-5 max-w-lg">
          <h2 className="mb-4 text-sm font-semibold text-text">Manual Unblock</h2>
          <p className="mb-4 text-xs text-text-muted">
            Temporarily override abuse blocks for a specific assistant. The override expires after the
            specified duration.
          </p>

          <div className="space-y-3">
            <Field
              id="manual-assistant-id"
              label="Assistant ID *"
              value={assistantId}
              onChange={setAssistantId}
              placeholder="UUID of the assistant"
            />
            <Field
              id="manual-user-id"
              label="User ID (optional)"
              value={userId}
              onChange={setUserId}
              placeholder="Target specific user"
            />
            <div>
              <label
                htmlFor="manual-surface"
                className="mb-1 block text-xs font-medium text-text-muted"
              >
                Surface
              </label>
              <select
                id="manual-surface"
                value={surface}
                onChange={(event) => setSurface(event.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
              >
                {SURFACES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <Field
              id="manual-override-minutes"
              label="Override duration (minutes)"
              value={overrideMinutes}
              onChange={setOverrideMinutes}
              placeholder="1-1440"
              type="number"
            />
          </div>

          <button
            type="button"
            disabled={busy || !assistantId.trim()}
            onClick={() => void handleUnblock()}
            className={cn(
              "mt-4 flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors",
              !assistantId.trim()
                ? "cursor-default bg-surface text-text-subtle"
                : "cursor-pointer bg-destructive/15 text-destructive hover:bg-destructive/25",
              "disabled:opacity-50"
            )}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" />
            )}
            Unblock
          </button>

          <FeedbackBanner feedback={feedback} />
        </div>
      </div>
    </div>
  );
}

function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  if (feedback === null) {
    return null;
  }
  const isPositive = feedback.type === "ok";
  const isInfo = feedback.type === "info";
  return (
    <div
      className={cn(
        "mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
        isPositive
          ? "bg-success/10 text-success"
          : isInfo
            ? "bg-surface text-text-muted border border-border"
            : "bg-destructive/10 text-destructive"
      )}
    >
      {isPositive ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : (
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      {feedback.text}
    </div>
  );
}

function formatAssistantLabel(
  assistant: Pick<
    AdminAbuseAssistantLookupItem,
    "assistantId" | "assistantDisplayName" | "userDisplayName" | "userEmail"
  >
): string {
  const title =
    assistant.assistantDisplayName?.trim() ||
    assistant.userDisplayName?.trim() ||
    assistant.userEmail;
  return `${title} (${assistant.assistantId})`;
}

function renderSurfaceLabel(surface: "web_chat" | "telegram" | "whatsapp" | "max"): string {
  if (surface === "telegram") return "Telegram";
  if (surface === "whatsapp") return "WhatsApp";
  if (surface === "max") return "MAX";
  return "Web Chat";
}

function formatRemainingTime(iso: string, nowMs: number): string {
  const remainingMs = new Date(iso).getTime() - nowMs;
  if (remainingMs <= 0) {
    return "Expired";
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text"
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-text-muted">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
      />
    </div>
  );
}
