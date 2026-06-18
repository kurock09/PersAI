import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  PERSAI_RUNTIME_MEMORY_WRITE_KINDS,
  type PersaiRuntimeMemoryWriteKind,
  PERSAI_RUNTIME_MEMORY_WRITE_LAYERS,
  type PersaiRuntimeMemoryWriteLayer,
  type RuntimeMemoryWriteItem
} from "@persai/runtime-contract";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
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
import { MEMORY_CORE_HARD_CAP, routeDurableMemoryWrite } from "../domain/memory-class-policy";
import {
  evaluateGlobalMemoryWritePolicy,
  type MemorySourceTrustClass,
  type MemoryTransportSurface
} from "../domain/memory-source-policy";
import { AppendAssistantAuditEventService } from "./append-assistant-audit-event.service";
import { isObviouslyNonDurableMemorySummary } from "./memory-summary.util";
import type { AssistantMemoryRegistryProvenance } from "../domain/assistant-memory-registry-item.entity";

export interface WriteAssistantMemoryInput {
  assistantId: string;
  kind: PersaiRuntimeMemoryWriteKind;
  summary: string;
  layer: PersaiRuntimeMemoryWriteLayer;
  confidence: number | null;
  transportSurface: MemoryTransportSurface;
  sourceTrust: MemorySourceTrustClass;
  /** ADR-119 Slice 9 — provenance of this write. */
  provenance: AssistantMemoryRegistryProvenance;
  relatedUserMessageId: string | null;
  requestId: string | null;
}

export interface WriteAssistantMemoryResult {
  written: boolean;
  code: string | null;
  message: string | null;
  item: RuntimeMemoryWriteItem | null;
}

