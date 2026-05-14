import assert from "node:assert/strict";
import { RenderAssistantInboundSurfaceMessageService } from "../src/modules/workspace-management/application/render-assistant-inbound-surface-message.service";

async function run(): Promise<void> {
  const service = new RenderAssistantInboundSurfaceMessageService();

  assert.equal(
    service.renderError("telegram", "tool_daily_limit_reached", "fallback").text,
    "fallback"
  );

  assert.equal(
    service.renderError("telegram", "monthly_media_quota_exceeded", "fallback").text,
    "fallback"
  );

  assert.equal(
    service.renderError("telegram", "token_budget_exhausted", "fallback").text,
    "fallback"
  );

  assert.equal(
    service.renderError("reminder_callback", "runtime_unreachable", "fallback").text,
    "Reminder delivery is temporarily unavailable."
  );

  assert.equal(
    service.renderError("telegram", "assistant_activating", "fallback").text,
    "Assistant settings are still activating. Please wait a moment and try again."
  );

  assert.equal(
    service.renderError("reminder_callback", "assistant_activation_failed", "fallback").text,
    "Reminder delivery is blocked until assistant settings activation is retried."
  );
}

void run();
