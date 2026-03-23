-- CreateEnum
CREATE TYPE "ToolCatalogToolClass" AS ENUM ('cost_driving', 'utility');

-- CreateEnum
CREATE TYPE "ToolCatalogCapabilityGroup" AS ENUM ('knowledge', 'automation', 'communication', 'workspace_ops');

-- CreateEnum
CREATE TYPE "ToolCatalogStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "PlanToolActivationStatus" AS ENUM ('active', 'inactive');

-- CreateTable
CREATE TABLE "tool_catalog_tools" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "capability_group" "ToolCatalogCapabilityGroup" NOT NULL,
    "tool_class" "ToolCatalogToolClass" NOT NULL,
    "status" "ToolCatalogStatus" NOT NULL DEFAULT 'active',
    "provider_hints" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tool_catalog_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_catalog_tool_activations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "tool_id" UUID NOT NULL,
    "activation_status" "PlanToolActivationStatus" NOT NULL DEFAULT 'inactive',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plan_catalog_tool_activations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tool_catalog_tools_code_key" ON "tool_catalog_tools"("code");

-- CreateIndex
CREATE INDEX "tool_catalog_tools_tool_class_status_idx"
ON "tool_catalog_tools"("tool_class", "status");

-- CreateIndex
CREATE UNIQUE INDEX "plan_catalog_tool_activations_plan_id_tool_id_key"
ON "plan_catalog_tool_activations"("plan_id", "tool_id");

-- CreateIndex
CREATE INDEX "plan_catalog_tool_activations_plan_id_activation_status_idx"
ON "plan_catalog_tool_activations"("plan_id", "activation_status");

-- AddForeignKey
ALTER TABLE "plan_catalog_tool_activations"
ADD CONSTRAINT "plan_catalog_tool_activations_plan_id_fkey"
FOREIGN KEY ("plan_id") REFERENCES "plan_catalog_plans"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_catalog_tool_activations"
ADD CONSTRAINT "plan_catalog_tool_activations_tool_id_fkey"
FOREIGN KEY ("tool_id") REFERENCES "tool_catalog_tools"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
