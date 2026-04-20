import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { PlatformCoreModule } from "../platform-core/platform-core.module";
import { GetCurrentUserStateService } from "./application/get-current-user-state.service";
import { ResolveAppUserService } from "./application/resolve-app-user.service";
import { UpsertOnboardingService } from "./application/upsert-onboarding.service";
import { ClerkAuthService } from "./infrastructure/identity/clerk-auth.service";
import { PrismaService } from "./infrastructure/persistence/prisma.service";
import { ClerkAuthMiddleware } from "./interface/http/clerk-auth.middleware";
import { AuthVerifyController } from "./interface/http/auth-verify.controller";
import { MeController } from "./interface/http/me.controller";

@Module({
  imports: [PlatformCoreModule],
  controllers: [AuthVerifyController, MeController],
  providers: [
    ClerkAuthService,
    ResolveAppUserService,
    GetCurrentUserStateService,
    UpsertOnboardingService,
    PrismaService,
    ClerkAuthMiddleware
  ],
  exports: [PrismaService]
})
export class IdentityAccessModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ClerkAuthMiddleware).forRoutes(
      { path: "api/v1/auth/*", method: RequestMethod.ALL },
      { path: "api/v1/me", method: RequestMethod.GET },
      { path: "api/v1/me/onboarding", method: RequestMethod.POST },
      { path: "api/v1/assistant", method: RequestMethod.GET },
      { path: "api/v1/assistant/persona-archetypes", method: RequestMethod.GET },
      { path: "api/v1/assistant/plan-visibility", method: RequestMethod.GET },
      { path: "api/v1/assistant/voice/settings", method: RequestMethod.GET },
      { path: "api/v1/assistant/notification-preference", method: RequestMethod.GET },
      { path: "api/v1/assistant", method: RequestMethod.POST },
      { path: "api/v1/assistant/draft", method: RequestMethod.PATCH },
      { path: "api/v1/assistant/setup/preview", method: RequestMethod.POST },
      { path: "api/v1/assistant/notification-preference", method: RequestMethod.PATCH },
      { path: "api/v1/assistant/avatar", method: RequestMethod.POST },
      { path: "api/v1/assistant/avatar", method: RequestMethod.GET },
      { path: "api/v1/assistant/publish", method: RequestMethod.POST },
      { path: "api/v1/assistant/rollback", method: RequestMethod.POST },
      { path: "api/v1/assistant/reset", method: RequestMethod.POST },
      { path: "api/v1/assistant/reapply", method: RequestMethod.POST },
      { path: "api/v1/assistant/runtime/preflight", method: RequestMethod.GET },
      { path: "api/v1/assistant/chat/web", method: RequestMethod.POST },
      { path: "api/v1/assistant/chat/web/stream", method: RequestMethod.POST },
      { path: "api/v1/assistant/chat/web/stage-attachment", method: RequestMethod.POST },
      { path: "api/v1/assistant/knowledge-sources", method: RequestMethod.POST },
      { path: "api/v1/assistant/knowledge-sources", method: RequestMethod.GET },
      { path: "api/v1/assistant/knowledge-sources/:sourceId", method: RequestMethod.GET },
      { path: "api/v1/assistant/knowledge-sources/:sourceId", method: RequestMethod.DELETE },
      {
        path: "api/v1/assistant/knowledge-sources/:sourceId/reindex",
        method: RequestMethod.POST
      },
      { path: "api/v1/assistant/chats/web", method: RequestMethod.GET },
      { path: "api/v1/assistant/chats/web/:chatId/messages", method: RequestMethod.GET },
      { path: "api/v1/assistant/chats/web/:chatId/compaction", method: RequestMethod.GET },
      { path: "api/v1/assistant/chats/web/:chatId/compact", method: RequestMethod.POST },
      { path: "api/v1/assistant/chats/web/:chatId", method: RequestMethod.PATCH },
      { path: "api/v1/assistant/chats/web/:chatId/archive", method: RequestMethod.POST },
      { path: "api/v1/assistant/chats/web/:chatId", method: RequestMethod.DELETE },
      { path: "api/v1/assistant/memory/items", method: RequestMethod.GET },
      { path: "api/v1/assistant/memory/items/:itemId/forget", method: RequestMethod.POST },
      { path: "api/v1/assistant/memory/do-not-remember", method: RequestMethod.POST },
      { path: "api/v1/assistant/memory/workspace/items", method: RequestMethod.GET },
      { path: "api/v1/assistant/memory/workspace/add", method: RequestMethod.POST },
      { path: "api/v1/assistant/memory/workspace/edit", method: RequestMethod.PATCH },
      { path: "api/v1/assistant/memory/workspace/forget", method: RequestMethod.POST },
      { path: "api/v1/assistant/memory/workspace/search", method: RequestMethod.GET },
      { path: "api/v1/assistant/tasks/items", method: RequestMethod.GET },
      { path: "api/v1/assistant/tasks/items/:itemId/disable", method: RequestMethod.POST },
      { path: "api/v1/assistant/tasks/items/:itemId/enable", method: RequestMethod.POST },
      { path: "api/v1/assistant/tasks/items/:itemId/cancel", method: RequestMethod.POST },
      { path: "api/v1/assistant/integrations/telegram", method: RequestMethod.GET },
      { path: "api/v1/assistant/integrations/telegram/connect", method: RequestMethod.POST },
      { path: "api/v1/assistant/integrations/telegram/rotate", method: RequestMethod.POST },
      { path: "api/v1/assistant/integrations/telegram/revoke", method: RequestMethod.POST },
      {
        path: "api/v1/assistant/integrations/telegram/emergency-revoke",
        method: RequestMethod.POST
      },
      {
        path: "api/v1/assistant/integrations/telegram/resend-owner-message",
        method: RequestMethod.POST
      },
      { path: "api/v1/assistant/integrations/telegram/config", method: RequestMethod.PATCH },
      { path: "api/v1/assistant/integrations/telegram/groups", method: RequestMethod.GET },
      { path: "api/v1/admin/abuse-controls/unblock", method: RequestMethod.POST },
      { path: "api/v1/admin/assistants/ownership/transfer", method: RequestMethod.POST },
      { path: "api/v1/admin/assistants/ownership/recover", method: RequestMethod.POST },
      { path: "api/v1/admin/plans", method: RequestMethod.GET },
      { path: "api/v1/admin/plans/visibility", method: RequestMethod.GET },
      { path: "api/v1/admin/ops/cockpit", method: RequestMethod.GET },
      { path: "api/v1/admin/ops/users", method: RequestMethod.GET },
      { path: "api/v1/admin/ops/users/:userId/reapply", method: RequestMethod.POST },
      { path: "api/v1/admin/ops/users/:userId/plan-override", method: RequestMethod.POST },
      { path: "api/v1/admin/ops/users/:userId/plan-override", method: RequestMethod.DELETE },
      { path: "api/v1/admin/ops/users/:userId/workspace-subscription", method: RequestMethod.POST },
      {
        path: "api/v1/admin/ops/users/:userId/workspace-subscription",
        method: RequestMethod.DELETE
      },
      { path: "api/v1/admin/ops/users/:userId", method: RequestMethod.DELETE },
      { path: "api/v1/admin/business/cockpit", method: RequestMethod.GET },
      { path: "api/v1/admin/business/platform", method: RequestMethod.GET },
      { path: "api/v1/admin/overview/dashboard", method: RequestMethod.GET },
      { path: "api/v1/admin/overview/latency-trace", method: RequestMethod.POST },
      { path: "api/v1/admin/notifications/channels", method: RequestMethod.GET },
      { path: "api/v1/admin/notifications/channels/webhook", method: RequestMethod.PATCH },
      { path: "api/v1/admin/runtime/provider-settings", method: RequestMethod.GET },
      { path: "api/v1/admin/runtime/provider-settings", method: RequestMethod.PUT },
      { path: "api/v1/admin/platform-rollouts", method: RequestMethod.GET },
      { path: "api/v1/admin/platform-rollouts", method: RequestMethod.POST },
      { path: "api/v1/admin/platform-rollouts/:rolloutId/rollback", method: RequestMethod.POST },
      { path: "api/v1/admin/step-up/challenge", method: RequestMethod.POST },
      { path: "api/v1/admin/plans", method: RequestMethod.POST },
      { path: "api/v1/admin/plans/:code", method: RequestMethod.PATCH },
      { path: "api/v1/admin/plans/:code", method: RequestMethod.DELETE },
      { path: "api/v1/admin/runtime/tool-credentials", method: RequestMethod.GET },
      { path: "api/v1/admin/runtime/tool-credentials", method: RequestMethod.PUT },
      { path: "api/v1/admin/tools/metadata", method: RequestMethod.GET },
      { path: "api/v1/admin/tools/metadata/:toolCode", method: RequestMethod.PATCH },
      { path: "api/v1/admin/prompt-templates", method: RequestMethod.GET },
      { path: "api/v1/admin/prompt-templates/:id", method: RequestMethod.PATCH },
      { path: "api/v1/admin/persona-archetypes", method: RequestMethod.GET },
      { path: "api/v1/admin/persona-archetypes/:key", method: RequestMethod.PATCH },
      {
        path: "api/v1/admin/persona-archetypes/:key/reset-to-default",
        method: RequestMethod.POST
      },
      { path: "api/v1/admin/knowledge-sources", method: RequestMethod.GET },
      { path: "api/v1/admin/knowledge-sources/observability", method: RequestMethod.GET },
      { path: "api/v1/admin/knowledge-sources/connectors", method: RequestMethod.GET },
      { path: "api/v1/admin/knowledge-sources/:scope", method: RequestMethod.POST },
      { path: "api/v1/admin/knowledge-sources/:sourceId", method: RequestMethod.DELETE },
      { path: "api/v1/admin/knowledge-sources/:sourceId/reindex", method: RequestMethod.POST },
      { path: "api/v1/admin/runtime/force-reapply-all", method: RequestMethod.POST },
      {
        path: "api/v1/assistant/chat/:chatId/message/:messageId/attachment",
        method: RequestMethod.POST
      },
      { path: "api/v1/assistant/attachment/:attachmentId", method: RequestMethod.GET },
      { path: "api/v1/assistant/voice/transcribe", method: RequestMethod.POST }
    );
  }
}
