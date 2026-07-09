import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  LocalBrowserBridgeDeviceKind,
  LocalBrowserCommand,
  LocalBrowserResult
} from "@persai/runtime-contract";
import { createClient } from "redis";

/**
 * ADR-140 cross-pod browser-bridge coordinator.
 *
 * The browser-bridge relay holds live WebSocket sockets in per-pod memory, but `api` runs with
 * >=2 replicas and the GCLB round-robins HTTP dispatch/result calls across pods. Without shared
 * coordination a device socket owned by pod A is invisible to a dispatch handled by pod B, which
 * surfaces as a permanent `bridge_unavailable` / 409 for login `open-live`, `complete-login`, and
 * every browser tool command.
 *
 * This coordinator publishes the connection registry and command lifecycle into Redis so that:
 *  - any pod can discover which pod owns a device socket for an assistant scope,
 *  - a dispatch handled anywhere is delivered to the owning pod via pub/sub,
 *  - the command result is visible to `getCommandResult` polled from any pod.
 *
 * When `BROWSER_BRIDGE_REDIS_URL` is not configured (local dev / single process) the coordinator
 * stays disabled and the relay falls back to pure in-memory behavior.
 */

export type BridgeConnectionDescriptor = {
  podId: string;
  connectionKey: string;
  assistantId: string;
  workspaceId: string;
  bridgeDeviceId: string;
  deviceKind: LocalBrowserBridgeDeviceKind;
};

export type BridgeCommandState = {
  status: "pending" | "completed";
  assistantId: string;
  workspaceId: string;
  connectionKey: string;
  bridgeDeviceId: string;
  timeoutAt: number;
  result?: LocalBrowserResult;
};

export type ForwardedCommandEnvelope = {
  connectionKey: string;
  command: LocalBrowserCommand;
};

export type ForwardedCommandHandler = (envelope: ForwardedCommandEnvelope) => void;

type RedisClient = ReturnType<typeof createClient>;

const KEY_PREFIX = "bb";
const CONNECTION_TTL_SECONDS = 60;
const SCOPE_TTL_SECONDS = 120;
const COMMAND_STATE_MIN_TTL_SECONDS = 60;

@Injectable()
export class BrowserBridgeCoordinatorService {
  private readonly logger = new Logger(BrowserBridgeCoordinatorService.name);
  private readonly redisUrl: string | undefined;
  readonly podId = randomUUID();

  private mainClient: RedisClient | null = null;
  private subscriberClient: RedisClient | null = null;
  private commandHandler: ForwardedCommandHandler | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor() {
    let url: string | undefined;
    try {
      url = loadApiConfig(process.env).BROWSER_BRIDGE_REDIS_URL;
    } catch {
      // Config parse failures are surfaced by the main bootstrap path; the coordinator simply
      // stays disabled so the relay keeps working in-memory.
      url = undefined;
    }
    this.redisUrl = url?.trim() ? url.trim() : undefined;
  }

  isEnabled(): boolean {
    return this.redisUrl !== undefined;
  }

  setCommandHandler(handler: ForwardedCommandHandler): void {
    this.commandHandler = handler;
  }

