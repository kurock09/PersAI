import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import {
  ASSISTANT_GOVERNANCE_REPOSITORY,
  type AssistantGovernanceRepository
} from "../domain/assistant-governance.repository";
import {
  ASSISTANT_MEMORY_REGISTRY_REPOSITORY,
  type AssistantMemoryRegistryRepository
} from "../domain/assistant-memory-registry.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { resolveEffectiveMemoryControlFromGovernance } from "../domain/memory-control-resolve";
import { isGlobalMemoryReadAllowed } from "../domain/memory-source-policy";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";

/**
 * ADR-074 Slice M3.1 — deterministic open-loop close by id.
 *
 * Two entry points share one core close routine:
 *   - {@link executeForRuntime} (called from the internal `:3002`
 *     route the runtime hits when the model emits
 *     `memory_write({ action: "close", ref })`) — assumes the runtime is
 *     trusted and skips the user-facing memory-control envelope check.
 *   - {@link executeForUser} (called from the public Memory Center route
 *     the front-end hits on the "Mark as closed" button) — resolves the
 *     assistant from `userId` and enforces the global memory-control
 *     envelope just like {@link ForgetAssistantMemoryItemService} does.
 *
 * Both paths funnel through {@link closeByItemId}, which validates that
 * the item exists for the assistant, is `kind = "open_loop"`, and is
 * still active. Already-resolved loops return `reason = "already_closed"`
 * (HTTP 200, idempotent). The service emits a distinct audit-log
 * `eventCode` per source so we can measure usage of the four close paths
 * later (`memory_write_action_close` / `closeOpenLoop_flag` /
 * `dedup_overwrite` / `user_ui_close`). Sibling services already exist
 * for the latter two markers; this service owns the first marker
 * (memory_write_action_close) directly and exposes `user_ui_close` as a
 * `source` parameter so the public controller can stamp it.
 */

export type CloseAssistantMemoryByRefSource = "memory_write_action_close" | "user_ui_close";

export type CloseAssistantMemoryByRefReason =
  | "closed"
  | "already_closed"
  | "cooldown_active"
  | "not_open_loop"
  | "not_found";

export interface CloseAssistantMemoryByRefResult {
  closed: boolean;
  closedItemId: string | null;
  reason: CloseAssistantMemoryByRefReason;
}

export interface CloseAssistantMemoryByRefRuntimeInput {
  assistantId: string;
  itemId: string;
  requestId: string | null;
}

@Injectable()
export class CloseAssistantMemoryByRefService {
  private readonly logger = new Logger(CloseAssistantMemoryByRefService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly assistantMemoryRegistryRepository: AssistantMemoryRegistryRepository,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseRuntimeInput(payload: unknown): CloseAssistantMemoryByRefRuntimeInput {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("close-by-ref payload must be an object.");
    }
    const row = payload as Record<string, unknown>;
    const assistantId = this.asNonEmptyString(row.assistantId);
    const itemId = this.asNonEmptyString(row.itemId);
    const requestId = this.asNullableString(row.requestId);

    const unknownKeys = Object.keys(row).filter(
      (key) => key !== "assistantId" && key !== "itemId" && key !== "requestId"
    );
    if (unknownKeys.length > 0 || assistantId === null || itemId === null) {
      throw new BadRequestException("close-by-ref payload is invalid.");
    }
    return { assistantId, itemId, requestId };
  }

  async executeForRuntime(
    input: CloseAssistantMemoryByRefRuntimeInput
  ): Promise<CloseAssistantMemoryByRefResult> {
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }
    return this.closeByItemId({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      actorUserId: assistant.userId,
      itemId: input.itemId,
      source: "memory_write_action_close",
      requestId: input.requestId
    });
  }

  async executeForUser(
    userId: string,
    itemId: string,
    requestId: string | null
  ): Promise<CloseAssistantMemoryByRefResult> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    const governance = await this.assistantGovernanceRepository.findByAssistantId(assistant.id);
    const envelope = resolveEffectiveMemoryControlFromGovernance(governance);
    if (!isGlobalMemoryReadAllowed(envelope)) {
      throw new ConflictException(
        "Global memory read is disabled by assistant policy. Memory Center actions are unavailable."
      );
    }
    return this.closeByItemId({
      assistantId: assistant.id,
      workspaceId: assistant.workspaceId,
      actorUserId: assistant.userId,
      itemId,
      source: "user_ui_close",
      requestId
    });
  }

  private async closeByItemId(params: {
    assistantId: string;
    workspaceId: string;
    actorUserId: string;
    itemId: string;
    source: CloseAssistantMemoryByRefSource;
    requestId: string | null;
  }): Promise<CloseAssistantMemoryByRefResult> {
    const existing = await this.assistantMemoryRegistryRepository.findActiveByIdAndAssistantId(
      params.itemId,
      params.assistantId
    );
    if (existing === null) {
      this.logger.log(
        `[m31-close] Memory item not found for close (assistant=${params.assistantId}, itemId=${params.itemId}, source=${params.source}, requestId=${params.requestId ?? "null"}).`
      );
      throw new NotFoundException("Memory item not found.");
    }
    if (existing.kind !== "open_loop") {
      this.logger.log(
        `[m31-close] Memory item ${params.itemId} is kind=${existing.kind ?? "null"}, refusing close (assistant=${params.assistantId}, source=${params.source}).`
      );
      throw new BadRequestException(
        "Only open-loop memory items can be closed via close-open-loop."
      );
    }
    if (existing.resolvedAt !== null) {
      // Already resolved: idempotent success. We deliberately DO NOT emit a
      // new audit event here because the original close path already wrote
      // one; emitting again would inflate counters and confuse usage
      // measurements across the four close sources.
      return {
        closed: true,
        closedItemId: existing.id,
        reason: "already_closed"
      };
    }
    if (Date.now() - existing.createdAt.getTime() < OPEN_LOOP_CLOSE_COOLDOWN_MS) {
      this.logger.log(
        `[m31-close] Open-loop ${existing.id} is still in cooldown (assistant=${params.assistantId}, source=${params.source}, requestId=${params.requestId ?? "null"}).`
      );
      return {
        closed: false,
        closedItemId: existing.id,
        reason: "cooldown_active"
      };
    }

    const updated = await this.assistantMemoryRegistryRepository.setResolvedAtById(
      existing.id,
      params.assistantId
    );
    if (!updated) {
      // Race: another concurrent writer (implicit close-by-overwrite, the
      // M3 closeOpenLoop_flag path, or another structured close) resolved
      // this row between our lookup and the update. Treat as a successful
      // close — the desired post-condition holds. No new audit event so
      // we do not double-count the close.
      return {
        closed: true,
        closedItemId: existing.id,
        reason: "already_closed"
      };
    }

    await this.appendAssistantAuditEventService.execute({
      workspaceId: params.workspaceId,
      assistantId: params.assistantId,
      actorUserId: params.actorUserId,
      eventCategory: "memory_registry",
      eventCode: "assistant.open_loop_closed_by_ref",
      summary:
        params.source === "user_ui_close"
          ? "Open-loop closed via Memory Center UI button."
          : "Open-loop closed via memory_write action=close ref.",
      details: {
        closedItemId: existing.id,
        // ADR-074 Slice M3.1 — distinct close-source marker so the four
        // close paths (dedup_overwrite, closeOpenLoop_flag,
        // memory_write_action_close, user_ui_close) can be measured
        // independently in the audit log.
        closeSource: params.source,
        requestId: params.requestId
      }
    });

    return {
      closed: true,
      closedItemId: existing.id,
      reason: "closed"
    };
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
