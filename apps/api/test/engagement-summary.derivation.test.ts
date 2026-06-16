import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deriveEngagementSummary } from "../src/modules/workspace-management/application/web-chat.types";

describe("deriveEngagementSummary", () => {
  test("returns null when skillDecisionState is null", () => {
    assert.equal(deriveEngagementSummary(null), null);
  });

  test("returns null when skillDecisionState is undefined", () => {
    assert.equal(deriveEngagementSummary(undefined), null);
  });

  test("returns null when status is inactive", () => {
    assert.equal(
      deriveEngagementSummary({
        status: "inactive",
        activeSkillId: null,
        activeSkillName: null,
        activeScenarioKey: null,
        activeScenarioDisplayName: null,
        topicSummary: null
      }),
      null
    );
  });

  test("returns null when status is active but activeSkillName is null", () => {
    assert.equal(
      deriveEngagementSummary({
        status: "active",
        activeSkillId: "skill-1",
        activeSkillName: null,
        activeScenarioKey: null,
        activeScenarioDisplayName: null,
        topicSummary: null
      }),
      null
    );
  });

  test("returns engagementSummary without scenario when active and no scenario", () => {
    const result = deriveEngagementSummary({
      status: "active",
      activeSkillId: "skill-finance",
      activeSkillName: "Finance",
      activeScenarioKey: null,
      activeScenarioDisplayName: null,
      topicSummary: "budget questions"
    });
    assert.deepEqual(result, {
      skillDisplayName: "Finance",
      scenarioDisplayName: null
    });
  });

  test("returns engagementSummary with scenario when active with scenario", () => {
    const result = deriveEngagementSummary({
      status: "active",
      activeSkillId: "skill-finance",
      activeSkillName: "Finance",
      activeScenarioKey: "tax-advisory",
      activeScenarioDisplayName: "Tax Advisory",
      topicSummary: null
    });
    assert.deepEqual(result, {
      skillDisplayName: "Finance",
      scenarioDisplayName: "Tax Advisory"
    });
  });

  test("uses activeScenarioDisplayName from state, not scenarioKey", () => {
    const result = deriveEngagementSummary({
      status: "active",
      activeSkillId: "skill-marketing",
      activeSkillName: "Маркетолог",
      activeScenarioKey: "instagram-carousel",
      activeScenarioDisplayName: "Instagram-карусель",
      topicSummary: null
    });
    assert.deepEqual(result, {
      skillDisplayName: "Маркетолог",
      scenarioDisplayName: "Instagram-карусель"
    });
  });

  test("handles null activeScenarioDisplayName even when scenarioKey is set", () => {
    const result = deriveEngagementSummary({
      status: "active",
      activeSkillId: "skill-1",
      activeSkillName: "Helper",
      activeScenarioKey: "some-key",
      activeScenarioDisplayName: null,
      topicSummary: null
    });
    assert.deepEqual(result, {
      skillDisplayName: "Helper",
      scenarioDisplayName: null
    });
  });
});
