import { Module } from "@nestjs/common";
import { AssistantController } from "./interface/http/assistant.controller";
import { ApplyAssistantPublishedVersionService } from "./application/apply-assistant-published-version.service";
import { AssistantRuntimePreflightService } from "./application/assistant-runtime-preflight.service";
import { CreateAssistantService } from "./application/create-assistant.service";
import { GetAssistantByUserIdService } from "./application/get-assistant-by-user-id.service";
import { MaterializeAssistantPublishedVersionService } from "./application/materialize-assistant-published-version.service";
import { ManageWebChatListService } from "./application/manage-web-chat-list.service";
import { PublishAssistantDraftService } from "./application/publish-assistant-draft.service";
import { ReapplyAssistantService } from "./application/reapply-assistant.service";
import { ResetAssistantService } from "./application/reset-assistant.service";
import { RollbackAssistantService } from "./application/rollback-assistant.service";
import { SendWebChatTurnService } from "./application/send-web-chat-turn.service";
import { StreamWebChatTurnService } from "./application/stream-web-chat-turn.service";
import { UpdateAssistantDraftService } from "./application/update-assistant-draft.service";
import { ASSISTANT_CHAT_REPOSITORY } from "./domain/assistant-chat.repository";
import { ASSISTANT_GOVERNANCE_REPOSITORY } from "./domain/assistant-governance.repository";
import { ASSISTANT_MATERIALIZED_SPEC_REPOSITORY } from "./domain/assistant-materialized-spec.repository";
import { ASSISTANT_PUBLISHED_VERSION_REPOSITORY } from "./domain/assistant-published-version.repository";
import { ASSISTANT_RUNTIME_ADAPTER } from "./application/assistant-runtime-adapter.types";
import { ASSISTANT_REPOSITORY } from "./domain/assistant.repository";
import { OpenClawRuntimeAdapter } from "./infrastructure/openclaw/openclaw-runtime.adapter";
import { PrismaAssistantGovernanceRepository } from "./infrastructure/persistence/prisma-assistant-governance.repository";
import { PrismaAssistantChatRepository } from "./infrastructure/persistence/prisma-assistant-chat.repository";
import { PrismaAssistantMaterializedSpecRepository } from "./infrastructure/persistence/prisma-assistant-materialized-spec.repository";
import { PrismaAssistantPublishedVersionRepository } from "./infrastructure/persistence/prisma-assistant-published-version.repository";
import { PrismaAssistantRepository } from "./infrastructure/persistence/prisma-assistant.repository";
import { WorkspaceManagementPrismaService } from "./infrastructure/persistence/workspace-management-prisma.service";

@Module({
  controllers: [AssistantController],
  providers: [
    WorkspaceManagementPrismaService,
    GetAssistantByUserIdService,
    ApplyAssistantPublishedVersionService,
    AssistantRuntimePreflightService,
    MaterializeAssistantPublishedVersionService,
    ManageWebChatListService,
    CreateAssistantService,
    PublishAssistantDraftService,
    ReapplyAssistantService,
    RollbackAssistantService,
    ResetAssistantService,
    SendWebChatTurnService,
    StreamWebChatTurnService,
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
    },
    {
      provide: ASSISTANT_CHAT_REPOSITORY,
      useClass: PrismaAssistantChatRepository
    },
    {
      provide: ASSISTANT_RUNTIME_ADAPTER,
      useClass: OpenClawRuntimeAdapter
    },
    {
      provide: ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
      useClass: PrismaAssistantMaterializedSpecRepository
    }
  ],
  exports: [
    GetAssistantByUserIdService,
    ApplyAssistantPublishedVersionService,
    AssistantRuntimePreflightService,
    CreateAssistantService,
    PublishAssistantDraftService,
    ReapplyAssistantService,
    RollbackAssistantService,
    ResetAssistantService,
    SendWebChatTurnService,
    StreamWebChatTurnService,
    UpdateAssistantDraftService,
    ASSISTANT_REPOSITORY,
    ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
    ASSISTANT_GOVERNANCE_REPOSITORY,
    ASSISTANT_CHAT_REPOSITORY,
    ASSISTANT_MATERIALIZED_SPEC_REPOSITORY
  ]
})
export class WorkspaceManagementModule {}
