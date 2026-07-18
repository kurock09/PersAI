import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { SandboxConfig } from "@persai/config";
import {
  MAX_SCRIPT_BROWSER_RESPONSE_BYTES,
  SCRIPT_BROWSER_BROKER_REQUEST_CHANNEL,
  SCRIPT_BROWSER_RESPONSE_FRAME_PREFIX,
  type RuntimeScriptBrowserBrokerBinding,
  type RuntimeScriptBrowserBrokerRequestEnvelope,
  type RuntimeScriptBrowserBrokerResponseEnvelope,
  type RuntimeScriptBrowserSdkRequest
} from "@persai/runtime-contract";
import { createClient } from "redis";
import { SANDBOX_CONFIG } from "./sandbox-config";

type RedisClient = ReturnType<typeof createClient>;

const RESPONSE_TIMEOUT_MAX_MS = 120_000;
const BROKER_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SANDBOX_JOB_ID_PATTERN = /^[0-9a-f-]{36}$/i;

export function buildScriptBrowserResponseFrame(
  response: RuntimeScriptBrowserBrokerResponseEnvelope
): string {
  const scriptResponse = response.ok
    ? {
        version: 1,
        requestId: response.requestId,
        ok: true,
        result: response.result
      }
    : {
        version: 1,
        requestId: response.requestId,
        ok: false,
        error: response.error ?? {
          code: "script_browser_request_failed",
          message: "The browser request failed."
        }
      };
  const encoded = Buffer.from(JSON.stringify(scriptResponse), "utf8").toString("base64url");
  return `${SCRIPT_BROWSER_RESPONSE_FRAME_PREFIX}${encoded}\n`;
}

export interface SandboxScriptBrowserBrokerSession {
  request(request: RuntimeScriptBrowserSdkRequest): Promise<string>;
  close(): Promise<void>;
}

@Injectable()
export class ScriptBrowserBrokerService implements OnModuleDestroy {
  private publisher: RedisClient | null = null;
  private publisherPromise: Promise<RedisClient> | null = null;

  constructor(@Inject(SANDBOX_CONFIG) private readonly config: SandboxConfig) {}

