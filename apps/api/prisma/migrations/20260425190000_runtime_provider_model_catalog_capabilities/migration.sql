ALTER TABLE "platform_runtime_provider_settings"
  ADD COLUMN "available_model_catalog_by_provider" JSONB NOT NULL DEFAULT
    '{"openai":{"chat":[],"image":[],"video":[]},"anthropic":{"chat":[],"image":[],"video":[]}}'::jsonb;

UPDATE "platform_runtime_provider_settings"
SET "available_model_catalog_by_provider" = jsonb_build_object(
  'openai',
  jsonb_build_object(
    'chat',
    CASE
      WHEN jsonb_typeof("available_models_by_provider" -> 'openai') = 'array'
      THEN "available_models_by_provider" -> 'openai'
      ELSE COALESCE("available_models_by_provider" -> 'openai' -> 'chat', '[]'::jsonb)
    END,
    'image',
    CASE
      WHEN jsonb_typeof("available_models_by_provider" -> 'openai') = 'object'
      THEN COALESCE("available_models_by_provider" -> 'openai' -> 'image', '[]'::jsonb)
      ELSE '[]'::jsonb
    END,
    'video',
    CASE
      WHEN jsonb_typeof("available_models_by_provider" -> 'openai') = 'object'
      THEN COALESCE("available_models_by_provider" -> 'openai' -> 'video', '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  ),
  'anthropic',
  jsonb_build_object(
    'chat',
    CASE
      WHEN jsonb_typeof("available_models_by_provider" -> 'anthropic') = 'array'
      THEN "available_models_by_provider" -> 'anthropic'
      ELSE COALESCE("available_models_by_provider" -> 'anthropic' -> 'chat', '[]'::jsonb)
    END,
    'image',
    CASE
      WHEN jsonb_typeof("available_models_by_provider" -> 'anthropic') = 'object'
      THEN COALESCE("available_models_by_provider" -> 'anthropic' -> 'image', '[]'::jsonb)
      ELSE '[]'::jsonb
    END,
    'video',
    CASE
      WHEN jsonb_typeof("available_models_by_provider" -> 'anthropic') = 'object'
      THEN COALESCE("available_models_by_provider" -> 'anthropic' -> 'video', '[]'::jsonb)
      ELSE '[]'::jsonb
    END
  )
);
