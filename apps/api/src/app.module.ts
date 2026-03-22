import { Module } from "@nestjs/common";
import { IdentityAccessModule } from "./modules/identity-access/identity-access.module";
import { WorkspaceManagementModule } from "./modules/workspace-management/workspace-management.module";
import { PlatformCoreModule } from "./modules/platform-core/platform-core.module";

@Module({
  imports: [IdentityAccessModule, WorkspaceManagementModule, PlatformCoreModule]
})
export class AppModule {}
