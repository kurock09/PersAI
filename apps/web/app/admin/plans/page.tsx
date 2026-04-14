"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  X
} from "lucide-react";
import type {
  AdminPlanCreateRequest,
  AdminPlanState,
  AdminPlanToolActivation,
  AdminPlanUpdateRequest
} from "@persai/contracts";
import {
  getAdminPlans,
  getAdminRuntimeProviderSettings,
  patchAdminPlan,
  postAdminPlanCreate,
  postAdminForceReapplyAll,
  type ForceReapplyAllSummary
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

/* ─── Draft types ─── */

type ToolActivationDraft = {
  toolCode: string;
  displayName: string;
  toolClass: "cost_driving" | "utility";
  policyClass: "plan_managed" | "platform_managed" | "hidden_internal";
  active: boolean;
  dailyCallLimit: number | null;
};

type VideoGenerateModelDraft = "" | "sora-2" | "sora-2-pro";

export type PlanDraft = {
  displayName: string;
  description: string;
  status: "active" | "inactive";
  defaultOnRegistration: boolean;
  trialEnabled: boolean;
  trialDurationDays: number | null;
  metadataCommercialTag: string;
  metadataNotes: string;
  toolCostDriving: boolean;
  toolUtility: boolean;
  toolCostDrivingQuotaGoverned: boolean;
  toolUtilityQuotaGoverned: boolean;
  channelWebChat: boolean;
  channelTelegram: boolean;
  channelWhatsapp: boolean;
  channelMax: boolean;
  tokenBudgetLimit: string;
  mediaStorageMb: string;
  workspaceStorageMb: string;
  primaryModelKey: string;
  videoGenerateModelKey: VideoGenerateModelDraft;
  runtimeTierDefault: "free_shared_restricted" | "paid_shared_restricted" | "paid_isolated";
  toolActivations: ToolActivationDraft[];
};

const RUNTIME_TIER_OPTIONS: Array<{
  value: PlanDraft["runtimeTierDefault"];
  label: string;
}> = [
  { value: "free_shared_restricted", label: "Free shared restricted" },
  { value: "paid_shared_restricted", label: "Paid shared restricted" },
  { value: "paid_isolated", label: "Paid isolated" }
];

export const VIDEO_GENERATE_MODEL_OPTIONS: Array<{
  value: VideoGenerateModelDraft;
  label: string;
}> = [
  { value: "", label: "default (sora-2)" },
  { value: "sora-2", label: "sora-2" },
  { value: "sora-2-pro", label: "sora-2-pro" }
];

/* ─── Helpers ─── */

function toNullable(value: string): string | null {
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function toVideoGenerateModelDraft(
  value: AdminPlanState["videoGenerateModelKey"] | null | undefined
): VideoGenerateModelDraft {
  return value === "sora-2" || value === "sora-2-pro" ? value : "";
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
    toolCostDriving: false,
    toolUtility: true,
    toolCostDrivingQuotaGoverned: true,
    toolUtilityQuotaGoverned: true,
    channelWebChat: true,
    channelTelegram: true,
    channelWhatsapp: false,
    channelMax: false,
    tokenBudgetLimit: "",
    mediaStorageMb: "",
    workspaceStorageMb: "",
    primaryModelKey: "",
    videoGenerateModelKey: "",
    runtimeTierDefault: "free_shared_restricted",
    toolActivations: []
  };
}

export function planToDraft(plan: AdminPlanState): PlanDraft {
  return {
    displayName: plan.displayName,
    description: plan.description ?? "",
    status: plan.status,
    defaultOnRegistration: plan.defaultOnRegistration,
    trialEnabled: plan.trialEnabled,
    trialDurationDays: plan.trialDurationDays,
    metadataCommercialTag: plan.metadata.commercialTag ?? "",
    metadataNotes: plan.metadata.notes ?? "",
    toolCostDriving: plan.entitlements.toolClasses.costDrivingTools,
    toolUtility: plan.entitlements.toolClasses.utilityTools,
    toolCostDrivingQuotaGoverned: plan.entitlements.toolClasses.costDrivingQuotaGoverned,
    toolUtilityQuotaGoverned: plan.entitlements.toolClasses.utilityQuotaGoverned,
    channelWebChat: plan.entitlements.channelsAndSurfaces.webChat,
    channelTelegram: plan.entitlements.channelsAndSurfaces.telegram,
    channelWhatsapp: plan.entitlements.channelsAndSurfaces.whatsapp,
    channelMax: plan.entitlements.channelsAndSurfaces.max,
    tokenBudgetLimit: plan.quotaLimits?.tokenBudgetLimit?.toString() ?? "",
    mediaStorageMb:
      plan.quotaLimits?.mediaStorageBytesLimit != null
        ? String(Math.round(plan.quotaLimits.mediaStorageBytesLimit / 1048576))
        : "",
    workspaceStorageMb:
      plan.quotaLimits?.workspaceStorageBytesLimit != null
        ? String(Math.round(plan.quotaLimits.workspaceStorageBytesLimit / 1048576))
        : "",
    primaryModelKey: plan.primaryModelKey ?? "",
    videoGenerateModelKey: toVideoGenerateModelDraft(plan.videoGenerateModelKey),
    runtimeTierDefault: plan.runtimeTierDefault ?? "free_shared_restricted",
    toolActivations: (plan.toolActivations ?? [])
      .filter((ta) => ta.visibleInPlanEditor)
      .map((ta) => ({
        toolCode: ta.toolCode,
        displayName: ta.displayName,
        toolClass: ta.toolClass,
        policyClass: ta.policyClass,
        active: ta.active,
        dailyCallLimit: ta.dailyCallLimit
      }))
  };
}

export function draftToPayload(draft: PlanDraft): AdminPlanUpdateRequest {
  const tokenBudget = draft.tokenBudgetLimit.trim();
  return {
    displayName: draft.displayName.trim(),
    description: toNullable(draft.description),
    status: draft.status,
    defaultOnRegistration: draft.defaultOnRegistration,
    trialEnabled: draft.trialEnabled,
    trialDurationDays: draft.trialEnabled ? draft.trialDurationDays : null,
    metadata: {
      commercialTag: toNullable(draft.metadataCommercialTag),
      notes: toNullable(draft.metadataNotes)
    },
    entitlements: {
      toolClasses: {
        costDrivingTools: draft.toolCostDriving,
        utilityTools: draft.toolUtility,
        costDrivingQuotaGoverned: draft.toolCostDrivingQuotaGoverned,
        utilityQuotaGoverned: draft.toolUtilityQuotaGoverned
      },
      channelsAndSurfaces: {
        webChat: draft.channelWebChat,
        telegram: draft.channelTelegram,
        whatsapp: draft.channelWhatsapp,
        max: draft.channelMax
      }
    },
    quotaLimits: {
      tokenBudgetLimit: tokenBudget.length > 0 ? parseInt(tokenBudget, 10) || null : null,
      mediaStorageBytesLimit: (() => {
        const mb = draft.mediaStorageMb.trim();
        if (mb.length === 0) return null;
        const parsed = parseInt(mb, 10);
        return parsed > 0 ? parsed * 1048576 : null;
      })(),
      workspaceStorageBytesLimit: (() => {
        const mb = draft.workspaceStorageMb.trim();
        if (mb.length === 0) return null;
        const parsed = parseInt(mb, 10);
        return parsed > 0 ? parsed * 1048576 : null;
      })()
    },
    primaryModelKey: toNullable(draft.primaryModelKey),
    videoGenerateModelKey: draft.videoGenerateModelKey === "" ? null : draft.videoGenerateModelKey,
    runtimeTierDefault: draft.runtimeTierDefault,
    toolActivations: draft.toolActivations.map((ta) => ({
      toolCode: ta.toolCode,
      active: ta.active,
      dailyCallLimit: ta.dailyCallLimit
    }))
  };
}

function getPolicyClassLabel(
  policyClass: AdminPlanToolActivation["policyClass"] | ToolActivationDraft["policyClass"]
): string {
  switch (policyClass) {
    case "platform_managed":
      return "system";
    case "hidden_internal":
      return "internal";
    default:
      return "plan";
  }
}

function splitToolActivationsByPolicy<
  T extends { policyClass: AdminPlanToolActivation["policyClass"] }
>(
  activations: T[]
): {
  planManaged: T[];
  platformManaged: T[];
  hiddenInternal: T[];
} {
  return {
    planManaged: activations.filter((ta) => ta.policyClass === "plan_managed"),
    platformManaged: activations.filter((ta) => ta.policyClass === "platform_managed"),
    hiddenInternal: activations.filter((ta) => ta.policyClass === "hidden_internal")
  };
}

/* ─── Tiny UI primitives ─── */

function Pill({
  children,
  variant = "default"
}: {
  children: ReactNode;
  variant?: "default" | "green" | "amber" | "dim";
}) {
  const cls = {
    default: "bg-accent/15 text-accent",
    green: "bg-emerald-500/15 text-emerald-400",
    amber: "bg-amber-500/15 text-amber-400",
    dim: "bg-white/5 text-text-muted"
  };
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-px text-[10px] font-semibold leading-tight",
        cls[variant]
      )}
    >
      {children}
    </span>
  );
}

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="text-[11px]">
      <span className="text-text-muted">{label}:</span>{" "}
      <span className="text-text">{children}</span>
    </span>
  );
}

