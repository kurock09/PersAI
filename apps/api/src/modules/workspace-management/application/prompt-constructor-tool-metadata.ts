import type { PromptTemplate } from "../domain/bootstrap-document-preset.repository";
import type { ToolCatalogPromptMetadataView } from "../domain/tool-catalog.entity";
import {
  buildSyntheticToolMetadataPromptTemplateId,
  HIDDEN_PROMPT_TEMPLATE_DEFAULTS
} from "../../../../prisma/bootstrap-preset-data";

export const PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER = [
  "summarize_context",
  "compact_context",
  "memory_write",
  "quota_status",
  "knowledge_search",
  "knowledge_fetch",
  "web_search",
  "web_fetch",
  "browser",
  "image_generate",
  "image_edit",
  "video_generate",
  "tts",
  "scheduled_action"
] as const;

export type PromptConstructorModelToolCode = (typeof PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER)[number];

type SyntheticNativeToolCode =
  | "summarize_context"
  | "compact_context"
  | "memory_write"
  | "quota_status"
  | "knowledge_search"
  | "knowledge_fetch";

type SyntheticNativeToolDefinition = ToolCatalogPromptMetadataView;

export const SYNTHETIC_PROMPT_CONSTRUCTOR_TOOL_DEFAULTS: Record<
  SyntheticNativeToolCode,
  SyntheticNativeToolDefinition
> = {
  summarize_context: {
    toolCode: "summarize_context",
    displayName: "Summarize Context",
    description: null,
    modelDescription: null,
    modelUsageGuidance: null,
    toolClass: "utility",
    capabilityGroup: "workspace_ops",
    policyClass: "platform_managed",
    catalogStatus: "active"
  },
  compact_context: {
    toolCode: "compact_context",
    displayName: "Compact Context",
    description: null,
    modelDescription: null,
    modelUsageGuidance: null,
    toolClass: "utility",
    capabilityGroup: "workspace_ops",
    policyClass: "platform_managed",
    catalogStatus: "active"
  },
  memory_write: {
    toolCode: "memory_write",
    displayName: "Memory Write",
    description: null,
    modelDescription: null,
    modelUsageGuidance: null,
    toolClass: "utility",
    capabilityGroup: "workspace_ops",
    policyClass: "platform_managed",
    catalogStatus: "active"
  },
  quota_status: {
    toolCode: "quota_status",
    displayName: "Quota Status",
    description: null,
    modelDescription: null,
    modelUsageGuidance: null,
    toolClass: "utility",
    capabilityGroup: "workspace_ops",
    policyClass: "platform_managed",
    catalogStatus: "active"
  },
  knowledge_search: {
    toolCode: "knowledge_search",
    displayName: "Knowledge Search",
    description: null,
    modelDescription: null,
    modelUsageGuidance: null,
    toolClass: "utility",
    capabilityGroup: "knowledge",
    policyClass: "platform_managed",
    catalogStatus: "active"
  },
  knowledge_fetch: {
    toolCode: "knowledge_fetch",
    displayName: "Knowledge Fetch",
    description: null,
    modelDescription: null,
    modelUsageGuidance: null,
    toolClass: "utility",
    capabilityGroup: "knowledge",
    policyClass: "platform_managed",
    catalogStatus: "active"
  }
};

