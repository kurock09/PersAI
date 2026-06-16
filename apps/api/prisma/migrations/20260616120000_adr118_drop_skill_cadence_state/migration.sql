-- Rollback: ALTER TABLE "assistant_chats" ADD COLUMN "skill_cadence_state" JSONB;
ALTER TABLE "assistant_chats" DROP COLUMN "skill_cadence_state";
