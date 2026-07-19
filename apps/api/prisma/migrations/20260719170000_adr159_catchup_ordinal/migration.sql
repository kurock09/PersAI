-- ADR-159: durable catch-up queue ordinals (honest 1/N … N/N across sequential
-- dispatches). Stamped when a handle becomes ready; wave total bumps as siblings
-- join the same open wave (ready/claimed/dispatched sharing catch_up_wave_id).
ALTER TABLE "assistant_async_job_handles"
  ADD COLUMN IF NOT EXISTS "catch_up_ordinal" INTEGER;

ALTER TABLE "assistant_async_job_handles"
  ADD COLUMN IF NOT EXISTS "catch_up_wave_total" INTEGER;

ALTER TABLE "assistant_async_job_handles"
  ADD COLUMN IF NOT EXISTS "catch_up_wave_id" UUID;
