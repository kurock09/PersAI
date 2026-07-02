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
- document({action:"inspect", path:"/workspace/source.docx"}) — inspect an existing PDF/DOCX/XLSX source and get a bounded structured view.
- document({action:"render", outputPath:"/workspace/reports/q2.pdf", format:"pdf", content:"# Q2 Report\n\nSummary..."}) — render a new PDF directly from inline Markdown.
- document({action:"render", outputPath:"/workspace/reports/q2.docx", format:"docx", contentPath:"/workspace/reports/q2.md", style:"report"}) — render a DOCX from an existing Markdown file.
- document({action:"render", outputPath:"/workspace/reports/table.xlsx", format:"xlsx", content:"# Revenue\n\n| Month | Revenue |\n| --- | --- |\n| Jan | 10 |"}) — render a trivial data-only XLSX from Markdown tables.
- document({action:"convert", source:"/workspace/source.docx", targetFormat:"pdf"}) — convert an existing document to a different document format and deliver it.
GOTCHAS:
- The document surface is exactly three verbs: \`inspect\`, \`render\`, and \`convert\`.
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
- Chat delivery for create_presentation and presentation revise_document is always PDF. outputFormat=pptx is only for export_or_redeliver when the user explicitly asked for PPTX/PowerPoint.
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
    modelUsageGuidance: `WHEN TO USE: Live, interactive, JavaScript-rendered, or logged-in web pages where plain web_fetch cannot reach the needed state.
