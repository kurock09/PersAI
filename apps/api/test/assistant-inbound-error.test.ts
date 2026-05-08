import assert from "node:assert/strict";
import {
  createAssistantInboundConflict,
  toAssistantInboundFailurePayload
} from "../src/modules/workspace-management/application/assistant-inbound-error";

async function run(): Promise<void> {
  const failure = toAssistantInboundFailurePayload(
    createAssistantInboundConflict(
      "tool_daily_limit_reached",
      "Browser is exhausted for the current daily limit.",
      {
        userFacingGuidance: "Try a request that does not need Browser until the daily limit resets."
      }
    )
  );

  assert.deepEqual(failure, {
    code: "tool_daily_limit_reached",
    message: "Browser is exhausted for the current daily limit.",
    guidance: "Try a request that does not need Browser until the daily limit resets."
  });
}

void run();
