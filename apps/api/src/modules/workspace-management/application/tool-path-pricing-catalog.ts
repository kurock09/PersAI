import type {
  RuntimeProviderBillingMode,
  RuntimeProviderFixedOperationModelProfile,
  RuntimeProviderFixedOperationPriceConfig,
  RuntimeProviderModelCapability,
  RuntimeProviderTieredOperationModelProfile,
  RuntimeProviderTieredOperationPriceConfig,
  RuntimeProviderTimeMeteredModelProfile,
  RuntimeProviderTimeMeteredPriceConfig,
  RuntimeVideoModelKind
} from "./runtime-provider-profile";
import { createDefaultRuntimeProviderPriceMetadata } from "./runtime-provider-profile";

export const TOOL_PATH_PRICING_CATALOG_SCHEMA = "persai.toolPathPricingCatalog.v1";

export const TOOL_PATH_CODES = ["web_search", "web_fetch", "browser", "document_render"] as const;

export type ToolPathCode = (typeof TOOL_PATH_CODES)[number];

export type ToolPathBillingMode = Extract<
  RuntimeProviderBillingMode,
  "fixed_operation" | "time_metered" | "tiered_operation"
>;

export const TOOL_PATH_BILLING_MODES: ToolPathBillingMode[] = [
  "fixed_operation",
  "time_metered",
  "tiered_operation"
];

export type ToolPathLedgerPurpose = "web_search" | "web_fetch" | "browser" | "document_render";

type ToolPathPricingRowBase = {
  pathKey: string;
  toolCode: ToolPathCode;
  providerId: string;
  active: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  displayLabel: string | null;
  notes: string | null;
};

export type ToolPathFixedOperationPricingRow = ToolPathPricingRowBase & {
  billingMode: "fixed_operation";
  providerPriceMetadata: RuntimeProviderFixedOperationPriceConfig;
};

export type ToolPathTimeMeteredPricingRow = ToolPathPricingRowBase & {
  billingMode: "time_metered";
  providerPriceMetadata: RuntimeProviderTimeMeteredPriceConfig;
};

export type ToolPathTieredOperationPricingRow = ToolPathPricingRowBase & {
  billingMode: "tiered_operation";
  providerPriceMetadata: RuntimeProviderTieredOperationPriceConfig;
};

export type ToolPathPricingRow =
  | ToolPathFixedOperationPricingRow
  | ToolPathTimeMeteredPricingRow
  | ToolPathTieredOperationPricingRow;

export type ToolPathPricingCatalogRecord = {
  schema: typeof TOOL_PATH_PRICING_CATALOG_SCHEMA;
  rows: ToolPathPricingRow[];
};

export type AdminToolPathPricingRowState = ToolPathPricingRow & {
  configured: boolean;
};

export type AdminToolPathPricingCatalogState = {
  schema: typeof TOOL_PATH_PRICING_CATALOG_SCHEMA;
  rows: AdminToolPathPricingRowState[];
  notes: string[];
};

export type AdminToolPathPricingCatalogRequest = {
  rows: ToolPathPricingRow[];
};

const DEFAULT_TOOL_PATH_PROVIDER_BY_CODE: Record<ToolPathCode, readonly string[]> = {
  web_search: ["tavily", "brave", "perplexity", "google"],
  web_fetch: ["firecrawl"],
  browser: ["browserless"],
  document_render: ["gamma"]
};

const DEFAULT_TOOL_PATH_BILLING_MODE: Record<ToolPathCode, ToolPathBillingMode> = {
  web_search: "fixed_operation",
  web_fetch: "fixed_operation",
  browser: "time_metered",
  document_render: "tiered_operation"
};

export function buildToolPathKey(toolCode: ToolPathCode, providerId: string): string {
  return `${toolCode}:${providerId.trim()}`;
}

export function resolveToolPathLedgerPurpose(toolCode: ToolPathCode): ToolPathLedgerPurpose {
  return toolCode;
}

export function isToolPathLedgerPurpose(value: string): value is ToolPathLedgerPurpose {
  return (
    value === "web_search" ||
    value === "web_fetch" ||
    value === "browser" ||
    value === "document_render"
  );
}

