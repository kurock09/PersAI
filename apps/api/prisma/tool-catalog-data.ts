import type { ToolCatalogCapabilityGroup, ToolCatalogToolClass } from "@prisma/client";

export type ToolPolicyClass = "plan_managed" | "platform_managed" | "hidden_internal";

/** ADR-135 — catalog vs full wire projection tier for plan-visible model tools. */
export type ModelExposure = "full" | "catalog";

/**
 * ADR-135 D2 — founder-locked platform defaults for the 24 plan-visible runtime
 * model tool codes (wire names). Synthetic tools resolve via bootstrap metadata.
 */
export const PLAN_VISIBLE_MODEL_TOOL_DEFAULT_EXPOSURE: Record<string, ModelExposure> = {
  skill: "full",
  todo_write: "full",
  files: "full",
  shell: "full",
  grep: "full",
  glob: "full",
  exec: "full",
  knowledge_search: "full",
  knowledge_fetch: "full",
  web_search: "full",
  web_fetch: "full",
  memory_write: "full",
  image_edit: "full",
  image_generate: "catalog",
  video_generate: "catalog",
  document: "catalog",
  presentation: "catalog",
  browser: "catalog",
  tts: "catalog",
  scheduled_action: "catalog",
  background_task: "catalog",
  quota_status: "catalog",
  summarize_context: "catalog",
  compact_context: "catalog"
};

export const PLAN_VISIBLE_MODEL_TOOL_CODES = Object.keys(
  PLAN_VISIBLE_MODEL_TOOL_DEFAULT_EXPOSURE
) as Array<keyof typeof PLAN_VISIBLE_MODEL_TOOL_DEFAULT_EXPOSURE>;

const CATALOG_CODE_TO_RUNTIME_MODEL_TOOL_CODE: Record<string, string> = {
  persai_tool_quota_status: "quota_status"
};

export function resolveRuntimeModelToolCode(catalogToolCode: string): string {
  return CATALOG_CODE_TO_RUNTIME_MODEL_TOOL_CODE[catalogToolCode] ?? catalogToolCode;
}

export function resolveCatalogDefaultModelExposure(catalogToolCode: string): ModelExposure | null {
  const runtimeCode = resolveRuntimeModelToolCode(catalogToolCode);
  return PLAN_VISIBLE_MODEL_TOOL_DEFAULT_EXPOSURE[runtimeCode] ?? null;
}

export function defaultPlanFullProjection(catalogToolCode: string): boolean {
  const exposure = resolveCatalogDefaultModelExposure(catalogToolCode);
  return exposure === null ? true : exposure === "full";
}

