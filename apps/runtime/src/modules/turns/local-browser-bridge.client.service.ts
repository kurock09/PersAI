import { Injectable } from "@nestjs/common";
import type { LocalBrowserCommand, LocalBrowserResult } from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

export type LocalBrowserBridgeCommandOutcome =
  | {
      ok: true;
      bridgeDeviceId: string;
      result: LocalBrowserResult;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

const LOCAL_BROWSER_BRIDGE_POLL_INTERVAL_MS = 500;

@Injectable()
export class LocalBrowserBridgeClient {
  constructor(private readonly persaiInternalApiClientService: PersaiInternalApiClientService) {}

  async executeCommand(input: {
    assistantId: string;
    workspaceId: string;
    bridgeDeviceId?: string | null;
    command: LocalBrowserCommand;
  }): Promise<LocalBrowserBridgeCommandOutcome> {
    const dispatched = await this.persaiInternalApiClientService.dispatchLocalBrowserCommand(input);
    if (dispatched.accepted !== true) {
      return {
        ok: false,
        code: "code" in dispatched ? dispatched.code : "bridge_unavailable",
        message:
          "message" in dispatched
            ? dispatched.message
            : "The local browser bridge did not accept the command."
      };
    }

    for (;;) {
      const polled = await this.persaiInternalApiClientService.getLocalBrowserCommandResult(
        dispatched.commandId
      );
      if (polled.status === "pending") {
        await this.sleep(LOCAL_BROWSER_BRIDGE_POLL_INTERVAL_MS);
        continue;
      }
      return {
        ok: true,
        bridgeDeviceId: dispatched.bridgeDeviceId,
        result:
          polled.result ??
          ({
            commandId: dispatched.commandId,
            ok: false,
            errorReason: "command_unknown"
          } satisfies LocalBrowserResult)
      };
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
