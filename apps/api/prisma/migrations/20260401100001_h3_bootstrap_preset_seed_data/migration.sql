-- H3.3: Seed default bootstrap document presets (idempotent)
INSERT INTO "bootstrap_document_presets" ("id", "template", "updated_at", "created_at")
VALUES
  ('soul', E'# SOUL.md\n\nYou are **{{assistant_name}}**.\n\n{{traits_block}}\n{{instructions_block}}', now(), now()),
  ('user', E'# USER.md — About Your Human\n\n{{user_name_line}}\n{{user_birthday_line}}\n{{user_gender_line}}\n- **Locale**: {{user_locale}}\n- **Timezone**: {{user_timezone}}\n\nUse this information to personalize your communication.\nGreet on birthdays. Respect timezone for scheduling.', now(), now()),
  ('identity', E'# IDENTITY.md\n\n- **Name**: {{assistant_name}}\n{{assistant_avatar_emoji_line}}\n{{assistant_avatar_url_line}}', now(), now()),
  ('agents', E'# AGENTS.md — Governance & Capabilities\n\n{{memory_policy_block}}\n{{tasks_policy_block}}', now(), now())
ON CONFLICT ("id") DO NOTHING;
