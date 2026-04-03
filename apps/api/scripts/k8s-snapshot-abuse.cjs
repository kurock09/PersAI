/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");

const p = new PrismaClient();
const json = (rows) =>
  JSON.stringify(
    rows,
    (_, v) => (typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : v),
    2
  );

async function main() {
  const assistantStates = await p.$queryRawUnsafe(`
    SELECT assistant_id, surface, request_count, blocked_until, slowed_until, block_reason, last_seen_at
    FROM assistant_abuse_assistant_states
    ORDER BY last_seen_at DESC
    LIMIT 15
  `);
  console.log("=== assistant_abuse_assistant_states (latest 15) ===");
  console.log(json(assistantStates));

  const userStates = await p.$queryRawUnsafe(`
    SELECT assistant_id, user_id, surface, request_count, blocked_until, slowed_until, block_reason, last_seen_at
    FROM assistant_abuse_guard_states
    ORDER BY last_seen_at DESC
    LIMIT 15
  `);
  console.log("=== assistant_abuse_guard_states (latest 15) ===");
  console.log(json(userStates));

  const quota = await p.$queryRawUnsafe(`
    SELECT workspace_id, token_budget_used, token_budget_limit,
           cost_or_token_driving_tool_class_units_used,
           cost_or_token_driving_tool_class_units_limit,
           updated_at
    FROM workspace_quota_accounting
    ORDER BY updated_at DESC
    LIMIT 10
  `);
  console.log("=== workspace_quota_accounting (latest 10) ===");
  console.log(json(quota));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
