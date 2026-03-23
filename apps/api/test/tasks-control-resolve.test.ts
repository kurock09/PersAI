import assert from "node:assert/strict";
import type { AssistantGovernance } from "../src/modules/workspace-management/domain/assistant-governance.entity";
import { createDefaultTasksControlEnvelope } from "../src/modules/workspace-management/domain/assistant-tasks-control.defaults";
import { resolveEffectiveTasksControlFromGovernance } from "../src/modules/workspace-management/domain/tasks-control-resolve";

const defaults = createDefaultTasksControlEnvelope();

assert.equal(resolveEffectiveTasksControlFromGovernance(null).schema, defaults.schema);

const baseGov = {
  id: "g1",
  assistantId: "a1",
  capabilityEnvelope: null,
  secretRefs: null,
  policyEnvelope: null,
  memoryControl: null,
  tasksControl: { schema: "custom.tasks", foo: 1 },
  quotaPlanCode: null,
  quotaHook: null,
  auditHook: null,
  createdAt: new Date(),
  updatedAt: new Date()
} satisfies AssistantGovernance;

assert.equal(
  (resolveEffectiveTasksControlFromGovernance(baseGov) as { foo?: number }).foo,
  1
);

const legacyGov: AssistantGovernance = {
  ...baseGov,
  tasksControl: null,
  policyEnvelope: {
    tasksControl: { schema: "legacy.v1", fromPolicy: true }
  }
};

assert.equal(
  (resolveEffectiveTasksControlFromGovernance(legacyGov) as { fromPolicy?: boolean }).fromPolicy,
  true
);

console.log("tasks-control-resolve tests passed");
