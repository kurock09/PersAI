import { describe, expect, it } from "vitest";
import { buildRouterPrecheckRuleOverrides, parseRouterTriggerTerms } from "./page";

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
        toolTermsText: "browse"
      })
    ).toEqual({
      continueTerms: ["ok", "continue"],
      retrievalTerms: ["find in docs"],
      reasoningTerms: ["architecture"],
      premiumTerms: ["cover letter"],
      toolTerms: ["browse"]
    });
  });

  it("returns null for blank overrides", () => {
    expect(
      buildRouterPrecheckRuleOverrides({
        continueTermsText: "   ",
        retrievalTermsText: "",
        reasoningTermsText: "",
        premiumTermsText: "",
        toolTermsText: ""
      })
    ).toBeNull();
  });
});