export function isToolPathCode(value: string): value is ToolPathCode {
  return (TOOL_PATH_CODES as readonly string[]).includes(value);
}

export function createDefaultToolPathPricingCatalog(): ToolPathPricingCatalogRecord {
  const rows: ToolPathPricingRow[] = [];
  for (const toolCode of TOOL_PATH_CODES) {
    const billingMode = DEFAULT_TOOL_PATH_BILLING_MODE[toolCode];
    for (const providerId of DEFAULT_TOOL_PATH_PROVIDER_BY_CODE[toolCode]) {
      rows.push(
        createDefaultToolPathPricingRow({
          toolCode,
          providerId,
          billingMode
        })
      );
    }
  }
  return {
    schema: TOOL_PATH_PRICING_CATALOG_SCHEMA,
    rows
  };
}

export function createDefaultToolPathPricingRow(input: {
  toolCode: ToolPathCode;
  providerId: string;
  billingMode: ToolPathBillingMode;
}): ToolPathPricingRow {
  const pathKey = buildToolPathKey(input.toolCode, input.providerId);
  const base = {
    pathKey,
    toolCode: input.toolCode,
    providerId: input.providerId,
    active: true,
    effectiveFrom: null,
    effectiveTo: null,
    displayLabel: null,
    notes: null
  };
  if (input.billingMode === "fixed_operation") {
    return {
      ...base,
      billingMode: "fixed_operation",
      providerPriceMetadata: createDefaultRuntimeProviderPriceMetadata(
        "fixed_operation"
      ) as RuntimeProviderFixedOperationPriceConfig
    };
  }
  if (input.billingMode === "time_metered") {
    return {
      ...base,
      billingMode: "time_metered",
      providerPriceMetadata: createDefaultRuntimeProviderPriceMetadata(
        "time_metered"
      ) as RuntimeProviderTimeMeteredPriceConfig
    };
  }
  return {
    ...base,
    billingMode: "tiered_operation",
    providerPriceMetadata:
      input.toolCode === "document_render"
        ? createDefaultDocumentRenderTieredPriceMetadata(input.providerId)
        : (createDefaultRuntimeProviderPriceMetadata(
            "tiered_operation"
          ) as RuntimeProviderTieredOperationPriceConfig)
  };
}

function createDefaultDocumentRenderTieredPriceMetadata(
  _providerId: string
): RuntimeProviderTieredOperationPriceConfig {
  const base = createDefaultRuntimeProviderPriceMetadata(
    "tiered_operation"
  ) as RuntimeProviderTieredOperationPriceConfig;
  return {
    ...base,
    tieredOperationPricing: {
      unitLabel: "document",
      tiers: [
        { label: "PDF export", matchValue: "pdf", price: 0 },
        { label: "PPTX export", matchValue: "pptx", price: 0 }
      ]
    }
  };
}

export function normalizeToolPathPricingCatalogRecord(
  value: unknown
): ToolPathPricingCatalogRecord {
  if (value === null || value === undefined) {
    return createDefaultToolPathPricingCatalog();
  }
  const row = asObject(value, "toolPathPricingCatalog");
  const schema =
    typeof row.schema === "string" && row.schema.trim().length > 0
      ? row.schema.trim()
      : TOOL_PATH_PRICING_CATALOG_SCHEMA;
  if (schema !== TOOL_PATH_PRICING_CATALOG_SCHEMA) {
    throw new Error(`Unsupported tool path pricing catalog schema "${schema}".`);
  }
  const rawRows = Array.isArray(row.rows) ? row.rows : [];
  const parsedRows = rawRows.map((entry, index) =>
    parseToolPathPricingRow(entry, `rows[${index}]`)
  );
  return mergeWithDefaultToolPathPricingCatalog(parsedRows);
}

export function parseAdminToolPathPricingCatalogRequest(
  body: unknown
): AdminToolPathPricingCatalogRequest {
  const row = asObject(body, "Request body");
  const rawRows = Array.isArray(row.rows) ? row.rows : null;
  if (rawRows === null) {
    throw new Error("rows must be an array.");
  }
  const rows = rawRows.map((entry, index) => parseToolPathPricingRow(entry, `rows[${index}]`));
  assertUniquePathKeys(rows);
  return { rows };
}

