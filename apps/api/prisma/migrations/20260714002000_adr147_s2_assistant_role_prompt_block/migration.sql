DO $migration$
DECLARE
  current_template TEXT;
  assistant_count BIGINT;
  workspace_count BIGINT;
  identity_enabled_anchor CONSTANT TEXT :=
    '{{identity_block}}' || E'\n\n' || '{{enabled_skills_block}}';
  identity_role_enabled_anchor CONSTANT TEXT :=
    '{{identity_block}}' || E'\n\n' ||
    '{{assistant_role_block}}' || E'\n\n' ||
    '{{enabled_skills_block}}';
  -- Canonical visible system default minus only {{assistant_role_block}}.
  -- Kept in parity with apps/api/prisma/bootstrap-preset-data.ts
  -- VISIBLE_PROMPT_TEMPLATE_DEFAULTS.system (pre-role form).
  canonical_prerole_system CONSTANT TEXT := $adr147_s2_prerole${{soul_block}}

{{user_block}}

{{identity_block}}

{{enabled_skills_block}}

{{reminders_protocol_block}}

{{memory_protocol_block}}

{{response_contract_block}}

{{tools_block}}

{{agents_block}}$adr147_s2_prerole$;
BEGIN
  SELECT "template"
  INTO current_template
  FROM "bootstrap_document_presets"
  WHERE "id" = 'system'
  FOR UPDATE;

  IF current_template IS NULL THEN
    SELECT COUNT(*)::bigint INTO assistant_count FROM "assistants";
    SELECT COUNT(*)::bigint INTO workspace_count FROM "workspaces";

    IF assistant_count <> 0 OR workspace_count <> 0 THEN
      RAISE EXCEPTION
        'ADR-147 S2 requires canonical bootstrap_document_presets.id=system';
    END IF;

    -- Pristine migration-only DB: historical seeds never inserted system;
    -- application seed normally created it. Bootstrap the pre-role row so the
    -- one-time placeholder insertion below can run deterministically.
    INSERT INTO "bootstrap_document_presets" ("id", "template", "updated_at", "created_at")
    VALUES ('system', canonical_prerole_system, now(), now());

    SELECT "template"
    INTO current_template
    FROM "bootstrap_document_presets"
    WHERE "id" = 'system'
    FOR UPDATE;
  END IF;

  IF (
    length(current_template) -
    length(replace(current_template, '{{assistant_role_block}}', ''))
  ) / length('{{assistant_role_block}}') > 1 THEN
    RAISE EXCEPTION
      'ADR-147 S2 refuses duplicate assistant_role_block placeholders';
  END IF;

  IF position('{{assistant_role_block}}' IN current_template) = 0 THEN
    IF (
      length(current_template) -
      length(replace(current_template, identity_enabled_anchor, ''))
    ) / length(identity_enabled_anchor) <> 1 THEN
      RAISE EXCEPTION
        'ADR-147 S2 cannot locate one canonical identity/enabled-skills anchor';
    END IF;

    current_template := replace(
      current_template,
      identity_enabled_anchor,
      identity_role_enabled_anchor
    );
  ELSIF position(identity_role_enabled_anchor IN current_template) = 0 THEN
    RAISE EXCEPTION
      'ADR-147 S2 assistant_role_block exists outside the canonical identity/enabled-skills order';
  END IF;

  UPDATE "bootstrap_document_presets"
  SET
    "template" = current_template,
    "updated_at" = now()
  WHERE "id" = 'system'
    AND "template" IS DISTINCT FROM current_template;
END
$migration$;