WHEN NOT TO USE: The user only wants a textual description of a page.
EXAMPLES:
- browser({action:"snapshot", url:"…"}) — inspect a live page's current state.
- browser({action:"act", url:"…", task:"…"}) — drive a multi-step interaction.
GOTCHAS:
- Prefer \`snapshot\` first to inspect the page. Use \`act\` only when the user explicitly wants interaction or when static tools cannot reach the needed state.
- Sessions are bounded and ephemeral; do not assume login or cookies persist between calls.`,
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
      "Path-driven file operations on the single flat `/workspace/` namespace. Read/write/delete/attach by exact listed `/workspace/...` path; never reconstruct paths from displayName/filename. Default visibility is current-chat scoped; widen to assistant or workspace_shared only on explicit user need. Writes are collision-safe by default, with `replace: true` as the exact-overwrite opt-in.",
    modelUsageGuidance: `Files in this workspace live under \`/workspace/\`. By default \`files.list\` shows only the current chat scope. Widen only when the user asks: \`scope:"assistant"\` for this assistant's other chats, then \`scope:"workspace_shared"\` for the whole workspace. Read/preview/attach/delete by exact path from the Working Files block, a scoped \`files.list\`, or a prior tool result; if touching a file outside the current chat scope, first surface it via widened list and then pass \`crossScope:true\`. By default writing to an existing path allocates a new sibling name like \`report (1).pdf\`, so previous deliveries stay intact. Pass \`replace: true\` on \`files.write\` only when the user explicitly asked to overwrite that exact file. Do not reconstruct upload paths from displayName/filename; uploads may be sanitized, renamed, or collision-suffixed. To create a new file, pick a new \`/workspace/...\` path. Use \`/tmp/\` for ephemeral scratch that the user should not see.
WHEN TO USE: Any file-system work in the assistant's pod workspace — list a directory, read or preview file content, write a new or updated file, delete a path, or attach an existing workspace file to chat.
EXAMPLES:
- files({action:"list", path:"/workspace/"}) — see files from the current chat only.
- files({action:"list", path:"/workspace/", scope:"assistant"}) — widen to this assistant's files from prior chats when the user asks.
- files({action:"read", path:"/workspace/report.csv"}) — read a current-chat file under /workspace/.
- files({action:"read", path:"/workspace/old-report.pdf", crossScope:true}) — read a cross-scope file only after surfacing it through a widened list.
- files({action:"preview", path:"/workspace/notes.md", maxBytes:4096}) — peek at the head of a large file.
- files({action:"write", path:"/workspace/draft.txt", content:"hello"}) — create a new file or allocate a sibling \` (N)\` filename when that exact path is already occupied.
- files({action:"delete", path:"/workspace/tmp.bin"}) — remove an unneeded file.
- files({action:"attach", path:"/workspace/draft.txt"}) — deliver a file to the user as a chat attachment.
GOTCHAS:
- Six actions only: list, read, preview, write, delete, attach. There is no legacy file-id selector and no search/send/edit action here.
- Paths must be pod-absolute and under /workspace/. Use /tmp/ for ephemeral scratch.
- For list supply the directory path; for read/preview/write/delete/attach supply the file path.
- For read/preview you may pass \`maxBytes\` to cap returned bytes; for list you may pass \`maxDepth\` to bound recursion. Server-side limits still apply.
- Default scope is the current chat. Cross-chat or cross-assistant files require an explicit widened \`files.list({scope})\` followed by \`crossScope:true\` on the concrete operation.
- By default writing to an existing path allocates a new sibling name like \`report (1).pdf\`, so previous deliveries stay intact. Pass \`replace: true\` only when the user explicitly asked to overwrite that exact file.
- attach delivers an EXISTING file; it does not regenerate. If the file is not yet written, write it first.`,
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
    modelUsageGuidance: `WHEN TO USE: Use shell proactively for multi-step autonomous work — pipelines, shell builtins, process composition, running scripts, build commands, transformations, runtime package installs, Git operations, and any multi-command sequencing inside the sandbox. Shell is the primary autonomous execution surface; do not wait to be asked.
SHELL ENVIRONMENT: /bin/bash with brace expansion, [[ … ]], <(…), set -o pipefail. Python 3 with system packages, plus session-scoped pip user-site at /workspace/.local (pip install <pkg> writes there; survives across turns within the session). Node 22 LTS with npm; npm install -g lands in /workspace/.npm-global, npm install (no -g) lands in /workspace/node_modules. Egress over HTTPS is allowlisted for github.com, *.github.com, *.githubusercontent.com, pypi.org, files.pythonhosted.org, registry.npmjs.org, *.npmjs.com — other hosts are denied.
EXAMPLES:
- shell({command:"pip install --quiet rich && python3 -c 'import rich; rich.print({\\"ok\\": True})'"}) — install a Python package (session-scoped) and use it.
- shell({command:"npm install left-pad && node -e 'console.log(require(\\"left-pad\\")(\\"42\\", 5, \\"0\\"))'"}) — install a Node package locally.
- shell({command:"git clone --depth 1 https://github.com/sindresorhus/awesome.git"}) — public HTTPS clone.
- shell({command:"git push https://<user>:<pat>@github.com/<owner>/<repo>.git main"}) — push to GitHub when you supply your own credentials in the URL (no PersAI token is injected; without auth GitHub returns 401).
- shell({command:"npm install && npm run build"}) — multi-step build pipeline.
- shell({command:"python3 script.py --input data.csv --output result.json"}) — run a script with arguments.
GOTCHAS:
- Refer to workspace files by pod-absolute path (/workspace/..., /workspace/...) or run with cwd set to your chat-scoped /workspace/chats/<chatId>/.
- pip install / npm install land under /workspace/ (session-scoped); they do not leak across assistants or workspaces.
- git push: PersAI never injects a GitHub token. Either bake credentials into the URL or write your own ~/.gitconfig — without auth GitHub returns 401.
- Non-allowlisted hosts (gitlab.com, bitbucket.org, custom CDNs) are denied at the egress proxy by SNI — a 1-line allowlist follow-up is the only path to expand.
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
- grep({pattern:"TODO"}) — find all TODO comments in the workspace.
- grep({pattern:"function processPayment", glob:"**/*.ts"}) — search TypeScript files for a function.
- grep({pattern:"ERROR", path:"logs/", caseInsensitive:true}) — search a specific directory case-insensitively.
- grep({pattern:"import.*from.*react", type:"ts"}) — grep by file type.
GOTCHAS:
- pattern is a regex; escape special chars (e.g. use \\. not . to match a literal dot).
- path is a workspace-relative directory to scope the search; omit to search the whole workspace.
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
- glob({pattern:"*.ts"}) — find all TypeScript files in the workspace.
- glob({pattern:"*.test.ts", path:"src/"}) — find test files in a specific directory.
- glob({pattern:"README*"}) — find README files of any extension.
GOTCHAS:
- pattern is a glob expression; use * for any characters in a segment, ** for any depth.
- path scopes the search to a workspace-relative directory; omit to search the whole workspace.
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
