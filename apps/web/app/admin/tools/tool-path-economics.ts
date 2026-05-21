export type ToolPathCode = "web_search" | "web_fetch" | "browser" | "document_render";

export type ToolPathBillingMode = "fixed_operation" | "time_metered" | "tiered_operation";

export type ToolPathTier = {
  label: string;
  matchValue: string | null;
  price: number;
};

export type ToolPathPricingRowState = {
  pathKey: string;
  toolCode: ToolPathCode;
  providerId: string;
  billingMode: ToolPathBillingMode;
  active: boolean;
  configured: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  displayLabel?: string | null;
  notes?: string | null;
  providerPriceMetadata:
    | {
        currency: string;
        fixedOperationPricing: {
          unitLabel: string | null;
          pricePerOperation: number;
        };
      }
    | {
        currency: string;
        timePricing: {
          unit: "second" | "minute";
          pricePerUnit: number;
        };
      }
    | {
        currency: string;
        tieredOperationPricing: {
          unitLabel: string | null;
          tiers: ToolPathTier[];
        };
      };
};

export type AdminToolPathEconomicsState = {
  schema: string;
  rows: ToolPathPricingRowState[];
  notes: string[];
};

export function cloneEconomicsRows(rows: ToolPathPricingRowState[]): ToolPathPricingRowState[] {
  return rows.map((row) => ({
    ...row,
    providerPriceMetadata: cloneProviderPriceMetadata(row.providerPriceMetadata)
  }));
}

function cloneProviderPriceMetadata(
  metadata: ToolPathPricingRowState["providerPriceMetadata"]
): ToolPathPricingRowState["providerPriceMetadata"] {
  if ("fixedOperationPricing" in metadata) {
    return {
      currency: metadata.currency,
      fixedOperationPricing: { ...metadata.fixedOperationPricing }
    };
  }
  if ("timePricing" in metadata) {
    return {
      currency: metadata.currency,
      timePricing: { ...metadata.timePricing }
    };
  }
  return {
    currency: metadata.currency,
    tieredOperationPricing: {
      ...metadata.tieredOperationPricing,
      tiers: metadata.tieredOperationPricing.tiers.map((tier) => ({ ...tier }))
    }
  };
}

export function updateEconomicsRow(
  rows: ToolPathPricingRowState[],
  pathKey: string,
  updater: (row: ToolPathPricingRowState) => ToolPathPricingRowState
): ToolPathPricingRowState[] {
  return rows.map((row) => (row.pathKey === pathKey ? updater(row) : row));
}

export function rowsForToolCode(
  rows: ToolPathPricingRowState[],
  toolCode: ToolPathCode
): ToolPathPricingRowState[] {
  return rows.filter((row) => row.toolCode === toolCode);
}

export function toolPathProviderLabel(providerId: string): string {
  switch (providerId) {
    case "tavily":
      return "Tavily";
    case "brave":
      return "Brave";
    case "perplexity":
      return "Perplexity";
    case "google":
      return "Google";
    case "firecrawl":
      return "Firecrawl";
    case "browserless":
      return "Browserless";
    case "pdfmonkey":
      return "PDFMonkey";
    case "gamma":
      return "Gamma";
    default:
      return providerId;
  }
}

export function buildEconomicsPutPayload(rows: ToolPathPricingRowState[]): {
  rows: Array<Omit<ToolPathPricingRowState, "configured">>;
} {
  return {
    rows: rows.map((row) => {
      const { configured, ...payload } = row;
      void configured;
      return payload;
    })
  };
}

export function parseNonNegativeNumberInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}
