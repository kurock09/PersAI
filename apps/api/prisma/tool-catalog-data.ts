import type { ToolCatalogCapabilityGroup, ToolCatalogToolClass } from "@prisma/client";

export type ToolCatalogEntry = {
  id: string;
  code: string;
  displayName: string;
  description: string;
  capabilityGroup: ToolCatalogCapabilityGroup;
  toolClass: ToolCatalogToolClass;
  requiredCredentialId?: string;
};

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    id: "77777777-7777-7777-7777-777777777777",
    code: "web_search",
    displayName: "Web Search",
    description: "Provider-backed external web lookup tool.",
    capabilityGroup: "knowledge" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    requiredCredentialId: "tool_web_search"
  },
  {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    code: "web_fetch",
    displayName: "Web Fetch",
    description: "Structured webpage content extraction via Firecrawl or fallback fetch.",
    capabilityGroup: "knowledge" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    requiredCredentialId: "tool_web_fetch"
  },
  {
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    code: "image_generate",
    displayName: "Image Generate",
    description: "AI image generation via DALL-E or other supported providers.",
    capabilityGroup: "knowledge" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    requiredCredentialId: "tool_image_generate"
  },
  {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    code: "tts",
    displayName: "Text to Speech",
    description: "Text-to-speech synthesis via OpenAI TTS, ElevenLabs, or other providers.",
    capabilityGroup: "communication" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    requiredCredentialId: "tool_tts"
  },
  {
    id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    code: "browser",
    displayName: "Browser",
    description: "Automated web browser for interactive page navigation and content extraction.",
    capabilityGroup: "knowledge" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass
  },
  {
    id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    code: "memory_search",
    displayName: "Memory Search",
    description: "Semantic search across assistant memory using remote embeddings.",
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    requiredCredentialId: "tool_memory_search"
  },
  {
    id: "88888888-8888-8888-8888-888888888888",
    code: "memory_center_read",
    displayName: "Memory Center Read",
    description: "Utility read access for Memory Center summaries.",
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass
  },
  {
    id: "99999999-9999-9999-9999-999999999999",
    code: "tasks_center_control",
    displayName: "Tasks Center Control",
    description: "Utility control actions for task registry items.",
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass
  }
];

export const STARTER_TRIAL_TOOL_POLICY: Record<
  string,
  { active: boolean; dailyCallLimit: number | null }
> = {
  web_search: { active: true, dailyCallLimit: 30 },
  web_fetch: { active: true, dailyCallLimit: 20 },
  image_generate: { active: false, dailyCallLimit: null },
  tts: { active: false, dailyCallLimit: null },
  browser: { active: false, dailyCallLimit: null },
  memory_search: { active: true, dailyCallLimit: null },
  memory_center_read: { active: true, dailyCallLimit: null },
  tasks_center_control: { active: true, dailyCallLimit: null }
};
