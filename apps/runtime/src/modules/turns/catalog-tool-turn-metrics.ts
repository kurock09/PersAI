import { APPROX_BYTES_PER_TOKEN } from "./model-output-budget";

/** ADR-135 S6 — per-turn catalog projection observability counters. */
export type CatalogToolTurnMetrics = {
  tools_json_char_count: number | null;
  catalog_describe_calls: number;
  tool_contract_not_loaded: number;
};

export function createEmptyCatalogToolTurnMetrics(): CatalogToolTurnMetrics {
  return {
    tools_json_char_count: null,
    catalog_describe_calls: 0,
    tool_contract_not_loaded: 0
  };
}

export function measureToolsJsonCharCount(tools: readonly unknown[] | undefined | null): number {
  if (tools === undefined || tools === null || tools.length === 0) {
    return 0;
  }
  return JSON.stringify(tools).length;
}

export function estimateToolsJsonTokens(charCount: number): number {
  if (charCount <= 0) {
    return 0;
  }
  return Math.ceil(charCount / APPROX_BYTES_PER_TOKEN);
}

export function recordFirstIterationToolsJsonCharCount(
  metrics: CatalogToolTurnMetrics,
  tools: readonly unknown[] | undefined | null
): void {
  if (metrics.tools_json_char_count !== null) {
    return;
  }
  metrics.tools_json_char_count = measureToolsJsonCharCount(tools);
}

export function recordCatalogDescribeCall(metrics: CatalogToolTurnMetrics): void {
  metrics.catalog_describe_calls += 1;
}

export function recordToolContractNotLoaded(metrics: CatalogToolTurnMetrics): void {
  metrics.tool_contract_not_loaded += 1;
}

export function formatCatalogToolTurnMetricsLog(params: {
  requestId: string;
  metrics: CatalogToolTurnMetrics;
}): string {
  const { metrics } = params;
  return `[turn-catalog-metrics] requestId=${params.requestId} tools_json_char_count=${String(metrics.tools_json_char_count ?? 0)} catalog_describe_calls=${String(metrics.catalog_describe_calls)} tool_contract_not_loaded=${String(metrics.tool_contract_not_loaded)}`;
}
