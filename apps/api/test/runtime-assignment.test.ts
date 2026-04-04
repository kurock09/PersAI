import assert from "node:assert/strict";
import {
  readRuntimeAssignmentStateFromMaterializedLayers,
  resolveRuntimeAssignmentState
} from "../src/modules/workspace-management/application/runtime-assignment";

async function run(): Promise<void> {
  const fallback = resolveRuntimeAssignmentState({
    billingProviderHints: null,
    policyEnvelope: null
  });
  assert.deepEqual(fallback, {
    schema: "persai.runtimeAssignment.v1",
    planDefaultTier: null,
    runtimeTierOverride: null,
    effectiveTier: "free_shared_restricted",
    source: "platform_fallback"
  });

  const planDefault = resolveRuntimeAssignmentState({
    billingProviderHints: {
      schema: "persai.billingHints.v1",
      runtimeTierDefault: "paid_shared_restricted"
    },
    policyEnvelope: null
  });
  assert.deepEqual(planDefault, {
    schema: "persai.runtimeAssignment.v1",
    planDefaultTier: "paid_shared_restricted",
    runtimeTierOverride: null,
    effectiveTier: "paid_shared_restricted",
    source: "plan_default"
  });

  const override = resolveRuntimeAssignmentState({
    billingProviderHints: {
      schema: "persai.billingHints.v1",
      runtimeTierDefault: "paid_shared_restricted"
    },
    policyEnvelope: {
      runtimeAssignment: {
        schema: "persai.runtimeAssignmentPolicy.v1",
        runtimeTierOverride: "paid_isolated"
      }
    }
  });
  assert.deepEqual(override, {
    schema: "persai.runtimeAssignment.v1",
    planDefaultTier: "paid_shared_restricted",
    runtimeTierOverride: "paid_isolated",
    effectiveTier: "paid_isolated",
    source: "assistant_override"
  });

  assert.deepEqual(
    readRuntimeAssignmentStateFromMaterializedLayers({
      schema: "persai.materialization.v1",
      layers: {
        governance: {
          runtimeAssignment: override
        }
      }
    }),
    override
  );
}

void run();
