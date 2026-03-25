"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Sparkles,
  Upload,
  Save,
  Rocket,
  RotateCcw,
  Trash2,
  Brain,
  ListTodo,
  Send,
  BarChart3,
  History,
  Loader2,
  AlertTriangle
} from "lucide-react";
import type {
  AssistantMemoryRegistryItemState,
  AssistantTaskRegistryItemState
} from "@persai/contracts";
import { cn } from "@/app/lib/utils";
import type { AppData } from "./use-app-data";
import {
  patchAssistantDraft,
  postAssistantPublish,
  postAssistantRollback,
  postAssistantReset,
  getAssistantMemoryItems,
  getAssistantTaskItems,
  postAssistantMemoryItemForget,
  postAssistantTaskItemDisable,
  postAssistantTaskItemEnable,
  postAssistantTaskItemCancel
} from "../assistant-api-client";

interface AssistantSettingsProps {
  data: AppData;
}

type ActionFeedback = { type: "ok" | "err"; text: string } | null;

function Section({
  icon,
  title,
  children,
  defaultOpen = true
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2.5 px-5 py-3.5 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="text-text-muted">{icon}</span>
        <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
          {title}
        </span>
        <span className="text-[10px] text-text-subtle">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}

function FeedbackLine({ fb }: { fb: ActionFeedback }) {
  if (!fb) return null;
  return (
    <p className={cn("mt-2 text-xs", fb.type === "ok" ? "text-success" : "text-destructive")}>
      {fb.text}
    </p>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  busy,
  variant = "default",
  disabled
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy: boolean;
  variant?: "default" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-50",
        variant === "danger"
          ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
          : "bg-surface-raised text-text-muted hover:bg-surface-hover hover:text-text"
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

export function AssistantSettings({ data }: AssistantSettingsProps) {
  const { getToken } = useAuth();
  const assistant = data.assistant;
  const statusCfg = STATUS_LABELS[data.assistantStatus] ?? STATUS_LABELS.none!;

  const version = assistant?.latestPublishedVersion ?? null;
  const [draftName, setDraftName] = useState(assistant?.draft.displayName ?? "");
  const [draftInstructions, setDraftInstructions] = useState(assistant?.draft.instructions ?? "");
  const [editingPersonality, setEditingPersonality] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFb, setSaveFb] = useState<ActionFeedback>(null);

  const [publishing, setPublishing] = useState(false);
  const [pubFb, setPubFb] = useState<ActionFeedback>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackConfirm, setRollbackConfirm] = useState(false);
  const [rollbackFb, setRollbackFb] = useState<ActionFeedback>(null);
  const [resetting, setResetting] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetFb, setResetFb] = useState<ActionFeedback>(null);

  const [memoryItems, setMemoryItems] = useState<AssistantMemoryRegistryItemState[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [forgettingId, setForgettingId] = useState<string | null>(null);

  const [taskItems, setTaskItems] = useState<AssistantTaskRegistryItemState[]>([]);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskActionId, setTaskActionId] = useState<string | null>(null);

  useEffect(() => {
    setDraftName(assistant?.draft.displayName ?? "");
    setDraftInstructions(assistant?.draft.instructions ?? "");
  }, [assistant]);

  const loadMemory = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setMemoryLoading(true);
    try {
      setMemoryItems(await getAssistantMemoryItems(token));
    } catch {
      /* non-critical */
    }
    setMemoryLoading(false);
  }, [getToken]);

  const loadTasks = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setTaskLoading(true);
    try {
      setTaskItems(await getAssistantTaskItems(token));
    } catch {
      /* non-critical */
    }
    setTaskLoading(false);
  }, [getToken]);

  useEffect(() => {
    if (assistant) {
      void loadMemory();
      void loadTasks();
    }
  }, [assistant, loadMemory, loadTasks]);

  const handleSaveDraft = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setSaving(true);
    setSaveFb(null);
    try {
      await patchAssistantDraft(token, {
        displayName: draftName || null,
        instructions: draftInstructions || null
      });
      setSaveFb({ type: "ok", text: "Draft saved." });
      data.reload();
    } catch (e) {
      setSaveFb({ type: "err", text: e instanceof Error ? e.message : "Save failed." });
    }
    setSaving(false);
  }, [getToken, draftName, draftInstructions, data]);

  const handlePublish = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setPublishing(true);
    setPubFb(null);
    try {
      await postAssistantPublish(token);
      setPubFb({ type: "ok", text: "Published and applying." });
      data.reload();
    } catch (e) {
      setPubFb({ type: "err", text: e instanceof Error ? e.message : "Publish failed." });
    }
    setPublishing(false);
  }, [getToken, data]);

  const handleRollback = useCallback(async () => {
    const token = await getToken();
    if (!token || !version) return;
    const targetVersion = version.version - 1;
    if (targetVersion < 1) return;
    setRollingBack(true);
    setRollbackFb(null);
    try {
      await postAssistantRollback(token, { targetVersion });
      setRollbackFb({ type: "ok", text: `Rolled back to v${targetVersion}.` });
      setRollbackConfirm(false);
      data.reload();
    } catch (e) {
      setRollbackFb({ type: "err", text: e instanceof Error ? e.message : "Rollback failed." });
    }
    setRollingBack(false);
  }, [getToken, version, data]);

  const handleReset = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setResetting(true);
    setResetFb(null);
    try {
      await postAssistantReset(token);
      setResetFb({ type: "ok", text: "Assistant reset." });
      setResetConfirm(false);
      data.reload();
    } catch (e) {
      setResetFb({ type: "err", text: e instanceof Error ? e.message : "Reset failed." });
    }
    setResetting(false);
  }, [getToken, data]);

  const handleForget = useCallback(
    async (itemId: string) => {
      const token = await getToken();
      if (!token) return;
      setForgettingId(itemId);
      try {
        await postAssistantMemoryItemForget(token, itemId);
        setMemoryItems((prev) => prev.filter((m) => m.id !== itemId));
      } catch {
        /* non-critical */
      }
      setForgettingId(null);
    },
    [getToken]
  );

  const handleTaskAction = useCallback(
    async (itemId: string, action: "enable" | "disable" | "cancel") => {
      const token = await getToken();
      if (!token) return;
      setTaskActionId(itemId);
      try {
        if (action === "enable") await postAssistantTaskItemEnable(token, itemId);
        else if (action === "disable") await postAssistantTaskItemDisable(token, itemId);
        else await postAssistantTaskItemCancel(token, itemId);
        await loadTasks();
      } catch {
        /* non-critical */
      }
      setTaskActionId(null);
    },
    [getToken, loadTasks]
  );

  if (!assistant) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <Sparkles className="mb-4 h-10 w-10 text-text-subtle" />
        <p className="text-sm text-text-muted">No assistant created yet.</p>
        <p className="mt-1 text-xs text-text-subtle">Create one from the main screen.</p>
      </div>
    );
  }

  return (
    <div>
      {/* 1. Character — hero */}
      <Section icon={<Sparkles className="h-4 w-4" />} title="Character">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <Sparkles className="h-7 w-7" />
          </div>
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Assistant name"
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
            />
            <span className="mt-1.5 flex items-center gap-1.5">
              <span className={cn("inline-block h-2 w-2 rounded-full", statusCfg.dot)} />
              <span className="text-xs text-text-muted">{statusCfg.label}</span>
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setEditingPersonality(!editingPersonality)}
          className="mt-3 cursor-pointer text-xs font-medium text-accent hover:text-accent-hover transition-colors"
        >
          {editingPersonality ? "Hide personality editor" : "Edit personality"}
        </button>

        {editingPersonality && (
          <textarea
            value={draftInstructions}
            onChange={(e) => setDraftInstructions(e.target.value)}
            placeholder="Describe your assistant's personality and instructions..."
            rows={5}
            className="mt-2 w-full resize-y rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
          />
        )}

        <div className="mt-3 flex items-center gap-2">
          <ActionButton
            icon={<Save className="h-3.5 w-3.5" />}
            label="Save draft"
            onClick={() => void handleSaveDraft()}
            busy={saving}
          />
        </div>
        <FeedbackLine fb={saveFb} />
      </Section>

      {/* 2. Quick actions */}
      <Section icon={<Rocket className="h-4 w-4" />} title="Quick actions">
        {version && (
          <p className="mb-3 text-xs text-text-muted">
            Version {version.version} · Apply: {assistant.runtimeApply.status}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <ActionButton
            icon={<Upload className="h-3.5 w-3.5" />}
            label="Publish"
            onClick={() => void handlePublish()}
            busy={publishing}
          />
          {!rollbackConfirm ? (
            <ActionButton
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              label="Rollback"
              onClick={() => setRollbackConfirm(true)}
              busy={false}
              disabled={!version || version.version < 2}
            />
          ) : (
            <div className="flex items-center gap-2">
              <ActionButton
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                label={`Rollback to v${(version?.version ?? 2) - 1}`}
                onClick={() => void handleRollback()}
                busy={rollingBack}
              />
              <button
                type="button"
                onClick={() => setRollbackConfirm(false)}
                className="cursor-pointer text-xs text-text-subtle hover:text-text-muted"
              >
                Cancel
              </button>
            </div>
          )}
          {!resetConfirm ? (
            <ActionButton
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Reset"
              variant="danger"
              onClick={() => setResetConfirm(true)}
              busy={false}
            />
          ) : (
            <div className="flex items-center gap-2">
              <ActionButton
                icon={<AlertTriangle className="h-3.5 w-3.5" />}
                label="Confirm reset"
                variant="danger"
                onClick={() => void handleReset()}
                busy={resetting}
              />
              <button
                type="button"
                onClick={() => setResetConfirm(false)}
                className="cursor-pointer text-xs text-text-subtle hover:text-text-muted"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        <FeedbackLine fb={pubFb} />
        <FeedbackLine fb={rollbackFb} />
        <FeedbackLine fb={resetFb} />
      </Section>

      {/* 3. Memory */}
      <Section icon={<Brain className="h-4 w-4" />} title="Memory" defaultOpen={false}>
        {memoryLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
          </div>
        ) : memoryItems.length === 0 ? (
          <p className="text-xs text-text-subtle">No memories stored yet.</p>
        ) : (
          <ul className="space-y-2">
            {memoryItems.map((item) => (
              <li key={item.id} className="flex items-start gap-2 rounded-lg bg-surface-raised p-3">
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-text-muted">
                  {item.summary}
                </p>
                <button
                  type="button"
                  disabled={forgettingId === item.id}
                  onClick={() => void handleForget(item.id)}
                  className="shrink-0 cursor-pointer rounded p-1 text-text-subtle transition-colors hover:bg-surface-hover hover:text-destructive disabled:cursor-default disabled:opacity-50"
                  title="Forget"
                >
                  {forgettingId === item.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 4. Tasks */}
      <Section icon={<ListTodo className="h-4 w-4" />} title="Tasks" defaultOpen={false}>
        {taskLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
          </div>
        ) : taskItems.length === 0 ? (
          <p className="text-xs text-text-subtle">No tasks registered.</p>
        ) : (
          <ul className="space-y-2">
            {taskItems.map((item) => (
              <li key={item.id} className="rounded-lg bg-surface-raised p-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">
                    {item.title}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      item.controlStatus === "active" && "bg-success/15 text-success",
                      item.controlStatus === "disabled" && "bg-warning/15 text-warning",
                      item.controlStatus === "cancelled" && "bg-text-subtle/15 text-text-subtle"
                    )}
                  >
                    {item.controlStatus}
                  </span>
                </div>
                <div className="mt-2 flex gap-1.5">
                  {item.controlStatus === "active" && (
                    <ActionButton
                      icon={<RotateCcw className="h-3 w-3" />}
                      label="Disable"
                      onClick={() => void handleTaskAction(item.id, "disable")}
                      busy={taskActionId === item.id}
                    />
                  )}
                  {item.controlStatus === "disabled" && (
                    <ActionButton
                      icon={<Rocket className="h-3 w-3" />}
                      label="Enable"
                      onClick={() => void handleTaskAction(item.id, "enable")}
                      busy={taskActionId === item.id}
                    />
                  )}
                  {item.controlStatus !== "cancelled" && (
                    <ActionButton
                      icon={<Trash2 className="h-3 w-3" />}
                      label="Cancel"
                      variant="danger"
                      onClick={() => void handleTaskAction(item.id, "cancel")}
                      busy={taskActionId === item.id}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 5. Channels */}
      <Section icon={<Send className="h-4 w-4" />} title="Channels" defaultOpen={false}>
        <div className="space-y-1.5">
          <ChannelRow name="Telegram" connected={data.telegram?.connectionStatus === "connected"} />
          <ChannelRow name="WhatsApp" comingSoon />
          <ChannelRow name="MAX" comingSoon />
        </div>
      </Section>

      {/* 6. Limits & Plan */}
      <Section icon={<BarChart3 className="h-4 w-4" />} title="Limits & Plan" defaultOpen={false}>
        {data.plan ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-text">
              {data.plan.effectivePlan.displayName ?? "Free plan"}
            </p>
            <LimitBar label="Token budget" pct={data.plan.limits.tokenBudgetPercent} />
            <LimitBar label="Active chats" pct={data.plan.limits.activeWebChatsPercent} />
            <LimitBar label="Tools" pct={data.plan.limits.costDrivingToolsPercent} />
          </div>
        ) : (
          <p className="text-xs text-text-subtle">Plan info unavailable.</p>
        )}
      </Section>

      {/* 7. Publish history */}
      <Section icon={<History className="h-4 w-4" />} title="Publish history" defaultOpen={false}>
        {version ? (
          <div className="text-xs text-text-muted">
            <p>Latest: v{version.version}</p>
            <p className="text-text-subtle">
              Published {new Date(version.publishedAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="text-xs text-text-subtle">No versions published yet.</p>
        )}
      </Section>
    </div>
  );
}

const STATUS_LABELS: Record<string, { label: string; dot: string }> = {
  live: { label: "Live", dot: "bg-success" },
  applying: { label: "Applying...", dot: "bg-warning" },
  draft: { label: "Draft", dot: "bg-text-subtle" },
  failed: { label: "Failed", dot: "bg-destructive" },
  degraded: { label: "Degraded", dot: "bg-warning" },
  none: { label: "Not created", dot: "bg-text-subtle" }
};

function ChannelRow({
  name,
  connected,
  comingSoon
}: {
  name: string;
  connected?: boolean;
  comingSoon?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2", comingSoon && "opacity-50")}>
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          connected ? "bg-success" : "bg-text-subtle"
        )}
      />
      <span className="text-xs text-text-muted">{name}</span>
      {comingSoon && <span className="text-[10px] text-text-subtle">Coming soon</span>}
      {connected && <span className="text-[10px] text-success">Connected</span>}
    </div>
  );
}

function LimitBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="flex justify-between text-[11px]">
        <span className="text-text-muted">{label}</span>
        <span className="text-text-subtle">{pct}%</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-raised">
        <div
          className={cn("h-full rounded-full", pct >= 90 ? "bg-destructive" : "bg-accent")}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
