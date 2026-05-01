import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { ManageAssistantSkillsService } from "../src/modules/workspace-management/application/manage-assistant-skills.service";

type MockSkill = ReturnType<typeof createSkill>;
type MockAssignment = Record<string, unknown> & {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  skillId: string;
  status: string;
};
type SkillFindManyWhere = {
  workspaceId: string;
  id?: { in: string[] };
};
type AssignmentUpsertArgs = {
  where: { assistantId_skillId: { assistantId: string; skillId: string } };
  create: Record<string, unknown> & {
    assistantId: string;
    userId: string;
    workspaceId: string;
    skillId: string;
    status: string;
  };
  update: Record<string, unknown>;
};

function createSkill(id: string, status: "draft" | "active" | "archived" = "active") {
  const now = new Date("2026-05-01T12:00:00.000Z");
  return {
    id,
    workspaceId: "ws-1",
    createdByUserId: "admin-1",
    updatedByUserId: null,
    status,
    name: { en: id },
    description: { en: `${id} description` },
    category: "general",
    tags: [],
    instructionCard: { title: id, body: "Body", guardrails: [], examples: [] },
    iconEmoji: null,
    color: null,
    displayOrder: 100,
    archivedAt: status === "archived" ? now : null,
    createdAt: now,
    updatedAt: now,
    documents: []
  };
}

function createHarness() {
  const now = new Date("2026-05-01T12:00:00.000Z");
  const assistant = {
    id: "assistant-1",
    userId: "user-1",
    workspaceId: "ws-1",
    configDirtyAt: null as Date | null,
    governance: {
      assistantPlanOverrideCode: "pro",
      quotaPlanCode: null
    }
  };
  const skills = new Map<string, MockSkill>([
    ["skill-1", createSkill("skill-1")],
    ["skill-2", createSkill("skill-2")],
    ["skill-archived", createSkill("skill-archived", "archived")]
  ]);
  const assignments = new Map<string, MockAssignment>();
  let nextAssignment = 1;

  const assignmentApi = {
    findMany: async ({ where }: { where: { assistantId: string; userId: string } }) =>
      [...assignments.values()].filter(
        (assignment) =>
          assignment.assistantId === where.assistantId && assignment.userId === where.userId
      ),
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const assignment = assignments.get(where.id);
      const next = { ...assignment, ...data, updatedAt: now };
      assignments.set(where.id, next);
      return next;
    },
    upsert: async ({ where, create, update }: AssignmentUpsertArgs) => {
      const existing = [...assignments.values()].find(
        (assignment) =>
          assignment.assistantId === where.assistantId_skillId.assistantId &&
          assignment.skillId === where.assistantId_skillId.skillId
      );
      if (existing) {
        const next = { ...existing, ...update, updatedAt: now };
        assignments.set(existing.id, next);
        return next;
      }
      const created = {
        id: `assignment-${nextAssignment++}`,
        ...create,
        createdAt: now,
        updatedAt: now
      };
      assignments.set(created.id, created);
      return created;
    }
  };

  const prisma = {
    assistant: {
      findFirst: async ({ where }: { where: { userId: string } }) =>
        where.userId === assistant.userId ? assistant : null,
      update: async ({ data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(assistant, data);
        return assistant;
      }
    },
    skill: {
      findMany: async ({ where }: { where: SkillFindManyWhere }) => {
        const rows = [...skills.values()].filter(
          (skill) => skill.workspaceId === where.workspaceId
        );
        if (where.id?.in) {
          return rows
            .filter((skill) => where.id.in.includes(skill.id))
            .map((skill) => ({ id: skill.id, status: skill.status }));
        }
        return rows.filter(
          (skill) =>
            skill.status === "active" ||
            [...assignments.values()].some(
              (assignment) =>
                assignment.skillId === skill.id && assignment.assistantId === assistant.id
            )
        );
      }
    },
    assistantSkillAssignment: assignmentApi,
    planCatalogPlan: {
      findUnique: async () => ({
        billingProviderHints: {
          skillPolicy: {
            maxEnabledSkills: 1
          }
        },
        entitlement: {
          limitsPermissions: []
        }
      })
    },
    $transaction: async (
      callback: (tx: { assistantSkillAssignment: typeof assignmentApi }) => Promise<void>
    ) => callback({ assistantSkillAssignment: assignmentApi })
  };

  const service = new ManageAssistantSkillsService(
    prisma as never,
    {
      execute: async () => ({
        source: "assistant_plan_override",
        status: "unconfigured",
        planCode: "pro",
        trialEndsAt: null,
        currentPeriodEndsAt: null,
        cancelAtPeriodEnd: false
      })
    } as never
  );

  return { service, assignments, assistant };
}

async function run(): Promise<void> {
  const harness = createHarness();

  const initial = await harness.service.list("user-1");
  assert.equal(initial.limit, 1);
  assert.equal(initial.assignedSkillIds.length, 0);

  await assert.rejects(
    () => harness.service.replaceAssignments("user-1", ["skill-1", "skill-2"]),
    BadRequestException
  );
  await assert.rejects(
    () => harness.service.replaceAssignments("user-1", ["skill-archived"]),
    BadRequestException
  );

  const assigned = await harness.service.replaceAssignments("user-1", ["skill-1"]);
  assert.deepEqual(assigned.assignedSkillIds, ["skill-1"]);
  assert.equal(harness.assignments.size, 1);
  const skill2 = assigned.skills.find((item) => item.skill.id === "skill-2");
  assert.equal(skill2?.selectable, false);
  assert.equal(skill2?.disabledReason, "skill_limit_reached");

  const cleared = await harness.service.replaceAssignments("user-1", []);
  assert.deepEqual(cleared.assignedSkillIds, []);
  assert.equal([...harness.assignments.values()][0]?.status, "disabled");
  assert.ok(harness.assistant.configDirtyAt instanceof Date);
}

void run();
