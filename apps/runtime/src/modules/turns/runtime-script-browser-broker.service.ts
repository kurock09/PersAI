import { randomBytes } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import {
  MAX_SCRIPT_BROWSER_RESPONSE_BYTES,
  MAX_SCRIPT_BROWSER_REQUEST_BYTES,
  SCRIPT_BROWSER_BROKER_REQUEST_CHANNEL,
  type LocalBrowserBridgeDeviceKind,
  type ProviderGatewayToolCall,
  type RuntimeScriptBrowserBrokerBinding,
  type RuntimeScriptBrowserBrokerRequestEnvelope,
  type RuntimeScriptBrowserBrokerResponseEnvelope
} from "@persai/runtime-contract";
import { createClient } from "redis";
import { RUNTIME_CONFIG } from "../../runtime-config";
import { RuntimeBrowserToolService } from "./runtime-browser-tool.service";
import type { TurnToolProgressSink } from "./tool-progress-sink";

type RedisClient = ReturnType<typeof createClient>;

const ALLOWED_ARGUMENT_KEYS = new Set([
  "url",
  "maxChars",
  "operations",
  "optimizeForSpeed",
  "stayOnPage"
]);
const BROKER_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SANDBOX_JOB_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const MAX_BROKER_ERROR_CODE_CHARS = 128;

type BrokerContext = {
  binding: RuntimeScriptBrowserBrokerBinding;
  sandboxJobId: string | null;
  inFlight: boolean;
  bundle: AssistantRuntimeBundle;
  sessionId: string;
  chatId: string | null;
  transportSurface: string | null;
  bridgeDeviceId: string | null;
  bridgeDeviceKind: LocalBrowserBridgeDeviceKind | null;
  sourceUserMessageText: string | null;
  sourceUserMessageCreatedAt: string | null;
  allowedProfile: string;
  ttlMs: number;
  abortSignal?: AbortSignal;
  toolProgressSink?: TurnToolProgressSink;
};

/**
 * A `publisher`/`subscriber` pair from one successful {@link connect} call.
 * Identity of this object (not the identity of either client) is the single
 * source of truth for "is this still the live connection": every reconnect
 * creates a brand-new pair, and a terminal `end` handler only tears down and
 * clears `RuntimeScriptBrowserBrokerService.current` when it still points at
 * the exact pair that registered that handler. This stops a stale event from
 * an old, already-replaced client from clobbering a newer live connection.
 */
type BrokerConnectionPair = {
  publisher: RedisClient;
  subscriber: RedisClient;
};

