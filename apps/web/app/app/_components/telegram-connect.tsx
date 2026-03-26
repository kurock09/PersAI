"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ExternalLink,
  Users,
  Unplug,
  RefreshCw
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import {
  postAssistantTelegramConnect,
  postAssistantTelegramDisconnect,
  patchAssistantTelegramConfig,
  fetchAssistantTelegramGroups,
  type TelegramIntegrationState,
  type TelegramGroupInfo,
  type AssistantTelegramConfigUpdateRequest
} from "../assistant-api-client";

interface TelegramConnectProps {
  integration: TelegramIntegrationState | null;
  capabilityAllowed: boolean;
  onUpdated: () => void;
}

type Feedback = { type: "ok" | "err"; text: string } | null;

export function TelegramConnect({
  integration,
  capabilityAllowed,
  onUpdated
}: TelegramConnectProps) {
  const connected = integration?.connectionStatus === "connected";
  const allowed = integration?.capabilityAllowed ?? capabilityAllowed;
  const [reconnecting, setReconnecting] = useState(false);

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center px-5 py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-raised">
          <Send className="h-7 w-7 text-text-subtle" />
        </div>
        <h3 className="text-sm font-semibold text-text">Telegram not available</h3>
        <p className="mt-2 max-w-xs text-xs text-text-muted">
          Your current plan does not include Telegram integration. Contact your administrator to
          upgrade.
        </p>
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
  onCancel?: () => void;
  isReconnect?: boolean;
}) {
  const { getToken } = useAuth();
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
      setFeedback({ type: "ok", text: "Connected successfully!" });
      onUpdated();
    } catch (e) {
      setFeedback({
        type: "err",
        text: e instanceof Error ? e.message : "Failed to connect."
      });
    } finally {
      setBusy(false);
    }
  }, [getToken, botToken, onUpdated]);

  const ready = botToken.trim().length >= 10;

  return (
    <div className="px-5 py-6 space-y-6">
      {isReconnect && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-text">Reconnect bot</span>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="cursor-pointer text-xs text-text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Steps guide */}
      <div className="space-y-3">
        <Step
          num={1}
          done
          title="Open BotFather"
          desc={
            <>
              Open{" "}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline"
              >
                @BotFather <ExternalLink className="h-2.5 w-2.5" />
              </a>{" "}
              in Telegram
            </>
          }
        />
        <Step
          num={2}
          done
          title="Create a bot"
          desc="Send /newbot and follow the instructions to pick a name and username"
        />
        <Step
          num={3}
          done={false}
          active
          title="Paste the token"
          desc="Copy the API token BotFather gives you and paste it below"
        />
      </div>

      {/* Token input */}
      <div className="rounded-xl border border-border bg-surface-raised/50 p-4 space-y-3">
        <label className="block text-xs font-medium text-text-muted">Bot API token</label>
        <input
          type="password"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder="123456789:ABCdefGHIjklmnop..."
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
          {busy ? "Connecting..." : "Connect bot"}
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
        <p className="mb-2.5 text-xs font-medium text-text-muted">After connecting</p>
        <ul className="space-y-2 text-xs text-text-subtle">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
            Your assistant will respond to messages in the Telegram bot
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
            Conversations sync with the web chat memory
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
            You can configure parse mode and message routing
          </li>
        </ul>
      </div>
    </div>
  );
}

