import assert from "node:assert/strict";
import { BadRequestException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ApiErrorHttpException } from "../src/modules/platform-core/interface/http/api-error";
import { InternalRuntimeSkillStateController } from "../src/modules/workspace-management/interface/http/internal-runtime-skill-state.controller";
import type { InternalRuntimeSkillStateService } from "../src/modules/workspace-management/application/internal-runtime-skill-state.service";

function setupEnv(): void {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  process.env.PERSAI_INTERNAL_API_TOKEN = "internal-token";
}

const AUTH_HEADER = { headers: { authorization: "Bearer internal-token" } };
const BAD_AUTH = { headers: { authorization: "Bearer wrong-token" } };

const ENGAGE_BODY = {
  assistantId: "00000000-0000-4000-8000-000000000001",
  channel: "web",
  surfaceThreadKey: "thread-1",
  action: "engage",
  expectedRoleId: "00000000-0000-4000-8000-000000000101",
  skillId: "00000000-0000-4000-8000-000000000201",
  scenarioKey: null
};

const ENGAGE_WITH_SCENARIO_BODY = {
  assistantId: "00000000-0000-4000-8000-000000000001",
  channel: "web",
  surfaceThreadKey: "thread-1",
  action: "engage",
  expectedRoleId: "00000000-0000-4000-8000-000000000101",
  skillId: "00000000-0000-4000-8000-000000000201",
  scenarioKey: "tax-advisory"
};

const RELEASE_BODY = {
  assistantId: "00000000-0000-4000-8000-000000000001",
  channel: "web",
  surfaceThreadKey: "thread-1",
  action: "release",
  expectedRoleId: "00000000-0000-4000-8000-000000000101"
};

async function run(): Promise<void> {
  setupEnv();

  // --- engage OK (no scenario) ---
  {
    const svc = {
      async apply() {
        return {
          action: "engaged" as const,
          skillId: "skill-finance",
          skillDisplayName: "Finance",
          scenarioKey: null,
          scenarioDisplayName: null
        };
      }
    } as InternalRuntimeSkillStateService;

    const controller = new InternalRuntimeSkillStateController(svc);
    const result = await controller.updateState(AUTH_HEADER, ENGAGE_BODY);
    assert.deepEqual(result, {
      ok: true,
      applied: true,
      action: "engaged",
      code: null,
      message: null,
      skillId: "skill-finance",
      skillDisplayName: "Finance",
      scenarioKey: null,
      scenarioDisplayName: null,
      previousSkillId: null
    });
  }

  // --- engage OK (with scenario) ---
  {
    const svc = {
      async apply() {
        return {
          action: "engaged" as const,
          skillId: "skill-finance",
          skillDisplayName: "Finance",
          scenarioKey: "tax-advisory",
          scenarioDisplayName: "Tax Advisory"
        };
      }
    } as InternalRuntimeSkillStateService;

    const controller = new InternalRuntimeSkillStateController(svc);
    const result = await controller.updateState(AUTH_HEADER, ENGAGE_WITH_SCENARIO_BODY);
    assert.deepEqual(result, {
      ok: true,
      applied: true,
      action: "engaged",
      code: null,
      message: null,
      skillId: "skill-finance",
      skillDisplayName: "Finance",
      scenarioKey: "tax-advisory",
      scenarioDisplayName: "Tax Advisory",
      previousSkillId: null
    });
  }

  // --- release OK ---
  {
    const svc = {
      async apply() {
        return {
          action: "released" as const,
          previousSkillId: "skill-finance"
        };
      }
    } as InternalRuntimeSkillStateService;

    const controller = new InternalRuntimeSkillStateController(svc);
    const result = await controller.updateState(AUTH_HEADER, RELEASE_BODY);
    assert.deepEqual(result, {
      ok: true,
      applied: true,
      action: "released",
      code: null,
      message: null,
      skillId: null,
      skillDisplayName: null,
      scenarioKey: null,
      scenarioDisplayName: null,
      previousSkillId: "skill-finance"
    });
  }

  // --- idempotent re-engage: same skill, service returns engaged again ---
  {
    const svc = {
      async apply() {
        return {
          action: "engaged" as const,
          skillId: "skill-finance",
          skillDisplayName: "Finance",
          scenarioKey: null,
          scenarioDisplayName: null
        };
      }
    } as InternalRuntimeSkillStateService;

    const controller = new InternalRuntimeSkillStateController(svc);
    const result = await controller.updateState(AUTH_HEADER, ENGAGE_BODY);
    assert.equal(result.action, "engaged");
    assert.equal(result.skillId, "skill-finance");
  }

  // --- service throws NotFoundException (chat not found) → propagated ---
  {
    const svc = {
      async apply() {
        throw new NotFoundException("Chat not found");
      }
    } as unknown as InternalRuntimeSkillStateService;

    const controller = new InternalRuntimeSkillStateController(svc);
    await assert.rejects(
      () => controller.updateState(AUTH_HEADER, ENGAGE_BODY),
      (err) => err instanceof NotFoundException
    );
  }

  // --- bad auth → UnauthorizedException ---
  {
    const svc = {
      async apply() {
        return {
          action: "released" as const,
          previousSkillId: null
        };
      }
    } as InternalRuntimeSkillStateService;

    const controller = new InternalRuntimeSkillStateController(svc);
    await assert.rejects(
      () => controller.updateState(BAD_AUTH, RELEASE_BODY),
      (err) => err instanceof UnauthorizedException
    );
  }

  // --- missing assistantId → BadRequestException ---
  {
    const svc = {
      async apply() {
        return { action: "released" as const, previousSkillId: null };
      }
    } as InternalRuntimeSkillStateService;

    const controller = new InternalRuntimeSkillStateController(svc);
    await assert.rejects(
      () => controller.updateState(AUTH_HEADER, { ...RELEASE_BODY, assistantId: undefined }),
      (err) => err instanceof BadRequestException
    );
  }

  // --- missing action → BadRequestException ---
  {
    const svc = {
      async apply() {
        return { action: "released" as const, previousSkillId: null };
      }
    } as InternalRuntimeSkillStateService;

    const controller = new InternalRuntimeSkillStateController(svc);
    await assert.rejects(
      () => controller.updateState(AUTH_HEADER, { ...RELEASE_BODY, action: "delete" }),
      (err) => err instanceof BadRequestException
    );
  }

  // --- malformed UUID inputs fail with stable typed validation before service execution ---
  {
    let applyCalls = 0;
    const svc = {
      async apply() {
        applyCalls += 1;
        throw new Error("must not execute");
      }
    } as unknown as InternalRuntimeSkillStateService;
    const controller = new InternalRuntimeSkillStateController(svc);
    for (const [body, code] of [
      [{ ...RELEASE_BODY, assistantId: "bad" }, "runtime_skill_state_invalid_assistant_id"],
      [{ ...RELEASE_BODY, expectedRoleId: "bad" }, "runtime_skill_state_invalid_expected_role_id"],
      [{ ...ENGAGE_BODY, skillId: "bad" }, "runtime_skill_state_invalid_skill_id"]
    ] as const) {
      await assert.rejects(
        () => controller.updateState(AUTH_HEADER, body),
        (error: unknown) =>
          error instanceof ApiErrorHttpException &&
          error.getStatus() === 400 &&
          error.errorObject.code === code
      );
    }
    assert.equal(applyCalls, 0);
  }
}

void run();
