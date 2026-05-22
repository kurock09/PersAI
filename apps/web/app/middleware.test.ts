import { describe, expect, it } from "vitest";
import { middlewareMatcherForTests } from "../middleware";

function matchesMiddleware(pathname: string): boolean {
  return middlewareMatcherForTests.some((pattern) => new RegExp(`^${pattern}$`).test(pathname));
}

describe("middleware matcher", () => {
  it("keeps Kubernetes health probes outside Clerk middleware", () => {
    expect(matchesMiddleware("/api/health")).toBe(false);
    expect(matchesMiddleware("/api/ready")).toBe(false);
  });

  it("still protects app and API routes that require middleware", () => {
    expect(matchesMiddleware("/app")).toBe(true);
    expect(matchesMiddleware("/app/thread-1")).toBe(true);
    expect(matchesMiddleware("/api/assistant-file/file-1")).toBe(true);
    expect(matchesMiddleware("/api/support-attachment/attachment-1")).toBe(true);
    expect(matchesMiddleware("/api/admin-support-attachment/attachment-1")).toBe(true);
    expect(matchesMiddleware("/api/support-ticket/ticket-1/read")).toBe(true);
  });
});
