export const BROWSERLESS_SESSION_PORT = Symbol("BROWSERLESS_SESSION_PORT");

export type BrowserlessStartLoginInput = {
  loginUrl: string;
  profileKey: string;
  reconnectTimeoutMs: number;
  browserCredentialSecretId?: string;
};

export type BrowserlessStartLoginResult = {
  providerSessionId: string;
  liveUrl: string;
};

export type BrowserlessVerifySessionInput = {
  providerSessionId: string;
  browserCredentialSecretId?: string;
};

export type BrowserlessVerifySessionResult = {
  ok: true;
};

export interface BrowserlessSessionPort {
  startLogin(input: BrowserlessStartLoginInput): Promise<BrowserlessStartLoginResult>;
  verifySession(input: BrowserlessVerifySessionInput): Promise<BrowserlessVerifySessionResult>;
  deleteSession(
    providerSessionId: string,
    input?: { browserCredentialSecretId?: string }
  ): Promise<void>;
}