function ConnectedView({
  integration,
  onUpdated,
  onReconnect
}: {
  integration: TelegramIntegrationState;
  onUpdated: () => void;
  onReconnect: () => void;
}) {
  const { getToken } = useAuth();
  const bot = integration.bot;
  const config = integration.configPanel.settings;
  const configAvailable = integration.configPanel.available;

  const [configOpen, setConfigOpen] = useState(false);
  const [parseMode, setParseMode] = useState(config.defaultParseMode);
  const [inbound, setInbound] = useState(config.inboundUserMessagesEnabled);
  const [outbound, setOutbound] = useState(config.outboundAssistantMessagesEnabled);
  const [groupReplyMode, setGroupReplyMode] = useState<string>(
    ((config as unknown as Record<string, unknown>).groupReplyMode as string) ?? "mention_reply"
  );
  const [notes, setNotes] = useState(config.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [groups, setGroups] = useState<TelegramGroupInfo[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

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

  const handleSave = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    setSaving(true);
    setFeedback(null);
    try {
      const payload: AssistantTelegramConfigUpdateRequest = {
        defaultParseMode: parseMode,
        inboundUserMessagesEnabled: inbound,
        outboundAssistantMessagesEnabled: outbound,
        notes: notes.trim() || null,
        groupReplyMode
      } as AssistantTelegramConfigUpdateRequest;
      await patchAssistantTelegramConfig(token, payload);
      setFeedback({ type: "ok", text: "Config saved." });
      onUpdated();
    } catch (e) {
      setFeedback({
        type: "err",
        text: e instanceof Error ? e.message : "Failed to save."
      });
    } finally {
      setSaving(false);
    }
  }, [getToken, parseMode, inbound, outbound, groupReplyMode, notes, onUpdated]);

  const handleDisconnect = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    setDisconnecting(true);
    setFeedback(null);
    try {
      await postAssistantTelegramDisconnect(token, { reason: "User disconnected from UI" });
      setConfirmDisconnect(false);
      onUpdated();
    } catch {
      setFeedback({
        type: "err",
        text: 'Could not disconnect. Use "Reconnect" to update the token instead.'
      });
      setConfirmDisconnect(false);
    } finally {
      setDisconnecting(false);
    }
  }, [getToken, onUpdated]);

  return (
    <div className="space-y-5 px-5 py-5">
      {/* Bot info */}
      <div className="flex items-center gap-3 rounded-xl bg-surface-raised p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/15">
          {bot.avatarUrl ? (
            <img
              src={bot.avatarUrl}
              alt={bot.displayName ?? "Bot"}
              className="h-full w-full object-cover"
            />
          ) : (
            <Send className="h-5 w-5 text-accent" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">
            {bot.displayName ?? "Telegram Bot"}
          </p>
          {bot.username && <p className="text-xs text-text-muted">@{bot.username}</p>}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success" />
          <span className="text-xs text-success">Connected</span>
        </div>
      </div>

      {/* Status details */}
      <div className="space-y-2 rounded-xl border border-border p-4">
        <Row label="Binding" value={integration.bindingState} />
        {integration.connectedAt && (
          <Row label="Connected" value={new Date(integration.connectedAt).toLocaleDateString()} />
        )}
        <Row
          label="Token"
          value={integration.tokenHint.lastFour ? `****${integration.tokenHint.lastFour}` : "****"}
        />
      </div>

      {/* Config panel */}
      {configAvailable && (
        <div className="rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setConfigOpen((o) => !o)}
            className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
          >
            Configuration
            <ChevronDown
              className={cn(
                "h-4 w-4 text-text-subtle transition-transform",
                configOpen && "rotate-180"
              )}
            />
          </button>

          {configOpen && (
            <div className="space-y-4 border-t border-border px-4 py-4">
              {/* Parse mode */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted">
                  Default parse mode
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
                      {mode === "plain_text" ? "Plain text" : "Markdown"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <Toggle label="Inbound user messages" checked={inbound} onChange={setInbound} />
              <Toggle
                label="Outbound assistant messages"
                checked={outbound}
                onChange={setOutbound}
              />

              {/* Group reply mode */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted">
                  Group reply mode
                </label>
                <div className="flex gap-2">
                  {(
                    [
                      { value: "mention_reply", label: "Mention / Reply" },
                      { value: "all_messages", label: "All messages" }
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
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-text-subtle">
                  {groupReplyMode === "mention_reply"
                    ? "Bot responds only to @mentions and replies in groups"
                    : "Bot responds to all messages in groups"}
                </p>
              </div>

              {/* Notes */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text placeholder:text-text-subtle outline-none transition-colors focus:border-accent"
                  placeholder="Optional notes..."
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
                Save configuration
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
          <span className="text-sm font-medium text-text">Groups</span>
          <span className="ml-auto text-xs text-text-muted">
            {groups.filter((g) => g.status === "active").length} active
          </span>
        </div>
        <div className="border-t border-border px-4 py-3">
          {groupsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
            </div>
          ) : groups.length === 0 ? (
            <p className="py-3 text-center text-xs text-text-subtle">
              Add the bot to a Telegram group — it will appear here automatically.
            </p>
          ) : (
            <ul className="space-y-2">
              {groups.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between rounded-lg bg-surface-raised/50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-text">{g.title}</p>
                    {g.memberCount !== null && (
                      <p className="text-[10px] text-text-subtle">
                        {g.memberCount} member{g.memberCount !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      g.status === "active"
                        ? "bg-success/10 text-success"
                        : "bg-destructive/10 text-destructive"
                    )}
                  >
                    {g.status === "active" ? "Active" : "Left"}
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
          <p className="mb-2 text-xs font-medium text-text-muted">System notes</p>
          <ul className="space-y-1">
            {integration.notes.map((note, i) => (
              <li key={i} className="text-xs text-text-subtle">
                {note}
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
          Reconnect with new token
        </button>

        {!confirmDisconnect ? (
          <button
            type="button"
            onClick={() => setConfirmDisconnect(true)}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-medium text-destructive/70 transition-colors hover:bg-destructive/5 hover:text-destructive"
          >
            <Unplug className="h-3.5 w-3.5" />
            Disconnect bot
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmDisconnect(false)}
              disabled={disconnecting}
              className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-border px-3 py-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-60"
            >
              {disconnecting && <Loader2 className="h-3 w-3 animate-spin" />}
              Confirm disconnect
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
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between">
      <span className="text-xs text-text-muted">{label}</span>
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