@Injectable()
export class WriteAssistantMemoryService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_GOVERNANCE_REPOSITORY)
    private readonly assistantGovernanceRepository: AssistantGovernanceRepository,
    @Inject(ASSISTANT_MEMORY_REGISTRY_REPOSITORY)
    private readonly assistantMemoryRegistryRepository: AssistantMemoryRegistryRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly appendAssistantAuditEventService: AppendAssistantAuditEventService
  ) {}

  parseInput(payload: unknown): WriteAssistantMemoryInput {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("Memory write payload must be an object.");
    }

    const row = payload as Record<string, unknown>;

    const assistantId = this.asNonEmptyString(row.assistantId);
    const kind = this.asMemoryWriteKind(row.kind);
    const summary = this.normalizeSummary(row.summary);
    const layer = this.asLayer(row.layer);
    const confidence = this.asOptionalConfidence(row.confidence);
    const transportSurface = this.asTransportSurface(row.transportSurface);
    const sourceTrust = this.asSourceTrust(row.sourceTrust);
    const provenance = this.asProvenance(row.provenance);
    const relatedUserMessageId = this.asNullableString(row.relatedUserMessageId);
    const requestId = this.asNullableString(row.requestId);

    const unknownKeys = Object.keys(row).filter(
      (key) =>
        key !== "assistantId" &&
        key !== "kind" &&
        key !== "summary" &&
        key !== "layer" &&
        key !== "confidence" &&
        key !== "transportSurface" &&
        key !== "sourceTrust" &&
        key !== "provenance" &&
        key !== "relatedUserMessageId" &&
        key !== "requestId"
    );

    if (
      unknownKeys.length > 0 ||
      assistantId === null ||
      kind === null ||
      summary === null ||
      layer === null ||
      confidence === undefined ||
      transportSurface === null ||
      provenance === null ||
      sourceTrust === null
    ) {
      throw new BadRequestException("Memory write payload is invalid.");
    }

    return {
      assistantId,
      kind,
      summary,
      layer,
      confidence,
      transportSurface,
      sourceTrust,
      provenance,
      relatedUserMessageId,
      requestId
    };
  }

  async execute(input: WriteAssistantMemoryInput): Promise<WriteAssistantMemoryResult> {
    const assistant = await this.assistantRepository.findById(input.assistantId);
    if (assistant === null) {
      throw new NotFoundException("Assistant not found.");
    }

    const governanceRow = await this.assistantGovernanceRepository.findByAssistantId(assistant.id);
    const effectiveMemoryControl = resolveEffectiveMemoryControlFromGovernance(governanceRow);
    const decision = evaluateGlobalMemoryWritePolicy(effectiveMemoryControl, {
      transportSurface: input.transportSurface,
      sourceTrust: input.sourceTrust
    });
    if (!decision.allowed) {
      await this.appendAssistantAuditEventService.execute({
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        actorUserId: assistant.userId,
        eventCategory: "memory_registry",
        eventCode: "assistant.memory_write_denied",
        outcome: "denied",
        summary: "Durable memory write denied by memory-control policy.",
        details: {
          kind: input.kind,
          transportSurface: input.transportSurface,
          sourceTrust: input.sourceTrust,
          relatedUserMessageId: input.relatedUserMessageId,
          requestId: input.requestId,
          code: decision.code,
          message: decision.message
        }
      });
      return {
        written: false,
        code: decision.code,
        message: decision.message,
        item: null
      };
    }

    // ADR-074 M2 — server-side dedup. Look up an existing active entry whose
    // normalized summary matches; if found, do NOT insert a duplicate. Bump
    // `last_used_at` on the existing row so relevance scoring still rewards it
    // and report the existing item back to the caller. This keeps both the
    // model-driven `memory_write` tool and the M2 auto-extract path
    // idempotent without forcing every caller to do its own pre-check.
    const existingDuplicate =
      await this.assistantMemoryRegistryRepository.findActiveByNormalizedSummaryAndAssistantId(
        assistant.id,
        input.summary
      );
    if (existingDuplicate !== null) {
      await this.assistantMemoryRegistryRepository.bumpLastUsedAt(assistant.id, [
        existingDuplicate.id
      ]);
      // ADR-074 Slice M3 — implicit close-by-overwrite. When the dedup path
      // matches an existing `open_loop` row, treat the new write as the
      // closing restatement and stamp `resolved_at = now()`. This is the
      // "minimal path" close mechanism (the explicit `closeOpenLoop: true`
      // flag on `memory_write` is the opt-in path the model can use
      // proactively); both feed the same column so the cross-session
      // carry-over selector treats them identically. M3.1 will replace this
      // implicit path with a structured close action.
      let implicitlyResolvedOpenLoop = false;
      if (existingDuplicate.kind === "open_loop" && existingDuplicate.resolvedAt === null) {
        implicitlyResolvedOpenLoop = await this.assistantMemoryRegistryRepository.setResolvedAtById(
          existingDuplicate.id,
          assistant.id
        );
      }
      await this.appendAssistantAuditEventService.execute({
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        actorUserId: assistant.userId,
        eventCategory: "memory_registry",
        eventCode: "assistant.memory_write_duplicate",
        summary: "Durable memory write skipped because an equivalent entry already exists.",
        details: {
          existingItemId: existingDuplicate.id,
          kind: input.kind,
          transportSurface: input.transportSurface,
          sourceTrust: input.sourceTrust,
          relatedUserMessageId: input.relatedUserMessageId,
          requestId: input.requestId,
          implicitlyResolvedOpenLoop,
          // ADR-074 Slice M3.1 — distinct close-source marker so the four
          // close paths (dedup_overwrite, closeOpenLoop_flag,
          // memory_write_action_close, user_ui_close) can be measured
          // independently in the audit log.
          ...(implicitlyResolvedOpenLoop ? { closeSource: "dedup_overwrite" } : {})
        }
      });
      return {
        written: false,
        code: "duplicate",
        message: "Memory already exists.",
        item: {
          id: existingDuplicate.id,
          summary: existingDuplicate.summary,
          kind: this.resolveItemKind(existingDuplicate.kind, input.kind),
          layer: this.resolveItemLayer(existingDuplicate.memoryClass, input.layer),
          confidence: this.resolveItemConfidence(existingDuplicate.confidence, input.confidence),
          sourceLabel: existingDuplicate.sourceLabel,
          createdAt: existingDuplicate.createdAt.toISOString(),
          chatId: existingDuplicate.chatId
        }
      };
    }

    let chatId: string | null = null;
    if (input.relatedUserMessageId !== null) {
      const relatedMessage = await this.assistantChatRepository.findMessageByIdForAssistant(
        input.relatedUserMessageId,
        assistant.id
      );
      if (relatedMessage === null) {
        throw new BadRequestException("relatedUserMessageId does not belong to the assistant.");
      }
      if (relatedMessage.author !== "user") {
        throw new BadRequestException(
          "relatedUserMessageId must reference a user-authored message."
        );
      }
      chatId = relatedMessage.chatId;
    }

    const route = routeDurableMemoryWrite({
      layer: input.layer,
      guardrailRejected: isObviouslyNonDurableMemorySummary(input.summary)
    });
    if (route.action === "skip") {
      return {
        written: false,
        code: route.reason,
        message: "Memory is not durable enough to store.",
        item: null
      };
    }

    if (route.memoryClass === "core") {
      const currentCoreCount =
        await this.assistantMemoryRegistryRepository.countActiveCoreByAssistantId(assistant.id);
      const overflow = currentCoreCount + 1 - MEMORY_CORE_HARD_CAP;
      if (overflow > 0) {
        await this.assistantMemoryRegistryRepository.demoteOldestCoreByAssistantId(
          assistant.id,
          overflow
        );
      }
    }

    const created = await this.assistantMemoryRegistryRepository.create({
      assistantId: assistant.id,
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      chatId,
      relatedUserMessageId: input.relatedUserMessageId,
      relatedAssistantMessageId: null,
      summary: input.summary,
      sourceType: "memory_write",
      sourceLabel: this.buildSourceLabel(input.kind, input.layer),
      memoryClass: route.memoryClass,
      kind: input.kind,
      durability: route.durability,
      stability: route.stability,
      provenance: input.provenance,
      confidence: input.confidence
    });

    await this.appendAssistantAuditEventService.execute({
      workspaceId: assistant.workspaceId,
      assistantId: assistant.id,
      actorUserId: assistant.userId,
      eventCategory: "memory_registry",
      eventCode: "assistant.memory_written",
      summary: "Durable memory written via memory_write system tool.",
      details: {
        itemId: created.id,
        kind: input.kind,
        layer: input.layer,
        memoryClass: route.memoryClass,
        confidence: input.confidence,
        transportSurface: input.transportSurface,
        sourceTrust: input.sourceTrust,
        relatedUserMessageId: created.relatedUserMessageId,
        requestId: input.requestId
      }
    });

    return {
      written: true,
      code: null,
      message: null,
      item: {
        id: created.id,
        summary: created.summary,
        kind: input.kind,
        layer: input.layer,
        confidence: created.confidence,
        sourceLabel: created.sourceLabel,
        createdAt: created.createdAt.toISOString(),
        chatId: created.chatId
      }
    };
  }

  private normalizeSummary(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length > 500) {
      return null;
    }
    return normalized;
  }

  private asMemoryWriteKind(value: unknown): PersaiRuntimeMemoryWriteKind | null {
    return typeof value === "string" &&
      PERSAI_RUNTIME_MEMORY_WRITE_KINDS.includes(value as PersaiRuntimeMemoryWriteKind)
      ? (value as PersaiRuntimeMemoryWriteKind)
      : null;
  }

  private asLayer(value: unknown): PersaiRuntimeMemoryWriteLayer | null {
    return typeof value === "string" &&
      PERSAI_RUNTIME_MEMORY_WRITE_LAYERS.includes(value as PersaiRuntimeMemoryWriteLayer)
      ? (value as PersaiRuntimeMemoryWriteLayer)
      : null;
  }

  private asOptionalConfidence(value: unknown): number | null | undefined {
    if (value === undefined || value === null) {
      return null;
    }
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : undefined;
  }

  private asTransportSurface(value: unknown): MemoryTransportSurface | null {
    return value === "web" || value === "telegram" ? value : null;
  }

  private asSourceTrust(value: unknown): MemorySourceTrustClass | null {
    return value === "trusted_1to1" || value === "group" ? value : null;
  }

  private asProvenance(value: unknown): AssistantMemoryRegistryProvenance | null {
    // Default to system_inferred when provenance is not supplied — callers that
    // cannot distinguish user_explicit from system_inferred omit the field.
    if (value === undefined || value === null) return "system_inferred";
    if (
      value === "user_explicit" ||
      value === "system_inferred" ||
      value === "auto_extracted" ||
      value === "legacy"
    ) {
      return value;
    }
    return null;
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

  private resolveItemKind(
    storedKind: PersaiRuntimeMemoryWriteKind | null,
    fallback: PersaiRuntimeMemoryWriteKind
  ): PersaiRuntimeMemoryWriteKind {
    return storedKind ?? fallback;
  }

  private resolveItemLayer(
    memoryClass: "core" | "contextual",
    fallback: PersaiRuntimeMemoryWriteLayer
  ): PersaiRuntimeMemoryWriteLayer {
    if (memoryClass === "core") {
      return "long";
    }
    if (memoryClass === "contextual") {
      return "short";
    }
    return fallback;
  }

  private resolveItemConfidence(
    storedConfidence: number | null,
    fallback: number | null
  ): number | null {
    return storedConfidence ?? fallback;
  }

  private buildSourceLabel(
    kind: PersaiRuntimeMemoryWriteKind,
    layer: PersaiRuntimeMemoryWriteLayer
  ): string {
    const prefix = layer === "long" ? "Long memory write" : "Short memory write";
    switch (kind) {
      case "fact":
        return `${prefix}: fact`;
      case "preference":
        return `${prefix}: preference`;
      case "open_loop":
        return `${prefix}: open loop`;
    }
  }
}
