import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { PlatformCoreModule } from "../platform-core/platform-core.module";
import { ResolveAppUserService } from "./application/resolve-app-user.service";
import { ClerkAuthService } from "./infrastructure/identity/clerk-auth.service";
import { PrismaService } from "./infrastructure/persistence/prisma.service";
import { ClerkAuthMiddleware } from "./interface/http/clerk-auth.middleware";
import { AuthVerifyController } from "./interface/http/auth-verify.controller";

@Module({
  imports: [PlatformCoreModule],
  controllers: [AuthVerifyController],
  providers: [ClerkAuthService, ResolveAppUserService, PrismaService, ClerkAuthMiddleware]
})
export class IdentityAccessModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ClerkAuthMiddleware)
      .forRoutes({ path: "api/v1/auth/*", method: RequestMethod.ALL });
  }
}