  async openSession(input: {
    binding: RuntimeScriptBrowserBrokerBinding;
    sandboxJobId: string;
    deadlineAtMs: number;
  }): Promise<SandboxScriptBrowserBrokerSession> {
    const redisUrl = this.config.SCRIPT_BROWSER_BROKER_REDIS_URL;
    if (!redisUrl) {
      throw new Error("script_browser_broker_unconfigured");
    }
    this.assertBinding(input);
    const publisher = await this.publisherClient(redisUrl);
    const subscriber = publisher.duplicate();
    subscriber.on("error", () => undefined);
    await subscriber.connect();

    const responseChannel = this.responseChannel(input.binding.brokerId);
    let pending:
      | {
          requestId: string;
          resolve: (response: RuntimeScriptBrowserBrokerResponseEnvelope) => void;
          reject: (error: Error) => void;
        }
      | undefined;
    await subscriber.subscribe(responseChannel, (message) => {
      if (Buffer.byteLength(message, "utf8") > MAX_SCRIPT_BROWSER_RESPONSE_BYTES) {
        pending?.reject(new Error("script_browser_response_oversized"));
        pending = undefined;
        return;
      }
      const response = this.parseResponse(message, input);
      if (response === null || pending === undefined || response.requestId !== pending.requestId) {
        pending?.reject(new Error("script_browser_response_mismatched"));
        pending = undefined;
        return;
      }
      const current = pending;
      pending = undefined;
      current.resolve(response);
    });

    let closed = false;
    let rejectClosed!: (error: Error) => void;
    const closedPromise = new Promise<never>((_, reject) => {
      rejectClosed = reject;
    });
    void closedPromise.catch(() => undefined);
    return {
      request: async (request) => {
        if (closed) throw new Error("script_browser_broker_closed");
        if (pending !== undefined) throw new Error("script_browser_request_in_flight");
        const expiresAtMs = Date.parse(input.binding.expiresAt);
        const remainingMs = expiresAtMs - Date.now();
        if (!Number.isFinite(expiresAtMs) || remainingMs <= 0) {
          throw new Error("script_browser_broker_expired");
        }
        const envelope: RuntimeScriptBrowserBrokerRequestEnvelope = {
          version: 1,
          brokerId: input.binding.brokerId,
          authToken: input.binding.authToken,
          sandboxJobId: input.sandboxJobId,
          request
        };
        let rejectResponse!: (error: Error) => void;
        const responsePromise = new Promise<RuntimeScriptBrowserBrokerResponseEnvelope>(
          (resolve, reject) => {
            rejectResponse = reject;
            pending = { requestId: request.requestId, resolve, reject };
          }
        );
        const timeoutMs = Math.min(RESPONSE_TIMEOUT_MAX_MS, remainingMs);
        let timeout: NodeJS.Timeout | undefined;
        try {
          let receivers: number;
          try {
            receivers = await Promise.race([
              publisher.publish(SCRIPT_BROWSER_BROKER_REQUEST_CHANNEL, JSON.stringify(envelope)),
              closedPromise
            ]);
          } catch (error) {
            pending = undefined;
            rejectResponse(
              error instanceof Error ? error : new Error("script_browser_broker_unavailable")
            );
            await responsePromise.catch(() => undefined);
            throw error;
          }
          if (receivers < 1) {
            const unavailable = new Error("script_browser_broker_unavailable");
            pending = undefined;
            rejectResponse(unavailable);
            await responsePromise.catch(() => undefined);
            throw unavailable;
          }
          const response = await Promise.race([
            responsePromise,
            closedPromise,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error("script_browser_response_timeout")),
                timeoutMs
              );
            })
          ]);
          return buildScriptBrowserResponseFrame(response);
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
          pending = undefined;
        }
      },
      close: async () => {
        if (closed) return;
        closed = true;
        const closeError = new Error("script_browser_broker_closed");
        rejectClosed(closeError);
        pending?.reject(closeError);
        pending = undefined;
        await subscriber.unsubscribe(responseChannel).catch(() => undefined);
        await subscriber.quit().catch(() => undefined);
      }
    };
  }

  async onModuleDestroy(): Promise<void> {
    const publisher = this.publisher;
    this.publisher = null;
    this.publisherPromise = null;
    if (publisher !== null) await publisher.quit().catch(() => undefined);
  }

  private async publisherClient(redisUrl: string): Promise<RedisClient> {
    if (this.publisher !== null) return this.publisher;
    if (this.publisherPromise === null) {
      this.publisherPromise = (async () => {
        const client = createClient({
          url: redisUrl,
          disableOfflineQueue: true,
          socket: {
            connectTimeout: 3_000,
            reconnectStrategy: (retries) =>
              retries >= 3 ? false : Math.min(250 * (retries + 1), 1_000)
          }
        });
        client.on("error", () => undefined);
        await client.connect();
        return this.adoptPublisher(client);
      })().catch((error) => {
        this.publisherPromise = null;
        throw error;
      });
    }
    return this.publisherPromise;
  }

  /**
   * Caches `client` as `this.publisher` and wires terminal-`end` disposal.
   * Kept separate from `publisherClient()` so lifecycle tests can exercise
   * the dispose/stale-event-guard contract with a plain fake
   * `EventEmitter`-shaped client instead of a real Redis connection.
   */
  private adoptPublisher(client: RedisClient): RedisClient {
    // `end` fires both for an intentional `quit()` and for terminal
    // reconnect-strategy exhaustion (the bounded `retries >= 3` policy above
    // gives up rather than retrying forever). Either way this exact client is
    // now permanently dead and must stop being served as the cached publisher
    // — but only while nothing has already replaced it, so a stale event
    // from an old, already-superseded client can never clobber a newer live
    // one.
    client.on("end", () => {
      if (this.publisher === client) {
        this.publisher = null;
        this.publisherPromise = null;
      }
    });
    this.publisher = client;
    return client;
  }

  private parseResponse(
    message: string,
    input: {
      binding: RuntimeScriptBrowserBrokerBinding;
      sandboxJobId: string;
      deadlineAtMs: number;
    }
  ): RuntimeScriptBrowserBrokerResponseEnvelope | null {
    try {
      const row = JSON.parse(message) as RuntimeScriptBrowserBrokerResponseEnvelope;
      if (
        row === null ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        row.version !== 1 ||
        row.brokerId !== input.binding.brokerId ||
        row.authToken !== input.binding.authToken ||
        row.sandboxJobId !== input.sandboxJobId ||
        !REQUEST_ID_PATTERN.test(row.requestId) ||
        typeof row.ok !== "boolean"
      ) {
        return null;
      }
      if (row.ok) {
        return Object.keys(row).sort().join(",") ===
          "authToken,brokerId,ok,requestId,result,sandboxJobId,version" &&
          row.result !== null &&
          typeof row.result === "object" &&
          !Array.isArray(row.result) &&
          row.error === undefined
          ? row
          : null;
      }
      return Object.keys(row).sort().join(",") ===
        "authToken,brokerId,error,ok,requestId,sandboxJobId,version" &&
        row.result === undefined &&
        row.error !== undefined &&
        row.error !== null &&
        typeof row.error === "object" &&
        Object.keys(row.error).sort().join(",") === "code,message" &&
        typeof row.error.code === "string" &&
        /^[a-z0-9_]{1,128}$/.test(row.error.code) &&
        typeof row.error.message === "string" &&
        row.error.message.length <= 512
        ? row
        : null;
    } catch {
      return null;
    }
  }

  private responseChannel(brokerId: string): string {
    return `persai:script-browser:responses:v1:${brokerId}`;
  }

  private assertBinding(input: {
    binding: RuntimeScriptBrowserBrokerBinding;
    sandboxJobId: string;
    deadlineAtMs: number;
  }): void {
    const expiresAtMs = Date.parse(input.binding.expiresAt);
    if (
      !BROKER_ID_PATTERN.test(input.binding.brokerId) ||
      !AUTH_TOKEN_PATTERN.test(input.binding.authToken) ||
      !SANDBOX_JOB_ID_PATTERN.test(input.sandboxJobId) ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= Date.now() ||
      expiresAtMs > input.deadlineAtMs
    ) {
      throw new Error("script_browser_broker_binding_invalid");
    }
  }
}
