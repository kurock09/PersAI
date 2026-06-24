-- ADR-126 v2 Slice 3 — unified sandbox workspace
--
-- Two changes ship together because they are the precondition for the unified
-- files contract that lands in this slice:
--
-- 1. `assistants.handle` — a non-null, workspace-unique slug used to name the
--    per-assistant outbound directory inside session pods
--    (`/shared/<workspaceId>/outbound/<handle>/`) and the corresponding GCS
--    prefix (`workspaces/<workspaceId>/shared/outbound/<handle>/`). Backfill
--    is deterministic: lowercased ASCII slug of `draft_display_name`, capped
--    at 32 characters with the trailing hyphen stripped, fallback
--    `a-<first-8-hex-of-id>` when the slug would be empty. Collisions inside a
--    workspace get a `-1`, `-2`, … suffix in `created_at, id` order.
--
-- 2. `sandbox_workspace_gc_lease` — deferred garbage-collection schedule for
--    sandbox workspace content (chat scratch, assistant outbound, workspace
--    shared). Independent of the source rows so the existing chat / assistant
--    / workspace hard-delete transactions can keep their current shape while
--    the deferred purge of out-of-line state (GCS prefixes, warm pods, orphan
--    `assistant_files`) survives the disappearance of the source row.
--
-- Rollback path (manual): DROP TABLE "sandbox_workspace_gc_lease"; DROP TYPE
-- "SandboxWorkspaceGcLeaseKind"; ALTER TABLE "assistants" DROP COLUMN "handle".

-- --------------------------------------------------------------------------
-- 1. Assistants — add `handle` (nullable), backfill, then enforce NOT NULL +
--    workspace-unique.
-- --------------------------------------------------------------------------

ALTER TABLE "assistants" ADD COLUMN "handle" VARCHAR(64);

-- Backfill. The slug is computed in two passes:
--   pass A: build a deterministic base slug from `draft_display_name`.
--   pass B: within each workspace, rank rows by `(created_at, id)` and append
--           `-N` to all but the first occurrence of each (workspace_id, base)
--           tuple.
--
-- The slugifier:
--   * lower-cases the source string
--   * strips diacritics via the `unaccent` extension when available,
--     otherwise falls back to a regex replace that maps non-ASCII to `-`
--   * replaces runs of non-`[a-z0-9]` with a single `-`
--   * trims leading / trailing `-`
--   * truncates to 32 characters and re-trims the trailing `-`
--   * falls back to `a-<first-8-hex-of-id>` when the result is empty.

-- Build the base slug.
WITH base AS (
  SELECT
    a.id,
    a.workspace_id,
    a.created_at,
    COALESCE(NULLIF(
      TRIM(BOTH '-' FROM SUBSTRING(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            LOWER(COALESCE(a.draft_display_name, '')),
            '[^a-z0-9]+', '-', 'g'
          ),
          '(^-+|-+$)', '', 'g'
        )
        FROM 1 FOR 32
      )),
      ''
    ), 'a-' || SUBSTRING(a.id::text FROM 1 FOR 8)) AS raw_base
  FROM "assistants" a
),
trimmed AS (
  SELECT
    id,
    workspace_id,
    created_at,
    COALESCE(NULLIF(TRIM(BOTH '-' FROM raw_base), ''),
             'a-' || SUBSTRING(id::text FROM 1 FOR 8)) AS base_slug
  FROM base
),
ranked AS (
  SELECT
    id,
    workspace_id,
    base_slug,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, base_slug
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM trimmed
)
UPDATE "assistants" a
SET "handle" = CASE
  WHEN r.rn = 1 THEN r.base_slug
  ELSE
    SUBSTRING(r.base_slug FROM 1 FOR GREATEST(1, 64 - (LENGTH('-' || (r.rn - 1)::text))))
    || '-' || (r.rn - 1)::text
END
FROM ranked r
WHERE a.id = r.id;

-- Defensive: if any rows somehow still ended up NULL (shouldn't happen with the
-- fallback above), give them the deterministic fallback so the NOT NULL step
-- below can succeed.
UPDATE "assistants"
SET "handle" = 'a-' || SUBSTRING(id::text FROM 1 FOR 8)
WHERE "handle" IS NULL;

ALTER TABLE "assistants" ALTER COLUMN "handle" SET NOT NULL;

CREATE UNIQUE INDEX "assistants_workspace_id_handle_key"
  ON "assistants" ("workspace_id", "handle");

-- --------------------------------------------------------------------------
-- 2. `sandbox_workspace_gc_lease` — deferred GC schedule. Deliberately has no
--    FK to assistants / workspaces / chats because it must survive their
--    hard-delete.
-- --------------------------------------------------------------------------

CREATE TYPE "SandboxWorkspaceGcLeaseKind" AS ENUM (
  'chat_scratch',
  'assistant_outbound',
  'workspace_shared'
);

CREATE TABLE "sandbox_workspace_gc_lease" (
  "id"           UUID                          NOT NULL DEFAULT gen_random_uuid(),
  "kind"         "SandboxWorkspaceGcLeaseKind" NOT NULL,
  "target_id"    UUID                          NOT NULL,
  "scheduled_at" TIMESTAMPTZ(6)                NOT NULL,
  "purged_at"    TIMESTAMPTZ(6),
  "metadata"     JSONB                         NOT NULL,
  "created_at"   TIMESTAMPTZ(6)                NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sandbox_workspace_gc_lease_pkey" PRIMARY KEY ("id")
);

-- Reaper hot path: find due, un-purged leases per kind in scheduledAt order.
CREATE INDEX "sandbox_workspace_gc_lease_kind_scheduled_purged_idx"
  ON "sandbox_workspace_gc_lease" ("kind", "scheduled_at", "purged_at");

-- Targeted lookups (e.g. in-process eager call from hardDeleteChat needs to
-- find the lease it just wrote without scanning).
CREATE INDEX "sandbox_workspace_gc_lease_target_id_kind_idx"
  ON "sandbox_workspace_gc_lease" ("target_id", "kind");
