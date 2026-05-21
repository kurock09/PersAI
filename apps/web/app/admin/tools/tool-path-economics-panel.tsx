"use client";

import type { ToolPathCode, ToolPathPricingRowState, ToolPathTier } from "./tool-path-economics";
import {
  parseNonNegativeNumberInput,
  toolPathProviderLabel,
  updateEconomicsRow
} from "./tool-path-economics";

export function ToolPathEconomicsPanel({
  toolCode,
  rows,
  onRowsChange
}: {
  toolCode: ToolPathCode;
  rows: ToolPathPricingRowState[];
  onRowsChange: (rows: ToolPathPricingRowState[]) => void;
}) {
  const visibleRows = rows.filter((row) => row.toolCode === toolCode);
  if (visibleRows.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <div>
        <p className="text-xs font-semibold text-text">Per-path unit prices</p>
        <p className="text-[11px] text-text-muted">
          Ledger COGS on successful calls. Separate from API keys above.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {visibleRows.map((row) => (
          <ToolPathEconomicsRowCard
            key={row.pathKey}
            row={row}
            onChange={(nextRow) =>
              onRowsChange(updateEconomicsRow(rows, row.pathKey, () => nextRow))
            }
          />
        ))}
      </div>
    </div>
  );
}

function ToolPathEconomicsRowCard({
  row,
  onChange
}: {
  row: ToolPathPricingRowState;
  onChange: (row: ToolPathPricingRowState) => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface/60 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text">{toolPathProviderLabel(row.providerId)}</p>
          <p className="font-mono text-[10px] text-text-muted">{row.pathKey}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-text">
            <input
              type="checkbox"
              checked={row.active}
              onChange={(e) => onChange({ ...row, active: e.target.checked })}
            />
            Active
          </label>
          <span
            className={row.configured ? "text-[11px] text-success" : "text-[11px] text-text-subtle"}
          >
            {row.configured ? "Priced" : "Zero / unset"}
          </span>
        </div>
      </div>

      {row.billingMode === "fixed_operation" ? (
        <FixedOperationFields row={row} onChange={onChange} />
      ) : row.billingMode === "time_metered" ? (
        <TimeMeteredFields row={row} onChange={onChange} />
      ) : (
        <TieredOperationFields row={row} onChange={onChange} />
      )}
    </div>
  );
}

function FixedOperationFields({
  row,
  onChange
}: {
  row: ToolPathPricingRowState;
  onChange: (row: ToolPathPricingRowState) => void;
}) {
  if (!("fixedOperationPricing" in row.providerPriceMetadata)) {
    return null;
  }
  const metadata = row.providerPriceMetadata;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1 block text-[11px] text-text-muted">Price per operation</span>
        <input
          type="text"
          inputMode="decimal"
          value={String(metadata.fixedOperationPricing.pricePerOperation)}
          onChange={(e) => {
            const next = parseNonNegativeNumberInput(e.target.value);
            if (next === null && e.target.value.trim() !== "") {
              return;
            }
            onChange({
              ...row,
              providerPriceMetadata: {
                currency: metadata.currency,
                fixedOperationPricing: {
                  ...metadata.fixedOperationPricing,
                  pricePerOperation: next ?? 0
                }
              }
            });
          }}
          className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] text-text-muted">Unit label</span>
        <input
          type="text"
          value={metadata.fixedOperationPricing.unitLabel ?? ""}
          onChange={(e) =>
            onChange({
              ...row,
              providerPriceMetadata: {
                currency: metadata.currency,
                fixedOperationPricing: {
                  ...metadata.fixedOperationPricing,
                  unitLabel: e.target.value.trim().length > 0 ? e.target.value.trim() : null
                }
              }
            })
          }
          placeholder="search call"
          className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
        />
      </label>
    </div>
  );
}

function TimeMeteredFields({
  row,
  onChange
}: {
  row: ToolPathPricingRowState;
  onChange: (row: ToolPathPricingRowState) => void;
}) {
  if (!("timePricing" in row.providerPriceMetadata)) {
    return null;
  }
  const metadata = row.providerPriceMetadata;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1 block text-[11px] text-text-muted">Billable unit</span>
        <select
          value={metadata.timePricing.unit}
          onChange={(e) =>
            onChange({
              ...row,
              providerPriceMetadata: {
                currency: metadata.currency,
                timePricing: {
                  ...metadata.timePricing,
                  unit: e.target.value as "second" | "minute"
                }
              }
            })
          }
          className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
        >
          <option value="second">Per second</option>
          <option value="minute">Per minute</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] text-text-muted">Price per unit</span>
        <input
          type="text"
          inputMode="decimal"
          value={String(metadata.timePricing.pricePerUnit)}
          onChange={(e) => {
            const next = parseNonNegativeNumberInput(e.target.value);
            if (next === null && e.target.value.trim() !== "") {
              return;
            }
            onChange({
              ...row,
              providerPriceMetadata: {
                currency: metadata.currency,
                timePricing: {
                  ...metadata.timePricing,
                  pricePerUnit: next ?? 0
                }
              }
            });
          }}
          className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
        />
      </label>
    </div>
  );
}

function TieredOperationFields({
  row,
  onChange
}: {
  row: ToolPathPricingRowState;
  onChange: (row: ToolPathPricingRowState) => void;
}) {
  if (!("tieredOperationPricing" in row.providerPriceMetadata)) {
    return null;
  }
  const metadata = row.providerPriceMetadata;

  const updateTiers = (tiers: ToolPathTier[]) => {
    onChange({
      ...row,
      providerPriceMetadata: {
        currency: metadata.currency,
        tieredOperationPricing: {
          ...metadata.tieredOperationPricing,
          tiers
        }
      }
    });
  };

  return (
    <div className="space-y-2">
      {metadata.tieredOperationPricing.tiers.map((tier, index) => (
        <div key={`${row.pathKey}-${index}`} className="grid gap-2 sm:grid-cols-3">
          <label className="block sm:col-span-1">
            <span className="mb-1 block text-[11px] text-text-muted">Tier</span>
            <input
              type="text"
              value={tier.label}
              onChange={(e) => {
                updateTiers(
                  metadata.tieredOperationPricing.tiers.map((entry, tierIndex) =>
                    tierIndex === index ? { ...entry, label: e.target.value } : entry
                  )
                );
              }}
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
            />
          </label>
          <label className="block sm:col-span-1">
            <span className="mb-1 block text-[11px] text-text-muted">Match (outputFormat)</span>
            <input
              type="text"
              value={tier.matchValue ?? ""}
              onChange={(e) => {
                updateTiers(
                  metadata.tieredOperationPricing.tiers.map((entry, tierIndex) =>
                    tierIndex === index
                      ? {
                          ...entry,
                          matchValue:
                            e.target.value.trim().length > 0 ? e.target.value.trim() : null
                        }
                      : entry
                  )
                );
              }}
              placeholder="pdf"
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
            />
          </label>
          <label className="block sm:col-span-1">
            <span className="mb-1 block text-[11px] text-text-muted">Price</span>
            <input
              type="text"
              inputMode="decimal"
              value={String(tier.price)}
              onChange={(e) => {
                const next = parseNonNegativeNumberInput(e.target.value);
                if (next === null && e.target.value.trim() !== "") {
                  return;
                }
                updateTiers(
                  metadata.tieredOperationPricing.tiers.map((entry, tierIndex) =>
                    tierIndex === index ? { ...entry, price: next ?? 0 } : entry
                  )
                );
              }}
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text outline-none focus:border-border-strong"
            />
          </label>
        </div>
      ))}
    </div>
  );
}
