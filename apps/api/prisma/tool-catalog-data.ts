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
      'Use this only for creating a new image, not for editing an existing one or generating video. When the user directly asks you to make, draw, create, or generate an image, call the tool instead of narrating the planned call. Never print `image_generate(...)`, JSON arguments, or a fenced code block as a substitute. For transparent background, cutout, sticker, icon, logo, or PNG with alpha, set background="transparent". If the result says `action="deferred"`, say the image is still rendering and will arrive separately; do not describe it as already created, attached, or sent.',
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
      'Do not use this for image description, OCR, or "what do you see" questions. Prefer the current user attachment; otherwise use a recent reusable chat image already in context. With one available image, edit that image. With multiple images, set `sourceImageAlias` to the image being edited and use `referenceImageAlias` only as a visual guide from another available image. If roles like "the second photo" are still unclear, ask instead of guessing. For transparent background, cutout, sticker, icon, logo, or PNG with alpha, set background="transparent". Never claim the edit is done unless this turn produced a successful `image_edit` result. If the result says `action="deferred"`, say the edit is in progress and will arrive separately.',
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
      "Generate a short video clip from a text prompt, optionally guided by one current or recent chat reference image.",
    modelDescription: "Generate a short brand-new video clip from a text prompt.",
    modelUsageGuidance:
      'Use this only when the user explicitly wants a generated video, animation, or clip. When the user directly asks for one, call the tool instead of narrating the planned call. Never print `video_generate(...)`, JSON arguments, or a fenced code block as a substitute. You may guide the result with one current or recent chat image via `referenceImageAlias`. Do not use this for editing an existing video or answering image questions. If the result says `action="deferred"`, say the video is still rendering and will arrive separately; do not describe it as already created, attached, or sent.',
    capabilityGroup: "knowledge" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    requiredCredentialId: "tool_image_generate",
    policyClass: "plan_managed"
  },
  {
    id: "18181818-1818-1818-1818-181818181818",
    code: "document",
    displayName: "Document",
    description:
      "Create and revise user-ready PDF documents and presentations through async document providers.",
    modelDescription:
      "Create or revise user-ready business documents, reports, proposals, and slide decks through the unified document tool.",
    modelUsageGuidance:
      "Use this when the user explicitly wants a generated PDF, presentation, deck, proposal, report, or a revision to an existing PersAI document. Match the mode to the real intent: create a new document, revise an existing one, or redeliver/export an existing result. For presentations, fill `visualStyle`, `imagePolicy`, and `visualDensity` when the user's visual intent is clear so the deck gets an honest creative brief. Prefer image-rich settings only when the user wants a visual deck, and use text_only only when they explicitly want no images. If the run goes async, say it is in progress until the delivered file actually arrives.",
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
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
      "Use this only when the user explicitly wants a voice note, spoken reply, narration, or audio version of text. If they only want text, reply in text.",
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
      "Use snapshot first to inspect the page. Use act only when the user explicitly wants interaction or when static web tools cannot reach the needed state.",
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
    description: "Schedule simple unconditional user-visible reminders.",
    modelDescription: "Schedule simple unconditional user-visible reminders.",
    modelUsageGuidance:
      'Use this only for unconditional user-visible reminders such as "remind me in 10 minutes", "ping me tomorrow", or "daily check-in". For create, use `kind="user_reminder"` with `title`, `reminderText`, and exactly one schedule (`runAt`, `delayMs`, `everyMs`, or `cronExpr`). Do not use it for hidden checks, quiet follow-through, conditional monitoring, or "поставь себе фоновую задачу"; use `background_task` for that. Never confirm success unless this turn returned a tool result with `action="created"`. If the result was `action="skipped"` or no success arrived, say scheduling failed. Prefer taskId for pause/resume/cancel; otherwise use titleMatch.',
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    policyClass: "plan_managed"
  },
  {
    id: "23232323-2323-2323-2323-232323232323",
    code: "background_task",
    displayName: "Background Task",
    description: "Create and manage quiet assistant-side background tasks.",
    modelDescription:
      "Create and manage quiet assistant-side background tasks that the platform later evaluates and may push to the user.",
    modelUsageGuidance:
      'Use this for conditional checks and quiet assistant follow-through such as "поставь себе фоновую задачу", "тихо проверь", or "if X happens, ping me". `scheduled_action` is only for unconditional user-visible reminders. One background_task may later use allowed tools, generate supported artifacts, and then decide whether to push. If the user asks "check X later and if condition Y then send or generate Y", create one background_task whose brief includes the condition, any needed tools or artifacts, and the push-vs-silence rule. For create, provide a short `title`, a precise `brief`, and exactly one schedule (`runAt`, `delayMs`, `everyMs`, or `cronExpr`).',
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
      "Read live quota and plan state from PersAI control plane for the current assistant, including checkout-link creation from the same bounded surface.",
    modelDescription:
      "Read live quota status for the current assistant, including current plan, public plan comparison, non-media daily tool counters, main quota buckets, monthly media quotas, and checkout-link creation from the same tool surface.",
    modelUsageGuidance:
      "Use this when the user asks about remaining usage, current quota pressure, whether a quota-governed tool is available, which paid plan to choose, or when they want the checkout link opened now. For image/video/edit quota questions, read the monthly media quota block instead of daily counters.",
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
      "Use files.write_and_send when the user wants a file created or saved and delivered in chat right away. Use files.write when it should only be saved. For writes, prefer a non-empty relative path as the canonical target; filename is only a delivery-name override. Use files.delete for cleanup. Use files.list for an exact inventory and files.search with a non-empty query when you need discovery by name. By default, summarize inventories by workspace/uploads/artifacts and hide raw service paths or UUID folders unless the user explicitly asks for the raw list. When you already know the target, prefer a working-file alias first, then relativePath, then query. Do not claim a file was sent unless files.send or files.write_and_send succeeded. Keep shell and exec for real process execution only.",
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
  document: { active: false, dailyCallLimit: null, perTurnCap: null },
  tts: { active: false, dailyCallLimit: null, perTurnCap: null },
  browser: { active: false, dailyCallLimit: null, perTurnCap: null },
  memory_search: { active: true, dailyCallLimit: null, perTurnCap: null },
  memory_get: { active: true, dailyCallLimit: null, perTurnCap: null },
  cron: { active: false, dailyCallLimit: null, perTurnCap: null },
  scheduled_action: { active: true, dailyCallLimit: null, perTurnCap: null },
  background_task: { active: true, dailyCallLimit: null, perTurnCap: null },
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
