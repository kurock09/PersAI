-- CreateEnum
CREATE TYPE "AdminNotificationChannelType" AS ENUM ('webhook');

-- CreateEnum
CREATE TYPE "AdminNotificationChannelStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "AdminNotificationDeliveryStatus" AS ENUM ('succeeded', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "workspace_admin_notification_channels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "channel_type" "AdminNotificationChannelType" NOT NULL,
    "status" "AdminNotificationChannelStatus" NOT NULL DEFAULT 'inactive',
    "endpoint_url" VARCHAR(512),
    "signing_secret" VARCHAR(256),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspace_admin_notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_notification_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "signal_code" VARCHAR(128) NOT NULL,
    "delivery_status" "AdminNotificationDeliveryStatus" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "error_message" VARCHAR(512),
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_admin_notification_channels_workspace_id_channel_type_key" ON "workspace_admin_notification_channels"("workspace_id", "channel_type");

-- CreateIndex
CREATE INDEX "workspace_admin_notification_channels_workspace_id_status_idx" ON "workspace_admin_notification_channels"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "admin_notification_deliveries_workspace_id_attempted_at_idx" ON "admin_notification_deliveries"("workspace_id", "attempted_at" DESC);

-- CreateIndex
CREATE INDEX "admin_notification_deliveries_channel_id_attempted_at_idx" ON "admin_notification_deliveries"("channel_id", "attempted_at" DESC);

-- AddForeignKey
ALTER TABLE "workspace_admin_notification_channels" ADD CONSTRAINT "workspace_admin_notification_channels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_admin_notification_channels" ADD CONSTRAINT "workspace_admin_notification_channels_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_notification_deliveries" ADD CONSTRAINT "admin_notification_deliveries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_notification_deliveries" ADD CONSTRAINT "admin_notification_deliveries_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "workspace_admin_notification_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
