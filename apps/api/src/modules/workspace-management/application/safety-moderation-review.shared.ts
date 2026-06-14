import type { InboundSafetyPrecheckOutcome } from "../domain/safety-policy.types";
import { SAFETY_MODERATION_THREAD_PREVIEW_MAX_CHARS } from "../domain/safety-moderation.types";

export function readPrecheckOutcome(raw: unknown): InboundSafetyPrecheckOutcome {
  if (raw === null || typeof raw !== "object") {
    return {
      route: "allow",
      confidence: "none",
      reasonCode: "none",
      rulePack: null,
      matchedSignals: []
    };
  }
  const row = raw as Record<string, unknown>;
  const route = row.route;
  const confidence = row.confidence;
  const reasonCode = row.reasonCode;
  const rulePack = row.rulePack;
  const matchedSignals = row.matchedSignals;
  return {
    route:
      route === "defer_contour_2" ||
      route === "block_obvious" ||
      route === "hold_and_defer_contour_2_sync" ||
      route === "allow"
        ? route
        : "allow",
    confidence:
      confidence === "low" ||
      confidence === "medium" ||
      confidence === "high" ||
      confidence === "none"
        ? confidence
        : "none",
    reasonCode: typeof reasonCode === "string" ? reasonCode : "none",
    rulePack:
      typeof rulePack === "string" ? (rulePack as InboundSafetyPrecheckOutcome["rulePack"]) : null,
    matchedSignals: Array.isArray(matchedSignals)
      ? matchedSignals.filter((entry): entry is string => typeof entry === "string")
      : []
  };
}

export function readTriggerText(messageSnapshot: unknown): string {
  if (messageSnapshot === null || typeof messageSnapshot !== "object") {
    return "";
  }
  const row = messageSnapshot as Record<string, unknown>;
  if (typeof row.triggerText === "string") {
    return row.triggerText.trim();
  }
  return "";
}

export function previewThreadText(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= SAFETY_MODERATION_THREAD_PREVIEW_MAX_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, SAFETY_MODERATION_THREAD_PREVIEW_MAX_CHARS)}…`;
}

export function shouldEnqueueContour2Review(route: InboundSafetyPrecheckOutcome["route"]): boolean {
  return (
    route === "defer_contour_2" ||
    route === "block_obvious" ||
    route === "hold_and_defer_contour_2_sync"
  );
}

export function requiresInboundSafetySyncHold(
  route: InboundSafetyPrecheckOutcome["route"]
): boolean {
  return route === "block_obvious" || route === "hold_and_defer_contour_2_sync";
}
