import assert from "node:assert/strict";
import { AutoSkillRoutingStateService } from "../src/modules/workspace-management/application/auto-skill-routing-state.service";

async function run(): Promise<void> {
  const service = new AutoSkillRoutingStateService({} as never);

  assert.equal(
    service.shouldRunBackgroundCheck({
      state: null,
      currentUserMessageIndex: 1,
      recentMessages: [{ role: "user", text: "Привет" }]
    }),
    true
  );
  assert.equal(
    service.shouldRunBackgroundCheck({
      state: null,
      currentUserMessageIndex: 2,
      recentMessages: [
        { role: "user", text: "У меня вес стоит" },
        { role: "assistant", text: "Расскажи про рацион." },
        { role: "user", text: "Калории 1800" }
      ]
    }),
    true
  );
  assert.equal(
    service.shouldRunBackgroundCheck({
      state: {
        status: "inactive",
        activeSkillId: null,
        activeSkillName: null,
        topicSummary: null,
        confidence: "low",
        checkedAtMessageIndex: 3,
        messageCountSinceCheck: 0
      },
      currentUserMessageIndex: 3,
      recentMessages: [{ role: "user", text: "Белка 120" }]
    }),
    true
  );
  assert.equal(
    service.shouldRunBackgroundCheck({
      state: null,
      currentUserMessageIndex: 4,
      recentMessages: [{ role: "user", text: "Unrelated" }]
    }),
    false
  );
  assert.equal(
    service.shouldRunBackgroundCheck({
      state: {
        status: "active",
        activeSkillId: "skill-diet",
        activeSkillName: "Диетолог",
        topicSummary: "nutrition",
        confidence: "high",
        checkedAtMessageIndex: 3,
        messageCountSinceCheck: 5
      },
      currentUserMessageIndex: 8,
      recentMessages: [{ role: "user", text: "А если добавить кардио?" }]
    }),
    true
  );
}

void run();