  async ensureConnected(): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }
    if (this.mainClient && this.subscriberClient) {
      return true;
    }
    if (this.connectPromise === null) {
      this.connectPromise = this.connect().catch((error: unknown) => {
        this.connectPromise = null;
        throw error;
      });
    }
    try {
      await this.connectPromise;
      return true;
    } catch (error) {
      this.logger.warn(`[browser-bridge] coordinator connect failed: ${String(error)}`);
      return false;
    }
  }

  private async connect(): Promise<void> {
    const url = this.redisUrl;
    if (url === undefined) {
      return;
    }
    const main = createClient({ url });
    main.on("error", (error) => {
      this.logger.warn(`[browser-bridge] redis main client error: ${String(error)}`);
    });
    await main.connect();

    const subscriber = main.duplicate();
    subscriber.on("error", (error) => {
      this.logger.warn(`[browser-bridge] redis subscriber client error: ${String(error)}`);
    });
    await subscriber.connect();
    await subscriber.subscribe(this.podChannel(this.podId), (message) => {
      this.handlePodMessage(message);
    });

    this.mainClient = main;
    this.subscriberClient = subscriber;
    this.logger.log(`[browser-bridge] coordinator connected pod=${this.podId}`);
  }

  private handlePodMessage(message: string): void {
    if (this.commandHandler === null) {
      return;
    }
    let envelope: ForwardedCommandEnvelope;
    try {
      envelope = JSON.parse(message) as ForwardedCommandEnvelope;
    } catch (error) {
      this.logger.warn(`[browser-bridge] dropped malformed pod message: ${String(error)}`);
      return;
    }
    if (
      typeof envelope?.connectionKey !== "string" ||
      envelope.command === null ||
      typeof envelope.command !== "object"
    ) {
      return;
    }
    try {
      this.commandHandler(envelope);
    } catch (error) {
      this.logger.warn(`[browser-bridge] forwarded command handler failed: ${String(error)}`);
    }
  }

  async registerConnection(descriptor: BridgeConnectionDescriptor): Promise<void> {
    const client = await this.client();
    if (client === null) {
      return;
    }
    const scopeKey = this.scopeSetKey(descriptor.workspaceId, descriptor.assistantId);
    try {
      await client.set(this.connectionKey(descriptor.connectionKey), JSON.stringify(descriptor), {
        EX: CONNECTION_TTL_SECONDS
      });
      await client.sAdd(scopeKey, descriptor.connectionKey);
      await client.expire(scopeKey, SCOPE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`[browser-bridge] registerConnection failed: ${String(error)}`);
    }
  }

  async refreshConnection(descriptor: BridgeConnectionDescriptor): Promise<void> {
    // Re-registering also re-adds the scope member in case it was evicted by TTL.
    await this.registerConnection(descriptor);
  }

  async removeConnection(
    connectionKey: string,
    workspaceId: string,
    assistantId: string
  ): Promise<void> {
    const client = await this.client();
    if (client === null) {
      return;
    }
    const scopeKey = this.scopeSetKey(workspaceId, assistantId);
    try {
      await client.del(this.connectionKey(connectionKey));
      await client.sRem(scopeKey, connectionKey);
    } catch (error) {
      this.logger.warn(`[browser-bridge] removeConnection failed: ${String(error)}`);
    }
  }

  async listScopeConnections(
    workspaceId: string,
    assistantId: string
  ): Promise<BridgeConnectionDescriptor[]> {
    const client = await this.client();
    if (client === null) {
      return [];
    }
    const scopeKey = this.scopeSetKey(workspaceId, assistantId);
    try {
      const members = await client.sMembers(scopeKey);
      const descriptors: BridgeConnectionDescriptor[] = [];
      const stale: string[] = [];
      for (const member of members) {
        const raw = await client.get(this.connectionKey(member));
        if (raw === null) {
          stale.push(member);
          continue;
        }
        const parsed = this.parseDescriptor(raw);
        if (parsed !== null) {
          descriptors.push(parsed);
        } else {
          stale.push(member);
        }
      }
      if (stale.length > 0) {
        await client.sRem(scopeKey, stale).catch(() => undefined);
      }
      return descriptors;
    } catch (error) {
      this.logger.warn(`[browser-bridge] listScopeConnections failed: ${String(error)}`);
      return [];
    }
  }

  async getConnection(connectionKey: string): Promise<BridgeConnectionDescriptor | null> {
    const client = await this.client();
    if (client === null) {
      return null;
    }
    try {
      const raw = await client.get(this.connectionKey(connectionKey));
      return raw === null ? null : this.parseDescriptor(raw);
    } catch (error) {
      this.logger.warn(`[browser-bridge] getConnection failed: ${String(error)}`);
      return null;
    }
  }

  async publishCommand(podId: string, envelope: ForwardedCommandEnvelope): Promise<boolean> {
    const client = await this.client();
    if (client === null) {
      return false;
    }
    try {
      const receivers = await client.publish(this.podChannel(podId), JSON.stringify(envelope));
      return receivers > 0;
    } catch (error) {
      this.logger.warn(`[browser-bridge] publishCommand failed: ${String(error)}`);
      return false;
    }
  }

  async putCommandState(
    commandId: string,
    state: BridgeCommandState,
    ttlSeconds: number
  ): Promise<void> {
    const client = await this.client();
    if (client === null) {
      return;
    }
    try {
      await client.set(this.commandKey(commandId), JSON.stringify(state), {
        EX: Math.max(COMMAND_STATE_MIN_TTL_SECONDS, Math.ceil(ttlSeconds))
      });
    } catch (error) {
      this.logger.warn(`[browser-bridge] putCommandState failed: ${String(error)}`);
    }
  }

  async getCommandState(commandId: string): Promise<BridgeCommandState | null> {
    const client = await this.client();
    if (client === null) {
      return null;
    }
    try {
      const raw = await client.get(this.commandKey(commandId));
      return raw === null ? null : (JSON.parse(raw) as BridgeCommandState);
    } catch (error) {
      this.logger.warn(`[browser-bridge] getCommandState failed: ${String(error)}`);
      return null;
    }
  }

  async completeCommandState(
    commandId: string,
    result: LocalBrowserResult,
    ttlSeconds: number
  ): Promise<void> {
    const existing = await this.getCommandState(commandId);
    if (existing === null) {
      return;
    }
    if (existing.status === "completed") {
      return;
    }
    await this.putCommandState(commandId, { ...existing, status: "completed", result }, ttlSeconds);
  }

  async shutdown(): Promise<void> {
    const clients = [this.subscriberClient, this.mainClient];
    this.subscriberClient = null;
    this.mainClient = null;
    this.connectPromise = null;
    for (const client of clients) {
      if (client === null) {
        continue;
      }
      try {
        await client.quit();
      } catch {
        // Best-effort shutdown only.
      }
    }
  }

  private async client(): Promise<RedisClient | null> {
    const connected = await this.ensureConnected();
    if (!connected) {
      return null;
    }
    return this.mainClient;
  }

  private parseDescriptor(raw: string): BridgeConnectionDescriptor | null {
    try {
      const parsed = JSON.parse(raw) as BridgeConnectionDescriptor;
      if (
        typeof parsed?.podId === "string" &&
        typeof parsed.connectionKey === "string" &&
        typeof parsed.assistantId === "string" &&
        typeof parsed.workspaceId === "string" &&
        typeof parsed.bridgeDeviceId === "string"
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private connectionKey(connectionKey: string): string {
    return `${KEY_PREFIX}:conn:${connectionKey}`;
  }

  private scopeSetKey(workspaceId: string, assistantId: string): string {
    return `${KEY_PREFIX}:scope:${workspaceId}::${assistantId}`;
  }

  private commandKey(commandId: string): string {
    return `${KEY_PREFIX}:cmd:${commandId}`;
  }

  private podChannel(podId: string): string {
    return `${KEY_PREFIX}:pod:${podId}`;
  }
}
