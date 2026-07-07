import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type {
  PersistentBrowserCapabilityPolicy,
  ProviderGatewayBrowserSessionDeleteRequest,
  ProviderGatewayBrowserSessionOpenLiveRequest,
  ProviderGatewayBrowserSessionOpenLiveResult,
  ProviderGatewayBrowserSessionStartLoginRequest,
  ProviderGatewayBrowserSessionStartLoginResult,
  ProviderGatewayBrowserSessionVerifyRequest,
  ProviderGatewayBrowserSessionVerifyResult
} from "@persai/runtime-contract";
import { TOOL_CREDENTIAL_IDS, TOOL_DEFAULT_PROVIDER } from "./tool-credential-settings";

const DEFAULT_BROWSER_SESSION_TIMEOUT_MS = 120_000;

@Injectable()
export class BrowserlessProviderGatewayClient {
  async startLogin(input: {
    loginUrl: string;
    reconnectTimeoutMs?: number | null;
    capabilityPolicy: PersistentBrowserCapabilityPolicy;
    browserCredentialSecretId?: string;
  }): Promise<ProviderGatewayBrowserSessionStartLoginResult> {
    const baseUrl = (process.env["PERSAI_PROVIDER_GATEWAY_BASE_URL"] ?? "").trim();
    if (!baseUrl) {
      throw new ServiceUnavailableException(
        "PERSAI_PROVIDER_GATEWAY_BASE_URL is not configured for browser session login."
      );
    }

    const url = new URL("/api/v1/providers/browser-session/start-login", baseUrl).toString();
    const requestBody: ProviderGatewayBrowserSessionStartLoginRequest = {
      loginUrl: input.loginUrl,
      timeoutMs: null,
      reconnectTimeoutMs: input.reconnectTimeoutMs ?? null,
      capabilityPolicy: input.capabilityPolicy,
      credential: {
        toolCode: "browser",
        secretId: input.browserCredentialSecretId ?? TOOL_CREDENTIAL_IDS.tool_browser,
        providerId: (TOOL_DEFAULT_PROVIDER.tool_browser ?? "browserless") as "browserless"
      }
    };

    const response = await this.postJson(url, requestBody, DEFAULT_BROWSER_SESSION_TIMEOUT_MS);
    if (!response.ok) {
      throw new ServiceUnavailableException(
        this.extractErrorMessage(response.body, "Browser session login failed.")
      );
    }
    return this.parseStartLoginResult(response.body);
  }

