import { describe, expect, it } from "vitest";
import { resolveAssistantStatusLineText } from "./use-assistant-live-role-name";

describe("resolveAssistantStatusLineText", () => {
  it("shows the Role name when status is live/green", () => {
    expect(
      resolveAssistantStatusLineText({
        status: "live",
        statusLabel: "Активен",
        liveRoleName: "Аналитик"
      })
    ).toBe("Аналитик");
  });

  it("falls back to status label when live but Role name is missing", () => {
    expect(
      resolveAssistantStatusLineText({
        status: "live",
        statusLabel: "Active",
        liveRoleName: null
      })
    ).toBe("Active");
    expect(
      resolveAssistantStatusLineText({
        status: "live",
        statusLabel: "Active",
        liveRoleName: "   "
      })
    ).toBe("Active");
  });

  it("keeps the lifecycle status label for non-live states", () => {
    expect(
      resolveAssistantStatusLineText({
        status: "draft",
        statusLabel: "Draft",
        liveRoleName: "Analyst"
      })
    ).toBe("Draft");
    expect(
      resolveAssistantStatusLineText({
        status: "applying",
        statusLabel: "Applying...",
        liveRoleName: "Analyst"
      })
    ).toBe("Applying...");
    expect(
      resolveAssistantStatusLineText({
        status: "failed",
        statusLabel: "Failed",
        liveRoleName: "Analyst"
      })
    ).toBe("Failed");
  });
});
