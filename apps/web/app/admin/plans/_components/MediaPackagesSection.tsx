"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Plus, Trash2, Loader2, Pencil } from "lucide-react";
import type { MediaPackageCatalogItem } from "@/app/app/assistant-api-client";
import {
  patchAdminMediaPackage,
  postAdminMediaPackage,
  deleteAdminMediaPackage
} from "@/app/app/assistant-api-client";
import { cn } from "@/app/lib/utils";

type PackageType = "image_generate" | "image_edit" | "video_generate";

const PACKAGE_TYPES: Array<{
  value: PackageType;
  label: string;
  watermark: React.ReactNode;
}> = [
  {
    value: "image_generate",
    label: "Image Generate",
    watermark: (
      <svg
        viewBox="0 0 80 80"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full opacity-[0.06] transition-opacity group-hover:opacity-[0.11]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      >
        <rect x="10" y="10" width="60" height="60" rx="6" />
        <circle cx="40" cy="36" r="10" />
        <path d="M10 56 L28 38 L42 52 L56 38 L70 56" />
      </svg>
    )
  },
  {
    value: "image_edit",
    label: "Image Edit",
    watermark: (
      <svg
        viewBox="0 0 80 80"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full opacity-[0.06] transition-opacity group-hover:opacity-[0.11]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      >
        <rect x="12" y="12" width="56" height="56" rx="6" />
        <path d="M26 54 L38 30 L50 54" />
        <path d="M30 46 H46" />
        <line x1="54" y1="26" x2="62" y2="18" />
      </svg>
    )
  },
  {
    value: "video_generate",
    label: "Video Generate",
    watermark: (
      <svg
        viewBox="0 0 80 80"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full opacity-[0.06] transition-opacity group-hover:opacity-[0.11]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      >
        <rect x="8" y="20" width="48" height="40" rx="4" />
        <path d="M56 32 L72 24 L72 56 L56 48 Z" />
        <line x1="20" y1="30" x2="20" y2="50" />
        <line x1="30" y1="28" x2="30" y2="52" />
        <line x1="40" y1="30" x2="40" y2="50" />
      </svg>
    )
  }
];

type PackageDraft = {
  units: string;
  amountMinor: string;
  currency: "RUB" | "USD";
  isActive: boolean;
  displayOrder: string;
  titleRu: string;
  titleEn: string;
  subtitleRu: string;
  subtitleEn: string;
  badgeRu: string;
  badgeEn: string;
};

function emptyDraft(): PackageDraft {
  return {
    units: "",
    amountMinor: "",
    currency: "RUB",
    isActive: true,
    displayOrder: "0",
    titleRu: "",
    titleEn: "",
    subtitleRu: "",
    subtitleEn: "",
    badgeRu: "",
    badgeEn: ""
  };
}

function draftToPayload(
  draft: PackageDraft,
  packageType: PackageType
): Parameters<typeof postAdminMediaPackage>[1] {
  return {
    packageType,
    units: parseInt(draft.units, 10),
    amountMinor: parseInt(draft.amountMinor, 10),
    currency: draft.currency,
    isActive: draft.isActive,
    displayOrder: parseInt(draft.displayOrder, 10) || 0,
    titleRu: draft.titleRu.trim(),
    titleEn: draft.titleEn.trim(),
    subtitleRu: draft.subtitleRu.trim(),
    subtitleEn: draft.subtitleEn.trim(),
    badgeRu: draft.badgeRu.trim(),
    badgeEn: draft.badgeEn.trim()
  };
}

function formatPrice(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2
    }).format(amountMinor / 100);
  } catch {
    return `${amountMinor / 100} ${currency}`;
  }
}

