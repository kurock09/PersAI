import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TurnContextHydrationService } from "../../runtime/src/modules/turns/turn-context-hydration.service";

type HydrationAccessor = {
  withTruncationMarker: (
    content: string,
    message: {
      author: "assistant";
      metadata?: { status?: string; stopReason?: string } | null;
    }
  ) => string;
  isHydratableCanonicalMessage: (message: {
    author: "user" | "assistant" | "system";
    content: string;
    attachments: unknown[];
    metadata?: { status?: string; stopReason?: string } | null;
  }) => boolean;
};

function createHydrationAccessor(): HydrationAccessor {
  const service = Object.create(TurnContextHydrationService.prototype) as HydrationAccessor;
  return service;
}

describe("turn-context-hydration user_stopped marker", () => {
  test("partial assistant message with user_stopped gets explicit next-turn marker", () => {
    const service = createHydrationAccessor();
    const marked = service.withTruncationMarker("Partial answer", {
      author: "assistant",
      metadata: { status: "partial", stopReason: "user_stopped" }
    });
    assert.match(
      marked,
      /the user explicitly stopped the previous assistant turn before it finished/
    );
  });

  test("generic partial interruption keeps the legacy marker", () => {
    const service = createHydrationAccessor();
    const marked = service.withTruncationMarker("Partial answer", {
      author: "assistant",
      metadata: { status: "partial" }
    });
    assert.match(marked, /the previous answer was interrupted before completion/);
    assert.doesNotMatch(marked, /explicitly stopped/);
  });

  test("empty partial assistant row with user_stopped is hydratable and gets explicit marker", () => {
    const service = createHydrationAccessor();
    const message = {
      author: "assistant" as const,
      content: "",
      attachments: [],
      metadata: { status: "partial", stopReason: "user_stopped" }
    };
    assert.equal(service.isHydratableCanonicalMessage(message), true);
    const marked = service.withTruncationMarker("", message);
    assert.match(
      marked,
      /the user explicitly stopped the previous assistant turn before it finished/
    );
  });

  test("empty assistant row without user_stopped remains non-hydratable", () => {
    const service = createHydrationAccessor();
    assert.equal(
      service.isHydratableCanonicalMessage({
        author: "assistant",
        content: "",
        attachments: [],
        metadata: { status: "partial" }
      }),
      false
    );
  });
});
