import { Module } from "@nestjs/common";
import { AssistantController } from "./interface/http/assistant.controller";
import { CreateAssistantService } from "./application/create-assistant.service";
import { GetAssistantByUserIdService } from "./application/get-assistant-by-user-id.service";
import { PublishAssistantDraftService } from "./application/publish-assistant-draft.service";
import { UpdateAssistantDraftService } from "./application/update-assistant-draft.service";
import { ASSISTANT_PUBLISHED_VERSION_REPOSITORY } from "./domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY } from "./domain/assistant.repository";
import { PrismaAssistantPublishedVersionRepository } from "./infrastructure/persistence/prisma-assistant-published-version.repository";
import { PrismaAssistantRepository } from "./infrastructure/persistence/prisma-assistant.repository";
import { WorkspaceManagementPrismaService } from "./infrastructure/persistence/workspace-management-prisma.service";

@Module({
  controllers: [AssistantController],
  providers: [
    WorkspaceManagementPrismaService,
    GetAssistantByUserIdService,
    CreateAssistantService,
    PublishAssistantDraftService,
    UpdateAssistantDraftService,
    {
      provide: ASSISTANT_REPOSITORY,
      useClass: PrismaAssistantRepository
    },
    {
      provide: ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
      useClass: PrismaAssistantPublishedVersionRepository
    }
  ],
  exports: [
    GetAssistantByUserIdService,
    CreateAssistantService,
    PublishAssistantDraftService,
    UpdateAssistantDraftService,
    ASSISTANT_REPOSITORY,
    ASSISTANT_PUBLISHED_VERSION_REPOSITORY
  ]
})
export class WorkspaceManagementModule {}
