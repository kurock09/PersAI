import {
  validateTextGenerationUsageAccountingV2,
  type RuntimeUsageAccounting,
  type TextGenerationUsageAccountingEnvelope,
  type TextGenerationUsageAccountingV2
} from "@persai/runtime-contract";

export type DecodedTextGenerationUsage =
  | { kind: "v1"; usage: RuntimeUsageAccounting }
  | { kind: "v2"; usage: TextGenerationUsageAccountingEnvelope & { schemaVersion: 2 } }
  | { kind: "invalid"; reason: string };

/**
 * ADR-161 Release A/B consumer-first seam.
 * DELETE IN RELEASE C after the runtime v2 producer floor is active and all
 * v1-producing runtime pods and queued turn retries have drained.
 */
export function decodeTextGenerationUsageForApi(input: {
  textUsageAccounting: unknown;
  legacyUsageAccounting: RuntimeUsageAccounting | undefined;
}): DecodedTextGenerationUsage {
  if (input.textUsageAccounting === undefined) {
    return input.legacyUsageAccounting === undefined
      ? { kind: "invalid", reason: "usage_missing" }
      : { kind: "v1", usage: input.legacyUsageAccounting };
  }
  if (
    input.textUsageAccounting === null ||
    typeof input.textUsageAccounting !== "object" ||
    Array.isArray(input.textUsageAccounting)
  ) {
    return { kind: "invalid", reason: "usage_envelope_invalid" };
  }
  const row = input.textUsageAccounting as Record<string, unknown>;
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