function Sec({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">
        {label}
      </span>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-1.5 text-[11px] text-text select-none",
        disabled && "opacity-40 pointer-events-none"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 rounded border-border bg-surface-raised text-accent focus:ring-accent/50 focus:ring-1"
      />
      {label}
    </label>
  );
}

function Input({
  value,
  onValue,
  placeholder,
  className: extra,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  value: string;
  onValue: (v: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onValue(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "w-full rounded border border-border bg-surface-raised px-2 py-1 text-[11px] text-text placeholder:text-text-subtle focus:outline-none focus:ring-1 focus:ring-accent/50",
        extra
      )}
      {...rest}
    />
  );
}

/* ─── Tool activations (read-only inline) ─── */

function ToolActivationsInline({ activations }: { activations: AdminPlanToolActivation[] }) {
  const visibleActivations = activations.filter((ta) => ta.policyClass !== "hidden_internal");
  if (visibleActivations.length === 0) {
    return <span className="text-[10px] text-text-subtle italic">none configured</span>;
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
      {visibleActivations.map((ta) => (
        <span key={ta.toolCode} className="text-[10px]">
          <span className={ta.active ? "text-emerald-400" : "text-text-muted line-through"}>
            {ta.displayName}
          </span>
          {ta.dailyCallLimit !== null && (
            <span className="ml-0.5 text-text-subtle">({ta.dailyCallLimit}/d)</span>
          )}
        </span>
      ))}
    </div>
  );
}

