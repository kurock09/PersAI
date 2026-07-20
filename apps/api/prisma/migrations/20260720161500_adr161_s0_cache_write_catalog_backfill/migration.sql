-- ADR-161 S0: persist the explicit token-metered cache-write quota weight in
-- the sole authoritative model-catalog JSON column. Explicit numeric values
-- are retained verbatim; only absent/null fields are backfilled.
--
-- The prior capability-object catalog shape is converted with the same fixed
-- capability → billing-mode defaults as normalizeLegacyCapabilityCatalog:
-- chat/image => token_metered, video => time_metered. The legacy migration
-- only created chat/image/video arrays, so any malformed legacy key fails
-- before this transaction mutates the catalog.
BEGIN;

-- A settings update writes the entire catalog JSON document. This lock blocks
-- those concurrent row writers from observing or replacing an intermediate
-- rebuild; every preflight/read/rebuild/write below is one transaction.
LOCK TABLE "platform_runtime_provider_settings" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "platform_runtime_provider_settings" AS settings
    CROSS JOIN LATERAL jsonb_each(settings."available_model_catalog_by_provider") AS provider(key, value)
    WHERE jsonb_typeof(provider.value) = 'object'
      AND jsonb_typeof(provider.value -> 'models') IS DISTINCT FROM 'array'
      AND (provider.value ?| ARRAY['chat', 'image', 'video'])
      AND (
        (provider.value ? 'chat' AND jsonb_typeof(provider.value -> 'chat') <> 'array')
        OR (provider.value ? 'image' AND jsonb_typeof(provider.value -> 'image') <> 'array')
        OR (provider.value ? 'video' AND jsonb_typeof(provider.value -> 'video') <> 'array')
      )
  ) THEN
    RAISE EXCEPTION
      'ADR-161 S0 cannot normalize malformed legacy provider catalog arrays';
  END IF;
END
$$;

