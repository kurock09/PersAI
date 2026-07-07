import type { PersistentBrowserCapabilityPolicy } from "@persai/runtime-contract";

export const BROWSERLESS_SESSION_PORT = Symbol("BROWSERLESS_SESSION_PORT");

export type BrowserlessStartLoginInput = {
  loginUrl: string;
  profileKey: string;
  reconnectTimeoutMs: number;
  capabilityPolicy: PersistentBrowserCapabilityPolicy;
  browserCredentialSecretId?: string;
};

export type BrowserlessStartLoginResult = {
  providerSessionId: string;
  liveUrl: string;
};

export type BrowserlessVerifySessionInput = {
  providerSessionId: string;
  capabilityPolicy: PersistentBrowserCapabilityPolicy;
  browserCredentialSecretId?: string;
};

export type BrowserlessVerifySessionResult = {
  ok: true;
};

export type BrowserlessOpenLiveInput = {
  providerSessionId: string;
  targetUrl: string;
  capabilityPolicy: PersistentBrowserCapabilityPolicy;
  browserCredentialSecretId?: string;
};

export type BrowserlessOpenLiveResult = {
  liveUrl: string;
};

export interface BrowserlessSessionPort {
  startLogin(input: BrowserlessStartLoginInput): Promise<BrowserlessStartLoginResult>;
  verifySession(input: BrowserlessVerifySessionInput): Promise<BrowserlessVerifySessionResult>;
  openLive(input: BrowserlessOpenLiveInput): Promise<BrowserlessOpenLiveResult>;
  deleteSession(
    providerSessionId: string,
    input?: { browserCredentialSecretId?: string }
  ): Promise<void>;
}
