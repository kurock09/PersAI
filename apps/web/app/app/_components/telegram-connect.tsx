"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Copy,
  ChevronDown,
  ExternalLink,
  Users,
  Unplug,
  RefreshCw
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import { AssistantAvatar } from "./assistant-avatar";
import {
  postAssistantTelegramConnect,
  postAssistantTelegramDisconnect,
  postAssistantTelegramResendOwnerMessage,
  patchAssistantTelegramConfig,
  fetchAssistantTelegramGroups,
  type TelegramIntegrationState,
  type TelegramGroupInfo,
  type AssistantTelegramConfigUpdateRequest
} from "../assistant-api-client";

interface TelegramConnectProps {
  integration: TelegramIntegrationState | null;
  capabilityAllowed: boolean;
  assistantAvatarUrl?: string | undefined;
  assistantAvatarEmoji?: string | undefined;
  assistantDisplayName?: string | undefined;
  onUpdated: () => void;
}

type Feedback = { type: "ok" | "err"; text: string } | null;

function resolveSystemNoteLabel(note: string, t: (key: string) => string): string {
  switch (note) {
    case "Telegram is modeled as one provider + one interaction surface binding.":
      return t("systemNoteProviderSurface");
    case "Telegram direct messages are owner-only after claim.":
      return t("systemNoteOwnerOnlyDm");
    case "Web remains the primary control-plane surface for assistant configuration.":
      return t("systemNoteWebControlPlane");
    default:
      return note;
  }
}

function openTelegramUrl(url: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.location.assign(url);
}

export function TelegramConnect({
  integration,
  capabilityAllowed,
  assistantAvatarUrl,
  assistantAvatarEmoji,
  assistantDisplayName,
  onUpdated
}: TelegramConnectProps) {
  const t = useTranslations("telegram");
  const connected =
    integration?.connectionStatus === "connected" ||
    integration?.connectionStatus === "claim_required" ||
    integration?.connectionStatus === "invalid_token";
  const allowed = integration?.capabilityAllowed ?? capabilityAllowed;
  const [reconnecting, setReconnecting] = useState(false);

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center px-5 py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-raised">
          <Send className="h-7 w-7 text-text-subtle" />
        </div>
        <h3 className="text-sm font-semibold text-text">{t("notAvailable")}</h3>
        <p className="mt-2 max-w-xs text-xs text-text-muted">{t("notAvailableDesc")}</p>
      </div>
    );
  }

  if (!connected || reconnecting) {
    return (
      <ConnectForm
        onUpdated={() => {
          setReconnecting(false);
          onUpdated();
        }}
        onCancel={reconnecting ? () => setReconnecting(false) : undefined}
        isReconnect={reconnecting}
      />
    );
  }

  return (
    <ConnectedView
      integration={integration!}
      assistantAvatarUrl={assistantAvatarUrl}
      assistantAvatarEmoji={assistantAvatarEmoji}
      assistantDisplayName={assistantDisplayName}
      onUpdated={onUpdated}
      onReconnect={() => setReconnecting(true)}
    />
  );
}

