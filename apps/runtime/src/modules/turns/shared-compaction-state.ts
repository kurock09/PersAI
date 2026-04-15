import type {
  PersaiRuntimeSharedCompactionToolCode,
  ProviderGatewayStructuredOutputSchema
} from "@persai/runtime-contract";

const MAX_PROVIDER_OUTPUT_CHARS = 12_000;
const MAX_SECTION_ITEMS = 6;
const MAX_ITEM_CHARS = 240;

const SHARED_COMPACTION_SECTION_ORDER = [
  "stableFacts",
  "userPreferences",
  "assistantCommitments",
  "openThreads",
  "importantReferences"
] as const;

type SharedCompactionSectionKey = (typeof SHARED_COMPACTION_SECTION_ORDER)[number];

type SharedCompactionSections = Record<SharedCompactionSectionKey, string[]>;

type SharedCompactionSectionDefinition = {
  key: SharedCompactionSectionKey;
  label: string;
};

const SHARED_COMPACTION_SECTION_DEFINITIONS: SharedCompactionSectionDefinition[] = [
  {
    key: "stableFacts",
    label: "Stable facts"
  },
  {
    key: "userPreferences",
    label: "User preferences"
  },
  {
    key: "assistantCommitments",
    label: "Assistant commitments"
  },
  {
    key: "openThreads",
    label: "Open threads"
  },
  {
    key: "importantReferences",
    label: "Important references"
  }
];

export const REUSABLE_SHARED_COMPACTION_SCHEMA = "persai.runtimeSessionCompaction.v2" as const;
export const MAX_REUSABLE_COMPACTION_SECTION_ITEMS = MAX_SECTION_ITEMS;
export const MAX_REUSABLE_COMPACTION_TOTAL_ITEMS =
  SHARED_COMPACTION_SECTION_ORDER.length * MAX_SECTION_ITEMS;
export const REUSABLE_SHARED_COMPACTION_OUTPUT_SCHEMA: ProviderGatewayStructuredOutputSchema = {
  name: "persai_runtime_session_compaction",
  description:
    "Structured durable runtime summary for later turns. Each field contains short neutral notes only.",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [...SHARED_COMPACTION_SECTION_ORDER],
    properties: SHARED_COMPACTION_SECTION_ORDER.reduce<Record<string, Record<string, unknown>>>(
      (properties, key) => {
        properties[key] = {
          type: "array",
          items: {
            type: "string",
            maxLength: MAX_ITEM_CHARS
          },
          maxItems: MAX_SECTION_ITEMS
        };
        return properties;
      },
      {}
    )
  }
};

export const REUSABLE_SHARED_COMPACTION_OUTPUT_REJECTION_REASONS = [
  "empty_output",
  "output_too_long",
  "invalid_json",
  "invalid_sections"
] as const;

export type ReusableSharedCompactionOutputRejectionReason =
  (typeof REUSABLE_SHARED_COMPACTION_OUTPUT_REJECTION_REASONS)[number];

export interface StoredReusableCompactionState extends Record<string, unknown> {
  schema: typeof REUSABLE_SHARED_COMPACTION_SCHEMA;
  toolCode: PersaiRuntimeSharedCompactionToolCode;
  summarizedMessageCount: number;
  preservedRecentMessageCount: number;
  sections: SharedCompactionSections;
}

export interface ParsedReusableCompactionState {
  payload: StoredReusableCompactionState;
  summaryText: string;
  summarizedMessageCount: number;
}

export interface NormalizedReusableCompactionStateResult {
  parsed: ParsedReusableCompactionState | null;
  rejectionReason: ReusableSharedCompactionOutputRejectionReason | null;
}

export function normalizeReusableCompactionStateFromModelOutput(input: {
  rawOutputText: string;
  toolCode: PersaiRuntimeSharedCompactionToolCode;
  summarizedMessageCount: number;
  preservedRecentMessageCount: number;
  summaryCharBudget: number;
}): NormalizedReusableCompactionStateResult {
  const normalizedOutput = normalizeOptionalText(input.rawOutputText);
  if (normalizedOutput === null) {
    return {
      parsed: null,
      rejectionReason: "empty_output"
    };
  }
  if (normalizedOutput.length > MAX_PROVIDER_OUTPUT_CHARS) {
    return {
      parsed: null,
      rejectionReason: "output_too_long"
    };
  }

  const parsed = parseJsonObject(unwrapJsonCodeFence(normalizedOutput));
  if (parsed === null) {
    return {
      parsed: null,
      rejectionReason: "invalid_json"
    };
  }

  const sections = normalizeReusableCompactionSections(parsed, input.summaryCharBudget);
  if (sections === null) {
    return {
      parsed: null,
      rejectionReason: "invalid_sections"
    };
  }

  const payload: StoredReusableCompactionState = {
    schema: REUSABLE_SHARED_COMPACTION_SCHEMA,
    toolCode: input.toolCode,
    summarizedMessageCount: input.summarizedMessageCount,
    preservedRecentMessageCount: input.preservedRecentMessageCount,
    sections
  };
  const summaryText = renderReusableCompactionSummaryText(sections, input.summaryCharBudget);
  return {
    parsed: {
      payload,
      summaryText,
      summarizedMessageCount: input.summarizedMessageCount
    },
    rejectionReason: null
  };
}