/* ─── Tool activations (edit table) ─── */

export function ToolActivationsEdit({
  activations,
  onUpdate,
  videoGenerateModelKey,
  onVideoGenerateModelKeyChange
}: {
  activations: ToolActivationDraft[];
  onUpdate: (updated: ToolActivationDraft[]) => void;
  videoGenerateModelKey: VideoGenerateModelDraft;
  onVideoGenerateModelKeyChange: (value: VideoGenerateModelDraft) => void;
}) {
  if (activations.length === 0) {
    return (
      <p className="text-[10px] text-text-subtle italic">
        Will be generated from tool class defaults after first save.
      </p>
    );
  }

  function toggle(idx: number) {
    const next = activations.map((a, i) => (i === idx ? { ...a, active: !a.active } : a));
    onUpdate(next);
  }

  function setLimit(idx: number, val: string) {
    const next = activations.map((a, i) =>
      i === idx
        ? { ...a, dailyCallLimit: val === "" ? null : Math.max(0, Math.floor(Number(val))) }
        : a
    );
    onUpdate(next);
  }

  return (
    <div className="grid gap-px rounded border border-border bg-border overflow-hidden">
      <div className="grid grid-cols-[1fr_70px_40px_88px] gap-px bg-border text-[9px] font-bold uppercase tracking-wider text-text-subtle">
        <span className="bg-surface px-2 py-1">Tool</span>
        <span className="bg-surface px-2 py-1">Class</span>
        <span className="bg-surface px-2 py-1 text-center">On</span>
        <span className="bg-surface px-2 py-1 text-right">Limit/d</span>
      </div>
      {activations.map((ta, idx) => (
        <div key={ta.toolCode} className="grid grid-cols-[1fr_70px_40px_88px] gap-px bg-border">
          <span className="bg-surface-raised px-2 py-1 text-[11px] text-text">
            <span className="block truncate">
              {ta.displayName}
              <span className="ml-1 text-[10px] text-text-subtle">
                ({getPolicyClassLabel(ta.policyClass)})
              </span>
            </span>
            {ta.toolCode === "video_generate" ? (
              <label className="mt-1 flex items-center gap-2 text-[10px] text-text-subtle">
                <span className="shrink-0 uppercase tracking-wider">Model</span>
                <select
                  value={videoGenerateModelKey}
                  onChange={(e) =>
                    onVideoGenerateModelKeyChange(e.target.value as VideoGenerateModelDraft)
                  }
                  className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-0.5 text-[10px] text-text focus:outline-none focus:ring-1 focus:ring-accent/50"
                >
                  {VIDEO_GENERATE_MODEL_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </span>
          <span className="bg-surface-raised px-2 py-1">
            <Pill variant={ta.toolClass === "cost_driving" ? "amber" : "dim"}>
              {ta.toolClass === "cost_driving" ? "cost" : "util"}
            </Pill>
          </span>
          <span className="bg-surface-raised px-2 py-1 flex items-center justify-center">
            <input
              type="checkbox"
              checked={ta.active}
              onChange={() => toggle(idx)}
              className="h-3 w-3 rounded border-border bg-surface text-accent focus:ring-accent/50 focus:ring-1"
            />
          </span>
          <span className="bg-surface-raised px-2 py-1 flex items-center justify-end">
            <input
              type="number"
              min={0}
              value={ta.dailyCallLimit ?? ""}
              onChange={(e) => setLimit(idx, e.target.value)}
              placeholder="∞"
              className="w-16 appearance-none rounded border border-border bg-surface px-2 py-0.5 text-right text-[11px] text-text placeholder:text-text-subtle focus:outline-none focus:ring-1 focus:ring-accent/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
            />
          </span>
        </div>
      ))}
    </div>
  );
}

function ToolActivationReadOnlyGroup({
  title,
  emptyLabel,
  activations,
  showLimits = true
}: {
  title: string;
  emptyLabel: string;
  activations: AdminPlanToolActivation[];
  showLimits?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Sec label={title}>
        {activations.length === 0 ? (
          <span className="text-[10px] text-text-subtle italic">{emptyLabel}</span>
        ) : (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {activations.map((ta) => (
              <span key={ta.toolCode} className="text-[10px]">
                <span className={ta.active ? "text-emerald-400" : "text-text-muted line-through"}>
                  {ta.displayName}
                </span>
                <span className="ml-1 text-text-subtle">
                  ({getPolicyClassLabel(ta.policyClass)})
                </span>
                {showLimits && ta.dailyCallLimit !== null ? (
                  <span className="ml-0.5 text-text-subtle">({ta.dailyCallLimit}/d)</span>
                ) : null}
              </span>
            ))}
          </div>
        )}
      </Sec>
    </div>
  );
}

/* ─── Compact plan form (edit / create) ─── */

function PlanForm({
  draft,
  onPatch,
  showCode,
  code,
  onCodeChange,
  availableModelKeys = []
}: {
  draft: PlanDraft;
  onPatch: (p: Partial<PlanDraft>) => void;
  showCode: boolean;
  code: string;
  onCodeChange: (v: string) => void;
  availableModelKeys?: { provider: string; model: string }[];
}) {
  const editableActivations = draft.toolActivations.filter(
    (ta) => ta.policyClass === "plan_managed"
  );
  return (
    <div className="space-y-2.5">
      {/* row 1: code + name + description */}
      <div className={cn("grid gap-2", showCode ? "grid-cols-[120px_1fr_1fr]" : "grid-cols-2")}>
        {showCode && (
          <div>
            <label className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-text-subtle">
              Code
            </label>
            <Input value={code} onValue={onCodeChange} placeholder="plan_code" autoComplete="off" />
          </div>
        )}
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-text-subtle">
            Name
          </label>
          <Input value={draft.displayName} onValue={(v) => onPatch({ displayName: v })} />
        </div>
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-text-subtle">
            Description
          </label>
          <Input value={draft.description} onValue={(v) => onPatch({ description: v })} />
        </div>
      </div>

      {/* row 2: status + flags */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-1 rounded border border-border bg-surface p-px">
          {(["active", "inactive"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPatch({ status: s })}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-semibold transition-colors",
                draft.status === s
                  ? "bg-surface-raised text-text shadow-sm"
                  : "text-text-muted hover:text-text"
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <Check
          label="Default on reg"
          checked={draft.defaultOnRegistration}
          onChange={(v) => onPatch({ defaultOnRegistration: v })}
        />
        <Check
          label="Trial"
          checked={draft.trialEnabled}
          onChange={(v) => onPatch({ trialEnabled: v })}
        />
        {draft.trialEnabled && (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              value={draft.trialDurationDays ?? ""}
              onChange={(e) =>
                onPatch({
                  trialDurationDays:
                    e.target.value === "" ? null : Math.max(1, Math.floor(Number(e.target.value)))
                })
              }
              className="w-14 rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[11px] text-text focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
            <span className="text-[10px] text-text-muted">days</span>
          </div>
        )}
      </div>

      {/* row 3: metadata */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-text-subtle">
            Commercial tag
          </label>
          <Input
            value={draft.metadataCommercialTag}
            onValue={(v) => onPatch({ metadataCommercialTag: v })}
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-text-subtle">
            Notes
          </label>
          <Input value={draft.metadataNotes} onValue={(v) => onPatch({ metadataNotes: v })} />
        </div>
      </div>

      {/* row 4: entitlements grid */}
      <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 rounded border border-border bg-surface px-3 py-2">
        <div className="space-y-2 rounded-md border border-accent/30 bg-surface-raised p-2.5">
          <Sec label="Tool classes">
            <div className="space-y-0.5">
              <Check
                label="Cost-driving"
                checked={draft.toolCostDriving}
                onChange={(v) => onPatch({ toolCostDriving: v })}
              />
              <Check
                label="Utility"
                checked={draft.toolUtility}
                onChange={(v) => onPatch({ toolUtility: v })}
              />
              <Check
                label="Cost quota"
                checked={draft.toolCostDrivingQuotaGoverned}
                onChange={(v) => onPatch({ toolCostDrivingQuotaGoverned: v })}
              />
              <Check
                label="Util quota"
                checked={draft.toolUtilityQuotaGoverned}
                onChange={(v) => onPatch({ toolUtilityQuotaGoverned: v })}
              />
            </div>
          </Sec>
          <p className="text-[10px] leading-snug text-text-subtle/80">
            &quot;Cost&quot; tools consume quota units; &quot;Utility&quot; are free. Quota flags
            enforce spending limits.
          </p>
        </div>
        <div className="space-y-2 rounded-md border border-accent/30 bg-surface-raised p-2.5">
          <Sec label="Channels">
            <div className="space-y-0.5">
              <Check
                label="Web Chat"
                checked={draft.channelWebChat}
                onChange={(v) => onPatch({ channelWebChat: v })}
              />
              <Check
                label="Telegram"
                checked={draft.channelTelegram}
                onChange={(v) => onPatch({ channelTelegram: v })}
              />
              <Check
                label="WhatsApp"
                checked={draft.channelWhatsapp}
                onChange={(v) => onPatch({ channelWhatsapp: v })}
              />
              <Check
                label="Max"
                checked={draft.channelMax}
                onChange={(v) => onPatch({ channelMax: v })}
              />
            </div>
          </Sec>
          <p className="text-[10px] leading-snug text-text-subtle/80">
            Messaging channels available to workspaces on this plan.
          </p>
        </div>
        <div className="space-y-2 rounded-md border border-accent/30 bg-surface-raised p-2.5">
          <Sec label="Runtime tier default">
            <select
              value={draft.runtimeTierDefault}
              onChange={(e) =>
                onPatch({
                  runtimeTierDefault: e.target.value as PlanDraft["runtimeTierDefault"]
                })
              }
              className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50"
            >
              {RUNTIME_TIER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] leading-snug text-text-subtle/80">
              Product policy default only. Pool/service routing stays behind the control plane.
            </p>
          </Sec>
          <Sec label="Quota limits">
            <div className="space-y-1.5">
              <label className="flex items-center justify-between gap-2 text-[11px] font-medium text-text">
                Token budget
                <input
                  type="number"
                  min={0}
                  value={draft.tokenBudgetLimit}
                  onChange={(e) => onPatch({ tokenBudgetLimit: e.target.value })}
                  placeholder="default"
                  className="w-28 appearance-none rounded border border-border bg-bg px-2 py-1 text-right text-xs text-text placeholder:text-text-subtle/70 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[11px] font-medium text-text">
                <span title="User upload budget — max MB users can upload through chat (images, voice, docs). Tracked by PersAI API.">
                  Media upload budget (MB)
                </span>
                <input
                  type="number"
                  min={0}
                  value={draft.mediaStorageMb}
                  onChange={(e) => onPatch({ mediaStorageMb: e.target.value })}
                  placeholder="default"
                  className="w-28 appearance-none rounded border border-border bg-bg px-2 py-1 text-right text-xs text-text placeholder:text-text-subtle/70 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[11px] font-medium text-text">
                <span title="Total sandbox disk — max MB for everything (agent files, downloads, user uploads). Enforced by OpenClaw.">
                  Workspace disk (MB)
                </span>
                <input
                  type="number"
                  min={0}
                  value={draft.workspaceStorageMb}
                  onChange={(e) => onPatch({ workspaceStorageMb: e.target.value })}
                  placeholder="500"
                  className="w-28 appearance-none rounded border border-border bg-bg px-2 py-1 text-right text-xs text-text placeholder:text-text-subtle/70 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
                />
              </label>
            </div>
          </Sec>
          <Sec label="AI model">
            <select
              value={draft.primaryModelKey}
              onChange={(e) => onPatch({ primaryModelKey: e.target.value })}
              className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50"
            >
              <option value="">platform default</option>
              {availableModelKeys.length > 0
                ? Object.entries(
                    availableModelKeys.reduce<Record<string, string[]>>(
                      (acc, { provider, model }) => {
                        (acc[provider] ??= []).push(model);
                        return acc;
                      },
                      {}
                    )
                  ).map(([provider, models]) => (
                    <optgroup key={provider} label={provider}>
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </optgroup>
                  ))
                : null}
            </select>
          </Sec>
        </div>
      </div>

      {/* row 5: tool activations */}
      <Sec label="Tool activations">
        <ToolActivationsEdit
          activations={editableActivations}
          onUpdate={(updated) => onPatch({ toolActivations: updated })}
          videoGenerateModelKey={draft.videoGenerateModelKey}
          onVideoGenerateModelKeyChange={(videoGenerateModelKey) =>
            onPatch({ videoGenerateModelKey })
          }
        />
        <p className="mt-1 text-[10px] text-text-subtle">
          System tools are managed by the platform and are shown in plan summaries as read-only.
        </p>
      </Sec>
    </div>
  );
}

/* ─── Compact read-only plan card ─── */

function PlanCardReadOnly({
  plan,
  onEdit,
  disabled
}: {
  plan: AdminPlanState;
  onEdit: () => void;
  disabled: boolean;
}) {
  const e = plan.entitlements;
  const [expanded, setExpanded] = useState(false);
  const { planManaged, platformManaged, hiddenInternal } = splitToolActivationsByPolicy(
    plan.toolActivations ?? []
  );

  const channels = [
    e.channelsAndSurfaces.webChat && "Web",
    e.channelsAndSurfaces.telegram && "TG",
    e.channelsAndSurfaces.whatsapp && "WA",
    e.channelsAndSurfaces.max && "Max"
  ].filter(Boolean);

  const toolClasses = [
    e.toolClasses.costDrivingTools && "Cost",
    e.toolClasses.utilityTools && "Util",
    e.toolClasses.costDrivingQuotaGoverned && "CostQ",
    e.toolClasses.utilityQuotaGoverned && "UtilQ"
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-border bg-surface-raised">
      {/* header line */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-text-muted hover:text-text"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <span className="text-xs font-semibold text-text">{plan.displayName}</span>
        <span className="font-mono text-[10px] text-text-muted">{plan.code}</span>
        <Pill variant={plan.status === "active" ? "default" : "dim"}>{plan.status}</Pill>
        {plan.defaultOnRegistration && <Pill variant="green">default</Pill>}
        {plan.trialEnabled && <Pill variant="amber">trial {plan.trialDurationDays}d</Pill>}
        <span className="flex-1" />
        <span className="text-[10px] text-text-subtle">
          {new Date(plan.updatedAt).toLocaleDateString()}
        </span>
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          className="ml-1 inline-flex items-center gap-0.5 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40"
        >
          <Pencil className="h-2.5 w-2.5" /> Edit
        </button>
      </div>

      {/* collapsed summary line */}
      {!expanded && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 border-t border-border/50 px-3 py-1.5 text-[10px]">
          <KV label="Channels">{channels.join(", ")}</KV>
          <KV label="Tools">{toolClasses.join(", ")}</KV>
          <span className="text-text-subtle">|</span>
          <ToolActivationsInline activations={[...planManaged, ...platformManaged]} />
        </div>
      )}

      {/* expanded details */}
      {expanded && (
        <div className="space-y-2 border-t border-border/50 px-3 py-2">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <KV label="Description">{plan.description ?? "—"}</KV>
            {plan.metadata.commercialTag && <KV label="Tag">{plan.metadata.commercialTag}</KV>}
            {plan.metadata.notes && <KV label="Notes">{plan.metadata.notes}</KV>}
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1 rounded border border-border bg-surface px-3 py-1.5">
            <Sec label="Tool classes">
              <div className="flex flex-wrap gap-1">
                {[
                  { l: "Cost-driving", on: e.toolClasses.costDrivingTools },
                  { l: "Utility", on: e.toolClasses.utilityTools },
                  { l: "Cost quota", on: e.toolClasses.costDrivingQuotaGoverned },
                  { l: "Util quota", on: e.toolClasses.utilityQuotaGoverned }
                ].map((c) => (
                  <Pill key={c.l} variant={c.on ? "default" : "dim"}>
                    {c.l}
                  </Pill>
                ))}
              </div>
            </Sec>
            <Sec label="Channels">
              <div className="flex flex-wrap gap-1">
                {[
                  { l: "Web", on: e.channelsAndSurfaces.webChat },
                  { l: "TG", on: e.channelsAndSurfaces.telegram },
                  { l: "WA", on: e.channelsAndSurfaces.whatsapp },
                  { l: "Max", on: e.channelsAndSurfaces.max }
                ].map((c) => (
                  <Pill key={c.l} variant={c.on ? "default" : "dim"}>
                    {c.l}
                  </Pill>
                ))}
              </div>
            </Sec>
            <div className="space-y-1">
              <Sec label="Runtime tier">
                <span className="text-[10px] text-text-subtle">
                  {RUNTIME_TIER_OPTIONS.find(
                    (option) =>
                      option.value === (plan.runtimeTierDefault ?? "free_shared_restricted")
                  )?.label ?? "Free shared restricted"}
                </span>
              </Sec>
              <Sec label="Quota limits">
                <div className="space-y-0.5 text-[10px] text-text-subtle">
                  <div>Token budget: {plan.quotaLimits?.tokenBudgetLimit ?? "default"}</div>
                  <div>
                    Media upload budget:{" "}
                    {plan.quotaLimits?.mediaStorageBytesLimit != null
                      ? `${String(Math.round(plan.quotaLimits.mediaStorageBytesLimit / 1048576))} MB`
                      : "default"}
                  </div>
                  <div>
                    Workspace disk:{" "}
                    {plan.quotaLimits?.workspaceStorageBytesLimit != null
                      ? `${String(Math.round(plan.quotaLimits.workspaceStorageBytesLimit / 1048576))} MB`
                      : "500 MB"}
                  </div>
                </div>
              </Sec>
              <Sec label="AI model">
                <span className="text-[10px] text-text-subtle">
                  {plan.primaryModelKey ?? "platform default"}
                </span>
              </Sec>
              <Sec label="Video model">
                <span className="text-[10px] text-text-subtle">
                  {plan.videoGenerateModelKey ?? "sora-2 (default)"}
                </span>
              </Sec>
            </div>
          </div>
          <ToolActivationReadOnlyGroup
            title="Plan-managed tools"
            emptyLabel="No editable tools configured."
            activations={planManaged}
          />
          <ToolActivationReadOnlyGroup
            title="Platform-managed tools"
            emptyLabel="No platform-managed tools."
            activations={platformManaged}
            showLimits={false}
          />
          <ToolActivationReadOnlyGroup
            title="Hidden internal tools"
            emptyLabel="No hidden internal tools."
            activations={hiddenInternal}
            showLimits={false}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Page ─── */

export default function AdminPlansPage() {
  const { getToken } = useAuth();
  const [plans, setPlans] = useState<AdminPlanState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; message: string } | null>(
    null
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<PlanDraft>(() => emptyDraft());
  const [createCode, setCreateCode] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<PlanDraft | null>(null);
  const [availableModelKeys, setAvailableModelKeys] = useState<
    { provider: string; model: string }[]
  >([]);
  const [reapplying, setReapplying] = useState(false);
  const [reapplySummary, setReapplySummary] = useState<ForceReapplyAllSummary | null>(null);

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
      const [plansData, runtimeData] = await Promise.all([
        getAdminPlans(token),
        getAdminRuntimeProviderSettings(token).catch(() => null)
      ]);
      setPlans(plansData);
      if (runtimeData?.availableModelsByProvider) {
        const keys: { provider: string; model: string }[] = [];
        for (const [provider, models] of Object.entries(
          runtimeData.availableModelsByProvider as unknown as Record<string, string[]>
        )) {
          for (const model of models) {
            keys.push({ provider, model });
          }
        }
        setAvailableModelKeys(keys);
      }
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to load plans."
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

  const handleForceReapplyAll = useCallback(async () => {
    if (
      !window.confirm(
        "This will re-materialize ALL assistants immediately. This may take a while. Continue?"
      )
    )
      return;
    const token = await getToken();
    if (!token) return;
    setReapplying(true);
    setReapplySummary(null);
    setFeedback(null);
    try {
      const summary = await postAdminForceReapplyAll(token);
      setReapplySummary(summary);
      setFeedback({
        kind: "success",
        message: `Force reapply complete: ${String(summary.succeeded)} succeeded, ${String(summary.failed)} failed, ${String(summary.skipped)} skipped.`
      });
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Force reapply failed."
      });
    }
    setReapplying(false);
  }, [getToken]);

  const openCreate = useCallback(() => {
    setEditingCode(null);
    setEditDraft(null);
    const draft = emptyDraft();
    const templatePlan = plans.find(
      (p) => (p.toolActivations ?? []).filter((ta) => ta.visibleInPlanEditor).length > 0
    );
    if (templatePlan) {
      draft.toolActivations = (templatePlan.toolActivations ?? [])
        .filter((ta) => ta.visibleInPlanEditor)
        .map((ta) => ({
          toolCode: ta.toolCode,
          displayName: ta.displayName,
          toolClass: ta.toolClass,
          policyClass: ta.policyClass,
          active: false,
          dailyCallLimit: null
        }));
    }
    setCreateDraft(draft);
    setCreateCode("");
    setCreateOpen((o) => !o);
    setFeedback(null);
  }, [plans]);

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
        ...draftToPayload(createDraft)
      };
      await postAdminPlanCreate(token, body);
      setFeedback({ kind: "success", message: "Plan created." });
      closeCreate();
      await load();
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Create failed."
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
      await patchAdminPlan(token, editingCode, draftToPayload(editDraft));
      setFeedback({ kind: "success", message: "Plan updated." });
      cancelEdit();
      await load();
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Update failed."
      });
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
      </div>
    );
  }

  return (
    <div className="text-text">
      {/* header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CreditCard className="h-4 w-4 text-accent" />
          <h1 className="text-sm font-bold text-text">Plans</h1>
          <span className="text-[10px] text-text-muted">({plans.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleForceReapplyAll()}
            disabled={reapplying || saving}
            className="inline-flex items-center gap-1 rounded border border-orange-400/40 bg-orange-500/10 px-2 py-1 text-[10px] font-semibold text-orange-600 transition-colors hover:bg-orange-500/20 disabled:opacity-50"
          >
            {reapplying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Force reapply all
          </button>
          <button
            type="button"
            onClick={openCreate}
            disabled={saving}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold transition-colors",
              createOpen
                ? "border-border bg-surface-hover text-text"
                : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
            )}
          >
            {createOpen ? (
              <>
                <X className="h-3 w-3" /> Close
              </>
            ) : (
              <>
                <Plus className="h-3 w-3" /> New plan
              </>
            )}
          </button>
        </div>
      </div>

      {/* feedback */}
      {feedback && (
        <div
          className={cn(
            "mb-3 flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px]",
            feedback.kind === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          )}
        >
          {feedback.kind === "success" ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          {feedback.message}
        </div>
      )}

      {reapplySummary && (
        <div className="mb-3 rounded border border-orange-400/30 bg-orange-500/10 p-2.5 text-[11px] text-orange-300">
          <span className="font-semibold">Reapply summary:</span> {reapplySummary.totalAssistants}{" "}
          total, {reapplySummary.withPublishedVersion} with version, {reapplySummary.succeeded}{" "}
          succeeded, {reapplySummary.degraded} degraded, {reapplySummary.failed} failed,{" "}
          {reapplySummary.skipped} skipped
        </div>
      )}

      {/* create form */}
      {createOpen && (
        <form
          onSubmit={(ev) => void onCreateSubmit(ev)}
          className="mb-4 rounded-lg border border-accent/20 bg-surface-raised p-3"
        >
          <h2 className="mb-2 text-xs font-semibold text-text">New plan</h2>
          <PlanForm
            draft={createDraft}
            onPatch={patchCreate}
            showCode
            code={createCode}
            onCodeChange={setCreateCode}
            availableModelKeys={availableModelKeys}
          />
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-accent px-3 py-1 text-[11px] font-semibold text-bg hover:opacity-90 disabled:opacity-40"
            >
              {saving ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Save"}
            </button>
            <button
              type="button"
              onClick={closeCreate}
              disabled={saving}
              className="rounded border border-border px-3 py-1 text-[11px] text-text-muted hover:text-text disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* plan list */}
      {plans.length === 0 ? (
        <p className="text-xs text-text-subtle">No plans configured.</p>
      ) : (
        <div className="space-y-2">
          {plans.map((plan) => {
            const isEditing = editingCode === plan.code && editDraft !== null;
            if (isEditing && editDraft) {
              return (
                <form
                  key={plan.code}
                  onSubmit={(ev) => void onEditSubmit(ev)}
                  className="rounded-lg border border-accent/20 bg-surface-raised p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-xs font-semibold text-text">
                      Editing <span className="font-mono text-text-muted">{plan.code}</span>
                    </h2>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="text-text-muted hover:text-text"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <PlanForm
                    draft={editDraft}
                    onPatch={patchEdit}
                    showCode={false}
                    code=""
                    onCodeChange={() => {}}
                    availableModelKeys={availableModelKeys}
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded bg-accent px-3 py-1 text-[11px] font-semibold text-bg hover:opacity-90 disabled:opacity-40"
                    >
                      {saving ? (
                        <Loader2 className="inline h-3 w-3 animate-spin" />
                      ) : (
                        "Save changes"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={saving}
                      className="rounded border border-border px-3 py-1 text-[11px] text-text-muted hover:text-text disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              );
            }
            return (
              <PlanCardReadOnly
                key={plan.code}
                plan={plan}
                onEdit={() => startEdit(plan)}
                disabled={saving || createOpen}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
