"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode
} from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Activity,
  BarChart3,
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
  Gauge,
  ShieldAlert
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
  buildAdminFetchOptions,
  deleteAdminOpsUserPlanOverride,
  getAdminOpsCockpit,
  getAdminPlans,
  postAdminOpsUserBillingSupportAction,
  postAdminOpsUserPlanOverride,
  postAdminSafetyRestrict,
  postAdminSafetyUnblock,
  postAssistantReapply,
  usesAdminBffProxy
} from "@/app/app/assistant-api-client";
import { getAdminSessionToken, type ClerkGetToken } from "@/app/admin/admin-session";
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
  assistantCount: number;
  billing: {
    workspaceId: string | null;
    planCode: string | null;
    status: string | null;
    trialEndsAt: string | null;
    graceEndsAt: string | null;
    currentPeriodEndsAt: string | null;
    usageRisk: "unknown" | "ok" | "elevated" | "high";
  };
  safetyStatus: "none" | "safety_restricted";
  periodEconomics: {
    periodStartedAt: string;
    periodEndsAt: string;
    paidTotalMinor: number;
    paidCurrency: string | null;
    modelCostUsdMicros: number;
  } | null;
}

type QuotaUsageData = NonNullable<AdminOpsCockpitState["quotaUsage"]>;
type BillingSupportData = NonNullable<AdminOpsCockpitState["billingSupport"]>;
type ModelCostLedgerData = NonNullable<AdminOpsCockpitState["modelCostLedger"]>;

type ManualPaidBillingPeriod = "month" | "year";

export type BillingSupportAction =
  | "initialize_lifecycle_now"
  | "extend_trial"
  | "grant_grace"
  | "extend_grace"
  | "send_billing_reminder"
  | "apply_fallback_now"
  | "activate_paid_manually";

export type BillingSupportActionConfig = {
  action: BillingSupportAction;
  label: string;
  preview: string;
  confirmLabel: string;
  tone: "default" | "danger";
  requiresManualPayment?: boolean;
};

type PlanControlOption = {
  code: string;
  displayName: string;
  status: "active" | "inactive";
  selectedInactive: boolean;
};

type ManualPaidPlanOption = {
  code: string;
  displayName: string;
  defaultBillingPeriod: ManualPaidBillingPeriod;
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

export function resolveBillingNextDate(billing: OpsUserRow["billing"]): string | null {
  switch (billing.status) {
    case "trialing":
      return billing.trialEndsAt;
    case "grace_period":
      return billing.graceEndsAt ?? billing.currentPeriodEndsAt ?? billing.trialEndsAt;
    case "active":
      return billing.currentPeriodEndsAt ?? billing.trialEndsAt ?? billing.graceEndsAt;
    default:
      return billing.currentPeriodEndsAt ?? billing.graceEndsAt ?? billing.trialEndsAt;
  }
}

function formatPeriodWindow(
  startedAt: string | null | undefined,
  endsAt: string | null | undefined
): string {
  if (!startedAt && !endsAt) {
    return "—";
  }
  return `${formatTs(startedAt)} → ${formatTs(endsAt)}`;
}

function formatNullable(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function formatPaidMinor(totalMinor: number, currency: string | null): string {
  if (currency === null || currency.length === 0) {
    return totalMinor > 0 ? String(totalMinor) : "—";
  }
  const amount = totalMinor / 100;
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatCurrencyMicros(totalCostMicros: number, currency: string): string {
  const amount = totalCostMicros / 1_000_000;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(amount);
  } catch {
    return `${amount.toFixed(4)} ${currency}`;
  }
}

function formatLedgerPeriodSource(
  value: ModelCostLedgerData["periodSource"] | null | undefined
): string {
  switch (value) {
    case "subscription_period":
      return "subscription period";
    case "calendar_month_fallback":
      return "calendar-month fallback";
    case "rolling_7d":
      return "rolling 7 days";
    default:
      return "unknown";
  }
}

function truncateId(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function formatAssistantLabel(
  assistant: AdminOpsCockpitState["assistant"]["assistants"][number] | null | undefined
): string {
  if (!assistant) return "No assistant";
  return assistant.draftDisplayName?.trim() || truncateId(assistant.id);
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
    <div className="flex items-center gap-1 text-[11px]">
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          ok ? "bg-success shadow-[0_0_4px_rgba(34,197,94,.5)]" : "bg-destructive"
        )}
        aria-hidden
      />
      <span className="text-text-muted">{label}</span>
      <span className={cn("font-semibold", ok ? "text-success" : "text-destructive")}>
        {ok ? "Yes" : "No"}
      </span>
    </div>
  );
}