export function parseStoredReusableCompactionState(
  payload: unknown,
  summaryCharBudget: number
): ParsedReusableCompactionState | null {
  const row = asObject(payload);
  if (row?.schema !== REUSABLE_SHARED_COMPACTION_SCHEMA) {
    return null;
  }

  const toolCode = row.toolCode;
  if (toolCode !== "compact_context" && toolCode !== "summarize_context") {
    return null;
  }

  const summarizedMessageCount =
    Number.isInteger(row.summarizedMessageCount) && Number(row.summarizedMessageCount) > 0
      ? Number(row.summarizedMessageCount)
      : null;
  const preservedRecentMessageCount =
    Number.isInteger(row.preservedRecentMessageCount) &&
    Number(row.preservedRecentMessageCount) >= 0
      ? Number(row.preservedRecentMessageCount)
      : null;
  const sections = normalizeReusableCompactionSections(row.sections, summaryCharBudget);
  if (
    summarizedMessageCount === null ||
    preservedRecentMessageCount === null ||
    sections === null
  ) {
    return null;
  }

  const normalizedPayload: StoredReusableCompactionState = {
    schema: REUSABLE_SHARED_COMPACTION_SCHEMA,
    toolCode,
    summarizedMessageCount,
    preservedRecentMessageCount,
    sections
  };
  return {
    payload: normalizedPayload,
    summaryText: renderReusableCompactionSummaryText(sections, summaryCharBudget),
    summarizedMessageCount
  };
}

export function renderReusableCompactionSummaryText(
  sections: SharedCompactionSections,
  maxChars: number
): string {
  const lines: string[] = [];
  for (const definition of SHARED_COMPACTION_SECTION_DEFINITIONS) {
    const items = sections[definition.key];
    if (items.length === 0) {
      continue;
    }
    lines.push(`${definition.label}:`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
  }

  if (lines.length === 0) {
    return "No durable facts or open threads were retained from earlier summarized context.";
  }
  return joinSummaryLinesWithinBudget(lines, Math.max(1, maxChars));
}

function joinSummaryLinesWithinBudget(lines: string[], maxChars: number): string {
  let summaryText = "";
  for (const line of lines) {
    const remainingChars = summaryText.length === 0 ? maxChars : maxChars - summaryText.length - 1;
    if (remainingChars <= 0) {
      break;
    }

    const nextLine = truncateSummaryLine(line, remainingChars);
    if (nextLine.length === 0) {
      break;
    }
    summaryText = summaryText.length === 0 ? nextLine : `${summaryText}\n${nextLine}`;
    if (nextLine.length < line.length) {
      break;
    }
  }
  return summaryText;
}

function truncateSummaryLine(line: string, maxChars: number): string {
  if (line.length <= maxChars) {
    return line;
  }
  if (maxChars <= 3) {
    return line.slice(0, maxChars);
  }
  return `${line.slice(0, maxChars - 3).trimEnd()}...`;
}

function normalizeReusableCompactionSections(
  payload: unknown,
  summaryCharBudget: number
): SharedCompactionSections | null {
  const row = resolveCompactionSectionsRow(payload);
  if (row === null || countRecognizedSectionKeys(row) === 0) {
    return null;
  }

  const sections = createEmptySharedCompactionSections();
  for (const key of SHARED_COMPACTION_SECTION_ORDER) {
    const rawItems = row[key];
    if (rawItems === undefined || rawItems === null) {
      continue;
    }
    if (!Array.isArray(rawItems)) {
      return null;
    }

    const seenItems = new Set<string>();
    for (const rawItem of rawItems) {
      if (typeof rawItem !== "string") {
        return null;
      }

      const normalizedItem = normalizeCompactionItem(rawItem);
      if (normalizedItem === null) {
        return null;
      }
      if (normalizedItem.length === 0) {
        continue;
      }

      const dedupeKey = normalizedItem.toLowerCase();
      if (seenItems.has(dedupeKey)) {
        continue;
      }

      sections[key].push(normalizedItem);
      seenItems.add(dedupeKey);
      if (sections[key].length > MAX_SECTION_ITEMS) {
        return null;
      }
    }
  }

  const renderedSummaryText = renderReusableCompactionSummaryText(sections, summaryCharBudget);
  return renderedSummaryText.length === 0 ? null : sections;
}

function resolveCompactionSectionsRow(payload: unknown): Record<string, unknown> | null {
  const row = asObject(payload);
  if (row === null) {
    return null;
  }

  const nestedSections = asObject(row.sections);
  if (
    nestedSections !== null &&
    countRecognizedSectionKeys(nestedSections) > countRecognizedSectionKeys(row)
  ) {
    return nestedSections;
  }
  return row;
}

function countRecognizedSectionKeys(payload: Record<string, unknown>): number {
  let count = 0;
  for (const key of SHARED_COMPACTION_SECTION_ORDER) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      count += 1;
    }
  }
  return count;
}

function normalizeCompactionItem(value: string): string | null {
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/^[-*]\s+/, "")
    .trim();
  if (normalized.length === 0) {
    return "";
  }
  if (normalized.length > MAX_ITEM_CHARS || looksConversational(normalized)) {
    return null;
  }
  return normalized;
}

function looksConversational(value: string): boolean {
  return (
    /^(hi|hello|hey|sure|absolutely|of course|certainly|thanks|thank you|here(?:'s| is)|i can|i could|i have|i've|i am|i'm|let me|feel free|would you like|if you'd like|please)\b/i.test(
      value
    ) || /\b(how can i|let me know|happy to help)\b/i.test(value)
  );
}

function unwrapJsonCodeFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? value;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return asObject(parsed);
  } catch {
    return null;
  }
}

function createEmptySharedCompactionSections(): SharedCompactionSections {
  return {
    stableFacts: [],
    userPreferences: [],
    assistantCommitments: [],
    openThreads: [],
    importantReferences: []
  };
}

function normalizeOptionalText(value: string | null): string | null {
  return value === null || value.trim().length === 0 ? null : value.trim();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
