-- CreateEnum
CREATE TYPE "AssistantTaskRegistrySourceSurface" AS ENUM ('web');

-- CreateEnum
CREATE TYPE "AssistantTaskRegistryControlStatus" AS ENUM ('active', 'disabled', 'cancelled');

-- CreateTable
CREATE TABLE "assistant_task_registry_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assistant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "source_surface" "AssistantTaskRegistrySourceSurface" NOT NULL,
    "source_label" VARCHAR(64),
    "control_status" "AssistantTaskRegistryControlStatus" NOT NULL,
    "next_run_at" TIMESTAMPTZ(6),
    "disabled_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "external_ref" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_task_registry_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_task_registry_items_assistant_id_control_status_next_idx" ON "assistant_task_registry_items"("assistant_id", "control_status", "next_run_at");

-- AddForeignKey
ALTER TABLE "assistant_task_registry_items" ADD CONSTRAINT "assistant_task_registry_items_assistant_id_user_id_fkey" FOREIGN KEY ("assistant_id", "user_id") REFERENCES "assistants"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_task_registry_items" ADD CONSTRAINT "assistant_task_registry_items_workspace_id_user_id_fkey" FOREIGN KEY ("workspace_id", "user_id") REFERENCES "workspace_members"("workspace_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
