import assert from "node:assert/strict";
import {
  hasContaminatedDescribeAction,
  isToolContractDescribeCall,
  isToolLevelContractDescribeCall,
  stripMistakenDescribeAction
} from "../src/modules/turns/runtime-tool-contract-describe";

export async function runRuntimeToolContractDescribeTest(): Promise<void> {
  assert.equal(isToolContractDescribeCall({ action: "describe" }), true);
  assert.equal(isToolLevelContractDescribeCall("image_generate", { action: "describe" }), true);
  assert.equal(hasContaminatedDescribeAction({ action: "describe" }), false);
  assert.deepEqual(stripMistakenDescribeAction({ action: "describe" }, "image_generate"), {
    action: "describe"
  });

  const contaminated = {
    action: "describe",
    outputMode: "series",
    size: "1536x1024",
    filename: "persai-architecture-series.png",
    seriesItems: ["hero", "memory", "channels"],
    count: 3,
    prompt: "series cover"
  };
  assert.equal(hasContaminatedDescribeAction(contaminated, "image_generate"), true);
  assert.equal(isToolContractDescribeCall(contaminated, "image_generate"), false);
  assert.equal(isToolLevelContractDescribeCall("image_generate", contaminated), false);
  assert.deepEqual(stripMistakenDescribeAction(contaminated, "image_generate"), {
    outputMode: "series",
    size: "1536x1024",
    filename: "persai-architecture-series.png",
    seriesItems: ["hero", "memory", "channels"],
    count: 3,
    prompt: "series cover"
  });

  const skillDescribe = { action: "describe", skillId: "skill-marketer" };
  assert.equal(hasContaminatedDescribeAction(skillDescribe, "skill"), false);
  assert.equal(isToolContractDescribeCall(skillDescribe, "skill"), true);
  assert.equal(isToolLevelContractDescribeCall("skill", skillDescribe), false);
  assert.deepEqual(stripMistakenDescribeAction(skillDescribe, "skill"), skillDescribe);

  assert.equal(
    hasContaminatedDescribeAction(
      { action: "describe", prompt: "", seriesItems: [], filename: null },
      "image_generate"
    ),
    false
  );
}