function Field({
  label,
  children,
  tip
}: {
  label: string;
  children: React.ReactNode;
  tip?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
        {tip && <span className="ml-1 font-normal normal-case text-zinc-600"> — {tip}</span>}
      </label>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text"
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      className="h-8 rounded border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function PackageCard({
  item,
  watermark,
  onEdit,
  onDelete,
  disabled,
  deleting
}: {
  item: MediaPackageCatalogItem;
  watermark: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
  deleting: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition-colors",
        !item.isActive && "opacity-40"
      )}
    >
      {watermark}
      <div className="relative z-10 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-2xl font-semibold tabular-nums text-zinc-100">{item.units}</div>
          <div className="mt-0.5 text-xs text-zinc-500">units</div>
          <div className="mt-2 text-sm font-medium text-zinc-200">
            {formatPrice(item.amountMinor, item.currency)}
          </div>
          {(item.title.ru || item.title.en) && (
            <div className="mt-1 text-xs text-zinc-400">
              {item.title.ru && item.title.en
                ? `${item.title.ru} / ${item.title.en}`
                : (item.title.ru ?? item.title.en)}
            </div>
          )}
          {(item.badge.ru || item.badge.en) && (
            <span className="mt-1 inline-block rounded-full border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {item.badge.ru && item.badge.en
                ? `${item.badge.ru} / ${item.badge.en}`
                : (item.badge.ru ?? item.badge.en)}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={disabled}
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled || deleting}
            className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400 disabled:opacity-30"
            title="Delete"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
      <div className="relative z-10 mt-2 flex flex-wrap gap-1">
        <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          order {item.displayOrder}
        </span>
        {!item.isActive && (
          <span className="rounded-full bg-red-950/40 px-1.5 py-0.5 text-[10px] text-red-500/70">
            inactive
          </span>
        )}
      </div>
    </div>
  );
}

