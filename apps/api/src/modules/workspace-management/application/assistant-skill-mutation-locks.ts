import { Prisma } from "@prisma/client";

export const ASSISTANT_SKILL_MUTATION_LOCK_ORDER = [
  "Skill",
  "AssistantRole",
  "Assistant",
  "AssistantChat",
  "AssistantRoleSkill"
] as const;

export type LockedAssistantRoleRow = {
  id: string;
  key: string;
  status: "draft" | "active" | "archived";
};

export async function lockAssistantRoleRows(
  tx: Prisma.TransactionClient,
  roleIds: string[]
): Promise<LockedAssistantRoleRow[]> {
  const sortedIds = [...new Set(roleIds)].sort();
  if (sortedIds.length === 0) {
    return [];
  }
  return tx.$queryRaw<LockedAssistantRoleRow[]>(Prisma.sql`
    SELECT "id", "key", "status"
    FROM "assistant_roles"
    WHERE "id" IN (${Prisma.join(sortedIds.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY "id"
    FOR UPDATE
  `);
}

export async function lockAssistantRows(
  tx: Prisma.TransactionClient,
  assistantIds: string[]
): Promise<void> {
  const sortedIds = [...new Set(assistantIds)].sort();
  if (sortedIds.length === 0) {
    return;
  }
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "assistants"
    WHERE "id" IN (${Prisma.join(sortedIds.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY "id"
    FOR UPDATE
  `);
}

export async function lockAssistantChatRows(
  tx: Prisma.TransactionClient,
  assistantIds: string[]
): Promise<void> {
  const sortedIds = [...new Set(assistantIds)].sort();
  if (sortedIds.length === 0) {
    return;
  }
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "assistant_chats"
    WHERE "assistant_id" IN (${Prisma.join(sortedIds.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY "assistant_id", "id"
    FOR UPDATE
  `);
}

export async function lockSkillRow(tx: Prisma.TransactionClient, skillId: string): Promise<void> {
  await lockSkillRows(tx, [skillId]);
}

export async function lockSkillRows(
  tx: Prisma.TransactionClient,
  skillIds: string[]
): Promise<void> {
  const sortedIds = [...new Set(skillIds)].sort();
  if (sortedIds.length === 0) {
    return;
  }
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "skills"
    WHERE "id" IN (${Prisma.join(sortedIds.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY "id"
    FOR UPDATE
  `);
}

export async function lockRoleSkillRowsForSkill(
  tx: Prisma.TransactionClient,
  skillId: string
): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "role_id", "skill_id"
    FROM "assistant_role_skills"
    WHERE "skill_id" = ${skillId}::uuid
    ORDER BY "role_id", "skill_id"
    FOR UPDATE
  `);
}

export async function lockRoleSkillRow(
  tx: Prisma.TransactionClient,
  roleId: string,
  skillId: string
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ roleId: string; skillId: string }>>(Prisma.sql`
    SELECT "role_id" AS "roleId", "skill_id" AS "skillId"
    FROM "assistant_role_skills"
    WHERE "role_id" = ${roleId}::uuid
      AND "skill_id" = ${skillId}::uuid
    FOR UPDATE
  `);
  return rows.length === 1;
}