function CardShell({
  title,
  icon: Icon,
  children,
  tone = "default",
  compact = false,
  fillHeight = false
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  tone?: "default" | "muted";
  compact?: boolean;
  fillHeight?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded border",
        tone === "muted" ? "border-border/35 bg-surface/70" : "border-border/50 bg-surface",
        compact ? "p-2" : "p-2.5",
        fillHeight && "flex h-full flex-col"
      )}
    >
      <div className="mb-2 flex shrink-0 items-center gap-1.5">
        <Icon className="h-3 w-3 text-accent" />
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{title}</h2>
      </div>
      <div className={cn("flex flex-col gap-2", fillHeight && "flex-1")}>{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-2 gap-y-px text-[11px]">
      <span className="text-text-subtle">{label}</span>
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

function SummaryPill({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "muted";
}) {
  return (
    <div
      className={cn(
        "inline-flex min-w-[120px] items-center gap-2 rounded border px-2 py-1 text-[10px]",
        tone === "success" && "border-success/25 bg-success/10 text-success",
        tone === "warning" && "border-warning/25 bg-warning/10 text-warning",
        tone === "danger" && "border-destructive/25 bg-destructive/10 text-destructive",
        tone === "muted" && "border-border/45 bg-surface-raised text-text-muted",
        tone === "default" && "border-border/45 bg-surface-raised text-text"
      )}
    >
      <span className="uppercase tracking-wide text-text-subtle">{label}</span>
      <span className="min-w-0 truncate font-semibold">{value}</span>
    </div>
  );
}

function CopyableInlineValue({
  value,
  copyValue,
  label
}: {
  value: ReactNode;
  copyValue: string | null | undefined;
  label: string;
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
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-text">{value}</span>
      {copyValue ? (
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex cursor-pointer items-center justify-center rounded border border-border p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </button>
      ) : null}
    </span>
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
  const barColor = percent >= 90 ? "bg-destructive" : percent >= 70 ? "bg-warning" : "bg-success";
  const pctColor =
    percent >= 95 ? "text-destructive" : percent >= 75 ? "text-warning" : "text-success";
  return (
    <div className="space-y-px">
      <div className="flex items-baseline justify-between text-[10px]">
        <span className="text-text-muted">{label}</span>
        {limit !== null && (
          <span className={cn("font-bold tabular-nums", pctColor)}>{Math.round(percent)}%</span>
        )}
      </div>
      {limit !== null && (
        <div className="h-1 overflow-hidden rounded-full bg-border/40">
          <div
            className={cn("h-full rounded-full transition-all", barColor)}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <p className="text-[9px] tabular-nums text-text-subtle">
        {formatValue(used)}
        {limit !== null ? ` / ${formatValue(limit)}` : ""}
      </p>
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

function formatQuotaCount(value: number | null): string {
  return value === null ? "Unlimited" : String(value);
}

function formatBytesCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1_048_576).toFixed(1)} MB`;
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}

function formatDurationMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} s`;
  return `${(value / 60_000).toFixed(1)} min`;
}

function sandboxJobTone(status: string): string {
  switch (status) {
    case "completed":
      return "bg-success/15 text-success";
    case "blocked":
    case "failed":
      return "bg-destructive/15 text-destructive";
    case "running":
      return "bg-warning/15 text-warning";
    case "queued":
      return "bg-blue-500/15 text-blue-300";
    default:
      return "bg-surface text-text-muted";
  }
}

function usageRiskTone(risk: OpsUserRow["billing"]["usageRisk"]): string {
  switch (risk) {
    case "high":
      return "bg-destructive/15 text-destructive";
    case "elevated":
      return "bg-warning/15 text-warning";
    case "ok":
      return "bg-success/15 text-success";
    default:
      return "bg-surface text-text-muted";
  }
}

function billingStatusTone(status: string | null | undefined): string {
  switch (status) {
    case "active":
    case "trialing":
      return "bg-success/15 text-success";
    case "grace_period":
    case "past_due":
      return "bg-warning/15 text-warning";
    case "expired_fallback":
    case "expired":
    case "canceled":
      return "bg-destructive/15 text-destructive";
    default:
      return "bg-surface text-text-muted";
  }
}

export function resolveBillingSupportActions(
  billing: BillingSupportData | null | undefined,
  effectivePlanSource?: string | null
): BillingSupportActionConfig[] {
  const status = billing?.subscription.status ?? null;
  if (
    status === null &&
    billing?.subscription.id === null &&
    effectivePlanSource === "assistant_plan_fallback"
  ) {
    return [
      {
        action: "initialize_lifecycle_now",
        label: "Initialize lifecycle now",
        preview:
          "Create a real workspace subscription from the current registration policy using the current time, so this legacy fallback user can be tested through the normal lifecycle flow.",
        confirmLabel: "Initialize lifecycle",
        tone: "default"
      }
    ];
  }
  if (status === null) {
    return [];
  }

  const reminder: BillingSupportActionConfig = {
    action: "send_billing_reminder",
    label: "Send billing reminder",
    preview:
      "Create billing reminder notification work from admin-triggered lifecycle history without changing the current plan.",
    confirmLabel: "Send reminder",
    tone: "default"
  };
  const manualPaidActivation: BillingSupportActionConfig = {
    action: "activate_paid_manually",
    label: "Activate paid manually",
    preview:
      "Record a manual/admin payment with an explicit paid plan and billing period, then activate paid access through PersAI lifecycle truth.",
    confirmLabel: "Activate paid manually",
    tone: "danger",
    requiresManualPayment: true
  };

  switch (status) {
    case "trialing":
      return [
        manualPaidActivation,
        {
          action: "extend_trial",
          label: "Extend trial",
          preview:
            "Push the trial end forward using the current trial window length and reschedule trial-ending reminder work.",
          confirmLabel: "Extend trial",
          tone: "default"
        },
        reminder,
        {
          action: "apply_fallback_now",
          label: "Apply fallback now",
          preview:
            "End the current trial immediately and move the workspace to the configured fallback plan.",
          confirmLabel: "Apply fallback",
          tone: "danger"
        }
      ];
    case "active":
    case "past_due":
      return [
        manualPaidActivation,
        {
          action: "grant_grace",
          label: "Grant grace",
          preview:
            "Move the workspace into paid grace using the persisted grace-period policy while keeping paid access active.",
          confirmLabel: "Grant grace",
          tone: "default"
        },
        reminder,
        {
          action: "apply_fallback_now",
          label: "Apply fallback now",
          preview:
            "Move the workspace to the configured paid fallback plan immediately and end paid access now.",
          confirmLabel: "Apply fallback",
          tone: "danger"
        }
      ];
    case "grace_period":
      return [
        manualPaidActivation,
        {
          action: "extend_grace",
          label: "Extend grace",
          preview:
            "Push the grace end forward by the persisted grace-period length while keeping paid access active.",
          confirmLabel: "Extend grace",
          tone: "default"
        },
        reminder,
        {
          action: "apply_fallback_now",
          label: "Apply fallback now",
          preview:
            "End grace immediately and move the workspace to the configured fallback plan now.",
          confirmLabel: "Apply fallback",
          tone: "danger"
        }
      ];
    case "expired_fallback":
      return [manualPaidActivation, reminder];
    default:
      return [manualPaidActivation, reminder];
  }
}

export function resolvePlanControlOptions(
  plans: Array<Pick<AdminPlanState, "code" | "displayName" | "status">>,
  currentOverrideCode: string | null | undefined
): PlanControlOption[] {
  const options: PlanControlOption[] = plans
    .filter((plan) => plan.status === "active")
    .map((plan) => ({
      code: plan.code,
      displayName: plan.displayName,
      status: plan.status,
      selectedInactive: false
    }));

  if (!currentOverrideCode) {
    return options;
  }

  const hasSelected = options.some((plan) => plan.code === currentOverrideCode);
  if (hasSelected) {
    return options;
  }

  const selectedPlan = plans.find((plan) => plan.code === currentOverrideCode);
  if (selectedPlan?.status !== "inactive") {
    return options;
  }

  return [
    ...options,
    {
      code: selectedPlan.code,
      displayName: selectedPlan.displayName,
      status: selectedPlan.status,
      selectedInactive: true
    }
  ];
}

export function resolveManualPaidPlanOptions(
  plans: Array<
    Pick<AdminPlanState, "code" | "displayName" | "status" | "trialEnabled" | "presentation">
  >
): ManualPaidPlanOption[] {
  return plans
    .filter((plan) => plan.status === "active" && plan.trialEnabled !== true)
    .map((plan) => ({
      code: plan.code,
      displayName: plan.displayName,
      defaultBillingPeriod: plan.presentation.price?.billingPeriod === "year" ? "year" : "month"
    }));
}

function formatBillingPeriodLabel(value: ManualPaidBillingPeriod): string {
  return value === "year" ? "Year" : "Month";
}

function formatActivationSourceLabel(
  source: string | null | undefined,
  adminAction: string | null | undefined
): string {
  if (source === "admin" && adminAction === "activate_paid_manually") {
    return "manual/admin payment";
  }
  if (source === "admin") {
    return "admin";
  }
  if (source === "provider") {
    return "provider";
  }
  if (source === "manual") {
    return "manual";
  }
  if (source === "system") {
    return "system";
  }
  return source ?? "unknown";
}

/* ------------------------------------------------------------------ */
/*  Users Directory                                                    */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 10;

function UsersDirectory({
  getToken,
  selectedUserId,
  onSelectUser,
  reloadNonce
}: {
  getToken: ClerkGetToken;
  selectedUserId: string | null;
  onSelectUser: (userId: string, email: string) => void;
  reloadNonce: number;
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
  const searchRef = useRef(search);
  const offsetRef = useRef(offset);
  searchRef.current = search;
  offsetRef.current = offset;

  const load = useCallback(
    async (q: string, off: number) => {
      const token = await getAdminSessionToken(getToken);
      if (!usesAdminBffProxy() && !token) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({ offset: String(off), limit: String(PAGE_SIZE) });
        if (q) params.set("q", q);
        const res = await fetch(`/api/v1/admin/ops/users?${params}`, buildAdminFetchOptions(token));
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

  useEffect(() => {
    if (reloadNonce === 0) {
      return;
    }
    void load(searchRef.current.trim(), offsetRef.current);
  }, [load, reloadNonce]);

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
      const token = await getAdminSessionToken(getToken);
      if (!usesAdminBffProxy() && !token) return;
      setReapplyingId(userId);
      try {
        const res = await fetch(
          `/api/v1/admin/ops/users/${userId}/reapply`,
          buildAdminFetchOptions(token, { method: "POST" })
        );
        if (!res.ok) {
          throw new Error(`Reapply failed with status ${res.status}.`);
        }
        await load(search.trim(), offset);
      } finally {
        setReapplyingId(null);
      }
    },
    [getToken, load, search, offset]
  );

  const onDelete = useCallback(
    async (userId: string) => {
      const token = await getAdminSessionToken(getToken);
      if (!usesAdminBffProxy() && !token) return;
      setDeletingId(userId);
      try {
        const res = await fetch(
          `/api/v1/admin/ops/users/${userId}`,
          buildAdminFetchOptions(token, { method: "DELETE" })
        );
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
    <section className="rounded border border-border/50 bg-surface p-2.5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Users className="h-3 w-3 text-accent" />
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
              User Directory
            </h2>
            <span className="rounded bg-surface-raised px-1.5 py-px text-[9px] text-text-subtle">
              {total}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-text-subtle">
            Primary operator surface. Select a user to inspect billing truth, runtime state, and
            support actions.
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Email or name"
            className="h-7 w-44 rounded border border-border/50 bg-surface-raised pl-6 pr-2 text-[10px] text-text placeholder:text-text-subtle focus:border-accent/50 focus:outline-none"
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
            <table className="w-full min-w-[760px] table-fixed text-[10px]">
              <thead>
                <tr className="border-b border-border text-left text-text-muted">
                  <th className="pb-1.5 pr-2 font-medium">User</th>
                  <th className="pb-1.5 pr-2 font-medium">Plan</th>
                  <th className="pb-1.5 pr-2 font-medium">Billing</th>
                  <th className="pb-1.5 pr-2 font-medium">Next date</th>
                  <th className="pb-1.5 pr-2 font-medium">Usage</th>
                  <th className="pb-1.5 pr-2 font-medium">Paid (period)</th>
                  <th className="pb-1.5 pr-2 font-medium">Cost (USD)</th>
                  <th className="pb-1.5 pr-2 font-medium">Assistant</th>
                  <th className="pb-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.userId}
                    onClick={() => onSelectUser(u.userId, u.email)}
                    className={cn(
                      "cursor-pointer border-b border-border/50 transition-colors",
                      u.safetyStatus === "safety_restricted"
                        ? "bg-warning/8 hover:bg-warning/12"
                        : "hover:bg-surface-hover/50",
                      selectedUserId === u.userId &&
                        (u.safetyStatus === "safety_restricted"
                          ? "bg-warning/14 hover:bg-warning/18 ring-1 ring-inset ring-warning/20"
                          : "bg-accent/10 hover:bg-accent/15")
                    )}
                  >
                    <td className="max-w-[250px] truncate py-1.5 pr-2 text-text">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            u.assistantCount > 0 ? "bg-success" : "bg-text-subtle/40"
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 truncate font-mono">{u.email}</span>
                        {u.safetyStatus === "safety_restricted" ? (
                          <span className="shrink-0 rounded border border-warning/25 bg-warning/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-warning">
                            safety
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-text">{u.billing.planCode ?? "—"}</td>
                    <td className="py-1.5 pr-2">
                      <span
                        className={cn(
                          "inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                          billingStatusTone(u.billing.status)
                        )}
                      >
                        {(u.billing.status ?? "unknown").replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-text-muted">
                      {formatShortDate(resolveBillingNextDate(u.billing))}
                    </td>
                    <td className="py-1.5 pr-2">
                      <span
                        className={cn(
                          "inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                          usageRiskTone(u.billing.usageRisk)
                        )}
                      >
                        {u.billing.usageRisk}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums text-text-muted">
                      {u.periodEconomics
                        ? formatPaidMinor(
                            u.periodEconomics.paidTotalMinor,
                            u.periodEconomics.paidCurrency
                          )
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums text-text-muted">
                      {u.periodEconomics
                        ? formatCurrencyMicros(u.periodEconomics.modelCostUsdMicros, "USD")
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2">
                      {u.assistantCount > 1 ? (
                        <span className="text-[10px] font-semibold text-text-muted">
                          {u.assistantCount} assistants
                        </span>
                      ) : u.assistant ? (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                              applyStatusBorderTone(u.assistant.applyStatus as ApplyStatus)
                            )}
                          >
                            {u.assistant.applyStatus.replace(/_/g, " ")}
                          </span>
                          {u.assistant.latestPublishedVersion !== null ? (
                            <span className="text-[9px] text-text-subtle">
                              v{u.assistant.latestPublishedVersion}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-[9px] text-text-subtle">No assistant</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {u.assistant && (
                          <button
                            type="button"
                            disabled={reapplyingId === u.userId}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onReapply(u.userId);
                            }}
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
                      </div>
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

async function fetchCockpit(
  token: string | null | undefined,
  userId?: string,
  assistantId?: string
): Promise<AdminOpsCockpitState> {
  return await getAdminOpsCockpit(token, {
    ...(userId ? { userId } : {}),
    ...(assistantId ? { assistantId } : {})
  });
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
  const [billingSupportBusy, setBillingSupportBusy] = useState<BillingSupportAction | null>(null);
  const [safetyBusy, setSafetyBusy] = useState<"unblock" | "restrict" | null>(null);
  const [safetyFeedback, setSafetyFeedback] = useState<string | null>(null);
  const [manualSafetyReasonCode, setManualSafetyReasonCode] = useState("admin_manual");
  const [pendingBillingSupportAction, setPendingBillingSupportAction] =
    useState<BillingSupportActionConfig | null>(null);
  const [selectedPlanCode, setSelectedPlanCode] = useState("");
  const [planSelectionDirty, setPlanSelectionDirty] = useState(false);
  const [manualPaymentPlanCode, setManualPaymentPlanCode] = useState("");
  const [manualPaymentBillingPeriod, setManualPaymentBillingPeriod] =
    useState<ManualPaidBillingPeriod>("month");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserLabel, setSelectedUserLabel] = useState<string | null>(null);
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | null>(null);
  const [usersReloadNonce, setUsersReloadNonce] = useState(0);
  const selectedUserIdRef = useRef<string | null>(null);
  selectedUserIdRef.current = selectedUserId;
  const selectedAssistantIdRef = useRef<string | null>(null);
  selectedAssistantIdRef.current = selectedAssistantId;
  const selectedAssistant = useMemo(
    () =>
      cockpit?.assistant.assistants.find(
        (assistant) => assistant.id === cockpit.assistant.assistantId
      ) ?? null,
    [cockpit?.assistant.assistantId, cockpit?.assistant.assistants]
  );
  const selectedAssistantLabel = formatAssistantLabel(selectedAssistant);
  const planControlOptions = useMemo(
    () =>
      resolvePlanControlOptions(
        plans,
        cockpit?.assistant.effectivePlan.assistantPlanOverrideCode ?? null
      ),
    [plans, cockpit?.assistant.effectivePlan.assistantPlanOverrideCode]
  );
  const selectedPlanOption = useMemo(
    () => planControlOptions.find((plan) => plan.code === selectedPlanCode) ?? null,
    [planControlOptions, selectedPlanCode]
  );
  const manualPaidPlanOptions = useMemo(() => resolveManualPaidPlanOptions(plans), [plans]);
  const selectedManualPaymentPlan = useMemo(
    () => manualPaidPlanOptions.find((plan) => plan.code === manualPaymentPlanCode) ?? null,
    [manualPaidPlanOptions, manualPaymentPlanCode]
  );
  const billingSupport: BillingSupportData | null = cockpit?.billingSupport ?? null;
  const quotaUsage: QuotaUsageData | null = cockpit?.quotaUsage ?? null;
  const chatStats = cockpit?.chatStats ?? null;
  const modelCostLedger: ModelCostLedgerData | null = cockpit?.modelCostLedger ?? null;
  const channelBindings = cockpit?.channels ?? [];
  const supportActions = useMemo(
    () =>
      billingSupport
        ? resolveBillingSupportActions(billingSupport, cockpit?.assistant.effectivePlan.source)
        : [],
    [billingSupport, cockpit?.assistant.effectivePlan.source]
  );
  const signalCount = cockpit?.incidentSignals.length ?? 0;
  const elevatedSignalCount =
    cockpit?.incidentSignals.filter(
      (signal) => signal.severity !== AdminOpsIncidentSignalSeverity.info
    ).length ?? 0;

  const load = useCallback(
    async (targetUserId?: string, targetAssistantId?: string | null) => {
      const token = await getAdminSessionToken(getToken);
      if (!usesAdminBffProxy() && !token) {
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
        const activeAssistant = targetAssistantId ?? selectedAssistantIdRef.current ?? undefined;
        const [nextCockpit, nextPlans] = await Promise.all([
          fetchCockpit(token, activeTarget, activeAssistant ?? undefined),
          getAdminPlans(token)
        ]);
        setCockpit(nextCockpit);
        setSelectedAssistantId(nextCockpit.assistant.assistantId);
        setPlans(nextPlans);
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

  useEffect(() => {
    if (!selectedManualPaymentPlan) {
      return;
    }
    setManualPaymentBillingPeriod(selectedManualPaymentPlan.defaultBillingPeriod);
  }, [selectedManualPaymentPlan]);

  const onSelectUser = useCallback(
    (userId: string, email: string) => {
      setSelectedUserId(userId);
      setSelectedUserLabel(email);
      setActionMessage(null);
      setPendingBillingSupportAction(null);
      setPlanSelectionDirty(false);
      setManualPaymentPlanCode("");
      setManualPaymentBillingPeriod("month");
      setSelectedAssistantId(null);
      void load(userId);
    },
    [load]
  );

  const onSelectAssistant = useCallback(
    (assistantId: string) => {
      setSelectedAssistantId(assistantId);
      setActionMessage(null);
      setPendingBillingSupportAction(null);
      setPlanSelectionDirty(false);
      void load(selectedUserId ?? undefined, assistantId);
    },
    [load, selectedUserId]
  );

  const onReapply = useCallback(async () => {
    if (!cockpit?.controls.reapplySupported) return;
    setActionMessage(null);
    const token = await getAdminSessionToken(getToken);
    if (!usesAdminBffProxy() && !token) {
      setActionMessage("Not signed in.");
      return;
    }
    setReapplyBusy(true);
    try {
      if (selectedUserId) {
        const res = await fetch(
          `/api/v1/admin/ops/users/${selectedUserId}/reapply`,
          buildAdminFetchOptions(token, { method: "POST" })
        );
        if (!res.ok) {
          throw new Error(`Reapply failed with status ${res.status}.`);
        }
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
    const token = await getAdminSessionToken(getToken);
    if (!usesAdminBffProxy() && !token) {
      setActionMessage("Not signed in.");
      return;
    }
    setPlanOverrideBusy(true);
    setActionMessage(null);
    try {
      await postAdminOpsUserPlanOverride(token, selectedUserId, {
        planCode: selectedPlanCode,
        ...(cockpit.assistant.assistantId ? { assistantId: cockpit.assistant.assistantId } : {})
      });
      setActionMessage("Assistant test override applied.");
      await load(selectedUserId);
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Failed to apply assistant plan override.");
    } finally {
      setPlanOverrideBusy(false);
    }
  }, [
    cockpit?.controls.assistantPlanOverrideSupported,
    cockpit?.assistant.assistantId,
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
    const token = await getAdminSessionToken(getToken);
    if (!usesAdminBffProxy() && !token) {
      setActionMessage("Not signed in.");
      return;
    }
    setPlanOverrideBusy(true);
    setActionMessage(null);
    try {
      await deleteAdminOpsUserPlanOverride(token, selectedUserId, cockpit.assistant.assistantId);
      setActionMessage("Assistant returned to normal billing plan resolution.");
      await load(selectedUserId);
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Failed to reset assistant plan override.");
    } finally {
      setPlanOverrideBusy(false);
    }
  }, [
    cockpit?.assistant.assistantId,
    cockpit?.controls.assistantPlanResetSupported,
    getToken,
    load,
    selectedUserId
  ]);

  const onRunBillingSupportAction = useCallback(async () => {
    if (!selectedUserId) {
      setActionMessage("Select a user assistant first.");
      return;
    }
    if (pendingBillingSupportAction === null) {
      return;
    }
    const requestBody: {
      action: BillingSupportAction;
      manualPayment?: {
        planCode: string;
        billingPeriod: ManualPaidBillingPeriod;
      };
    } = {
      action: pendingBillingSupportAction.action
    };
    if (pendingBillingSupportAction.action === "activate_paid_manually") {
      if (!manualPaymentPlanCode) {
        setActionMessage("Choose a paid plan first.");
        return;
      }
      requestBody.manualPayment = {
        planCode: manualPaymentPlanCode,
        billingPeriod: manualPaymentBillingPeriod
      };
    }
    const token = await getAdminSessionToken(getToken);
    if (!usesAdminBffProxy() && !token) {
      setActionMessage("Not signed in.");
      return;
    }
    setBillingSupportBusy(pendingBillingSupportAction.action);
    setActionMessage(null);
    try {
      const result = await postAdminOpsUserBillingSupportAction(token, selectedUserId, requestBody);
      setActionMessage(result.summary);
      setPendingBillingSupportAction(null);
      setManualPaymentPlanCode("");
      setManualPaymentBillingPeriod("month");
      setUsersReloadNonce((value) => value + 1);
      await load(selectedUserId);
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : "Failed to run billing support action.");
    } finally {
      setBillingSupportBusy(null);
    }
  }, [
    getToken,
    load,
    manualPaymentBillingPeriod,
    manualPaymentPlanCode,
    pendingBillingSupportAction,
    selectedUserId
  ]);

  const onSafetyUnblock = useCallback(async () => {
    if (!selectedUserId || !cockpit?.controls.safetyUnblockSupported) {
      return;
    }
    const token = await getAdminSessionToken(getToken);
    if (!usesAdminBffProxy() && !token) {
      setSafetyFeedback("Not signed in.");
      return;
    }
    setSafetyBusy("unblock");
    setActionMessage(null);
    setSafetyFeedback(null);
    try {
      const result = await postAdminSafetyUnblock(token, { userId: selectedUserId });
      const message = result.cleared
        ? "Safety restriction cleared."
        : "No active safety restriction was present.";
      setActionMessage(message);
      setSafetyFeedback(message);
      setUsersReloadNonce((value) => value + 1);
      await load(selectedUserId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to clear safety restriction.";
      setActionMessage(message);
      setSafetyFeedback(message);
    } finally {
      setSafetyBusy(null);
    }
  }, [cockpit?.controls.safetyUnblockSupported, getToken, load, selectedUserId]);

  const onSafetyRestrict = useCallback(async () => {
    if (!selectedUserId || !cockpit?.controls.safetyManualRestrictSupported) {
      return;
    }
    const token = await getAdminSessionToken(getToken);
    if (!usesAdminBffProxy() && !token) {
      setSafetyFeedback("Not signed in.");
      return;
    }
    const reasonCode = manualSafetyReasonCode.trim();
    if (reasonCode.length === 0) {
      setActionMessage("Reason code is required for manual safety restrict.");
      return;
    }
    setSafetyBusy("restrict");
    setActionMessage(null);
    setSafetyFeedback(null);
    try {
      await postAdminSafetyRestrict(token, {
        userId: selectedUserId,
        reasonCode,
        ...(cockpit.assistant.assistantId
          ? { sourceAssistantId: cockpit.assistant.assistantId }
          : {})
      });
      const message = "Manual safety restriction applied.";
      setActionMessage(message);
      setSafetyFeedback(message);
      setUsersReloadNonce((value) => value + 1);
      await load(selectedUserId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to apply safety restriction.";
      setActionMessage(message);
      setSafetyFeedback(message);
    } finally {
      setSafetyBusy(null);
    }
  }, [
    cockpit?.assistant.assistantId,
    cockpit?.controls.safetyManualRestrictSupported,
    getToken,
    load,
    manualSafetyReasonCode,
    selectedUserId
  ]);

  if (loading && cockpit === null) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-2.5 px-2">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-accent" />
          <h1 className="text-sm font-bold tracking-tight text-text">Ops Cockpit</h1>
          {selectedUserLabel && (
            <span className="rounded bg-accent/15 px-1.5 py-px text-[9px] font-semibold text-accent">
              {selectedUserLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {selectedUserId && (
            <button
              type="button"
              onClick={() => {
                setSelectedUserId(null);
                setSelectedUserLabel(null);
                setActionMessage(null);
                setPendingBillingSupportAction(null);
                setPlanSelectionDirty(false);
                setManualPaymentPlanCode("");
                setManualPaymentBillingPeriod("month");
                void load(undefined);
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-text-muted transition-colors hover:bg-surface-hover"
            >
              Show self
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing || loading}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-text-muted transition-colors",
              "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
            Refresh
          </button>
        </div>
      </header>

      {loadError && (
        <p className="rounded border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
          {loadError}
        </p>
      )}

      {/* Users directory */}
      <UsersDirectory
        getToken={getToken}
        selectedUserId={selectedUserId}
        onSelectUser={onSelectUser}
        reloadNonce={usersReloadNonce}
      />

      {cockpit && (
        <>
          <section className="rounded border border-border/40 bg-surface/75 px-2.5 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <SummaryPill
                  label="Plan"
                  value={formatNullable(cockpit.assistant.effectivePlan.code)}
                  tone="default"
                />
                <SummaryPill
                  label="Billing"
                  value={(billingSupport?.subscription.status ?? "unknown").replace(/_/g, " ")}
                  tone={
                    billingSupport?.subscription.status === "active" ||
                    billingSupport?.subscription.status === "trialing"
                      ? "success"
                      : billingSupport?.subscription.status === "grace_period" ||
                          billingSupport?.subscription.status === "past_due"
                        ? "warning"
                        : billingSupport?.subscription.status
                          ? "danger"
                          : "muted"
                  }
                />
                <SummaryPill
                  label="Apply"
                  value={
                    cockpit.assistant.runtimeApply
                      ? cockpit.assistant.runtimeApply.status.replace(/_/g, " ")
                      : "no state"
                  }
                  tone={
                    cockpit.assistant.runtimeApply?.status === AssistantRuntimeApplyStatus.succeeded
                      ? "success"
                      : cockpit.assistant.runtimeApply?.status ===
                          AssistantRuntimeApplyStatus.failed
                        ? "danger"
                        : cockpit.assistant.runtimeApply?.status ===
                              AssistantRuntimeApplyStatus.in_progress ||
                            cockpit.assistant.runtimeApply?.status ===
                              AssistantRuntimeApplyStatus.degraded
                          ? "warning"
                          : "muted"
                  }
                />
                <SummaryPill
                  label="Runtime"
                  value={
                    cockpit.runtime.preflight.live && cockpit.runtime.preflight.ready
                      ? "ready"
                      : "attention"
                  }
                  tone={
                    cockpit.runtime.preflight.live && cockpit.runtime.preflight.ready
                      ? "success"
                      : "danger"
                  }
                />
                <SummaryPill
                  label="Signals"
                  value={signalCount}
                  tone={
                    signalCount === 0 ? "success" : elevatedSignalCount > 0 ? "warning" : "muted"
                  }
                />
              </div>
              <div className="flex min-w-0 items-center gap-2 text-[10px]">
                <span className="shrink-0 uppercase tracking-wide text-text-subtle">Assistant</span>
                {cockpit.assistant.assistants.length > 1 ? (
                  <select
                    value={cockpit.assistant.assistantId ?? ""}
                    onChange={(event) => onSelectAssistant(event.target.value)}
                    disabled={refreshing}
                    className="h-7 w-[420px] max-w-[55vw] rounded border border-border bg-bg px-2 text-[10px] text-text outline-none transition-colors focus:border-accent/40 disabled:opacity-50"
                  >
                    {cockpit.assistant.assistants.map((assistant) => (
                      <option key={assistant.id} value={assistant.id}>
                        {formatAssistantLabel(assistant)}
                        {assistant.latestPublishedVersion !== null
                          ? ` · v${assistant.latestPublishedVersion}`
                          : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <CopyableInlineValue
                    label="Assistant ID"
                    value={selectedAssistantLabel}
                    copyValue={cockpit.assistant.assistantId}
                  />
                )}
              </div>
            </div>
          </section>

          {actionMessage && (
            <p className="rounded border border-border/60 bg-surface px-2.5 py-1.5 text-[11px] text-text-muted">
              {actionMessage}
            </p>
          )}

          {(quotaUsage ||
            modelCostLedger ||
            chatStats ||
            channelBindings.length > 0 ||
            cockpit?.periodEconomics) && (
            <div
              className={cn(
                "grid grid-cols-1 gap-2",
                modelCostLedger &&
                  (quotaUsage ||
                    chatStats ||
                    channelBindings.length > 0 ||
                    cockpit?.periodEconomics) &&
                  "xl:grid-cols-2 xl:items-stretch"
              )}
            >
              {modelCostLedger && (
                <div className="flex min-w-0 flex-col">
                  <CardShell
                    title="Ledger-backed Model Cost"
                    icon={BarChart3}
                    tone="muted"
                    fillHeight
                  >
                    <div className="flex flex-1 flex-col gap-3">
                      <p className="rounded border border-border/40 bg-surface-raised/80 px-2.5 py-2 text-[10px] leading-relaxed text-text-muted">
                        {modelCostLedger.coverageNote}
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <DetailRow
                          label="Window"
                          value={`${formatTs(modelCostLedger.startedAt)} → ${formatTs(modelCostLedger.endedAt)}`}
                        />
                        <DetailRow
                          label="Period source"
                          value={formatLedgerPeriodSource(modelCostLedger.periodSource)}
                        />
                        <DetailRow label="Ledger events" value={modelCostLedger.totalEvents} />
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                          Totals
                        </p>
                        {modelCostLedger.currencyTotals.length === 0 ? (
                          <p className="text-[11px] text-text-muted">
                            No ledger-backed cost rows in this period.
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            {modelCostLedger.currencyTotals.map((entry) => (
                              <div
                                key={entry.currency}
                                className="flex items-center justify-between rounded-lg border border-border/50 bg-surface-raised px-3 py-2 text-[11px]"
                              >
                                <div>
                                  <p className="font-medium text-text">{entry.currency}</p>
                                  <p className="text-[10px] text-text-muted">
                                    {entry.eventCount} events
                                  </p>
                                </div>
                                <span className="text-sm font-semibold tabular-nums text-text">
                                  {formatCurrencyMicros(entry.totalCostMicros, entry.currency)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {(modelCostLedger.byPurpose.length > 0 ||
                        modelCostLedger.topBreakdown.length > 0) && (
                        <div className="grid flex-1 grid-cols-1 gap-2 lg:grid-cols-2 lg:items-stretch">
                          {modelCostLedger.byPurpose.length > 0 && (
                            <div className="flex flex-col rounded-lg border border-border/45 bg-surface-raised/60 p-2">
                              <p className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                                By purpose
                              </p>
                              <div className="mt-1.5 flex flex-1 flex-col justify-start gap-1">
                                {modelCostLedger.byPurpose.map((entry) => (
                                  <div
                                    key={entry.key}
                                    className="flex items-center justify-between rounded border border-border/40 bg-surface px-2 py-1.5 text-[10px]"
                                  >
                                    <span className="text-text">{entry.label}</span>
                                    <span className="font-medium tabular-nums text-text-muted">
                                      {entry.eventCount}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {modelCostLedger.topBreakdown.length > 0 && (
                            <div className="flex flex-col rounded-lg border border-border/45 bg-surface-raised/60 p-2">
                              <p className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                                Top model rows
                              </p>
                              <div className="mt-1.5 flex flex-1 flex-col justify-start gap-1">
                                {modelCostLedger.topBreakdown.slice(0, 5).map((entry) => (
                                  <div
                                    key={`${entry.provider}-${entry.model}-${entry.purpose}-${entry.surface}-${entry.currency}`}
                                    className="rounded border border-border/50 bg-surface px-2 py-1.5"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[11px] font-medium text-text">
                                        {entry.provider} / {entry.model}
                                      </span>
                                      <span className="text-[10px] font-semibold tabular-nums text-text">
                                        {formatCurrencyMicros(
                                          entry.totalCostMicros,
                                          entry.currency
                                        )}
                                      </span>
                                    </div>
                                    <p className="mt-0.5 text-[9px] text-text-muted">
                                      {entry.purposeLabel} · {entry.surfaceLabel} ·{" "}
                                      {entry.eventCount} events
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </CardShell>
                </div>
              )}

              {(quotaUsage ||
                chatStats ||
                channelBindings.length > 0 ||
                cockpit?.periodEconomics) && (
                <div className="flex min-w-0 flex-col gap-1.5">
                  {cockpit?.periodEconomics && (
                    <CardShell title="Period economics" icon={BarChart3} tone="muted" compact>
                      <div className="space-y-2 text-[11px]">
                        <DetailRow
                          label="Window"
                          value={`${formatTs(cockpit.periodEconomics.periodStartedAt)} → ${formatTs(cockpit.periodEconomics.periodEndsAt)}`}
                        />
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="rounded-lg border border-accent/20 bg-accent/5 px-2.5 py-2">
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-text-subtle">
                              Paid
                            </p>
                            <p className="mt-0.5 text-sm font-semibold tabular-nums text-text">
                              {formatPaidMinor(
                                cockpit.periodEconomics.paidTotalMinor,
                                cockpit.periodEconomics.paidCurrency
                              )}
                            </p>
                          </div>
                          <div className="rounded-lg border border-border/50 bg-surface-raised px-2.5 py-2">
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-text-subtle">
                              Model cost (USD)
                            </p>
                            <p className="mt-0.5 text-sm font-semibold tabular-nums text-text">
                              {formatCurrencyMicros(
                                cockpit.periodEconomics.modelCostUsdMicros,
                                "USD"
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    </CardShell>
                  )}

                  {quotaUsage && (
                    <CardShell title="Quota & Usage" icon={Gauge} compact>
                      <div className="space-y-2.5">
                        <QuotaBar
                          label="Token Budget"
                          used={quotaUsage.tokenBudgetUsed}
                          limit={quotaUsage.tokenBudgetLimit}
                          formatValue={formatTokens}
                        />
                        <QuotaBar
                          label="Media Storage"
                          used={quotaUsage.mediaStorageBytesUsed}
                          limit={quotaUsage.mediaStorageBytesLimit}
                          formatValue={formatStorageMb}
                        />
                        <div className="grid grid-cols-2 gap-2 rounded border border-border/30 bg-surface-raised/60 px-2 py-1.5 text-center">
                          <div>
                            <p className="text-sm font-semibold tabular-nums text-text">
                              {quotaUsage.activeWebChats}
                            </p>
                            <p className="text-[9px] uppercase tracking-wide text-text-subtle">
                              Active Web Chats
                            </p>
                          </div>
                          <div>
                            <p className="text-sm font-semibold tabular-nums text-text">
                              {formatQuotaCount(quotaUsage.activeWebChatsLimit)}
                            </p>
                            <p className="text-[9px] uppercase tracking-wide text-text-subtle">
                              Chat Cap
                            </p>
                          </div>
                        </div>
                        {quotaUsage.monthlyMediaTools.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                              Monthly package tools
                            </p>
                            <div className="grid grid-cols-1 gap-1.5">
                              {quotaUsage.monthlyMediaTools.map((tool) => (
                                <div
                                  key={tool.toolCode}
                                  className="rounded border border-border/60 bg-surface-raised px-2 py-1.5 text-[10px]"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-text-muted">{tool.displayName}</span>
                                    <span className="font-medium tabular-nums text-text">
                                      {tool.usedUnits} /{" "}
                                      {formatQuotaCount(tool.effectiveLimitUnits)}
                                    </span>
                                  </div>
                                  {tool.bonusLimitUnits > 0 ? (
                                    <p className="mt-1 text-[9px] text-accent">
                                      Package bonus: +{tool.bonusLimitUnits}
                                      {tool.limitUnits !== null
                                        ? ` over base ${tool.limitUnits}`
                                        : ""}
                                      {tool.bonusExpiresAt
                                        ? ` until ${formatShortDate(tool.bonusExpiresAt)}`
                                        : ""}
                                    </p>
                                  ) : tool.limitUnits !== null ? (
                                    <p className="mt-1 text-[9px] text-text-subtle">
                                      Base limit: {tool.limitUnits}
                                    </p>
                                  ) : (
                                    <p className="mt-1 text-[9px] text-text-subtle">
                                      Base limit: unlimited
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </CardShell>
                  )}

                  {(chatStats || channelBindings.length > 0) && (
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {chatStats && (
                        <CardShell title="Chat Stats" icon={Activity} tone="muted" compact>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                              <p className="text-lg font-bold tabular-nums text-text">
                                {chatStats.totalChats}
                              </p>
                              <p className="text-[10px] text-text-muted">Total</p>
                            </div>
                            <div>
                              <p className="text-lg font-bold tabular-nums text-text">
                                {chatStats.activeWebChats}
                              </p>
                              <p className="text-[10px] text-text-muted">Active Web</p>
                            </div>
                            <div>
                              <p className="text-lg font-bold tabular-nums text-text">
                                {chatStats.archivedWebChats}
                              </p>
                              <p className="text-[10px] text-text-muted">Archived</p>
                            </div>
                          </div>
                        </CardShell>
                      )}

                      {channelBindings.length > 0 && (
                        <CardShell title="Channels" icon={Server} tone="muted" compact>
                          <div className="space-y-1.5">
                            {channelBindings.map((channel, i) => (
                              <div
                                key={`${channel.provider}-${channel.surface}-${i}`}
                                className="flex items-center justify-between rounded-md border border-border bg-surface px-2 py-1.5"
                              >
                                <span className="min-w-0 truncate text-[11px] font-medium text-text">
                                  {channel.provider} / {channel.surface}
                                </span>
                                <span
                                  className={cn(
                                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                    channel.state === "active"
                                      ? "bg-success/15 text-success"
                                      : channel.state === "inactive"
                                        ? "bg-warning/15 text-warning"
                                        : "bg-muted/15 text-text-muted"
                                  )}
                                >
                                  {channel.state}
                                </span>
                              </div>
                            ))}
                          </div>
                        </CardShell>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-3">
            <CardShell title="Billing Actions" icon={AlertTriangle}>
              <p className="text-[11px] leading-relaxed text-text-muted">
                These actions write through PersAI lifecycle truth and refresh the selected detail
                after success.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {supportActions.map((supportAction) => (
                  <button
                    key={supportAction.action}
                    type="button"
                    disabled={!selectedUserId || billingSupportBusy !== null}
                    onClick={() => {
                      setActionMessage(null);
                      if (supportAction.action === "activate_paid_manually") {
                        const firstPlan = manualPaidPlanOptions[0] ?? null;
                        setManualPaymentPlanCode(
                          (currentValue) => currentValue || firstPlan?.code || ""
                        );
                        setManualPaymentBillingPeriod(firstPlan?.defaultBillingPeriod ?? "month");
                      }
                      setPendingBillingSupportAction(supportAction);
                    }}
                    className={cn(
                      "rounded border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                      supportAction.tone === "danger"
                        ? "border-destructive/25 bg-destructive/5 hover:bg-destructive/10"
                        : "border-border/60 bg-surface-raised hover:bg-surface-hover"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-text">
                        {supportAction.label}
                      </span>
                      {billingSupportBusy === supportAction.action ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" />
                      ) : null}
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
                      {supportAction.preview}
                    </p>
                  </button>
                ))}
                {supportActions.length === 0 && (
                  <p className="text-[11px] text-text-muted">
                    No lifecycle-native support action is available for the current billing state.
                  </p>
                )}
              </div>
              {pendingBillingSupportAction && (
                <div
                  className={cn(
                    "rounded border px-3 py-2",
                    pendingBillingSupportAction.tone === "danger"
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-accent/25 bg-accent/5"
                  )}
                >
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-subtle">
                    Confirm action
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-text">
                    {pendingBillingSupportAction.label}
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
                    {pendingBillingSupportAction.preview}
                  </p>
                  {pendingBillingSupportAction.requiresManualPayment && (
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-text-subtle">
                          Paid plan
                        </span>
                        <select
                          value={manualPaymentPlanCode}
                          onChange={(event) => setManualPaymentPlanCode(event.target.value)}
                          disabled={billingSupportBusy !== null}
                          className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[11px] text-text outline-none transition-colors focus:border-accent/40"
                        >
                          <option value="">Choose paid plan…</option>
                          {manualPaidPlanOptions.map((plan) => (
                            <option key={plan.code} value={plan.code}>
                              {plan.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-text-subtle">
                          Billing period
                        </span>
                        <select
                          value={manualPaymentBillingPeriod}
                          onChange={(event) =>
                            setManualPaymentBillingPeriod(
                              event.target.value as ManualPaidBillingPeriod
                            )
                          }
                          disabled={billingSupportBusy !== null}
                          className="w-full rounded border border-border bg-surface px-2 py-1.5 text-[11px] text-text outline-none transition-colors focus:border-accent/40"
                        >
                          <option value="month">{formatBillingPeriodLabel("month")}</option>
                          <option value="year">{formatBillingPeriodLabel("year")}</option>
                        </select>
                      </label>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={
                        !selectedUserId ||
                        billingSupportBusy !== null ||
                        (pendingBillingSupportAction.requiresManualPayment &&
                          manualPaymentPlanCode.length === 0)
                      }
                      onClick={() => void onRunBillingSupportAction()}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                        pendingBillingSupportAction.tone === "danger"
                          ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
                          : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/15"
                      )}
                    >
                      {billingSupportBusy === pendingBillingSupportAction.action ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : null}
                      {pendingBillingSupportAction.confirmLabel}
                    </button>
                    <button
                      type="button"
                      disabled={billingSupportBusy !== null}
                      onClick={() => setPendingBillingSupportAction(null)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </CardShell>

            <CardShell title="Billing" icon={Gauge} tone="muted" compact>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">Status</span>
                <span
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    billingStatusTone(billingSupport?.subscription.status)
                  )}
                >
                  {(billingSupport?.subscription.status ?? "unknown").replace(/_/g, " ")}
                </span>
              </div>
              <CopyableDetailRow
                label="Subscription"
                value={truncateId(billingSupport?.subscription.id)}
                copyValue={billingSupport?.subscription.id}
              />
              <DetailRow
                label="Plan"
                value={formatNullable(billingSupport?.subscription.planCode)}
              />
              <DetailRow
                label="Trial"
                value={
                  billingSupport?.subscription.status === "trialing"
                    ? formatPeriodWindow(
                        billingSupport.subscription.trialStartedAt,
                        billingSupport.subscription.trialEndsAt
                      )
                    : "—"
                }
              />
              <DetailRow
                label="Grace"
                value={
                  billingSupport?.subscription.status === "grace_period"
                    ? formatPeriodWindow(
                        billingSupport.subscription.graceStartedAt,
                        billingSupport.subscription.graceEndsAt
                      )
                    : "—"
                }
              />
              <DetailRow
                label="Paid period"
                value={formatPeriodWindow(
                  billingSupport?.subscription.currentPeriodStartedAt,
                  billingSupport?.subscription.currentPeriodEndsAt
                )}
              />
              <DetailRow
                label="Quota period"
                value={`${formatTs(billingSupport?.quotaPeriod.startedAt)} → ${formatTs(billingSupport?.quotaPeriod.endsAt)} (${billingSupport?.quotaPeriod.source ?? "unknown"})`}
              />
            </CardShell>

            <CardShell title="Lifecycle & Notifications" icon={Activity} tone="muted" compact>
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Latest paid activation
                </p>
                <p className="text-[10px] text-text-muted">
                  {billingSupport?.latestPaidActivation
                    ? `${formatActivationSourceLabel(
                        billingSupport.latestPaidActivation.source,
                        billingSupport.latestPaidActivation.adminAction
                      )} · ${billingSupport.latestPaidActivation.planCode ?? "—"} · ${formatTs(
                        billingSupport.latestPaidActivation.periodStartedAt
                      )} → ${formatTs(billingSupport.latestPaidActivation.periodEndsAt)}`
                    : "—"}
                </p>
              </div>
              <div className="space-y-1.5 border-t border-border pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Latest events
                </p>
                {!billingSupport || billingSupport.latestLifecycleEvents.length === 0 ? (
                  <p className="text-[11px] text-text-muted">No lifecycle events yet.</p>
                ) : (
                  billingSupport.latestLifecycleEvents.slice(0, 4).map((event) => (
                    <div
                      key={event.id}
                      className="rounded border border-border/50 bg-surface-raised px-2 py-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] font-semibold text-text">
                          {event.eventCode}
                        </span>
                        <span className="text-[9px] text-text-subtle">
                          {formatShortDate(event.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[9px] text-text-muted">
                        {formatActivationSourceLabel(event.source, null)} ·{" "}
                        {event.previousStatus ?? "—"} → {event.nextStatus ?? "—"} ·{" "}
                        {event.previousPlanCode ?? "—"} → {event.nextPlanCode ?? "—"}
                      </p>
                    </div>
                  ))
                )}
              </div>
              <div className="rounded border border-border/50 bg-surface-raised px-2 py-1.5 text-[10px] text-text-muted">
                Billing notification delivery history is in{" "}
                <a href="/admin/notifications" className="underline hover:text-text">
                  Admin &rsaquo; Notifications
                </a>{" "}
                (`billing_lifecycle`).
              </div>
            </CardShell>
          </div>

          <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,1fr)]">
            <CardShell title="Safety restriction" icon={ShieldAlert} tone="muted" compact>
              {cockpit.safetyRestriction ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-text-muted">Status</span>
                    <span className="rounded bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                      safety restricted
                    </span>
                  </div>
                  <DetailRow label="Reason" value={cockpit.safetyRestriction.reasonCode} />
                  <DetailRow label="Source" value={cockpit.safetyRestriction.source} />
                  <CopyableDetailRow
                    label="Source assistant"
                    value={truncateId(cockpit.safetyRestriction.sourceAssistantId)}
                    copyValue={cockpit.safetyRestriction.sourceAssistantId}
                  />
                  <CopyableDetailRow
                    label="Moderation case"
                    value={truncateId(cockpit.safetyRestriction.sourceModerationCaseId)}
                    copyValue={cockpit.safetyRestriction.sourceModerationCaseId}
                  />
                  <DetailRow
                    label="Blocked until"
                    value={formatTs(cockpit.safetyRestriction.blockedUntil)}
                  />
                  <DetailRow
                    label="Updated"
                    value={formatTs(cockpit.safetyRestriction.updatedAt)}
                  />
                  <button
                    type="button"
                    disabled={!cockpit.controls.safetyUnblockSupported || safetyBusy !== null}
                    onClick={() => void onSafetyUnblock()}
                    className={cn(
                      "mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-medium transition-colors",
                      "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                    )}
                  >
                    {safetyBusy === "unblock" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ShieldAlert className="h-3 w-3" />
                    )}
                    Unblock user
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-text-muted">
                  No active platform safety restriction for this user.
                </p>
              )}
              <div className="space-y-1.5 border-t border-border pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Manual restrict
                </p>
                <label className="flex flex-col gap-1 text-[11px] text-text-muted">
                  <span>Reason code</span>
                  <select
                    value={manualSafetyReasonCode}
                    onChange={(e) => setManualSafetyReasonCode(e.target.value)}
                    disabled={!selectedUserId || safetyBusy !== null}
                    className="h-8 rounded border border-border bg-bg px-2 text-[11px] text-text focus:border-accent/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="admin_manual">admin_manual</option>
                    <option value="violence_extremism">violence_extremism</option>
                    <option value="hack_abuse">hack_abuse</option>
                    <option value="unsolicited_adult_spam">unsolicited_adult_spam</option>
                    <option value="structural_abuse_signal">structural_abuse_signal</option>
                  </select>
                </label>
                <button
                  type="button"
                  disabled={
                    !selectedUserId ||
                    !cockpit.controls.safetyManualRestrictSupported ||
                    safetyBusy !== null
                  }
                  onClick={() => void onSafetyRestrict()}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive transition-colors",
                    "hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-45"
                  )}
                >
                  {safetyBusy === "restrict" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ShieldAlert className="h-3 w-3" />
                  )}
                  Apply safety restrict
                </button>
                <p className="text-[10px] text-text-subtle">
                  Requires security/super-admin step-up. This is separate from abuse rate-limit
                  unblock.
                </p>
                {safetyFeedback ? (
                  <p className="text-[10px] text-text-muted">{safetyFeedback}</p>
                ) : null}
              </div>
            </CardShell>
            <CardShell
              title={`Plan Control: ${selectedAssistantLabel}`}
              icon={Users}
              tone="muted"
              compact
            >
              <p className="text-[11px] leading-relaxed text-text-muted">
                Use assistant-level override only for tester and support routing. `Reset to normal`
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
                  className="h-8 rounded border border-border bg-bg px-2 text-[11px] text-text focus:border-accent/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Choose plan…</option>
                  {planControlOptions.map((plan) => (
                    <option key={plan.code} value={plan.code}>
                      {plan.code} - {plan.displayName}
                      {plan.selectedInactive ? " (inactive current override)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {planControlOptions.length === 0 && (
                <p className="text-[10px] text-text-subtle">
                  No active plans are currently available for tester override.
                </p>
              )}
              {selectedPlanOption?.selectedInactive && (
                <p className="text-[10px] text-warning">
                  The current override points to an inactive legacy plan. Reset it or choose an
                  active plan before applying.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    !selectedUserId ||
                    !selectedPlanCode ||
                    selectedPlanOption?.status !== "active" ||
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
            </CardShell>

            <CardShell
              title={`Assistant: ${selectedAssistantLabel}`}
              icon={Bot}
              tone="muted"
              compact
            >
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

            <CardShell title="Runtime" icon={Server} tone="muted" compact>
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
              <div className="border-t border-border pt-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Runtime actions
                </p>
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
              </div>
              <div className="border-t border-border pt-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Incident signals
                  </p>
                  <span className="text-[9px] text-text-subtle">{signalCount}</span>
                </div>
                {cockpit.incidentSignals.length === 0 ? (
                  <p className="text-[11px] text-text-muted">No active signals.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {cockpit.incidentSignals.slice(0, 4).map((signal, i) => (
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
              </div>
            </CardShell>
          </div>

          {cockpit.sandbox && (
            <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <CardShell title="Sandbox Overview" icon={Gauge} tone="muted" compact>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-text-muted">Sandbox</span>
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      cockpit.sandbox.effectivePolicy.enabled
                        ? "bg-success/15 text-success"
                        : "bg-surface text-text-muted ring-1 ring-border"
                    )}
                  >
                    {cockpit.sandbox.effectivePolicy.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 rounded border border-border/50 bg-surface-raised px-2 py-1.5 text-center">
                  <div>
                    <p className="text-base font-bold tabular-nums text-text">
                      {cockpit.sandbox.usage.activeJobs}
                    </p>
                    <p className="text-[9px] uppercase tracking-wide text-text-subtle">Active</p>
                  </div>
                  <div>
                    <p className="text-base font-bold tabular-nums text-text">
                      {cockpit.sandbox.usage.jobsStartedToday}
                    </p>
                    <p className="text-[9px] uppercase tracking-wide text-text-subtle">
                      Started Today
                    </p>
                  </div>
                  <div>
                    <p className="text-base font-bold tabular-nums text-text">
                      {cockpit.sandbox.usage.remainingJobsToday ?? "∞"}
                    </p>
                    <p className="text-[9px] uppercase tracking-wide text-text-subtle">Remaining</p>
                  </div>
                </div>
                <DetailRow
                  label="Daily limit"
                  value={formatNullable(cockpit.sandbox.usage.dailyLimit ?? "Unlimited")}
                />
                <DetailRow
                  label="Completed / blocked / failed"
                  value={`${cockpit.sandbox.usage.completedToday} / ${cockpit.sandbox.usage.blockedToday} / ${cockpit.sandbox.usage.failedToday}`}
                />
                <details className="rounded border border-border/50 bg-surface-raised px-2 py-1.5">
                  <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    More limits
                  </summary>
                  <div className="mt-2 space-y-2">
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        Process
                      </p>
                      <DetailRow
                        label="Runtime cap"
                        value={formatDurationMs(
                          cockpit.sandbox.effectivePolicy.maxProcessRuntimeMs
                        )}
                      />
                      <DetailRow
                        label="CPU cap"
                        value={formatDurationMs(cockpit.sandbox.effectivePolicy.maxCpuMsPerJob)}
                      />
                      <DetailRow
                        label="Memory cap"
                        value={formatBytesCompact(
                          cockpit.sandbox.effectivePolicy.maxMemoryBytesPerJob
                        )}
                      />
                      <DetailRow
                        label="Max processes"
                        value={cockpit.sandbox.effectivePolicy.maxConcurrentProcesses}
                      />
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        Files & Delivery
                      </p>
                      <DetailRow
                        label="Single file / workspace growth"
                        value={`${formatBytesCompact(cockpit.sandbox.effectivePolicy.maxSingleFileWriteBytes)} / ${formatBytesCompact(cockpit.sandbox.effectivePolicy.maxWorkspaceBytesPerJob)}`}
                      />
                      <DetailRow
                        label="New files / dirs / persisted"
                        value={`${cockpit.sandbox.effectivePolicy.maxFileCountPerJob} / ${cockpit.sandbox.effectivePolicy.maxDirectoryCountPerJob} / ${cockpit.sandbox.effectivePolicy.maxPersistedArtifactsPerJob}`}
                      />
                      <DetailRow
                        label="Delivered files per turn"
                        value={cockpit.sandbox.effectivePolicy.maxArtifactSendCountPerTurn}
                      />
                      <DetailRow
                        label="Web / Telegram bytes"
                        value={`${formatBytesCompact(cockpit.sandbox.effectivePolicy.webMaxOutboundBytes)} / ${formatBytesCompact(cockpit.sandbox.effectivePolicy.telegramMaxOutboundBytes)}`}
                      />
                      <DetailRow
                        label="Stdout / stderr cap"
                        value={`${formatBytesCompact(cockpit.sandbox.effectivePolicy.maxStdoutBytes)} / ${formatBytesCompact(cockpit.sandbox.effectivePolicy.maxStderrBytes)}`}
                      />
                      <DetailRow
                        label="Network / mime allowlist"
                        value={`${cockpit.sandbox.effectivePolicy.networkAccessEnabled ? "On" : "Off"} / ${cockpit.sandbox.effectivePolicy.artifactMimeAllowlist.length}`}
                      />
                    </div>
                  </div>
                </details>
              </CardShell>

              <CardShell title="Recent Sandbox Jobs" icon={Activity} tone="muted" compact>
                {cockpit.sandbox.recentJobs.length === 0 ? (
                  <p className="text-[11px] text-text-muted">
                    No sandbox jobs recorded for this assistant yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(() => {
                      const [latestJob, ...olderJobs] = cockpit.sandbox.recentJobs;
                      if (!latestJob) {
                        return null;
                      }
                      return (
                        <>
                          <div className="rounded border border-border/50 bg-surface-raised px-2 py-1.5">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                                Latest status
                              </p>
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                                  sandboxJobTone(latestJob.status)
                                )}
                              >
                                {latestJob.status.replace(/_/g, " ")}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold text-text">
                                {latestJob.toolCode}
                              </p>
                              <p className="text-[9px] font-mono text-text-subtle">
                                {truncateId(latestJob.id)}
                                {latestJob.relativeWorkspace
                                  ? ` • ${latestJob.relativeWorkspace}`
                                  : ""}
                              </p>
                            </div>
                            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-text-muted">
                              <span>Created: {formatTs(latestJob.createdAt)}</span>
                              <span className="text-right">
                                Done: {formatTs(latestJob.completedAt)}
                              </span>
                            </div>
                            <p className="mt-1 text-[10px] text-text-muted">
                              {latestJob.violationCode ? (
                                <>
                                  <span className="font-mono font-semibold text-destructive">
                                    {latestJob.violationCode}
                                  </span>
                                  {latestJob.violationMessage
                                    ? ` • ${latestJob.violationMessage}`
                                    : ""}
                                </>
                              ) : latestJob.resultWarning ? (
                                latestJob.resultWarning
                              ) : latestJob.resultReason ? (
                                latestJob.resultReason
                              ) : (
                                "No warning or violation recorded."
                              )}
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[9px] text-text-subtle">
                              <span className="rounded border border-border px-1.5 py-0.5">
                                Files {latestJob.persistedFileCount}
                              </span>
                              <span className="rounded border border-border px-1.5 py-0.5">
                                Workspace{" "}
                                {formatBytesCompact(latestJob.resourceUsage?.workspaceBytes)}
                              </span>
                              <span className="rounded border border-border px-1.5 py-0.5">
                                CPU {formatDurationMs(latestJob.resourceUsage?.peakCpuMs)}
                              </span>
                              <span className="rounded border border-border px-1.5 py-0.5">
                                Mem {formatBytesCompact(latestJob.resourceUsage?.peakMemoryBytes)}
                              </span>
                              <span className="rounded border border-border px-1.5 py-0.5">
                                Proc {formatNullable(latestJob.resourceUsage?.peakProcessCount)}
                              </span>
                            </div>
                          </div>

                          {olderJobs.length > 0 && (
                            <details className="rounded border border-border/50 bg-surface-raised px-2 py-1.5">
                              <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                                Older statuses ({olderJobs.length})
                              </summary>
                              <div className="mt-2 space-y-1.5">
                                {olderJobs.map((job) => (
                                  <div
                                    key={job.id}
                                    className="rounded border border-border/50 bg-surface px-2 py-1.5"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="text-[11px] font-semibold text-text">
                                          {job.toolCode}
                                        </p>
                                        <p className="text-[9px] font-mono text-text-subtle">
                                          {truncateId(job.id)}
                                          {job.relativeWorkspace
                                            ? ` • ${job.relativeWorkspace}`
                                            : ""}
                                        </p>
                                      </div>
                                      <span
                                        className={cn(
                                          "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                                          sandboxJobTone(job.status)
                                        )}
                                      >
                                        {job.status.replace(/_/g, " ")}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </CardShell>
            </div>
          )}

          <CardShell title="Apply Details" icon={RotateCcw} tone="muted" compact>
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

          <p className="pt-0.5 text-center text-[9px] tabular-nums text-text-subtle/50">
            {formatTs(cockpit.updatedAt)}
          </p>
        </>
      )}
    </div>
  );
}
