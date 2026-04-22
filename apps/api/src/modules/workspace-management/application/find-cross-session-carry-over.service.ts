import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  MAX_CROSS_SESSION_CARRY_OVER_SYNOPSES,
  MAX_CROSS_SESSION_CARRY_OVER_TTL_DAYS,
  MIN_CROSS_SESSION_CARRY_OVER_TTL_DAYS
} from "@persai/runtime-contract";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

/**
 * ADR-074 Slice M3 — cross-session continuity carry-over.
 *
 * The runtime calls this service on `turnCount === 0` (first turn of a new
 * conversation) to fetch the data it needs to render the cross-session
 * carry-over block. We return:
 *
 *   - `recentSynopses` — up to `MAX_CROSS_SESSION_CARRY_OVER_SYNOPSES` (3,
 *     hard-coded constant per Principle 1) most-recent rolling synopses,
 *     one per distinct prior `runtime_session_id`, across all channels for
 *     the same `(assistantId, userId)` and within the configured TTL. The
 *     synopsis payload is returned verbatim — the runtime renderer parses
 *     it via `parseStoredReusableCompactionState` and formats the prompt
 *     block.
 *   - `unresolvedOpenLoops` — up to {@link MAX_OPEN_LOOPS_HARD_CAP}
 *     active `open_loop` durable memory entries that are not yet resolved
 *     and were created within the same TTL window. Both lists may be empty
 *     independently; the runtime decides whether to skip the block when
 *     both are empty.
 *
 * Cross-channel scope is the headline behavior — implementer must NOT add
 * a channel filter "for safety". The magic moment is precisely that a
 * synopsis written by a Telegram thread surfaces in a fresh Web thread
 * (and vice versa) for the same assistant/user pair.
 */
const MAX_OPEN_LOOPS_HARD_CAP = 10;
const SYNOPSIS_CANDIDATE_BUFFER = 50;
const MAX_REQUEST_ID_CHARS = 128;

export interface FindCrossSessionCarryOverInput {
  assistantId: string;
  ttlDays: number;
  excludeRuntimeSessionId: string | null;
  requestId: string | null;
}

export interface CrossSessionCarryOverSynopsis {
  runtimeSessionId: string;
  channel: string;
  synopsisUpdatedAt: Date;
  summaryPayload: unknown;
}

export interface CrossSessionCarryOverOpenLoop {
  id: string;
  summary: string;
  createdAt: Date;
}

export interface FindCrossSessionCarryOverResult {
  recentSynopses: CrossSessionCarryOverSynopsis[];
  unresolvedOpenLoops: CrossSessionCarryOverOpenLoop[];
}

@Injectable()
export class FindCrossSessionCarryOverService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly assistantMemoryRegistryRepository: AssistantMemoryRegistryRepository,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  parseInput(payload: unknown): FindCrossSessionCarryOverInput {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("cross-session carry-over payload must be an object.");
    }
    const row = payload as Record<string, unknown>;

    const assistantId = this.asNonEmptyString(row.assistantId);
    const ttlDays = this.asTtlDays(row.ttlDays);
    const excludeRuntimeSessionId = this.asNullableString(row.excludeRuntimeSessionId);
    const requestId = this.asNullableString(row.requestId);

    const unknownKeys = Object.keys(row).filter(
      (key) =>
        key !== "assistantId" &&
        key !== "ttlDays" &&
        key !== "excludeRuntimeSessionId" &&
        key !== "requestId"
    );

    if (unknownKeys.length > 0 || assistantId === null || ttlDays === null) {
      throw new BadRequestException("cross-session carry-over payload is invalid.");
    }

    return {
      assistantId,
      ttlDays,
      excludeRuntimeSessionId,
      requestId:
        requestId !== null && requestId.length > MAX_REQUEST_ID_CHARS
          ? requestId.slice(0, MAX_REQUEST_ID_CHARS)
          : requestId
    };
  }

  async execute(input: FindCrossSessionCarryOverInput): Promise<FindCrossSessionCarryOverResult> {
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }

    const sinceCreatedAt = new Date(Date.now() - input.ttlDays * 24 * 60 * 60 * 1000);

    const [synopsesRaw, openLoops] = await Promise.all([
      this.fetchRecentSynopses(assistant.id, sinceCreatedAt, input.excludeRuntimeSessionId),
      this.assistantMemoryRegistryRepository.findActiveOpenLoopsByAssistantUser(
        assistant.id,
        assistant.userId,
        sinceCreatedAt,
        MAX_OPEN_LOOPS_HARD_CAP
      )
    ]);

    return {
      recentSynopses: synopsesRaw,
      unresolvedOpenLoops: openLoops.map((row) => ({
        id: row.id,
        summary: row.summary,
        createdAt: row.createdAt
      }))
    };
  }

  private async fetchRecentSynopses(
    assistantId: string,
    sinceCreatedAt: Date,
    excludeRuntimeSessionId: string | null
  ): Promise<CrossSessionCarryOverSynopsis[]> {
    // Pull a bounded recent buffer ordered most-recent-first, then dedupe by
    // runtime_session_id in memory to keep "latest synopsis per session"
    // ordered by recency. Prisma DISTINCT ON cannot give us "newest first
    // per group" cleanly without a raw query, so the buffer pattern keeps
    // this readable and easy to test. The buffer is bounded so an
    // assistant with many compactions never paginates the request path.
    const rows = await this.prisma.runtimeSessionCompaction.findMany({
      where: {
        assistantId,
        createdAt: { gte: sinceCreatedAt },
        summaryPayload: { not: Prisma.AnyNull }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SYNOPSIS_CANDIDATE_BUFFER,
      include: {
        runtimeSession: {
          select: {
            id: true,
            channel: true
          }
        }
      }
    });

    const seenSessions = new Set<string>();
    const picked: CrossSessionCarryOverSynopsis[] = [];
    for (const row of rows) {
      if (row.summaryPayload === null) {
        continue;
      }
      if (excludeRuntimeSessionId !== null && row.runtimeSessionId === excludeRuntimeSessionId) {
        continue;
      }
      if (seenSessions.has(row.runtimeSessionId)) {
        continue;
      }
      seenSessions.add(row.runtimeSessionId);
      picked.push({
        runtimeSessionId: row.runtimeSessionId,
        channel: String(row.runtimeSession.channel),
        synopsisUpdatedAt: row.createdAt,
        summaryPayload: row.summaryPayload
      });
      if (picked.length >= MAX_CROSS_SESSION_CARRY_OVER_SYNOPSES) {
        break;
      }
    }
    return picked;
  }

  private asTtlDays(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return null;
    }
    if (
      value < MIN_CROSS_SESSION_CARRY_OVER_TTL_DAYS ||
      value > MAX_CROSS_SESSION_CARRY_OVER_TTL_DAYS
    ) {
      return null;
    }
    return value;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asNullableString(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    return this.asNonEmptyString(value);
  }
}
