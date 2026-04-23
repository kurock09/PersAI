import type { ToolCatalogCapabilityGroup, ToolCatalogToolClass } from "@prisma/client";

export type ToolPolicyClass = "plan_managed" | "platform_managed" | "hidden_internal";

export type ToolCatalogEntry = {
  id: string;
  code: string;
  displayName: string;
  description: string;
  modelDescription?: string;
  modelUsageGuidance?: string;
  capabilityGroup: ToolCatalogCapabilityGroup;
  toolClass: ToolCatalogToolClass;
  requiredCredentialId?: string;
  policyClass?: ToolPolicyClass;
};

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    id: "77777777-7777-7777-7777-777777777777",
    code: "web_search",
    displayName: "Web Search",
    description: "Provider-backed external web lookup tool.",
    modelDescription: "Search the public web through the currently configured search provider.",
    modelUsageGuidance:
      "Use this when you need sources or links about a topic and do not already have one exact URL to fetch.",
    capabilityGroup: "knowledge" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    requiredCredentialId: "tool_web_search",
    policyClass: "plan_managed"
  },
  {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    code: "web_fetch",
    displayName: "Web Fetch",
    description: "Structured webpage content extraction via Firecrawl or fallback fetch.",
    modelDescription:
      "Fetch and extract the main content of a public webpage through the current web-fetch provider.",
    modelUsageGuidance:
      "Use this when you already know the exact URL and need page content, not a search results list.",
    capabilityGroup: "knowledge" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    requiredCredentialId: "tool_web_fetch",
    policyClass: "plan_managed"
  },
  {
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    code: "image_generate",
    displayName: "Image Generate",
    description: "AI image generation via DALL-E or other supported providers.",
    modelDescription: "Generate brand-new images from a text prompt.",
    modelUsageGuidance:
      "Use this for image creation only; do not use it for editing existing images or for video generation.",
    capabilityGroup: "knowledge" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    requiredCredentialId: "tool_image_generate",
    policyClass: "plan_managed"
  },
  {
    id: "15151515-1515-1515-1515-151515151515",
    code: "image_edit",
    displayName: "Image Edit",
    description:
      "Edit a single referenced image with prompt-guided changes through supported providers.",
    modelDescription:
      "Edit images only when the user explicitly asks to modify an image, for example replace, remove, add, recolor, restyle, insert, or draw something.",
    modelUsageGuidance:
      'Never use this tool for describing an image, OCR, solving a task from an image, or answering "what do you see". Use the current user message attachments only: with one image, edit that image; with multiple images, edit only the source image and return one edited version of that source image. Use optional referenceImageIndex only as a visual guide for style, appearance, makeup, color, lighting, or background cues from another current-turn image. If the user says things like "make it like the second photo", "как на втором фото", or similar, treat image #1 as the source and image #2 as the reference unless the user clearly says otherwise. Ask a clarifying question instead of guessing when the roles are still unclear.',
    capabilityGroup: "knowledge" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    requiredCredentialId: "tool_image_generate",
    policyClass: "plan_managed"
  },
  {
    id: "16161616-1616-1616-1616-161616161616",
    code: "video_generate",
    displayName: "Video Generate",
    description:
      "Generate a short video clip from a text prompt, optionally guided by one current-turn reference image.",
    modelDescription: "Generate a short brand-new video clip from a text prompt.",
    modelUsageGuidance:
      "Use this only when the user explicitly wants a generated video, animation, or clip. You may optionally guide the video with one current-turn image attachment as a first-frame style or appearance reference by setting referenceImageIndex. Do not use this tool for editing an existing video or for answering questions about an image.",
    capabilityGroup: "knowledge" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    requiredCredentialId: "tool_image_generate",
    policyClass: "plan_managed"
  },
  {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    code: "tts",
    displayName: "Text to Speech",
    description:
      "Text-to-speech synthesis via provider-specific TTS credentials with native provider fallback.",
    modelDescription: "Generate spoken audio for the current assistant persona.",
    modelUsageGuidance:
      "Use this only when the user explicitly wants a voice note, spoken reply, narration, or audio version of text.",
    capabilityGroup: "communication" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    policyClass: "plan_managed"
  },
  {
    id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    code: "browser",
    displayName: "Browser",
    description: "Automated web browser for interactive page navigation and content extraction.",
    modelDescription:
      "Use a real browser for JavaScript-rendered or interactive pages when web_search or web_fetch are insufficient.",
    modelUsageGuidance:
      "Use action=snapshot to inspect a page and action=act only after the user explicitly wants page interaction.",
    capabilityGroup: "knowledge" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    requiredCredentialId: "tool_browser",
    policyClass: "plan_managed"
  },
  {
    id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    code: "memory_search",
    displayName: "Knowledge Search",
    description:
      "Search assistant memory and indexed knowledge with lexical retrieval, bounded hybrid rerank, and optional helper-model follow-through when configured.",
    modelDescription:
      "Search the assistant's durable memory and related knowledge records for relevant prior facts.",
    modelUsageGuidance:
      "Use this when the answer likely depends on prior remembered user facts, prior chats, or assistant knowledge rather than the public web.",
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    requiredCredentialId: "tool_memory_search",
    policyClass: "plan_managed"
  },
  {
    id: "88888888-8888-8888-8888-888888888888",
    code: "memory_get",
    displayName: "Knowledge Fetch",
    description: "Safe snippet read from memory files with optional offset/lines.",
    modelDescription: "Fetch a specific remembered knowledge or memory item by reference.",
    modelUsageGuidance:
      "Use this after memory or knowledge search returned a concrete reference that needs a focused read.",
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    policyClass: "plan_managed"
  },
  {
    id: "99999999-9999-9999-9999-999999999999",
    code: "cron",
    displayName: "Cron",
    description: "Manage gateway cron jobs and send wake events.",
    modelDescription: "Internal scheduler bridge.",
    modelUsageGuidance: "Internal only.",
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    policyClass: "hidden_internal"
  },
  {
    id: "12121212-1212-1212-1212-121212121212",
    code: "scheduled_action",
    displayName: "Scheduled Action",
    description:
      "Schedule actions for both user-visible reminders and hidden assistant follow-ups.",
    modelDescription:
      "Schedule actions for both user-visible reminders and hidden assistant follow-ups.",
    modelUsageGuidance:
      'Use audience="user" for reminders the user should actually see, for example reminders in a few hours, daily or weekly nudges, and deadlines. Use audience="assistant" for background checks and reasoning, for example coming back to a project or habit later, inspecting memory, and when available using knowledge_search or knowledge_fetch before deciding whether any gentle user-facing nudge is appropriate. Background assistant actions MUST NOT directly message the user. For ONE intent, create EXACTLY ONE scheduled_action in this turn — never both an audience="assistant" probe AND an audience="user" reminder for the same goal in the same turn. The correct pattern is: if the user asked for a future ping, create only audience="user"; if you (the assistant) want to think later before deciding whether to ping, create only audience="assistant" — when that assistant-side action runs, it can THEN, conditionally on what it observes, create a new audience="user" scheduled_action with an immediate schedule such as delayMs=1. Otherwise stay quiet. They are for checking progress or changes, noticing the user is already doing well and quietly doing nothing, or, when it is helpful and not pushy, scheduling a new scheduled_action with audience="user" and a short human-like message. Respect explicit "don\'t remind me" or paused/cancelled signals, avoid spamming multiple unsolicited reminders about the same thing, and phrase user-facing reminders as low-pressure offers rather than commands. For create, title, audience, and exactly one schedule are required: runAt, delayMs, everyMs, or cronExpr. Prefer taskId from an earlier list result when pausing, resuming, or cancelling; if taskId is unavailable, use titleMatch to resolve one current task by title.',
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    policyClass: "plan_managed"
  },
  {
    id: "13131313-1313-1313-1313-131313131313",
    code: "persai_workspace_attach",
    displayName: "Workspace Attach",
    description:
      "Attach an existing assistant-workspace file to the chat via the platform media pipeline.",
    modelDescription: "Migration-only attachment helper.",
    modelUsageGuidance: "Do not expose this helper on the normal model-visible path.",
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    policyClass: "platform_managed"
  },
  {
    id: "14141414-1414-1414-1414-141414141414",
    code: "persai_tool_quota_status",
    displayName: "Tool Quota Status",
    description:
      "Read live tool quota usage/caps from PersAI control plane for the current assistant.",
    modelDescription:
      "Read live quota status for the current assistant, including daily tool counters and main quota buckets.",
    modelUsageGuidance:
      "Use this when the user asks about remaining usage, current quota pressure, or whether a quota-governed tool is available.",
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    policyClass: "platform_managed"
  },
  {
    id: "17171717-1717-1717-1717-171717171717",
    code: "files",
    displayName: "Files",
    description:
      "Unified assistant file tool for search, metadata lookup, reads, writes, edits, and channel delivery.",
    modelDescription:
      "List, search, inspect, read, write, write-and-send, edit, delete, or send assistant-managed files through one canonical file surface.",
    modelUsageGuidance:
      "Use files.write_and_send when the user asks you to create or save a file and immediately deliver it in chat. Use files.write when the file should only be saved. For files.write and files.write_and_send, always prefer a non-empty relative path as the save target; filename is only a delivery-name override, not the canonical save path. Use files.delete for cleanup of obsolete files or directory trees. Use files.list when you need an exact root or folder inventory, and use files.search with a non-empty query when you need to discover a file by name. By default, present file inventories as a short grouped summary (workspace, uploads, artifacts) and hide raw service paths or UUID folders; only enumerate every raw relativePath when the user explicitly asks for the full raw list. When you already know the target file, use a returned fileRef or relativePath directly with files.get, files.read, files.edit, files.delete, or files.send. Do not claim a file was sent unless files.send or files.write_and_send succeeded. Keep shell and exec for actual process execution only.",
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    policyClass: "plan_managed"
  },
  {
    id: "20202020-2020-2020-2020-202020202020",
    code: "exec",
    displayName: "Exec",
    description: "Run a bounded executable inside the isolated sandbox workspace.",
    modelDescription:
      "Run one bounded executable with explicit arguments inside the assistant sandbox workspace.",
    modelUsageGuidance:
      "Use this only when a real process execution is necessary. Refer to files in the assistant workspace by relative path and stay within the sandbox limits.",
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    policyClass: "plan_managed"
  },
  {
    id: "21212121-2121-2121-2121-212121212121",
    code: "shell",
    displayName: "Shell",
    description: "Run a bounded shell command inside the isolated sandbox workspace.",
    modelDescription: "Run a bounded shell command inside the assistant sandbox workspace.",
    modelUsageGuidance:
      "Use this only when a shell command is actually needed. Refer to files in the assistant workspace by relative path and prefer the files tool for normal file IO.",
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    policyClass: "plan_managed"
  }
];

