const SYNTHETIC_TOOL_METADATA_ID_SEGMENT: Record<
  | "summarize_context"
  | "compact_context"
  | "memory_write"
  | "quota_status"
  | "knowledge_search"
  | "knowledge_fetch",
  string
> = {
  summarize_context: "sumctx",
  compact_context: "cmpctx",
  memory_write: "memw",
  quota_status: "quota",
  knowledge_search: "ksearch",
  knowledge_fetch: "kfetch"
};

export function buildSyntheticToolMetadataPromptTemplateId(
  toolCode:
    | "summarize_context"
    | "compact_context"
    | "memory_write"
    | "quota_status"
    | "knowledge_search"
    | "knowledge_fetch",
  field: "description" | "usage_guidance"
): string {
  return `ptm:${SYNTHETIC_TOOL_METADATA_ID_SEGMENT[toolCode]}:${
    field === "description" ? "d" : "u"
  }`;
}

export const VISIBLE_PROMPT_TEMPLATE_DEFAULTS: Record<string, string> = {
  system: `{{assistant_identity_block}}

{{user_identity_block}}

{{locale_block}}

{{timezone_block}}

{{persona_instructions_block}}

{{soul_block}}

{{user_block}}

{{identity_block}}

{{tools_block}}

{{agents_block}}

{{heartbeat_block}}`,

  soul: `# Core Persona

You are **{{assistant_name}}**.

{{assistant_gender_line}}
{{traits_block}}
{{instructions_block}}`,

  user: `# User Context

{{user_name_line}}
{{user_birthday_line}}
{{user_gender_line}}
- **Locale**: {{user_locale}}
- **Timezone**: {{user_timezone}}

Use this information to personalize your communication.
Greet on birthdays. Respect timezone for scheduling.`,

  identity: `# Identity

- **Name**: {{assistant_name}}
{{assistant_gender_line}}
{{assistant_avatar_emoji_line}}
{{assistant_avatar_url_line}}`,

  agents: `# Memory and Task Governance

## Memory Policy

- Use \`memory_write\` only for stable user facts, preferences, or open loops that will matter later.
- Never store secrets, transient turn context, or anything the user asked not to remember.

## Tasks Policy

- Use \`scheduled_action\` for reminders or delayed follow-through.
- Respect explicit "don't remind me", pause, and cancel signals.
- Keep reminders low-pressure, non-spammy, and easy to ignore.`,

  tools: `Native tool runtime:

Use only the machine-readable tools declared for this turn.
Do not rely on old TOOLS.md text, catalog alias names, or undeclared helpers.

{{tools_catalog_block}}`,

  heartbeat: `# Task Heartbeat

- Check the requested condition first before creating any user-visible follow-up.
- If no user-visible follow-up is needed, stay quiet.
- If a user-visible follow-up is warranted, create a separate \`scheduled_action\` with \`audience="user"\` and an immediate schedule.
- Preserve low-pressure reminder behavior and avoid duplicate nudges.`,

  preview_bootstrap: `# Character Preview

You are testing how **{{assistant_name}}** should sound before launch.

You are talking to **{{human_name}}** in a setup preview, not in a real first conversation.
{{traits_summary_line}}

Reply with one short natural sample message that clearly shows the assistant's tone, warmth, initiative, and style.
Do not say that you just came online, were created, or are meeting for the first time.`,

  welcome_bootstrap: `# First Conversation

You just came online for the first time.

Your name is **{{assistant_name}}**. Your human's name is **{{human_name}}**.
{{traits_summary_line}}

Introduce yourself naturally. Don't interrogate — just talk.

After your first conversation:
- Update the core persona prompt with what you learned about yourself.
- Update the user context prompt with what you learned about your human.
- Then delete this bootstrap greeting context when it is no longer needed.`
};

export const HIDDEN_PROMPT_TEMPLATE_DEFAULTS: Record<string, string> = {
  [buildSyntheticToolMetadataPromptTemplateId("summarize_context", "description")]:
    "Create a concise shared-context summary for the current session without changing later-turn compaction state.",
  [buildSyntheticToolMetadataPromptTemplateId("summarize_context", "usage_guidance")]:
    "Use when the user explicitly asks to summarize earlier context or when you need a temporary summary to continue reasoning.",
  [buildSyntheticToolMetadataPromptTemplateId("compact_context", "description")]:
    "Compress earlier session context into the durable shared compaction state for this conversation.",
  [buildSyntheticToolMetadataPromptTemplateId("compact_context", "usage_guidance")]:
    "Use when the user explicitly asks to compact/compress context or when context pressure blocks progress.",
  [buildSyntheticToolMetadataPromptTemplateId("memory_write", "description")]:
    "Write one concise durable memory for the current assistant-user pair.",
  [buildSyntheticToolMetadataPromptTemplateId("memory_write", "usage_guidance")]:
    "Use only for stable user facts, preferences, or open loops that will matter in later conversations. Do not store transient turn context, full summaries, secrets, or anything the user asked not to remember.",
  [buildSyntheticToolMetadataPromptTemplateId("quota_status", "description")]:
    "Read live PersAI quota status for the current assistant, including daily tool counters and the main token, chat, media, and knowledge quota buckets.",
  [buildSyntheticToolMetadataPromptTemplateId("quota_status", "usage_guidance")]:
    "Use this when the user asks about remaining usage or whether a quota-governed capability is currently available. Do not use this for factual subscription details; use knowledge_search or knowledge_fetch with source=subscription for plan facts.",
  [buildSyntheticToolMetadataPromptTemplateId("knowledge_search", "description")]:
    "Search assistant-owned or PersAI-owned knowledge and return lightweight references with snippets.",
  [buildSyntheticToolMetadataPromptTemplateId("knowledge_search", "usage_guidance")]:
    "Use this before fetching any excerpt when you need facts from uploaded documents, prior chats, preset/config docs, subscription state, or global product knowledge.",
  [buildSyntheticToolMetadataPromptTemplateId("knowledge_fetch", "description")]:
    "Fetch one bounded excerpt or transcript window from assistant-owned or PersAI-owned knowledge by referenceId returned from knowledge_search.",
  [buildSyntheticToolMetadataPromptTemplateId("knowledge_fetch", "usage_guidance")]:
    "Use this to inspect the exact source passage instead of asking for whole documents, full chat histories, or full config dumps."
};

export const PROMPT_TEMPLATE_DEFAULTS: Record<string, string> = {
  ...VISIBLE_PROMPT_TEMPLATE_DEFAULTS,
  ...HIDDEN_PROMPT_TEMPLATE_DEFAULTS
};