function ConnectForm({
  onUpdated,
  onCancel,
  isReconnect
}: {
  onUpdated: () => void;
  onCancel?: (() => void) | undefined;
  isReconnect?: boolean | undefined;
}) {
  const { getToken } = useAuth();
  const t = useTranslations("telegram");
  const tc = useTranslations("common");
  const [botToken, setBotToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const handleConnect = useCallback(async () => {
    const token = await getToken();
    if (!token || !botToken.trim()) return;

    setBusy(true);
    setFeedback(null);
    try {
      await postAssistantTelegramConnect(token, { botToken: botToken.trim() });
      setFeedback({ type: "ok", text: t("connectedSuccess") });
      onUpdated();
    } catch (e) {
      setFeedback({
        type: "err",
        text: e instanceof Error ? e.message : t("connectFailed")
      });
    } finally {
      setBusy(false);
    }
  }, [getToken, botToken, onUpdated, t]);

  const ready = botToken.trim().length >= 10;

  return (
    <div className="px-5 py-6 space-y-6">
      {isReconnect && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-text">{t("reconnectBot")}</span>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="cursor-pointer text-xs text-text-muted hover:text-text transition-colors"
            >
              {tc("cancel")}
            </button>
          )}
        </div>
      )}

      {/* Steps guide */}
      <div className="space-y-3">
        <Step
          num={1}
          done
          title={t("step1Title")}
          desc={
            <>
              {t("step1Desc").split("@BotFather")[0]}
              <a
                href="https://t.me/BotFather"
                onClick={(event) => {
                  event.preventDefault();
                  openTelegramUrl("https://t.me/BotFather");
                }}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline"
              >
                @BotFather <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </>
          }
        />
        <Step num={2} done title={t("step2Title")} desc={t("step2Desc")} />
        <Step num={3} done={false} active title={t("step3Title")} desc={t("step3Desc")} />
      </div>

      {/* Token input */}
      <div className="rounded-xl border border-border bg-surface-raised/50 p-4 space-y-3">
        <label className="block text-xs font-medium text-text-muted">{t("botTokenLabel")}</label>
        <input
          type="password"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder={t("botTokenPlaceholder")}
          autoFocus
          className="w-full rounded-lg border border-border bg-bg px-4 py-3 text-sm text-text placeholder:text-text-subtle outline-none transition-colors focus:border-accent"
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready) void handleConnect();
          }}
        />

        <button
          type="button"
          onClick={() => void handleConnect()}
          disabled={busy || !ready}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition-all",
            busy || !ready
              ? "cursor-default bg-surface-raised text-text-subtle"
              : "cursor-pointer bg-accent text-white shadow-lg shadow-accent-glow hover:bg-accent-hover"
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {busy ? t("connecting") : t("connectBot")}
        </button>
      </div>

      {feedback && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs",
            feedback.type === "ok"
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive"
          )}
        >
          {feedback.type === "ok" ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          {feedback.text}
        </div>
      )}

      {/* What happens next */}
      <div className="rounded-xl border border-border p-4">
        <p className="mb-2.5 text-xs font-medium text-text-muted">{t("afterConnecting")}</p>
        <ul className="space-y-2 text-xs text-text-subtle">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
            {t("afterNote1")}
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
            {t("afterNote2")}
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
            {t("afterNote3")}
          </li>
        </ul>
      </div>
    </div>
  );
}

