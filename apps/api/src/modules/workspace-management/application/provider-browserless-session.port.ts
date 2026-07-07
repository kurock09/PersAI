import { Injectable } from "@nestjs/common";
import { BrowserlessProviderGatewayClient } from "./browserless-provider-gateway.client";
import type {
  BrowserlessOpenLiveInput,
  BrowserlessOpenLiveResult,
  BrowserlessSessionPort,
  BrowserlessStartLoginInput,
  BrowserlessStartLoginResult,
  BrowserlessVerifySessionInput,
  BrowserlessVerifySessionResult
} from "./browserless-session.port";

@Injectable()
export class ProviderBrowserlessSessionPort implements BrowserlessSessionPort {
  constructor(
    private readonly browserlessProviderGatewayClient: BrowserlessProviderGatewayClient
  ) {}

  startLogin(input: BrowserlessStartLoginInput): Promise<BrowserlessStartLoginResult> {
    return this.browserlessProviderGatewayClient.startLogin({
      loginUrl: input.loginUrl,
      reconnectTimeoutMs: input.reconnectTimeoutMs,
      capabilityPolicy: input.capabilityPolicy,
      ...(input.browserCredentialSecretId !== undefined
        ? { browserCredentialSecretId: input.browserCredentialSecretId }
        : {})
    });
  }

  verifySession(input: BrowserlessVerifySessionInput): Promise<BrowserlessVerifySessionResult> {
    return this.browserlessProviderGatewayClient.verifySession({
      providerSessionId: input.providerSessionId,
      capabilityPolicy: input.capabilityPolicy,
      ...(input.browserCredentialSecretId !== undefined
        ? { browserCredentialSecretId: input.browserCredentialSecretId }
        : {})
    });
  }

  openLive(input: BrowserlessOpenLiveInput): Promise<BrowserlessOpenLiveResult> {
    return this.browserlessProviderGatewayClient.openLive({
      providerSessionId: input.providerSessionId,
      targetUrl: input.targetUrl,
      capabilityPolicy: input.capabilityPolicy,
      ...(input.browserCredentialSecretId !== undefined
        ? { browserCredentialSecretId: input.browserCredentialSecretId }
        : {})
    });
  }

  deleteSession(
    providerSessionId: string,
    input?: { browserCredentialSecretId?: string }
  ): Promise<void> {
    return this.browserlessProviderGatewayClient.deleteSession(providerSessionId, input);
  }
}