WITH provider_rows AS (
  SELECT
    settings.id,
    settings."available_models_by_provider",
    provider.key,
    provider.value
  FROM "platform_runtime_provider_settings" AS settings
  CROSS JOIN LATERAL jsonb_each(settings."available_model_catalog_by_provider") AS provider(key, value)
),
rebuilt AS (
  SELECT
    provider_rows.id,
    jsonb_object_agg(
      provider_rows.key,
      CASE
        -- Preserve non-object and unknown object entries exactly. In particular,
        -- never replace a missing/non-array models member with JSON null.
        WHEN jsonb_typeof(provider_rows.value) <> 'object' THEN provider_rows.value
        WHEN jsonb_typeof(provider_rows.value -> 'models') = 'array' THEN jsonb_set(
          provider_rows.value,
          '{models}',
          COALESCE(
            (
              SELECT jsonb_agg(
                CASE
                  WHEN model.value ->> 'billingMode' <> 'token_metered'
                    OR (
                      model.value ? 'cacheWriteInputTokenWeight'
                      AND model.value -> 'cacheWriteInputTokenWeight' <> 'null'::jsonb
                    )
                  THEN model.value
                  ELSE jsonb_set(
                    model.value,
                    '{cacheWriteInputTokenWeight}',
                    to_jsonb(
                      CASE
                        WHEN
                          COALESCE(model.value #>> '{providerPriceMetadata,tokenPricing,inputPer1M}', '') ~ '^[0-9]+(\.[0-9]+)?$'
                          AND COALESCE(model.value #>> '{providerPriceMetadata,tokenPricing,cacheCreationInputPer1M}', '') ~ '^[0-9]+(\.[0-9]+)?$'
                          AND (model.value #>> '{providerPriceMetadata,tokenPricing,inputPer1M}')::numeric > 0
                          AND (model.value #>> '{providerPriceMetadata,tokenPricing,cacheCreationInputPer1M}')::numeric > 0
                        THEN (
                          CASE
                            WHEN COALESCE(model.value ->> 'inputTokenWeight', '') ~ '^[0-9]+(\.[0-9]+)?$'
                            THEN (model.value ->> 'inputTokenWeight')::numeric
                            ELSE 1::numeric
                          END
                        ) * (
                          (model.value #>> '{providerPriceMetadata,tokenPricing,cacheCreationInputPer1M}')::numeric /
                          (model.value #>> '{providerPriceMetadata,tokenPricing,inputPer1M}')::numeric
                        )
                        ELSE CASE
                          WHEN COALESCE(model.value ->> 'inputTokenWeight', '') ~ '^[0-9]+(\.[0-9]+)?$'
                          THEN (model.value ->> 'inputTokenWeight')::numeric
                          ELSE 1::numeric
                        END
                      END
                    ),
                    true
                  )
                END
                ORDER BY model.ord
              )
              FROM jsonb_array_elements(provider_rows.value -> 'models')
                WITH ORDINALITY AS model(value, ord)
            ),
            '[]'::jsonb
          ),
          true
        )
        WHEN provider_rows.value ?| ARRAY['chat', 'image', 'video'] THEN jsonb_build_object(
          'models',
          COALESCE(
            (
              SELECT jsonb_agg(profile.profile ORDER BY profile.first_ord)
              FROM (
                SELECT
                  legacy.model,
                  min(legacy.ord) AS first_ord,
                  jsonb_build_object(
                    'model', legacy.model,
                    'capabilities', jsonb_agg(legacy.capability ORDER BY legacy.capability_ord),
                    'kind', CASE WHEN provider_rows.key = 'heygen' THEN 'talking_avatar' ELSE 'cinematic' END,
                    'active', true,
                    'effectiveFrom', null,
                    'effectiveTo', null,
                    'inputTokenWeight', 1,
                    'cacheWriteInputTokenWeight', 1,
                    'cachedInputTokenWeight', 1,
                    'outputTokenWeight', 1,
                    'maxOutputTokens', null,
                    'contextWindow', null,
                    'promptCachePolicy', null,
                    'displayLabel', null,
                    'notes', null,
                    'billingMode',
                      CASE
                        WHEN bool_or(legacy.capability IN ('chat', 'image')) THEN 'token_metered'
                        ELSE 'time_metered'
                      END,
                    'providerPriceMetadata',
                      CASE
                        WHEN bool_or(legacy.capability IN ('chat', 'image')) THEN
                          jsonb_build_object(
                            'currency', 'USD',
                            'tokenPricing', jsonb_build_object(
                              'inputPer1M', 0,
                              'cacheCreationInputPer1M', 0,
                              'cachedInputPer1M', 0,
                              'outputPer1M', 0
                            )
                          )
                        ELSE jsonb_build_object(
                          'currency', 'USD',
                          'timePricing', jsonb_build_object('unit', 'minute', 'pricePerUnit', 0)
                        )
                      END
                  ) AS profile
                FROM (
                  SELECT
                    raw.model,
                    raw.capability,
                    raw.capability_ord,
                    min(raw.ord) AS ord
                  FROM (
                    SELECT chat.value #>> '{}' AS model, 'chat'::text AS capability, 1 AS capability_ord, chat.ord
                    FROM jsonb_array_elements(
                      CASE
                        WHEN
                          jsonb_typeof(provider_rows.value -> 'chat') = 'array'
                          AND jsonb_array_length(provider_rows.value -> 'chat') > 0
                        THEN provider_rows.value -> 'chat'
                        WHEN
                          provider_rows.key IN ('openai', 'anthropic', 'deepseek')
                          AND jsonb_typeof(
                            provider_rows."available_models_by_provider" -> provider_rows.key
                          ) = 'array'
                        THEN provider_rows."available_models_by_provider" -> provider_rows.key
                        ELSE '[]'::jsonb
                      END
                    ) WITH ORDINALITY AS chat(value, ord)
                    UNION ALL
                    SELECT image.value #>> '{}', 'image', 2, image.ord + 1000000
                    FROM jsonb_array_elements(provider_rows.value -> 'image') WITH ORDINALITY AS image(value, ord)
                    UNION ALL
                    SELECT video.value #>> '{}', 'video', 3, video.ord + 2000000
                    FROM jsonb_array_elements(provider_rows.value -> 'video') WITH ORDINALITY AS video(value, ord)
                  ) AS raw
                  GROUP BY raw.model, raw.capability, raw.capability_ord
                ) AS legacy
                GROUP BY legacy.model
              ) AS profile
            ),
            '[]'::jsonb
          )
        )
        ELSE provider_rows.value
      END
    ) AS catalog
  FROM provider_rows
  GROUP BY provider_rows.id
)
UPDATE "platform_runtime_provider_settings" AS settings
SET
  "available_model_catalog_by_provider" = rebuilt.catalog,
  "updated_at" = NOW()
FROM rebuilt
WHERE settings.id = rebuilt.id
  AND settings."available_model_catalog_by_provider" IS DISTINCT FROM rebuilt.catalog;

COMMIT;