@Injectable()
export class RuntimeScriptBrowserBrokerService implements OnModuleDestroy {
  private readonly logger = new Logger(RuntimeScriptBrowserBrokerService.name);
  private current: BrokerConnectionPair | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly brokers = new Map<string, BrokerContext>();

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    private readonly runtimeBrowserToolService: RuntimeBrowserToolService
  ) {}

  async register(input: Omit<BrokerContext, "binding" | "sandboxJobId" | "inFlight">): Promise<{
    binding: RuntimeScriptBrowserBrokerBinding;
    bindSandboxJob(jobId: string): void;
    close(): void;
  }> {
    await this.ensureConnected();
    const boundedTtlMs = Number.isFinite(input.ttlMs)
      ? Math.min(31 * 60_000, Math.max(1_000, input.ttlMs))
      : 1_000;
    const binding: RuntimeScriptBrowserBrokerBinding = {
      brokerId: randomBytes(24).toString("base64url"),
      authToken: randomBytes(32).toString("base64url"),
      expiresAt: new Date(Date.now() + boundedTtlMs).toISOString()
    };
    const context: BrokerContext = {
      ...input,
      binding,
      sandboxJobId: null,
      inFlight: false
    };
    this.brokers.set(binding.brokerId, context);
    return {
      binding,
      bindSandboxJob: (jobId) => {
        if (this.brokers.get(binding.brokerId) === context && context.sandboxJobId === null) {
          context.sandboxJobId = jobId;
        }
      },
      close: () => {
        if (this.brokers.get(binding.brokerId) === context) {
          this.brokers.delete(binding.brokerId);
        }
      }
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.brokers.clear();
    const pair = this.current;
    this.current = null;
    this.connectPromise = null;
    if (pair !== null) {
      await pair.subscriber.quit().catch(() => undefined);
      await pair.publisher.quit().catch(() => undefined);
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.current !== null) return;
    if (this.connectPromise === null) {
      this.connectPromise = this.connect().catch((error) => {
        this.connectPromise = null;
        throw error;
      });
    }
    await this.connectPromise;
  }

  private async connect(): Promise<void> {
    const publisher = createClient({
      url: this.config.RUNTIME_STATE_REDIS_URL,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 3_000,
        reconnectStrategy: (retries) =>
          retries >= 3 ? false : Math.min(250 * (retries + 1), 1_000)
      }
    });
    publisher.on("error", () => undefined);
    let subscriber: RedisClient | null = null;
    try {
      await publisher.connect();
      subscriber = publisher.duplicate();
      subscriber.on("error", () => undefined);
      await subscriber.connect();
      await subscriber.subscribe(SCRIPT_BROWSER_BROKER_REQUEST_CHANNEL, (message) => {
        void this.handleMessageSafely(message);
      });
      this.adoptPair(publisher, subscriber);
    } catch (error) {
      await subscriber?.quit().catch(() => undefined);
      await publisher.quit().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Registers the exact pair from one successful {@link connect} call as
   * `this.current` and wires terminal-`end` disposal on both clients. Kept
   * separate from `connect()` so lifecycle tests can exercise the dispose/
   * stale-event-guard contract with plain fake `EventEmitter`-shaped clients
   * instead of a real Redis connection.
   */
  private adoptPair(publisher: RedisClient, subscriber: RedisClient): BrokerConnectionPair {
    const pair: BrokerConnectionPair = { publisher, subscriber };
    // `end` fires both on an intentional `quit()`/`disconnect()` and on
    // terminal reconnect-strategy exhaustion (the bounded `retries >= 3`
    // policy above gives up rather than retrying forever). Either way the
    // client is now permanently dead, so this pair must stop being served as
    // "the" connection — but only if nothing has already replaced it
    // (reference equality against `this.current` guards against a stale
    // listener from an old, already-superseded pair tearing down a newer
    // live one).
    const disposeIfCurrent = (): void => {
      if (this.current !== pair) return;
      this.current = null;
      this.connectPromise = null;
      void pair.subscriber.quit().catch(() => undefined);
      void pair.publisher.quit().catch(() => undefined);
    };
    publisher.on("end", disposeIfCurrent);
    subscriber.on("end", disposeIfCurrent);
    this.current = pair;
    return pair;
  }

  private async handleMessageSafely(message: string): Promise<void> {
    try {
      await this.handleMessage(message);
    } catch (error) {
      const code =
        error instanceof Error && /^[a-z0-9_]{1,128}$/.test(error.message)
          ? error.message
          : "script_browser_broker_delivery_failed";
      this.logger.warn(`[script-browser-broker] request failed code=${code}`);
    }
  }

  private async handleMessage(message: string): Promise<void> {
    const envelope = this.parseEnvelope(message);
    if (envelope === null) return;
    const context = this.brokers.get(envelope.brokerId);
    if (
      context === undefined ||
      envelope.authToken !== context.binding.authToken ||
      Date.parse(context.binding.expiresAt) <= Date.now()
    ) {
      return;
    }
    if (context.sandboxJobId === null) {
      context.sandboxJobId = envelope.sandboxJobId;
    }
    if (context.sandboxJobId !== envelope.sandboxJobId) {
      await this.publishError(
        context,
        envelope,
        "script_browser_job_mismatch",
        "Browser broker job mismatch."
      );
      return;
    }
    if (context.inFlight) {
      await this.publishError(
        context,
        envelope,
        "script_browser_request_in_flight",
        "Only one Script browser request may be active."
      );
      return;
    }
    const argumentsValue = this.sanitizeArguments(envelope, context.allowedProfile);
    if (argumentsValue instanceof Error) {
      await this.publishError(
        context,
        envelope,
        argumentsValue.message,
        "Script browser request is invalid."
      );
      return;
    }
    context.inFlight = true;
    try {
      const toolCall: ProviderGatewayToolCall = {
        id: `script-browser-${envelope.request.requestId}`,
        name: "browser",
        arguments: argumentsValue
      };
      const outcome = await this.runtimeBrowserToolService.executeToolCall({
        bundle: context.bundle,
        toolCall,
        sessionId: context.sessionId,
        chatId: context.chatId,
        transportSurface: context.transportSurface,
        bridgeDeviceId: context.bridgeDeviceId,
        bridgeDeviceKind: context.bridgeDeviceKind,
        sourceUserMessageText: context.sourceUserMessageText,
        sourceUserMessageCreatedAt: context.sourceUserMessageCreatedAt,
        ...(context.abortSignal === undefined ? {} : { abortSignal: context.abortSignal }),
        ...(context.toolProgressSink === undefined
          ? {}
          : { toolProgressSink: context.toolProgressSink })
      });
      if (outcome.artifacts.length > 0) {
        await this.publishError(
          context,
          envelope,
          "script_browser_artifact_forbidden",
          "Script browser SDK does not support browser artifacts."
        );
        return;
      }
      await this.publish(context, {
        version: 1,
        brokerId: context.binding.brokerId,
        authToken: context.binding.authToken,
        sandboxJobId: envelope.sandboxJobId,
        requestId: envelope.request.requestId,
        ok: true,
        result: outcome.payload
      });
    } catch {
      const aborted = context.abortSignal?.aborted === true;
      await this.publishError(
        context,
        envelope,
        aborted ? "user_stopped" : "script_browser_dispatch_failed",
        aborted ? "Browser request was stopped." : "Browser request failed."
      );
    } finally {
      context.inFlight = false;
    }
  }

  private sanitizeArguments(
    envelope: RuntimeScriptBrowserBrokerRequestEnvelope,
    allowedProfile: string
  ): Record<string, unknown> | Error {
    const request = envelope.request;
    if (request.action !== "snapshot" && request.action !== "act") {
      return new Error("script_browser_action_forbidden");
    }
    if (typeof request.profile !== "string" || request.profile.trim().length === 0) {
      return new Error("script_browser_profile_required");
    }
    if (request.profile.trim() !== allowedProfile) {
      return new Error("script_browser_profile_mismatch");
    }
    if (Object.keys(request.arguments).some((key) => !ALLOWED_ARGUMENT_KEYS.has(key))) {
      return new Error("script_browser_argument_forbidden");
    }
    return {
      ...request.arguments,
      action: request.action,
      profile: request.profile
    };
  }

  private parseEnvelope(message: string): RuntimeScriptBrowserBrokerRequestEnvelope | null {
    if (Buffer.byteLength(message, "utf8") > MAX_SCRIPT_BROWSER_REQUEST_BYTES * 2) {
      return null;
    }
    try {
      const row = JSON.parse(message) as RuntimeScriptBrowserBrokerRequestEnvelope;
      if (
        row === null ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        Object.keys(row).sort().join(",") !== "authToken,brokerId,request,sandboxJobId,version" ||
        row.version !== 1 ||
        !BROKER_ID_PATTERN.test(row.brokerId) ||
        !AUTH_TOKEN_PATTERN.test(row.authToken) ||
        !SANDBOX_JOB_ID_PATTERN.test(row.sandboxJobId) ||
        row.request === null ||
        typeof row.request !== "object" ||
        Array.isArray(row.request) ||
        Object.keys(row.request).sort().join(",") !==
          "action,arguments,profile,requestId,version" ||
        row.request.version !== 1 ||
        !REQUEST_ID_PATTERN.test(row.request.requestId) ||
        typeof row.request.action !== "string" ||
        typeof row.request.profile !== "string" ||
        row.request.arguments === null ||
        typeof row.request.arguments !== "object" ||
        Array.isArray(row.request.arguments)
      ) {
        return null;
      }
      return row;
    } catch {
      return null;
    }
  }

  private async publishError(
    context: BrokerContext,
    envelope: RuntimeScriptBrowserBrokerRequestEnvelope,
    code: string,
    message: string
  ): Promise<void> {
    const safeCode = /^[a-z0-9_]{1,128}$/.test(code) ? code : "script_browser_request_failed";
    await this.publish(context, {
      version: 1,
      brokerId: context.binding.brokerId,
      authToken: context.binding.authToken,
      sandboxJobId: envelope.sandboxJobId,
      requestId: envelope.request.requestId,
      ok: false,
      error: {
        code: safeCode.slice(0, MAX_BROKER_ERROR_CODE_CHARS),
        message: message.slice(0, 512)
      }
    });
  }

  private async publish(
    context: BrokerContext,
    response: RuntimeScriptBrowserBrokerResponseEnvelope
  ): Promise<void> {
    const serialized = JSON.stringify(response);
    if (Buffer.byteLength(serialized, "utf8") > MAX_SCRIPT_BROWSER_RESPONSE_BYTES) {
      throw new Error("script_browser_response_oversized");
    }
    const publisher = this.current?.publisher ?? null;
    if (publisher === null) throw new Error("script_browser_broker_unavailable");
    const receivers = await publisher.publish(
      `persai:script-browser:responses:v1:${context.binding.brokerId}`,
      serialized
    );
    if (receivers < 1) throw new Error("script_browser_broker_unavailable");
  }
}