export type ToolCatalogEntry = {
  id: string;
  code: string;
  displayName: string;
  description: string;
  modelDescription?: string;
  modelUsageGuidance?: string;
  /** ADR-135 — platform default projection tier for plan-visible model tools. */
  defaultModelExposure?: ModelExposure;
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
EXAMPLES:
- web_fetch({url:"https://example.com/article"}) — direct fetch.
GOTCHAS:
- Returns extracted main text, not raw HTML.`,
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
EXAMPLES:
- image_generate({prompt:"…"}) — one new image (default, no outputMode needed).
GOTCHAS:
- For transparent background, cutout, sticker, icon, logo, or PNG with alpha, set background="transparent".
`,
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
    modelUsageGuidance: `WHEN TO USE: User explicitly asks to visually modify an image AND a source image is available (current attachment or reusable chat image already in context).
EXAMPLES:
- image_edit({sourceImageAlias:"…", prompt:"…"}) — one edited variant (default).
GOTCHAS:
- With multiple available images, set sourceImageAlias to the image being edited; you may pass extras via referenceImageAliases (those only guide).
- For transparent background, cutout, sticker, icon, logo, or PNG with alpha, set background="transparent".
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
    modelUsageGuidance: `WHEN TO USE: User wants a short animated clip, talking-avatar, or cinematic motion from a text prompt.
EXAMPLES:
- video_generate({prompt:"…"}) — text-only short clip.
- video_generate({prompt:"…", referenceImageAlias:"…"}) — clip guided by one current or recent chat image.
GOTCHAS:
- For talking-avatar rules, saved characters, or available voices, first call video_generate with action:"describe_avatar_mode", action:"list_personas", or action:"list_voices"; these lookups are read-only.
- Never guess personaId or voiceKey; load them from those read-only actions first.
- Single source-image guidance only; do not pass multiple reference aliases.
`,
    capabilityGroup: "knowledge" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    requiredCredentialId: "tool_image_generate",
    policyClass: "plan_managed"
  },
  {
    id: "18181818-1818-1818-1818-181818181818",
    code: "document",
    displayName: "Document",
    description: "Inspect, render, or convert user-ready PDF/DOCX/XLSX files.",
    modelDescription:
      "Use exactly three document verbs for ordinary document work: inspect an existing file, render a new file from Markdown, or convert an existing file between PDF/DOCX/XLSX.",
    modelUsageGuidance: `WHEN TO USE: User asks for a PDF document, DOCX/Word file, XLSX/spreadsheet, report, manual, instruction, table, or other ordinary document output.
EXAMPLES:
- document({action:"inspect", path:"/workspace/.../source.docx"}) — inspect an existing PDF/DOCX/XLSX source by exact path copied from Working Files or files.list.
- document({action:"render", requestedName:"q2.pdf", format:"pdf", content:"# Q2 Report\n\nSummary..."}) — render a new PDF from inline Markdown into the current session root.
- document({action:"render", requestedName:"q2.docx", format:"docx", contentPath:"/workspace/.../reports/q2.md", style:"report"}) — render a DOCX from an existing Markdown path, same destination.
- document({action:"render", requestedName:"table.xlsx", format:"xlsx", content:"# Revenue\n\n| Month | Revenue |\n| --- | --- |\n| Jan | 10 |"}) — trivial single-sheet XLSX from flat Markdown tables only; no formulas, charts, or multi-sheet logic.
- document({action:"convert", source:"/workspace/.../source.docx", targetFormat:"pdf", requestedName:"source.pdf"}) — convert an existing path copied from tools; output lands in the same session root.
GOTCHAS:
- \`document.inspect\` returns \`editMethod\`: \`shell_native\` for uploaded PDF/DOCX/XLSX without a sibling \`.md\`; \`render_from_markdown\` when that sibling exists.
- The model should provide only \`requestedName\` for new render/convert outputs, never an absolute workspace path. The runtime owns the real current-session output directory and returns the final \`outputPath\`.
- \`document.render\` with \`format:"xlsx"\` is only for very simple spreadsheets: one sheet, flat Markdown tables, no formulas/charts/conditional formatting/multi-sheet models. Complex XLSX belongs in one \`shell\` script per user turn.
- \`document.render\` persists the Markdown source as a visible sibling \`.md\` file next to the output, registers the output, and delivers it in one call.
- \`document.convert\` is deterministic format conversion only; it does not rewrite content semantically.
`,
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    policyClass: "plan_managed"
  },
  {
    id: "19191919-1919-1919-1919-191919191919",
    code: "presentation",
    displayName: "Presentation",
    description:
      "Create, revise, or export slide decks through the deferred Gamma presentation worker.",
    modelDescription:
      "Create or revise slide decks and export editable PPTX when explicitly requested. Chat delivery for new/revised decks is PDF.",
    modelUsageGuidance: `WHEN TO USE: User explicitly asks for a presentation, slide deck, slides, pitch deck, or PPTX/PowerPoint export/redelivery of an existing PersAI presentation.
EXAMPLES:
- presentation({descriptorMode:"create_presentation", prompt:"…"}) — create a new slide deck.
- presentation({descriptorMode:"revise_document", docId:"…", prompt:"…"}) — revise an existing PersAI presentation.
- presentation({descriptorMode:"export_or_redeliver", docId:"…", outputFormat:"pptx", prompt:"…"}) — prepare editable PPTX only when the user explicitly asked for PowerPoint.
GOTCHAS:
- Only export_or_redeliver may set outputFormat=pptx, and only when the user explicitly asked for PPTX/PowerPoint.
- Fill visualStyle, imagePolicy, and visualDensity only when visual intent is clear.
`,
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    requiredCredentialId: "tool_document_gamma",
    policyClass: "plan_managed"
  },
  {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    code: "tts",
    displayName: "Text to Speech",
    description:
      "Text-to-speech synthesis via provider-specific TTS credentials with native provider fallback.",
    modelDescription: "Generate spoken audio for the current assistant persona.",
    modelUsageGuidance: `WHEN TO USE: User explicitly asks for a voice note, spoken reply, narration, or audio version of text.
EXAMPLES:
- tts({text:"…"}) — synthesize spoken audio using the assistant persona voice.
GOTCHAS:
- Voice is bound to the configured assistant persona; do not announce voice or speaker choice unless the user explicitly asks.
- Output is an audio file; never claim audio was sent unless this turn produced a successful tts result.`,
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
    modelUsageGuidance: `WHEN TO USE: Live, interactive, JavaScript-rendered, or logged-in web pages where plain web_fetch cannot reach the needed state — especially CRM/portals that require cookies across turns.
WHEN NOT TO USE: Static public pages with a known URL (prefer web_fetch) or facts discoverable via web_search without interaction.
EXAMPLES:
- browser({action:"list_profiles"}) — list saved per-assistant browser sessions and their profileKey/status.
- browser({action:"login", displayName:"Bitrix24", url:"https://…/login"}) — start product-owned live login or re-auth; reuse the returned profileKey after the user completes login.
- browser({action:"snapshot", url:"…", profile:"profileKey"}) — inspect an authenticated page with a saved session; text results may include page.elements with reusable CSS selectors.
- browser({action:"act", url:"…", profile:"profileKey", operations:[…]}) — bounded interaction using selectors copied from page.elements when available, then a fresh snapshot.
- browser({action:"snapshot", url:"…", profile:"profileKey", format:"pdf"}) — export a PDF artifact; deliver via files.attach.
- browser({action:"snapshot", url:"…", format:"png", fullPage:true}) — screenshot artifact (png/jpeg/webp); deliver via files.attach.
GOTCHAS:
- Prefer \`snapshot\` first to inspect the page. Use \`act\` only when interaction is required.
- Pass \`profile\` on \`snapshot\`/\`act\` to reuse cookies; omit \`profile\` only for public pages.
- Profile-backed text \`snapshot\` and \`act\` may return \`page.elements\` with reusable CSS selectors. Prefer those selectors in follow-up \`act\` calls instead of guessing new selectors.
- For saved profiles, keep \`act\` selector-based. Do not use \`press\`/\`Enter\` as a shortcut — persistent Browserless sessions reject keyboard-press operations.
- If a page (catalog, feed, search results) renders but shows an empty or placeholder list right after navigation, add a \`kind:"scroll"\` operation (optionally with a \`selector\`) before re-reading content — many sites only populate cards once scrolled into view.
- Persistent-profile stealth and residential-proxy policy are platform-owned. Never invent proxy or stealth settings as browser arguments or chat instructions.
- If \`act\` returns per-operation warnings, continue from the returned page state/\`page.elements\` and retry only when the observed page supports it; do not jump to "bot protection", "profile expired", or similar from one failed selector.
- A transient BQL/reconnect/429 failure is not proof that a profile expired. Speak from structured runtime/API reason codes for pending login, user re-auth, or expired-profile states.
- Do not start a fresh login or invent a new profile name unless the runtime/tool result explicitly points to missing profile, pending login, or user re-auth state.
- On ordinary web chat, login and re-auth stay product-owned UI state. Do not paste Browserless live login URLs into the assistant reply.
- \`optimizeForSpeed:true\` on \`snapshot\`/\`act\` speeds table scraping (blocks heavy assets).
- Saved profiles expire after plan TTL inactivity; true missing/pending/expired states return structured business errors — use \`login\` only when the runtime/tool result actually points to that state.`,
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
    modelUsageGuidance: `WHEN TO USE: User asks for an unconditional user-visible reminder ("remind me in 10 minutes", "ping me tomorrow", "daily check-in at 9 AM").
EXAMPLES:
- scheduled_action({action:"create", kind:"user_reminder", title:"…", reminderText:"…", delayMs:600000}) — remind in 10 minutes.
- scheduled_action({action:"create", kind:"user_reminder", title:"…", reminderText:"…", cronExpr:"0 9 * * *"}) — daily 9 AM ping.
- scheduled_action({action:"pause", taskId:"…"}) / {action:"cancel", titleMatch:"…"} — manage existing reminders.
GOTCHAS:
- For create, provide exactly ONE schedule field (\`runAt\`, \`delayMs\`, \`everyMs\`, or \`cronExpr\`); do not combine them.
- Never confirm success unless this turn returned \`action="created"\`. If the result was \`action="skipped"\` or no success arrived, say scheduling failed honestly.
- Prefer \`taskId\` for pause/resume/cancel; fall back to \`titleMatch\` only when the user did not give a task id.`,
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
    modelUsageGuidance: `WHEN TO USE: Conditional checks ("if X then ping me"), quiet monitoring ("тихо проверь"), or delayed assistant-side follow-through that may or may not surface to the user.
EXAMPLES:
- background_task({action:"create", title:"…", brief:"Check X later; if condition Y holds, send the user a short summary and a PDF.", delayMs:3600000}) — conditional check + artifact.
- background_task({action:"create", title:"…", brief:"…", cronExpr:"0 8 * * 1"}) — recurring quiet weekly check.
- background_task({action:"cancel", taskId:"…"}) — stop an existing task.
GOTCHAS:
- For create, provide a short \`title\`, a precise \`brief\` describing condition + push-vs-silence rule + any needed tools/artifacts, and exactly ONE schedule (\`runAt\`, \`delayMs\`, \`everyMs\`, or \`cronExpr\`).
- Do NOT create a nested scheduled_action or another background_task from inside a background-task run.
- The background run may use allowed tools and produce supported artifacts; platform delivery sends them with the push when supported.`,
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
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    policyClass: "platform_managed"
  },
  {
    id: "17171717-1717-1717-1717-171717171717",
    code: "files",
    displayName: "Files",
    description:
      "Path-driven workspace file operations: list, read, preview, write, delete, attach.",
    modelDescription:
      "Path-driven workspace file operations (list, read, preview, write, delete, attach). Re-view an earlier chat or workspace image/PDF via files({action:'preview', path}) using the exact path from the Working Files block — current-message attachments are already in vision context without a tool; never use files.read on images. For new files, pass `requestedName` or a relative path — the runtime prepends the real current session root and returns the final path; the model must not construct assistant/session IDs itself. For existing files, use the exact path from the Working Files block, files.list, or a prior tool result — never reconstruct paths from displayName/filename. Writes are collision-safe by default; pass `replace: true` as the exact-overwrite opt-in. `files.write` persists only; call files.attach(path) in the same turn before telling the user the file was delivered.",
    modelUsageGuidance: `WHEN TO USE: Any workspace file work on the storage plane — list, read, preview, write, delete, attach, or search by name/path/description.

**Vision — when to call preview vs nothing:**
- User attached image/PDF **in this message** → already in your vision context; answer directly; **no** files tool.
- User refers to an image/PDF from **earlier in the chat** or **only in workspace** ("that screenshot", "the logo above", "photo I sent", Working Files row with image/png) → \`files({action:"preview", path:"/workspace/.../exact-path"})\` with the path copied from Working Files, \`files.list\`, \`files.search\`, or a prior tool result.
- Text file (csv, md, log, json, code) → \`files({action:"read", path})\` (optional \`maxBytes\` for a large file head-peek).
- **Never** \`files.read\` on \`image/*\` — read is text-only and does not show pixels. **Never** pass \`maxBytes\` on visual \`preview\` (plan visual limit applies).

\`files.*\` reads and writes committed \`/workspace/...\` paths (GCS+manifest); it does not execute in the sandbox pod.
EXAMPLES:
- files({action:"list"}) — list the current session root.
- files({action:"list", path:"/workspace/assistants/..."}) — widen only by an exact parent path copied from tools or Working Files.
- files({action:"read", path:"/workspace/.../report.csv"}) — read text by exact copied path.
- files({action:"read", path:"/workspace/.../notes.md", maxBytes:4096}) — peek at the head of a large text file.
- files({action:"preview", path:"/workspace/.../photo.png"}) — visual re-view of an image (vision); do not pass maxBytes.
- files({action:"preview", path:"/workspace/.../scan.pdf"}) — visual re-view of a PDF under the plan preview byte limit.
- files({action:"write", requestedName:"draft.txt", content:"hello"}) — create a new current-session file; runtime returns the final path (not a chat attachment).
- files({action:"attach", path:"/workspace/.../draft.txt"}) — deliver that persisted file to chat in the same turn.
- files({action:"delete", path:"/workspace/.../tmp.bin"}) — remove a file by exact copied path.
- files({action:"search", query:"invoice"}) — look up a file by filename, path, or cached description.
GOTCHAS:
- Seven actions: list, read, preview, write, delete, attach, search — search matches query tokens against path, filename, and cached shortDescription.
- **Vision:** \`preview\` on \`image/*\` or PDF injects visual content for the model; \`read\` is text-only and does not show images. For images/PDF do not pass \`maxBytes\` on \`preview\` (plan-owned visual limit applies).
- **Delivery contract:** \`files.write\` saves to the workspace manifest only — the user does not receive a chat attachment or downloadable delivery from write alone. Before saying the file is ready, sent, attached, or delivered, call \`files.attach(path)\` with the exact path from this turn's write, shell, or exec result.
- \`files.attach\` delivers an EXISTING persisted file — never regenerates content. Attach only this turn's new output, a file the user explicitly asked to resend, or a path they named; never unrelated session files. If the file is not yet written, finish write/shell/exec first, then attach in the same turn.
- \`document.render\` / \`document.convert\` auto-deliver PDF/DOCX/XLSX in chat; plain \`.txt\`, \`.csv\`, and other non-document outputs always need explicit \`files.attach\`.
- Never spell assistant/session IDs; the runtime resolves the current session root for you.
- Do not reconstruct upload paths from displayName/filename; uploads may be sanitized, renamed, or collision-suffixed. Use \`/tmp/\` for ephemeral scratch the user should not see.
- \`maxBytes\` caps text returned by \`read\` or text-only \`preview\`; it does not apply to image/PDF visual \`preview\`. \`maxDepth\` bounds recursion for list. Server-side limits still apply.`,
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
    modelUsageGuidance: `WHEN TO USE: A real bounded executable must run with explicit arguments inside the assistant sandbox workspace.
EXAMPLES:
- exec({command:"python", args:["script.py", "input.txt"]}) — run a script in the sandbox.
- exec({command:"ffmpeg", args:["-i","input.mp4","output.mp4"]}) — bounded transform.
GOTCHAS:
- Refer to workspace files by relative path; absolute paths outside the sandbox will be rejected.
- Stay within sandbox CPU / memory / time limits; the call is killed when limits are exceeded.
`,
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
    modelUsageGuidance: `WHEN TO USE: Use shell proactively for multi-step autonomous work inside the sandbox — pipelines, scripts, builds, package installs, Git operations, any multi-command sequencing. It's the primary autonomous execution surface; don't wait to be asked.
SHELL ENVIRONMENT: /bin/bash with brace expansion, [[ … ]], <(…), set -o pipefail. Default cwd is the real current session root the runtime chose; do not construct assistant/session IDs yourself. Python 3 (system packages plus session-scoped pip user-site, e.g. \`.local\`) and Node 22 LTS with npm (session-local installs, e.g. \`node_modules\`/\`.npm-global\`) — neither leaks across assistants or workspaces. HTTPS egress is allowlisted for github.com, *.github.com, *.githubusercontent.com, pypi.org, files.pythonhosted.org, registry.npmjs.org, *.npmjs.com; other hosts are denied.
EXAMPLES:
- shell({command:"pip install --quiet rich && python3 -c 'import rich; rich.print({\\"ok\\": True})'"}) — install and use a Python package.
- shell({command:"git clone --depth 1 https://github.com/sindresorhus/awesome.git"}) — public HTTPS clone.
- shell({command:"git push https://<user>:<pat>@github.com/<owner>/<repo>.git main"}) — push with your own credentials in the URL; PersAI injects no token (401 without auth).
- shell({command:"npm install && npm run build"}) — multi-step build pipeline.
- shell({command:"python3 script.py --input data.csv --output result.json"}) — run a script with arguments.
- For office-file edits (DOCX/XLSX/PDF), prefer one complete \`shell\` script per turn over multiple overwrite passes.
GOTCHAS:
- **Default cwd is already the current session root** (see Working Files \`cwd:\`). Omit the \`cwd\` argument unless you truly need a subdirectory. Never pass the full \`/workspace/assistants/.../sessions/...\` path as \`cwd\` — that duplicates the session root and fails with \`cd: can't cd to .../workspace/assistants/...\`.
- In shell commands, do not \`cd\` to the session root; use relative paths (\`python script.py\`) or the exact file \`path\` from tool results. Only \`cd\` into a named subdirectory when needed.
- Refer to workspace files by exact \`/workspace/...\` path or by paths relative to the current session root (execution pod cwd).
- Produced session files are mirrored to the workspace manifest when mirroring succeeds. Plain \`.txt\`, \`.csv\`, and other non-document outputs need explicit \`files.attach(path)\` in the same turn before claiming delivery; registered PDF/DOCX/XLSX may auto-deliver (see \`document\` / \`files\` descriptors).
- gitlab.com, bitbucket.org, and other non-allowlisted hosts need a 1-line allowlist follow-up before shell can reach them.
- Stay within sandbox CPU / memory / time limits.`,
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "cost_driving" as ToolCatalogToolClass,
    policyClass: "plan_managed"
  },
  {
    id: "24242424-2424-2424-2424-242424242424",
    code: "grep",
    displayName: "Grep",
    description: "Fast content search across workspace files using ripgrep.",
    modelDescription:
      "Search workspace files for a text pattern and return structured matches (file path, line number, matched text).",
    modelUsageGuidance: `WHEN TO USE: Content search — find code patterns, strings, identifiers, log entries, or any text across the workspace.
EXAMPLES:
- grep({pattern:"TODO"}) — find all TODO comments in the current session root.
- grep({pattern:"function processPayment", glob:"**/*.ts"}) — search TypeScript files for a function.
- grep({pattern:"ERROR", path:"logs/", caseInsensitive:true}) — search a specific directory case-insensitively.
- grep({pattern:"import.*from.*react", type:"ts"}) — grep by file type.
GOTCHAS:
- pattern is a regex; escape special chars (e.g. use \\. not . to match a literal dot).
- path is a workspace-relative directory to scope the search; omit it to search the current session root, or widen with an assistant-root/workspace-root path explicitly.
- Use glob or type to narrow by file extension; omit for a broad search.
- truncated:true means matches were capped; narrow the search with glob, type, or path.`,
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    policyClass: "plan_managed"
  },
  {
    id: "25252525-2525-2525-2525-252525252525",
    code: "glob",
    displayName: "Glob",
    description: "Fast filename discovery across workspace files using fd.",
    modelDescription:
      "Find workspace files whose names match a glob pattern and return sorted relative paths.",
    modelUsageGuidance: `WHEN TO USE: Filename discovery — find files by name pattern, extension, or path prefix.
EXAMPLES:
- glob({pattern:"*.ts"}) — find all TypeScript files in the current session root.
- glob({pattern:"*.test.ts", path:"src/"}) — find test files in a specific directory.
- glob({pattern:"README*"}) — find README files of any extension.
GOTCHAS:
- pattern is a glob expression; use * for any characters in a segment, ** for any depth.
- path scopes the search to a workspace-relative directory; omit it to search the current session root, or widen with an assistant-root/workspace-root path explicitly.
- Results are sorted alphabetically; truncated:true means the list was capped.`,
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    policyClass: "plan_managed"
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    code: "skill",
    displayName: "Skill",
    description:
      "List, inspect, engage, or release an enabled Skill for the current chat. Read-only detail stays on the skill tool surface; engage activates domain-specific guidance and, optionally, a structured scenario workflow.",
    modelDescription:
      "Read enabled Skill details, engage a matching Skill (and optionally a scenario), OR release the active Skill.",
    modelUsageGuidance: `WHEN TO USE: User's request matches the domain of any Skill listed in <enabled_skills> (summary, when_to_use, category, tags, or scenario names). Use action="list" or action="describe" for read-only detail before activation when needed. Use action="engage" with skillId, and optionally scenarioKey, only when you are ready to activate the Skill.
WHEN NOT TO USE: Conversation is chitchat unrelated to any enabled Skill's domain. Same Skill is already active and the topic is unchanged. To clear an active Skill when the conversation pivots away, call action="release" (no skillId needed).
EXAMPLES:
- skill({action:"list"}) — inspect enabled Skills without side effects.
- skill({action:"describe", skillId:"skl_marketing_demo"}) — inspect one Skill's detail card.
- skill({action:"describe", skillId:"skl_marketing_demo", scenarioKey:"instagram_carousel"}) — inspect a specific scenario before activation.
- skill({action:"engage", skillId:"skl_marketing_demo"}) — match on Skill domain without specific scenario.
- skill({action:"engage", skillId:"skl_marketing_demo", scenarioKey:"instagram_carousel"}) — match on a listed scenario.
- skill({action:"release"}) — conversation pivoted away.
GOTCHAS:
- skillId is the exact <skill id="..."> value from <enabled_skills>; never substitute the display name, category, or any other field.
- scenarioKey is the exact <scenario key="..."> value from <available_scenarios>; opaque slug, must match verbatim.
- action="list" and action="describe" are read-only: no side effects, safe to call speculatively, and they return bounded detail as a normal tool result.
- After action="engage", the engage result returns instruction.body + the active scenario's full structure — read those before any other action.
PLAN INTAKE: When the engage result includes a scenario (scenario.steps is a non-empty array), IMMEDIATELY follow up with a single todo_write({action:"add", items:[...]}) call whose items mirror the scenario's steps in order — one row per step, content set to a short title derived from each step's directive, status:"in_progress" on the first item and status:"pending" on the rest. This makes the plan model-authored from the very first move so subsequent in_progress/complete transitions are natural. Do not skip this step even if the user has not asked for a plan — the scenario is the plan.`,
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
  },
  {
    id: "34343434-3434-3434-3434-343434343434",
    code: "todo_write",
    displayName: "Todo Write",
    description:
      "Manage a chat-scoped hierarchical plan of in-progress, pending, and completed todos for the current conversation.",
    modelDescription: "Manage a chat-scoped todo list for the current conversation.",
    modelUsageGuidance: `WHEN TO USE: The user's request requires multi-step work, branching subtasks, or visible progress tracking across several tool calls or assistant turns. Open the plan immediately on the first turn you recognise this — do not wait until you have already started. Use one of: action="add" (mint new items), action="update" (rewrite content, change status, or reparent an existing item by id), action="complete" (mark an item done by id), action="remove" (soft-delete an item and its descendants by id), action="clear" (wipe the entire chat plan).
WHEN NOT TO USE: Single-step requests, pure chitchat, simple Q&A, or anything the user can finish in one assistant turn without sub-work. Do not mirror trivial actions into todos just to look busy. Do not store secrets, transient turn context, or long-form notes in todo content — use memory_write for durable facts and the message body for explanations.
EXAMPLES:
- todo_write({action:"add", items:[{content:"Research current pricing tiers", status:"in_progress"}, {content:"Draft proposal section"}]}) — open a plan at the start of a multi-step request.
- todo_write({action:"add", items:[{content:"Compile source list", parentId:"<server-id-of-research-step>"}]}) — add a child under an existing parent by its server-minted id.
- todo_write({action:"complete", id:"<server-id>"}) — close out a finished step before starting the next one.
- todo_write({action:"update", id:"<server-id>", content:"Draft proposal section (focus on pricing tiers)"}) — sharpen wording without changing identity.
- todo_write({action:"clear"}) — abandon the plan when the conversation pivots away from the original multi-step work.
SCENARIO INTAKE: When skill({action:"engage", scenarioKey:"..."}) returns a scenario, your very next move is a todo_write({action:"add", items:[...]}) that mirrors the scenario's steps in order (one row per scenario step, content = short title from the step's directive, first item status:"in_progress", rest status:"pending"). This is how a scenario becomes your plan.
LIFECYCLE: You own every row in the plan. The moment you start substantive work on a step, switch it to in_progress via todo_write({action:"update", id:"<row-id>", status:"in_progress"}); the moment the step is actually delivered (not just announced), call todo_write({action:"complete", id:"<row-id>"}) BEFORE you move to the next step. Never leave a finished step at pending. Only one in_progress sibling per parent — close the previous step before starting the next. If the conversation pivots away, either complete what is genuinely done and call action="clear" on the rest, or call action="clear" alone to abandon the plan.
GOTCHAS:
- Use the exact ids returned in the previous todo_write response's todos window — or the "by id <id>" tail on each row in <persai_chat_plan> — when calling update/complete/remove or attaching a parentId; ids are server-minted UUIDs.
- parentId attaches a child to an existing item; the server rejects cycles, unknown parents, and parents that are already completed.
- Only one in_progress sibling per parent scope — extras passed at add are coerced to pending with a warning; on update, a sibling switch is rejected with reason="sibling_in_progress".
- complete on a parent is rejected while it still has open children — close children first.
- completed items are immutable; remove them or clear the whole plan if you need a fresh slate. Do not try to re-open a completed item.
- The response always returns the current rendered window (all in_progress, most recent pending, recently completed up to the cap). Use that window to plan the next step; ignore your local copy if it disagrees.`,
    capabilityGroup: "workspace_ops" as ToolCatalogCapabilityGroup,
    toolClass: "utility" as ToolCatalogToolClass,
    policyClass: "plan_managed"
  }
];

