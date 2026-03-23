-- CreateEnum
CREATE TYPE "PlanCatalogStatus" AS ENUM ('active', 'inactive');

-- CreateTable
CREATE TABLE "plan_catalog_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "status" "PlanCatalogStatus" NOT NULL DEFAULT 'active',
    "is_default_first_registration_plan" BOOLEAN NOT NULL DEFAULT false,
    "is_trial_plan" BOOLEAN NOT NULL DEFAULT false,
    "trial_duration_days" INTEGER,
    "billing_provider_hints" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plan_catalog_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plan_catalog_plans_trial_duration_check" CHECK (
      ("is_trial_plan" = false AND "trial_duration_days" IS NULL)
      OR ("is_trial_plan" = true AND "trial_duration_days" IS NOT NULL AND "trial_duration_days" > 0)
    )
);

-- CreateTable
CREATE TABLE "plan_catalog_entitlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "capabilities" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "tool_classes" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "channels_and_surfaces" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "limits_permissions" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plan_catalog_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_catalog_plans_code_key" ON "plan_catalog_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_catalog_plans_default_first_registration_unique"
ON "plan_catalog_plans"("is_default_first_registration_plan")
WHERE "is_default_first_registration_plan" = true;

-- CreateIndex
CREATE INDEX "plan_catalog_plans_status_idx" ON "plan_catalog_plans"("status");

-- CreateIndex
CREATE UNIQUE INDEX "plan_catalog_entitlements_plan_id_key" ON "plan_catalog_entitlements"("plan_id");

-- AddForeignKey
ALTER TABLE "plan_catalog_entitlements"
ADD CONSTRAINT "plan_catalog_entitlements_plan_id_fkey"
FOREIGN KEY ("plan_id") REFERENCES "plan_catalog_plans"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