function PackageForm({
  draft,
  onPatch,
  onSubmit,
  onCancel,
  saving,
  error,
  mode
}: {
  draft: PackageDraft;
  onPatch: (patch: Partial<PackageDraft>) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  mode: "create" | "edit";
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 space-y-3"
    >
      <div className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        {mode === "create" ? "New preset" : "Edit preset"}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Units" tip="e.g. 10">
          <TextInput
            value={draft.units}
            onChange={(v) => onPatch({ units: v })}
            placeholder="10"
            type="number"
          />
        </Field>
        <Field label="Price (minor)" tip="kopecks / cents">
          <TextInput
            value={draft.amountMinor}
            onChange={(v) => onPatch({ amountMinor: v })}
            placeholder="10000"
            type="number"
          />
        </Field>
        <Field label="Currency">
          <select
            className="h-8 rounded border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-600"
            value={draft.currency}
            onChange={(e) => onPatch({ currency: e.target.value as "RUB" | "USD" })}
          >
            <option value="RUB">RUB</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field label="Title RU">
          <TextInput
            value={draft.titleRu}
            onChange={(v) => onPatch({ titleRu: v })}
            placeholder="10 генераций"
          />
        </Field>
        <Field label="Title EN">
          <TextInput
            value={draft.titleEn}
            onChange={(v) => onPatch({ titleEn: v })}
            placeholder="10 generations"
          />
        </Field>
        <Field label="Order">
          <TextInput
            value={draft.displayOrder}
            onChange={(v) => onPatch({ displayOrder: v })}
            placeholder="0"
            type="number"
          />
        </Field>
        <Field label="Subtitle RU">
          <TextInput value={draft.subtitleRu} onChange={(v) => onPatch({ subtitleRu: v })} />
        </Field>
        <Field label="Subtitle EN">
          <TextInput value={draft.subtitleEn} onChange={(v) => onPatch({ subtitleEn: v })} />
        </Field>
        <Field label="Badge RU">
          <TextInput
            value={draft.badgeRu}
            onChange={(v) => onPatch({ badgeRu: v })}
            placeholder="Popular"
          />
        </Field>
        <Field label="Badge EN">
          <TextInput
            value={draft.badgeEn}
            onChange={(v) => onPatch({ badgeEn: v })}
            placeholder="Popular"
          />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => onPatch({ isActive: e.target.checked })}
            className="accent-zinc-400"
          />
          Active (visible to users)
        </label>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          {mode === "create" ? "Create" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-300 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function PackageTypeSection({
  type,
  items,
  token,
  onRefresh,
  disabled
}: {
  type: (typeof PACKAGE_TYPES)[number];
  items: MediaPackageCatalogItem[];
  token: string;
  onRefresh: () => void;
  disabled: boolean;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<PackageDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<PackageDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      setSaving(true);
      try {
        await postAdminMediaPackage(token, draftToPayload(createDraft, type.value));
        setCreateOpen(false);
        setCreateDraft(emptyDraft());
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setSaving(false);
      }
    },
    [token, createDraft, type.value, onRefresh]
  );

  const handleEdit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!editingId) return;
      setError(null);
      setSaving(true);
      try {
        await patchAdminMediaPackage(token, editingId, draftToPayload(editDraft, type.value));
        setEditingId(null);
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setSaving(false);
      }
    },
    [token, editingId, editDraft, type.value, onRefresh]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await deleteAdminMediaPackage(token, id);
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setDeletingId(null);
      }
    },
    [token, onRefresh]
  );

  const startEdit = (item: MediaPackageCatalogItem) => {
    setEditingId(item.id);
    setEditDraft({
      units: String(item.units),
      amountMinor: String(item.amountMinor),
      currency: item.currency,
      isActive: item.isActive,
      displayOrder: String(item.displayOrder),
      titleRu: item.title.ru,
      titleEn: item.title.en,
      subtitleRu: item.subtitle.ru,
      subtitleEn: item.subtitle.en,
      badgeRu: item.badge.ru,
      badgeEn: item.badge.en
    });
    setError(null);
  };

  const isDisabled = disabled || saving || !!deletingId;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
          {type.label}
        </h4>
        {!createOpen && editingId === null && (
          <button
            type="button"
            onClick={() => {
              setCreateOpen(true);
              setCreateDraft(emptyDraft());
              setError(null);
            }}
            disabled={isDisabled}
            className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-300 disabled:opacity-30"
          >
            <Plus className="h-3 w-3" />
            Add preset
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) =>
          editingId === item.id ? (
            <div key={item.id} className="col-span-2 sm:col-span-3 lg:col-span-4">
              <PackageForm
                draft={editDraft}
                onPatch={(patch) => setEditDraft((prev) => ({ ...prev, ...patch }))}
                onSubmit={handleEdit}
                onCancel={() => {
                  setEditingId(null);
                  setError(null);
                }}
                saving={saving}
                error={error}
                mode="edit"
              />
            </div>
          ) : (
            <PackageCard
              key={item.id}
              item={item}
              watermark={type.watermark}
              onEdit={() => startEdit(item)}
              onDelete={() => void handleDelete(item.id)}
              disabled={isDisabled}
              deleting={deletingId === item.id}
            />
          )
        )}
        {items.length === 0 && !createOpen && (
          <p className="col-span-2 text-xs text-zinc-600 sm:col-span-3 lg:col-span-4">
            No presets yet.
          </p>
        )}
      </div>

      {createOpen && (
        <PackageForm
          draft={createDraft}
          onPatch={(patch) => setCreateDraft((prev) => ({ ...prev, ...patch }))}
          onSubmit={handleCreate}
          onCancel={() => {
            setCreateOpen(false);
            setError(null);
          }}
          saving={saving}
          error={error}
          mode="create"
        />
      )}
    </div>
  );
}

export function MediaPackagesSection({
  packages,
  token,
  onRefresh,
  loading,
  disabled
}: {
  packages: MediaPackageCatalogItem[];
  token: string;
  onRefresh: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <div className="space-y-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Media packages</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            One-time purchasable quota boosts. Active during the current subscription period.
          </p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
      </div>

      {PACKAGE_TYPES.map((type) => (
        <PackageTypeSection
          key={type.value}
          type={type}
          items={packages.filter((p) => p.packageType === type.value)}
          token={token}
          onRefresh={onRefresh}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
