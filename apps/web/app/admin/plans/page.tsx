"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useAuth } from "@clerk/nextjs";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";
import type {
  AdminPlanCreateRequest,
  AdminPlanState,
  AdminPlanUpdateRequest,
} from "@persai/contracts";
import {
  getAdminPlans,
  patchAdminPlan,
  postAdminPlanCreate,
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

type PlanDraft = {
  displayName: string;
  description: string;
  status: "active" | "inactive";
  defaultOnRegistration: boolean;
  trialEnabled: boolean;
  trialDurationDays: number | null;
  metadataCommercialTag: string;
  metadataNotes: string;
  capabilityAssistantLifecycle: boolean;
  capabilityMemoryCenter: boolean;
  capabilityTasksCenter: boolean;
  toolCostDriving: boolean;
  toolUtility: boolean;
  toolCostDrivingQuotaGoverned: boolean;
  toolUtilityQuotaGoverned: boolean;
  channelWebChat: boolean;
  channelTelegram: boolean;
  channelWhatsapp: boolean;
  channelMax: boolean;
  limitsViewPercentages: boolean;
  limitsTasksExcludedFromCommercialQuotas: boolean;
};

function toNullable(value: string): string | null {
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function emptyDraft(): PlanDraft {
  return {
    displayName: "",
    description: "",
    status: "active",
    defaultOnRegistration: false,
    trialEnabled: false,
    trialDurationDays: null,
    metadataCommercialTag: "",
    metadataNotes: "",
    capabilityAssistantLifecycle: true,
    capabilityMemoryCenter: true,
    capabilityTasksCenter: true,
    toolCostDriving: false,
    toolUtility: true,
    toolCostDrivingQuotaGoverned: true,
    toolUtilityQuotaGoverned: true,
    channelWebChat: true,
    channelTelegram: true,
    channelWhatsapp: false,
    channelMax: false,
    limitsViewPercentages: true,
    limitsTasksExcludedFromCommercialQuotas: true,
  };
}

function planToDraft(plan: AdminPlanState): PlanDraft {
  return {
    displayName: plan.displayName,
    description: plan.description ?? "",
    status: plan.status,
    defaultOnRegistration: plan.defaultOnRegistration,
    trialEnabled: plan.trialEnabled,
    trialDurationDays: plan.trialDurationDays,
    metadataCommercialTag: plan.metadata.commercialTag ?? "",
    metadataNotes: plan.metadata.notes ?? "",
    capabilityAssistantLifecycle: plan.entitlements.capabilities.assistantLifecycle,
    capabilityMemoryCenter: plan.entitlements.capabilities.memoryCenter,
    capabilityTasksCenter: plan.entitlements.capabilities.tasksCenter,
    toolCostDriving: plan.entitlements.toolClasses.costDrivingTools,
    toolUtility: plan.entitlements.toolClasses.utilityTools,
    toolCostDrivingQuotaGoverned: plan.entitlements.toolClasses.costDrivingQuotaGoverned,
    toolUtilityQuotaGoverned: plan.entitlements.toolClasses.utilityQuotaGoverned,
    channelWebChat: plan.entitlements.channelsAndSurfaces.webChat,
    channelTelegram: plan.entitlements.channelsAndSurfaces.telegram,
    channelWhatsapp: plan.entitlements.channelsAndSurfaces.whatsapp,
    channelMax: plan.entitlements.channelsAndSurfaces.max,
    limitsViewPercentages: plan.entitlements.limitsPermissions.viewLimitPercentages,
    limitsTasksExcludedFromCommercialQuotas:
      plan.entitlements.limitsPermissions.tasksExcludedFromCommercialQuotas,
  };
}

function draftToPayload(draft: PlanDraft): AdminPlanUpdateRequest {
  return {
    displayName: draft.displayName.trim(),
    description: toNullable(draft.description),
    status: draft.status,
    defaultOnRegistration: draft.defaultOnRegistration,
    trialEnabled: draft.trialEnabled,
    trialDurationDays: draft.trialEnabled ? draft.trialDurationDays : null,
    metadata: {
      commercialTag: toNullable(draft.metadataCommercialTag),
      notes: toNullable(draft.metadataNotes),
    },
    entitlements: {
      capabilities: {
        assistantLifecycle: draft.capabilityAssistantLifecycle,
        memoryCenter: draft.capabilityMemoryCenter,
        tasksCenter: draft.capabilityTasksCenter,
      },
      toolClasses: {
        costDrivingTools: draft.toolCostDriving,
        utilityTools: draft.toolUtility,
        costDrivingQuotaGoverned: draft.toolCostDrivingQuotaGoverned,
        utilityQuotaGoverned: draft.toolUtilityQuotaGoverned,
      },
      channelsAndSurfaces: {
        webChat: draft.channelWebChat,
        telegram: draft.channelTelegram,
        whatsapp: draft.channelWhatsapp,
        max: draft.channelMax,
      },
      limitsPermissions: {
        viewLimitPercentages: draft.limitsViewPercentages,
        tasksExcludedFromCommercialQuotas: draft.limitsTasksExcludedFromCommercialQuotas,
      },
    },
  };
}

function FieldRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[minmax(0,7rem)_1fr] gap-x-2 gap-y-1 items-start sm:grid-cols-[minmax(0,10rem)_1fr]", className)}>
      <span className="text-xs text-text-muted shrink-0 pt-1.5">{label}</span>
      <div className="min-w-0 text-xs text-text sm:text-sm break-words">{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-2.5 py-1.5",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      <span className="text-xs text-text">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-border bg-surface-raised text-accent focus:ring-accent"
      />
    </label>
  );
}

function PlanFormBody({
  draft,
  onPatch,
  showCode,
  code,
  onCodeChange,
}: {
  draft: PlanDraft;
  onPatch: (p: Partial<PlanDraft>) => void;
  showCode: boolean;
  code: string;
  onCodeChange: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      {showCode && (
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Code</label>
          <input
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-text placeholder:text-text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder="plan_code"
            autoComplete="off"
          />
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">Display name</label>
        <input
          value={draft.displayName}
          onChange={(e) => onPatch({ displayName: e.target.value })}
          className="w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-text placeholder:text-text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">Description</label>
        <textarea
          value={draft.description}
          onChange={(e) => onPatch({ description: e.target.value })}
          rows={2}
          className="w-full resize-y rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-text placeholder:text-text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-text-muted">Status</span>
        <div className="flex rounded-md border border-border bg-surface p-0.5">
          {(["active", "inactive"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPatch({ status: s })}
              className={cn(
                "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                draft.status === s
                  ? "bg-surface-raised text-text shadow-sm"
                  : "text-text-muted hover:text-text",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow
          label="Default on registration"
          checked={draft.defaultOnRegistration}
          onChange={(v) => onPatch({ defaultOnRegistration: v })}
        />
        <ToggleRow
          label="Trial enabled"
          checked={draft.trialEnabled}
          onChange={(v) => onPatch({ trialEnabled: v })}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">Trial duration (days)</label>
        <input
          type="number"
          min={0}
          disabled={!draft.trialEnabled}
          value={draft.trialDurationDays ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            onPatch({
              trialDurationDays: raw === "" ? null : Math.max(0, Math.floor(Number(raw))),
            });
          }}
          className="w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Commercial tag</label>
          <input
            value={draft.metadataCommercialTag}
            onChange={(e) => onPatch({ metadataCommercialTag: e.target.value })}
            className="w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Notes</label>
          <input
            value={draft.metadataNotes}
            onChange={(e) => onPatch({ metadataNotes: e.target.value })}
            className="w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
          Capabilities
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <ToggleRow
            label="Assistant lifecycle"
            checked={draft.capabilityAssistantLifecycle}
            onChange={(v) => onPatch({ capabilityAssistantLifecycle: v })}
          />
          <ToggleRow
            label="Memory center"
            checked={draft.capabilityMemoryCenter}
            onChange={(v) => onPatch({ capabilityMemoryCenter: v })}
          />
          <ToggleRow
            label="Tasks center"
            checked={draft.capabilityTasksCenter}
            onChange={(v) => onPatch({ capabilityTasksCenter: v })}
          />
        </div>
      </div>
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
          Tool classes
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <ToggleRow
            label="Cost-driving tools"
            checked={draft.toolCostDriving}
            onChange={(v) => onPatch({ toolCostDriving: v })}
          />
          <ToggleRow
            label="Utility tools"
            checked={draft.toolUtility}
            onChange={(v) => onPatch({ toolUtility: v })}
          />
          <ToggleRow
            label="Cost-driving quota governed"
            checked={draft.toolCostDrivingQuotaGoverned}
            onChange={(v) => onPatch({ toolCostDrivingQuotaGoverned: v })}
          />
          <ToggleRow
            label="Utility quota governed"
            checked={draft.toolUtilityQuotaGoverned}
            onChange={(v) => onPatch({ toolUtilityQuotaGoverned: v })}
          />
        </div>
      </div>
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
          Channels & surfaces
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <ToggleRow
            label="Web chat"
            checked={draft.channelWebChat}
            onChange={(v) => onPatch({ channelWebChat: v })}
          />
          <ToggleRow
            label="Telegram"
            checked={draft.channelTelegram}
            onChange={(v) => onPatch({ channelTelegram: v })}
          />
          <ToggleRow
            label="WhatsApp"
            checked={draft.channelWhatsapp}
            onChange={(v) => onPatch({ channelWhatsapp: v })}
          />
          <ToggleRow label="Max" checked={draft.channelMax} onChange={(v) => onPatch({ channelMax: v })} />
        </div>
      </div>
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Limits</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <ToggleRow
            label="View limit percentages"
            checked={draft.limitsViewPercentages}
            onChange={(v) => onPatch({ limitsViewPercentages: v })}
          />
          <ToggleRow
            label="Tasks excluded from commercial quotas"
            checked={draft.limitsTasksExcludedFromCommercialQuotas}
            onChange={(v) => onPatch({ limitsTasksExcludedFromCommercialQuotas: v })}
          />
        </div>
      </div>
    </div>
  );
}

function ReadOnlyPlanBlock({ plan }: { plan: AdminPlanState }) {
  const e = plan.entitlements;
  return (
    <div className="space-y-3 border-t border-border pt-3 mt-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <FieldRow label="Code">{plan.code}</FieldRow>
        <FieldRow label="Display name">{plan.displayName}</FieldRow>
        <FieldRow label="Description">{plan.description ?? "—"}</FieldRow>
        <FieldRow label="Status">{plan.status}</FieldRow>
        <FieldRow label="Default on reg.">{plan.defaultOnRegistration ? "yes" : "no"}</FieldRow>
        <FieldRow label="Trial enabled">{plan.trialEnabled ? "yes" : "no"}</FieldRow>
        <FieldRow label="Trial days">{plan.trialDurationDays ?? "—"}</FieldRow>
        <FieldRow label="Commercial tag">{plan.metadata.commercialTag ?? "—"}</FieldRow>
        <div className="sm:col-span-2">
          <FieldRow label="Notes">{plan.metadata.notes ?? "—"}</FieldRow>
        </div>
        <FieldRow label="Created">{new Date(plan.createdAt).toLocaleString()}</FieldRow>
        <FieldRow label="Updated">{new Date(plan.updatedAt).toLocaleString()}</FieldRow>
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Capabilities</p>
      <div className="grid gap-1 text-xs text-text sm:grid-cols-3">
        <span>assistantLifecycle: {String(e.capabilities.assistantLifecycle)}</span>
        <span>memoryCenter: {String(e.capabilities.memoryCenter)}</span>
        <span>tasksCenter: {String(e.capabilities.tasksCenter)}</span>
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Tool classes</p>
      <div className="grid gap-1 text-xs text-text sm:grid-cols-2">
        <span>costDrivingTools: {String(e.toolClasses.costDrivingTools)}</span>
        <span>utilityTools: {String(e.toolClasses.utilityTools)}</span>
        <span>costDrivingQuotaGoverned: {String(e.toolClasses.costDrivingQuotaGoverned)}</span>
        <span>utilityQuotaGoverned: {String(e.toolClasses.utilityQuotaGoverned)}</span>
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        Channels & surfaces
      </p>
      <div className="grid gap-1 text-xs text-text sm:grid-cols-2">
        <span>webChat: {String(e.channelsAndSurfaces.webChat)}</span>
        <span>telegram: {String(e.channelsAndSurfaces.telegram)}</span>
        <span>whatsapp: {String(e.channelsAndSurfaces.whatsapp)}</span>
        <span>max: {String(e.channelsAndSurfaces.max)}</span>
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Limits</p>
      <div className="grid gap-1 text-xs text-text sm:grid-cols-2">
        <span>viewLimitPercentages: {String(e.limitsPermissions.viewLimitPercentages)}</span>
        <span>
          tasksExcludedFromCommercialQuotas:{" "}
          {String(e.limitsPermissions.tasksExcludedFromCommercialQuotas)}
        </span>
      </div>
    </div>
  );
}

export default function AdminPlansPage() {
  const { getToken } = useAuth();
  const [plans, setPlans] = useState<AdminPlanState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; message: string } | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<PlanDraft>(() => emptyDraft());
  const [createCode, setCreateCode] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<PlanDraft | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setLoading(false);
      setFeedback({ kind: "error", message: "Sign in required." });
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      setPlans(await getAdminPlans(token));
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to load plans.",
      });
    }
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (feedback?.kind !== "success") return;
    const t = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const patchCreate = useCallback((p: Partial<PlanDraft>) => {
    setCreateDraft((d) => ({ ...d, ...p }));
  }, []);

  const patchEdit = useCallback((p: Partial<PlanDraft>) => {
    setEditDraft((d) => (d ? { ...d, ...p } : d));
  }, []);

  const openCreate = useCallback(() => {
    setEditingCode(null);
    setEditDraft(null);
    setCreateDraft(emptyDraft());
    setCreateCode("");
    setCreateOpen((o) => !o);
    setFeedback(null);
  }, []);

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateDraft(emptyDraft());
    setCreateCode("");
  }, []);

  const startEdit = useCallback((plan: AdminPlanState) => {
    setCreateOpen(false);
    setEditingCode(plan.code);
    setEditDraft(planToDraft(plan));
    setFeedback(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingCode(null);
    setEditDraft(null);
  }, []);

  async function onCreateSubmit(e: FormEvent) {
    e.preventDefault();
    const token = await getToken();
    if (!token) return;
    if (!createDraft.displayName.trim()) {
      setFeedback({ kind: "error", message: "Display name is required." });
      return;
    }
    if (!createCode.trim()) {
      setFeedback({ kind: "error", message: "Plan code is required." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const body: AdminPlanCreateRequest = {
        code: createCode.trim(),
        ...draftToPayload(createDraft),
      };
      const created = await postAdminPlanCreate(token, body);
      setPlans((cur) => {
        const rest = cur.filter((p) => p.code !== created.code);
        return [...rest, created].sort((a, b) => a.code.localeCompare(b.code));
      });
      setFeedback({ kind: "success", message: "Plan created." });
      closeCreate();
      await load();
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Create failed.",
      });
    }
    setSaving(false);
  }

  async function onEditSubmit(e: FormEvent) {
    e.preventDefault();
    const token = await getToken();
    if (!token || !editingCode || !editDraft) return;
    if (!editDraft.displayName.trim()) {
      setFeedback({ kind: "error", message: "Display name is required." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const payload: AdminPlanUpdateRequest = draftToPayload(editDraft);
      const updated = await patchAdminPlan(token, editingCode, payload);
      setPlans((cur) => cur.map((p) => (p.code === updated.code ? updated : p)));
      setFeedback({ kind: "success", message: "Plan updated." });
      cancelEdit();
      await load();
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Update failed.",
      });
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <div className="text-text">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-accent" />
          <h1 className="text-lg font-bold text-text">Plans</h1>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={saving}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors",
            createOpen
              ? "border-border bg-surface-hover text-text"
              : "border-accent/40 bg-accent/15 text-accent hover:bg-accent/25",
          )}
        >
          {createOpen ? (
            <>
              <ChevronDown className="h-3.5 w-3.5 rotate-180" />
              Close
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              Create plan
            </>
          )}
        </button>
      </div>

      {feedback && (
        <div
          className={cn(
            "mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-xs sm:text-sm",
            feedback.kind === "success"
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {feedback.kind === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          createOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden min-h-0">
          <form
            onSubmit={(ev) => void onCreateSubmit(ev)}
            className="mb-6 rounded-lg border border-border bg-surface-raised p-4"
          >
            <h2 className="mb-3 text-sm font-semibold text-text">New plan</h2>
            <PlanFormBody
              draft={createDraft}
              onPatch={patchCreate}
              showCode
              code={createCode}
              onCodeChange={setCreateCode}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90 disabled:opacity-50"
              >
                {saving ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving…
                  </span>
                ) : (
                  "Save plan"
                )}
              </button>
              <button
                type="button"
                onClick={closeCreate}
                disabled={saving}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>

      {plans.length === 0 ? (
        <p className="text-sm text-text-subtle">No plans configured.</p>
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => {
            const isEditing = editingCode === plan.code && editDraft !== null;
            return (
              <div
                key={plan.code}
                className="rounded-lg border border-border bg-surface-raised p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-text">{plan.displayName}</span>
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                        {plan.status}
                      </span>
                      {plan.defaultOnRegistration && (
                        <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                          default
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">Code: {plan.code}</p>
                  </div>
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => startEdit(plan)}
                      disabled={saving || createOpen}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                  )}
                </div>
                {isEditing && editDraft ? (
                  <form
                    onSubmit={(ev) => void onEditSubmit(ev)}
                    className="mt-3 border-t border-border pt-3"
                  >
                    <PlanFormBody
                      draft={editDraft}
                      onPatch={patchEdit}
                      showCode={false}
                      code=""
                      onCodeChange={() => {}}
                    />
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={saving}
                        className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90 disabled:opacity-50"
                      >
                        {saving ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Saving…
                          </span>
                        ) : (
                          "Save changes"
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={saving}
                        className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <ReadOnlyPlanBlock plan={plan} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
