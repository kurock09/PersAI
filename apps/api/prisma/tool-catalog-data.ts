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
    modelDescription: "Search the public web for sources or links related to a query.",
    modelUsageGuidance: `WHEN TO USE: Need external sources, recent news, or facts not in uploaded knowledge. No exact URL is known.
WHEN NOT TO USE: Exact URL is known (call web_fetch). Local or uploaded sources are available.
EXAMPLES:
- web_search({query:"GPT-5.4 release date"}) — find sources.
- web_search({query:"…", count:5}) — narrowed.
GOTCHAS:
- Returns text snippets with URLs, not full page bodies. If you need a full page, follow up with web_fetch using one of the returned URLs.
- Prefer parallel calls for independent queries (subject to the parallelism rules in <tool_usage_policy>).`,
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
    modelDescription: "Fetch and extract the main content of a public webpage by exact URL.",
    modelUsageGuidance: `WHEN TO USE: Exact URL is known and you need the page content.
WHEN NOT TO USE: URL is unknown — call web_search first.
EXAMPLES:
- web_fetch({url:"https://example.com/article"}) — direct fetch.
GOTCHAS:
- Returns extracted main text, not raw HTML.
- For live, interactive, logged-in, or multi-step pages (forms, clicks), use the browser tool instead — web_fetch cannot drive sessions.`,
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
    modelDescription: "Generate a brand-new image from a text prompt (no source image).",
    modelUsageGuidance: `WHEN TO USE: User wants a new image and no source image is provided. Text prompt fully describes the desired output.
WHEN NOT TO USE: A source image is present and the user wants to modify it.
EXAMPLES:
- image_generate({prompt:"…"}) — one new image (default, no outputMode needed).
- image_generate({prompt:"…", outputMode:"series", seriesItems:["slide 1","slide 2"]}) — text-only carousel/series.
GOTCHAS:
- outputMode="series" REQUIRES seriesItems[] populated; one string per output frame.
- For transparent background, cutout, sticker, icon, logo, or PNG with alpha, set background="transparent".
- Never claim the image is delivered unless this turn produced a successful image_generate result.`,
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
      "Edit an existing image with prompt-guided changes (replace, remove, add, recolor, restyle, insert, draw on top).",
    modelUsageGuidance: `WHEN TO USE: User explicitly asks to modify an image AND a source image is available (current attachment or reusable chat image already in context).
WHEN NOT TO USE: No source image exists. User wants a brand-new image from text only.
EXAMPLES:
- image_edit({sourceImageAlias:"…", prompt:"…"}) — one edited variant (default).
- image_edit({sourceImageAlias:"…", prompt:"…", outputMode:"series", seriesItems:["slide 1","slide 2"]}) — carousel/series from one source.
GOTCHAS:
- outputMode="series" REQUIRES seriesItems[] populated; one string per output frame.
- With multiple available images, set sourceImageAlias to the image being edited; you may pass extras via referenceImageAliases (those only guide).
- For transparent background, cutout, sticker, icon, logo, or PNG with alpha, set background="transparent".
- Never claim the edit is done unless this turn produced a successful image_edit result.
- If roles like "the second photo" are unclear, ask before calling.`,
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
      "You may guide the result with one current or recent chat image via `referenceImageAlias`.",
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
      "Use this when the user explicitly wants a generated PDF, presentation, deck, proposal, report, or a revision to an existing PersAI document. Match the mode to the real intent: create a new document, revise an existing one, or redeliver/export an existing result. For presentations, treat delivery as PDF-first unless the user explicitly wants editable PPTX/PowerPoint output. Fill `visualStyle`, `imagePolicy`, and `visualDensity` only when the user's visual intent is clear. For ordinary school, educational, and standard business decks, prefer visual defaults that stay readable and presentation-native; use `text_only` only when the user explicitly wants no images, and use `text_heavy` only when they explicitly want dense slide copy. If the run goes async, say it is in progress until the delivered file actually arrives.",
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
    modelDescription: "Search uploaded documents, prior chats, and stored facts.",
    modelUsageGuidance: `WHEN TO USE: Answer requires uploaded documents, prior chat content, stored facts, or PersAI product / plan / subscription facts. Use BEFORE web tools when local sources are relevant.
WHEN NOT TO USE: Answer requires current external sources or a specific public URL.
EXAMPLES:
- knowledge_search({query:"refund policy"}) — broad search across all sources.
- knowledge_search({query:"…", maxResults:3}) — narrowed by count.
GOTCHAS:
- Returns snippets with referenceId; call knowledge_fetch with the referenceId if more content from a specific hit is needed.
- Returns are text snippets, not full source bodies.`,
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
    modelDescription: "Fetch the full content of a specific knowledge reference by referenceId.",
    modelUsageGuidance: `WHEN TO USE: A referenceId is in hand (from a prior knowledge_search result), and the snippet is insufficient.
WHEN NOT TO USE: No referenceId is available — call knowledge_search first.
EXAMPLES:
- knowledge_fetch({referenceId:"…"}) — full-content fetch.
- knowledge_fetch({referenceId:"…", mode:"section"}) — only the section containing the original snippet.
GOTCHAS:
- mode="section" returns a smaller payload; mode="full" returns the whole thing.
- referenceId is opaque — do not invent or guess values.`,
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
      'Use this only for unconditional user-visible reminders such as "remind me in 10 minutes", "ping me tomorrow", or "daily check-in". For create, use `kind="user_reminder"` with `title`, `reminderText`, and exactly one schedule (`runAt`, `delayMs`, `everyMs`, or `cronExpr`). Never confirm success unless this turn returned a tool result with `action="created"`. If the result was `action="skipped"` or no success arrived, say scheduling failed. Prefer taskId for pause/resume/cancel; otherwise use titleMatch.',
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
      'Use this for conditional checks and quiet assistant follow-through such as "поставь себе фоновую задачу", "тихо проверь", or "if X happens, ping me". One background_task may later use allowed tools, generate supported artifacts, and then decide whether to push. If the user asks "check X later and if condition Y then send or generate Y", create one background_task whose brief includes the condition, any needed tools or artifacts, and the push-vs-silence rule. For create, provide a short `title`, a precise `brief`, and exactly one schedule (`runAt`, `delayMs`, `everyMs`, or `cronExpr`).',
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
    // policy-overridden: the real model-facing text is supplied by
    // runtime-tool-policy.ts resolveRuntimeToolUsageGuidance and always
    // supersedes this catalog value. Edit the hardcoded override there, not here.
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
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    code: "skill",
    displayName: "Skill",
    description:
      "Engage or release an enabled Skill for the current chat. Used by the model to activate domain-specific retrieval priority and, optionally, a structured scenario workflow.",
    modelDescription:
      "Engage a Skill (and optionally a scenario) to activate domain-specific guidance, OR release the active Skill.",
    modelUsageGuidance: `WHEN TO USE: User's request matches the domain of any Skill listed in <enabled_skills> (Tags, Summary, when_to_use, or scenario intent examples). Call with action="engage", skillId, and optionally scenarioKey if the request matches a specific scenario.
WHEN NOT TO USE: Conversation is chitchat unrelated to any enabled Skill's domain. Same Skill is already active and the topic is unchanged. To clear an active Skill when the conversation pivots away, call action="release" (no skillId needed).
EXAMPLES:
- skill({action:"engage", skillId:"skl_marketing_demo"}) — match on Skill domain without specific scenario.
- skill({action:"engage", skillId:"skl_marketing_demo", scenarioKey:"instagram_carousel"}) — match on a listed scenario.
- skill({action:"release"}) — conversation pivoted away.
GOTCHAS:
- skillId is the exact <skill id="..."> value from <enabled_skills>; never substitute the display name, category, or any other field.
- scenarioKey is the exact <scenario key="..."> value from <available_scenarios>; opaque slug, must match verbatim.
- After action="engage", the engage result returns instruction.body + the active scenario's full structure — read those before any other action.`,
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    policyClass: "platform_managed"
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    code: "memory_write",
    displayName: "Memory Write",
    description: "Persist a durable user fact, preference, or open loop into assistant memory.",
    modelDescription:
      "Persist a stable fact, lasting preference, or real open loop learned this turn.",
    modelUsageGuidance: `WHEN TO USE: User stated a durable preference, fact about themselves, or an open loop you need to track across turns. Call immediately — same turn you learn it.
WHEN NOT TO USE: Transient turn context, secrets, guesses, full conversation summaries, OR anything the user asked not to remember.
EXAMPLES:
- memory_write({memory:"User prefers short responses with minimal emoji.", kind:"preference", layer:"long"}) — durable preference.
- memory_write({memory:"User asked to follow up on the Q3 marketing plan launch.", kind:"open_loop", layer:"short"}) — open loop to track.
GOTCHAS:
- One concise memory per call; do not batch unrelated facts.
- If a similar memory already exists, prefer refining it over creating a near-duplicate.
- If the user corrects or reverses a stored memory, write the correction the same turn.`,
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    policyClass: "platform_managed"
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
