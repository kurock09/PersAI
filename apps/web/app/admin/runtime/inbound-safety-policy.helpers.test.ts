import { describe, expect, it } from "vitest";
import type { SafetyHeuristicRuleState } from "@persai/contracts";
import {
  createDraftHeuristicRule,
  filterRulesByPack,
  replacePackRules,
  toHeuristicRuleUpsertPayload
} from "./inbound-safety-policy.helpers";

function sampleRule(overrides: Partial<SafetyHeuristicRuleState> = {}): SafetyHeuristicRuleState {
  return {
    id: "rule-1",
    signalId: "violence_en_1",
    pack: "violence_extremism_explicit",
    locale: "en",
    patternType: "literal",
    pattern: "test",
    weight: 4,
    enabled: true,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    ...overrides
  };
}

describe("inbound safety policy helpers", () => {
  it("filters and replaces pack rules without touching other packs", () => {
    const allRules = [
      sampleRule(),
      sampleRule({
        id: "rule-2",
        signalId: "hack_en_1",
        pack: "hack_abuse_request",
        pattern: "hack"
      })
    ];
    const updatedPack = [
      sampleRule({ pattern: "updated", enabled: false }),
      createDraftHeuristicRule("violence_extremism_explicit")
    ];
    const merged = replacePackRules(allRules, "violence_extremism_explicit", updatedPack);
    expect(filterRulesByPack(merged, "violence_extremism_explicit")).toHaveLength(2);
    expect(filterRulesByPack(merged, "hack_abuse_request")).toHaveLength(1);
    expect(filterRulesByPack(merged, "hack_abuse_request")[0]?.pattern).toBe("hack");
  });

  it("maps rules to upsert payload without ids", () => {
    const payload = toHeuristicRuleUpsertPayload([sampleRule()]);
    expect(payload).toEqual([
      {
        signalId: "violence_en_1",
        pack: "violence_extremism_explicit",
        locale: "en",
        patternType: "literal",
        pattern: "test",
        weight: 4,
        enabled: true
      }
    ]);
  });
});
