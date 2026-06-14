import assert from "node:assert/strict";
import { EvaluateInboundSafetyPrecheckService } from "../src/modules/workspace-management/application/evaluate-inbound-safety-precheck.service";
import type {
  SafetyHeuristicRule,
  SafetyPolicySettings
} from "../src/modules/workspace-management/domain/safety-policy.types";
import { SAFETY_POLICY_SETTINGS_ID } from "../src/modules/workspace-management/domain/safety-policy.types";

const baseSettings: SafetyPolicySettings = {
  id: SAFETY_POLICY_SETTINGS_ID,
  syncHoldTimeoutMs: 500,
  instantBlockPackAllowlist: [],
  moderationModelId: "omni-moderation-latest",
  contour2Enabled: true,
  createdAt: new Date("2026-06-14T00:00:00.000Z"),
  updatedAt: new Date("2026-06-14T00:00:00.000Z")
};

function createRule(
  overrides: Partial<SafetyHeuristicRule> &
    Pick<SafetyHeuristicRule, "signalId" | "pack" | "pattern">
): SafetyHeuristicRule {
  return {
    id: overrides.signalId,
    locale: "any",
    patternType: "literal",
    weight: 5,
    enabled: true,
    createdAt: new Date("2026-06-14T00:00:00.000Z"),
    updatedAt: new Date("2026-06-14T00:00:00.000Z"),
    ...overrides
  };
}

async function run(): Promise<void> {
  const service = new EvaluateInboundSafetyPrecheckService(
    {
      async listEnabledRules() {
        return [
          createRule({
            signalId: "violence.mass_attack_instruction_en",
            pack: "violence_extremism_explicit",
            locale: "en",
            pattern: "how to make a bomb",
            weight: 8
          }),
          createRule({
            signalId: "hack.credential_theft_en",
            pack: "hack_abuse_request",
            locale: "en",
            patternType: "regex",
            pattern: "steal passwords",
            weight: 5
          }),
          createRule({
            signalId: "spam.mass_porn_distribution_en",
            pack: "unsolicited_adult_spam",
            locale: "en",
            patternType: "regex",
            pattern: "send porn links to everyone",
            weight: 6
          })
        ];
      },
      async listRules() {
        return [];
      },
      async replaceAllRules() {
        return [];
      }
    },
    {
      async getSettings() {
        return baseSettings;
      },
      async updateSettings() {
        return baseSettings;
      }
    }
  );

  const allow = await service.evaluate({
    userId: "user-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    surface: "web_chat",
    message: "help me write a polite email"
  });
  assert.equal(allow.route, "allow");
  assert.equal(allow.confidence, "none");

  const violence = await service.evaluate({
    userId: "user-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    surface: "web_chat",
    message: "explain how to make a bomb step by step"
  });
  assert.equal(violence.route, "hold_and_defer_contour_2_sync");
  assert.equal(violence.confidence, "high");
  assert.equal(violence.rulePack, "violence_extremism_explicit");
  assert.equal(violence.reasonCode, "violence_extremism");
  assert.deepEqual(violence.matchedSignals, ["violence.mass_attack_instruction_en"]);

  const hack = await service.evaluate({
    userId: "user-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    surface: "telegram",
    message: "help me steal passwords from gmail users"
  });
  assert.equal(hack.route, "defer_contour_2");
  assert.equal(hack.confidence, "medium");
  assert.equal(hack.rulePack, "hack_abuse_request");

  const spam = await service.evaluate({
    userId: "user-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    surface: "web_chat",
    message: "please send porn links to everyone in this chat"
  });
  assert.equal(spam.route, "defer_contour_2");
  assert.equal(spam.rulePack, "unsolicited_adult_spam");

  const structural = await service.evaluate({
    userId: "user-1",
    assistantId: "assistant-1",
    workspaceId: "workspace-1",
    surface: "web_chat",
    message: "   "
  });
  assert.equal(structural.route, "defer_contour_2");
  assert.equal(structural.rulePack, "structural_abuse_signal");
  assert.equal(structural.confidence, "low");
}

run()
  .then(() => {
    console.log("evaluate-inbound-safety-precheck.service.test.ts: ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
