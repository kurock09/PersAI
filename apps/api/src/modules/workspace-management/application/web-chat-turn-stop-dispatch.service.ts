import { randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import { createClient } from "redis";

/**
 * ADR-149 S1 — durable cross-replica web-chat Stop dispatch.
 *
 * Replaces the process-local `WebChatTurnHardStopRegistry`. Each API pod keeps
 * the stream-owning `AbortController` locally; Redis records which pod owns a
 * turn and pub/sub delivers Stop signals to the correct replica.
 *
 * Prod truth: `PERSAI_TURN_COORDINATION_REDIS_URL` when set, otherwise
 * `BROWSER_BRIDGE_REDIS_URL` (same runtime Redis in dev/prod). When neither is
 * configured, only same-pod Stop works (local dev single process).
 */

export type TurnStopDispatchOutcome =
  | { status: "stopped" }
  | { status: "already_done" }
  | { status: "turn_not_found" }
  | { status: "forbidden" };

type StopPodMessage = {
  assistantId: string;
  clientTurnId: string;
  userId: string;
};

type OwnerRecord = {
  podId: string;
  userId: string;
};

interface RegisteredTurn {
  controller: AbortController;
  userId: string;
  assistantId: string;
  clientTurnId: string;
  registeredAt: number;
  userStopped: boolean;
}

type RedisClient = ReturnType<typeof createClient>;

const KEY_PREFIX = "turn-stop";
const OWNER_TTL_SECONDS = 3600;

function buildTurnKey(assistantId: string, clientTurnId: string): string {
  return `${assistantId}:${clientTurnId}`;
}

@Injectable()
export class WebChatTurnStopDispatchService implements OnModuleDestroy {
  private readonly logger = new Logger(WebChatTurnStopDispatchService.name);
  private readonly redisUrl: string | undefined;
  readonly podId = randomUUID();

  private mainClient: RedisClient | null = null;
  private subscriberClient: RedisClient | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly localTurns = new Map<string, RegisteredTurn>();
  private readonly userStoppedTurns = new Set<string>();

  constructor() {
    let url: string | undefined;
    try {
      const config = loadApiConfig(process.env);
      url = config.PERSAI_TURN_COORDINATION_REDIS_URL ?? config.BROWSER_BRIDGE_REDIS_URL;
    } catch {
      url = undefined;
    }
    this.redisUrl = url?.trim() ? url.trim() : undefined;
  }

  isRedisEnabled(): boolean {
    return this.redisUrl !== undefined;
  }

  register(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
    controller: AbortController;
  }): void {
    const key = buildTurnKey(input.assistantId, input.clientTurnId);
    const existing = this.localTurns.get(key);
    if (existing !== undefined) {
      this.logger.warn(
        `[turn-stop-dispatch] reregister assistantId=${input.assistantId} clientTurnId=${input.clientTurnId} userId=${input.userId}`
      );
    }
    this.localTurns.set(key, {
      controller: input.controller,
      userId: input.userId,
      assistantId: input.assistantId,
      clientTurnId: input.clientTurnId,
      registeredAt: Date.now(),
      userStopped: false
    });
    void this.publishOwnerRecord(input).catch((error: unknown) => {
      this.logger.warn(`[turn-stop-dispatch] owner publish failed: ${String(error)}`);
    });
  }

  release(input: { assistantId: string; clientTurnId: string; controller: AbortController }): void {
    const key = buildTurnKey(input.assistantId, input.clientTurnId);
    const existing = this.localTurns.get(key);
    if (existing === undefined || existing.controller !== input.controller) {
      return;
    }
    this.localTurns.delete(key);
    this.userStoppedTurns.delete(key);
    void this.removeOwnerRecord(input.assistantId, input.clientTurnId).catch((error: unknown) => {
      this.logger.warn(`[turn-stop-dispatch] owner remove failed: ${String(error)}`);
    });
  }

  wasUserStopped(assistantId: string, clientTurnId: string): boolean {
    return this.userStoppedTurns.has(buildTurnKey(assistantId, clientTurnId));
  }

  async dispatchStop(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
    attemptStatus?: string | null;
  }): Promise<TurnStopDispatchOutcome> {
    if (
      input.attemptStatus === "completed" ||
      input.attemptStatus === "failed" ||
      input.attemptStatus === "interrupted"
    ) {
      return { status: "already_done" };
    }

    const owner = await this.readOwnerRecord(input.assistantId, input.clientTurnId);
    if (owner !== null && owner.userId !== input.userId) {
      this.logger.warn(
        `[turn-stop-dispatch] cross-user stop refused assistantId=${input.assistantId} clientTurnId=${input.clientTurnId} attemptedBy=${input.userId}`
      );
      return { status: "forbidden" };
    }

    const localKey = buildTurnKey(input.assistantId, input.clientTurnId);
    const localEntry = this.localTurns.get(localKey);
    const inflightAttempt = input.attemptStatus === "accepted" || input.attemptStatus === "running";
    const hasLocalOwner = localEntry !== undefined;
    const hasRemoteOwner = owner !== null;

    if (!hasLocalOwner && !hasRemoteOwner && !inflightAttempt) {
      return { status: "turn_not_found" };
    }
    // Note: inflightAttempt without a reachable owner falls through to turn_not_found
    // after the remote publish attempt below — never return stopped without abort.

    if (hasLocalOwner && localEntry.userId !== input.userId) {
      return { status: "forbidden" };
    }

    if (hasLocalOwner) {
      this.signalLocalStop(localEntry);
      return { status: "stopped" };
    }

    if (owner !== null) {
      const published = await this.publishStopToPod(owner.podId, {
        assistantId: input.assistantId,
        clientTurnId: input.clientTurnId,
        userId: input.userId
      });
      if (published) {
        return { status: "stopped" };
      }
    }

    // Inflight DB attempt without a live local owner or pub/sub delivery is not a
    // proven abort. Returning stopped here previously lied to the client while the
    // turn kept running on another replica (or after owner key expiry).
    return { status: "turn_not_found" };
  }

  hasLocalTurnForTesting(assistantId: string, clientTurnId: string): boolean {
    return this.localTurns.has(buildTurnKey(assistantId, clientTurnId));
  }

  async hasActiveOwner(assistantId: string, clientTurnId: string): Promise<boolean> {
    if (this.localTurns.has(buildTurnKey(assistantId, clientTurnId))) {
      return true;
    }
    const owner = await this.readOwnerRecord(assistantId, clientTurnId);
    return owner !== null;
  }

  async onModuleDestroy(): Promise<void> {
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

  private signalLocalStop(entry: RegisteredTurn): void {
    const key = buildTurnKey(entry.assistantId, entry.clientTurnId);
    entry.userStopped = true;
    this.userStoppedTurns.add(key);
    entry.controller.abort();
    this.localTurns.delete(key);
    void this.removeOwnerRecord(entry.assistantId, entry.clientTurnId).catch(() => undefined);
  }

  private handlePodMessage(message: string): void {
    let payload: StopPodMessage;
    try {
      payload = JSON.parse(message) as StopPodMessage;
    } catch (error) {
      this.logger.warn(`[turn-stop-dispatch] dropped malformed pod message: ${String(error)}`);
      return;
    }
    if (
      typeof payload.assistantId !== "string" ||
      typeof payload.clientTurnId !== "string" ||
      typeof payload.userId !== "string"
    ) {
      return;
    }
    const entry = this.localTurns.get(buildTurnKey(payload.assistantId, payload.clientTurnId));
    if (entry === undefined) {
      return;
    }
    if (entry.userId !== payload.userId) {
      this.logger.warn(
        `[turn-stop-dispatch] cross-user pod stop refused assistantId=${payload.assistantId} clientTurnId=${payload.clientTurnId}`
      );
      return;
    }
    this.signalLocalStop(entry);
  }

  private async ensureConnected(): Promise<boolean> {
    if (!this.isRedisEnabled()) {
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
      this.logger.warn(`[turn-stop-dispatch] redis connect failed: ${String(error)}`);
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
      this.logger.warn(`[turn-stop-dispatch] redis main client error: ${String(error)}`);
    });
    await main.connect();

    const subscriber = main.duplicate();
    subscriber.on("error", (error) => {
      this.logger.warn(`[turn-stop-dispatch] redis subscriber client error: ${String(error)}`);
    });
    await subscriber.connect();
    await subscriber.subscribe(this.podChannel(this.podId), (message) => {
      this.handlePodMessage(message);
    });

    this.mainClient = main;
    this.subscriberClient = subscriber;
    this.logger.log(`[turn-stop-dispatch] coordinator connected pod=${this.podId}`);
  }

  private async client(): Promise<RedisClient | null> {
    const connected = await this.ensureConnected();
    if (!connected) {
      return null;
    }
    return this.mainClient;
  }

  private async publishOwnerRecord(input: {
    assistantId: string;
    clientTurnId: string;
    userId: string;
  }): Promise<void> {
    const client = await this.client();
    if (client === null) {
      return;
    }
    const record: OwnerRecord = { podId: this.podId, userId: input.userId };
    await client.set(this.ownerKey(input.assistantId, input.clientTurnId), JSON.stringify(record), {
      EX: OWNER_TTL_SECONDS
    });
  }

  private async removeOwnerRecord(assistantId: string, clientTurnId: string): Promise<void> {
    const client = await this.client();
    if (client === null) {
      return;
    }
    const key = this.ownerKey(assistantId, clientTurnId);
    const raw = await client.get(key);
    if (raw === null) {
      return;
    }
    const parsed = this.parseOwnerRecord(raw);
    if (parsed?.podId === this.podId) {
      await client.del(key);
    }
  }

  private async readOwnerRecord(
    assistantId: string,
    clientTurnId: string
  ): Promise<OwnerRecord | null> {
    const client = await this.client();
    if (client === null) {
      return null;
    }
    const raw = await client.get(this.ownerKey(assistantId, clientTurnId));
    return raw === null ? null : this.parseOwnerRecord(raw);
  }

  private async publishStopToPod(podId: string, message: StopPodMessage): Promise<boolean> {
    const client = await this.client();
    if (client === null) {
      return false;
    }
    try {
      const receivers = await client.publish(this.podChannel(podId), JSON.stringify(message));
      return receivers > 0;
    } catch (error) {
      this.logger.warn(`[turn-stop-dispatch] publishStopToPod failed: ${String(error)}`);
      return false;
    }
  }

  private parseOwnerRecord(raw: string): OwnerRecord | null {
    try {
      const parsed = JSON.parse(raw) as OwnerRecord;
      if (typeof parsed?.podId === "string" && typeof parsed?.userId === "string") {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private ownerKey(assistantId: string, clientTurnId: string): string {
    return `${KEY_PREFIX}:owner:${assistantId}:${clientTurnId}`;
  }

  private podChannel(podId: string): string {
    return `${KEY_PREFIX}:pod:${podId}`;
  }
}
