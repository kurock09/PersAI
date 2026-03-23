import assert from "node:assert/strict";
import { createDefaultTasksControlEnvelope } from "../src/modules/workspace-management/domain/assistant-tasks-control.defaults";
import { getTasksUserControlFlags } from "../src/modules/workspace-management/domain/tasks-user-controls";

const base = createDefaultTasksControlEnvelope();
const flags = getTasksUserControlFlags(base);

assert.equal(flags.userMayDisable, true);
assert.equal(flags.userMayEnable, true);
assert.equal(flags.userMayCancel, true);

const locked = {
  ...base,
  enablement: { ...(base.enablement as object), userMayDisable: false },
  cancellation: { ...(base.cancellation as object), userMayCancel: false }
};
const lockedFlags = getTasksUserControlFlags(locked);
assert.equal(lockedFlags.userMayDisable, false);
assert.equal(lockedFlags.userMayCancel, false);

console.log("tasks-user-controls tests passed");
