CREATE TYPE "AssistantChatMode" AS ENUM ('normal', 'smart', 'project');

ALTER TABLE "assistant_chats"
  ADD COLUMN "chat_mode" "AssistantChatMode" NOT NULL DEFAULT 'normal';

UPDATE "assistant_chats"
SET "chat_mode" = 'smart'
WHERE "deep_mode_enabled" = TRUE;
