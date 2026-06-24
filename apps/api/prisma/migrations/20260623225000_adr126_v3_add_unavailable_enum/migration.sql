-- ADR-126 v3 Wave 1 (pre-cutover) — extend attachment_processing_status with the
-- 'unavailable' label so the W1 backfill UPDATE in
-- 20260623230000_adr126_v3_drop_assistant_files_and_path_identity can reference
-- it.
--
-- Postgres rejects using a freshly-added enum value inside the same transaction
-- that added it (55P04: "unsafe use of new value … New enum values must be
-- committed before they can be used."). Splitting the ADD VALUE into its own
-- migration commits the change first; the next migration then UPDATEs rows to
-- the new label.

ALTER TYPE "attachment_processing_status" ADD VALUE IF NOT EXISTS 'unavailable';
