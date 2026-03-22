import { PrismaClient, WorkspaceRole, WorkspaceStatus } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_USER_ID = "11111111-1111-1111-1111-111111111111";
const SEED_WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const SEED_WORKSPACE_MEMBER_ID = "33333333-3333-3333-3333-333333333333";

async function main(): Promise<void> {
  await prisma.appUser.upsert({
    where: { id: SEED_USER_ID },
    update: {
      email: "seed-owner@example.com",
      displayName: "Seed Owner",
      clerkUserId: "seed-clerk-owner"
    },
    create: {
      id: SEED_USER_ID,
      email: "seed-owner@example.com",
      displayName: "Seed Owner",
      clerkUserId: "seed-clerk-owner"
    }
  });

  await prisma.workspace.upsert({
    where: { id: SEED_WORKSPACE_ID },
    update: {
      name: "Seed Workspace",
      locale: "en-US",
      timezone: "UTC",
      status: WorkspaceStatus.active
    },
    create: {
      id: SEED_WORKSPACE_ID,
      name: "Seed Workspace",
      locale: "en-US",
      timezone: "UTC",
      status: WorkspaceStatus.active
    }
  });

  await prisma.workspaceMember.upsert({
    where: { id: SEED_WORKSPACE_MEMBER_ID },
    update: {
      workspaceId: SEED_WORKSPACE_ID,
      userId: SEED_USER_ID,
      role: WorkspaceRole.owner
    },
    create: {
      id: SEED_WORKSPACE_MEMBER_ID,
      workspaceId: SEED_WORKSPACE_ID,
      userId: SEED_USER_ID,
      role: WorkspaceRole.owner
    }
  });
}

main()
  .catch(async (error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
