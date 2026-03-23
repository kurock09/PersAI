import { Module } from "@nestjs/common";
import { AssistantController } from "./interface/http/assistant.controller";
import { CreateAssistantService } from "./application/create-assistant.service";
import { GetAssistantByUserIdService } from "./application/get-assistant-by-user-id.service";
import { UpdateAssistantDraftService } from "./application/update-assistant-draft.service";
import { ASSISTANT_REPOSITORY } from "./domain/assistant.repository";
import { PrismaAssistantRepository } from "./infrastructure/persistence/prisma-assistant.repository";
import { WorkspaceManagementPrismaService } from "./infrastructure/persistence/workspace-management-prisma.service";

@Module({
  controllers: [AssistantController],
  providers: [
    WorkspaceManagementPrismaService,
    GetAssistantByUserIdService,
    CreateAssistantService,
    UpdateAssistantDraftService,
    {
      provide: ASSISTANT_REPOSITORY,
      useClass: PrismaAssistantRepository
    }
  ],
  exports: [
    GetAssistantByUserIdService,
    CreateAssistantService,
    UpdateAssistantDraftService,
    ASSISTANT_REPOSITORY
  ]
})
export class WorkspaceManagementModule {}
