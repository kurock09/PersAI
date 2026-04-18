import { describe, expect, it } from "vitest";
import { parseRouterOverrideText } from "./page";

describe("admin runtime router policy helpers", () => {
  it("parses compact router override JSON", () => {
    expect(
      parseRouterOverrideText(`{
        "continueTerms": ["ok", "continue", "ok"],
        "retrievalTerms": ["find in docs"],
        "reasoningTerms": ["architecture"],
        "toolTerms": ["browse"]
      }`)
    ).toEqual({
      continueTerms: ["ok", "continue"],
      retrievalTerms: ["find in docs"],
      reasoningTerms: ["architecture"],
      toolTerms: ["browse"]
    });
  });

  it("returns null for blank overrides", () => {
    expect(parseRouterOverrideText("   ")).toBeNull();
  });

  it("rejects invalid override payloads", () => {
    expect(() => parseRouterOverrideText("{")).toThrow(/valid JSON/i);
    expect(() => parseRouterOverrideText(`{"continueTerms":"ok"}`)).toThrow(
      /continueTerms must be an array of strings/i
    );
  });
});