  async deleteSession(
    providerSessionId: string,
    input?: { browserCredentialSecretId?: string }
  ): Promise<void> {
    const baseUrl = (process.env["PERSAI_PROVIDER_GATEWAY_BASE_URL"] ?? "").trim();
    if (!baseUrl) {
      return;
    }

    const url = new URL("/api/v1/providers/browser-session/delete", baseUrl).toString();
    const requestBody: ProviderGatewayBrowserSessionDeleteRequest = {
      providerSessionId,
      credential: {
        toolCode: "browser",
        secretId: input?.browserCredentialSecretId ?? TOOL_CREDENTIAL_IDS.tool_browser,
        providerId: (TOOL_DEFAULT_PROVIDER.tool_browser ?? "browserless") as "browserless"
      }
    };

    try {
      const response = await this.postJson(url, requestBody, 15_000);
      if (!response.ok) {
        throw new ServiceUnavailableException(
          this.extractErrorMessage(response.body, "Browser session delete failed.")
        );
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException("Browser session delete failed.");
    }
  }

  async verifySession(input: {
    providerSessionId: string;
    capabilityPolicy: PersistentBrowserCapabilityPolicy;
    browserCredentialSecretId?: string;
  }): Promise<ProviderGatewayBrowserSessionVerifyResult> {
    const baseUrl = (process.env["PERSAI_PROVIDER_GATEWAY_BASE_URL"] ?? "").trim();
    if (!baseUrl) {
      throw new ServiceUnavailableException(
        "PERSAI_PROVIDER_GATEWAY_BASE_URL is not configured for browser session verify."
      );
    }

    const url = new URL("/api/v1/providers/browser-session/verify", baseUrl).toString();
    const requestBody: ProviderGatewayBrowserSessionVerifyRequest = {
      providerSessionId: input.providerSessionId,
      capabilityPolicy: input.capabilityPolicy,
      credential: {
        toolCode: "browser",
        secretId: input.browserCredentialSecretId ?? TOOL_CREDENTIAL_IDS.tool_browser,
        providerId: (TOOL_DEFAULT_PROVIDER.tool_browser ?? "browserless") as "browserless"
      }
    };

    const response = await this.postJson(url, requestBody, 15_000);
    if (!response.ok) {
      throw new ServiceUnavailableException(
        this.extractErrorMessage(response.body, "Browser session verify failed.")
      );
    }
    return this.parseVerifySessionResult(response.body);
  }

  async openLive(input: {
    providerSessionId: string;
    targetUrl: string;
    capabilityPolicy: PersistentBrowserCapabilityPolicy;
    browserCredentialSecretId?: string;
  }): Promise<ProviderGatewayBrowserSessionOpenLiveResult> {
    const baseUrl = (process.env["PERSAI_PROVIDER_GATEWAY_BASE_URL"] ?? "").trim();
    if (!baseUrl) {
      throw new ServiceUnavailableException(
        "PERSAI_PROVIDER_GATEWAY_BASE_URL is not configured for browser session open-live."
      );
    }

    const url = new URL("/api/v1/providers/browser-session/open-live", baseUrl).toString();
    const requestBody: ProviderGatewayBrowserSessionOpenLiveRequest = {
      providerSessionId: input.providerSessionId,
      targetUrl: input.targetUrl,
      timeoutMs: null,
      capabilityPolicy: input.capabilityPolicy,
      credential: {
        toolCode: "browser",
        secretId: input.browserCredentialSecretId ?? TOOL_CREDENTIAL_IDS.tool_browser,
        providerId: (TOOL_DEFAULT_PROVIDER.tool_browser ?? "browserless") as "browserless"
      }
    };

    const response = await this.postJson(url, requestBody, DEFAULT_BROWSER_SESSION_TIMEOUT_MS);
    if (!response.ok) {
      throw new ServiceUnavailableException(
        this.extractErrorMessage(response.body, "Browser session open-live failed.")
      );
    }
    return this.parseOpenLiveResult(response.body);
  }

  private async postJson(
    url: string,
    body: unknown,
    timeoutMs: number
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const contentType = response.headers.get("content-type") ?? "";
      const parsedBody = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
      return {
        ok: response.ok,
        status: response.status,
        body: parsedBody
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseStartLoginResult(body: unknown): ProviderGatewayBrowserSessionStartLoginResult {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ServiceUnavailableException(
        "Provider gateway returned an invalid browser login response."
      );
    }
    const row = body as Record<string, unknown>;
    if (
      typeof row.providerSessionId !== "string" ||
      row.providerSessionId.trim().length === 0 ||
      typeof row.liveUrl !== "string" ||
      row.liveUrl.trim().length === 0
    ) {
      throw new ServiceUnavailableException(
        "Provider gateway returned an invalid browser login response."
      );
    }
    return {
      providerSessionId: row.providerSessionId.trim(),
      liveUrl: row.liveUrl.trim()
    };
  }

  private parseOpenLiveResult(body: unknown): ProviderGatewayBrowserSessionOpenLiveResult {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ServiceUnavailableException(
        "Provider gateway returned an invalid browser open-live response."
      );
    }
    const row = body as Record<string, unknown>;
    if (typeof row.liveUrl !== "string" || row.liveUrl.trim().length === 0) {
      throw new ServiceUnavailableException(
        "Provider gateway returned an invalid browser open-live response."
      );
    }
    return {
      liveUrl: row.liveUrl.trim()
    };
  }

  private parseVerifySessionResult(body: unknown): ProviderGatewayBrowserSessionVerifyResult {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ServiceUnavailableException(
        "Provider gateway returned an invalid browser session verify response."
      );
    }
    const row = body as Record<string, unknown>;
    if (row.ok !== true) {
      throw new ServiceUnavailableException(
        "Provider gateway returned an invalid browser session verify response."
      );
    }
    return { ok: true };
  }

  private extractErrorMessage(body: unknown, fallback: string): string {
    if (typeof body === "string" && body.trim().length > 0) {
      return body.trim();
    }
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const row = body as Record<string, unknown>;
      const message = row.message;
      if (typeof message === "string" && message.trim().length > 0) {
        return message.trim();
      }
      const error = row.error;
      if (error && typeof error === "object" && !Array.isArray(error)) {
        const errorMessage = (error as Record<string, unknown>).message;
        if (typeof errorMessage === "string" && errorMessage.trim().length > 0) {
          return errorMessage.trim();
        }
      }
    }
    return fallback;
  }
}
