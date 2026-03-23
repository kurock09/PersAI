import { Module } from "@nestjs/common";
import { AssistantController } from "./interface/http/assistant.controller";
import { CreateAssistantService } from "./application/create-assistant.service";
import { GetAssistantByUserIdService } from "./application/get-assistant-by-user-id.service";
import { PublishAssistantDraftService } from "./application/publish-assistant-draft.service";
import { ResetAssistantService } from "./application/reset-assistant.service";
import { RollbackAssistantService } from "./application/rollback-assistant.service";
import { UpdateAssistantDraftService } from "./application/update-assistant-draft.service";
import { ASSISTANT_GOVERNANCE_REPOSITORY } from "./domain/assistant-governance.repository";
import { ASSISTANT_PUBLISHED_VERSION_REPOSITORY } from "./domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY } from "./domain/assistant.repository";
import { PrismaAssistantGovernanceRepository } from "./infrastructure/persistence/prisma-assistant-governance.repository";
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
    RollbackAssistantService,
    ResetAssistantService,
    UpdateAssistantDraftService,
    {
      provide: ASSISTANT_REPOSITORY,
      useClass: PrismaAssistantRepository
    },
    {
      provide: ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
      useClass: PrismaAssistantPublishedVersionRepository
    },
    {
      provide: ASSISTANT_GOVERNANCE_REPOSITORY,
      useClass: PrismaAssistantGovernanceRepository
    }
  ],
  exports: [
    GetAssistantByUserIdService,
    CreateAssistantService,
    PublishAssistantDraftService,
    RollbackAssistantService,
    ResetAssistantService,
    UpdateAssistantDraftService,
    ASSISTANT_REPOSITORY,
    ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
    ASSISTANT_GOVERNANCE_REPOSITORY
  ]
})
export class WorkspaceManagementModule {}