function readStoredPromptValue(rows: PromptTemplate[], id: string): string | null {
  const raw = rows.find((row) => row.id === id)?.template ?? null;
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readDefaultPromptValue(id: string): string | null {
  const raw = HIDDEN_PROMPT_TEMPLATE_DEFAULTS[id] ?? null;
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function withOverrides(
  base: SyntheticNativeToolDefinition,
  rows: PromptTemplate[]
): SyntheticNativeToolDefinition {
  return {
    ...base,
    description:
      readStoredPromptValue(
        rows,
        buildSyntheticToolMetadataPromptTemplateId(
          base.toolCode as SyntheticNativeToolCode,
          "description"
        )
      ) ??
      readDefaultPromptValue(
        buildSyntheticToolMetadataPromptTemplateId(
          base.toolCode as SyntheticNativeToolCode,
          "description"
        )
      ) ??
      base.description,
    modelDescription:
      readStoredPromptValue(
        rows,
        buildSyntheticToolMetadataPromptTemplateId(
          base.toolCode as SyntheticNativeToolCode,
          "description"
        )
      ) ??
      readDefaultPromptValue(
        buildSyntheticToolMetadataPromptTemplateId(
          base.toolCode as SyntheticNativeToolCode,
          "description"
        )
      ) ??
      base.modelDescription,
    modelUsageGuidance:
      readStoredPromptValue(
        rows,
        buildSyntheticToolMetadataPromptTemplateId(
          base.toolCode as SyntheticNativeToolCode,
          "usage_guidance"
        )
      ) ??
      readDefaultPromptValue(
        buildSyntheticToolMetadataPromptTemplateId(
          base.toolCode as SyntheticNativeToolCode,
          "usage_guidance"
        )
      ) ??
      base.modelUsageGuidance
  };
}

export function isSyntheticPromptConstructorToolCode(
  toolCode: string
): toolCode is SyntheticNativeToolCode {
  return toolCode in SYNTHETIC_PROMPT_CONSTRUCTOR_TOOL_DEFAULTS;
}

export function getSyntheticPromptConstructorToolStorageIds(toolCode: SyntheticNativeToolCode): {
  descriptionId: string;
  usageGuidanceId: string;
} {
  return {
    descriptionId: buildSyntheticToolMetadataPromptTemplateId(toolCode, "description"),
    usageGuidanceId: buildSyntheticToolMetadataPromptTemplateId(toolCode, "usage_guidance")
  };
}

export function listSyntheticPromptConstructorTools(
  rows: PromptTemplate[]
): ToolCatalogPromptMetadataView[] {
  return sortPromptConstructorTools(
    Object.values(SYNTHETIC_PROMPT_CONSTRUCTOR_TOOL_DEFAULTS).map((tool) =>
      withOverrides(tool, rows)
    )
  );
}

export function resolveSyntheticPromptConstructorTool(
  toolCode: SyntheticNativeToolCode,
  rows: PromptTemplate[]
): ToolCatalogPromptMetadataView {
  return withOverrides(SYNTHETIC_PROMPT_CONSTRUCTOR_TOOL_DEFAULTS[toolCode], rows);
}

export function buildSyntheticPromptToolOverrideMap(
  rows: PromptTemplate[]
): Record<string, { description: string | null; usageGuidance: string | null }> {
  return Object.fromEntries(
    Object.keys(SYNTHETIC_PROMPT_CONSTRUCTOR_TOOL_DEFAULTS).map((toolCode) => {
      const resolved = resolveSyntheticPromptConstructorTool(
        toolCode as SyntheticNativeToolCode,
        rows
      );
      return [
        toolCode,
        {
          description: resolved.modelDescription,
          usageGuidance: resolved.modelUsageGuidance
        }
      ] as const;
    })
  );
}

export function sortPromptConstructorTools<T extends { toolCode: string }>(tools: T[]): T[] {
  const order = new Map<string, number>(
    PROMPT_CONSTRUCTOR_MODEL_TOOL_ORDER.map((toolCode, index) => [toolCode, index] as const)
  );
  return [...tools].sort((left, right) => {
    const leftIndex = order.get(left.toolCode);
    const rightIndex = order.get(right.toolCode);
    if (leftIndex !== undefined || rightIndex !== undefined) {
      return (leftIndex ?? Number.MAX_SAFE_INTEGER) - (rightIndex ?? Number.MAX_SAFE_INTEGER);
    }
    return left.toolCode.localeCompare(right.toolCode);
  });
}

export function joinPromptToolInstruction(
  description: string | null | undefined,
  usageGuidance: string | null | undefined
): string | null {
  const normalizedDescription = description?.trim() || null;
  const normalizedGuidance = usageGuidance?.trim() || null;
  if (!normalizedDescription && !normalizedGuidance) {
    return null;
  }
  if (!normalizedDescription) {
    return normalizedGuidance;
  }
  if (!normalizedGuidance) {
    return normalizedDescription;
  }
  return `${normalizedDescription} ${normalizedGuidance}`;
}

export function buildPromptToolMarkdownEntry(
  toolCode: string,
  description: string | null | undefined,
  usageGuidance: string | null | undefined
): string | null {
  const instruction = joinPromptToolInstruction(description, usageGuidance);
  if (!instruction) {
    return null;
  }
  return `**\`${toolCode}\`**\n${instruction}`;
}
