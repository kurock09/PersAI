import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";

/**
 * ADR-074 Slice M3 — opt-in explicit close path for the `memory_write` tool.
 *
 * The runtime calls this service after a successful `memory_write` whose
 * payload set `closeOpenLoop: true`. We look for the most-similar active
 * `open_loop` entry for `(assistantId, userId)` (lexical token-overlap; see
 * {@link AssistantMemoryRegistryRepository.findMostSimilarActiveOpenLoop})
 * and stamp `resolved_at = now()` on it. A no-match outcome is intentionally
 * non-fatal — the model is taught to set the flag generously, and the worst
 * case is that the next cross-session carry-over still includes the loop.
 *
 * M3.1 (queued) will replace this lexical lookup with a structured
 * `memory_write({ action: "close", ref })` action that closes by id, plus
 * a Memory Center UI button. Both will continue to set the same column.
 */

export interface CloseMostSimilarOpenLoopInput {
  assistantId: string;
  referenceText: string;
  requestId: string | null;
}

export interface CloseMostSimilarOpenLoopResult {
  closed: boolean;
  closedItemId: string | null;
  reason: "matched" | "no_active_open_loop_matched" | "cooldown_active";
}

@Injectable()
export class CloseMostSimilarOpenLoopService {
  private readonly logger = new Logger(CloseMostSimilarOpenLoopService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly assistantMemoryRegistryRepository: AssistantMemoryRegistryRepository,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseInput(payload: unknown): CloseMostSimilarOpenLoopInput {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("close-most-similar-open-loop payload must be an object.");
    }
    const row = payload as Record<string, unknown>;

    const assistantId = this.asNonEmptyString(row.assistantId);
    const referenceText = this.normalizeReferenceText(row.referenceText);
    const requestId = this.asNullableString(row.requestId);

    const unknownKeys = Object.keys(row).filter(
      (key) => key !== "assistantId" && key !== "referenceText" && key !== "requestId"
    );

    if (unknownKeys.length > 0 || assistantId === null || referenceText === null) {
      throw new BadRequestException("close-most-similar-open-loop payload is invalid.");
    }

    return {
      assistantId,
      referenceText,
      requestId
    };
  }

  async execute(input: CloseMostSimilarOpenLoopInput): Promise<CloseMostSimilarOpenLoopResult> {
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }

    const candidate = await this.assistantMemoryRegistryRepository.findMostSimilarActiveOpenLoop(
      assistant.id,
      assistant.userId,
      input.referenceText
    );
    if (candidate === null) {
      this.logger.log(
        `[m3-close] No active open-loop matched referenceText for assistant=${assistant.id} (requestId=${input.requestId ?? "null"}).`
      );
      await this.appendAssistantAuditEventService.execute({
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        actorUserId: assistant.userId,
        eventCategory: "memory_registry",
        eventCode: "assistant.open_loop_close_no_match",
        summary: "Open-loop close requested but no active matching loop found.",
        details: {
          requestId: input.requestId
        }
      });
      return {
        closed: false,
        closedItemId: null,
        reason: "no_active_open_loop_matched"
      };
    }
    if (Date.now() - candidate.createdAt.getTime() < OPEN_LOOP_CLOSE_COOLDOWN_MS) {
      this.logger.log(
        `[m3-close] Open-loop ${candidate.id} is still in cooldown for assistant=${assistant.id} (requestId=${input.requestId ?? "null"}).`
      );
      return {
        closed: false,
        closedItemId: candidate.id,
        reason: "cooldown_active"
      };
    }

    const updated = await this.assistantMemoryRegistryRepository.setResolvedAtById(
      candidate.id,
      assistant.id
    );
    if (!updated) {
      // Race: another concurrent writer (implicit close-by-overwrite, the
      // M3.1 close action, or an admin tool) resolved this row between our
      // lookup and the update. Treat as a successful close — the desired
      // post-condition holds. No new audit event needed; the original close
      // already produced one.
      this.logger.log(
        `[m3-close] Open-loop ${candidate.id} was already resolved before close completed (assistant=${assistant.id}).`
      );
      return {
        closed: true,
        closedItemId: candidate.id,
        reason: "matched"
      };
    }

    await this.appendAssistantAuditEventService.execute({
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      actorUserId: assistant.userId,
      eventCategory: "memory_registry",
      eventCode: "assistant.open_loop_closed_explicit",
      summary: "Open-loop closed via memory_write closeOpenLoop flag.",
      details: {
        closedItemId: candidate.id,
        requestId: input.requestId,
        // ADR-074 Slice M3.1 — distinct close-source marker so the four
        // close paths (dedup_overwrite, closeOpenLoop_flag,
        // memory_write_action_close, user_ui_close) can be measured
        // independently in the audit log.
        closeSource: "closeOpenLoop_flag"
      }
    });

    return {
      closed: true,
      closedItemId: candidate.id,
      reason: "matched"
    };
  }

  private normalizeReferenceText(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length === 0 || normalized.length > 500) {
      return null;
    }
    return normalized;
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

const OPEN_LOOP_CLOSE_COOLDOWN_MS = 5_000;
