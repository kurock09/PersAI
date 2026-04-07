"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode
} from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Activity,
  Bot,
  Check,
  Copy,
  Loader2,
  RefreshCw,
  RotateCcw,
  Server,
  AlertTriangle,
  Info,
  Search,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Users,
  Gauge
} from "lucide-react";
import {
  type AdminOpsCockpitState,
  type AdminPlanState,
  type AdminOpsIncidentSignal,
  AdminOpsIncidentSignalSeverity,
  AssistantRuntimeApplyStatus,
  type AssistantRuntimeApplyStatus as ApplyStatus
} from "@persai/contracts";
import {
  deleteAdminOpsUserWorkspaceSubscription,
  deleteAdminOpsUserPlanOverride,
  getAdminPlans,
  postAdminOpsUserWorkspaceSubscription,
  postAdminOpsUserPlanOverride,
  postAssistantReapply
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OpsUserRow {
  userId: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  assistant: {
    id: string;
    draftDisplayName: string | null;
    draftAssistantGender: string | null;
    applyStatus: string;
    latestPublishedVersion: number | null;
    lastPublishedAt: string | null;
  } | null;
}

type QuotaUsageData = {
  tokenBudgetUsed: number;
  tokenBudgetLimit: number | null;
  mediaStorageBytesUsed: number;
  mediaStorageBytesLimit: number | null;
  activeWebChats: number;
  activeWebChatsLimit: number | null;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTs(iso: string | null | undefined): string {
  if (iso == null || iso === "") return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" });
  } catch {
    return iso;
  }
}

function formatShortDate(iso: string | null | undefined): string {
  if (iso == null || iso === "") return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "short" });
  } catch {
    return iso;
  }
}

function formatNullable(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function truncateId(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function applyStatusTone(status: string): string {
  switch (status) {
    case "succeeded":
      return "bg-success/15 text-success";
    case "failed":
      return "bg-destructive/15 text-destructive";
    case "in_progress":
      return "bg-warning/15 text-warning";
    case "degraded":
      return "bg-orange-400/15 text-orange-400";
    default:
      return "bg-surface text-text-muted";
  }
}

function applyStatusBorderTone(status: ApplyStatus): string {
  switch (status) {
    case AssistantRuntimeApplyStatus.succeeded:
      return "border-success/35 bg-success/10 text-success";
    case AssistantRuntimeApplyStatus.failed:
      return "border-destructive/35 bg-destructive/10 text-destructive";
    case AssistantRuntimeApplyStatus.in_progress:
      return "border-warning/40 bg-warning/10 text-warning";
    case AssistantRuntimeApplyStatus.degraded:
      return "border-orange-400/35 bg-orange-400/10 text-orange-400";
    default:
      return "border-border bg-surface text-text-muted";
  }
}

function incidentSeverityTone(severity: AdminOpsIncidentSignal["severity"]): string {
  switch (severity) {
    case AdminOpsIncidentSignalSeverity.high:
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case AdminOpsIncidentSignalSeverity.elevated:
      return "border-warning/35 bg-warning/10 text-warning";
    default:
      return "border-blue-500/25 bg-blue-500/10 text-blue-300";
  }
}

/* ------------------------------------------------------------------ */
/*  Shared small components                                            */
/* ------------------------------------------------------------------ */

function PreflightDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          ok ? "bg-success shadow-[0_0_6px_rgba(34,197,94,0.45)]" : "bg-destructive"
        )}
        aria-hidden
      />
      <span className="text-text-muted">{label}</span>
      <span className={cn("font-medium", ok ? "text-success" : "text-destructive")}>
        {ok ? "Yes" : "No"}
      </span>
    </div>
  );
}

function CardShell({
  title,
  icon: Icon,
  children
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface-raised p-3.5">
      <div className="mb-3 flex items-center gap-2 border-b border-border pb-2">
        <Icon className="h-3.5 w-3.5 text-accent" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text">{title}</h2>
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-2 gap-y-0.5 text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="min-w-0 break-all text-right font-mono text-text">{value}</span>
    </div>
  );
}

