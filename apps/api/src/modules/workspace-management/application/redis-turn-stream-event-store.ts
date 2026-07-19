import { Logger } from "@nestjs/common";
import { createClient } from "redis";
import {
  isTurnStreamTerminalEvent,
  type TurnStreamEnvelope,
  type TurnStreamEventStore,
  type TurnStreamMeta
} from "./turn-stream-event-store";

type RedisClient = ReturnType<typeof createClient>;

const KEY_PREFIX = "turn-stream";
const BUFFER_TTL_SECONDS = 3600;
const RELEASE_GRACE_SECONDS = 30;

/**
 * Atomically: validate meta userId, INCR seq, RPUSH envelope, refresh TTL,
 * optionally mark terminal. Returns envelope JSON or false when turn missing /
 * wrong user.
 */
const APPEND_LUA = `
local metaRaw = redis.call('GET', KEYS[1])
if not metaRaw then
  return false
end
local meta = cjson.decode(metaRaw)
if meta['userId'] ~= ARGV[1] then
  return false
end
local seq = redis.call('INCR', KEYS[3])
local envelope = '{"seq":' .. seq .. ',"event":' .. ARGV[2] .. ',"payload":' .. ARGV[3] .. ',"userId":' .. ARGV[6] .. '}'
redis.call('RPUSH', KEYS[2], envelope)
local ttl = tonumber(ARGV[5])
if ARGV[4] == '1' then
  meta['terminalPublished'] = true
  redis.call('SET', KEYS[1], cjson.encode(meta), 'EX', ttl)
else
  redis.call('EXPIRE', KEYS[1], ttl)
end
redis.call('EXPIRE', KEYS[2], ttl)
redis.call('EXPIRE', KEYS[3], ttl)
return envelope
`;

type StoredMeta = {
  userId: string;
  terminalPublished: boolean;
};

/**
 * Redis LIST + pub/sub turn-stream store (ADR-158).
 * Same URL family as Stop: injected by the Nest factory.
 */
export class RedisTurnStreamEventStore implements TurnStreamEventStore {
  private readonly logger = new Logger(RedisTurnStreamEventStore.name);
  private mainClient: RedisClient | null = null;
  private subscriberClient: RedisClient | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly channelListeners = new Map<
    string,
    Set<(envelope: TurnStreamEnvelope) => void>
  >();

  constructor(private readonly redisUrl: string) {}

  async registerTurn(input: { turnKey: string; userId: string }): Promise<void> {
    const client = await this.client();
    if (client === null) {
      return;
    }
    const existing = await this.getMeta(input.turnKey);
    if (existing !== null && existing.userId !== input.userId) {
      this.logger.warn(
        `[turn-stream-redis] registerTurn refuse overwrite turnKey=${input.turnKey} existingUserId=${existing.userId} requestedUserId=${input.userId}`
      );
      return;
    }
    const eventsKey = this.eventsKey(input.turnKey);
    const metaKey = this.metaKey(input.turnKey);
    const seqKey = this.seqKey(input.turnKey);
    const meta: StoredMeta = {
      userId: input.userId,
      terminalPublished: false
    };
    await client.del([eventsKey, seqKey]);
    await client.set(metaKey, JSON.stringify(meta), { EX: BUFFER_TTL_SECONDS });
  }

  async append(input: {
    turnKey: string;
    userId: string;
    event: string;
    payload: unknown;
  }): Promise<TurnStreamEnvelope | null> {
    const client = await this.client();
    if (client === null) {
      return null;
    }
    const result = await client.eval(APPEND_LUA, {
      keys: [
        this.metaKey(input.turnKey),
        this.eventsKey(input.turnKey),
        this.seqKey(input.turnKey)
      ],
      arguments: [
        input.userId,
        JSON.stringify(input.event),
        JSON.stringify(input.payload),
        isTurnStreamTerminalEvent(input.event) ? "1" : "0",
        String(BUFFER_TTL_SECONDS),
        JSON.stringify(input.userId)
      ]
    });
    if (result === false || result === null || typeof result !== "string") {
      return null;
    }
    const envelope = this.parseEnvelope(result);
    if (envelope === null) {
      return null;
    }
    try {
      await client.publish(this.notifyChannel(input.turnKey), result);
    } catch (error) {
      this.logger.warn(`[turn-stream-redis] notify publish failed: ${String(error)}`);
    }
    return envelope;
  }

  async listFrom(turnKey: string, fromSeq?: number): Promise<TurnStreamEnvelope[]> {
    const client = await this.client();
    if (client === null) {
      return [];
    }
    const raw = await client.lRange(this.eventsKey(turnKey), 0, -1);
    const minSeq = fromSeq ?? 0;
    const out: TurnStreamEnvelope[] = [];
    for (const item of raw) {
      const envelope = this.parseEnvelope(item);
      if (envelope !== null && envelope.seq > minSeq) {
        out.push(envelope);
      }
    }
    return out;
  }

  async getMeta(turnKey: string): Promise<TurnStreamMeta | null> {
    const client = await this.client();
    if (client === null) {
      return null;
    }
    const raw = await client.get(this.metaKey(turnKey));
    if (raw === null) {
      return null;
    }
    const meta = this.parseMeta(raw);
    if (meta === null) {
      return null;
    }
    return {
      userId: meta.userId,
      terminalPublished: meta.terminalPublished
    };
  }

