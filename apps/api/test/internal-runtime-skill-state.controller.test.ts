import assert from "node:assert/strict";
import { BadRequestException, NotFoundException, UnauthorizedException } from "@nestjs/common";
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
  assistantId: "assistant-1",
  channel: "web",
  surfaceThreadKey: "thread-1",
  action: "engage",
  skillId: "skill-finance",
  scenarioKey: null
};

const RELEASE_BODY = {
  assistantId: "assistant-1",
  channel: "web",
  surfaceThreadKey: "thread-1",
  action: "release"
};

async function run(): Promise<void> {
  setupEnv();

  // --- engage OK ---
  {
    const svc = {
      async apply() {
        return {
          action: "engaged" as const,
          skillId: "skill-finance",
          skillDisplayName: "Finance",
          scenarioKey: null
        };
      }
    } as InternalRuntimeSkillStateService;

    const controller = new InternalRuntimeSkillStateController(svc);
    const result = await controller.updateState(AUTH_HEADER, ENGAGE_BODY);
    assert.deepEqual(result, {
      ok: true,
      action: "engaged",
      skillId: "skill-finance",
      skillDisplayName: "Finance",
      scenarioKey: null,
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
      action: "released",
      skillId: null,
      skillDisplayName: null,
      scenarioKey: null,
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
          scenarioKey: null
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
}

void run();