function ConnectedView({
  integration,
  assistantAvatarUrl,
  assistantAvatarEmoji,
  assistantDisplayName,
  onUpdated,
  onReconnect
}: {
  integration: TelegramIntegrationState;
  assistantAvatarUrl?: string | undefined;
  assistantAvatarEmoji?: string | undefined;
  assistantDisplayName?: string | undefined;
  onUpdated: () => void;
  onReconnect: () => void;
}) {
  const { getToken } = useAuth();
  const t = useTranslations("telegram");
  const tc = useTranslations("common");
  const bot = integration.bot;
  const config = integration.configPanel.settings;
  const configAvailable = integration.configPanel.available;
  const showHeaderStatusBadge = integration.connectionStatus !== "claim_required";
  const statusTone =
    integration.connectionStatus === "connected"
      ? { dot: "bg-success", text: "text-success", label: t("connectedLabel") }
      : integration.connectionStatus === "claim_required"
        ? { dot: "bg-amber-500", text: "text-amber-600", label: t("claimRequiredLabel") }
        : integration.connectionStatus === "invalid_token"
          ? { dot: "bg-destructive", text: "text-destructive", label: t("invalidTokenLabel") }
          : { dot: "bg-text-subtle", text: "text-text-subtle", label: t("notConnectedLabel") };

  const [configOpen, setConfigOpen] = useState(false);
  const [autoCompactionEnabled, setAutoCompactionEnabled] = useState(config.autoCompactionEnabled);
  const [parseMode, setParseMode] = useState(config.defaultParseMode);
  const [defaultDeepModeEnabled, setDefaultDeepModeEnabled] = useState(
    config.defaultDeepModeEnabled
  );
  const [inbound, setInbound] = useState(config.inboundUserMessagesEnabled);
  const [outbound, setOutbound] = useState(config.outboundAssistantMessagesEnabled);
  const [groupReplyMode, setGroupReplyMode] = useState<"mention_reply" | "all_messages">(
    config.groupReplyMode
  );
  const [notes, setNotes] = useState(config.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [groups, setGroups] = useState<TelegramGroupInfo[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [resendingOwnerMessage, setResendingOwnerMessage] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [claimCodeCopied, setClaimCodeCopied] = useState(false);
  const [claimHelpOpen, setClaimHelpOpen] = useState(false);
  const shouldRefreshAfterTelegramReturnRef = useRef(false);
  const canResendOwnerMessage = Boolean(integration.bot.ownerTelegramChatId);
  const findBotUrl = bot.username ? `https://t.me/${bot.username}` : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const t = await getToken();
      if (!t || cancelled) return;
      const g = await fetchAssistantTelegramGroups(t);
      if (!cancelled) {
        setGroups(g);
        setGroupsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  useEffect(() => {
    setAutoCompactionEnabled(config.autoCompactionEnabled);
    setParseMode(config.defaultParseMode);
    setDefaultDeepModeEnabled(config.defaultDeepModeEnabled);
    setInbound(config.inboundUserMessagesEnabled);
    setOutbound(config.outboundAssistantMessagesEnabled);
    setGroupReplyMode(config.groupReplyMode);
    setNotes(config.notes ?? "");
  }, [
    config.autoCompactionEnabled,
    config.defaultDeepModeEnabled,
    config.defaultParseMode,
    config.groupReplyMode,
    config.inboundUserMessagesEnabled,
    config.notes,
    config.outboundAssistantMessagesEnabled
  ]);

  useEffect(() => {
    if (
      integration.connectionStatus !== "claim_required" ||
      !integration.ownerClaim.claimExpiresAt
    ) {
      return;
    }
    const expiresAtMs = Date.parse(integration.ownerClaim.claimExpiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return;
    }
    const delayMs = Math.max(0, expiresAtMs - Date.now()) + 250;
    const timer = window.setTimeout(() => {
      onUpdated();
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [integration.connectionStatus, integration.ownerClaim.claimExpiresAt, onUpdated]);

  useEffect(() => {
    if (integration.connectionStatus !== "claim_required") {
      shouldRefreshAfterTelegramReturnRef.current = false;
      return;
    }

    const refreshOnceAfterReturn = () => {
      if (!shouldRefreshAfterTelegramReturnRef.current) return;
      if (document.visibilityState === "hidden") return;

      shouldRefreshAfterTelegramReturnRef.current = false;
      onUpdated();
      window.setTimeout(onUpdated, 1500);
    };

    window.addEventListener("focus", refreshOnceAfterReturn);
    window.addEventListener("pageshow", refreshOnceAfterReturn);
    document.addEventListener("visibilitychange", refreshOnceAfterReturn);
    return () => {
      window.removeEventListener("focus", refreshOnceAfterReturn);
      window.removeEventListener("pageshow", refreshOnceAfterReturn);
      document.removeEventListener("visibilitychange", refreshOnceAfterReturn);
    };
  }, [integration.connectionStatus, onUpdated]);

  const handleSave = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    setSaving(true);
    setFeedback(null);
    try {
      const payload: AssistantTelegramConfigUpdateRequest = {
        autoCompactionEnabled,
        defaultParseMode: parseMode,
        defaultDeepModeEnabled,
        inboundUserMessagesEnabled: inbound,
        outboundAssistantMessagesEnabled: outbound,
        notes: notes.trim() || null,
        groupReplyMode
      };
      await patchAssistantTelegramConfig(token, payload);
      setFeedback({ type: "ok", text: t("configSaved") });
      onUpdated();
    } catch (e) {
      setFeedback({
        type: "err",
        text: e instanceof Error ? e.message : t("configSaveFailed")
      });
    } finally {
      setSaving(false);
    }
  }, [
    autoCompactionEnabled,
    defaultDeepModeEnabled,
    getToken,
    groupReplyMode,
    inbound,
    notes,
    onUpdated,
    outbound,
    parseMode
  ]);

  const handleDisconnect = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    setDisconnecting(true);
    setFeedback(null);
    try {
      await postAssistantTelegramDisconnect(token, { reason: "User disconnected from UI" });
      setConfirmDisconnect(false);
      onUpdated();
    } catch (e) {
      setFeedback({
        type: "err",
        text: e instanceof Error ? e.message : t("disconnectFailed")
      });
      setConfirmDisconnect(false);
    } finally {
      setDisconnecting(false);
    }
  }, [getToken, onUpdated]);

  const handleCopyClaimCode = useCallback(async () => {
    const claimCode = integration.ownerClaim.code;
    if (!claimCode) {
      return;
    }
    try {
      await navigator.clipboard.writeText(claimCode);
      setClaimCodeCopied(true);
      setTimeout(() => setClaimCodeCopied(false), 1500);
    } catch {
      setFeedback({
        type: "err",
        text: t("copyCodeFailed")
      });
    }
  }, [integration.ownerClaim.code, t]);

  const handleResendOwnerMessage = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    setResendingOwnerMessage(true);
    setFeedback(null);
    try {
      await postAssistantTelegramResendOwnerMessage(token);
      setFeedback({ type: "ok", text: t("resendOwnerMessageSuccess") });
      onUpdated();
    } catch (e) {
      setFeedback({
        type: "err",
        text: e instanceof Error ? e.message : t("resendOwnerMessageFailed")
      });
    } finally {
      setResendingOwnerMessage(false);
    }
  }, [getToken, onUpdated, t]);

  const handleFindBot = useCallback(() => {
    if (!findBotUrl) {
      return;
    }
    shouldRefreshAfterTelegramReturnRef.current = true;
    openTelegramUrl(findBotUrl);
  }, [findBotUrl]);

  return (
    <div className="space-y-5 px-5 py-5">
      {/* Bot info */}
      <div className="flex items-center gap-3 rounded-xl bg-surface-raised p-4">
        <AssistantAvatar
          avatarUrl={assistantAvatarUrl ?? bot.avatarUrl}
          avatarEmoji={assistantAvatarEmoji}
          size="md"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">
            {assistantDisplayName ?? bot.displayName ?? "Telegram Bot"}
          </p>
          {bot.username && <p className="text-xs text-text-muted">@{bot.username}</p>}
        </div>
        {showHeaderStatusBadge && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", statusTone.dot)} />
            <span className={cn("text-xs", statusTone.text)}>{statusTone.label}</span>
          </div>
        )}
      </div>

      {integration.connectionStatus === "claim_required" && integration.ownerClaim.code && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
              <AlertCircle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text">{t("claimRequiredTitle")}</p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                {t("claimInstructionShort")}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-amber-500/20 bg-bg/80 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              {t("claimCode")}
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="flex min-h-12 flex-1 items-center justify-center rounded-lg border border-border bg-surface-raised px-3 text-xl font-semibold tracking-[0.08em] text-text sm:justify-start">
                {integration.ownerClaim.code}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyClaimCode()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text transition-colors hover:bg-surface-hover"
              >
                {claimCodeCopied ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {claimCodeCopied ? t("copiedCode") : t("copyCode")}
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleFindBot}
              disabled={!findBotUrl}
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-xs font-semibold text-white shadow-sm shadow-accent/20 transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("findBot")}
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
            {canResendOwnerMessage ? (
              <button
                type="button"
                onClick={() => void handleResendOwnerMessage()}
                disabled={resendingOwnerMessage}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {resendingOwnerMessage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {resendingOwnerMessage ? t("resendingOwnerMessage") : t("resendOwnerMessage")}
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setClaimHelpOpen((value) => !value)}
            className="mt-3 text-[11px] text-text-muted underline-offset-2 transition-colors hover:text-text hover:underline"
          >
            {claimHelpOpen ? t("hideClaimHelp") : t("showClaimHelp")}
          </button>
          {claimHelpOpen && (
            <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
              {t("claimRequiredDesc")}
            </p>
          )}
        </div>
      )}

      {integration.connectionStatus === "invalid_token" && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-xs font-medium text-destructive">{t("invalidTokenTitle")}</p>
          <p className="mt-1 text-xs text-text-muted">
            {integration.runtime.lastError || t("invalidTokenDesc")}
          </p>
        </div>
      )}

      {/* Status details */}
      <div className="space-y-2 rounded-xl border border-border p-4">
        <Row label={t("binding")} value={integration.bindingState} />
        <Row label={t("status")} value={statusTone.label} />
        {integration.connectedAt && (
          <Row
            label={t("connectedLabel")}
            value={new Date(integration.connectedAt).toLocaleDateString()}
          />
        )}
        <Row
          label={t("token")}
          value={integration.tokenHint.lastFour ? `****${integration.tokenHint.lastFour}` : "****"}
        />
        {bot.ownerTelegramUsername && (
          <Row label={t("owner")} value={`@${bot.ownerTelegramUsername}`} />
        )}
      </div>

      {/* Config panel */}
      {configAvailable && (
        <div className="rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setConfigOpen((o) => !o)}
            className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
          >
            {t("configuration")}
            <ChevronDown
              className={cn(
                "h-4 w-4 text-text-subtle transition-transform",
                configOpen && "rotate-180"
              )}
            />
          </button>

          {configOpen && (
            <div className="space-y-3.5 border-t border-border px-4 py-4">
              {/* Parse mode */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted">
                  {t("defaultParseMode")}
                </label>
                <div className="flex gap-2">
                  {(["plain_text", "markdown"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setParseMode(mode)}
                      className={cn(
                        "flex-1 cursor-pointer rounded-lg border py-2 text-xs font-medium transition-all",
                        parseMode === mode
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border bg-surface-raised text-text-muted hover:border-border-strong"
                      )}
                    >
                      {mode === "plain_text" ? t("plainText") : t("markdown")}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-text-subtle">
                  {t("parseModeMarkdownFootnote")}
                </p>
              </div>

              {/* Toggles */}
              <Toggle
                label={t("autoCompaction")}
                checked={autoCompactionEnabled}
                onChange={setAutoCompactionEnabled}
                description={t("autoCompactionDesc")}
              />
              <Toggle
                label={t("deepModeDefault")}
                checked={defaultDeepModeEnabled}
                onChange={setDefaultDeepModeEnabled}
              />
              <Toggle label={t("inboundMessages")} checked={inbound} onChange={setInbound} />
              <Toggle label={t("outboundMessages")} checked={outbound} onChange={setOutbound} />

              {/* Group reply mode */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted">
                  {t("groupReplyMode")}
                </label>
                <div className="flex gap-2">
                  {(
                    [
                      { value: "mention_reply", labelKey: "mentionReply" },
                      { value: "all_messages", labelKey: "allMessages" }
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setGroupReplyMode(option.value)}
                      className={cn(
                        "flex-1 cursor-pointer rounded-lg border py-2 text-xs font-medium transition-all",
                        groupReplyMode === option.value
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border bg-surface-raised text-text-muted hover:border-border-strong"
                      )}
                    >
                      {t(option.labelKey)}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-text-subtle">
                  {groupReplyMode === "mention_reply"
                    ? t("groupReplyMentionDesc")
                    : t("groupReplyAllDesc")}
                </p>
              </div>

              {/* Notes */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted">
                  {t("notes")}
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text placeholder:text-text-subtle outline-none transition-colors focus:border-accent"
                  placeholder={t("notesPlaceholder")}
                />
              </div>

              {/* Save */}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("saveConfig")}
              </button>

              {feedback && (
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
                    feedback.type === "ok"
                      ? "bg-success/10 text-success"
                      : "bg-destructive/10 text-destructive"
                  )}
                >
                  {feedback.type === "ok" ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                  ) : (
                    <AlertCircle className="h-3 w-3 shrink-0" />
                  )}
                  {feedback.text}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Groups */}
      <div className="rounded-xl border border-border">
        <div className="flex items-center gap-2 px-4 py-3">
          <Users className="h-4 w-4 text-text-subtle" />
          <span className="text-sm font-medium text-text">{t("groups")}</span>
          <span className="ml-auto text-xs text-text-muted">
            {t("activeCount", { count: groups.filter((g) => g.status === "active").length })}
          </span>
        </div>
        <div className="border-t border-border px-4 py-3">
          {groupsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
            </div>
          ) : groups.filter((g) => g.status === "active").length === 0 ? (
            <p className="py-3 text-center text-xs text-text-subtle">{t("addBotToGroup")}</p>
          ) : (
            <ul className="space-y-2">
              {groups
                .filter((g) => g.status === "active")
                .map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center justify-between rounded-lg bg-surface-raised/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-text">{g.title}</p>
                      {g.memberCount !== null && (
                        <p className="text-[10px] text-text-subtle">
                          {g.memberCount !== 1
                            ? t("members", { count: g.memberCount })
                            : t("member", { count: g.memberCount })}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                      {t("activeStatus")}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      {/* Integration notes */}
      {integration.notes.length > 0 && (
        <div className="rounded-xl border border-border p-4">
          <p className="mb-2 text-xs font-medium text-text-muted">{t("systemNotes")}</p>
          <ul className="space-y-1">
            {integration.notes.map((note, i) => (
              <li key={i} className="text-xs text-text-subtle">
                {resolveSystemNoteLabel(note, t)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Disconnect / Reconnect */}
      <div className="space-y-2 pt-1">
        <button
          type="button"
          onClick={onReconnect}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-xs font-medium text-text transition-colors hover:bg-surface-hover"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("reconnectToken")}
        </button>

        {!confirmDisconnect ? (
          <button
            type="button"
            onClick={() => setConfirmDisconnect(true)}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-medium text-destructive/70 transition-colors hover:bg-destructive/5 hover:text-destructive"
          >
            <Unplug className="h-3.5 w-3.5" />
            {t("disconnectBot")}
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmDisconnect(false)}
              disabled={disconnecting}
              className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-border px-3 py-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover"
            >
              {tc("cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-60"
            >
              {disconnecting && <Loader2 className="h-3 w-3 animate-spin" />}
              {t("confirmDisconnect")}
            </button>
          </div>
        )}
      </div>

      {feedback && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
            feedback.type === "ok"
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive"
          )}
        >
          {feedback.type === "ok" ? (
            <CheckCircle2 className="h-3 w-3 shrink-0" />
          ) : (
            <AlertCircle className="h-3 w-3 shrink-0" />
          )}
          {feedback.text}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="text-text">{value}</span>
    </div>
  );
}

function Step({
  num,
  done,
  active,
  title,
  desc
}: {
  num: number;
  done: boolean;
  active?: boolean;
  title: string;
  desc: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
          active
            ? "bg-accent text-white"
            : done
              ? "bg-accent/15 text-accent"
              : "bg-surface-raised text-text-subtle"
        )}
      >
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : num}
      </div>
      <div className="min-w-0 pt-0.5">
        <p className={cn("text-xs font-medium", active ? "text-text" : "text-text-muted")}>
          {title}
        </p>
        <p className="mt-0.5 text-[11px] text-text-subtle">{desc}</p>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  description
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-xs text-text-muted">{label}</span>
        {description ? (
          <span className="mt-1 block text-[11px] text-text-subtle">{description}</span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
          checked ? "bg-accent" : "bg-surface-raised"
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          )}
        />
      </button>
    </label>
  );
}
