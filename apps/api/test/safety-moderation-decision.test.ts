import assert from "node:assert/strict";
import {
  decideSafetyModerationOutcome,
  resolveModerationReasonCode,
  resolveTopModerationCategory
} from "../src/modules/workspace-management/application/safety-moderation-decision";

function runDecisionTests(): void {
  const blocked = decideSafetyModerationOutcome({
    moderation: {
      flagged: true,
      categories: { violence: true },
      categoryScores: { violence: 0.92 }
    },
    precheck: {
      route: "defer_contour_2",
      confidence: "high",
      reasonCode: "violence_extremism",
      rulePack: "violence_extremism_explicit",
      matchedSignals: ["violence.mass_attack_instruction_en"]
    },
    blockScoreThreshold: 0.85
  });
  assert.equal(blocked.decision, "block_user");
  assert.equal(blocked.reasonCode, "violence_extremism");

  const allowed = decideSafetyModerationOutcome({
    moderation: {
      flagged: false,
      categories: {},
      categoryScores: { violence: 0.1 }
    },
    precheck: {
      route: "allow",
      confidence: "none",
      reasonCode: "none",
      rulePack: null,
      matchedSignals: []
    },
    blockScoreThreshold: 0.85
  });
  assert.equal(allowed.decision, "allow");

  const warned = decideSafetyModerationOutcome({
    moderation: {
      flagged: false,
      categories: {},
      categoryScores: { harassment: 0.4 }
    },
    precheck: {
      route: "defer_contour_2",
      confidence: "medium",
      reasonCode: "structural_abuse_signal",
      rulePack: "structural_abuse_signal",
      matchedSignals: ["structural.repeated_caps_ru"]
    },
    blockScoreThreshold: 0.85
  });
  assert.equal(warned.decision, "warn");

  const top = resolveTopModerationCategory({
    harassment: 0.2,
    violence: 0.91
  });
  assert.deepEqual(top, { category: "violence", score: 0.91 });

  assert.equal(
    resolveModerationReasonCode({
      precheck: {
        route: "defer_contour_2",
        confidence: "high",
        reasonCode: "hack_abuse",
        rulePack: "hack_abuse_request",
        matchedSignals: []
      },
      topCategory: "illicit"
    }),
    "hack_abuse"
  );
}

runDecisionTests();
console.log("safety-moderation-decision.test.ts: ok");
