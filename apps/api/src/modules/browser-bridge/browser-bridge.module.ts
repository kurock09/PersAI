import { Module, forwardRef } from "@nestjs/common";
import { IdentityAccessModule } from "../identity-access/identity-access.module";
import { WorkspaceManagementModule } from "../workspace-management/workspace-management.module";
import { BrowserBridgeCoordinatorService } from "./application/browser-bridge-coordinator.service";
import { BrowserBridgeRelayService } from "./application/browser-bridge-relay.service";
import { BrowserBridgeWebSocketServer } from "./application/browser-bridge-websocket.server";
import { AssistantBrowserBridgeDevicesController } from "./interface/http/assistant-browser-bridge-devices.controller";
import { InternalRuntimeBrowserBridgeController } from "./interface/http/internal-runtime-browser-bridge.controller";

@Module({
  imports: [IdentityAccessModule, forwardRef(() => WorkspaceManagementModule)],
  controllers: [AssistantBrowserBridgeDevicesController, InternalRuntimeBrowserBridgeController],
  providers: [
    BrowserBridgeCoordinatorService,
    BrowserBridgeRelayService,
    BrowserBridgeWebSocketServer
  ],
  exports: [BrowserBridgeRelayService, BrowserBridgeWebSocketServer]
})
export class BrowserBridgeModule {}
