import { describe, expect, it } from "vitest";
import {
  buildRouterPrecheckRuleOverrides,
  buildSkillRoutingPolicyInput,
  parseRouterTriggerTerms
} from "./page";

describe("admin runtime router policy helpers", () => {
  it("parses one trigger phrase per line", () => {
    expect(parseRouterTriggerTerms("ok\ncontinue\nok")).toEqual(["ok", "continue"]);
  });

  it("builds per-category precheck overrides from admin textareas", () => {
    expect(
      buildRouterPrecheckRuleOverrides({
        continueTermsText: "ok\ncontinue\nok",
        retrievalTermsText: "find in docs",
        reasoningTermsText: "architecture",
        premiumTermsText: "cover letter",
        toolTermsText: "browse",
        productPriorityTermsText: "тариф\nplan",
        webPriorityTermsText: "today\nweather",
        personalPriorityTermsText: "i\nmy"
      })
    ).toEqual({
      continueTerms: ["ok", "continue"],
      retrievalTerms: ["find in docs"],
      reasoningTerms: ["architecture"],
      premiumTerms: ["cover letter"],
      toolTerms: ["browse"],
      productPriorityTerms: ["тариф", "plan"],
      webPriorityTerms: ["today", "weather"],
      personalPriorityTerms: ["i", "my"]
    });
  });

  it("returns null for blank overrides", () => {
    expect(
      buildRouterPrecheckRuleOverrides({
        continueTermsText: "   ",
        retrievalTermsText: "",
        reasoningTermsText: "",
        premiumTermsText: "",
        toolTermsText: "",
        productPriorityTermsText: "",
        webPriorityTermsText: "",
        personalPriorityTermsText: ""
      })
    ).toBeNull();
  });

  it("parses bounded skill routing cadence inputs", () => {
    expect(
      buildSkillRoutingPolicyInput({
        initialCheckUserMessageIndexText: "3",
        backgroundRecheckIntervalMessagesText: "5"
      })
    ).toEqual({
      initialCheckUserMessageIndex: 3,
      backgroundRecheckIntervalMessages: 5
    });
  });

  it("rejects invalid skill routing cadence inputs", () => {
    expect(() =>
      buildSkillRoutingPolicyInput({
        initialCheckUserMessageIndexText: "0",
        backgroundRecheckIntervalMessagesText: "x"
      })
    ).toThrow(/Initial background skill check must be between 1 and 20/);
  });
});
