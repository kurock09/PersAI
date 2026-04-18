import { Module } from "@nestjs/common";
import { SandboxConfigModule } from "./sandbox-config.module";
import { SandboxController } from "./sandbox.controller";
import { SandboxObjectStorageService } from "./sandbox-object-storage.service";
import { SandboxPrismaService } from "./sandbox-prisma.service";
import { SandboxService } from "./sandbox.service";

@Module({
  imports: [SandboxConfigModule],
  controllers: [SandboxController],
  providers: [SandboxPrismaService, SandboxObjectStorageService, SandboxService]
})
export class AppModule {}
