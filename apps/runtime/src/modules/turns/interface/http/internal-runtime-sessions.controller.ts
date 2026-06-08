import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import {
  PERSAI_RUNTIME_CHANNELS,
  PERSAI_RUNTIME_CONVERSATION_MODES,
  PERSAI_RUNTIME_TIERS,
  type PersaiRuntimeChannel,
  type PersaiRuntimeConversationMode,
  type PersaiRuntimeTier,
  type RuntimeCompactionRequest,
  type RuntimeCompactionResult
} from "@persai/runtime-contract";
import { RUNTIME_CONFIG } from "../../../../runtime-config";
import {
  type RuntimeIdleSessionMemoryExtractionResult,
  SessionCompactionService
} from "../../session-compaction.service";
import {
  assertRuntimeInternalApiAuthorized,
  type RuntimeInternalRequestLike
} from "./assert-runtime-internal-auth";

interface InternalCompactAndExtractInputShape {
  runtimeTier: PersaiRuntimeTier;
  conversation: {
    assistantId: string;
    workspaceId: string;
    channel: PersaiRuntimeChannel;
    externalThreadKey: string;
    externalUserKey: string | null;
    mode: PersaiRuntimeConversationMode;
  };
  enqueuedRequestId: string | null;
}

@Controller("api/v1/internal/runtime/sessions")
export class InternalRuntimeSessionsController {
  constructor(
    private readonly sessionCompactionService: SessionCompactionService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}

  @HttpCode(200)
  @Post("compact-and-extract")
  async compactAndExtract(
    @Req() req: RuntimeInternalRequestLike,
    @Body() body: unknown
  ): Promise<RuntimeCompactionResult> {
    this.assertAuthorized(req);
    const input = this.parseInput(body);
    const request: RuntimeCompactionRequest & {
      trigger: "auto_compaction";
      runtimeRequestId: string | null;
      autoExtract: true;
    } = {
      runtimeTier: input.runtimeTier,
      conversation: input.conversation,
      instructions: null,
      trigger: "auto_compaction",
      runtimeRequestId: input.enqueuedRequestId,
      autoExtract: true
    };
    return this.sessionCompactionService.compactSession(request);
  }

  @HttpCode(200)
  @Post("idle-extract")
  async idleExtract(
    @Req() req: RuntimeInternalRequestLike,
    @Body() body: unknown
  ): Promise<RuntimeIdleSessionMemoryExtractionResult> {
    this.assertAuthorized(req);
    const input = this.parseInput(body);
    return this.sessionCompactionService.extractIdleSessionMemory({
      runtimeTier: input.runtimeTier,
      conversation: input.conversation,
      instructions: null,
      runtimeRequestId: input.enqueuedRequestId
    });
  }

  private assertAuthorized(req: RuntimeInternalRequestLike): void {
    assertRuntimeInternalApiAuthorized(
      req,
      this.config,
      "PERSAI_INTERNAL_API_TOKEN must be configured for runtime internal endpoints.",
      "Internal runtime authorization failed."
    );
  }

  private parseInput(body: unknown): InternalCompactAndExtractInputShape {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new BadRequestException("Compact-and-extract request must be a JSON object.");
    }
    const row = body as Record<string, unknown>;
    const runtimeTier = this.asTier(row.runtimeTier);
    const conversationRaw = row.conversation;
    const conversation = this.parseConversation(conversationRaw);
    const enqueuedRequestId = this.asNullableString(row.enqueuedRequestId);
    if (runtimeTier === null) {
      throw new BadRequestException("runtimeTier is invalid.");
    }
    if (conversation === null) {
      throw new BadRequestException("conversation is invalid.");
    }
    return {
      runtimeTier,
      conversation,
      enqueuedRequestId
    };
  }

  private parseConversation(
    value: unknown
  ): InternalCompactAndExtractInputShape["conversation"] | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const assistantId = this.asNonEmpty(row.assistantId);
    const workspaceId = this.asNonEmpty(row.workspaceId);
    const channel = this.asChannel(row.channel);
    const externalThreadKey = this.asNonEmpty(row.externalThreadKey);
    const externalUserKey = this.asNullableString(row.externalUserKey);
    const mode = this.asMode(row.mode) ?? "direct";
    if (
      assistantId === null ||
      workspaceId === null ||
      channel === null ||
      externalThreadKey === null
    ) {
      return null;
    }
    return { assistantId, workspaceId, channel, externalThreadKey, externalUserKey, mode };
  }

  private asTier(value: unknown): PersaiRuntimeTier | null {
    return typeof value === "string" && (PERSAI_RUNTIME_TIERS as readonly string[]).includes(value)
      ? (value as PersaiRuntimeTier)
      : null;
  }

  private asChannel(value: unknown): PersaiRuntimeChannel | null {
    return typeof value === "string" &&
      (PERSAI_RUNTIME_CHANNELS as readonly string[]).includes(value)
      ? (value as PersaiRuntimeChannel)
      : null;
  }

  private asMode(value: unknown): PersaiRuntimeConversationMode | null {
    return typeof value === "string" &&
      (PERSAI_RUNTIME_CONVERSATION_MODES as readonly string[]).includes(value)
      ? (value as PersaiRuntimeConversationMode)
      : null;
  }

  private asNonEmpty(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asNullableString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return this.asNonEmpty(value);
  }
}
