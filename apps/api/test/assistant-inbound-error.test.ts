import assert from "node:assert/strict";
import {
  createAssistantInboundConflict,
  createAssistantInboundSafetyRestrictedError,
  toAssistantInboundFailurePayload
} from "../src/modules/workspace-management/application/assistant-inbound-error";
import { SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE } from "../src/modules/workspace-management/domain/safety-policy.types";

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

  const localizedFailure = toAssistantInboundFailurePayload(
    new Error("Runtime authorization failed for this turn."),
    "ru"
  );
  assert.equal(localizedFailure.code, "assistant_turn_failed");
  assert.equal(localizedFailure.message, "Не удалось выполнить ход ассистента.");

  const safetyFailure = toAssistantInboundFailurePayload(
    createAssistantInboundSafetyRestrictedError(SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE, {
      reasonCode: "violence_extremism"
    })
  );
  assert.deepEqual(safetyFailure, {
    code: "safety_restricted",
    message: SAFETY_INBOUND_RESTRICTED_PLACEHOLDER_MESSAGE,
    guidance: null
  });
}

void run();
