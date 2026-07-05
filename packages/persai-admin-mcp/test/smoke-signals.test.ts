import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSkillActivationSummary,
  mapChatPlan,
  summarizeToolSignals
} from "../src/smoke-signals.js";

void test("summarizeToolSignals groups skill and todo_write calls", () => {
  const result = summarizeToolSignals([
    { name: "skill", iteration: 0, ok: true, toolCallId: "c1" },
    { name: "todo_write", iteration: 1, ok: true, toolCallId: "c2" },
    { name: "web_search", iteration: 2, ok: true }
  ]);
  assert.equal(result.skill.length, 1);
  assert.equal(result.todo_write.length, 1);
  assert.equal(result.other.length, 1);
});

void test("buildSkillActivationSummary prefers chat skill state", () => {
  const summary = buildSkillActivationSummary(
    {
      engagementSummary: {
        skillDisplayName: "Marketer",
        scenarioDisplayName: "Instagram carousel"
      },
      runtime: {
        turnRouting: {
          skillState: { status: "inactive", activeSkillId: null },
          retrievalPlan: { useSkills: true, selectedSkillIds: ["sk1"], reasonCode: "skill_match" }
        }
      }
    },
    {
      skillDecisionState: {
        status: "active",
        activeSkillId: "131c1531-5566-4ad2-9422-3b9b76f6d666",
        activeSkillName: "Marketer",
        activeScenarioKey: "instagram_carousel",
        activeScenarioDisplayName: "Instagram carousel"
      }
    }
  );
  assert.equal(summary.status, "active");
  assert.equal(summary.activeScenarioKey, "instagram_carousel");
  assert.deepEqual(summary.engagementSummary, {
    skillDisplayName: "Marketer",
    scenarioDisplayName: "Instagram carousel"
  });
});

void test("mapChatPlan normalizes todo rows", () => {
  const plan = mapChatPlan({
    totalCount: 2,
    windowed: false,
    todos: [
      { id: "t1", content: "Brief", status: "in_progress", parentId: null },
      { id: "t2", content: "Slides", status: "pending", parentId: null }
    ]
  });
  assert.equal(plan?.totalCount, 2);
  assert.equal((plan?.todos as unknown[]).length, 2);
});
