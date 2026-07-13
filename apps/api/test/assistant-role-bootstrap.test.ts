import assert from "node:assert/strict";
import { ensureDefaultAssistantRole } from "../prisma/assistant-role-bootstrap";
import {
  DEFAULT_ASSISTANT_ROLE_CREATE,
  DEFAULT_ASSISTANT_ROLE_ID,
  DEFAULT_ASSISTANT_ROLE_KEY
} from "../prisma/assistant-role-seed-data";

async function run(): Promise<void> {
  let upsertArgs: unknown;

  await ensureDefaultAssistantRole({
    assistantRole: {
      async upsert(args) {
        upsertArgs = args;
        return {
          id: DEFAULT_ASSISTANT_ROLE_ID,
          key: DEFAULT_ASSISTANT_ROLE_KEY
        };
      }
    }
  });

  assert.deepEqual(upsertArgs, {
    where: { id: DEFAULT_ASSISTANT_ROLE_ID },
    update: {},
    create: DEFAULT_ASSISTANT_ROLE_CREATE,
    select: { id: true, key: true }
  });

  await assert.rejects(
    () =>
      ensureDefaultAssistantRole({
        assistantRole: {
          async upsert() {
            return {
              id: DEFAULT_ASSISTANT_ROLE_ID,
              key: "unexpected_key"
            };
          }
        }
      }),
    /identity does not match/
  );

  await assert.rejects(
    () =>
      ensureDefaultAssistantRole({
        assistantRole: {
          async upsert() {
            throw new Error("Unique constraint failed on key persai_default");
          }
        }
      }),
    /Unique constraint failed/
  );
}

void run();
