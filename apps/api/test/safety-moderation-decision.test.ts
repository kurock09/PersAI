import assert from "node:assert/strict";
import {
  decideSafetyModerationOutcome,
  isWarnFirstSafetyPack,
  resolveModerationReasonCode,
  resolveTopModerationCategory
} from "../src/modules/workspace-management/application/safety-moderation-decision";

const THRESHOLDS = {
  blockScoreThreshold: 0.85,
  warnScoreThreshold: 0.5,
  warnFirstBlockScoreThreshold: 0.92
};

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
    ...THRESHOLDS
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
    ...THRESHOLDS
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
    ...THRESHOLDS
  });
  assert.equal(warned.decision, "warn");

  const hackWarn = decideSafetyModerationOutcome({
    moderation: {
      flagged: true,
      categories: { illicit: true },
      categoryScores: { illicit: 0.72 }
    },
    precheck: {
      route: "defer_contour_2",
      confidence: "medium",
      reasonCode: "hack_abuse",
      rulePack: "hack_abuse_request",
      matchedSignals: ["hack.credential_theft_en"]
    },
    ...THRESHOLDS
  });
  assert.equal(hackWarn.decision, "warn");

  const hackBlock = decideSafetyModerationOutcome({
    moderation: {
      flagged: true,
      categories: { illicit: true },
      categoryScores: { illicit: 0.94 }
    },
    precheck: {
      route: "defer_contour_2",
      confidence: "medium",
      reasonCode: "hack_abuse",
      rulePack: "hack_abuse_request",
      matchedSignals: ["hack.credential_theft_en"]
    },
    ...THRESHOLDS
  });
  assert.equal(hackBlock.decision, "block_user");

  const csamBlock = decideSafetyModerationOutcome({
    moderation: {
      flagged: true,
      categories: { "sexual/minors": true },
      categoryScores: { "sexual/minors": 0.55 }
    },
    precheck: {
      route: "defer_contour_2",
      confidence: "medium",
      reasonCode: "unsolicited_adult_spam",
      rulePack: "unsolicited_adult_spam",
      matchedSignals: []
    },
    ...THRESHOLDS
  });
  assert.equal(csamBlock.decision, "block_user");

  assert.equal(isWarnFirstSafetyPack("hack_abuse_request"), true);
  assert.equal(isWarnFirstSafetyPack("violence_extremism_explicit"), false);

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
