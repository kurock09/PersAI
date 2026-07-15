import { Injectable } from "@nestjs/common";
import type {
  LocalBrowserBridgeDeviceKind,
  LocalBrowserCommand,
  LocalBrowserResult
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

export type LocalBrowserBridgeCommandOutcome =
  | {
      ok: true;
      bridgeDeviceId: string;
      deviceKind: LocalBrowserBridgeDeviceKind;
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
    requireBridgeDeviceId?: boolean;
    command: LocalBrowserCommand;
    abortSignal?: AbortSignal;
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
      if (input.abortSignal?.aborted) {
        return {
          ok: false,
          code: "user_stopped",
          message: "Browser command polling was cancelled because the turn was stopped."
        };
      }
      const polled = await this.persaiInternalApiClientService.getLocalBrowserCommandResult(
        dispatched.commandId
      );
      if (polled.status === "pending") {
        await this.sleep(LOCAL_BROWSER_BRIDGE_POLL_INTERVAL_MS, input.abortSignal);
        continue;
      }
      return {
        ok: true,
        bridgeDeviceId: dispatched.bridgeDeviceId,
        deviceKind: dispatched.deviceKind,
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

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
