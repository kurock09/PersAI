import { Module } from "@nestjs/common";
import { GetAssistantByUserIdService } from "./application/get-assistant-by-user-id.service";
import { ASSISTANT_REPOSITORY } from "./domain/assistant.repository";
import { PrismaAssistantRepository } from "./infrastructure/persistence/prisma-assistant.repository";
import { WorkspaceManagementPrismaService } from "./infrastructure/persistence/workspace-management-prisma.service";

@Module({
  providers: [
    WorkspaceManagementPrismaService,
    GetAssistantByUserIdService,
    {
      provide: ASSISTANT_REPOSITORY,
      useClass: PrismaAssistantRepository
    }
  ],
  exports: [GetAssistantByUserIdService, ASSISTANT_REPOSITORY]
})
export class WorkspaceManagementModule {}
