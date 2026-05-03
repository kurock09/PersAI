import assert from "node:assert/strict";
import { RenderAssistantInboundSurfaceMessageService } from "../src/modules/workspace-management/application/render-assistant-inbound-surface-message.service";

async function run(): Promise<void> {
  const service = new RenderAssistantInboundSurfaceMessageService();

  assert.equal(
    service.renderError("telegram", "quota_limit_reached", "fallback").text,
    "Usage limit reached for the current plan. Please try again later."
  );

  assert.equal(
    service.renderError("telegram", "tool_daily_limit_reached", "fallback").text,
    "Daily tool usage limit reached. Please try again later."
  );

  assert.equal(
    service.renderError("telegram", "monthly_media_quota_exceeded", "fallback").text,
    "Monthly media quota has been exhausted. Wait for the next billing cycle or upgrade the plan."
  );

  assert.equal(
    service.renderError("reminder_callback", "runtime_unreachable", "fallback").text,
    "Reminder delivery is temporarily unavailable."
  );
}

void run();
