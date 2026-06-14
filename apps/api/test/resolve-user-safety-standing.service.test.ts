import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResolveUserSafetyStandingService } from "../src/modules/workspace-management/application/resolve-user-safety-standing.service";

process.env.APP_ENV = "local";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "sk_test_1234567890123456";
process.env.PERSAI_INTERNAL_API_TOKEN =
  process.env.PERSAI_INTERNAL_API_TOKEN ?? "internal-token-1234567890";

describe("ResolveUserSafetyStandingService", () => {
  it("returns restricted when an active safety restriction exists", async () => {
    const service = new ResolveUserSafetyStandingService(
      {
        async findActiveSafetyRestriction() {
          return {
            reasonCode: "hack_abuse"
          };
        }
      } as never,
      {} as never
    );

    const standing = await service.execute("user-1");
    assert.equal(standing.standing, "restricted");
    assert.equal(standing.reasonCode, "hack_abuse");
  });

  it("returns warn with remaining days when a recent warn case exists", async () => {
    const warnCreatedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const service = new ResolveUserSafetyStandingService(
      {
        async findActiveSafetyRestriction() {
          return null;
        }
      } as never,
      {
        moderationCase: {
          async findFirst() {
            return {
              createdAt: warnCreatedAt,
              reasonCode: "hack_abuse"
            };
          }
        }
      } as never
    );

    const standing = await service.execute("user-1");
    assert.equal(standing.standing, "warn");
    assert.equal(standing.reasonCode, "hack_abuse");
    assert.equal(standing.daysRemaining !== null && standing.daysRemaining > 0, true);
    assert.equal(standing.observationEndsAt !== null, true);
  });
});
