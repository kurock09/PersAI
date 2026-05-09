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
}> = [
  {
    value: "image_generate",
    label: "Image Generate"
  },
  {
    value: "image_edit",
    label: "Image Edit"
  },
  {
    value: "video_generate",
    label: "Video Generate"
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
      <label className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">
        {label}
        {tip && <span className="ml-1 font-normal normal-case text-text-subtle/60"> — {tip}</span>}
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
      className="h-7 rounded border border-border/70 bg-surface px-2 text-[11px] text-text placeholder:text-text-subtle/40 focus:outline-none focus:ring-1 focus:ring-accent/50"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function PackageCard({
  item,
  onEdit,
  onDelete,
  disabled,
  deleting
}: {
  item: MediaPackageCatalogItem;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
  deleting: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-surface p-3 transition-colors",
        !item.isActive && "opacity-50"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <div className="text-lg font-semibold tabular-nums text-text">{item.units}</div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-text-subtle">units</div>
          </div>
          <div className="mt-1 text-[12px] font-medium text-text">
            {formatPrice(item.amountMinor, item.currency)}
          </div>
          {(item.title.ru || item.title.en) && (
            <div className="mt-1 text-[11px] text-text-subtle">
              {item.title.ru && item.title.en
                ? `${item.title.ru} / ${item.title.en}`
                : (item.title.ru ?? item.title.en)}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[10px] font-medium text-text-subtle transition-colors hover:border-border hover:text-text disabled:opacity-30"
            title="Edit"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled || deleting}
            className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[10px] font-medium text-text-subtle transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-30"
            title="Delete"
          >
            {deleting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Delete
          </button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-border/70 bg-bg/60 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-text-subtle">
          order {item.displayOrder}
        </span>
        <span className="rounded-full border border-border/70 bg-bg/60 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-text-subtle">
          {item.currency}
        </span>
        {(item.badge.ru || item.badge.en) && (
          <span className="rounded-full border border-border/70 bg-bg/60 px-2 py-0.5 text-[9px] text-text-subtle">
            {item.badge.ru && item.badge.en
              ? `${item.badge.ru} / ${item.badge.en}`
              : (item.badge.ru ?? item.badge.en)}
          </span>
        )}
        {!item.isActive && (
          <span className="rounded-full border border-destructive/20 bg-destructive/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-destructive/70">
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
      className="space-y-3 rounded-md border border-accent/20 bg-surface-raised p-3"
    >
      <div className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">
        {mode === "create" ? "New preset" : "Edit preset"}
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
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
            className="h-7 rounded border border-border/70 bg-surface px-2 text-[11px] text-text focus:outline-none focus:ring-1 focus:ring-accent/50"
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
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-text-subtle">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => onPatch({ isActive: e.target.checked })}
            className="h-3 w-3 rounded border-border bg-surface-raised text-accent focus:ring-1 focus:ring-accent/50"
          />
          Active (visible to users)
        </label>
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      <div className="flex gap-2 pt-0.5">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1 rounded border border-border/70 bg-surface px-2.5 py-1 text-[11px] font-medium text-text transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          {mode === "create" ? "Create" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded border border-border/70 px-2.5 py-1 text-[11px] text-text-subtle transition-colors hover:border-border hover:text-text disabled:opacity-40"
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
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">
          {type.label}
        </span>
        {!createOpen && editingId === null && (
          <button
            type="button"
            onClick={() => {
              setCreateOpen(true);
              setCreateDraft(emptyDraft());
              setError(null);
            }}
            disabled={isDisabled}
            className="flex items-center gap-1 rounded border border-border/60 px-2 py-0.5 text-[10px] text-text-subtle transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-30"
          >
            <Plus className="h-2.5 w-2.5" />
            Add preset
          </button>
        )}
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      <div className="grid gap-2">
        {items.map((item) =>
          editingId === item.id ? (
            <div key={item.id}>
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
              onEdit={() => startEdit(item)}
              onDelete={() => void handleDelete(item.id)}
              disabled={isDisabled}
              deleting={deletingId === item.id}
            />
          )
        )}
        {items.length === 0 && !createOpen && (
          <p className="text-[11px] text-text-subtle/60 italic">No presets yet.</p>
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
    <div className="mt-8 space-y-4 rounded-xl border border-border/70 bg-surface-raised p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text">
            Media packages
          </h3>
          <p className="mt-0.5 text-[10px] text-text-subtle/80">
            One-time purchasable quota boosts. Active during the current subscription period.
          </p>
        </div>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-subtle" />}
      </div>

      <div className="space-y-5">
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
    </div>
  );
}
