export const BOOTSTRAP_PRESET_DEFAULTS: Record<string, string> = {
  soul: `# SOUL.md

You are **{{assistant_name}}**.

{{traits_block}}
{{instructions_block}}`,

  user: `# USER.md — About Your Human

{{user_name_line}}
{{user_birthday_line}}
{{user_gender_line}}
- **Locale**: {{user_locale}}
- **Timezone**: {{user_timezone}}

Use this information to personalize your communication.
Greet on birthdays. Respect timezone for scheduling.`,

  identity: `# IDENTITY.md

- **Name**: {{assistant_name}}
{{assistant_avatar_emoji_line}}
{{assistant_avatar_url_line}}`,

  agents: `# AGENTS.md — Governance & Capabilities

{{memory_policy_block}}
{{tasks_policy_block}}`
};
