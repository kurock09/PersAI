import assert from "node:assert/strict";
import { HttpStatus } from "@nestjs/common";
import { EnforceInboundSafetyGateService } from "../src/modules/workspace-management/application/enforce-inbound-safety-gate.service";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import type { UserRestriction } from "../src/modules/workspace-management/domain/user-restriction.entity";

function createRestriction(overrides: Partial<UserRestriction> = {}): UserRestriction {
  return {
    id: "restriction-1",
    userId: "user-1",
    kind: "safety",
    status: "active",
    blockedUntil: null,
    reasonCode: "violence_extremism",
    source: "moderation_auto",
    sourceAssistantId: "assistant-1",
    sourceModerationCaseId: "case-1",
    clearedAt: null,
    clearedByUserId: null,
    createdAt: new Date("2026-06-14T00:00:00.000Z"),
    updatedAt: new Date("2026-06-14T00:00:00.000Z"),
    ...overrides
  };
}

async function run(): Promise<void> {
  const service = new EnforceInboundSafetyGateService({
    async findActiveSafetyRestriction(userId: string) {
      if (userId === "restricted-user") {
        return createRestriction({ userId });
      }
      return null;
    }
  });

  await service.enforceActiveSafetyRestriction("allowed-user");

  await assert.rejects(
    () => service.enforceActiveSafetyRestriction("restricted-user"),
    (error: unknown) => {
      assert.ok(error instanceof ApiErrorHttpException);
      assert.equal(error.getStatus(), HttpStatus.FORBIDDEN);
      assert.equal(error.errorObject.code, "safety_restricted");
      assert.equal(error.errorObject.category, "forbidden");
      assert.equal(error.errorObject.details?.reasonCode, "violence_extremism");
      return true;
    }
  );
}

run()
  .then(() => {
    console.log("enforce-inbound-safety-gate.service.test.ts: ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
