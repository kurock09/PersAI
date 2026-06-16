import assert from "node:assert/strict";
import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { AdminSkillsController } from "../src/modules/workspace-management/interface/http/admin-skills.controller";
import type { ManageSkillScenariosService } from "../src/modules/workspace-management/application/manage-skill-scenarios.service";
import type { AdminSkillScenarioState } from "../src/modules/workspace-management/application/skill-scenario.types";

function setupEnv(): void {
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/persai_v2?schema=public";
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
}

function makeArchivedScenario(): AdminSkillScenarioState {
  return {
    id: "scenario-1",
    skillId: "skill-1",
    key: "instagram_carousel",
    displayName: { ru: "Карусель", en: "Carousel" },
    description: { ru: "Описание", en: "Description" },
    iconEmoji: null,
    intentExamples: [],
    steps: [],
    recommendedTools: [],
    exitCondition: "done",
    status: "archived",
    displayOrder: 100,
    createdAt: "2026-06-16T14:00:00.000Z",
    updatedAt: "2026-06-16T14:00:00.000Z"
  };
}

function makeReq(userId = "user-admin") {
  return {
    requestId: "req-1",
    resolvedAppUser: { id: userId }
  } as never;
}

function makeUnauthReq() {
  return {
    requestId: "req-1"
  } as never;
}

async function run(): Promise<void> {
  setupEnv();

  // --- admin auth scoping: unauthenticated request throws UnauthorizedException ---
  {
    const scenariosSvc = {
      parseCreateInput: () => ({}) as never,
      async createScenario() {
        return makeArchivedScenario();
      }
    } as unknown as ManageSkillScenariosService;

    const controller = new AdminSkillsController({} as never, {} as never, scenariosSvc);
    const unauthReq = makeUnauthReq();
    await assert.rejects(
      () => controller.createScenario(unauthReq, "skill-1", {}),
      (err) => err instanceof UnauthorizedException
    );
  }

  // --- DELETE returns archived scenario (200 with archived state) ---
  {
    const archivedScenario = makeArchivedScenario();
    const scenariosSvc = {
      async archiveScenario() {
        return archivedScenario;
      }
    } as unknown as ManageSkillScenariosService;

    const controller = new AdminSkillsController({} as never, {} as never, scenariosSvc);
    const result = await controller.archiveScenario(makeReq(), "skill-1", "instagram_carousel");
    assert.equal(result.scenario.status, "archived");
    assert.deepEqual(result.scenario, archivedScenario);
  }

  // --- DELETE: NotFoundException propagated when scenario not found ---
  {
    const scenariosSvc = {
      async archiveScenario() {
        throw new NotFoundException("Skill scenario not found.");
      }
    } as unknown as ManageSkillScenariosService;

    const controller = new AdminSkillsController({} as never, {} as never, scenariosSvc);
    await assert.rejects(
      () => controller.archiveScenario(makeReq(), "skill-1", "nonexistent"),
      (err) => err instanceof NotFoundException
    );
  }

  // --- GET listScenarios: returns array ---
  {
    const scenario = makeArchivedScenario();
    const scenariosSvc = {
      async listScenarios() {
        return [{ ...scenario, status: "active" as const }];
      }
    } as unknown as ManageSkillScenariosService;

    const controller = new AdminSkillsController({} as never, {} as never, scenariosSvc);
    const result = await controller.listScenarios(makeReq(), "skill-1");
    assert.equal(result.scenarios.length, 1);
    assert.equal(result.scenarios[0]?.status, "active");
  }

  console.log("admin-skill-scenarios.controller.test.ts: all tests passed");
}

void run();