export function buildAdminToolPathPricingCatalogState(
  catalog: ToolPathPricingCatalogRecord
): AdminToolPathPricingCatalogState {
  return {
    schema: TOOL_PATH_PRICING_CATALOG_SCHEMA,
    rows: catalog.rows.map((entry) => ({
      ...entry,
      configured: isToolPathPricingRowConfigured(entry)
    })),
    notes: [
      "Tool-path pricing is separate from Admin > Runtime model catalog. API keys stay on Admin > Tools; unit prices here feed the money ledger.",
      "Ledger purposes: web_search, web_fetch, browser, document_render. Successful tool calls emit billing facts when provider paths succeed.",
      "Prices use the same catalog numeric units as Runtime fixed/time/tiered fields. Zero prices still write ledger rows at 0 cost."
    ]
  };
}

export function findToolPathPricingRowForTimestamp(
  catalog: ToolPathPricingCatalogRecord,
  pathKey: string,
  occurredAt: Date
): ToolPathPricingRow | null {
  const normalizedPathKey = pathKey.trim();
  const matches = catalog.rows.filter((row) => row.pathKey === normalizedPathKey && row.active);
  if (matches.length === 0) {
    return null;
  }
  const effectiveMatches = matches.filter((row) => isEffectiveAt(row, occurredAt));
  if (effectiveMatches.length === 0) {
    return null;
  }
  return (
    effectiveMatches
      .slice()
      .sort((left, right) =>
        compareEffectiveFromDesc(left.effectiveFrom, right.effectiveFrom)
      )[0] ?? null
  );
}

export function resolveToolPathKeyFromBillingFacts(input: {
  capability: string;
  providerKey: string;
  modelKey: string;
}): string | null {
  if (!isToolPathCode(input.capability)) {
    return null;
  }
  const providerId = input.providerKey.trim();
  if (providerId.length === 0) {
    return null;
  }
  const explicitPathKey = input.modelKey.trim();
  if (explicitPathKey.includes(":")) {
    return explicitPathKey;
  }
  return buildToolPathKey(input.capability, providerId);
}

function mergeWithDefaultToolPathPricingCatalog(
  parsedRows: ToolPathPricingRow[]
): ToolPathPricingCatalogRecord {
  const defaults = createDefaultToolPathPricingCatalog();
  const byPathKey = new Map<string, ToolPathPricingRow>();
  for (const row of defaults.rows) {
    byPathKey.set(row.pathKey, row);
  }
  for (const row of parsedRows) {
    byPathKey.set(row.pathKey, row);
  }
  return {
    schema: TOOL_PATH_PRICING_CATALOG_SCHEMA,
    rows: [...byPathKey.values()].sort((left, right) => left.pathKey.localeCompare(right.pathKey))
  };
}

function parseToolPathPricingRow(value: unknown, label: string): ToolPathPricingRow {
  const row = asObject(value, label);
  const toolCode = parseToolPathCode(row.toolCode, `${label}.toolCode`);
  const providerId = parseNonEmptyString(row.providerId, `${label}.providerId`);
  const pathKey =
    typeof row.pathKey === "string" && row.pathKey.trim().length > 0
      ? row.pathKey.trim()
      : buildToolPathKey(toolCode, providerId);
  if (pathKey !== buildToolPathKey(toolCode, providerId)) {
    throw new Error(`${label}.pathKey must match toolCode:providerId.`);
  }
  const billingMode = parseToolPathBillingMode(row.billingMode, `${label}.billingMode`);
  const active = row.active === undefined ? true : Boolean(row.active);
  const effectiveFrom = parseOptionalIsoTimestamp(row.effectiveFrom, `${label}.effectiveFrom`);
  const effectiveTo = parseOptionalIsoTimestamp(row.effectiveTo, `${label}.effectiveTo`);
  const displayLabel = parseOptionalString(row.displayLabel);
  const notes = parseOptionalString(row.notes);
  const base = {
    pathKey,
    toolCode,
    providerId,
    active,
    effectiveFrom,
    effectiveTo,
    displayLabel,
    notes
  };
  const providerPriceMetadata = row.providerPriceMetadata;
  if (billingMode === "fixed_operation") {
    return {
      ...base,
      billingMode,
      providerPriceMetadata: parseFixedOperationPriceMetadata(
        providerPriceMetadata,
        `${label}.providerPriceMetadata`
      )
    };
  }
  if (billingMode === "time_metered") {
    return {
      ...base,
      billingMode,
      providerPriceMetadata: parseTimeMeteredPriceMetadata(
        providerPriceMetadata,
        `${label}.providerPriceMetadata`
      )
    };
  }
  return {
    ...base,
    billingMode,
    providerPriceMetadata: parseTieredOperationPriceMetadata(
      providerPriceMetadata,
      `${label}.providerPriceMetadata`
    )
  };
}

