import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import type { RuntimeBundleRef, RuntimeConversationAddress } from "@persai/runtime-contract";
import { createClient } from "redis";
import { RUNTIME_CONFIG } from "../../../../runtime-config";
import { RuntimeStateKeyspaceService } from "../../runtime-state-keyspace.service";

interface StateRedisClient {
  connect(): Promise<void>;
  quit(): Promise<void>;
  eval(
    script: string,
    options: {
      keys: string[];
      arguments: string[];
    }
  ): Promise<number>;
  set(
    key: string,
    value: string,
    options?: {
      EX?: number;
      NX?: boolean;
    }
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  sAdd(key: string, members: string | string[]): Promise<number>;
  sMembers(key: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<number>;
}

@Injectable()
export class RuntimeStateRedisService implements OnModuleDestroy {
  private clientPromise: Promise<StateRedisClient> | null = null;

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    private readonly keyspace: RuntimeStateKeyspaceService
  ) {}

  async setConversationSessionPointer(
    address: RuntimeConversationAddress,
    sessionId: string
  ): Promise<void> {
    const client = await this.getClient();
    await client.set(this.keyspace.buildConversationSessionPointerKey(address), sessionId, {
      EX: this.config.RUNTIME_SESSION_LEASE_TTL_SECONDS
    });
  }

  async getConversationSessionPointer(address: RuntimeConversationAddress): Promise<string | null> {
    const client = await this.getClient();
    return client.get(this.keyspace.buildConversationSessionPointerKey(address));
  }

  async clearConversationSessionPointer(address: RuntimeConversationAddress): Promise<void> {
    const client = await this.getClient();
    await client.del(this.keyspace.buildConversationSessionPointerKey(address));
  }

  async tryAcquireSessionLease(sessionId: string, ownerToken: string): Promise<boolean> {
    const client = await this.getClient();
    const result = await client.set(this.keyspace.buildSessionLeaseKey(sessionId), ownerToken, {
      EX: this.config.RUNTIME_SESSION_LEASE_TTL_SECONDS,
      NX: true
    });
    return result === "OK";
  }

  async renewSessionLease(sessionId: string, ownerToken: string): Promise<boolean> {
    const client = await this.getClient();
    const leaseKey = this.keyspace.buildSessionLeaseKey(sessionId);
    const renewed = await client.eval(
      [
        'if redis.call("GET", KEYS[1]) == ARGV[1] then',
        '  return redis.call("EXPIRE", KEYS[1], tonumber(ARGV[2]))',
        "end",
        "return 0"
      ].join("\n"),
      {
        keys: [leaseKey],
        arguments: [ownerToken, this.config.RUNTIME_SESSION_LEASE_TTL_SECONDS.toString()]
      }
    );

    return renewed === 1;
  }

  async hasSessionLease(sessionId: string): Promise<boolean> {
    const client = await this.getClient();
    const leaseKey = this.keyspace.buildSessionLeaseKey(sessionId);
    const raw = await client.get(leaseKey);
    return raw !== null;
  }

  async claimAcceptedTurnInFlight(input: {
    sessionId: string;
    ownerToken: string;
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
    requestId: string;
  }): Promise<"acquired" | "busy" | "in_flight"> {
    const client = await this.getClient();
    const leaseKey = this.keyspace.buildSessionLeaseKey(input.sessionId);
    const inFlightKey = this.keyspace.buildTurnInFlightKey({
      conversation: input.conversation,
      idempotencyKey: input.idempotencyKey
    });

    const claimed = await client.eval(
      [
        'if redis.call("GET", KEYS[2]) ~= false then',
        "  return 1",
        "end",
        'if redis.call("SET", KEYS[1], ARGV[1], "EX", tonumber(ARGV[3]), "NX") then',
        '  redis.call("SET", KEYS[2], ARGV[2], "EX", tonumber(ARGV[3]))',
        "  return 2",
        "end",
        "return 0"
      ].join("\n"),
      {
        keys: [leaseKey, inFlightKey],
        arguments: [
          input.ownerToken,
          input.requestId,
          this.config.RUNTIME_SESSION_LEASE_TTL_SECONDS.toString()
        ]
      }
    );

    if (claimed === 2) {
      return "acquired";
    }
    if (claimed === 1) {
      return "in_flight";
    }
    return "busy";
  }

  async releaseSessionLease(sessionId: string, ownerToken: string): Promise<boolean> {
    const client = await this.getClient();
    const leaseKey = this.keyspace.buildSessionLeaseKey(sessionId);
    const currentOwner = await client.get(leaseKey);
    if (currentOwner !== ownerToken) {
      return false;
    }

    const deleted = await client.del(leaseKey);
    return deleted > 0;
  }

  async readTurnInFlightMarker(input: {
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
  }): Promise<string | null> {
    const client = await this.getClient();
    return client.get(
      this.keyspace.buildTurnInFlightKey({
        conversation: input.conversation,
        idempotencyKey: input.idempotencyKey
      })
    );
  }

  async clearTurnInFlightMarker(input: {
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
  }): Promise<void> {
    const client = await this.getClient();
    await client.del(
      this.keyspace.buildTurnInFlightKey({
        conversation: input.conversation,
        idempotencyKey: input.idempotencyKey
      })
    );
  }

  async writeTurnReceiptMarker(input: {
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
    requestId: string;
  }): Promise<void> {
    const client = await this.getClient();
    await client.set(
      this.keyspace.buildTurnReceiptKey({
        conversation: input.conversation,
        idempotencyKey: input.idempotencyKey
      }),
      input.requestId,
      {
        EX: this.config.RUNTIME_TURN_RECEIPT_TTL_SECONDS
      }
    );
  }

  async readTurnReceiptMarker(input: {
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
  }): Promise<string | null> {
    const client = await this.getClient();
    return client.get(
      this.keyspace.buildTurnReceiptKey({
        conversation: input.conversation,
        idempotencyKey: input.idempotencyKey
      })
    );
  }

  async markBundleWarm(bundle: RuntimeBundleRef): Promise<void> {
    const client = await this.getClient();
    const markerKey = this.keyspace.buildBundleMarkerKey(bundle);
    await client.set(markerKey, bundle.bundleHash, {
      EX: this.config.RUNTIME_BUNDLE_MARKER_TTL_SECONDS
    });

    const setKey = this.keyspace.buildAssistantBundleMarkerSetKey(bundle.assistantId);
    await client.sAdd(
      setKey,
      this.encodeAssistantBundleMarkerMember(bundle.publishedVersionId, markerKey)
    );
    await client.expire(setKey, this.config.RUNTIME_BUNDLE_MARKER_TTL_SECONDS);
  }

  async isBundleWarm(bundle: RuntimeBundleRef): Promise<boolean> {
    const client = await this.getClient();
    return (await client.get(this.keyspace.buildBundleMarkerKey(bundle))) !== null;
  }

  async invalidateBundleMarkers(input: {
    assistantId: string;
    publishedVersionId?: string;
  }): Promise<number> {
    const client = await this.getClient();
    const setKey = this.keyspace.buildAssistantBundleMarkerSetKey(input.assistantId);
    const members = await client.sMembers(setKey);
    if (members.length === 0) {
      return 0;
    }

    const survivors: string[] = [];
    let invalidatedCount = 0;

    for (const member of members) {
      const decoded = this.decodeAssistantBundleMarkerMember(member);
      const shouldInvalidate =
        input.publishedVersionId === undefined ||
        decoded.publishedVersionId === input.publishedVersionId;
      if (!shouldInvalidate) {
        survivors.push(member);
        continue;
      }

      const deleted = await client.del(decoded.markerKey);
      if (deleted > 0) {
        invalidatedCount += 1;
      }
    }

    await client.del(setKey);
    if (survivors.length > 0) {
      await client.sAdd(setKey, survivors);
      await client.expire(setKey, this.config.RUNTIME_BUNDLE_MARKER_TTL_SECONDS);
    }

    return invalidatedCount;
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.clientPromise ? await this.clientPromise : null;
    if (client) {
      await client.quit();
    }
  }

  protected async getClient(): Promise<StateRedisClient> {
    if (this.clientPromise) {
      return this.clientPromise;
    }

    const rawClient = createClient({
      url: this.config.RUNTIME_STATE_REDIS_URL
    });
    rawClient.on("error", () => {
      // Runtime-state callers handle failures at the operation boundary.
    });

    this.clientPromise = rawClient
      .connect()
      .then(() => rawClient as unknown as StateRedisClient)
      .catch((error: unknown) => {
        this.clientPromise = null;
        throw error;
      });

    return this.clientPromise;
  }

  private encodeAssistantBundleMarkerMember(publishedVersionId: string, markerKey: string): string {
    return `${publishedVersionId}|${markerKey}`;
  }

  private decodeAssistantBundleMarkerMember(value: string): {
    publishedVersionId: string;
    markerKey: string;
  } {
    const separatorIndex = value.indexOf("|");
    if (separatorIndex < 0) {
      return {
        publishedVersionId: "",
        markerKey: value
      };
    }

    return {
      publishedVersionId: value.slice(0, separatorIndex),
      markerKey: value.slice(separatorIndex + 1)
    };
  }
}
