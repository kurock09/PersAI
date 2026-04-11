import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import type { RuntimeBundleRef, RuntimeConversationAddress } from "@persai/runtime-contract";
import { RUNTIME_CONFIG } from "../../runtime-config";

export interface RuntimeStateKeyspacePolicySnapshot {
  redisKeyPrefix: string;
  sessionLeaseTtlSeconds: number;
  turnInFlightTtlSeconds: number;
  turnReceiptTtlSeconds: number;
  bundleMarkerTtlSeconds: number;
}

@Injectable()
export class RuntimeStateKeyspaceService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  createConversationKey(address: RuntimeConversationAddress): string {
    return this.hashParts([
      "conversation",
      address.assistantId,
      address.workspaceId,
      address.channel,
      address.externalThreadKey,
      address.externalUserKey ?? "",
      address.mode
    ]);
  }

  buildConversationSessionPointerKey(address: RuntimeConversationAddress): string {
    return this.buildKey("conversation", this.createConversationKey(address), "session");
  }

  buildSessionLeaseKey(sessionId: string): string {
    return this.buildKey("session", sessionId, "lease");
  }

  buildTurnReceiptKey(input: {
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
  }): string {
    return this.buildTurnReceiptKeyFromConversationKey(
      this.createConversationKey(input.conversation),
      input.idempotencyKey
    );
  }

  buildTurnReceiptKeyFromConversationKey(conversationKey: string, idempotencyKey: string): string {
    return this.buildKey(
      "turn_receipt",
      this.hashParts(["turn_receipt", conversationKey, idempotencyKey])
    );
  }

  buildTurnInFlightKey(input: {
    conversation: RuntimeConversationAddress;
    idempotencyKey: string;
  }): string {
    return this.buildTurnInFlightKeyFromConversationKey(
      this.createConversationKey(input.conversation),
      input.idempotencyKey
    );
  }

  buildTurnInFlightKeyFromConversationKey(conversationKey: string, idempotencyKey: string): string {
    return this.buildKey(
      "turn_inflight",
      this.hashParts(["turn_inflight", conversationKey, idempotencyKey])
    );
  }

  buildBundleMarkerKey(bundle: RuntimeBundleRef): string {
    return this.buildKey(
      "bundle_marker",
      this.hashParts([
        "bundle_marker",
        bundle.assistantId,
        bundle.workspaceId,
        bundle.publishedVersionId,
        bundle.bundleHash
      ])
    );
  }

  buildAssistantBundleMarkerSetKey(assistantId: string): string {
    return this.buildKey("assistant", assistantId, "bundle_markers");
  }

  getPolicySnapshot(): RuntimeStateKeyspacePolicySnapshot {
    return {
      redisKeyPrefix: this.config.RUNTIME_STATE_REDIS_KEY_PREFIX,
      sessionLeaseTtlSeconds: this.config.RUNTIME_SESSION_LEASE_TTL_SECONDS,
      turnInFlightTtlSeconds: this.config.RUNTIME_SESSION_LEASE_TTL_SECONDS,
      turnReceiptTtlSeconds: this.config.RUNTIME_TURN_RECEIPT_TTL_SECONDS,
      bundleMarkerTtlSeconds: this.config.RUNTIME_BUNDLE_MARKER_TTL_SECONDS
    };
  }

  private buildKey(...segments: string[]): string {
    return [this.config.RUNTIME_STATE_REDIS_KEY_PREFIX, ...segments].join(":");
  }

  private hashParts(parts: readonly string[]): string {
    return createHash("sha256")
      .update(JSON.stringify(parts))
      .digest("hex");
  }
}
