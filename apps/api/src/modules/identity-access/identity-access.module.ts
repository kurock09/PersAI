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
  ]
})
export class IdentityAccessModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ClerkAuthMiddleware)
      .forRoutes(
        { path: "api/v1/auth/*", method: RequestMethod.ALL },
        { path: "api/v1/me", method: RequestMethod.GET },
        { path: "api/v1/me/onboarding", method: RequestMethod.POST },
        { path: "api/v1/assistant", method: RequestMethod.GET },
        { path: "api/v1/assistant", method: RequestMethod.POST },
        { path: "api/v1/assistant/draft", method: RequestMethod.PATCH },
        { path: "api/v1/assistant/publish", method: RequestMethod.POST },
        { path: "api/v1/assistant/rollback", method: RequestMethod.POST },
        { path: "api/v1/assistant/reset", method: RequestMethod.POST },
        { path: "api/v1/assistant/reapply", method: RequestMethod.POST },
        { path: "api/v1/assistant/runtime/preflight", method: RequestMethod.GET },
        { path: "api/v1/assistant/chat/web", method: RequestMethod.POST },
        { path: "api/v1/assistant/chat/web/stream", method: RequestMethod.POST },
        { path: "api/v1/assistant/chats/web", method: RequestMethod.GET },
        { path: "api/v1/assistant/chats/web/:chatId", method: RequestMethod.PATCH },
        { path: "api/v1/assistant/chats/web/:chatId/archive", method: RequestMethod.POST },
        { path: "api/v1/assistant/chats/web/:chatId", method: RequestMethod.DELETE },
        { path: "api/v1/assistant/memory/items", method: RequestMethod.GET },
        { path: "api/v1/assistant/memory/items/:itemId/forget", method: RequestMethod.POST },
        { path: "api/v1/assistant/memory/do-not-remember", method: RequestMethod.POST },
        { path: "api/v1/assistant/tasks/items", method: RequestMethod.GET },
        { path: "api/v1/assistant/tasks/items/:itemId/disable", method: RequestMethod.POST },
        { path: "api/v1/assistant/tasks/items/:itemId/enable", method: RequestMethod.POST },
        { path: "api/v1/assistant/tasks/items/:itemId/cancel", method: RequestMethod.POST },
        { path: "api/v1/admin/plans", method: RequestMethod.GET },
        { path: "api/v1/admin/plans", method: RequestMethod.POST },
        { path: "api/v1/admin/plans/:code", method: RequestMethod.PATCH }
      );
  }
}
