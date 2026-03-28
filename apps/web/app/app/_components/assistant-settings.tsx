"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Sparkles,
  Rocket,
  RotateCcw,
  Trash2,
  Brain,
  ListTodo,
  Send,
  BarChart3,
  History,
  Loader2,
  AlertTriangle,
  Upload
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
  patchAssistantNotificationPreference,
  getAssistantMemoryItems,
  type AssistantPreferredNotificationChannel,
  getAssistantTaskItems,
  postAssistantMemoryItemForget,
  postAssistantTaskItemDisable,
  postAssistantTaskItemCancel,
  getWorkspaceMemoryItems,
  addWorkspaceMemoryItem,
  forgetWorkspaceMemoryItem,
  searchWorkspaceMemory,
  uploadAssistantAvatar,
  type WorkspaceMemoryItem
} from "../assistant-api-client";
import { AssistantAvatar } from "./assistant-avatar";

const TRAIT_SLIDERS = [
  { key: "formality", labelLeft: "Casual", labelRight: "Formal" },
  { key: "verbosity", labelLeft: "Concise", labelRight: "Detailed" },
  { key: "playfulness", labelLeft: "Serious", labelRight: "Playful" },
  { key: "initiative", labelLeft: "Reactive", labelRight: "Proactive" },
  { key: "warmth", labelLeft: "Neutral", labelRight: "Warm" }
] as const;

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

