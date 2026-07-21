-- ADR-161: drop DeepSeek D2a append-trace tables after full product rollback.
-- Keeps 20260721180000 in history (already applied on persai-dev) and removes
-- the operational store so schema matches the reverted Prisma models.
DROP TABLE IF EXISTS "deepseek_chat_append_trace_events";
DROP TABLE IF EXISTS "deepseek_chat_append_traces";
