import {
  validateTextGenerationUsageAccountingV2,
  type TextGenerationUsageAccountingEnvelope,
  type TextGenerationUsageAccountingV2
} from "@persai/runtime-contract";

export type DecodedTextGenerationUsage =
  | { kind: "v2"; usage: TextGenerationUsageAccountingEnvelope & { schemaVersion: 2 } }
  | { kind: "invalid"; reason: string };

export function decodeTextGenerationUsageForApi(
  textUsageAccounting: unknown
): DecodedTextGenerationUsage {
  if (textUsageAccounting === undefined) {
    return { kind: "invalid", reason: "usage_missing" };
  }
  if (
    textUsageAccounting === null ||
    typeof textUsageAccounting !== "object" ||
    Array.isArray(textUsageAccounting)
  ) {
    return { kind: "invalid", reason: "usage_envelope_invalid" };
  }
  const row = textUsageAccounting as Record<string, unknown>;
  if (row.schemaVersion !== 2) {
    return { kind: "invalid", reason: "usage_schema_version_unknown" };
  }
  if (!Array.isArray(row.entries)) {
    return { kind: "invalid", reason: "usage_entries_invalid" };
  }
  const entries: TextGenerationUsageAccountingV2[] = [];
  for (const entry of row.entries) {
    const result = validateTextGenerationUsageAccountingV2(entry);
    if (result.status !== "accounted") {
      return { kind: "invalid", reason: `usage_v2_${result.reason}` };
    }
    entries.push(result.entry);
  }
  const totals = {
    totalInputTokens: sum(entries, (entry) => entry.totalInputTokens),
    uncachedInputTokens: sum(entries, (entry) => entry.uncachedInputTokens),
    cacheWriteInputTokens: sum(entries, (entry) => entry.cacheWriteInputTokens),
    cacheReadInputTokens: sum(entries, (entry) => entry.cacheReadInputTokens),
    outputTokens: sum(entries, (entry) => entry.outputTokens),
    totalTokens: sum(entries, (entry) => entry.totalTokens)
  };
  for (const [key, expected] of Object.entries(totals)) {
    if (row[key] !== expected) {
      return { kind: "invalid", reason: `usage_v2_aggregate_${key}_mismatch` };
    }
  }
  return {
    kind: "v2",
    usage: {
      schemaVersion: 2,
      ...totals,
      entries
    }
  };
}

function sum(
  entries: TextGenerationUsageAccountingV2[],
  selector: (entry: TextGenerationUsageAccountingV2) => number
): number {
  return entries.reduce((total, entry) => total + selector(entry), 0);
}
