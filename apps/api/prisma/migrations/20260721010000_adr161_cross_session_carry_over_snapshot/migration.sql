ALTER TABLE "assistant_chats"
ADD COLUMN "cross_session_carry_over_snapshot" TEXT,
DROP COLUMN "last_cross_session_carry_over_at";