function CopyableDetailRow({
  label,
  value,
  copyValue
}: {
  label: string;
  value: ReactNode;
  copyValue: string | null | undefined;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [copyValue]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-2 gap-y-0.5 text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-1.5">
        <span className="min-w-0 break-all text-right font-mono text-text">{value}</span>
        {copyValue ? (
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded border border-border p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            aria-label={`Copy ${label}`}
            title={`Copy ${label}`}
          >
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          </button>
        ) : null}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Quota Usage Card                                                   */
/* ------------------------------------------------------------------ */

function QuotaBar({
  label,
  used,
  limit,
  formatValue
}: {
  label: string;
  used: number;
  limit: number | null;
  formatValue: (v: number) => string;
}) {
  const percent = limit !== null && limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const barColor = percent >= 90 ? "bg-destructive" : percent >= 70 ? "bg-warning" : "bg-accent";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-text">{label}</span>
        <span className="tabular-nums text-text-muted">
          {formatValue(used)}
          {limit !== null ? ` / ${formatValue(limit)}` : ""}
        </span>
      </div>
      {limit !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div
            className={cn("h-full rounded-full transition-[width] duration-300", barColor)}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

function formatStorageMb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/*  Users Directory                                                    */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 5;

function UsersDirectory({
  getToken,
  selectedUserId,
  onSelectUser
}: {
  getToken: () => Promise<string | null>;
  selectedUserId: string | null;
  onSelectUser: (userId: string, email: string) => void;
}) {
  const [users, setUsers] = useState<OpsUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [reapplyingId, setReapplyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (q: string, off: number) => {
      const token = await getToken();
      if (!token) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({ offset: String(off), limit: String(PAGE_SIZE) });
        if (q) params.set("q", q);
        const res = await fetch(`/api/v1/admin/ops/users?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as { users: OpsUserRow[]; total: number };
        setUsers(data.users);
        setTotal(data.total);
      } catch {
        setUsers([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [getToken]
  );

  useEffect(() => {
    void load("", 0);
  }, [load]);

  const onSearch = useCallback(
    (val: string) => {
      setSearch(val);
      setOffset(0);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void load(val.trim(), 0), 300);
    },
    [load]
  );

  const onPage = useCallback(
    (dir: -1 | 1) => {
      const next = Math.max(0, offset + dir * PAGE_SIZE);
      setOffset(next);
      void load(search.trim(), next);
    },
    [offset, search, load]
  );

  const onReapply = useCallback(
    async (userId: string) => {
      const token = await getToken();
      if (!token) return;
      setReapplyingId(userId);
      try {
        await fetch(`/api/v1/admin/ops/users/${userId}/reapply`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        await load(search.trim(), offset);
      } finally {
        setReapplyingId(null);
      }
    },
    [getToken, load, search, offset]
  );

  const onDelete = useCallback(
    async (userId: string) => {
      const token = await getToken();
      if (!token) return;
      setDeletingId(userId);
      try {
        const res = await fetch(`/api/v1/admin/ops/users/${userId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          alert(`Delete failed: ${res.status}\n${body}`);
          return;
        }
        setConfirmDeleteId(null);
        await load(search.trim(), offset);
      } finally {
        setDeletingId(null);
      }
    },
    [getToken, load, search, offset]
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <section className="rounded-lg border border-border bg-surface-raised p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-accent" />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text">
            User Directory
          </h2>
          <span className="text-[10px] text-text-subtle">{total} total</span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search email or name…"
            className="h-7 w-48 rounded border border-border bg-bg pl-6 pr-2 text-[11px] text-text placeholder:text-text-subtle focus:border-accent/50 focus:outline-none"
          />
        </div>
      </div>

      {loading && users.length === 0 ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
        </div>
      ) : users.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-muted">No users found.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-left text-text-muted">
                  <th className="pb-1.5 pr-2 font-medium">Email</th>
                  <th className="pb-1.5 pr-2 font-medium">Name</th>
                  <th className="pb-1.5 pr-2 font-medium">Assistant</th>
                  <th className="pb-1.5 pr-2 font-medium">Gender</th>
                  <th className="pb-1.5 pr-2 font-medium">Status</th>
                  <th className="pb-1.5 pr-2 font-medium">Published</th>
                  <th className="pb-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.userId}
                    onClick={() => onSelectUser(u.userId, u.email)}
                    className={cn(
                      "cursor-pointer border-b border-border/50 transition-colors hover:bg-surface-hover/50",
                      selectedUserId === u.userId && "bg-accent/10 hover:bg-accent/15"
                    )}
                  >
                    <td className="max-w-[160px] truncate py-1.5 pr-2 font-mono text-text">
                      {u.email}
                    </td>
                    <td className="max-w-[100px] truncate py-1.5 pr-2 text-text-muted">
                      {u.displayName || "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-text">
                      {u.assistant?.draftDisplayName || "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-text-muted">
                      {u.assistant?.draftAssistantGender || "—"}
                    </td>
                    <td className="py-1.5 pr-2">
                      {u.assistant ? (
                        <span
                          className={cn(
                            "inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                            applyStatusTone(u.assistant.applyStatus)
                          )}
                        >
                          {u.assistant.applyStatus.replace(/_/g, " ")}
                        </span>
                      ) : (
                        <span className="text-text-subtle">—</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-text-muted">
                      {u.assistant?.latestPublishedVersion
                        ? `v${u.assistant.latestPublishedVersion} · ${formatShortDate(u.assistant.lastPublishedAt)}`
                        : "—"}
                    </td>
                    <td className="py-1.5 text-right">
                      {u.assistant && (
                        <button
                          type="button"
                          disabled={reapplyingId === u.userId}
                          onClick={() => void onReapply(u.userId)}
                          className="inline-flex cursor-pointer items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[9px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-40"
                        >
                          {reapplyingId === u.userId ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-2.5 w-2.5" />
                          )}
                          Reapply
                        </button>
                      )}
                      {confirmDeleteId === u.userId ? (
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            disabled={deletingId === u.userId}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onDelete(u.userId);
                            }}
                            className="rounded bg-destructive/90 px-1.5 py-0.5 text-[9px] font-semibold text-white transition-colors hover:bg-destructive disabled:opacity-40"
                          >
                            {deletingId === u.userId ? (
                              <Loader2 className="inline h-2.5 w-2.5 animate-spin" />
                            ) : (
                              "Yes"
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(null);
                            }}
                            className="rounded border border-border px-1.5 py-0.5 text-[9px] text-text-muted hover:text-text"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(u.userId);
                          }}
                          className="inline-flex cursor-pointer items-center gap-1 rounded border border-destructive/30 px-1.5 py-0.5 text-[9px] font-medium text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-text-subtle">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => onPage(-1)}
                className="cursor-pointer rounded p-0.5 text-text-muted transition-colors hover:text-text disabled:opacity-30"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] text-text-muted">
                {currentPage}/{totalPages}
              </span>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => onPage(1)}
                className="cursor-pointer rounded p-0.5 text-text-muted transition-colors hover:text-text disabled:opacity-30"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

async function fetchCockpit(token: string, userId?: string): Promise<AdminOpsCockpitState> {
  const params = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  const res = await fetch(`/api/v1/admin/ops/cockpit${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const data = (await res.json()) as { cockpit: AdminOpsCockpitState };
  return data.cockpit;
}

export default function AdminOpsPage() {
  const { getToken } = useAuth();
  const [cockpit, setCockpit] = useState<AdminOpsCockpitState | null>(null);
  const [plans, setPlans] = useState<AdminPlanState[]>([]);
  const cockpitRef = useRef<AdminOpsCockpitState | null>(null);
  cockpitRef.current = cockpit;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [reapplyBusy, setReapplyBusy] = useState(false);
  const [planOverrideBusy, setPlanOverrideBusy] = useState(false);
  const [workspaceSubscriptionBusy, setWorkspaceSubscriptionBusy] = useState(false);
  const [selectedPlanCode, setSelectedPlanCode] = useState("");
  const [planSelectionDirty, setPlanSelectionDirty] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserLabel, setSelectedUserLabel] = useState<string | null>(null);
  const selectedUserIdRef = useRef<string | null>(null);
  selectedUserIdRef.current = selectedUserId;

  const load = useCallback(
    async (targetUserId?: string) => {
      const token = await getToken();
      if (!token) {
        setLoadError("Not signed in.");
        setCockpit(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      setLoadError(null);
      const incremental = cockpitRef.current !== null;
      if (incremental) setRefreshing(true);
      else setLoading(true);
      try {
        const activeTarget = targetUserId ?? selectedUserIdRef.current ?? undefined;
        const [nextCockpit, nextPlans] = await Promise.all([
          fetchCockpit(token, activeTarget),
          getAdminPlans(token)
        ]);
        setCockpit(nextCockpit);
        setPlans(nextPlans.filter((plan) => plan.status === "active"));
      } catch (e) {
        setCockpit(null);
        setPlans([]);
        setLoadError(e instanceof Error ? e.message : "Unable to load ops data.");
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

  useEffect(() => {
    const overrideCode = cockpit?.assistant.effectivePlan.assistantPlanOverrideCode ?? "";
    if (!planSelectionDirty || overrideCode !== "") {
      setSelectedPlanCode(overrideCode);
      setPlanSelectionDirty(false);
    }
  }, [cockpit?.assistant.effectivePlan.assistantPlanOverrideCode, planSelectionDirty]);

  const onSelectUser = useCallback(
    (userId: string, email: string) => {
      setSelectedUserId(userId);
      setSelectedUserLabel(email);
      setActionMessage(null);
      setPlanSelectionDirty(false);
      void load(userId);
    },
    [load]
  );

  const onReapply = useCallback(async () => {
    if (!cockpit?.controls.reapplySupported) return;
    setActionMessage(null);
    const token = await getToken();
    if (!token) {
      setActionMessage("Not signed in.");
      return;
    }
    setReapplyBusy(true);
    try {
      if (selectedUserId) {
        await fetch(`/api/v1/admin/ops/users/${selectedUserId}/reapply`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
      } else {
        await postAssistantReapply(token);
      }
      setActionMessage("Reapply completed.");
      await load();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Reapply failed.");
    } finally {
      setReapplyBusy(false);
    }
  }, [cockpit?.controls.reapplySupported, getToken, load, selectedUserId]);

  const onRestart = useCallback(() => {
    setActionMessage("Runtime restart is not wired in this admin UI yet.");
  }, []);

  const onApplyPlanOverride = useCallback(async () => {
    if (!selectedUserId || !cockpit?.controls.assistantPlanOverrideSupported) {
      setActionMessage("Select a user assistant first.");
      return;
    }
    if (!selectedPlanCode) {
      setActionMessage("Choose a target plan first.");
      return;
    }
    const token = await getToken();
    if (!token) {
      setActionMessage("Not signed in.");
      return;
    }
    setPlanOverrideBusy(true);
    setActionMessage(null);
    try {
      await postAdminOpsUserPlanOverride(token, selectedUserId, { planCode: selectedPlanCode });
      setActionMessage("Assistant test override applied.");
      await load(selectedUserId);
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Failed to apply assistant plan override.");
    } finally {
      setPlanOverrideBusy(false);
    }
  }, [
    cockpit?.controls.assistantPlanOverrideSupported,
    getToken,
    load,
    selectedPlanCode,
    selectedUserId
  ]);

  const onResetPlanOverride = useCallback(async () => {
    if (!selectedUserId || !cockpit?.controls.assistantPlanResetSupported) {
      setActionMessage("No assistant plan override is active.");
      return;
    }
    const token = await getToken();
    if (!token) {
      setActionMessage("Not signed in.");
      return;
    }
    setPlanOverrideBusy(true);
    setActionMessage(null);
    try {
      await deleteAdminOpsUserPlanOverride(token, selectedUserId);
      setActionMessage("Assistant returned to normal billing plan resolution.");
      await load(selectedUserId);
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Failed to reset assistant plan override.");
    } finally {
      setPlanOverrideBusy(false);
    }
  }, [cockpit?.controls.assistantPlanResetSupported, getToken, load, selectedUserId]);

  const onApplyWorkspaceSubscription = useCallback(async () => {
    if (!selectedUserId) {
      setActionMessage("Select a user assistant first.");
      return;
    }
    if (!selectedPlanCode) {
      setActionMessage("Choose a target plan first.");
      return;
    }
    const token = await getToken();
    if (!token) {
      setActionMessage("Not signed in.");
      return;
    }
    setWorkspaceSubscriptionBusy(true);
    setActionMessage(null);
    try {
      await postAdminOpsUserWorkspaceSubscription(token, selectedUserId, {
        planCode: selectedPlanCode
      });
      setActionMessage("Workspace subscription snapshot applied for live propagation check.");
      await load(selectedUserId);
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Failed to apply workspace subscription.");
    } finally {
      setWorkspaceSubscriptionBusy(false);
    }
  }, [getToken, load, selectedPlanCode, selectedUserId]);

  const onResetWorkspaceSubscription = useCallback(async () => {
    if (!selectedUserId) {
      setActionMessage("Select a user assistant first.");
      return;
    }
    const token = await getToken();
    if (!token) {
      setActionMessage("Not signed in.");
      return;
    }
    setWorkspaceSubscriptionBusy(true);
    setActionMessage(null);
    try {
      await deleteAdminOpsUserWorkspaceSubscription(token, selectedUserId);
      setActionMessage("Workspace subscription snapshot removed.");
      await load(selectedUserId);
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Failed to reset workspace subscription.");
    } finally {
      setWorkspaceSubscriptionBusy(false);
    }
  }, [getToken, load, selectedUserId]);

  if (loading && cockpit === null) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-accent" />
          <h1 className="text-lg font-bold tracking-tight text-text">Ops Cockpit</h1>
          {selectedUserLabel && (
            <span className="rounded bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">
              {selectedUserLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedUserId && (
            <button
              type="button"
              onClick={() => {
                setSelectedUserId(null);
                setSelectedUserLabel(null);
                setActionMessage(null);
                setPlanSelectionDirty(false);
                void load(undefined);
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[10px] font-medium text-text-muted transition-colors hover:bg-surface-hover"
            >
              Show self
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing || loading}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text transition-colors",
              "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </button>
        </div>
      </header>

      {loadError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {loadError}
        </p>
      )}

      {/* Users directory */}
      <UsersDirectory
        getToken={getToken}
        selectedUserId={selectedUserId}
        onSelectUser={onSelectUser}
      />

      {cockpit && (
        <>
          {/* --- Row 1: three balanced columns --- */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
            {/* Col 1: Assistant identity */}
            <CardShell title="Assistant" icon={Bot}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">Exists</span>
                <span
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    cockpit.assistant.exists
                      ? "bg-success/15 text-success"
                      : "bg-surface text-text-muted ring-1 ring-border"
                  )}
                >
                  {cockpit.assistant.exists ? "Yes" : "No"}
                </span>
              </div>
              <CopyableDetailRow
                label="ID"
                value={truncateId(cockpit.assistant.assistantId)}
                copyValue={cockpit.assistant.assistantId}
              />
              <CopyableDetailRow
                label="Workspace"
                value={truncateId(cockpit.assistant.workspaceId)}
                copyValue={cockpit.assistant.workspaceId}
              />
              <div className="border-t border-border pt-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Effective plan
                </p>
                <DetailRow
                  label="Plan"
                  value={formatNullable(cockpit.assistant.effectivePlan.code)}
                />
                <DetailRow
                  label="Source"
                  value={cockpit.assistant.effectivePlan.source.replaceAll("_", " ")}
                />
                <DetailRow
                  label="Override"
                  value={formatNullable(cockpit.assistant.effectivePlan.assistantPlanOverrideCode)}
                />
                <DetailRow
                  label="Fallback"
                  value={formatNullable(cockpit.assistant.effectivePlan.quotaPlanCode)}
                />
              </div>
              <div className="border-t border-border pt-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Published
                </p>
                <DetailRow
                  label="Version"
                  value={formatNullable(cockpit.assistant.latestPublishedVersion.version)}
                />
                <DetailRow
                  label="At"
                  value={formatTs(cockpit.assistant.latestPublishedVersion.publishedAt)}
                />
              </div>
            </CardShell>

            {/* Col 2: Apply status */}
            <CardShell title="Apply" icon={RotateCcw}>
              {cockpit.assistant.runtimeApply === null ? (
                <p className="text-xs text-text-muted">No apply state</p>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-text-muted">Status</span>
                    <span
                      className={cn(
                        "rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        applyStatusBorderTone(cockpit.assistant.runtimeApply.status)
                      )}
                    >
                      {cockpit.assistant.runtimeApply.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <CopyableDetailRow
                    label="Target"
                    value={truncateId(cockpit.assistant.runtimeApply.targetPublishedVersionId)}
                    copyValue={cockpit.assistant.runtimeApply.targetPublishedVersionId}
                  />
                  <CopyableDetailRow
                    label="Applied"
                    value={truncateId(cockpit.assistant.runtimeApply.appliedPublishedVersionId)}
                    copyValue={cockpit.assistant.runtimeApply.appliedPublishedVersionId}
                  />
                  <DetailRow
                    label="Requested"
                    value={formatTs(cockpit.assistant.runtimeApply.requestedAt)}
                  />
                  <DetailRow
                    label="Finished"
                    value={formatTs(cockpit.assistant.runtimeApply.finishedAt)}
                  />
                  {cockpit.assistant.runtimeApply.error && (
                    <div className="mt-1 rounded border border-destructive/25 bg-destructive/5 p-1.5 text-[10px] text-destructive">
                      <span className="font-mono font-semibold">
                        {formatNullable(cockpit.assistant.runtimeApply.error.code)}
                      </span>
                      {cockpit.assistant.runtimeApply.error.message && (
                        <p className="mt-0.5 text-text-muted">
                          {cockpit.assistant.runtimeApply.error.message}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardShell>

            {/* Col 3: Runtime */}
            <CardShell title="Runtime" icon={Server}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">Adapter</span>
                <span
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    cockpit.runtime.adapterEnabled
                      ? "bg-success/15 text-success"
                      : "bg-surface text-text-muted ring-1 ring-border"
                  )}
                >
                  {cockpit.runtime.adapterEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <DetailRow label="Runtime tier" value={formatNullable(cockpit.runtime.runtimeTier)} />
              <DetailRow
                label="Runtime endpoint"
                value={formatNullable(cockpit.runtime.runtimeEndpointHost)}
              />
              <div className="border-t border-border pt-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Preflight
                </p>
                <PreflightDot ok={cockpit.runtime.preflight.live} label="Live" />
                <PreflightDot ok={cockpit.runtime.preflight.ready} label="Ready" />
                <DetailRow label="Checked" value={formatTs(cockpit.runtime.preflight.checkedAt)} />
              </div>
            </CardShell>

            <CardShell title="Plan Control" icon={Users}>
              <p className="text-[11px] leading-relaxed text-text-muted">
                Use assistant-level override only for tester/manual routing. `Reset to normal`
                returns resolution to the regular subscription chain.
              </p>
              <label className="flex flex-col gap-1 text-[11px] text-text-muted">
                <span>Tester override plan</span>
                <select
                  value={selectedPlanCode}
                  onChange={(e) => {
                    setSelectedPlanCode(e.target.value);
                    setPlanSelectionDirty(true);
                  }}
                  disabled={!selectedUserId || planOverrideBusy}
                  className="h-9 rounded border border-border bg-bg px-2 text-sm text-text focus:border-accent/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Choose plan…</option>
                  {plans.map((plan) => (
                    <option key={plan.code} value={plan.code}>
                      {plan.code} - {plan.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    !selectedUserId ||
                    !selectedPlanCode ||
                    !cockpit.controls.assistantPlanOverrideSupported ||
                    planOverrideBusy
                  }
                  onClick={() => void onApplyPlanOverride()}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium transition-colors",
                    "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                  )}
                >
                  {planOverrideBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Users className="h-3 w-3" />
                  )}
                  Apply test plan
                </button>
                <button
                  type="button"
                  disabled={
                    !selectedUserId ||
                    !cockpit.controls.assistantPlanResetSupported ||
                    planOverrideBusy
                  }
                  onClick={() => void onResetPlanOverride()}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium transition-colors",
                    "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                  )}
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset to normal
                </button>
              </div>
              <div className="border-t border-border pt-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Workspace subscription snapshot
                </p>
                <p className="mb-2 text-[11px] leading-relaxed text-text-muted">
                  Use only for `SR9e` propagation/live verification. This updates the workspace
                  subscription row and should force runtime rematerialization through
                  `configDirtyAt`.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!selectedUserId || !selectedPlanCode || workspaceSubscriptionBusy}
                    onClick={() => void onApplyWorkspaceSubscription()}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium transition-colors",
                      "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                    )}
                  >
                    {workspaceSubscriptionBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Users className="h-3 w-3" />
                    )}
                    Apply workspace subscription
                  </button>
                  <button
                    type="button"
                    disabled={!selectedUserId || workspaceSubscriptionBusy}
                    onClick={() => void onResetWorkspaceSubscription()}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium transition-colors",
                      "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                    )}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset workspace subscription
                  </button>
                </div>
              </div>
              {actionMessage && (
                <p className="rounded border border-border/60 bg-surface px-2 py-1.5 text-[10px] text-text-muted">
                  {actionMessage}
                </p>
              )}
            </CardShell>
          </div>

          {/* --- Row 1.5: Quota & Usage --- */}
          {(() => {
            const raw = cockpit as unknown as Record<string, unknown>;
            const qu = raw.quotaUsage as QuotaUsageData | null | undefined;
            if (!qu) return null;
            return (
              <CardShell title="Quota & Usage" icon={Gauge}>
                <div className="space-y-3">
                  <QuotaBar
                    label="Token Budget"
                    used={qu.tokenBudgetUsed}
                    limit={qu.tokenBudgetLimit}
                    formatValue={formatTokens}
                  />
                  <QuotaBar
                    label="Media Storage"
                    used={qu.mediaStorageBytesUsed}
                    limit={qu.mediaStorageBytesLimit}
                    formatValue={formatStorageMb}
                  />
                  <QuotaBar
                    label="Active Web Chats"
                    used={qu.activeWebChats}
                    limit={qu.activeWebChatsLimit}
                    formatValue={String}
                  />
                </div>
              </CardShell>
            );
          })()}

          {/* --- Row 1.6: Chat Stats + Channels --- */}
          {(() => {
            const raw = cockpit as unknown as Record<string, unknown>;
            const cs = raw.chatStats as
              | { totalChats: number; activeWebChats: number; archivedWebChats: number }
              | null
              | undefined;
            const ch = raw.channels as
              | Array<{ provider: string; surface: string; state: string }>
              | null
              | undefined;
            if (!cs && (!ch || ch.length === 0)) return null;
            return (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {cs && (
                  <CardShell title="Chat Stats" icon={Activity}>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-lg font-bold tabular-nums text-text">{cs.totalChats}</p>
                        <p className="text-[10px] text-text-muted">Total</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold tabular-nums text-text">
                          {cs.activeWebChats}
                        </p>
                        <p className="text-[10px] text-text-muted">Active Web</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold tabular-nums text-text">
                          {cs.archivedWebChats}
                        </p>
                        <p className="text-[10px] text-text-muted">Archived</p>
                      </div>
                    </div>
                  </CardShell>
                )}

                {ch && ch.length > 0 && (
                  <CardShell title="Channels" icon={Server}>
                    <div className="space-y-1.5">
                      {ch.map((c, i) => (
                        <div
                          key={`${c.provider}-${c.surface}-${i}`}
                          className="flex items-center justify-between rounded-md border border-border bg-surface px-2.5 py-1.5"
                        >
                          <span className="text-xs font-medium text-text">
                            {c.provider} / {c.surface}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              c.state === "active"
                                ? "bg-success/15 text-success"
                                : c.state === "inactive"
                                  ? "bg-warning/15 text-warning"
                                  : "bg-muted/15 text-text-muted"
                            )}
                          >
                            {c.state}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardShell>
                )}
              </div>
            );
          })()}

          {/* --- Row 2: Controls + Incidents side by side --- */}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <section className="rounded-lg border border-border bg-surface-raised p-3">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text">
                Controls
              </h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!cockpit.controls.reapplySupported || reapplyBusy}
                  onClick={() => void onReapply()}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium transition-colors",
                    "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                  )}
                >
                  {reapplyBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  Reapply{selectedUserId ? "" : " (self)"}
                </button>
                <button
                  type="button"
                  disabled={!cockpit.controls.restartSupported}
                  onClick={onRestart}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium transition-colors",
                    "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                  )}
                >
                  <RefreshCw className="h-3 w-3" />
                  Restart
                </button>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-surface-raised p-3">
              <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text">
                <AlertTriangle className="h-3.5 w-3.5 text-text-muted" />
                Incidents
              </h2>
              {cockpit.incidentSignals.length === 0 ? (
                <p className="text-xs text-text-muted">No active signals.</p>
              ) : (
                <ul className="space-y-1.5">
                  {cockpit.incidentSignals.map((signal, i) => (
                    <li
                      key={`${i}-${signal.code}-${signal.severity}`}
                      className={cn(
                        "rounded-md border px-2 py-1.5 text-[10px]",
                        incidentSeverityTone(signal.severity)
                      )}
                    >
                      <div className="flex items-start gap-1.5">
                        {signal.severity === AdminOpsIncidentSignalSeverity.info ? (
                          <Info className="mt-0.5 h-3 w-3 shrink-0 opacity-80" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 opacity-80" />
                        )}
                        <div className="min-w-0">
                          <span className="font-mono font-semibold">{signal.code}</span>
                          <span className="ml-1.5 opacity-80">{signal.message}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <p className="text-center text-[10px] text-text-subtle">
            Updated {formatTs(cockpit.updatedAt)}
          </p>
        </>
      )}
    </div>
  );
}
