import { Module } from "@nestjs/common";
import { AssistantController } from "./interface/http/assistant.controller";
import { AdminPlansController } from "./interface/http/admin-plans.controller";
import { ResolveEffectiveSubscriptionStateService } from "./application/resolve-effective-subscription-state.service";
import { ResolveEffectiveCapabilityStateService } from "./application/resolve-effective-capability-state.service";
import { ApplyAssistantPublishedVersionService } from "./application/apply-assistant-published-version.service";
import { AssistantRuntimePreflightService } from "./application/assistant-runtime-preflight.service";
import { CreateAssistantService } from "./application/create-assistant.service";
import { DoNotRememberAssistantMemoryService } from "./application/do-not-remember-assistant-memory.service";
import { ForgetAssistantMemoryItemService } from "./application/forget-assistant-memory-item.service";
import { ListAssistantMemoryItemsService } from "./application/list-assistant-memory-items.service";
import { ListAssistantTaskItemsService } from "./application/list-assistant-task-items.service";
import { DisableAssistantTaskRegistryItemService } from "./application/disable-assistant-task-registry-item.service";
import { EnableAssistantTaskRegistryItemService } from "./application/enable-assistant-task-registry-item.service";
import { CancelAssistantTaskRegistryItemService } from "./application/cancel-assistant-task-registry-item.service";
import { GetAssistantByUserIdService } from "./application/get-assistant-by-user-id.service";
import { MaterializeAssistantPublishedVersionService } from "./application/materialize-assistant-published-version.service";
import { ManageAdminPlansService } from "./application/manage-admin-plans.service";
import { ManageWebChatListService } from "./application/manage-web-chat-list.service";
import { PublishAssistantDraftService } from "./application/publish-assistant-draft.service";
import { RecordWebChatMemoryTurnService } from "./application/record-web-chat-memory-turn.service";
import { ReapplyAssistantService } from "./application/reapply-assistant.service";
import { ResetAssistantService } from "./application/reset-assistant.service";
import { RollbackAssistantService } from "./application/rollback-assistant.service";
import { SendWebChatTurnService } from "./application/send-web-chat-turn.service";
import { StreamWebChatTurnService } from "./application/stream-web-chat-turn.service";
import { UpdateAssistantDraftService } from "./application/update-assistant-draft.service";
import { ASSISTANT_CHAT_REPOSITORY } from "./domain/assistant-chat.repository";
import { ASSISTANT_PLAN_CATALOG_REPOSITORY } from "./domain/assistant-plan-catalog.repository";
import { WORKSPACE_SUBSCRIPTION_REPOSITORY } from "./domain/workspace-subscription.repository";
import { ASSISTANT_MEMORY_REGISTRY_REPOSITORY } from "./domain/assistant-memory-registry.repository";
import { ASSISTANT_TASK_REGISTRY_REPOSITORY } from "./domain/assistant-task-registry.repository";
import { ASSISTANT_GOVERNANCE_REPOSITORY } from "./domain/assistant-governance.repository";
import { ASSISTANT_MATERIALIZED_SPEC_REPOSITORY } from "./domain/assistant-materialized-spec.repository";
import { ASSISTANT_PUBLISHED_VERSION_REPOSITORY } from "./domain/assistant-published-version.repository";
import { ASSISTANT_RUNTIME_ADAPTER } from "./application/assistant-runtime-adapter.types";
import { ASSISTANT_REPOSITORY } from "./domain/assistant.repository";
import { OpenClawRuntimeAdapter } from "./infrastructure/openclaw/openclaw-runtime.adapter";
import { NullBillingProviderAdapter } from "./infrastructure/billing/null-billing-provider.adapter";
import { PrismaAssistantGovernanceRepository } from "./infrastructure/persistence/prisma-assistant-governance.repository";
import { PrismaAssistantPlanCatalogRepository } from "./infrastructure/persistence/prisma-assistant-plan-catalog.repository";
import { PrismaWorkspaceSubscriptionRepository } from "./infrastructure/persistence/prisma-workspace-subscription.repository";
import { BILLING_PROVIDER_PORT } from "./application/billing-provider.port";
import { PrismaAssistantChatRepository } from "./infrastructure/persistence/prisma-assistant-chat.repository";
import { PrismaAssistantMemoryRegistryRepository } from "./infrastructure/persistence/prisma-assistant-memory-registry.repository";
import { PrismaAssistantTaskRegistryRepository } from "./infrastructure/persistence/prisma-assistant-task-registry.repository";
import { PrismaAssistantMaterializedSpecRepository } from "./infrastructure/persistence/prisma-assistant-materialized-spec.repository";
import { PrismaAssistantPublishedVersionRepository } from "./infrastructure/persistence/prisma-assistant-published-version.repository";
import { PrismaAssistantRepository } from "./infrastructure/persistence/prisma-assistant.repository";
import { WorkspaceManagementPrismaService } from "./infrastructure/persistence/workspace-management-prisma.service";

@Module({
  controllers: [AssistantController, AdminPlansController],
  providers: [
    WorkspaceManagementPrismaService,
    GetAssistantByUserIdService,
    ApplyAssistantPublishedVersionService,
    AssistantRuntimePreflightService,
    MaterializeAssistantPublishedVersionService,
    ManageAdminPlansService,
    ResolveEffectiveSubscriptionStateService,
    ResolveEffectiveCapabilityStateService,
    ManageWebChatListService,
    CreateAssistantService,
    PublishAssistantDraftService,
    ReapplyAssistantService,
    RollbackAssistantService,
    ResetAssistantService,
    RecordWebChatMemoryTurnService,
    ListAssistantMemoryItemsService,
    ForgetAssistantMemoryItemService,
    DoNotRememberAssistantMemoryService,
    ListAssistantTaskItemsService,
    DisableAssistantTaskRegistryItemService,
    EnableAssistantTaskRegistryItemService,
    CancelAssistantTaskRegistryItemService,
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
      provide: ASSISTANT_PLAN_CATALOG_REPOSITORY,
      useClass: PrismaAssistantPlanCatalogRepository
    },
    {
      provide: WORKSPACE_SUBSCRIPTION_REPOSITORY,
      useClass: PrismaWorkspaceSubscriptionRepository
    },
    {
      provide: BILLING_PROVIDER_PORT,
      useClass: NullBillingProviderAdapter
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
      provide: ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
      useClass: PrismaAssistantMemoryRegistryRepository
    },
    {
      provide: ASSISTANT_TASK_REGISTRY_REPOSITORY,
      useClass: PrismaAssistantTaskRegistryRepository
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