for (const entry of TOOL_CATALOG) {
  const exposure = resolveCatalogDefaultModelExposure(entry.code);
  if (exposure !== null) {
    entry.defaultModelExposure = exposure;
  }
}

export const CURRENT_TOOL_CODES = TOOL_CATALOG.map((tool) => tool.code);
export const CURRENT_TOOL_CODE_SET = new Set(CURRENT_TOOL_CODES);

const STARTER_TRIAL_TOOL_POLICY_BASE: Record<
  string,
  {
    active: boolean;
    dailyCallLimit: number | null;
    perTurnCap: number | null;
  }
> = {
  web_search: { active: true, dailyCallLimit: 30, perTurnCap: null },
  web_fetch: { active: true, dailyCallLimit: 20, perTurnCap: null },
  image_generate: { active: false, dailyCallLimit: null, perTurnCap: null },
  image_edit: { active: false, dailyCallLimit: null, perTurnCap: null },
  video_generate: { active: false, dailyCallLimit: null, perTurnCap: null },
  document: { active: false, dailyCallLimit: null, perTurnCap: null },
  presentation: { active: false, dailyCallLimit: null, perTurnCap: null },
  tts: { active: false, dailyCallLimit: null, perTurnCap: null },
  browser: { active: false, dailyCallLimit: null, perTurnCap: null },
  memory_search: { active: true, dailyCallLimit: null, perTurnCap: null },
  memory_get: { active: true, dailyCallLimit: null, perTurnCap: null },
  cron: { active: false, dailyCallLimit: null, perTurnCap: null },
  scheduled_action: { active: true, dailyCallLimit: null, perTurnCap: null },
  background_task: { active: true, dailyCallLimit: null, perTurnCap: null },
  files: { active: true, dailyCallLimit: 20, perTurnCap: null },
  grep: { active: true, dailyCallLimit: 20, perTurnCap: null },
  glob: { active: true, dailyCallLimit: 20, perTurnCap: null },
  exec: { active: false, dailyCallLimit: 5, perTurnCap: null },
  shell: { active: false, dailyCallLimit: 5, perTurnCap: null },
  todo_write: { active: true, dailyCallLimit: null, perTurnCap: null }
};

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
    /** ADR-135 — ☑ full JSON on wire; seeded from catalog defaultModelExposure. */
    fullProjection: boolean;
  }
> = Object.fromEntries(
  Object.entries(STARTER_TRIAL_TOOL_POLICY_BASE).map(([code, policy]) => [
    code,
    { ...policy, fullProjection: defaultPlanFullProjection(code) }
  ])
);

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
