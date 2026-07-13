import assert from "node:assert/strict";
import { ManageAssistantSkillsService } from "../src/modules/workspace-management/application/manage-assistant-skills.service";

type AssistantStub = {
  id: string;
  userId: string;
  workspaceId: string;
  roleId: string;
};

type SkillRow = {
  id: string;
  status: "active";
  key: string;
  label: { en: string };
  summary: null;
  description: { en: string };
  category: string | null;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
  documents: [];
};

type AssignmentRow = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  skillId: string;
  status: "active" | "disabled";
  disabledReason: "user_disabled" | null;
  enabledAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

async function run(): Promise<void> {
  const assistantA: AssistantStub = {
    id: "assistant-a",
    userId: "user-1",
    workspaceId: "ws-1",
    roleId: "role-a"
  };
  const assistantB: AssistantStub = {
    id: "assistant-b",
    userId: "user-1",
    workspaceId: "ws-1",
    roleId: "role-b"
  };
  let activeAssistant = assistantA;

  const skills: SkillRow[] = [
    {
      id: "skill-1",
      status: "active",
      key: "skill-one",
      label: { en: "Skill One" },
      summary: null,
      description: { en: "Skill one description" },
      category: null,
      displayOrder: 1,
      createdAt: new Date("2026-05-26T15:00:00.000Z"),
      updatedAt: new Date("2026-05-26T15:00:00.000Z"),
      documents: []
    },
    {
      id: "skill-2",
      status: "active",
      key: "skill-two",
      label: { en: "Skill Two" },
      summary: null,
      description: { en: "Skill two description" },
      category: null,
      displayOrder: 2,
      createdAt: new Date("2026-05-26T15:01:00.000Z"),
      updatedAt: new Date("2026-05-26T15:01:00.000Z"),
      documents: []
    }
  ];
  const assignments: AssignmentRow[] = [
    {
      id: "assignment-a-1",
      assistantId: assistantA.id,
      userId: "user-1",
      workspaceId: "ws-1",
      skillId: "skill-1",
      status: "active",
      disabledReason: null,
      enabledAt: new Date("2026-05-26T15:00:00.000Z"),
      disabledAt: null,
      createdAt: new Date("2026-05-26T15:00:00.000Z"),
      updatedAt: new Date("2026-05-26T15:00:00.000Z")
    },
    {
      id: "assignment-b-1",
      assistantId: assistantB.id,
      userId: "user-1",
      workspaceId: "ws-1",
      skillId: "skill-2",
      status: "active",
      disabledReason: null,
      enabledAt: new Date("2026-05-26T15:01:00.000Z"),
      disabledAt: null,
      createdAt: new Date("2026-05-26T15:01:00.000Z"),
      updatedAt: new Date("2026-05-26T15:01:00.000Z")
    }
  ];

  const prisma = {
    assistant: {
      async findUnique({ where }: { where: { id: string } }) {
        if (where.id === assistantA.id) {
          return { ...assistantA, governance: null };
        }
        if (where.id === assistantB.id) {
          return { ...assistantB, governance: null };
        }
        return null;
      },
      async update() {
        return activeAssistant;
      }
    },
    skill: {
      async findMany({ where }: { where?: { id?: { in: string[] } } }) {
        if (where?.id?.in !== undefined) {
          return skills
            .filter((skill) => where.id?.in.includes(skill.id))
            .map((skill) => ({ id: skill.id, status: skill.status }));
        }
        return skills;
      }
    },
    assistantSkillAssignment: {
      async findMany({ where }: { where: { assistantId: string } }) {
        return assignments.filter((assignment) => assignment.assistantId === where.assistantId);
      },
      async update({ where, data }: { where: { id: string }; data: Partial<AssignmentRow> }) {
        const assignment = assignments.find((row) => row.id === where.id);
        if (assignment === undefined) {
          throw new Error("assignment not found");
        }
        Object.assign(assignment, data, { updatedAt: new Date("2026-05-26T15:10:00.000Z") });
        return assignment;
      },
      async upsert({
        where,
        create,
        update
      }: {
        where: { assistantId_skillId: { assistantId: string; skillId: string } };
        create: Omit<AssignmentRow, "id" | "createdAt" | "updatedAt">;
        update: Partial<AssignmentRow>;
      }) {
        const existing = assignments.find(
          (row) =>
            row.assistantId === where.assistantId_skillId.assistantId &&
            row.skillId === where.assistantId_skillId.skillId
        );
        if (existing !== undefined) {
          Object.assign(existing, update, { updatedAt: new Date("2026-05-26T15:10:00.000Z") });
          return existing;
        }
        const created: AssignmentRow = {
          id: `assignment-${assignments.length + 1}`,
          ...create,
          createdAt: new Date("2026-05-26T15:10:00.000Z"),
          updatedAt: new Date("2026-05-26T15:10:00.000Z")
        };
        assignments.push(created);
        return created;
      }
    },
    assistantChat: {
      async updateMany() {
        return { count: 0 };
      }
    },
    async $transaction<T>(callback: (tx: Record<string, unknown>) => Promise<T>): Promise<T> {
      return callback({
        assistantSkillAssignment: prisma.assistantSkillAssignment,
        assistantChat: prisma.assistantChat
      } as Record<string, unknown>);
    }
  };

  const service = new ManageAssistantSkillsService(
    prisma as never,
    {
      async execute() {
        return { planCode: null };
      }
    } as never,
    {
      async execute({ userId }: { userId: string }) {
        assert.equal(userId, "user-1");
        return { assistantId: activeAssistant.id, assistant: activeAssistant };
      }
    } as never
  );

  activeAssistant = assistantA;
  const listForA = await service.list("user-1");
  assert.deepEqual(listForA.assignedSkillIds, ["skill-1"]);

  await service.replaceAssignments("user-1", ["skill-2"]);
  const refreshedA = await service.list("user-1");
  assert.deepEqual(refreshedA.assignedSkillIds, ["skill-2"]);

  activeAssistant = assistantB;
  const listForB = await service.list("user-1");
  assert.deepEqual(listForB.assignedSkillIds, ["skill-2"]);

  const assistantBAssignment = assignments.find(
    (assignment) => assignment.assistantId === assistantB.id && assignment.skillId === "skill-2"
  );
  assert.equal(assistantBAssignment?.status, "active");
  assert.equal(
    assignments.some(
      (assignment) =>
        assignment.assistantId === assistantB.id &&
        assignment.skillId === "skill-1" &&
        assignment.status === "active"
    ),
    false
  );
}

void run();
