-- CreateEnum
CREATE TYPE "AssistantPreferredNotificationChannel" AS ENUM ('web', 'telegram', 'whatsapp');

-- AlterTable
ALTER TABLE "assistants"
ADD COLUMN "preferred_notification_channel" "AssistantPreferredNotificationChannel" NOT NULL DEFAULT 'web';
