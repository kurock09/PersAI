import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { PlatformCoreModule } from "../platform-core/platform-core.module";
import { GetCurrentUserStateService } from "./application/get-current-user-state.service";
import { ResolveAppUserService } from "./application/resolve-app-user.service";
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
        { path: "api/v1/me", method: RequestMethod.GET }
      );
  }
}
