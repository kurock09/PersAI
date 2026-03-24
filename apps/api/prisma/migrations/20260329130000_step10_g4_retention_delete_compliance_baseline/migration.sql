ALTER TABLE "app_users"
ADD COLUMN "terms_of_service_accepted_at" TIMESTAMPTZ(6),
ADD COLUMN "terms_of_service_version" VARCHAR(64),
ADD COLUMN "privacy_policy_accepted_at" TIMESTAMPTZ(6),
ADD COLUMN "privacy_policy_version" VARCHAR(64);