function parseToolPathBillingMode(value: unknown, label: string): ToolPathBillingMode {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "fixed_operation" ||
    normalized === "time_metered" ||
    normalized === "tiered_operation"
  ) {
    return normalized;
  }
  throw new Error(
    `${label} must be one of ${TOOL_PATH_BILLING_MODES.join(", ")} (got ${String(value)}).`
  );
}

function parseToolPathCode(value: unknown, label: string): ToolPathCode {
  if (typeof value !== "string" || !isToolPathCode(value.trim())) {
    throw new Error(`${label} must be one of ${TOOL_PATH_CODES.join(", ")}.`);
  }
  return value.trim() as ToolPathCode;
}

function parseFixedOperationPriceMetadata(
  value: unknown,
  label: string
): RuntimeProviderFixedOperationPriceConfig {
  const defaults = createDefaultRuntimeProviderPriceMetadata(
    "fixed_operation"
  ) as RuntimeProviderFixedOperationPriceConfig;
  const row = asObject(value, label);
  return {
    currency: parseCurrency(row.currency, `${label}.currency`, defaults.currency),
    fixedOperationPricing: {
      unitLabel:
        typeof row.fixedOperationPricing === "object" &&
        row.fixedOperationPricing !== null &&
        typeof (row.fixedOperationPricing as Record<string, unknown>).unitLabel === "string"
          ? ((row.fixedOperationPricing as Record<string, unknown>).unitLabel as string)
          : defaults.fixedOperationPricing.unitLabel,
      pricePerOperation: parseNonNegativeNumber(
        typeof row.fixedOperationPricing === "object" && row.fixedOperationPricing !== null
          ? (row.fixedOperationPricing as Record<string, unknown>).pricePerOperation
          : row.pricePerOperation,
        `${label}.fixedOperationPricing.pricePerOperation`,
        defaults.fixedOperationPricing.pricePerOperation
      )
    }
  };
}

function parseTimeMeteredPriceMetadata(
  value: unknown,
  label: string
): RuntimeProviderTimeMeteredPriceConfig {
  const defaults = createDefaultRuntimeProviderPriceMetadata(
    "time_metered"
  ) as RuntimeProviderTimeMeteredPriceConfig;
  const row = asObject(value, label);
  const nested =
    typeof row.timePricing === "object" && row.timePricing !== null
      ? (row.timePricing as Record<string, unknown>)
      : row;
  const unit =
    nested.unit === "minute" || nested.unit === "second" ? nested.unit : defaults.timePricing.unit;
  return {
    currency: parseCurrency(row.currency, `${label}.currency`, defaults.currency),
    timePricing: {
      unit,
      pricePerUnit: parseNonNegativeNumber(
        nested.pricePerUnit,
        `${label}.timePricing.pricePerUnit`,
        defaults.timePricing.pricePerUnit
      )
    }
  };
}