  async subscribe(
    turnKey: string,
    onEvent: (envelope: TurnStreamEnvelope) => void
  ): Promise<() => void> {
    const connected = await this.ensureConnected();
    if (!connected || this.subscriberClient === null) {
      return () => undefined;
    }
    const channel = this.notifyChannel(turnKey);
    let set = this.channelListeners.get(channel);
    const needsSubscribe = set === undefined || set.size === 0;
    if (set === undefined) {
      set = new Set();
      this.channelListeners.set(channel, set);
    }
    set.add(onEvent);
    if (needsSubscribe) {
      await this.subscriberClient.subscribe(channel, (message) => {
        this.dispatchChannelMessage(channel, message);
      });
    }
    return () => {
      void this.unsubscribeListener(channel, onEvent);
    };
  }

  async release(turnKey: string, _options?: { shortGrace?: boolean }): Promise<void> {
    const client = await this.client();
    if (client === null) {
      return;
    }
    // Always short grace — never hard-DEL undrained events after a registered turn.
    const eventsKey = this.eventsKey(turnKey);
    const metaKey = this.metaKey(turnKey);
    const seqKey = this.seqKey(turnKey);
    await client.expire(eventsKey, RELEASE_GRACE_SECONDS);
    await client.expire(metaKey, RELEASE_GRACE_SECONDS);
    await client.expire(seqKey, RELEASE_GRACE_SECONDS);
  }

  async exists(turnKey: string): Promise<boolean> {
    const client = await this.client();
    if (client === null) {
      throw new Error("turn-stream redis unavailable");
    }
    const count = await client.exists(this.metaKey(turnKey));
    return count > 0;
  }

  async touch(turnKey: string): Promise<void> {
    const client = await this.client();
    if (client === null) {
      return;
    }
    await client.expire(this.eventsKey(turnKey), BUFFER_TTL_SECONDS);
    await client.expire(this.metaKey(turnKey), BUFFER_TTL_SECONDS);
    await client.expire(this.seqKey(turnKey), BUFFER_TTL_SECONDS);
  }

  async destroy(): Promise<void> {
    const clients = [this.subscriberClient, this.mainClient];
    this.subscriberClient = null;
    this.mainClient = null;
    this.connectPromise = null;
    this.channelListeners.clear();
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

  private dispatchChannelMessage(channel: string, message: string): void {
    const envelope = this.parseEnvelope(message);
    if (envelope === null) {
      return;
    }
    const listeners = this.channelListeners.get(channel);
    if (listeners === undefined) {
      return;
    }
    for (const listener of listeners) {
      listener(envelope);
    }
  }

  private async unsubscribeListener(
    channel: string,
    onEvent: (envelope: TurnStreamEnvelope) => void
  ): Promise<void> {
    const set = this.channelListeners.get(channel);
    if (set === undefined) {
      return;
    }
    set.delete(onEvent);
    if (set.size > 0) {
      return;
    }
    this.channelListeners.delete(channel);
    if (this.subscriberClient !== null) {
      try {
        await this.subscriberClient.unsubscribe(channel);
      } catch {
        // Best-effort unsubscribe.
      }
    }
  }

  private async ensureConnected(): Promise<boolean> {
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
      this.logger.warn(`[turn-stream-redis] connect failed: ${String(error)}`);
      return false;
    }
  }

  private async connect(): Promise<void> {
    const main = createClient({ url: this.redisUrl });
    main.on("error", (error) => {
      this.logger.warn(`[turn-stream-redis] main client error: ${String(error)}`);
    });
    await main.connect();

    const subscriber = main.duplicate();
    subscriber.on("error", (error) => {
      this.logger.warn(`[turn-stream-redis] subscriber client error: ${String(error)}`);
    });
    await subscriber.connect();

    this.mainClient = main;
    this.subscriberClient = subscriber;
    this.logger.log("[turn-stream-redis] coordinator connected");
  }

  private async client(): Promise<RedisClient | null> {
    const connected = await this.ensureConnected();
    if (!connected) {
      return null;
    }
    return this.mainClient;
  }

  private parseMeta(raw: string): StoredMeta | null {
    try {
      const parsed = JSON.parse(raw) as StoredMeta;
      if (typeof parsed?.userId === "string" && typeof parsed?.terminalPublished === "boolean") {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private parseEnvelope(raw: string): TurnStreamEnvelope | null {
    try {
      const parsed = JSON.parse(raw) as TurnStreamEnvelope;
      if (typeof parsed?.seq === "number" && typeof parsed?.event === "string") {
        const envelope: TurnStreamEnvelope = {
          seq: parsed.seq,
          event: parsed.event,
          payload: parsed.payload
        };
        if (typeof parsed.userId === "string") {
          envelope.userId = parsed.userId;
        }
        return envelope;
      }
      return null;
    } catch {
      return null;
    }
  }

  private eventsKey(turnKey: string): string {
    return `${KEY_PREFIX}:events:${turnKey}`;
  }

  private metaKey(turnKey: string): string {
    return `${KEY_PREFIX}:meta:${turnKey}`;
  }

  private seqKey(turnKey: string): string {
    return `${KEY_PREFIX}:seq:${turnKey}`;
  }

  private notifyChannel(turnKey: string): string {
    return `${KEY_PREFIX}:notify:${turnKey}`;
  }
}
