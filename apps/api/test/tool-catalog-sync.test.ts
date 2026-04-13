import assert from "node:assert/strict";
import { TOOL_CATALOG } from "../prisma/tool-catalog-data";
import { upsertToolCatalogEntry } from "../prisma/tool-catalog-sync";

async function run(): Promise<void> {
  const scheduledAction = TOOL_CATALOG.find((entry) => entry.code === "scheduled_action");
  assert.ok(scheduledAction, "scheduled_action catalog entry must exist");

  const calls: Array<Record<string, unknown>> = [];
  const prisma = {
    toolCatalogTool: {
      async upsert(args: Record<string, unknown>) {
        calls.push(args);
        return undefined;
      }
    }
  };

  await upsertToolCatalogEntry(prisma as never, scheduledAction);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.where, { id: scheduledAction.id });
  assert.equal((calls[0]?.update as Record<string, unknown>).code, "scheduled_action");
  assert.equal((calls[0]?.create as Record<string, unknown>).id, scheduledAction.id);
  assert.equal((calls[0]?.create as Record<string, unknown>).code, "scheduled_action");
}

void run();
