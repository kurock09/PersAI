import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PersaiRuntimeChannel, PersaiRuntimeTier } from "@persai/runtime-contract";
import { PERSAI_RUNTIME_TIERS } from "@persai/runtime-contract";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type EnqueueBackgroundCompactionTrigger = "post_turn" | "manual";

export interface EnqueueBackgroundCompactionJobInput {
  assistantId: string;
  workspaceId: string;
  channel: PersaiRuntimeChannel;
  externalThreadKey: string;
  externalUserKey: string | null;
  runtimeTier: PersaiRuntimeTier;
  trigger: EnqueueBackgroundCompactionTrigger;
  enqueuedRequestId: string | null;
}

export interface EnqueueBackgroundCompactionJobOutcome {
  enqueued: boolean;
  jobId: string | null;
  // ADR-074 Slice M2 — when `enqueued === false` and `superseded === true`,
  // an existing pending job already covers this `(assistant, channel, thread)`
  // triple and absorbed this request without creating a new row. The scheduler
  // will pick it up using the latest data because it always reads the
  // synopsis live at execution time.
  superseded: boolean;
}

@Injectable()
export class EnqueueBackgroundCompactionJobService {
  private readonly logger = new Logger(EnqueueBackgroundCompactionJobService.name);

  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  parseInput(payload: unknown): EnqueueBackgroundCompactionJobInput {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Background compaction enqueue payload must be an object.");
    }
    const row = payload as Record<string, unknown>;
    const assistantId = this.asNonEmptyString(row.assistantId);
    const workspaceId = this.asNonEmptyString(row.workspaceId);
    const channel = this.asChannel(row.channel);
    const externalThreadKey = this.asNonEmptyString(row.externalThreadKey);
    const externalUserKey = this.asNullableString(row.externalUserKey);
    const runtimeTier = this.asRuntimeTier(row.runtimeTier);
    const trigger = this.asTrigger(row.trigger) ?? "post_turn";
    const enqueuedRequestId = this.asNullableString(row.enqueuedRequestId);

    if (
      assistantId === null ||
      workspaceId === null ||
      channel === null ||
      externalThreadKey === null ||
      runtimeTier === null
    ) {
      throw new BadRequestException("Background compaction enqueue payload is invalid.");
    }
    return {
      assistantId,
      workspaceId,
      channel,
      externalThreadKey,
      externalUserKey,
      runtimeTier,
      trigger,
      enqueuedRequestId
    };
  }

  async execute(
    input: EnqueueBackgroundCompactionJobInput
  ): Promise<EnqueueBackgroundCompactionJobOutcome> {
    const dedupeKey = this.buildDedupeKey(input);
    try {
      const created = await this.prisma.assistantBackgroundCompactionJob.create({
        data: {
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          channel: input.channel,
          externalThreadKey: input.externalThreadKey,
          externalUserKey: input.externalUserKey,
          runtimeTier: input.runtimeTier,
          trigger: input.trigger,
          status: "pending",
          pendingDedupeKey: dedupeKey,
          enqueuedRequestId: input.enqueuedRequestId
        },
        select: { id: true }
      });
      return { enqueued: true, jobId: created.id, superseded: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // ADR-074 Slice M2 — supersede semantics: while a pending job for the
        // same (assistantId, channel, externalThreadKey) triple still exists,
        // its `pending_dedupe_key` slot is occupied. Collapse silently so the
        // post-turn fire-and-forget never amplifies into a flood of duplicate
        // jobs when the user sends rapid follow-ups.
        return { enqueued: false, jobId: null, superseded: true };
      }
      throw error;
    }
  }

  private buildDedupeKey(input: EnqueueBackgroundCompactionJobInput): string {
    return `${input.assistantId}:${input.channel}:${input.externalThreadKey}`;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asNullableString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    return this.asNonEmptyString(value);
  }

  private asChannel(value: unknown): PersaiRuntimeChannel | null {
    return value === "web" || value === "telegram" || value === "max_ru"
      ? (value as PersaiRuntimeChannel)
      : null;
  }

  private asRuntimeTier(value: unknown): PersaiRuntimeTier | null {
    if (typeof value !== "string") {
      return null;
    }
    return (PERSAI_RUNTIME_TIERS as readonly string[]).includes(value)
      ? (value as PersaiRuntimeTier)
      : null;
  }

  private asTrigger(value: unknown): EnqueueBackgroundCompactionTrigger | null {
    return value === "post_turn" || value === "manual"
      ? (value as EnqueueBackgroundCompactionTrigger)
      : null;
  }
}