export const CURRENT_TOOL_CODES = TOOL_CATALOG.map((tool) => tool.code);
export const CURRENT_TOOL_CODE_SET = new Set(CURRENT_TOOL_CODES);

export const STARTER_TRIAL_TOOL_POLICY: Record<
  string,
  {
    active: boolean;
    dailyCallLimit: number | null;
    /**
     * ADR-074 Slice L1 — per-plan override of the per-turn hard cap on this
     * tool's executions inside a single runtime turn. NULL = "use the runtime
     * code default" (TOOL_HARD_CAP_PER_TURN in
     * apps/runtime/src/modules/turns/tool-budget-policy.ts).
     */
    perTurnCap: number | null;
  }
> = {
  web_search: { active: true, dailyCallLimit: 30, perTurnCap: null },
  web_fetch: { active: true, dailyCallLimit: 20, perTurnCap: null },
  image_generate: { active: false, dailyCallLimit: null, perTurnCap: null },
  image_edit: { active: false, dailyCallLimit: null, perTurnCap: null },
  video_generate: { active: false, dailyCallLimit: null, perTurnCap: null },
  tts: { active: false, dailyCallLimit: null, perTurnCap: null },
  browser: { active: false, dailyCallLimit: null, perTurnCap: null },
  memory_search: { active: true, dailyCallLimit: null, perTurnCap: null },
  memory_get: { active: true, dailyCallLimit: null, perTurnCap: null },
  cron: { active: false, dailyCallLimit: null, perTurnCap: null },
  scheduled_action: { active: true, dailyCallLimit: null, perTurnCap: null },
  files: { active: true, dailyCallLimit: 20, perTurnCap: null },
  exec: { active: false, dailyCallLimit: 5, perTurnCap: null },
  shell: { active: false, dailyCallLimit: 5, perTurnCap: null }
};

const TOOL_ENTRY_BY_CODE = new Map(TOOL_CATALOG.map((tool) => [tool.code, tool]));

export function resolveToolPolicyClass(toolCode: string): ToolPolicyClass {
  return TOOL_ENTRY_BY_CODE.get(toolCode)?.policyClass ?? "plan_managed";
}

export function isPlanManagedTool(toolCode: string): boolean {
  return resolveToolPolicyClass(toolCode) === "plan_managed";
}

export function isPlatformManagedTool(toolCode: string): boolean {
  return resolveToolPolicyClass(toolCode) === "platform_managed";
}

export function isHiddenInternalTool(toolCode: string): boolean {
  return resolveToolPolicyClass(toolCode) === "hidden_internal";
}
