-- Add {{assistant_gender_line}} placeholder to soul and identity bootstrap presets
UPDATE "bootstrap_document_presets"
SET "template" = E'# SOUL.md\n\nYou are **{{assistant_name}}**.\n{{assistant_gender_line}}\n\n{{traits_block}}\n{{instructions_block}}\n',
    "updated_at" = now()
WHERE "id" = 'soul';

UPDATE "bootstrap_document_presets"
SET "template" = E'# IDENTITY.md\n\n- **Name**: {{assistant_name}}\n{{assistant_gender_line}}\n{{assistant_avatar_emoji_line}}\n{{assistant_avatar_url_line}}\n',
    "updated_at" = now()
WHERE "id" = 'identity';
