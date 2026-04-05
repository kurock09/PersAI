import assert from "node:assert/strict";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaService } from "../src/modules/identity-access/infrastructure/persistence/prisma.service";
import { WorkspaceManagementPrismaService } from "../src/modules/workspace-management/infrastructure/persistence/workspace-management-prisma.service";

@Module({
  providers: [
    PrismaService,
    {
      provide: WorkspaceManagementPrismaService,
      useExisting: PrismaService
    }
  ],
  exports: [PrismaService, WorkspaceManagementPrismaService]
})
class PrismaSharingTestModule {}

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(PrismaSharingTestModule, {
    logger: false
  });

  try {
    const identityPrisma = app.get(PrismaService);
    const workspacePrisma = app.get(WorkspaceManagementPrismaService);

    assert.equal(identityPrisma, workspacePrisma);
  } finally {
    await app.close();
  }
}

void run();