function parseTieredOperationPriceMetadata(
  value: unknown,
  label: string
): RuntimeProviderTieredOperationPriceConfig {
  const defaults = createDefaultRuntimeProviderPriceMetadata(
    "tiered_operation"
  ) as RuntimeProviderTieredOperationPriceConfig;
  const row = asObject(value, label);
  const nested =
    typeof row.tieredOperationPricing === "object" && row.tieredOperationPricing !== null
      ? (row.tieredOperationPricing as Record<string, unknown>)
      : row;
  const rawTiers = Array.isArray(nested.tiers)
    ? nested.tiers
    : defaults.tieredOperationPricing.tiers;
  const tiers = rawTiers.map((tier, index) => {
    const tierRow = asObject(tier, `${label}.tiers[${index}]`);
    return {
      label: parseNonEmptyString(tierRow.label, `${label}.tiers[${index}].label`),
      matchValue:
        tierRow.matchValue === null || tierRow.matchValue === undefined
          ? null
          : parseNonEmptyString(tierRow.matchValue, `${label}.tiers[${index}].matchValue`),
      price: parseNonNegativeNumber(tierRow.price, `${label}.tiers[${index}].price`, 0)
    };
  });
  if (tiers.length === 0) {
    throw new Error(`${label}.tiers must contain at least one tier.`);
  }
  return {
    currency: parseCurrency(row.currency, `${label}.currency`, defaults.currency),
    tieredOperationPricing: {
      unitLabel:
        typeof nested.unitLabel === "string"
          ? nested.unitLabel
          : defaults.tieredOperationPricing.unitLabel,
      tiers
    }
  };
}

function isToolPathPricingRowConfigured(row: ToolPathPricingRow): boolean {
  if (row.billingMode === "fixed_operation") {
    return row.providerPriceMetadata.fixedOperationPricing.pricePerOperation > 0;
  }
  if (row.billingMode === "time_metered") {
    return row.providerPriceMetadata.timePricing.pricePerUnit > 0;
  }
  return row.providerPriceMetadata.tieredOperationPricing.tiers.some((tier) => tier.price > 0);
}

function isEffectiveAt(row: ToolPathPricingRow, occurredAt: Date): boolean {
  const from = row.effectiveFrom === null ? null : new Date(row.effectiveFrom);
  const to = row.effectiveTo === null ? null : new Date(row.effectiveTo);
  if (from !== null && !Number.isNaN(from.getTime()) && occurredAt < from) {
    return false;
  }
  if (to !== null && !Number.isNaN(to.getTime()) && occurredAt >= to) {
    return false;
  }
  return true;
}

function compareEffectiveFromDesc(left: string | null, right: string | null): number {
  const leftMs = left === null ? Number.NEGATIVE_INFINITY : new Date(left).getTime();
  const rightMs = right === null ? Number.NEGATIVE_INFINITY : new Date(right).getTime();
  return rightMs - leftMs;
}

function assertUniquePathKeys(rows: ToolPathPricingRow[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.pathKey)) {
      throw new Error(`Duplicate tool path pricing row "${row.pathKey}".`);
    }
    seen.add(row.pathKey);
  }
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function parseOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("Optional string fields must be strings when provided.");
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOptionalIsoTimestamp(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be an ISO timestamp string when provided.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
  return parsed.toISOString();
}

function parseCurrency(value: unknown, label: string, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "string" || value.trim().length !== 3) {
    throw new Error(`${label} must be a 3-letter currency code.`);
  }
  return value.trim().toUpperCase();
}

function parseNonNegativeNumber(value: unknown, label: string, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}

export type ToolPathPricingProfileForLedger =
  | RuntimeProviderFixedOperationModelProfile
  | RuntimeProviderTimeMeteredModelProfile
  | RuntimeProviderTieredOperationModelProfile;

export function toToolPathPricingProfileForLedger(
  row: ToolPathPricingRow
): ToolPathPricingProfileForLedger {
  const base = {
    model: row.pathKey,
    capabilities: [] as RuntimeProviderModelCapability[],
    kind: "cinematic" as RuntimeVideoModelKind,
    active: row.active,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    inputTokenWeight: 0,
    cachedInputTokenWeight: 0,
    outputTokenWeight: 0,
    maxOutputTokens: null as number | null,
    contextWindow: null as number | null,
    promptCacheRetention: null as "in_memory" | "24h" | null,
    promptCachePolicy: null,
    displayLabel: row.displayLabel,
    notes: row.notes
  };
  if (row.billingMode === "fixed_operation") {
    return {
      ...base,
      billingMode: "fixed_operation",
      providerPriceMetadata: row.providerPriceMetadata
    };
  }
  if (row.billingMode === "time_metered") {
    return {
      ...base,
      billingMode: "time_metered",
      providerPriceMetadata: row.providerPriceMetadata
    };
  }
  return {
    ...base,
    billingMode: "tiered_operation",
    providerPriceMetadata: row.providerPriceMetadata
  };
}