const AVATAR_EMOJIS = ["🌟", "🧠", "⚡", "🧘", "🤖", "🌙", "🔥", "🔮", "🌊", "💎", "✨", "🪐"];

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
  const router = useRouter();
  const { getToken } = useAuth();
  const assistant = data.assistant;
  const statusCfg = STATUS_LABELS[data.assistantStatus] ?? STATUS_LABELS.none!;

  const version = assistant?.latestPublishedVersion ?? null;
  const [draftName, setDraftName] = useState(assistant?.draft.displayName ?? "");
  const [draftInstructions, setDraftInstructions] = useState(assistant?.draft.instructions ?? "");
  const [editingPersonality, setEditingPersonality] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFb, setSaveFb] = useState<ActionFeedback>(null);

  const [draftTraits, setDraftTraits] = useState<Record<string, number>>(
    (assistant?.draft.traits as Record<string, number> | null) ?? {
      formality: 50,
      verbosity: 50,
      playfulness: 50,
      initiative: 50,
      warmth: 50
    }
  );
  const [draftAvatarEmoji, setDraftAvatarEmoji] = useState<string | null>(
    assistant?.draft.avatarEmoji ?? null
  );
  const [draftAvatarUrl, setDraftAvatarUrl] = useState<string | null>(
    assistant?.draft.avatarUrl ?? null
  );
  const [avatarPreviewBlobUrl, setAvatarPreviewBlobUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackConfirm, setRollbackConfirm] = useState(false);
  const [rollbackFb, setRollbackFb] = useState<ActionFeedback>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetFb, setResetFb] = useState<ActionFeedback>(null);

  const [memoryItems, setMemoryItems] = useState<AssistantMemoryRegistryItemState[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [forgettingId, setForgettingId] = useState<string | null>(null);

  const [wsMemoryItems, setWsMemoryItems] = useState<WorkspaceMemoryItem[]>([]);
  const [wsMemoryLoading, setWsMemoryLoading] = useState(false);
  const [wsMemorySearch, setWsMemorySearch] = useState("");
  const [wsMemoryAdding, setWsMemoryAdding] = useState(false);
  const [wsNewMemory, setWsNewMemory] = useState("");
  const [wsForgettingId, setWsForgettingId] = useState<string | null>(null);
  const [memoryTab, setMemoryTab] = useState<"workspace" | "registry">("workspace");

  const [taskItems, setTaskItems] = useState<AssistantTaskRegistryItemState[]>([]);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskActionId, setTaskActionId] = useState<string | null>(null);
  const [notificationChannel, setNotificationChannel] =
    useState<AssistantPreferredNotificationChannel>("web");
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationFb, setNotificationFb] = useState<ActionFeedback>(null);

  useEffect(() => {
    setDraftName(assistant?.draft.displayName ?? "");
    setDraftInstructions(assistant?.draft.instructions ?? "");
    const t = assistant?.draft.traits as Record<string, number> | null | undefined;
    if (t) setDraftTraits(t);
    setDraftAvatarEmoji(assistant?.draft.avatarEmoji ?? null);
    setDraftAvatarUrl(assistant?.draft.avatarUrl ?? null);
    setAvatarPreviewBlobUrl(null);
  }, [assistant]);

  useEffect(() => {
    setNotificationChannel(data.notificationPreference?.selectedChannel ?? "web");
  }, [data.notificationPreference]);

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

  const loadWsMemory = useCallback(
    async (query?: string) => {
      const token = await getToken();
      if (!token) return;
      setWsMemoryLoading(true);
      try {
        const items = query
          ? await searchWorkspaceMemory(token, query)
          : await getWorkspaceMemoryItems(token);
        setWsMemoryItems(items);
      } catch {
        /* non-critical */
      }
      setWsMemoryLoading(false);
    },
    [getToken]
  );

  const handleAddWsMemory = useCallback(async () => {
    const token = await getToken();
    if (!token || !wsNewMemory.trim()) return;
    setWsMemoryAdding(true);
    try {
      const item = await addWorkspaceMemoryItem(token, wsNewMemory.trim());
      setWsMemoryItems((prev) => [...prev, item]);
      setWsNewMemory("");
    } catch {
      /* non-critical */
    }
    setWsMemoryAdding(false);
  }, [getToken, wsNewMemory]);

  const handleForgetWsMemory = useCallback(
    async (itemId: string) => {
      const token = await getToken();
      if (!token) return;
      setWsForgettingId(itemId);
      try {
        await forgetWorkspaceMemoryItem(token, itemId);
        setWsMemoryItems((prev) => prev.filter((m) => m.id !== itemId));
      } catch {
        /* non-critical */
      }
      setWsForgettingId(null);
    },
    [getToken]
  );

  useEffect(() => {
    if (assistant) {
      void loadMemory();
      void loadTasks();
      void loadWsMemory();
    }
  }, [assistant, loadMemory, loadTasks, loadWsMemory]);

  const handleSaveAndApply = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    setSaving(true);
    setSaveFb(null);
    try {
      await patchAssistantDraft(token, {
        displayName: draftName || null,
        instructions: draftInstructions || null,
        traits: draftTraits,
        avatarEmoji: draftAvatarEmoji,
        avatarUrl: draftAvatarUrl
      });
      await postAssistantPublish(token);
      setSaveFb({ type: "ok", text: "Saved and applied." });
      data.reload();
    } catch (e) {
      setSaveFb({ type: "err", text: e instanceof Error ? e.message : "Save failed." });
    }
    setSaving(false);
  }, [getToken, draftName, draftInstructions, draftTraits, draftAvatarEmoji, draftAvatarUrl, data]);

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
      router.replace("/app/setup");
    } catch (e) {
      setResetFb({ type: "err", text: e instanceof Error ? e.message : "Reset failed." });
      setResetting(false);
    }
  }, [getToken, router]);

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
    async (itemId: string, action: "disable" | "cancel") => {
      const token = await getToken();
      if (!token) return;
      setTaskActionId(itemId);
      try {
        if (action === "disable") await postAssistantTaskItemDisable(token, itemId);
        else await postAssistantTaskItemCancel(token, itemId);
        await loadTasks();
      } catch {
        /* non-critical */
      }
      setTaskActionId(null);
    },
    [getToken, loadTasks]
  );

  const handleNotificationPreferenceChange = useCallback(
    async (channel: AssistantPreferredNotificationChannel) => {
      const token = await getToken();
      if (!token) return;
      setNotificationSaving(true);
      setNotificationFb(null);
      try {
        const updated = await patchAssistantNotificationPreference(token, channel);
        setNotificationChannel(updated.selectedChannel);
        setNotificationFb({ type: "ok", text: "Reminder delivery channel updated." });
        data.reload();
      } catch (error) {
        setNotificationFb({
          type: "err",
          text: error instanceof Error ? error.message : "Failed to update reminder delivery."
        });
      }
      setNotificationSaving(false);
    },
    [getToken, data]
  );

  if (resetting) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-accent" />
        <p className="text-sm font-medium text-text-muted">Resetting assistant...</p>
        <p className="text-xs text-text-subtle">
          Clearing chats, memory, and settings. This may take a few seconds.
        </p>
      </div>
    );
  }

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
          <button
            type="button"
            onClick={() => setEmojiPickerOpen((o) => !o)}
            className="flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-accent/15 text-3xl overflow-hidden transition-colors hover:bg-accent/25"
            title="Change avatar"
          >
            {avatarUploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
            ) : avatarPreviewBlobUrl ? (
              <img src={avatarPreviewBlobUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : draftAvatarUrl ? (
              <AssistantAvatar avatarUrl={draftAvatarUrl} size="md" />
            ) : (
              draftAvatarEmoji || <Sparkles className="h-7 w-7 text-accent" />
            )}
          </button>
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
        {emojiPickerOpen && (
          <div className="mt-2 grid grid-cols-6 gap-1 rounded-lg border border-border bg-surface-raised p-2">
            {AVATAR_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => {
                  setDraftAvatarEmoji(em);
                  setDraftAvatarUrl(null);
                  setEmojiPickerOpen(false);
                }}
                className={cn(
                  "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-xl transition-colors",
                  draftAvatarEmoji === em && !draftAvatarUrl
                    ? "bg-accent/20 ring-1 ring-accent"
                    : "hover:bg-surface-hover"
                )}
              >
                {em}
              </button>
            ))}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-colors",
                draftAvatarUrl
                  ? "bg-accent/20 ring-1 ring-accent"
                  : "hover:bg-surface-hover text-text-subtle"
              )}
              title="Upload image"
            >
              <Upload className="h-4 w-4" />
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file || !file.type.startsWith("image/")) return;
            const localBlob = URL.createObjectURL(file);
            setAvatarPreviewBlobUrl(localBlob);
            setDraftAvatarEmoji(null);
            setEmojiPickerOpen(false);
            setAvatarUploading(true);
            void (async () => {
              try {
                const token = await getToken();
                if (!token) return;
                const result = await uploadAssistantAvatar(token, file);
                setDraftAvatarUrl(result.avatarUrl);
              } catch {
                setSaveFb({ type: "err", text: "Avatar upload failed." });
                setAvatarPreviewBlobUrl(null);
              } finally {
                setAvatarUploading(false);
              }
            })();
          }}
        />

        <div className="mt-3 flex items-center gap-2">
          <ActionButton
            icon={<Rocket className="h-3.5 w-3.5" />}
            label="Save and apply"
            onClick={() => void handleSaveAndApply()}
            busy={saving}
          />
          <ActionButton
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label={editingPersonality ? "Hide personality" : "Edit personality"}
            onClick={() => setEditingPersonality(!editingPersonality)}
            busy={false}
          />
        </div>
        <FeedbackLine fb={saveFb} />

        {editingPersonality && (
          <>
            <div className="mt-3 space-y-3">
              {TRAIT_SLIDERS.map(({ key, labelLeft, labelRight }) => (
                <div key={key}>
                  <div className="flex justify-between text-[11px] text-text-muted mb-1">
                    <span>{labelLeft}</span>
                    <span>{labelRight}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={draftTraits[key] ?? 50}
                    onChange={(e) =>
                      setDraftTraits((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                    }
                    className="w-full accent-accent"
                  />
                </div>
              ))}
            </div>
            <textarea
              value={draftInstructions}
              onChange={(e) => setDraftInstructions(e.target.value)}
              placeholder="Custom instructions (optional)..."
              rows={4}
              className="mt-3 w-full resize-y rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
            />
          </>
        )}
      </Section>

      {/* 2. Quick actions */}
      <Section icon={<Rocket className="h-4 w-4" />} title="Quick actions">
        {version && (
          <p className="mb-3 text-xs text-text-muted">
            Version {version.version} · Apply: {assistant.runtimeApply.status}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
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
        <FeedbackLine fb={rollbackFb} />
        <FeedbackLine fb={resetFb} />
      </Section>

      {/* 3. Memory */}
      <Section icon={<Brain className="h-4 w-4" />} title="Memory" defaultOpen={false}>
        <div className="mb-3 flex gap-1 rounded-lg bg-surface p-0.5">
          {(["workspace", "registry"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMemoryTab(tab)}
              className={cn(
                "flex-1 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                memoryTab === tab
                  ? "bg-surface-raised text-text shadow-sm"
                  : "text-text-muted hover:text-text"
              )}
            >
              {tab === "workspace" ? "Workspace" : "History"}
            </button>
          ))}
        </div>

        {memoryTab === "workspace" && (
          <>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={wsMemorySearch}
                onChange={(e) => setWsMemorySearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadWsMemory(wsMemorySearch || undefined);
                }}
                placeholder="Search memories..."
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-xs text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
              />
              <button
                type="button"
                onClick={() => void loadWsMemory(wsMemorySearch || undefined)}
                className="shrink-0 cursor-pointer rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
              >
                Search
              </button>
            </div>

            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={wsNewMemory}
                onChange={(e) => setWsNewMemory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAddWsMemory();
                }}
                placeholder="Teach something new..."
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-xs text-text placeholder:text-text-subtle outline-none focus:border-border-strong"
              />
              <button
                type="button"
                disabled={wsMemoryAdding || !wsNewMemory.trim()}
                onClick={() => void handleAddWsMemory()}
                className="shrink-0 cursor-pointer rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
              >
                {wsMemoryAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
              </button>
            </div>

            {wsMemoryLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
              </div>
            ) : wsMemoryItems.length === 0 ? (
              <p className="text-xs text-text-subtle">No workspace memories yet.</p>
            ) : (
              <ul className="space-y-2">
                {wsMemoryItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-2 rounded-lg bg-surface-raised p-3"
                  >
                    <p className="min-w-0 flex-1 text-xs leading-relaxed text-text-muted whitespace-pre-wrap">
                      {item.content}
                    </p>
                    <button
                      type="button"
                      disabled={wsForgettingId === item.id}
                      onClick={() => void handleForgetWsMemory(item.id)}
                      className="shrink-0 cursor-pointer rounded p-1 text-text-subtle transition-colors hover:bg-surface-hover hover:text-destructive disabled:cursor-default disabled:opacity-50"
                      title="Forget"
                    >
                      {wsForgettingId === item.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {memoryTab === "registry" && (
          <>
            {memoryLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
              </div>
            ) : memoryItems.length === 0 ? (
              <p className="text-xs text-text-subtle">No memories stored yet.</p>
            ) : (
              <ul className="space-y-2">
                {memoryItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-2 rounded-lg bg-surface-raised p-3"
                  >
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
          </>
        )}
      </Section>

      {/* 4. Tasks */}
      <Section icon={<ListTodo className="h-4 w-4" />} title="Tasks" defaultOpen={false}>
        {taskLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
          </div>
        ) : taskItems.filter((item) => item.controlStatus === "active").length === 0 ? (
          <p className="text-xs text-text-subtle">No current tasks right now.</p>
        ) : (
          <ul className="space-y-2">
            {taskItems
              .filter((item) => item.controlStatus === "active")
              .map((item) => (
                <li key={item.id} className="rounded-lg bg-surface-raised p-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">
                      {item.title}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        "bg-success/15 text-success"
                      )}
                    >
                      {item.controlStatus}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <ActionButton
                      icon={<RotateCcw className="h-3 w-3" />}
                      label="Disable"
                      onClick={() => void handleTaskAction(item.id, "disable")}
                      busy={taskActionId === item.id}
                    />
                    <ActionButton
                      icon={<Trash2 className="h-3 w-3" />}
                      label="Cancel"
                      variant="danger"
                      onClick={() => void handleTaskAction(item.id, "cancel")}
                      busy={taskActionId === item.id}
                    />
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
        <div className="mt-4 rounded-xl border border-border bg-surface-raised/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-text">Reminder delivery</p>
              <p className="mt-1 text-[11px] text-text-subtle">
                PersAI sends reminders to the preferred connected channel and falls back if it is
                unavailable.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(data.notificationPreference?.availableChannels ?? ["web"]).map((channel) => {
              const active = notificationChannel === channel;
              return (
                <button
                  key={channel}
                  type="button"
                  disabled={notificationSaving}
                  onClick={() => void handleNotificationPreferenceChange(channel)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-50",
                    active
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-background text-text-muted hover:bg-surface-hover"
                  )}
                >
                  {formatNotificationChannelLabel(channel)}
                </button>
              );
            })}
          </div>
          <FeedbackLine fb={notificationFb} />
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

function formatNotificationChannelLabel(channel: AssistantPreferredNotificationChannel): string {
  if (channel === "telegram") return "Telegram";
  if (channel === "whatsapp") return "WhatsApp";
  return "Web";
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
